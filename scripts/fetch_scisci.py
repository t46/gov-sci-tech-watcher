#!/usr/bin/env python3
"""Fetch OpenAlex aggregations about Japanese research for the new 研究
（サイエンス・オブ・サイエンス）chapters of the 研究 page (data/scisci.json).

運用: CIには組み込まず、手動実行を想定する（`uv run python scripts/fetch_scisci.py`）。
OpenAlexの月次インデックス更新にあわせて再実行する程度の頻度でよい。

共通定義（全ブロックで統一）:
- 「日本の論文」= OpenAlex filter `authorships.countries:jp,type:article|review`（著者所属
  機関の国コードに日本を含み、typeがarticleまたはreview、whole counting）。typeを絞らないと
  分母にdataset・book-chapter・dissertation・preprint等が混入し、「論文」という表示ラベルと
  乖離する（実測: 2023年JP、全著作物198,218件 vs type:article単独136,681件 vs
  type:article|review 137,772件。api.openalex.org/works?group_by=type で type:review が
  有効なtype値であることを確認済み、type:article|reviewのOR構文も実クエリで動作確認済み）。
  この定義は本ファイルの全ブロックのnoteに明記する。例外はpreprintsブロックのシェア計算の分母
  のみで、意図的にtotalsブロックのall_works系列（type絞り込みなしの全著作物ベース）を使う
  （プレプリントは定義上article|reviewに含まれないため、article分母で割ると数字が歪む）。
- 各クエリは works エンドポイントの group_by 集計のみを使う（1クエリ=1リクエストで
  完結する集計であり、resultsのページング/カーソル走査は行わない）。
- 全リクエストに `mailto=science-signal@unktok.dev` を付与する（OpenAlexのpolite pool
  対応）。環境変数 OPENALEX_API_KEY が設定されていれば `api_key=...` も付与する
  （値は絶対にログ・print しない。os.environ からのみ読む）。
- リクエスト間に約0.4秒のスリープを入れる。総リクエスト数は90回未満に収まる設計
  （実測はpayloadの _meta.requests_made と実行ログで確認できる）。
- 年次シリーズは1990〜2025年を主対象とする。直近1〜2年（2025年、データがあれば2026年）
  はOpenAlexの索引反映が遅れる既知の癖があり過小計上されるため、各ブロックの
  partial_years フィールドに列挙し、フロント側で参考値として区別できるようにする。

Blocks written to data/scisci.json（全ブロック status/source/note を持つ）:
- totals: JP論文数・世界論文数の年次件数（他ブロックの分母）。
- top_journals: Nature/Science/Cell/PNAS/Nature Communications 5誌でのJP・世界件数と
  JPシェア。掲載前にOpenAlex /sources/{id} で各IDのdisplay_nameを検証する。
- team_size: 著者11人以上（大規模チーム）シェア・単一機関のみ（institutions_distinct_
  count:1）シェア。
- cited_top10: cited_by_percentile_year.min:90（OpenAlex機械算出のTop10%論文）のJP
  シェア。NISTEPのTop10%補正論文シェア（WoS・分数カウント）とは前提が異なり直接比較不可。
- retractions: is_retracted:true のJP件数・率（年次）と、分野別内訳（全期間累計）。
- oa_status: closed/gold/diamond/green/bronze/hybrid 6区分のJPシェア（年次、2000〜2024）。
- preprints: type:preprint のJP件数・シェア（年次）。
- concentration: 2000/2012/2023年について、機関別group_byでtop1/top5/top10機関シェアと
  上位15機関を収録。group_byは上位約200機関までしか返さないため、シェアの分母は
  totalsブロックのJP総論文数を使う（200機関分の合計ではない）。
- language_ja: language:ja のJP件数・シェア（年次）。「言語が日本語」であり「国内誌
  掲載」ではない点に注意（国内学会誌の英語論文は含まれない）。
- domestic_journals: 日本の学会・協会・研究機関が発行主体の査読誌36誌（編集部選定、
  CURATED_JP_JOURNALS）＋機械工学分野の2014年誌名刷新前の系譜3誌（lineage_of付き）の
  source_idをORしたJP件数・シェア（年次、1990〜2024）。CURATED_JP_JOURNALS が空リストの
  場合は status:"unavailable" を返す（学会誌リスト未投入時のフォールバック）。

Self-validation（違反時は当該ブロックをstatus:"error"にし、前回値があれば前回値を
保持する。スクリプト全体は落とさない — fetch_policy.pyのkeep-previousパターンを踏襲）:
- 全シェア値は[0,1]の範囲。
- totals の2023年JP件数（type:article|review）が120,000〜160,000件の範囲内
  （旧・全著作物ベースの198,000件±20%から、article|review絞り込みに合わせて範囲を更新）。
- top_journals の2023年JP件数が旧基準1,116件の±25%以内（対象5誌はジャーナルなので
  type絞り込みによる件数の大崩れは想定しない。旧基準の2000/2012年チェックは廃止し、
  実行時に旧値との比較をprintで報告する）。
- oa_status の年次6区分シェア合計が0.95〜1.05の範囲内。
- retractions の累計撤回件数チェックは廃止（分母のtype絞り込みで旧基準2,516件±20%が
  無効になったため）。実行時に旧値との比較をprintで報告する。

Every block carries {status, unit, source:{title,url}, note} so the frontend can state
provenance honestly and degrade gracefully when a source is unavailable.
"""

from __future__ import annotations

import argparse
import json
import os
import time
import urllib.parse
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "scisci.json"

USER_AGENT = "gov-sci-tech-watcher/1.0 (+https://science-signal.pages.dev/)"
API = "https://api.openalex.org"
MAILTO = "science-signal@unktok.dev"
API_KEY = os.environ.get("OPENALEX_API_KEY", "")  # never print/log this value
SLEEP_SECONDS = 0.4

