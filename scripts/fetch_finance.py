#!/usr/bin/env python3
"""Fetch standardized financial statements of Japan's research organizations.

Currently implemented:
- national: 国立大学法人 92法人 × 6年度 — NIADの法人別概要財務諸表Excel
  （貸借対照表・損益計算書）を1ファイルで取得し、主要指標に絞って保存する。

Planned blocks (added as their sources are verified): private (学校法人),
institutes (国立研究開発法人).

Every block carries {status, unit, source} so the frontend can state
provenance honestly and degrade gracefully.
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen
from xml.etree import ElementTree
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "finance.json"

USER_AGENT = "Mozilla/5.0 (compatible; gov-sci-tech-watcher/1.0; +https://science-signal.pages.dev/)"
NIAD_LANDING = "https://www.niad.ac.jp/support/university_finance/"

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def fetch(url: str, timeout: int = 90) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urlopen(request, timeout=timeout) as response:
        return response.read()


def number(value: str | None) -> int | float | None:
    if not value or value.strip() in {"-", "…", "..."}:
        return None
    try:
        parsed = float(value.replace(",", ""))
    except ValueError:
        return None
    return int(parsed) if parsed.is_integer() and abs(parsed) < 1e15 else round(parsed, 2)


# ---------------------------------------------------------------- xlsx parsing

def _shared_strings(archive: ZipFile) -> list[str]:
    strings: list[str] = []
    if "xl/sharedStrings.xml" not in archive.namelist():
        return strings
    root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
    for item in root.findall("m:si", NS):
        parts: list[str] = []
        direct = item.find("m:t", NS)
        if direct is not None:
            parts.append(direct.text or "")
        for run in item.findall("m:r", NS):
            text = run.find("m:t", NS)
            if text is not None:
                parts.append(text.text or "")
        strings.append("".join(parts))
    return strings


def sheet_paths(blob: bytes) -> dict[str, str]:
    with ZipFile(BytesIO(blob)) as archive:
        workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
        rels = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    targets = {rel.get("Id"): rel.get("Target") for rel in rels}
    paths: dict[str, str] = {}
    for sheet in workbook.findall(".//m:sheet", NS):
        target = targets.get(sheet.get(REL), "")
        if target and not target.startswith("/"):
            target = f"xl/{target}"
        paths[sheet.get("name", "")] = target
    return paths


def read_sheet(blob: bytes, sheet_path: str) -> dict[int, dict[str, str]]:
    with ZipFile(BytesIO(blob)) as archive:
        shared = _shared_strings(archive)
        sheet_root = ElementTree.fromstring(archive.read(sheet_path))
    rows: dict[int, dict[str, str]] = {}
    for row in sheet_root.findall(".//m:sheetData/m:row", NS):
        values: dict[str, str] = {}
        for cell in row.findall("m:c", NS):
            value_node = cell.find("m:v", NS)
            value = "" if value_node is None else value_node.text or ""
            if cell.attrib.get("t") == "s" and value:
                value = shared[int(value)]
            column = "".join(ch for ch in cell.attrib.get("r", "") if ch.isalpha())
            if value.strip():
                values[column] = value.strip()
        if values:
            rows[int(row.attrib["r"])] = values
    return rows


def era_year(label: str) -> int | None:
    match = re.fullmatch(r"([HR])(\d+)", label)
    if not match:
        return None
    era, value = match.group(1), int(match.group(2))
    return (2018 if era == "R" else 1988) + value


# ------------------------------------------------------------------- national

PL_METRICS = {
    "経常収益": {
        "運営費交付金収益": "grants",
        "授業料収益": "tuition_lecture",
        "入学金収益": "tuition_admission",
        "検定料収益": "tuition_exam",
        "附属病院収益": "hospital",
        "受託研究収益": "commissioned",
        "共同研究収益": "joint",
        "寄附金収益": "donations",
        "補助金等収益": "subsidies",
        "経常収益合計": "revenue_total",
    },
    "経常費用": {
        "教育経費": "education",
        "研究経費": "research",
        "教職員人件費等": "personnel",
        "一般管理費": "admin",
        "経常費用合計": "expense_total",
    },
}
SECTION_LABELS = {"経常費用", "経常収益", "臨時損失", "臨時利益"}


def national_block() -> dict[str, object]:
    landing = fetch(NIAD_LANDING).decode("utf-8", errors="replace")
    url = None
    for anchor_match in re.finditer(r'<a[^>]+href="\s*([^"\s]+)\s*"[^>]*>(.*?)</a>', landing, re.S):
        if "法人別概要財務諸表" in re.sub(r"<[^>]+>", "", anchor_match.group(2)):
            url = anchor_match.group(1)
            break
    if not url:
        raise ValueError("NIAD 法人別概要財務諸表 link not found on landing page")
    blob = fetch(url)
    paths = sheet_paths(blob)
    pl = read_sheet(blob, paths["PL"])
    bs = read_sheet(blob, paths["BS_資産"])

    def header_columns(rows: dict[int, dict[str, str]]) -> list[tuple[str, int, str, str]]:
        """[(column, year, corp_id, corp_name)] from the 3 header rows."""
        columns = []
        for column, name in rows.get(3, {}).items():
            if column == "A" or not name:
                continue
            year = era_year(rows.get(1, {}).get(column, ""))
            corp_id = rows.get(2, {}).get(column, "")
            if year and corp_id:
                columns.append((column, year, corp_id, name))
        return columns

    def metric_rows(rows: dict[int, dict[str, str]]) -> dict[str, int]:
        """Map metric key -> row number, honouring the PL section a label sits in."""
        located: dict[str, int] = {}
        section = ""
        for index in sorted(rows):
            label = "".join(rows[index].get(column, "") for column in ("A", "B", "C")).strip()
            if not label:
                continue
            if label in SECTION_LABELS:
                section = label
                continue
            key = PL_METRICS.get(section, {}).get(label)
            if key and key not in located:
                located[key] = index
        return located

    pl_columns = header_columns(pl)
    located = metric_rows(pl)
    missing = [key for section in PL_METRICS.values() for key in section.values() if key not in located]
    if missing:
        raise ValueError(f"PL rows not located: {missing}")
    assets_row = next((index for index in sorted(bs) if "".join(bs[index].get(c, "") for c in ("A", "B", "C")).strip() == "資産の部合計"), None)
    if not assets_row:
        raise ValueError("BS 資産の部合計 row not found")
    net_row = next((index for index in sorted(pl) if "当期総利益" in "".join(pl[index].get(c, "") for c in ("A", "B", "C"))), None)

    corporations: dict[str, dict[str, object]] = {}
    years_seen: set[int] = set()
    for column, year, corp_id, name in pl_columns:
        corp = corporations.setdefault(corp_id, {"id": corp_id, "label": name, "values": {}})
        corp["label"] = name  # latest edition name wins
        entry: dict[str, object] = {}
        for key, row_index in located.items():
            value = number(pl.get(row_index, {}).get(column))
            if value is not None:
                entry[key] = value
        if net_row:
            net = number(pl.get(net_row, {}).get(column))
            if net is not None:
                entry["net"] = net
        tuition = sum(entry.pop(part, 0) or 0 for part in ("tuition_lecture", "tuition_admission", "tuition_exam"))
        if tuition:
            entry["tuition"] = tuition
        if entry:
            corp["values"][year] = entry  # type: ignore[index]
            years_seen.add(year)

    bs_columns = {(corp_id, year): column for column, year, corp_id, _name in header_columns(bs)}
    for corp in corporations.values():
        for year, entry in corp["values"].items():  # type: ignore[union-attr]
            column = bs_columns.get((corp["id"], year))
            if column:
                assets = number(bs.get(assets_row, {}).get(column))
                if assets is not None:
                    entry["assets"] = assets

    years = sorted(years_seen)
    metric_keys = ["revenue_total", "grants", "tuition", "hospital", "commissioned", "joint", "donations", "subsidies", "expense_total", "personnel", "research", "education", "admin", "net", "assets"]
    compact = []
    for corp in sorted(corporations.values(), key=lambda c: c["id"]):
        metrics = {}
        for key in metric_keys:
            row = [corp["values"].get(year, {}).get(key) for year in years]  # type: ignore[union-attr]
            if any(value is not None for value in row):
                metrics[key] = row
        compact.append({"id": corp["id"], "label": corp["label"], "metrics": metrics})

    return {
        "status": "ok", "unit": "千円",
        "source": {"title": "大学改革支援・学位授与機構 国立大学法人等 法人別概要財務諸表と財務比率", "url": NIAD_LANDING},
        "note": "国立大学法人会計基準に基づく法人別の損益計算書・貸借対照表。学生納付金=授業料+入学金+検定料。",
        "file_url": url,
        "years": years,
        "corporations": compact,
    }


# ------------------------------------------------------------------ institutes

def pdf_text(blob: bytes) -> str:
    from pypdf import PdfReader  # lazy import; only needed for institute PDFs

    reader = PdfReader(BytesIO(blob))
    pages = []
    for page in reader.pages:
        try:
            pages.append(page.extract_text() or "")
        except Exception:  # noqa: BLE001 — skip unreadable pages
            pages.append("")
    return "\n".join(pages)


def repair_shifted_ascii(text: str) -> str:
    """Fix PDFs whose ASCII range is shifted by +0x3DFE (e.g. JAMSTEC)."""
    if not re.search(r"[㸮-㸷]", text):
        return text
    return "".join(chr(ord(ch) - 0x3DFE) if 0x3E1E <= ord(ch) <= 0x3E7C else ch for ch in text)


def pdf_metric(text: str, label: str, line_start: bool = False) -> int | None:
    """First occurrence of `label` followed by a number, whitespace-insensitive.

    line_start=True anchors the label to a line head — needed for labels that
    are substrings of longer ones (資産合計 inside 流動資産合計).
    """
    despaced = re.sub(r"[ \t　]", "", repair_shifted_ascii(text))
    anchor = r"^" if line_start else ""
    pattern = anchor + re.escape(label) + r"[^0-9△▲\-]{0,20}?([△▲\-]?[0-9][0-9,]*)"
    match = re.search(pattern, despaced, re.M)
    if not match:
        return None
    raw = match.group(1)
    negative = raw[0] in "△▲-"
    value = int(raw.lstrip("△▲-").replace(",", ""))
    return -value if negative else value


INSTITUTE_METRICS = {
    "revenue_total": ("経常収益合計", False),
    "expense_total": ("経常費用合計", False),
    "grants": ("運営費交付金収益", False),
    "assets": ("資産合計", True),  # 行頭固定 — 流動資産合計等への誤マッチを防ぐ
}

INSTITUTES = [
    {
        "id": "riken", "label": "理化学研究所",
        "index": "https://www.riken.jp/about/disclosure/zaigen/",
        "template": "https://www.riken.jp/medialibrary/riken/about/info/zaigen/zaimu-{year}-1.pdf",
        "years": list(range(2019, 2026)),
        "extra": {"subsidies": "研究補助金収益", "donations": "寄附金収益"},
    },
    {
        "id": "aist", "label": "産業技術総合研究所",
        "index": "https://www.aist.go.jp/aist_j/information/outline/zaimu/index.html",
        "template": "https://www.aist.go.jp/pdf/aist_j/zaimu/r{reiwa}kakutei.pdf",
        "years": list(range(2019, 2026)),
        "extra": {"research_revenue": "研究収益", "ip_revenue": "知的所有権収益"},
    },
]


def institutes_block() -> dict[str, object]:
    results = []
    for config in INSTITUTES:
        values: dict[int, dict[str, int]] = {}
        for year in config["years"]:
            url = config["template"].format(year=year, reiwa=year - 2018)
            text = None
            for _attempt in range(2):
                try:
                    text = pdf_text(fetch(url))
                    break
                except Exception:
                    continue
            if text is None:
                continue
            entry: dict[str, int] = {}
            specs = {**INSTITUTE_METRICS, **{key: (label, False) for key, label in config.get("extra", {}).items()}}
            for key, (label, line_start) in specs.items():
                value = pdf_metric(text, label, line_start)
                if value is not None:
                    entry[key] = value
            if entry.get("revenue_total"):
                values[year] = entry
        if values:
            results.append({"id": config["id"], "label": config["label"], "index_url": config["index"], "values": values})
    if not results:
        raise ValueError("no institute statements parsed")
    return {
        "status": "ok", "unit": "円",
        "source": {"title": "国立研究開発法人 財務諸表（各法人の公式開示）", "url": "https://www.riken.jp/about/disclosure/zaigen/"},
        "note": "独立行政法人会計基準に基づく損益計算書・貸借対照表から抽出。運営費交付金は損益計算書の収益化額（交付額とは異なる）。",
        "institutes": results,
    }


def stub_block(title: str, url: str, note: str) -> dict[str, object]:
    return {"status": "unavailable", "unit": None, "source": {"title": title, "url": url}, "note": note}


def run_block(name: str, builder) -> dict[str, object]:
    try:
        block = builder()
        print(f"  ok      {name}")
        return block
    except Exception as exc:  # noqa: BLE001
        print(f"  failed  {name}: {exc}")
        return {"status": "unavailable", "error": str(exc)[:200]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()
    print("Fetching finance blocks:")
    output = {
        "schema_version": 1,
        "generated_at": now_iso(),
        "national": run_block("national", national_block),
        "private": stub_block("学校法人（私立大学）事業活動収支", "https://www.shigaku.go.jp/", "私立大学の財務データは接続作業中。"),
        "institutes": run_block("institutes", institutes_block),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(output, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"Wrote {args.output} ({args.output.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
