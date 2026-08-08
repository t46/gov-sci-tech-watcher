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


def block_funding_flow() -> dict[str, object]:
    """表1-1-5 (A)日本: 負担部門→使用部門の研究開発費マトリクス（2023年度、100万円）."""
    rows = read_sheet(nistep_table("1-1-05"), "xl/worksheets/sheet2.xml")
    use_columns = {"D": "企業", "E": "公的機関", "F": "大学", "I": "非営利団体"}
    # 行8=企業、行10=政府（行9「政府計」は国・公立大学を含むため使わない）、行13=非営利、行14=外国
    fund_rows = {8: "企業", 10: "政府", 13: "非営利団体", 14: "外国"}
    links: list[dict[str, object]] = []
    for row_index, funder in fund_rows.items():
        for column, user in use_columns.items():
            value = number(rows.get(row_index, {}).get(column))
            if value is not None and value > 0:
                links.append({"source": funder, "target": user, "value": value})
    # 大学 = 国・公立大学(11) + 私立大学(12)
    for column, user in use_columns.items():
        total = sum(v for v in (number(rows.get(idx, {}).get(column)) for idx in (11, 12)) if v is not None and v > 0)
        if total > 0:
            links.append({"source": "大学", "target": user, "value": total})
    return {
        "status": "ok", "unit": "百万円", "year_label": "2023年度",
        "source": nistep_source("1-1-5", "主要国の負担部門から使用部門への研究開発費の流れ（日本）"),
        "note": "負担者「大学」は国・公立大学と私立大学の合計。原資料は総務省 科学技術研究調査。",
        "links": links,
    }


def block_gov_spending_dest() -> dict[str, object]:
    """表1-2-5 (A)日本: 政府負担研究開発費の支出先内訳の推移（%）."""
    rows = read_sheet(nistep_table("1-2-05"), "xl/worksheets/sheet2.xml")
    columns = {"B": "企業", "D": "公的機関", "F": "大学", "H": "非営利団体"}
    entries = []
    for index in sorted(row for row in rows if row >= 6):
        year_text = rows[index].get("A", "")
        if not re.fullmatch(r"\d{4}", year_text):
            break
        entry = {"year": int(year_text)}
        for column, label in columns.items():
            value = number(rows[index].get(column))
            if value is not None:
                entry[label] = value
        entries.append(entry)
    return {
        "status": "ok", "unit": "%",
        "source": nistep_source("1-2-5", "主要国における政府負担研究開発費の支出先の内訳の推移（日本）"),
        "note": "使用部門側から見た政府負担研究開発費の配分割合。原資料は総務省 科学技術研究調査。",
        "rows": entries,
    }


def block_ministry_budget() -> dict[str, object]:
    """表1-2-8 (A)当初予算: 府省庁別の科学技術関係予算（100万円）— 年度バンドが複数ブロック."""
    rows = read_sheet(nistep_table("1-2-08"), "xl/worksheets/sheet2.xml")
    data: dict[str, dict[int, float]] = {}
    year_columns: dict[str, int] = {}
    in_block_a = False
    for index in sorted(rows):
        values = rows[index]
        label = values.get("A", "")
        if re.match(r"^\([A-Z]\)", label):
            in_block_a = label.startswith("(A)")
            continue
        if label.startswith(("注", "資料", "表")) or not in_block_a:
            if label.startswith(("注", "資料")):
                in_block_a = False
            continue
        years_in_row = {column: int(text) for column, text in values.items() if column != "A" and re.fullmatch(r"(19|20)\d{2}", text)}
        if len(years_in_row) >= 3:
            year_columns = years_in_row
            continue
        if label and label not in {"省庁別", "（当時）"} and not re.fullmatch(r"合\s*計", label) and year_columns:
            ministry = data.setdefault(label, {})
            for column, year in year_columns.items():
                value = number(values.get(column))
                if value is not None:
                    ministry[year] = value
    series = [
        {"label": name, "values": sorted([[year, value] for year, value in points.items()])}
        for name, points in data.items()
        if points
    ]
    return {
        "status": "ok", "unit": "百万円",
        "source": nistep_source("1-2-8", "府省庁別の科学技術関係予算の推移（当初予算）"),
        "note": "2001年の省庁再編前後で名称・所掌が変わる（例: 科学技術庁・文部省→文部科学省）。",
        "series": series,
    }