# 「日本の論文」の共通type絞り込み。typeを絞らないとdataset・book-chapter・dissertation・
# preprint等が「論文」の分母に混入する（実測: 2023年JP、全著作物198,218件 vs
# type:article単独136,681件 vs type:article|review 137,772件）。type:reviewは
# api.openalex.org/works?group_by=type で有効な値であることを確認済み。全ブロック共通で
# 使う（例外: preprintsブロックのシェア分母のみtotals.series.all_worksを使う）。
ARTICLE_FILTER = "type:article|review"

REQUEST_COUNT = 0


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


def get_json(url: str, params: dict[str, str] | None = None, retries: int = 5) -> dict:
    """GET a JSON endpoint with mailto/api_key attached, retrying transient errors
    (429/500/502/503/timeouts) with backoff. Client errors (400/403/404 etc.) are
    not retried since they indicate a bad query, not a transient failure. The
    api_key value is read from os.environ only and never appears in any print."""
    global REQUEST_COUNT
    query = dict(params or {})
    query["mailto"] = MAILTO
    if API_KEY:
        query["api_key"] = API_KEY
    full_url = f"{url}?{urllib.parse.urlencode(query)}"

    delay = 2.0
    last_error: Exception | None = None
    for attempt in range(retries):
        REQUEST_COUNT += 1
        try:
            request = Request(full_url, headers={"User-Agent": USER_AGENT, "Accept": "application/json"})
            with urlopen(request, timeout=60, context=SSL_CONTEXT) as response:
                payload = json.loads(response.read())
            time.sleep(SLEEP_SECONDS)
            return payload
        except (HTTPError, URLError, TimeoutError) as error:
            last_error = error
            code = getattr(error, "code", None)
            transient = code in (408, 429, 500, 502, 503, 504) or code is None
            if not transient or attempt == retries - 1:
                raise
            wait = delay
            print(f"[scisci] retry {attempt + 1} (HTTP {code}) — wait {wait:.0f}s")
            time.sleep(wait)
            delay *= 1.8
    raise RuntimeError(f"OpenAlex request failed after {retries} attempts: {last_error}")


def group_by_counts(filter_str: str | None, group_by: str, per_page: int = 200) -> list[dict]:
    """Single group_by aggregation query against the works endpoint (no result
    paging — group_by returns up to `per_page` buckets in one response)."""
    params = {"group_by": group_by, "per-page": str(per_page)}
    if filter_str:
        params["filter"] = filter_str
    payload = get_json(f"{API}/works", params)
    return payload.get("group_by", []) or []


def year_counts(filter_str: str | None) -> dict[int, int]:
    rows = group_by_counts(filter_str, "publication_year")
    counts: dict[int, int] = {}
    for row in rows:
        key = row.get("key")
        if key is None:
            continue
        try:
            year = int(key)
        except (TypeError, ValueError):
            continue
        if 1900 <= year <= 2100:
            counts[year] = row.get("count", 0)
    return counts


def _check_share(value: float | None, label: str) -> None:
    if value is not None and not (0 <= value <= 1):
        raise ValueError(f"{label}: シェアが[0,1]範囲外（{value}）")


def _short_id(value: str | None) -> str | None:
    """OpenAlex group_by rows for id-type keys (institutions, topics/fields, etc.)
    return a full URL (e.g. https://openalex.org/I74801974) rather than the bare
    ID used elsewhere in this file (e.g. S137773608 for sources) — normalize to
    the bare trailing path segment for consistency."""
    if not value:
        return value
    return value.rstrip("/").rsplit("/", 1)[-1]


# --------------------------------------------------------------------- totals

def totals_block(previous: dict[str, object] | None) -> dict[str, object]:
    jp_raw = year_counts(f"{ARTICLE_FILTER},authorships.countries:jp")
    world_raw = year_counts(ARTICLE_FILTER)
    # all_works: type絞り込みなしの旧来の全著作物ベース系列。preprintsブロックのシェア分母
    # 専用（プレプリントは定義上article|reviewに含まれないため、そちらでは分母を変えない）。
    all_works_raw = year_counts("authorships.countries:jp")
    if not jp_raw or not world_raw or not all_works_raw:
        raise ValueError("totals: group_byクエリが空の結果を返した")

    years = [y for y in sorted(jp_raw) if 1990 <= y <= 2026]
    partial_years = [y for y in years if y >= 2025]
    jp_series = {str(y): jp_raw.get(y, 0) for y in years}
    world_series = {str(y): world_raw.get(y, 0) for y in years}
    all_works_series = {str(y): all_works_raw.get(y, 0) for y in years}

    ref_2023 = jp_series.get("2023")
    if ref_2023 is None:
        raise ValueError("totals: 2023年のJP件数が取得できない")
    if not (120000 <= ref_2023 <= 160000):
        raise ValueError(f"totals: 2023年JP件数が検証範囲外（{ref_2023}件、期待範囲120,000〜160,000件）")
    old_2023 = all_works_series.get("2023")
    print(f"[scisci] totals: 2023年JP件数 旧(全著作物)={old_2023}件 → 新(type:article|review)={ref_2023}件")

    # 直近年の異常値を実測してnoteに動的に埋め込む（ハードコードせず、実行のたびに実測値で
    # 説明する）。2025年以降は「索引の遅れによる過小計上」という一般的な想定とは逆に、
    # 実測では過大計上（2025年は前年の約3倍、2026年に至っては前年の数十倍）というOpenAlex
    # 側の既知の異常が観測されており、方向性（過大/過小）を決め打ちしない説明にする。
    anomaly_note = ""
    prior_year = years[-1] if not partial_years else (partial_years[0] - 1)
    baseline = jp_series.get(str(prior_year))
    if partial_years and baseline:
        ratios = ", ".join(
            f"{y}年={jp_series[str(y)]:,}件（前年比{jp_series[str(y)] / baseline:.1f}倍）"
            for y in partial_years if jp_series.get(str(y))
        )
        anomaly_note = f" 実測: {ratios}（{prior_year}年={baseline:,}件を基準）。"

    print(f"[scisci] totals: 2023年JP件数={ref_2023}件、partial_years={partial_years}")

    return {
        "status": "ok",
        "unit": "件",
        "years": years,
        "partial_years": partial_years,
        "series": {"jp": jp_series, "world": world_series, "all_works": all_works_series},
        "source": {"title": "OpenAlex Works API（group_by=publication_year）", "url": f"{API}/works"},
        "note": (
            "「日本の論文」は authorships.countries:jp かつ type:article|review（著者所属機関の"
            "国コードが日本を含み、typeがarticleまたはreview、whole counting）で定義。この定義は"
            "本ファイルの全ブロックで共通（例外: preprintsブロックのシェア分母のみ、type絞り込み"
            "なしのall_works系列を使う）。partial_yearsに列挙した直近年はOpenAlexの索引に既知の"
            "異常があり、単純な「過小計上」ではなく年によって過大計上・過小計上のどちらも起こり"
            "うる不安定な値であるため、フロント側はこれらの年をグラフから除外するか、異常値で"
            "ある旨を明示すること。"
            f"{anomaly_note}他の全ブロックのシェア計算の分母（jp）はこのブロックの値を用いるため、"
            "partial_years該当年のシェア値も同様に信頼できない。"
        ),
    }


