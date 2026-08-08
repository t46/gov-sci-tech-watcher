#!/usr/bin/env python3
"""Fetch data on money flowing from Japan to academic publishers.

Blocks written to data/publishing.json:
- subscription: 大学図書館の資料費の長期時系列（JUSTICE集計Excel。原典は
  文部科学省「学術情報基盤実態調査」）。実測値。単位: 百万円。
- apc: JUSTICE「論文公表実態調査報告 2025年度」xlsx。日本の責任著者論文の
  APC支払推定額（定価ベース推計。割引・免除・転換契約は未考慮）。単位: 円。
- openalex: data/openalex_apc.json（scripts/estimate_openalex_apc.py の
  一括実行結果）があれば取り込む。独自の定価ベース推計。
- contracts: data/publisher_contracts.json（国立大学法人等の随意契約公表から
  手動検証で収集した契約額）があれば取り込む。網羅ではない。

Every block carries {status, source} so the frontend can state provenance
honestly and degrade gracefully.
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
DEFAULT_OUTPUT = ROOT / "data" / "publishing.json"
OPENALEX_INPUT = ROOT / "data" / "openalex_apc.json"
CONTRACTS_INPUT = ROOT / "data" / "publisher_contracts.json"

USER_AGENT = "Mozilla/5.0 (compatible; gov-sci-tech-watcher/1.0; +https://science-signal.pages.dev/)"

# JUSTICEの公開ファイル。パスは公開年月を含むため、更新時はここを差し替える。
RONBUN_XLSX_URL = "https://contents.nii.ac.jp/sites/default/files/justice/2026-03/2025_ronbunchosa.xlsx"
RONBUN_REPORT_URL = "https://contents.nii.ac.jp/sites/default/files/justice/2026-03/2025_ronbunchosa.pdf"
EXPENDITURE_XLSX_URL = "https://contents.nii.ac.jp/sites/default/files/justice/2026-07/expenditure2026_0.xlsx"
KIBAN_SURVEY_URL = "https://www.mext.go.jp/b_menu/toukei/chousa01/jouhoukiban/1266792.htm"

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _ssl_context():
    try:
        import certifi
        import ssl
    except ImportError:
        return None
    return ssl.create_default_context(cafile=certifi.where())


SSL_CONTEXT = _ssl_context()


def fetch(url: str, timeout: int = 90) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urlopen(request, timeout=timeout, context=SSL_CONTEXT) as response:
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
    """Direct t + rich runs only — phonetic (ruby) runs live under rPh and are
    intentionally excluded (JUSTICEのxlsxはルビ付き)."""
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


def column_index(column: str) -> int:
    value = 0
    for ch in column:
        value = value * 26 + ord(ch) - 64
    return value


# ---------------------------------------------------------------- subscription

SUB_CATEGORIES = {"図書": "books", "雑誌": "journals_print", "電子ジャーナル": "ejournal",
                  "電子書籍": "ebook", "データベース": "database", "その他": "other", "合計": "total"}
SUB_SECTORS = {"全体": "all", "国立": "national", "公立": "public", "私立": "private"}


def subscription_block() -> dict[str, object]:
    blob = fetch(EXPENDITURE_XLSX_URL)
    rows = read_sheet(blob, sheet_paths(blob)["データシート"])

    year_cols: list[tuple[str, int]] = []
    for column, value in rows[1].items():
        year = number(value)
        if isinstance(year, int) and 1970 <= year <= 2100:
            year_cols.append((column, year))
    year_cols.sort(key=lambda item: column_index(item[0]))
    years = [year for _, year in year_cols]

    sectors: dict[str, dict[str, list[int | None]]] = {}
    row_numbers = sorted(rows)
    for idx, row_no in enumerate(row_numbers):
        row = rows[row_no]
        if row.get("C") != "図書":
            continue
        sector_label = row.get("A", "")
        scope_label = row.get("B", "")
        if scope_label != "全体" or sector_label not in SUB_SECTORS:
            continue
        series: dict[str, list[int | None]] = {}
        for offset in range(0, 8):
            member_no = row_numbers[idx + offset] if idx + offset < len(row_numbers) else None
            member = rows.get(member_no, {}) if member_no else {}
            key = SUB_CATEGORIES.get(member.get("C", ""))
            if not key:
                continue
            values: list[int | None] = []
            for column, _ in year_cols:
                raw = number(member.get(column))
                # 千円 → 百万円
                values.append(round(raw / 1000) if isinstance(raw, (int, float)) else None)
            series[key] = values
        if len(series) >= 6:
            sectors[SUB_SECTORS[sector_label]] = series
    if "all" not in sectors or not any(v is not None for v in sectors["all"]["ejournal"]):
        raise ValueError("expenditure sheet: 全体の電子ジャーナル系列を検出できない")

    return {
        "status": "ok",
        "unit": "百万円",
        "years": years,
        "sectors": sectors,
        "source": {
            "title": "大学図書館の資料費の推移（JUSTICE集計。原典: 文部科学省「学術情報基盤実態調査」）",
            "url": EXPENDITURE_XLSX_URL,
            "survey_url": KIBAN_SURVEY_URL,
        },
        "note": "大学図書館経由の支出の調査報告値。研究費から直接支払う費用や病院・研究所の契約は含まない。",
    }


# ------------------------------------------------------------------------ apc

PUBLISHER_SHEETS = {
    "3_2_4Elsevier": "Elsevier",
    "3_2_4Wiley": "Wiley",
    "3_2_4Springer": "Springer",
    "3_2_4MDPI": "MDPI",
    "3_2_4OUP": "OUP",
    "3_2_4SPRINGERNATURE": "Springer Nature",
    "3_2_4T&F": "Taylor & Francis",
    "3_2_4ACS": "ACS",
    "3_2_4Nature": "NPG (Nature)",
    "3_2_4IEEE": "IEEE",
}

PUBLISHER_DISPLAY = {
    "ELSEVIER": "Elsevier",
    "JOHN WILEY & SONS": "Wiley",
    "SPRINGER": "Springer",
    "MDPI AG": "MDPI",
    "OXFORD UNIV PRESS (OUP)": "OUP",
    "SPRINGERNATURE": "Springer Nature",
    "TAYLOR & FRANCIS INC": "Taylor & Francis",
    "AMER CHEMICAL SOC (ACS)": "ACS",
    "NATURE PUBLISHING GROUP (NPG)": "NPG (Nature)",
    "IEEE": "IEEE",
    "その他": "その他",
    "合計": "合計",
}


def _header_years(row: dict[str, str]) -> list[tuple[str, int]]:
    columns: list[tuple[str, int]] = []
    for column, value in row.items():
        match = re.match(r"(\d{4})年?", value)
        if match:
            columns.append((column, int(match.group(1))))
    columns.sort(key=lambda item: column_index(item[0]))
    return columns


def apc_block() -> dict[str, object]:
    blob = fetch(RONBUN_XLSX_URL)
    paths = sheet_paths(blob)

    def sheet(name: str) -> dict[int, dict[str, str]]:
        return read_sheet(blob, paths[name])

    # 3_1_1 公表論文数 / 3_1_2 APC支払推定額
    papers_rows = sheet("3_1_1")
    year_cols = _header_years(papers_rows[2])
    years = [year for _, year in year_cols]
    apc_rows = sheet("3_1_2")
    apc_year_cols = _header_years(apc_rows[2])
    if [y for _, y in apc_year_cols] != years:
        raise ValueError("3_1_1と3_1_2の年ヘッダが一致しない — シート構成が変わった可能性")

    def series_for(rows: dict[int, dict[str, str]], label: str, cols: list[tuple[str, int]]) -> list[int | None]:
        for row in rows.values():
            if row.get("A", "").startswith(label):
                return [number(row.get(column)) for column, _ in cols]
        return [None] * len(cols)

    def unlabeled_total(rows: dict[int, dict[str, str]], cols: list[tuple[str, int]]) -> list[int | None]:
        for row_no in sorted(rows, reverse=True):
            row = rows[row_no]
            if "A" not in row and any(column in row for column, _ in cols):
                return [number(row.get(column)) for column, _ in cols]
        return [None] * len(cols)

    papers = {
        "full": series_for(papers_rows, "フルOA論文", year_cols),
        "hybrid": series_for(papers_rows, "ハイブリッドOA論文", year_cols),
        "bronze": series_for(papers_rows, "ブロンズOA論文", year_cols),
        "closed": series_for(papers_rows, "非OA論文", year_cols),
        "total": unlabeled_total(papers_rows, year_cols),
    }
    apc_yen = {
        "full": series_for(apc_rows, "フルOA論文", apc_year_cols),
        "hybrid": series_for(apc_rows, "ハイブリッドOA論文", apc_year_cols),
        "total": unlabeled_total(apc_rows, apc_year_cols),
    }
    if not apc_yen["total"][-1]:
        raise ValueError("3_1_2: APC合計を検出できない")

    # 3_2_1 出版社別（最新年）
    top_rows = sheet("3_2_1")
    publishers_latest: list[dict[str, object]] = []
    for row_no in sorted(top_rows):
        row = top_rows[row_no]
        name = row.get("B", "")
        if not name or name in {"統制出版社名"}:
            continue
        display = PUBLISHER_DISPLAY.get(name, name)
        entry = {
            "name": display,
            "papers": number(row.get("C")),
            "oa_papers": number(row.get("D")),
            "apc_yen": number(row.get("E")),
        }
        if entry["papers"] is None:
            continue
        publishers_latest.append(entry)

    # 3_2_4* 出版社別の年次推移
    publisher_series: list[dict[str, object]] = []
    for sheet_name, display in PUBLISHER_SHEETS.items():
        if sheet_name not in paths:
            continue
        rows = sheet(sheet_name)
        entries = []
        for row_no in sorted(rows):
            row = rows[row_no]
            match = re.match(r"(\d{4})年?", row.get("A", ""))
            if not match:
                continue
            entries.append({
                "year": int(match.group(1)),
                "papers": number(row.get("C")),
                "full": number(row.get("D")),
                "hybrid": number(row.get("E")),
                "apc_yen": number(row.get("H")),
            })
        if entries:
            publisher_series.append({"name": display, "values": entries})

    # 3_4_1 機関別（最新年 上位20）
    inst_rows = sheet("3_4_1")
    institutions: list[dict[str, object]] = []
    for row_no in sorted(inst_rows):
        row = inst_rows[row_no]
        name = row.get("A", "")
        if not name or "機関名" in name or "公表論文数" in name:
            continue
        papers_count = number(row.get("B"))
        if papers_count is None:
            continue
        institutions.append({
            "name": name,
            "papers": papers_count,
            "full": number(row.get("C")),
            "hybrid": number(row.get("D")),
            "apc_full_yen": number(row.get("F")),
            "apc_hybrid_yen": number(row.get("G")),
        })

    # 3_6_1 助成機関別（最新年）
    funder_rows = sheet("3_6_1")
    funders: list[dict[str, object]] = []
    for row_no in sorted(funder_rows):
        row = funder_rows[row_no]
        name = row.get("A", "")
        if not name or name == "助成機関":
            continue
        papers_count = number(row.get("B"))
        if papers_count is None:
            continue
        funders.append({
            "name": name,
            "papers": papers_count,
            "full": number(row.get("C")),
            "hybrid": number(row.get("D")),
        })

    latest_year = years[-1]
    return {
        "status": "ok",
        "years": years,
        "latest_year": latest_year,
        "papers": papers,
        "apc_yen": apc_yen,
        "publishers_latest": publishers_latest,
        "publisher_series": publisher_series,
        "institutions_latest": institutions,
        "funders_latest": funders,
        "source": {
            "title": "JUSTICE「論文公表実態調査報告 2025年度」",
            "url": RONBUN_REPORT_URL,
            "data_url": RONBUN_XLSX_URL,
        },
        "note": "日本の機関に所属する責任著者の論文（Web of Science収録）×APC定価による推計。割引・免除・転換契約による無償化は反映されない。実支払額ではない。",
    }


# ---------------------------------------------------------------- static input

def optional_input(path: Path, title: str) -> dict[str, object]:
    if not path.exists():
        return {"status": "unavailable", "note": f"{title}は未生成"}
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload.setdefault("status", "ok")
    return payload


def stub_block(title: str, note: str) -> dict[str, object]:
    return {"status": "unavailable", "title": title, "note": note}


def run_block(name: str, builder) -> dict[str, object]:
    try:
        block = builder()
        print(f"[publishing] {name}: ok")
        return block
    except Exception as error:  # noqa: BLE001 — degrade gracefully, keep provenance
        print(f"[publishing] {name}: FAILED — {error}")
        return {"status": "error", "note": str(error)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    payload = {
        "generated_at": now_iso(),
        "subscription": run_block("subscription", subscription_block),
        "apc": run_block("apc", apc_block),
        "openalex": optional_input(OPENALEX_INPUT, "OpenAlex独自推計"),
        "contracts": optional_input(CONTRACTS_INPUT, "契約公表データ"),
    }

    # 一時的な取得失敗で公開済みの正常データを潰さない: 前回ファイルの正常ブロックを保持
    if args.output.exists():
        try:
            previous = json.loads(args.output.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            previous = {}
        for key in ("subscription", "apc"):
            if payload[key].get("status") != "ok" and previous.get(key, {}).get("status") == "ok":
                kept = previous[key]
                kept["note"] = f"{kept.get('note', '')} 直近の取得に失敗したため前回取得値を表示。".strip()
                payload[key] = kept
                print(f"[publishing] {key}: kept previous ok block")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"[publishing] wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
