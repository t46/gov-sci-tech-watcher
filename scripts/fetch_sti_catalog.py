#!/usr/bin/env python3
"""Build a searchable catalog of every table in NISTEP Science and Technology Indicators 2026."""

from __future__ import annotations

import json
import re
import urllib.request
from datetime import date
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin


ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / "data" / "science_technology_indicator_catalog.json"
SOURCE_URL = "https://www.nistep.go.jp/sti_indicator/2026/NR212_table.html"


class CatalogParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.chapter = ""
        self.in_heading = False
        self.in_row = False
        self.in_cell = False
        self.in_link = False
        self.cell = []
        self.row = []
        self.href = ""
        self.items = []

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "h5":
            self.in_heading = True
        elif tag == "tr":
            self.in_row = True
            self.row = []
        elif tag == "td" and self.in_row:
            self.in_cell = True
            self.cell = []
        elif tag == "a" and self.in_cell:
            self.in_link = True
            self.href = attrs.get("href", "")

    def handle_endtag(self, tag):
        if tag == "h5":
            self.in_heading = False
        elif tag == "a":
            self.in_link = False
        elif tag == "td" and self.in_cell:
            text = " ".join("".join(self.cell).split())
            self.row.append({"text": text, "href": self.href})
            self.cell = []
            self.href = ""
            self.in_cell = False
        elif tag == "tr" and self.in_row:
            self.in_row = False
            values = [item["text"] for item in self.row]
            if len(values) >= 2 and re.fullmatch(r"(?:[1-5]-\d+-\d+|\d+-\d+)", values[0]):
                excel = next((item["href"] for item in self.row if item["href"].endswith(".xlsx")), "")
                number = values[0]
                self.items.append({
                    "number": number,
                    "title": values[1],
                    "chapter": self.chapter,
                    "kind": "indicator" if re.fullmatch(r"[1-5]-\d+-\d+", number) else "column",
                    "excel_url": urljoin(SOURCE_URL, excel) if excel else "",
                })

    def handle_data(self, data):
        if self.in_heading:
            text = " ".join(data.split())
            if text:
                self.chapter = text
        elif self.in_cell:
            self.cell.append(data)


def main():
    request = urllib.request.Request(SOURCE_URL, headers={"User-Agent": "science-signal/1.0"})
    with urllib.request.urlopen(request, timeout=60) as response:
        parser = CatalogParser()
        parser.feed(response.read().decode("utf-8", "replace"))
    items = parser.items
    indicators = [item for item in items if item["kind"] == "indicator"]
    payload = {
        "status": "ok",
        "edition": "科学技術指標2026",
        "report_number": "NISTEP REPORT No.212",
        "collected_at": date.today().isoformat(),
        "source": {"title": "NISTEP 科学技術指標2026 統計集（HTML版）", "url": SOURCE_URL, "report_url": "https://doi.org/10.15108/nr212"},
        "indicator_count": len(indicators),
        "table_count": len(items),
        "chapters": [
            {"number": 1, "title": "研究開発費", "page": "money.html"},
            {"number": 2, "title": "研究開発人材", "page": "people.html"},
            {"number": 3, "title": "高等教育と科学技術人材", "page": "people.html"},
            {"number": 4, "title": "研究開発のアウトプット", "page": "papers.html"},
            {"number": 5, "title": "科学技術とイノベーション", "page": "money.html"},
            {"number": 0, "title": "コラム", "page": "policy.html"},
        ],
        "items": items,
        "note": "指標本体とコラムを含むNISTEP統計集の表カタログ。タイトル・表番号・原典Excelへのリンクを掲載。本文中の約160指標はindicator_countに対応し、コラムは別種別として収録。",
    }
    OUT.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(f"wrote {OUT} ({len(indicators)} indicators, {len(items)} tables)")


if __name__ == "__main__":
    main()