# ---------------------------------------------------------------- top_journals

SOURCE_SPECS = [
    ("S137773608", "nature", "nature"),
    ("S3880285", "science", "science"),
    ("S110447773", "cell", "cell"),
    ("S125754415", "pnas", "national academy of sciences"),
    ("S64187185", "nature_communications", "nature communications"),
]


def verify_sources() -> list[str]:
    ids = []
    for source_id, key, expect_substr in SOURCE_SPECS:
        payload = get_json(f"{API}/sources/{source_id}", {})
        name = payload.get("display_name") or ""
        if expect_substr.lower() not in name.lower():
            raise ValueError(
                f"top_journals: {source_id}のdisplay_nameが想定と不一致"
                f"（got={name!r}, expect substring={expect_substr!r}）"
            )
        ids.append(source_id)
    print(f"[scisci] top_journals: {len(ids)}誌のsource IDをdisplay_nameで検証済み")
    return ids


def top_journals_block(previous: dict[str, object] | None, totals: dict[str, object] | None) -> dict[str, object]:
    if not totals or totals.get("status") != "ok":
        raise ValueError("top_journals: totalsブロックの年次リストが利用できない")
    ids = verify_sources()
    filter_ids = "|".join(ids)
    years = totals["years"]

    jp_raw = year_counts(f"{ARTICLE_FILTER},primary_location.source.id:{filter_ids},authorships.countries:jp")
    world_raw = year_counts(f"{ARTICLE_FILTER},primary_location.source.id:{filter_ids}")

    jp_series = {str(y): jp_raw.get(y, 0) for y in years}
    world_series = {str(y): world_raw.get(y, 0) for y in years}
    share_series: dict[str, float | None] = {}
    for y in years:
        j = jp_series[str(y)]
        w = world_series[str(y)]
        share = round(j / w, 4) if w else None
        _check_share(share, f"top_journals: {y}年")
        share_series[str(y)] = share

    # 旧基準（type絞り込みなし時代の実測値）との比較を報告する。2000/2012年は参考表示のみ、
    # 2023年だけハード検証する（対象5誌はジャーナルなのでtype絞り込みで件数が大崩れしないはず）。
    old_checks = {2000: 351, 2012: 625, 2023: 1116}
    for y, old_value in old_checks.items():
        actual = jp_series.get(str(y))
        print(f"[scisci] top_journals: {y}年JP件数 旧={old_value}件 → 新={actual}件")
    ref_2023 = jp_series.get("2023")
    old_2023 = old_checks[2023]
    if ref_2023 is None or not (old_2023 * 0.75 <= ref_2023 <= old_2023 * 1.25):
        raise ValueError(f"top_journals: 2023年JP件数が検証範囲外（{ref_2023}件、旧基準{old_2023}件の±25%）")

    return {
        "status": "ok",
        "unit": "件・シェア",
        "journals": [{"source_id": sid, "key": key, "name": name} for sid, key, name in SOURCE_SPECS],
        "years": years,
        "partial_years": totals.get("partial_years", []),
        "series": {"jp": jp_series, "world": world_series, "jp_share": share_series},
        "source": {"title": "OpenAlex Works API（primary_location.source.id）", "url": f"{API}/works"},
        "note": (
            "「日本の論文」は authorships.countries:jp かつ type:article|review で定義"
            "（totalsブロックと同一基準）。選定基準は総合科学系の高被引用5誌（Nature/Science/"
            "Cell/PNAS/Nature Communications、編集部選定であり恣意性あり）。掲載前に各誌の"
            "OpenAlex source IDをdisplay_nameで検証済み。whole counting（国際共著論文は関与する"
            "各国に1件ずつカウントされる）。"
        ),
    }


# ------------------------------------------------------------------ team_size