def block_industry_academia() -> dict[str, object]:
    """表1-3-17: 大学等が企業から受け入れた研究費の推移（100万円）."""
    rows = read_sheet(nistep_table("1-3-17"), "xl/worksheets/sheet2.xml")
    columns = {"B": "総額", "D": "国立大学", "F": "公立大学", "H": "私立大学"}
    entries = []
    for index in sorted(row for row in rows if row >= 5):
        year_text = rows[index].get("A", "")
        if not re.fullmatch(r"\d{4}", year_text):
            break
        entry = {"year": int(year_text)}
        for column, label in columns.items():
            value = number(rows[index].get(column))
            if value is not None:
                entry[label] = value
        entries.append(entry)
    return {
        "status": "ok", "unit": "百万円",
        "source": nistep_source("1-3-17", "大学等における内部使用研究費のうち企業から受け入れた金額の推移"),
        "rows": entries,
    }


def block_joint_research() -> dict[str, object]:
    """表5-4-5 (A): 大学等の共同研究・受託研究の受入額推移（千円）."""
    rows = read_sheet(nistep_table("5-4-05"), "xl/worksheets/sheet2.xml")
    data: dict[str, list[list[object]]] = {}
    current: str | None = None
    for index in sorted(rows):
        values = rows[index]
        label = values.get("A", "")
        if label in {"共同研究", "受託研究", "治験等"}:
            current = label
        elif label.startswith(("注", "資料")):
            current = None
        year_text = values.get("B", "")
        if current and re.fullmatch(r"\d{4}", year_text):
            total = number(values.get("L"))
            year = int(year_text)
            series = data.setdefault(current, [])
            if total is not None and all(existing[0] != year for existing in series):
                series.append([year, total])
    return {
        "status": "ok", "unit": "千円",
        "source": nistep_source("5-4-5", "日本の大学等の民間企業等との共同研究等にかかる受入額の推移"),
        "note": "受入額の合計（外国企業・寄附講座等を含む）。原資料は文部科学省 産学連携等実施状況調査。",
        "series": [{"label": name, "values": sorted(points)} for name, points in data.items()],
    }


def block_gov_support_business() -> dict[str, object]:
    """表1-3-10: 企業の研究開発への政府の直接的・間接的支援（対GDP比%）."""
    rows = read_sheet(nistep_table("1-3-10"), "xl/worksheets/sheet2.xml")
    countries = []
    japan_series = []
    for index in sorted(row for row in rows if row >= 7):
        values = rows[index]
        name = values.get("A", "")
        if name and not name.startswith(("注", "資料")):
            direct = number(values.get("B"))
            indirect = number(values.get("C"))
            match = re.match(r"(.+?)\((\d{4})\)", name)
            if match and direct is not None:
                countries.append({"label": match.group(1), "year": int(match.group(2)), "direct": direct, "indirect": indirect or 0})
        year_text = values.get("E", "")
        if re.fullmatch(r"\d{4}", year_text):
            direct = number(values.get("F"))
            indirect = number(values.get("G"))
            if direct is not None:
                japan_series.append({"year": int(year_text), "direct": direct, "indirect": indirect or 0})
    return {
        "status": "ok", "unit": "%",
        "source": nistep_source("1-3-10", "企業の研究開発のための政府による直接的支援・間接的支援"),
        "note": "対GDP比。直接支援=政府負担分の企業研究開発費、間接支援=研究開発税制による控除額。OECD R&D Tax Incentives Database。",
        "countries": countries,
        "japan": sorted(japan_series, key=lambda entry: entry["year"]),
    }


def block_plan_budget() -> dict[str, object]:
    """表1-2-6: 科学技術基本計画の期間ごとの国の科学技術関係予算（億円）."""
    rows = read_sheet(nistep_table("1-2-06"), "xl/worksheets/sheet2.xml")
    entries = []
    period: str | None = None
    header: dict[str, str] = {}
    for index in sorted(rows):
        values = rows[index]
        label = values.get("A", "")
        match = re.search(r"第(\d+)期", label)
        if match and "基本計画" in label:
            period = f"第{match.group(1)}期"
            header = {}
            continue
        if label == "年度":
            header = {column: text for column, text in values.items()}
            continue
        if label.startswith(("注", "資料")):
            period = None
            continue
        if period and header and re.fullmatch(r"\d{4}", label):
            initial = number(values.get("B"))
            regional_column = next((column for column, text in header.items() if "都道府県" in text), None)
            total_column = next((column for column, text in header.items() if text == "合計"), None)
            supplementary = 0.0
            for column, value_text in values.items():
                if column in {"A", "B"} or column == regional_column or column == total_column:
                    continue
                value = number(value_text)
                if value is not None:
                    supplementary += value
            entry = {"period": period, "year": int(label), "initial": initial, "supplementary": round(supplementary, 1)}
            if regional_column:
                regional = number(values.get(regional_column))
                if regional is not None:
                    entry["regional"] = regional
            entries.append(entry)
    return {
        "status": "ok", "unit": "億円",
        "source": nistep_source("1-2-6", "基本計画のもとでの科学技術関係予算の推移"),
        "note": "当初予算と補正予算等（国分）。第2期以降の表にある都道府県・政令指定都市分は別掲し、合計には含めない。",
        "rows": entries,
    }


