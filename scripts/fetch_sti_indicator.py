#!/usr/bin/env python3
"""Fetch comparable long-run series from NISTEP's Science and Technology Indicators 2026."""

from __future__ import annotations

import json
import re
import urllib.request
import zipfile
from datetime import date
from io import BytesIO
from pathlib import Path
from xml.etree import ElementTree as ET


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "science_technology_indicators.json"
BASE = "https://www.nistep.go.jp/sti_indicator/2026/hyoudata/"
NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def cell_value(c, shared_strings):
    value = c.find("m:v", NS)
    if value is None:
        return ""
    text = value.text or ""
    if c.attrib.get("t") == "s" and text:
        return shared_strings[int(text)]
    return text


def read_sheet(filename, sheet_number=2):
    url = BASE + filename
    request = urllib.request.Request(url, headers={"User-Agent": "science-signal/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        workbook = BytesIO(response.read())
    with zipfile.ZipFile(workbook) as archive:
        shared_root = ET.fromstring(archive.read("xl/sharedStrings.xml"))
        shared = [
            "".join(t.text or "" for t in si.iter("{%s}t" % NS["m"]))
            for si in shared_root.findall("m:si", NS)
        ]
        sheet = ET.fromstring(archive.read(f"xl/worksheets/sheet{sheet_number}.xml"))
        rows = []
        for row in sheet.findall(".//m:sheetData/m:row", NS):
            values = {}
            for cell in row.findall("m:c", NS):
                values[cell.attrib["r"]] = cell_value(cell, shared)
            rows.append(values)
        return rows, url


def number(value):
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def rows_with_year(rows, year_cell_pattern):
    result = []
    for row in rows:
        year = next((value for cell, value in row.items() if re.fullmatch(year_cell_pattern, cell)), "")
        if year.isdigit():
            result.append((int(year), row))
    return result


def r_and_d_intensity():
    rows, url = read_sheet("STI2026_1-1-03.xlsx")
    fields = {
        "Japan": "B",
        "United States": "F",
        "Germany": "H",
        "France": "J",
        "United Kingdom": "L",
        "China": "N",
        "Korea": "P",
    }
    values = []
    for year, row in rows_with_year(rows, r"A\d+"):
        if year < 1991:
            continue
        values.append({"year": year, **{name: number(row.get(f"{column}{next(k for k in range(1, 100) if row.get(f'A{k}') == str(year))}", "")) for name, column in fields.items()}})
    return {"unit": "% of GDP", "years": values, "source_url": url, "table": "1-1-3"}


def researchers():
    rows, url = read_sheet("STI2026_2-1-03.xlsx")
    fields = {
        "Japan": "D",
        "United States": "H",
        "Germany": "J",
        "France": "L",
        "United Kingdom": "N",
        "China": "P",
        "Korea": "R",
    }
    values = []
    for year, row in rows_with_year(rows, r"A\d+"):
        if year < 1991:
            continue
        row_number = next(k for k in range(1, 100) if row.get(f"A{k}") == str(year))
        values.append({"year": year, **{name: number(row.get(f"{column}{row_number}", "")) for name, column in fields.items()}})
    return {"unit": "researchers", "years": values, "source_url": url, "table": "2-1-3", "note": "Japan is HC (headcount); other countries follow the table's international series."}


def paper_shares():
    rows, url = read_sheet("STI2026_4-1-07.xlsx")
    values = []
    for year, row in rows_with_year(rows, r"A\d+"):
        if year < 1991:
            continue
        row_number = next(k for k in range(1, 100) if row.get(f"A{k}") == str(year))
        values.append({
            "year": year,
            "Japan": number(row.get(f"B{row_number}")),
            "JapanTop10": number(row.get(f"J{row_number}")),
            "JapanTop1": number(row.get(f"R{row_number}")),
            "China": number(row.get(f"G{row_number}")),
        })
    return {"unit": "% of world share", "years": values, "source_url": url, "table": "4-1-7", "note": "3-year moving average, integer count; the latest moving-average year is 2023."}


def main():
    payload = {
        "status": "ok",
        "edition": "科学技術指標2026",
        "report_number": "NISTEP REPORT No.212",
        "collected_at": date.today().isoformat(),
        "source": {
            "title": "NISTEP 科学技術指標2026 統計集（HTML版）",
            "url": "https://www.nistep.go.jp/sti_indicator/2026/NR212_table.html",
            "report_url": "https://doi.org/10.15108/nr212",
        },
        "series": {
            "rd_intensity": r_and_d_intensity(),
            "researchers": researchers(),
            "paper_shares": paper_shares(),
        },
        "method_note": "科学技術指標2026の統計集から、1991年以降の比較可能な系列を再取得。各年版で定義・推計方法・データベースの更新により過去値が改訂され得るため、過去版の公表値との単純比較には注意が必要。",
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {OUT}")


if __name__ == "__main__":
    main()