def team_size_block(previous: dict[str, object] | None, totals: dict[str, object] | None) -> dict[str, object]:
    if not totals or totals.get("status") != "ok":
        raise ValueError("team_size: totalsブロックの分母が利用できない")
    years = totals["years"]
    jp_total = totals["series"]["jp"]

    large_raw = year_counts(f"{ARTICLE_FILTER},authors_count:>10,authorships.countries:jp")
    single_raw = year_counts(f"{ARTICLE_FILTER},institutions_distinct_count:1,authorships.countries:jp")

    def build(raw: dict[int, int], label: str) -> tuple[dict[str, int], dict[str, float | None]]:
        series: dict[str, int] = {}
        share: dict[str, float | None] = {}
        for y in years:
            n = raw.get(y, 0)
            d = jp_total.get(str(y), 0)
            s = round(n / d, 4) if d else None
            _check_share(s, f"team_size ({label}): {y}年")
            series[str(y)] = n
            share[str(y)] = s
        return series, share

    large_series, large_share = build(large_raw, "large_team")
    single_series, single_share = build(single_raw, "single_institution")

    return {
        "status": "ok",
        "unit": "件・シェア",
        "years": years,
        "partial_years": totals.get("partial_years", []),
        "large_team": {"series": large_series, "share": large_share},
        "single_institution": {"series": single_series, "share": single_share},
        "source": {"title": "OpenAlex Works API（authors_count / institutions_distinct_count）", "url": f"{API}/works"},
        "note": (
            "「日本の論文」は authorships.countries:jp かつ type:article|review で定義。"
            "large_teamはauthors_count:>10"
            "（著者11人以上）のJP論文シェア、single_institutionはinstitutions_distinct_count:1"
            "（関与機関が1つのみ）のJP論文シェア。素粒子実験等のLHC型メガコラボレーション論文は"
            "数百〜数千著者になることがあり、large_teamのシェアはこうした少数の巨大論文の"
            "有無に大きく引っ張られる年がある点に注意。"
        ),
    }


# ---------------------------------------------------------------- cited_top10

def cited_top10_block(previous: dict[str, object] | None, totals: dict[str, object] | None) -> dict[str, object]:
    if not totals or totals.get("status") != "ok":
        raise ValueError("cited_top10: totalsブロックの分母が利用できない")
    years = totals["years"]
    jp_total = totals["series"]["jp"]

    raw = year_counts(f"{ARTICLE_FILTER},cited_by_percentile_year.min:90,authorships.countries:jp")
    series: dict[str, int] = {}
    share: dict[str, float | None] = {}
    for y in years:
        n = raw.get(y, 0)
        d = jp_total.get(str(y), 0)
        s = round(n / d, 4) if d else None
        _check_share(s, f"cited_top10: {y}年")
        series[str(y)] = n
        share[str(y)] = s

    unstable_years = sorted(set(totals.get("partial_years", [])) | {y for y in years if y >= max(years) - 2})

    return {
        "status": "ok",
        "unit": "件・シェア",
        "years": years,
        "partial_years": totals.get("partial_years", []),
        "unstable_years": unstable_years,
        "series": series,
        "share": share,
        "source": {"title": "OpenAlex Works API（cited_by_percentile_year.min:90）", "url": f"{API}/works"},
        "note": (
            "「日本の論文」は authorships.countries:jp かつ type:article|review で定義。"
            "cited_by_percentile_year.min:90は"
            "OpenAlexが同一出版年内の被引用数パーセンタイルから機械算出したTop10%論文の"
            "フラグで、whole countingによる帰属。NISTEP（Web of Science・分数カウント法）が"
            "公表するTop10%補正論文シェアとは算出方法の前提が異なり、水準を直接比較できない。"
            "また被引用が十分蓄積していない直近2〜3年（unstable_years）はpercentileの値が"
            "不安定になりやすいため参考値として扱うこと。"
        ),
    }


# ---------------------------------------------------------------- retractions

def retractions_block(previous: dict[str, object] | None, totals: dict[str, object] | None) -> dict[str, object]:
    if not totals or totals.get("status") != "ok":
        raise ValueError("retractions: totalsブロックの分母が利用できない")
    years = totals["years"]
    jp_total = totals["series"]["jp"]

    raw = year_counts(f"{ARTICLE_FILTER},is_retracted:true,authorships.countries:jp")
    series: dict[str, int] = {}
    rate: dict[str, float | None] = {}
    cumulative = 0
    for y in years:
        n = raw.get(y, 0)
        cumulative += n
        d = jp_total.get(str(y), 0)
        r = round(n / d, 6) if d else None
        _check_share(r, f"retractions: {y}年")
        series[str(y)] = n
        rate[str(y)] = r

    # 旧・全著作物ベースの実測（2,516件）との比較を報告する。分母のtype絞り込みで旧基準の
    # ±20%チェックは無効になったため、ハード検証はせず報告のみ行う。
    print(f"[scisci] retractions: 累計撤回件数 旧(全著作物)=2,516件 → 新(type:article|review)={cumulative}件")

    field_rows = group_by_counts(f"{ARTICLE_FILTER},is_retracted:true,authorships.countries:jp", "primary_topic.field.id")
    fields = [
        {"field_id": _short_id(row.get("key")), "name": row.get("key_display_name"), "count": row.get("count", 0)}
        for row in field_rows
        if row.get("key")
    ]
    fields.sort(key=lambda r: -r["count"])

    print(f"[scisci] retractions: 累計{cumulative}件、分野内訳{len(fields)}分野")

    return {
        "status": "ok",
        "unit": "件・率",
        "years": years,
        "partial_years": totals.get("partial_years", []),
        "series": series,
        "rate": rate,
        "cumulative_total": cumulative,
        "by_field": fields,
        "source": {"title": "OpenAlex Works API（is_retracted）", "url": f"{API}/works"},
        "note": (
            "「日本の論文」は authorships.countries:jp かつ type:article|review で定義。"
            "OpenAlexのis_retractedフラグは"
            "Crossref・Retraction Watchの統合データに由来する。by_fieldは全期間累計の分野別"
            "内訳（primary_topic.field.id、集計対象は撤回論文全体）。"
        ),
    }


# ---------------------------------------------------------------- oa_status

OA_STATUSES = ["closed", "gold", "diamond", "green", "bronze", "hybrid"]