# --------------------------------------------------------------------- KAKENHI

KAKENHI_INDEX = "https://www.jsps.go.jp/j-grantsinaid/27_kdata/kohyo/index.html"
KAKENHI_FALLBACK_XLSX = "https://www.jsps.go.jp/file/storage/kaken_27_kohyo7-3/3-5_r7.xlsx"


def _column_index(letter: str) -> int:
    value = 0
    for ch in letter:
        value = value * 26 + (ord(ch) - ord("A") + 1)
    return value - 1


def _column_letter(index: int) -> str:
    letters = ""
    index += 1
    while index:
        index, rem = divmod(index - 1, 26)
        letters = chr(ord("A") + rem) + letters
    return letters


def _kakenhi_find_xlsx() -> tuple[str, int]:
    """Discover the latest 3-5 (機関別) xlsx via the kohyo index pages.

    Returns (url, reiwa_year). URLs live in data-linkurl attributes, not href.
    """
    index_html = fetch(KAKENHI_INDEX).decode("utf-8", errors="replace")
    year_pages = sorted(set(re.findall(r"[\w/.\-]*?r(\d{2})_(\d{2})\.html", index_html)), reverse=True)
    seen: set[tuple[str, str]] = set()
    for year, round_no in year_pages:
        if (year, round_no) in seen:
            continue
        seen.add((year, round_no))
        page_url = f"https://www.jsps.go.jp/j-grantsinaid/27_kdata/kohyo/r{year}_{round_no}.html"
        try:
            page_html = fetch(page_url).decode("utf-8", errors="replace")
        except Exception:
            continue
        match = re.search(r"[\"'=,]([^\"'=,]*?3-5_r\d+\.xlsx)", page_html)
        if match:
            url = match.group(1)
            if url.startswith("/"):
                url = f"https://www.jsps.go.jp{url}"
            return url, int(year)
    return KAKENHI_FALLBACK_XLSX, 7


def block_kakenhi() -> dict[str, object]:
    """JSPS 科研費: 研究者が所属する研究機関別の採択件数・配分額（新規+継続）."""
    url, reiwa = _kakenhi_find_xlsx()
    rows = read_sheet(fetch(url), "xl/worksheets/sheet1.xml")
    header_row = None
    name_column = None
    for index in sorted(rows):
        for column, text in rows[index].items():
            if text == "機関名":
                header_row, name_column = index, column
                break
        if header_row:
            break
    if not header_row or not name_column:
        raise ValueError("機関名 header not found")
    base = _column_index(name_column)
    count_col = _column_letter(base + 1)
    total_col = _column_letter(base + 6)
    new_rate_col = _column_letter(base + 12)
    institutions = []
    for index in sorted(row for row in rows if row > header_row):
        values = rows[index]
        name = values.get(name_column, "").strip().rstrip("＊*").strip()
        count = number(values.get(count_col))
        total_yen = number(values.get(total_col))
        if not name or count is None or total_yen is None or name in {"機関名"}:
            continue
        entry = {"label": name, "count": int(count), "amount": round(total_yen / 1000)}  # 円 → 千円
        rate = number(values.get(new_rate_col))
        if rate is not None:
            entry["new_rate"] = rate
        institutions.append(entry)
    if not institutions:
        raise ValueError("no institution rows parsed")
    year = 2018 + reiwa
    total_amount = sum(entry["amount"] for entry in institutions)
    ranked = sorted(institutions, key=lambda entry: -entry["amount"])
    return {
        "status": "ok", "unit": "千円",
        "year_label": f"令和{reiwa}年度（{year}年度）",
        "source": {"title": f"日本学術振興会 科研費データ 研究機関別採択件数・配分額一覧（令和{reiwa}年度）", "url": KAKENHI_INDEX},
        "note": "新規採択＋継続分。配分額は直接経費＋間接経費の合計。機関名の＊（新規応募50件以上）は除去。",
        "institution_count": len(institutions),
        "total_amount": total_amount,
        "rows": ranked[:40],
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
        "funding_flow": run_block("funding_flow", block_funding_flow),
        "gov_spending_dest": run_block("gov_spending_dest", block_gov_spending_dest),
        "ministry_budget": run_block("ministry_budget", block_ministry_budget),
        "industry_academia": run_block("industry_academia", block_industry_academia),
        "joint_research": run_block("joint_research", block_joint_research),
        "gov_support_business": run_block("gov_support_business", block_gov_support_business),
        "plan_budget": run_block("plan_budget", block_plan_budget),
        "kakenhi": run_block("kakenhi", block_kakenhi),
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
