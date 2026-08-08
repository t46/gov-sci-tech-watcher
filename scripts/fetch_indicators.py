#!/usr/bin/env python3
"""Fetch long-term science & technology indicator series for the atlas page.

Sources (all fetched at build time, baked into data/indicators.json):
- NISTEP 科学技術指標2025 (Excel tables, stable URLs, no key)
- OECD Main Science and Technology Indicators (SDMX CSV, no key)
- OpenAlex (aggregation API, optional free key via OPENALEX_API_KEY)
- e-Stat API (optional, requires ESTAT_APP_ID)

Every block carries {status, source, unit} so the frontend can state
provenance honestly and degrade gracefully when a source is unavailable.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
import re
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from xml.etree import ElementTree
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "indicators.json"

USER_AGENT = "gov-sci-tech-watcher/1.0 (+https://science-signal.pages.dev/)"
NISTEP_BASE = "https://www.nistep.go.jp/sti_indicator/2025/hyoudata/"
NISTEP_INDEX = "https://www.nistep.go.jp/sti_indicator/2025/RM349_table.html"
OECD_BASE = "https://sdmx.oecd.org/public/rest/data/OECD.STI.STP,DSD_MSTI@DF_MSTI,/"
OPENALEX_BASE = "https://api.openalex.org/works"
OPENALEX_MAILTO = "takagi4646@gmail.com"

COUNTRY_LABELS = {
    "jp": "日本", "us": "米国", "de": "ドイツ", "fr": "フランス",
    "gb": "英国", "cn": "中国", "kr": "韓国", "eu27": "EU-27",
    "jp_oecd": "日本（OECD推計）", "jp_hc": "日本（HC）", "jp_fte": "日本（FTE）",
    "us_broad": "米国（全博士号）", "world": "全世界",
}

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def fetch(url: str, timeout: int = 60) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urlopen(request, timeout=timeout) as response:
        return response.read()


def number(value: str | None) -> int | float | None:
    if not value or value.strip() in {"-", "…", "...", "n.a.", "NA"}:
        return None
    try:
        parsed = float(value.replace(",", ""))
    except ValueError:
        return None
    return int(parsed) if parsed.is_integer() and abs(parsed) < 1e15 else round(parsed, 4)


# ---------------------------------------------------------------- xlsx parsing

def _shared_strings(archive: ZipFile) -> list[str]:
    """Shared strings without phonetic (furigana) runs."""
    strings: list[str] = []
    if "xl/sharedStrings.xml" not in archive.namelist():
        return strings
    root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
    for item in root.findall("m:si", NS):
        parts: list[str] = []
        direct = item.find("m:t", NS)
        if direct is not None:
            parts.append(direct.text or "")
        for run in item.findall("m:r", NS):  # rich runs; excludes m:rPh phonetics
            text = run.find("m:t", NS)
            if text is not None:
                parts.append(text.text or "")
        strings.append("".join(parts))
    return strings


def read_sheet(blob: bytes, sheet_path: str) -> dict[int, dict[str, str]]:
    with ZipFile(BytesIO(blob)) as archive:
        shared = _shared_strings(archive)
        sheet_root = ElementTree.fromstring(archive.read(sheet_path))
    rows: dict[int, dict[str, str]] = {}
    for row in sheet_root.findall(".//m:sheetData/m:row", NS):
        values: dict[str, str] = {}
        for cell in row.findall("m:c", NS):
            reference = cell.attrib.get("r", "")
            value_node = cell.find("m:v", NS)
            value = "" if value_node is None else value_node.text or ""
            if cell.attrib.get("t") == "s" and value:
                value = shared[int(value)]
            column = "".join(ch for ch in reference if ch.isalpha())
            if value.strip():
                values[column] = value.strip().replace("\n", " ")
        if values:
            rows[int(row.attrib["r"])] = values
    return rows


def year_series(rows: dict[int, dict[str, str]], start_row: int, year_col: str, columns: dict[str, str]) -> dict[str, list[list[object]]]:
    """Walk rows from start_row while year_col holds a 4-digit year; collect per-key [year, value] pairs."""
    series: dict[str, list[list[object]]] = {key: [] for key in columns.values()}
    for index in sorted(row for row in rows if row >= start_row):
        year_text = rows[index].get(year_col, "")
        if not re.fullmatch(r"\d{4}", year_text):
            if any(rows[index].get(year_col) for _ in [0]) or index > start_row:
                break
            continue
        year = int(year_text)
        for column, key in columns.items():
            value = number(rows[index].get(column))
            if value is not None:
                series[key].append([year, value])
    return series


def to_series_list(series: dict[str, list[list[object]]]) -> list[dict[str, object]]:
    return [
        {"key": key, "label": COUNTRY_LABELS.get(key, key), "values": values}
        for key, values in series.items()
        if values
    ]


def nistep_table(name: str) -> bytes:
    return fetch(f"{NISTEP_BASE}STI2025_{name}.xlsx")


def nistep_source(table_no: str, title: str) -> dict[str, str]:
    return {"title": f"NISTEP 科学技術指標2025 表{table_no} {title}", "url": NISTEP_INDEX}


def block_gerd_gdp() -> dict[str, object]:
    rows = read_sheet(nistep_table("1-1-03"), "xl/worksheets/sheet2.xml")
    columns = {"B": "jp", "F": "us", "H": "de", "J": "fr", "L": "gb", "N": "cn", "P": "kr", "R": "eu27"}
    series = year_series(rows, 5, "A", columns)
    return {
        "status": "ok", "unit": "%",
        "source": nistep_source("1-1-3", "主要国の研究開発費総額の対GDP比率の推移"),
        "series": to_series_list(series),
    }


def block_researchers() -> dict[str, object]:
    rows = read_sheet(nistep_table("2-1-03"), "xl/worksheets/sheet2.xml")
    columns = {"B": "jp", "D": "jp_hc", "F": "jp_fte", "H": "us", "J": "de", "L": "fr", "N": "gb", "P": "cn", "R": "kr", "T": "eu27"}
    series = year_series(rows, 4, "A", columns)
    return {
        "status": "ok", "unit": "人",
        "source": nistep_source("2-1-3", "主要国の研究者数の推移"),
        "note": "日本は2001年まで旧定義（jp）、2002年以降はHC/FTE（jp_hc/jp_fte）。他国はOECD統計（FTE中心）で測定方法が異なる。",
        "series": to_series_list(series),
    }


def block_phd_enrollment() -> dict[str, object]:
    rows = read_sheet(nistep_table("3-2-03"), "xl/worksheets/sheet2.xml")
    fields = {"B": "合計", "C": "人文科学", "D": "社会科学", "E": "理学", "F": "工学", "G": "農学", "H": "保健", "I": "家政", "J": "教育", "K": "芸術", "L": "その他"}
    entries: list[dict[str, object]] = []
    for index in sorted(row for row in rows if row >= 5):
        year_text = rows[index].get("A", "")
        if not re.fullmatch(r"\d{4}", year_text):
            break
        entry: dict[str, object] = {"year": int(year_text)}
        for column, label in fields.items():
            value = number(rows[index].get(column))
            if label == "合計":
                entry["total"] = value
            else:
                entry.setdefault("fields", {})[label] = value  # type: ignore[union-attr]
        entries.append(entry)
    return {
        "status": "ok", "unit": "人",
        "source": nistep_source("3-2-3", "大学院（博士課程）入学者数（専攻別）"),
        "rows": entries,
    }


def block_phd_degrees() -> dict[str, object]:
    rows = read_sheet(nistep_table("3-4-04"), "xl/worksheets/sheet2.xml")
    columns = {"B": "jp", "C": "us", "E": "de", "F": "fr", "G": "gb", "H": "cn", "I": "kr"}
    series = year_series(rows, 6, "A", columns)
    return {
        "status": "ok", "unit": "人",
        "source": nistep_source("3-4-4", "主要国の博士号取得者数の推移"),
        "note": "米国は研究博士（Research doctorate）。年度定義は国により異なる。",
        "series": to_series_list(series),
    }


def block_paper_share() -> dict[str, object]:
    rows = read_sheet(nistep_table("4-1-07"), "xl/worksheets/sheet2.xml")
    order = ["jp", "us", "de", "fr", "gb", "cn", "kr"]
    blocks = {
        "share": dict(zip(["B", "C", "D", "E", "F", "G", "H"], order)),
        "top10_share": dict(zip(["J", "K", "L", "M", "N", "O", "P"], order)),
        "top1_share": dict(zip(["R", "S", "T", "U", "V", "W", "X"], order)),
    }
    result: dict[str, object] = {
        "status": "ok", "unit": "%",
        "source": nistep_source("4-1-7", "主要国の論文数・Top10%・Top1%補正論文数シェアの変化"),
        "note": "整数カウント法、全分野、3年移動平均。原データはWeb of Science（クラリベイト社）をNISTEPが集計。",
    }
    for name, columns in blocks.items():
        result[name] = to_series_list(year_series(rows, 8, "A", columns))
    counts_order = order + ["world"]
    counts = {
        "counts": dict(zip(["AB", "AC", "AD", "AE", "AF", "AG", "AH", "AI"], counts_order)),
        "top10_counts": dict(zip(["AK", "AL", "AM", "AN", "AO", "AP", "AQ", "AR"], counts_order)),
    }
    for name, columns in counts.items():
        result[name] = to_series_list(year_series(rows, 8, "AA", columns))
    return result


def block_field_share() -> dict[str, object]:
    rows = read_sheet(nistep_table("4-1-09"), "xl/worksheets/sheet2.xml")
    country_names = {"日本": "jp", "米国": "us", "ドイツ": "de", "フランス": "fr", "英国": "gb", "中国": "cn", "韓国": "kr"}
    data: dict[str, dict[str, list[list[object]]]] = {}
    year_columns: dict[str, int] = {}
    current: str | None = None
    for index in sorted(rows):
        values = rows[index]
        label = values.get("A", "")
        if label.startswith(("注", "資料", "表")):
            if label.startswith(("注", "資料")):
                current = None
            continue
        if label == "年":
            year_columns = {column: int(text) for column, text in values.items() if column != "A" and re.fullmatch(r"\d{4}", text)}
            continue
        if label in country_names and len(values) == 1:
            current = country_names[label]
            data.setdefault(current, {})
            continue
        if current and year_columns and label and label != "全分野":
            field = data[current].setdefault(label, [])
            for column, year in year_columns.items():
                value = number(values.get(column))
                if value is not None:
                    field.append([year, value])
    countries = [
        {
            "key": key, "label": COUNTRY_LABELS[key],
            "fields": [
                {"label": field, "values": sorted(points)}
                for field, points in fields.items()
            ],
        }
        for key, fields in data.items()
    ]
    return {
        "status": "ok", "unit": "%",
        "source": nistep_source("4-1-9", "主要国の分野別論文数割合の推移"),
        "note": "分数カウント法。原データはWeb of Science（クラリベイト社）をNISTEPが集計。",
        "countries": countries,
    }


# ------------------------------------------------------------------- OECD MSTI

def oecd_query(key: str, start: int) -> list[dict[str, str]]:
    url = f"{OECD_BASE}{key}?startPeriod={start}&format=csvfilewithlabels"
    text = fetch(url).decode("utf-8-sig")
    return list(csv.DictReader(io.StringIO(text)))

OECD_AREAS = {"JPN": "jp", "USA": "us", "DEU": "de", "FRA": "fr", "GBR": "gb", "CHN": "cn", "KOR": "kr", "EU27_2020": "eu27"}


def oecd_series(records: list[dict[str, str]]) -> list[dict[str, object]]:
    series: dict[str, list[list[object]]] = {}
    for record in records:
        key = OECD_AREAS.get(record.get("REF_AREA", ""))
        value = number(record.get("OBS_VALUE"))
        year_text = record.get("TIME_PERIOD", "")
        if key and value is not None and re.fullmatch(r"\d{4}", year_text):
            series.setdefault(key, []).append([int(year_text), value])
    return to_series_list({key: sorted(values) for key, values in series.items()})


def block_oecd(measure_key: str, start: int, unit: str, title: str, note: str | None = None) -> dict[str, object]:
    records = oecd_query(f"JPN+USA+KOR+DEU+CHN+FRA+GBR.A.{measure_key}", start)
    block: dict[str, object] = {
        "status": "ok", "unit": unit,
        "source": {"title": f"OECD Main Science and Technology Indicators — {title}", "url": "https://data-explorer.oecd.org/"},
        "series": oecd_series(records),
    }
    if note:
        block["note"] = note
    return block


# -------------------------------------------------------------------- OpenAlex

def openalex_api(path_query: str) -> dict[str, object]:
    api_key = os.environ.get("OPENALEX_API_KEY", "")
    url = f"https://api.openalex.org/{path_query}&mailto={OPENALEX_MAILTO}"
    if api_key:
        url += f"&api_key={api_key}"
    return json.loads(fetch(url).decode("utf-8"))


def openalex_group_by(filters: str, group_by: str) -> list[dict[str, object]]:
    payload = openalex_api(f"works?filter={quote(filters, safe=':,-')}&group_by={quote(group_by)}&per-page=200")
    return payload.get("group_by", [])


KANJI = re.compile(r"[぀-ヿ一-鿿]")


def japanese_label(display_name: str, alternatives: list[str]) -> str:
    """Prefer a CJK alternative name (e.g. 東京大学) over the English display name."""
    candidates = [alt for alt in alternatives or [] if KANJI.search(alt) and not re.fullmatch(r"[぀-ヿ]+", alt)]
    return min(candidates, key=len) if candidates else display_name


def openalex_jp_institutions(window_filter: str) -> list[dict[str, object]]:
    groups = openalex_group_by(window_filter, "authorships.institutions.lineage")
    ranked = [
        {"id": str(g.get("key", "")).rsplit("/", 1)[-1], "label": str(g.get("key_display_name", "")), "count": int(g.get("count", 0))}
        for g in groups
        if g.get("key_display_name")
    ][:60]
    ids = "|".join(r["id"] for r in ranked if r["id"].startswith("I"))
    lookup = openalex_api(f"institutions?filter=ids.openalex:{ids}&per-page=60&select=id,display_name,display_name_alternatives,country_code")
    meta = {str(r.get("id", "")).rsplit("/", 1)[-1]: r for r in lookup.get("results", [])}
    rows = []
    for row in ranked:
        info = meta.get(row["id"])
        if not info or info.get("country_code") != "JP":
            continue
        rows.append({"label": japanese_label(str(info.get("display_name", row["label"])), info.get("display_name_alternatives") or []), "count": row["count"]})
    return rows[:24]


def year_buckets(groups: list[dict[str, object]]) -> list[list[object]]:
    pairs = []
    for group in groups:
        key = str(group.get("key", ""))
        if re.fullmatch(r"\d{4}", key):
            pairs.append([int(key), int(group.get("count", 0))])
    return sorted(pairs)


def block_openalex(current_year: int) -> dict[str, object]:
    span = f"publication_year:1990-{current_year}"
    window = f"publication_year:{current_year - 5}-{current_year - 1}"
    countries = {"jp": "JP", "us": "US", "cn": "CN", "de": "DE", "fr": "FR", "gb": "GB", "kr": "KR"}
    by_year: dict[str, list[list[object]]] = {}
    for key, code in countries.items():
        by_year[key] = year_buckets(openalex_group_by(f"institutions.country_code:{code},type:article,{span}", "publication_year"))
    jp_collab = year_buckets(openalex_group_by(f"institutions.country_code:JP,type:article,countries_distinct_count:>1,{span}", "publication_year"))
    jp_fields = [
        {"label": str(group.get("key_display_name", "")), "count": int(group.get("count", 0))}
        for group in openalex_group_by(f"institutions.country_code:JP,type:article,{window}", "primary_topic.field.id")
        if group.get("key_display_name")
    ]
    jp_institutions = openalex_jp_institutions(f"institutions.country_code:JP,type:article,{window}")
    return {
        "status": "ok", "unit": "本",
        "source": {"title": "OpenAlex（CC0） 学術論文データベース", "url": "https://openalex.org/"},
        "note": f"type:article のみ。{current_year}年は年途中の暫定値。機関の国別割当はOpenAlexの機関同定に基づく。",
        "partial_year": current_year,
        "by_year": to_series_list(by_year),
        "jp_international_collab": jp_collab,
        "jp_fields_window": {"from": current_year - 5, "to": current_year - 1, "rows": jp_fields},
        "jp_institutions_window": {"from": current_year - 5, "to": current_year - 1, "rows": jp_institutions},
    }


# ----------------------------------------------------------------------- e-Stat

def block_estat() -> dict[str, object]:
    app_id = os.environ.get("ESTAT_APP_ID", "")
    if not app_id:
        return {
            "status": "unavailable", "unit": None,
            "source": {"title": "e-Stat API（政府統計の総合窓口）", "url": "https://www.e-stat.go.jp/api/"},
            "note": "ESTAT_APP_ID が未設定のためスキップ。無料登録後にSecretsへ追加すると国内詳細系列が有効になる。",
        }
    return {
        "status": "unavailable", "unit": None,
        "source": {"title": "e-Stat API（政府統計の総合窓口）", "url": "https://www.e-stat.go.jp/api/"},
        "note": "統計表IDの選定が未実施。キー設定後の拡張ポイント。",
    }


# ------------------------------------------------------------------------ main

def run_block(name: str, builder) -> dict[str, object]:
    try:
        block = builder()
        points = 0
        for value in block.values():
            if isinstance(value, list):
                points += len(value)
        print(f"  ok      {name}")
        return block
    except Exception as exc:  # noqa: BLE001 — every block degrades independently
        print(f"  failed  {name}: {exc}")
        return {"status": "unavailable", "error": str(exc)[:200]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    current_year = datetime.now(timezone.utc).year

    print("Fetching indicator blocks:")
    indicators = {
        "gerd_gdp": run_block("gerd_gdp", block_gerd_gdp),
        "researchers": run_block("researchers", block_researchers),
        "phd_enrollment": run_block("phd_enrollment", block_phd_enrollment),
        "phd_degrees": run_block("phd_degrees", block_phd_degrees),
        "papers": run_block("papers", block_paper_share),
        "field_share": run_block("field_share", block_field_share),
        "oecd_gerd_gdp": run_block("oecd_gerd_gdp", lambda: block_oecd("G.PT_B1GQ..", 1990, "%", "GERD as percentage of GDP", "2024年は暫定値を含む。")),
        "oecd_researchers": run_block("oecd_researchers", lambda: block_oecd("T_RS.10P3EMP..", 1990, "人/千人雇用", "Researchers per 1000 employment")),
        "oecd_gov_financed": run_block("oecd_gov_financed", lambda: block_oecd("G_FG.PT_GERD..", 1990, "%", "Government-financed GERD share")),
        "openalex": run_block("openalex", lambda: block_openalex(current_year)),
        "estat": run_block("estat", block_estat),
    }

    output = {
        "schema_version": 1,
        "generated_at": now_iso(),
        "indicators": indicators,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    size = args.output.stat().st_size
    print(f"Wrote {args.output} ({size:,} bytes)")
    failed = [name for name, block in indicators.items() if block.get("status") != "ok"]
    if failed:
        print(f"Unavailable blocks: {', '.join(failed)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