def oa_status_block(previous: dict[str, object] | None, totals: dict[str, object] | None) -> dict[str, object]:
    if not totals or totals.get("status") != "ok":
        raise ValueError("oa_status: totalsブロックの分母が利用できない")
    years = [y for y in totals["years"] if 2000 <= y <= 2024]
    jp_total = totals["series"]["jp"]

    raw_by_status = {
        status: year_counts(f"{ARTICLE_FILTER},oa_status:{status},authorships.countries:jp")
        for status in OA_STATUSES
    }

    series = {status: {str(y): raw_by_status[status].get(y, 0) for y in years} for status in OA_STATUSES}
    share: dict[str, dict[str, float | None]] = {status: {} for status in OA_STATUSES}
    for status in OA_STATUSES:
        for y in years:
            d = jp_total.get(str(y), 0)
            s = round(series[status][str(y)] / d, 4) if d else None
            _check_share(s, f"oa_status ({status}): {y}年")
            share[status][str(y)] = s

    for y in years:
        d = jp_total.get(str(y), 0)
        if not d:
            continue
        total_share = sum(share[status][str(y)] or 0 for status in OA_STATUSES)
        if not (0.95 <= total_share <= 1.05):
            raise ValueError(f"oa_status: {y}年の合計シェアが検証範囲外（{total_share:.4f}、期待値0.95〜1.05）")

    return {
        "status": "ok",
        "unit": "件・シェア",
        "years": years,
        "partial_years": [y for y in totals.get("partial_years", []) if y in years],
        "statuses": OA_STATUSES,
        "series": series,
        "share": share,
        "source": {"title": "OpenAlex Works API（oa_status）", "url": f"{API}/works"},
        "note": (
            "「日本の論文」は authorships.countries:jp かつ type:article|review で定義。"
            "oa_statusはOpenAlexが分類する"
            "オープンアクセス種別（closed/gold/diamond/green/bronze/hybrid）で、各年6区分の"
            "シェア合計はおおむね1になるはず（丸め等の都合で0.95〜1.05の範囲で検証）。"
            "2000〜2024年に絞って収録。"
        ),
    }


# ---------------------------------------------------------------- preprints

def preprints_block(previous: dict[str, object] | None, totals: dict[str, object] | None) -> dict[str, object]:
    if not totals or totals.get("status") != "ok":
        raise ValueError("preprints: totalsブロックの分母が利用できない")
    years = totals["years"]
    # プレプリントは定義上type:article|reviewに含まれない。他ブロックと異なり、このブロックの
    # シェアだけはtype絞り込みなしの全著作物ベース（all_works）を分母にする（プレプリント比率
    # のみ全著作物ベース）。
    all_works_total = totals["series"].get("all_works")
    if not all_works_total:
        raise ValueError("preprints: totalsブロックにall_works系列がない")

    raw = year_counts("type:preprint,authorships.countries:jp")
    series: dict[str, int] = {}
    share: dict[str, float | None] = {}
    for y in years:
        n = raw.get(y, 0)
        d = all_works_total.get(str(y), 0)
        s = round(n / d, 4) if d else None
        _check_share(s, f"preprints: {y}年")
        series[str(y)] = n
        share[str(y)] = s

    return {
        "status": "ok",
        "unit": "件・シェア",
        "years": years,
        "partial_years": totals.get("partial_years", []),
        "series": series,
        "share": share,
        "source": {"title": "OpenAlex Works API（type:preprint）", "url": f"{API}/works"},
        "note": (
            "「日本の論文」は authorships.countries:jp で定義。ただしこのブロックのみ他の"
            "全ブロックと異なりtype:article|review絞り込みを適用していない（プレプリントは"
            "定義上article|reviewに含まれないため）。プレプリント比率のみ全著作物ベース："
            "typeがpreprintの作品のJP件数を、totalsブロックのall_works系列（type絞り込みなし）"
            "で割ってシェアを算出している。"
        ),
    }


# --------------------------------------------------------------- concentration

CONCENTRATION_YEARS = [2000, 2012, 2023]
CONCENTRATION_GROUP_CANDIDATES = ["authorships.institutions.id", "authorships.institutions.lineage"]


def _resolve_concentration_group_key(filter_str: str) -> tuple[str, list[dict]]:
    for candidate in CONCENTRATION_GROUP_CANDIDATES:
        try:
            rows = group_by_counts(filter_str, candidate)
        except Exception as error:  # noqa: BLE001 — try the next candidate
            print(f"[scisci] concentration: group_by={candidate} 失敗（{error}）")
            continue
        sensible = [
            r for r in rows
            if (_short_id(r.get("key")) or "").startswith("I") and r.get("key_display_name")
        ]
        if len(sensible) >= 5:
            print(f"[scisci] concentration: group_by={candidate} を採用（機関名付き行{len(sensible)}件）")
            return candidate, rows
    raise ValueError(f"concentration: 機関レベルのgroup_byが取得できない（候補: {CONCENTRATION_GROUP_CANDIDATES}）")


