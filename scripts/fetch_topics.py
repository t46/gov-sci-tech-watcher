#!/usr/bin/env python3
"""Fetch Japan's research theme composition (OpenAlex primary_topic.field) by year.

One-shot local batch (not part of the scheduled refresh):
    uv run python scripts/fetch_topics.py

Method:
- OpenAlex works?filter=authorships.countries:JP,publication_year:{Y},type:article
  &group_by=primary_topic.field.id を1980〜2025年の各年で叩く（年1リクエスト、約46回）。
- group_by が返す26分野（OpenAlexの primary_topic.field — Scopus ASJC相当の広域分類）別件数を、
  その年の分類済み論文合計に対する割合（%）に変換してフロント側で描画する。
- これは論文という成果側のテーマ構成であり、国の予算配分ではない。日本の科学技術関係予算は
  府省庁別にしか公式区分されておらず、テーマ別の予算の長期系列は存在しない
  （調査の経緯は docs/budget-themes-research.md を参照）。
  primary_topicはOpenAlexのアルゴリズムによる推定分類であり、著者やジャーナルの自己申告ではない。

Writes data/topics.json. OPENALEX_API_KEY があれば api_key パラメータを付ける（無くても動く）。
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
DEFAULT_OUTPUT = ROOT / "data" / "topics.json"

API = "https://api.openalex.org/works"
MAILTO = "takagi4646@gmail.com"
API_KEY = os.environ.get("OPENALEX_API_KEY", "")
USER_AGENT = "gov-sci-tech-watcher/1.0 (+https://science-signal.pages.dev/)"
START_YEAR = 1980
END_YEAR = 2025

# OpenAlex の primary_topic.field は Scopus ASJC相当の26広域分野。日本語対訳。
FIELD_NAME_JA = {
    "Agricultural and Biological Sciences": "農学・生物科学",
    "Arts and Humanities": "人文科学",
    "Biochemistry, Genetics and Molecular Biology": "生化学・遺伝学・分子生物学",
    "Business, Management and Accounting": "経営学・会計学",
    "Chemical Engineering": "化学工学",
    "Chemistry": "化学",
    "Computer Science": "計算機科学",
    "Decision Sciences": "意思決定科学",
    "Dentistry": "歯学",
    "Earth and Planetary Sciences": "地球惑星科学",
    "Economics, Econometrics and Finance": "経済学・計量経済学・金融",
    "Energy": "エネルギー",
    "Engineering": "工学",
    "Environmental Science": "環境科学",
    "Health Professions": "保健医療専門職",
    "Immunology and Microbiology": "免疫学・微生物学",
    "Materials Science": "材料科学",
    "Mathematics": "数学",
    "Medicine": "医学",
    "Neuroscience": "神経科学",
    "Nursing": "看護学",
    "Pharmacology, Toxicology and Pharmaceutics": "薬理学・毒性学・製剤学",
    "Physics and Astronomy": "物理学・天文学",
    "Psychology": "心理学",
    "Social Sciences": "社会科学",
    "Veterinary": "獣医学",
}


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


def fetch_year(year: int) -> list[dict]:
    params = {
        "filter": f"authorships.countries:JP,publication_year:{year},type:article",
        "group_by": "primary_topic.field.id",
        "per-page": "200",
        "mailto": MAILTO,
    }
    if API_KEY:
        params["api_key"] = API_KEY
    payload = get_json(f"{API}?{urllib.parse.urlencode(params)}")
    return payload.get("group_by", [])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--start-year", type=int, default=START_YEAR)
    parser.add_argument("--end-year", type=int, default=END_YEAR)
    args = parser.parse_args()

    years = list(range(args.start_year, args.end_year + 1))
    field_names: dict[str, str] = {}  # field_id -> English display name
    field_counts: dict[str, dict[int, int]] = defaultdict(dict)
    requests_made = 0

    for year in years:
        groups = fetch_year(year)
        requests_made += 1
        for group in groups:
            key = str(group.get("key") or "")
            if not key:
                continue
            field_id = key.rsplit("/", 1)[-1]
            name = str(group.get("key_display_name") or "")
            if name:
                field_names[field_id] = name
            field_counts[field_id][year] = int(group.get("count", 0))
        total = sum(int(g.get("count", 0)) for g in groups)
        print(f"[topics] {year}: {len(groups)} fields, {total} papers (classified)")
        time.sleep(0.2 if API_KEY else 0.4)

    fields = []
    for field_id, name in sorted(field_names.items(), key=lambda kv: kv[1]):
        name_ja = FIELD_NAME_JA.get(name, name)
        counts = [field_counts[field_id].get(y, 0) for y in years]
        fields.append({"id": field_id, "name": name, "name_ja": name_ja, "counts": counts})

    payload = {
        "status": "ok",
        "generated_at": now_iso(),
        "source": {"title": "OpenAlex API（CC0）", "url": "https://openalex.org/"},
        "years": years,
        "fields": fields,
        "requests": requests_made,
        "note": (
            "日本の所属を含む著者による論文（type:article）を、OpenAlexのprimary_topic.field（26分野、"
            "Scopus ASJC相当の広域分類）で年別に集計し、その年の分類済み論文数に対する割合に換算した。"
            "これは研究という成果の側のテーマ構成であり、国の予算配分ではない。日本の科学技術関係予算は"
            "府省庁別にしか公式区分されておらず、テーマ別の予算の長期系列データは存在しない。"
            "分野分類（primary_topic）はOpenAlexのアルゴリズムによる推定であり、著者の自己申告ではない。"
            "1980年代・90年代前半は収録論文自体が少なく、シェアの振れが大きい点に留意。"
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"[topics] wrote {args.output} ({requests_made} requests, {len(fields)} fields)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
