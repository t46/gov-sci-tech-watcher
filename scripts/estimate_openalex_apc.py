#!/usr/bin/env python3
"""Estimate APCs for Japan-corresponding-author papers from OpenAlex.

One-shot local batch (not part of the scheduled refresh):
    uv run python scripts/estimate_openalex_apc.py

Method:
- works filtered to authorships.countries:JP × publication_year × oa_status
  (gold / hybrid のみ。diamondはAPC=0、green/bronze/closedは支払なしとして扱う)
- クライアント側で「責任著者に日本の所属を含む」論文だけを残す
  （OpenAlexのフィルタは authorships.countries と is_corresponding を
  同一著者に結合できないため、サーバ側では判定できない）
- 責任著者情報が無い論文は筆頭著者の国で代替し、件数を別記する
- APCは apc_list（DOAJ由来の定価USD）を年平均為替で円換算した定価ベース推計。
  実支払額ではない（割引・免除・転換契約は反映されない）。
- 出版社は host_organization_lineage_names の最上位に正規化
  （例: BioMed Central → Springer Nature）

Writes data/openalex_apc.json, which scripts/fetch_publishing.py merges into
data/publishing.json on its next run.
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.parse
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "openalex_apc.json"

API = "https://api.openalex.org/works"
MAILTO = "takagi4646@gmail.com"
API_KEY = os.environ.get("OPENALEX_API_KEY", "")
USER_AGENT = "gov-sci-tech-watcher/1.0 (+https://science-signal.pages.dev/)"
YEARS = list(range(2019, 2025))
STATUSES = ("gold", "hybrid")
SELECT = "publication_year,authorships,open_access,apc_list,primary_location"

# 年平均為替（USD/JPY, IMF公表の年平均レートの概数）
USDJPY = {2019: 109.0, 2020: 106.8, 2021: 109.8, 2022: 131.5, 2023: 140.5, 2024: 151.4}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def get_json(url: str, retries: int = 6) -> dict:
    delay = 2.0
    for attempt in range(retries):
        try:
            request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urlopen(request, timeout=120) as response:
                return json.loads(response.read())
        except (HTTPError, URLError, TimeoutError) as error:
            code = getattr(error, "code", None)
            if attempt == retries - 1:
                raise
            wait = delay if code in (429, 500, 502, 503) or code is None else delay / 2
            print(f"  retry {attempt + 1} ({error}) — wait {wait:.0f}s")
            time.sleep(wait)
            delay *= 1.8
    raise RuntimeError("unreachable")


def jp_corresponding(work: dict) -> tuple[bool, bool]:
    """(責任著者=日本か, 筆頭著者フォールバックを使ったか)"""
    authorships = work.get("authorships") or []
    corr = [a for a in authorships if a.get("is_corresponding")]
    if corr:
        return any("JP" in (a.get("countries") or []) for a in corr), False
    first = [a for a in authorships if a.get("author_position") == "first"]
    return any("JP" in (a.get("countries") or []) for a in first), True


def top_publisher(work: dict) -> str:
    source = (work.get("primary_location") or {}).get("source") or {}
    lineage = source.get("host_organization_lineage_names") or []
    if lineage:
        return lineage[-1]
    return source.get("host_organization_name") or "不明"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    series: dict[str, dict[int, dict[str, float]]] = {s: defaultdict(lambda: defaultdict(float)) for s in STATUSES}
    publishers: dict[str, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    publisher_papers: dict[str, int] = defaultdict(int)
    requests_made = 0

    for year in YEARS:
        for status in STATUSES:
            cursor = "*"
            page = 0
            while cursor:
                params = {
                    "filter": f"authorships.countries:JP,publication_year:{year},open_access.oa_status:{status}",
                    "per-page": "200",
                    "cursor": cursor,
                    "select": SELECT,
                    "mailto": MAILTO,
                }
                if API_KEY:
                    params["api_key"] = API_KEY
                payload = get_json(f"{API}?{urllib.parse.urlencode(params)}")
                requests_made += 1
                page += 1
                cursor = (payload.get("meta") or {}).get("next_cursor")
                for work in payload.get("results", []):
                    is_jp, used_fallback = jp_corresponding(work)
                    if not is_jp:
                        continue
                    bucket = series[status][year]
                    bucket["papers"] += 1
                    if used_fallback:
                        bucket["fallback"] += 1
                    apc = work.get("apc_list") or {}
                    usd = apc.get("value_usd")
                    if usd:
                        bucket["priced"] += 1
                        jpy = usd * USDJPY[year]
                        bucket["apc_jpy"] += jpy
                        name = top_publisher(work)
                        publishers[name][year] += jpy
                        publisher_papers[name] += 1
                if page % 20 == 0:
                    print(f"[openalex] {year} {status}: page {page} (papers so far {int(series[status][year]['papers'])})")
                time.sleep(0.05 if API_KEY else 0.12)
            print(f"[openalex] {year} {status}: done — jp-corr papers {int(series[status][year]['papers'])}, "
                  f"priced {int(series[status][year]['priced'])}, apc {series[status][year]['apc_jpy'] / 1e8:.1f}億円")

    top = sorted(publishers.items(), key=lambda item: -sum(item[1].values()))[:15]
    payload = {
        "status": "ok",
        "generated_at": now_iso(),
        "years": YEARS,
        "usdjpy": USDJPY,
        "requests": requests_made,
        "series": {
            status: {
                "papers": [int(series[status][y]["papers"]) for y in YEARS],
                "priced": [int(series[status][y]["priced"]) for y in YEARS],
                "fallback": [int(series[status][y]["fallback"]) for y in YEARS],
                "apc_yen": [round(series[status][y]["apc_jpy"]) for y in YEARS],
            }
            for status in STATUSES
        },
        "total_yen": [round(series["gold"][y]["apc_jpy"] + series["hybrid"][y]["apc_jpy"]) for y in YEARS],
        "publishers": [
            {"name": name, "papers": publisher_papers[name], "apc_yen": [round(values.get(y, 0)) for y in YEARS]}
            for name, values in top
        ],
        "source": {"title": "OpenAlex API（CC0）", "url": "https://openalex.org/"},
        "note": "責任著者に日本の所属を含む論文（gold/hybrid）× apc_list定価（USD）× 年平均為替。定価ベース推計であり実支払額ではない。責任著者情報の無い論文は筆頭著者の国で代替。",
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"[openalex] wrote {args.output} ({requests_made} requests)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