def concentration_block(previous: dict[str, object] | None, totals: dict[str, object] | None) -> dict[str, object]:
    if not totals or totals.get("status") != "ok":
        raise ValueError("concentration: totalsブロックの分母が利用できない")
    jp_total = totals["series"]["jp"]

    group_key: str | None = None
    per_year: dict[str, object] = {}
    for year in CONCENTRATION_YEARS:
        filter_str = f"{ARTICLE_FILTER},authorships.countries:jp,publication_year:{year}"
        if group_key is None:
            group_key, rows = _resolve_concentration_group_key(filter_str)
        else:
            rows = group_by_counts(filter_str, group_key)

        named_rows = [
            {
                "institution_id": _short_id(r.get("key")),
                "name": r.get("key_display_name") or _short_id(r.get("key")),
                "count": r.get("count", 0),
            }
            for r in rows
            if r.get("key")
        ]
        named_rows.sort(key=lambda r: -r["count"])

        total = jp_total.get(str(year), 0)
        if not total:
            raise ValueError(f"concentration: {year}年のJP総論文数（分母）が0または欠落")

        def share_of(n: int) -> float:
            return round(sum(r["count"] for r in named_rows[:n]) / total, 4)

        top1, top5, top10 = share_of(1), share_of(5), share_of(10)
        for label, s in [("top1", top1), ("top5", top5), ("top10", top10)]:
            _check_share(s, f"concentration: {year}年の{label}")

        per_year[str(year)] = {
            "total_jp_papers": total,
            "top1_share": top1,
            "top5_share": top5,
            "top10_share": top10,
            "top15": named_rows[:15],
            "buckets_returned": len(rows),
        }

    return {
        "status": "ok",
        "unit": "件・シェア",
        "years": CONCENTRATION_YEARS,
        "group_by_key": group_key,
        "series": per_year,
        "source": {"title": "OpenAlex Works API（機関別group_by）", "url": f"{API}/works"},
        "note": (
            f"「日本の論文」は authorships.countries:jp かつ type:article|review で定義。"
            f"group_by={group_key}による機関別"
            "件数集計（whole counting、国際共著論文は関与する全機関にそれぞれ1カウント）。"
            "group_byは上位約200機関までしか返さないため（buckets_returnedに実際の件数を記録）、"
            "top1/top5/top10シェアの分母にはtotalsブロックのその年のJP総論文数を用いる"
            "（200機関分の合計ではなく、正しい母数で算出）。機関の統廃合・改称（lineageの扱い）は"
            "OpenAlex側の名寄せに依存し、本ブロックでは独自の名寄せは行っていない。"
        ),
    }


# ---------------------------------------------------------------- language_ja

def language_ja_block(previous: dict[str, object] | None, totals: dict[str, object] | None) -> dict[str, object]:
    if not totals or totals.get("status") != "ok":
        raise ValueError("language_ja: totalsブロックの分母が利用できない")
    years = totals["years"]
    jp_total = totals["series"]["jp"]

    raw = year_counts(f"{ARTICLE_FILTER},language:ja,authorships.countries:jp")
    series: dict[str, int] = {}
    share: dict[str, float | None] = {}
    for y in years:
        n = raw.get(y, 0)
        d = jp_total.get(str(y), 0)
        s = round(n / d, 4) if d else None
        _check_share(s, f"language_ja: {y}年")
        series[str(y)] = n
        share[str(y)] = s

    return {
        "status": "ok",
        "unit": "件・シェア",
        "years": years,
        "partial_years": totals.get("partial_years", []),
        "series": series,
        "share": share,
        "source": {"title": "OpenAlex Works API（language:ja）", "url": f"{API}/works"},
        "note": (
            "「日本の論文」は authorships.countries:jp かつ type:article|review で定義。"
            "language:jaは論文本文の言語が"
            "日本語であることを示すフラグであり「国内誌への掲載」ではない。国内学会誌に掲載"
            "された英語論文はこの集計には含まれない点に注意（domestic_journalsブロックとは"
            "別の切り口）。"
        ),
    }


# ------------------------------------------------------------ domestic_journals

