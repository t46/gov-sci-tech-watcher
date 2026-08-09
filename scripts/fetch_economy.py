#!/usr/bin/env python3
"""Fetch long-term economic measuring-stick series shared across the atlas.

Currently implemented:
- cpi: 消費者物価指数（全国・総合・2020年基準）e-Stat 長期時系列xlsxの直リンクから
  年平均（暦年）・年度平均を取得。
- fx_usdjpy: 円ドル相場（年平均）。World Bank API（認証不要）。1960〜。

Planned blocks (added as sources are verified): gdp — 内閣府SNAの長期系列は基準改定
のたびに断絶しており、同一基準で1970年代〜現在を一貫してつなぐ公式系列が存在しない
（内閣府ESRI FAQで確認済み）ため見送り。出力はブロック構造（{cpi: {...}, fx_usdjpy:
{...}, ...}）のままなので、系列を接続する目処が立てば追加できる。

Every block carries {status, source, unit, note} so the frontend can state
provenance honestly and degrade gracefully when a source is unavailable. On
fetch failure, the previous file's ok block is kept rather than overwritten
with an empty one.
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
DEFAULT_OUTPUT = ROOT / "data" / "economy.json"

USER_AGENT = "gov-sci-tech-watcher/1.0 (+https://science-signal.pages.dev/)"

# 総務省統計局「消費者物価指数 2020年基準」付表１－１ 長期時系列指数（全国）
# e-Stat file-download 直リンク（xlsx、認証不要、実アクセス確認済み — scratchpad調査メモ参照）
CPI_URL = "https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040430855&fileKind=0"
CPI_SHEET_TITLE = "総務省統計局「消費者物価指数 2020年基準」付表１－１ 長期時系列指数（全国）"
CPI_SHEET_PAGE = "https://www.stat.go.jp/data/cpi/1.html"

# World Bank「公的為替レート（LCU per US$、期間平均）」— 認証不要、実アクセス確認済み
FX_URL = "https://api.worldbank.org/v2/country/JPN/indicator/PA.NUS.FCRF?format=json&per_page=100"
FX_TITLE = "World Bank「Official exchange rate, LCU per US$, period average」（日本・円/ドル）"
FX_PAGE = "https://data.worldbank.org/indicator/PA.NUS.FCRF?locations=JP"

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def fetch(url: str, timeout: int = 60) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urlopen(request, timeout=timeout) as response:
        return response.read()


def number(value: str | None) -> float | None:
    if not value or value.strip() in {"-", "…", "...", "n.a.", "NA", "*"}:
        return None
    try:
        parsed = float(value.replace(",", ""))
    except ValueError:
        return None
    return round(parsed, 2)


# ---------------------------------------------------------------- xlsx parsing (shared shape with fetch_indicators.py)

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


def block_cpi() -> dict[str, object]:
    """付表１－１ 長期時系列指数（全国）: 総合、2020年=100。列B=年、O=年平均（暦年）、P=年度平均。"""
    rows = read_sheet(fetch(CPI_URL), "xl/worksheets/sheet1.xml")
    calendar_year: list[list[object]] = []
    fiscal_year: list[list[object]] = []
    for index in sorted(rows):
        values = rows[index]
        year_text = values.get("B", "")
        match = re.match(r"(\d{4})", year_text)
        if not match:
            continue
        year = int(match.group(1))
        cy = number(values.get("O"))
        fy = number(values.get("P"))
        if cy is not None:
            calendar_year.append([year, cy])
        if fy is not None:
            fiscal_year.append([year, fy])
    if not calendar_year:
        raise ValueError("no CPI rows parsed")
    return {
        "status": "ok",
        "unit": "指数（2020年=100）",
        "base_year": 2020,
        "year_range": [calendar_year[0][0], calendar_year[-1][0]],
        "source": {"title": CPI_SHEET_TITLE, "url": CPI_SHEET_PAGE},
        "note": "全国・総合。暦年（1〜12月）平均と年度（4月〜翌3月）平均の両方を保持。直近年は年度平均が未確定のため欠落することがある。",
        "calendar_year": calendar_year,
        "fiscal_year": fiscal_year,
    }


def block_fx_usdjpy() -> dict[str, object]:
    """年平均 円/ドル相場。World Bank API（json）、1960年〜。"""
    payload = json.loads(fetch(FX_URL).decode("utf-8"))
    records = payload[1] if isinstance(payload, list) and len(payload) > 1 else []
    series: list[list[object]] = []
    for record in records:
        year_text = record.get("date", "")
        value = record.get("value")
        if re.fullmatch(r"\d{4}", year_text) and value is not None:
            series.append([int(year_text), round(float(value), 2)])
    series.sort(key=lambda pair: pair[0])
    if not series:
        raise ValueError("no FX rows parsed")
    return {
        "status": "ok",
        "unit": "円/ドル（年平均）",
        "year_range": [series[0][0], series[-1][0]],
        "source": {"title": FX_TITLE, "url": FX_PAGE},
        "note": "期間平均（year average）の公的為替レート。1960〜1970年は固定相場（1ドル=360円）、1971年は変動相場への移行年。",
        "calendar_year": series,
    }


def run_block(name: str, builder) -> dict[str, object]:
    try:
        block = builder()
        print(f"[economy] {name}: ok")
        return block
    except Exception as error:  # noqa: BLE001 — degrade gracefully, keep provenance
        print(f"[economy] {name}: FAILED — {error}")
        return {"status": "error", "note": str(error)[:200]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    payload: dict[str, object] = {
        "schema_version": 1,
        "generated_at": now_iso(),
        "cpi": run_block("cpi", block_cpi),
        "fx_usdjpy": run_block("fx_usdjpy", block_fx_usdjpy),
    }

    # 一時的な取得失敗で公開済みの正常データを潰さない: 前回ファイルの正常ブロックを保持
    if args.output.exists():
        try:
            previous = json.loads(args.output.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            previous = {}
        for key in ("cpi", "fx_usdjpy"):
            if payload[key].get("status") != "ok" and previous.get(key, {}).get("status") == "ok":
                kept = previous[key]
                kept["note"] = f"{kept.get('note', '')} 直近の取得に失敗したため前回取得値を表示。".strip()
                payload[key] = kept
                print(f"[economy] {key}: kept previous ok block")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"[economy] wrote {args.output} ({args.output.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
