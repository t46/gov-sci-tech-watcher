#!/usr/bin/env python3
"""Build the static observation data used by the analytics page.

The policy layer is calculated from the official update feed. The reality layer
is downloaded from e-Stat's 2025 Science and Technology Research Survey tables.
If the statistics endpoint is temporarily unavailable, the policy layer still
builds and the unavailable statistic is marked honestly in the output.
"""

from __future__ import annotations

import argparse
import json
import re
from collections import Counter, defaultdict
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen
from zipfile import ZipFile
from xml.etree import ElementTree


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data" / "updates.json"
DEFAULT_OUTPUT = ROOT / "data" / "analytics.json"

MONEY_URL = "https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040377600&fileKind=0"
PEOPLE_URL = "https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040377603&fileKind=0"
MONEY_SOURCE_URL = "https://www.e-stat.go.jp/stat-search/files?kikan=00200&layout=dataset&stat_infid=000040377600&toukei=00200543"
PEOPLE_SOURCE_URL = "https://www.e-stat.go.jp/stat-search/files?cycle=0&layout=datalist&lid=000001471830&month=0&page=1&stat_infid=000040377603&tclass1=000001234102&tclass2val=0&toukei=00200543&tstat=000001032090&year=20250"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def fetch_xlsx(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "gov-sci-tech-watcher/1.0 (+https://github.com/)", "Accept": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, */*;q=0.1"})
    with urlopen(request, timeout=45) as response:
        return response.read()


def column_name(reference: str) -> str:
    return re.match(r"[A-Z]+", reference.upper()).group(0)  # type: ignore[union-attr]


def read_first_sheet(blob: bytes) -> list[dict[str, str]]:
    namespace = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    with ZipFile(BytesIO(blob)) as archive:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared_root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in shared_root.findall("m:si", namespace):
                shared.append("".join(node.text or "" for node in item.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t")))
        sheet_root = ElementTree.fromstring(archive.read("xl/worksheets/sheet1.xml"))

    rows: list[dict[str, str]] = []
    for row in sheet_root.findall(".//m:sheetData/m:row", namespace):
        values: dict[str, str] = {}
        for cell in row.findall("m:c", namespace):
            reference = cell.attrib.get("r", "")
            if not reference:
                continue
            value_node = cell.find("m:v", namespace)
            value = "" if value_node is None else value_node.text or ""
            if cell.attrib.get("t") == "s" and value:
                value = shared[int(value)]
            elif cell.attrib.get("t") == "inlineStr":
                value = "".join(node.text or "" for node in cell.iter("{http://schemas.openxmlformats.org/spreadsheetml/2006/main}t"))
            values[column_name(reference)] = value.strip()
        rows.append(values)
    return rows


def number(value: str | None) -> int | float | None:
    if not value or value in {"-", "…", "..."}:
        return None
    try:
        parsed = float(value.replace(",", ""))
    except ValueError:
        return None
    return int(parsed) if parsed.is_integer() else parsed


def records(blob: bytes) -> list[dict[str, str]]:
    return [row for row in read_first_sheet(blob) if row.get("M") and row.get("M") not in {"項目", "総数"}]


def select_rows(blob: bytes, labels: set[str]) -> dict[str, dict[str, str]]:
    selected: dict[str, dict[str, str]] = {}
    for row in records(blob):
        label = row.get("M", "").strip()
        if label in labels and label not in selected:
            selected[label] = row
    return selected


def money_snapshot(blob: bytes) -> list[dict[str, object]]:
    labels = {"企業", "非営利団体", "公的機関", "大学等"}
    rows = select_rows(blob, labels)
    return [
        {
            "name": label,
            "organizations": number(row.get("O")),
            "internal_research_expenditure_million_yen": number(row.get("P")),
            "incoming_research_funds_million_yen": number(row.get("W")),
            "external_research_expenditure_million_yen": number(row.get("X")),
        }
        for label, row in rows.items()
    ]


def people_snapshot(blob: bytes) -> dict[str, object]:
    labels = {"企業", "非営利団体", "公的機関", "大学等"}
    rows = select_rows(blob, labels)
    source_columns = (("企業", "AB"), ("非営利団体", "AD"), ("公的機関", "AE"), ("大学等", "AF"), ("その他", "AG"))
    snapshot_rows = [
        {
            "name": label,
            "recruitment_and_transfer": number(row.get("O")),
            "incoming_researchers": number(row.get("Z")),
            "outgoing_researchers": number(row.get("BH")),
            "incoming_by_source": {source: number(row.get(column)) for source, column in source_columns},
        }
        for label, row in rows.items()
    ]
    links = [
        {"source": source, "target": target, "value": value}
        for target, row in rows.items()
        for source, column in source_columns
        for value in [number(row.get(column))]
        if value is not None and value > 0
    ]
    return {"rows": snapshot_rows, "links": links}


def count_by(items: list[dict[str, object]], key: str) -> list[dict[str, object]]:
    counts = Counter(str(item.get(key) or "未分類") for item in items)
    return [{"label": label, "count": count} for label, count in counts.most_common()]


def build_policy_layer(payload: dict[str, object]) -> dict[str, object]:
    items = [item for item in payload.get("items", []) if isinstance(item, dict)]
    monthly = Counter()
    themes = {
        "AI・デジタル": ("AI", "人工知能", "生成AI", "デジタル", "情報通信"),
        "量子・半導体": ("量子", "半導体", "ポスト5G", "ポスト５G"),
        "宇宙・安全保障": ("宇宙", "安全保障", "経済安全保障"),
        "生命・健康": ("生命", "バイオ", "医療", "健康"),
        "研究基盤・人材": ("大学", "研究者", "研究力", "人材", "研究環境"),
        "予算・資金": ("予算", "概算要求", "補正", "基金", "財源", "投資"),
    }
    theme_counts = Counter()
    dates = []
    for item in items:
        date = str(item.get("published_at") or "")
        match = re.match(r"(\d{4}-\d{2})", date)
        if match:
            monthly[match.group(1)] += 1
            dates.append(date[:10])
        searchable = " ".join(str(item.get(field) or "") for field in ("title", "summary", "category", "document_type", "tags"))
        for theme, terms in themes.items():
            if any(term.lower() in searchable.lower() for term in terms):
                theme_counts[theme] += 1

    monthly_activity = [{"month": month, "count": monthly[month]} for month in sorted(monthly)]
    type_counts = count_by(items, "document_type")
    top_type = type_counts[0]["label"] if type_counts else "公式更新"
    return {
        "item_count": len(items),
        "period": {"from": min(dates) if dates else None, "to": max(dates) if dates else None},
        "category_counts": count_by(items, "category"),
        "document_type_counts": type_counts,
        "source_counts": count_by(items, "source"),
        "theme_counts": [{"label": label, "count": count} for label, count in theme_counts.most_common()],
        "monthly_activity": monthly_activity,
        "insights": [
            f"掲載中の公式更新は{len(items):,}件。文書の役割では「{top_type}」が最多です。",
            "テーマ集計はタイトル・概要・分類語に基づく重複カウントで、影響度や因果関係を示すものではありません。",
        ],
    }


def build_reality_layer() -> dict[str, object]:
    result: dict[str, object] = {
        "survey_year": 2025,
        "money": {"status": "unavailable", "unit": "百万円"},
        "people": {"status": "unavailable", "unit": "人"},
        "sources": [
            {"id": "research-money", "title": "科学技術研究調査 総括表第2表", "url": MONEY_SOURCE_URL, "status": "catalog"},
            {"id": "research-people", "title": "科学技術研究調査 総括表第5表", "url": PEOPLE_SOURCE_URL, "status": "catalog"},
        ],
    }
    try:
        result["money"] = {"status": "ok", "unit": "百万円", "rows": money_snapshot(fetch_xlsx(MONEY_URL))}
    except Exception as exc:
        result["money"]["error"] = str(exc)[:160]  # type: ignore[index]
    try:
        result["people"] = {"status": "ok", "unit": "人", **people_snapshot(fetch_xlsx(PEOPLE_URL))}
    except Exception as exc:
        result["people"]["error"] = str(exc)[:160]  # type: ignore[index]
    for source in result["sources"]:  # type: ignore[union-attr]
        source_id = source["id"]  # type: ignore[index]
        source["status"] = "ok" if (source_id == "research-money" and result["money"]["status"] == "ok") or (source_id == "research-people" and result["people"]["status"] == "ok") else "unavailable"  # type: ignore[index]
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    payload = json.loads(args.input.read_text(encoding="utf-8"))
    output = {
        "schema_version": 1,
        "generated_at": now_iso(),
        "policy": build_policy_layer(payload),
        "reality": build_reality_layer(),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote static analytics to {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