# 選定基準: 日本の学会・協会・研究機関が発行主体の査読誌（編集部選定）。年会予稿集・
# 国際商業出版社誌は除外。人文・社会科学はOpenAlexの誌別集計では2誌（Journal of Indian and
# Buddhist Studies, Journal of the City Planning Institute of Japan）しか同定できず大幅に
# 過小代表である点に注意。
#
# 機械工学分野のみ、2014年に発行元が誌名を刷新した経緯があるため、査読誌としての系譜を
# 追跡する目的で刷新前の3誌（TRANSACTIONS OF THE JAPAN SOCIETY OF MECHANICAL ENGINEERS
# Series A/B/C、日本機械学会論文集A/B/C編）を "lineage_of" 付きで追加している。OpenAlex
# sources検索（api.openalex.org/sources?search=...）でdisplay_nameが"TRANSACTIONS OF THE
# JAPAN SOCIETY OF MECHANICAL ENGINEERS Series A/B/C"であることを検証済み。counts_by_year
# で確認したところ、Series A/B/Cはいずれも2013年で終了し、Mechanical Engineering Journal
# （S2765075441）が2014年から開始しており、活動期間が断絶なく接続することを確認した。
# なお同検索でヒットしたSeries表記のない"Transactions of the Japan Society of Mechanical
# Engineers"（S2530729162, 1935-2010年）はSeries A/B/Cと活動期間が重複しており、同一論文の
# 重複登録の疑いが強いため意図的に除外した（含めると二重計上のリスクがある）。
CURATED_JP_JOURNALS: list[dict[str, str]] = [
    {"source_id": "S143744711", "name": "Japanese Journal of Applied Physics", "publisher": "Japan Society of Applied Physics"},
    {"source_id": "S54409865", "name": "Applied Physics Express", "publisher": "Japan Society of Applied Physics"},
    {"source_id": "S119212824", "name": "Journal of the Physical Society of Japan", "publisher": "Physical Society of Japan"},
    {"source_id": "S4210202364", "name": "Progress of Theoretical and Experimental Physics", "publisher": "Physical Society of Japan"},
    {"source_id": "S12390406", "name": "Publications of the Astronomical Society of Japan", "publisher": "Astronomical Society of Japan"},
    {"source_id": "S95305481", "name": "Bulletin of the Chemical Society of Japan", "publisher": "Chemical Society of Japan"},
    {"source_id": "S90825563", "name": "Chemistry Letters", "publisher": "Chemical Society of Japan"},
    {"source_id": "S3861430", "name": "Chemical and Pharmaceutical Bulletin", "publisher": "Pharmaceutical Society of Japan"},
    {"source_id": "S165235614", "name": "Biological and Pharmaceutical Bulletin", "publisher": "Pharmaceutical Society of Japan"},
    {"source_id": "S2764386467", "name": "YAKUGAKU ZASSHI", "publisher": "Pharmaceutical Society of Japan"},
    {"source_id": "S91156679", "name": "Analytical Sciences", "publisher": "Japan Society for Analytical Chemistry"},
    {"source_id": "S136610595", "name": "Genes & Genetic Systems", "publisher": "Genetics Society of Japan"},
    {"source_id": "S34358731", "name": "Zoological Science", "publisher": "Zoological Society of Japan"},
    {"source_id": "S94095188", "name": "Bioscience, Biotechnology, and Biochemistry", "publisher": "Japan Society for Bioscience, Biotechnology, and Agrochemistry"},
    {"source_id": "S184547178", "name": "The Journal of Biochemistry", "publisher": "Japanese Biochemical Society"},
    {"source_id": "S154471048", "name": "Internal Medicine", "publisher": "The Japanese Society of Internal Medicine"},
    {"source_id": "S4210221755", "name": "Nihon Naika Gakkai Zasshi", "publisher": "The Japanese Society of Internal Medicine"},
    {"source_id": "S4210176241", "name": "Circulation Journal", "publisher": "Japanese Circulation Society"},
    {"source_id": "S175946340", "name": "Cancer Science", "publisher": "Japanese Cancer Association"},
    {"source_id": "S40103090", "name": "Journal of Veterinary Medical Science", "publisher": "Japanese Society of Veterinary Science"},
    {"source_id": "S30446230", "name": "Modern Rheumatology", "publisher": "Japan College of Rheumatology"},
    {"source_id": "S134892809", "name": "International Journal of Urology", "publisher": "Japanese Urological Association"},
    {"source_id": "S191387813", "name": "Endocrine Journal", "publisher": "Japan Endocrine Society"},
    {"source_id": "S141781860", "name": "Journal of Infection and Chemotherapy", "publisher": "Japanese Society of Chemotherapy / Japanese Association for Infectious Diseases"},
    {"source_id": "S125466547", "name": "Surgery Today", "publisher": "Japan Surgical Society"},
    {"source_id": "S63511553", "name": "ISIJ International", "publisher": "The Iron and Steel Institute of Japan"},
    {"source_id": "S4210209311", "name": "Materials Transactions", "publisher": "Japan Institute of Metals and Materials"},
    {"source_id": "S4210173253", "name": "Journal of the Japan Institute of Metals and Materials", "publisher": "Japan Institute of Metals and Materials"},
    {"source_id": "S4210196692", "name": "Journal of the Ceramic Society of Japan", "publisher": "Ceramic Society of Japan"},
    {"source_id": "S2765075441", "name": "Mechanical Engineering Journal", "publisher": "Japan Society of Mechanical Engineers"},
    {"source_id": "S180227014", "name": "Doboku Gakkai Ronbunshu", "publisher": "Japan Society of Civil Engineers"},
    {"source_id": "S4210196937", "name": "Journal of Structural and Construction Engineering (Transactions of AIJ)", "publisher": "Architectural Institute of Japan"},
    {"source_id": "S166990724", "name": "IEICE Transactions on Fundamentals of Electronics, Communications and Computer Sciences", "publisher": "Institute of Electronics, Information and Communication Engineers"},
    {"source_id": "S2764501496", "name": "IEEJ Transactions on Fundamentals and Materials", "publisher": "Institute of Electrical Engineers of Japan"},
    {"source_id": "S2764402342", "name": "Journal of Indian and Buddhist Studies (Indogaku Bukkyogaku Kenkyu)", "publisher": "Japanese Association of Indian and Buddhist Studies"},
    {"source_id": "S4210171706", "name": "Journal of the City Planning Institute of Japan", "publisher": "City Planning Institute of Japan"},
    # 2014年のMechanical Engineering Journal創刊以前の査読誌としての系譜（docstring参照）。
    {"source_id": "S4210202060", "name": "Transactions of the Japan Society of Mechanical Engineers Series A", "publisher": "Japan Society of Mechanical Engineers", "lineage_of": "S2765075441"},
    {"source_id": "S4210223904", "name": "Transactions of the Japan Society of Mechanical Engineers Series B", "publisher": "Japan Society of Mechanical Engineers", "lineage_of": "S2765075441"},
    {"source_id": "S4210180552", "name": "Transactions of the Japan Society of Mechanical Engineers Series C", "publisher": "Japan Society of Mechanical Engineers", "lineage_of": "S2765075441"},
]


def fetch_domestic_journal_counts(source_ids: list[str]) -> dict[int, int]:
    """CURATED_JP_JOURNALS の source_id を~25件ずつのチャンクでORし、JP著者の
    論文件数を年次group_byで集計する（チャンクをまたいで加算）。"""
    counts: dict[int, int] = {}
    chunk_size = 25
    for i in range(0, len(source_ids), chunk_size):
        chunk = source_ids[i : i + chunk_size]
        filter_str = f"{ARTICLE_FILTER},primary_location.source.id:{'|'.join(chunk)},authorships.countries:jp"
        rows = group_by_counts(filter_str, "publication_year")
        for row in rows:
            key = row.get("key")
            if key is None:
                continue
            try:
                year = int(key)
            except (TypeError, ValueError):
                continue
            counts[year] = counts.get(year, 0) + row.get("count", 0)
    return counts


def domestic_journals_block(previous: dict[str, object] | None, totals: dict[str, object] | None) -> dict[str, object]:
    if not CURATED_JP_JOURNALS:
        return {
            "status": "unavailable",
            "note": (
                "学会誌リスト未投入。CURATED_JP_JOURNALS に国内学会誌のsource_id/name/"
                "publisherを持つリストが投入され次第、このブロックを有効化する（機構は"
                "fetch_domestic_journal_counts に実装済み。25件ずつのチャンクでsource id を"
                "ORし、authorships.countries:jp と組み合わせて年次group_byを取る）。"
            ),
            "source": {"title": "OpenAlex Works API（primary_location.source.id、学会誌リスト未投入）", "url": f"{API}/works"},
        }
    if not totals or totals.get("status") != "ok":
        raise ValueError("domestic_journals: totalsブロックの分母が利用できない")

    source_ids = [j["source_id"] for j in CURATED_JP_JOURNALS]
    raw = fetch_domestic_journal_counts(source_ids)
    jp_total = totals["series"]["jp"]
    # 1990〜2024年の経年シリーズとして収録する（直近1〜2年はtotalsブロック同様、
    # OpenAlexの索引異常が大きい既知の年のため対象から外す）。
    years = [y for y in totals["years"] if 1990 <= y <= 2024]
    series = {str(y): raw.get(y, 0) for y in years}
    share: dict[str, float | None] = {}
    for y in years:
        d = jp_total.get(str(y), 0)
        s = round(series[str(y)] / d, 4) if d else None
        _check_share(s, f"domestic_journals: {y}年")
        share[str(y)] = s

    share_2023 = share.get("2023")
    share_2023_pct = f"{share_2023 * 100:.1f}%" if share_2023 is not None else "算出不可"

    return {
        "status": "ok",
        "unit": "件・シェア",
        "journals": CURATED_JP_JOURNALS,
        "years": years,
        "series": series,
        "share": share,
        "source": {"title": "OpenAlex Works API（primary_location.source.id、国内学会誌キュレーション）", "url": f"{API}/works"},
        "note": (
            "「日本の論文」は authorships.countries:jp かつ type:article|review で定義。"
            "選定基準=日本の学会・協会・"
            "研究機関が発行主体の査読誌"
            f"{len([j for j in CURATED_JP_JOURNALS if 'lineage_of' not in j])}誌（編集部選定。"
            "年会予稿集・国際商業出版社誌は除外。人文・社会科学はOpenAlexの誌別集計では2誌しか"
            "同定できず大幅に過小代表）。機械工学分野のみ、2014年の誌名刷新（Mechanical "
            "Engineering Journal）前の系譜としてTransactions Series A/B/C（1938〜2013年）を"
            "lineage_ofフィールド付きで追加収録している。"
            f"2023年時点でこのリストは日本の総論文産出の約{share_2023_pct}"
            "（CURATED_JP_JOURNALSのsource_idをORした集計、25件ずつのチャンクに分けてクエリし"
            "加算）。"
        ),
    }


# ------------------------------------------------------------------ run helpers

BLOCK_NAMES = [
    "totals", "top_journals", "team_size", "cited_top10", "retractions",
    "oa_status", "preprints", "concentration", "language_ja", "domestic_journals",
]


def run_block(name: str, builder) -> dict[str, object]:
    try:
        block = builder()
        print(f"[scisci] {name}: ok")
        return block
    except Exception as error:  # noqa: BLE001 — degrade gracefully, keep provenance
        print(f"[scisci] {name}: FAILED — {error}")
        return {"status": "error", "note": str(error)}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    previous: dict[str, object] = {}
    if args.output.exists():
        try:
            previous = json.loads(args.output.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            previous = {}

    payload: dict[str, object] = {"generated_at": now_iso()}

    # totals は他の全ブロックの分母なので、keep-previousフォールバックを他ブロックの
    # 構築前に確定させる（fetch_policy.pyのdomain_lineage依存パターンと同じ理由）。
    payload["totals"] = run_block("totals", lambda: totals_block(previous.get("totals")))
    if payload["totals"].get("status") != "ok" and previous.get("totals", {}).get("status") == "ok":
        kept = dict(previous["totals"])
        kept["note"] = f"{kept.get('note', '')} 直近の取得に失敗したため前回取得値を表示。".strip()
        payload["totals"] = kept
        print("[scisci] totals: kept previous ok block")
    totals_ref = payload["totals"] if payload["totals"].get("status") == "ok" else None

    payload["top_journals"] = run_block("top_journals", lambda: top_journals_block(previous.get("top_journals"), totals_ref))
    payload["team_size"] = run_block("team_size", lambda: team_size_block(previous.get("team_size"), totals_ref))
    payload["cited_top10"] = run_block("cited_top10", lambda: cited_top10_block(previous.get("cited_top10"), totals_ref))
    payload["retractions"] = run_block("retractions", lambda: retractions_block(previous.get("retractions"), totals_ref))
    payload["oa_status"] = run_block("oa_status", lambda: oa_status_block(previous.get("oa_status"), totals_ref))
    payload["preprints"] = run_block("preprints", lambda: preprints_block(previous.get("preprints"), totals_ref))
    payload["concentration"] = run_block("concentration", lambda: concentration_block(previous.get("concentration"), totals_ref))
    payload["language_ja"] = run_block("language_ja", lambda: language_ja_block(previous.get("language_ja"), totals_ref))
    payload["domestic_journals"] = run_block("domestic_journals", lambda: domestic_journals_block(previous.get("domestic_journals"), totals_ref))

    # 一時的な取得失敗で公開済みの正常データを潰さない: 前回ファイルの正常ブロックを保持
    # （domestic_journalsの"unavailable"はエラーではなく意図した終端状態なので対象外）。
    for key in BLOCK_NAMES:
        if key == "totals":
            continue
        if payload[key].get("status") not in ("ok", "unavailable") and previous.get(key, {}).get("status") == "ok":
            kept = dict(previous[key])
            kept["note"] = f"{kept.get('note', '')} 直近の取得に失敗したため前回取得値を表示。".strip()
            payload[key] = kept
            print(f"[scisci] {key}: kept previous ok block")

    payload["_meta"] = {"requests_made": REQUEST_COUNT}

    args.output.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    size_mb = len(text.encode("utf-8")) / 1_000_000
    print(f"[scisci] payload size: {size_mb:.3f} MB, requests made: {REQUEST_COUNT}")
    # 実行中断で公開JSONが空・途中状態にならないよう、一時ファイル経由で原子的に置き換える
    tmp_path = args.output.with_suffix(".json.tmp")
    tmp_path.write_text(text, encoding="utf-8")
    os.replace(tmp_path, args.output)
    print(f"[scisci] wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
