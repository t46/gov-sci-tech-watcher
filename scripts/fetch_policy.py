#!/usr/bin/env python3
"""Fetch data for the "政策 — 科学技術基本計画30年と第7期の中身" page (data/policy.json).

運用: CIには組み込まず、手動実行を想定する（`uv run python scripts/fetch_policy.py`）。
- plans_history（第1〜7期の基本計画30年史）は歴史的事実の定数であり、更新頻度は低い。
  科学技術基本計画（現・科学技術・イノベーション基本計画）は5年ごとの改定サイクルなので、
  次の見直しは第7期の期間満了が近づく2030年前後（第8期策定時）を目安に再実行する。
- plan7_indicators（第7期の別紙「指標と目標」19項目）は第7期本文が改定されない限り不変。
  本文が訂正・正誤表対応された場合のみ再実行する。
- tech_domains（統合イノベーション戦略の重要技術領域）は統合イノベーション戦略が毎年
  6〜7月頃に閣議決定される運用のため、その都度 --output は変えずに再実行して置き換える
  （年度が変われば重要技術領域の数・名称・要約が変わりうるため、TOGO_URL / TOGO_DECISION
  を当年のものに書き換えること）。
- plan_language（第3〜7期本文の用語頻度）は plans_history と同じ更新頻度（第8期策定時が
  目安）。第3〜7期の本文しか対象にしないため、新しい期が策定されるたびに
  PLAN_LANGUAGE_PERIODS に追加すること。
- strategy_language（統合イノベーション戦略2018〜2026本文の用語頻度、年次解像度）は
  tech_domains と同じ更新頻度（毎年6〜7月頃の閣議決定のたびに再実行）。再実行時は
  STRATEGY_LANGUAGE_YEARS に当年を追加し、STRATEGY_LANGUAGE_URLS /
  STRATEGY_LANGUAGE_DECISIONS に当年のURL・閣議決定日を追記すること（当年のURLは
  index.html のトップの2本の直リンク、または年別サブページ https://www8.cao.go.jp/cstp/
  tougosenryaku/{year}.html から本文/全体版PDFのリンクを辿って確認する）。
- domain_lineage（第2期〜第7期の重点分野・技術領域の系譜）は plans_history と同じ更新頻度
  （第8期策定時が目安）。DOMAIN_LINEAGE_PERIODS の各期の分野名・グループ構成は各期基本計画
  本文から手動で書き起こした定数（史料的事実）で、本文が改定されない限り不変。第7期分
  （17の新興・基盤技術領域）だけは tech_domains ブロックの domains をそのまま参照して組み
  立てる（このブロック内で再転記しない）ため、tech_domains の領域数・名称が変わった年は
  DOMAIN_LINEAGE_EDGES の対応関係（どの過去分野がどの第7期領域に繋がるか）も見直しが必要。

Sources (all official, no key required):
- 内閣府 CSTI「科学技術基本計画及び科学技術・イノベーション基本計画」本文PDF
  (www8.cao.go.jp/cstp/kihonkeikaku/) — 第3期はhonbun.pdf、第4期以降はNhonbun.pdf
  （N=4,5,6,7）。第1期は同ページから直接の本文PDFリンクが確認できず（国立国会図書館WARPの
  archived ページへのリンクすら見当たらない）、honbun_url は null のままとする。第2期は
  公式ページに本文PDFへの直接リンクがないが、国立国会図書館WARPの保存版HTML
  （https://warp.ndl.go.jp/20250911/20250901044924/https://www8.cao.go.jp/cstp/
  kihonkeikaku/honbun.html）で確認できるため、honbun_url にそのWARP保存版URLを収録する
  （フロント側では「第2期(NDL保存版)」とラベルし、PDFではなくHTMLである旨を区別する）。
- 内閣府 統合イノベーション戦略推進会議「統合イノベーション戦略」本文PDF
  (www8.cao.go.jp/cstp/tougosenryaku/) — togo{年}_zentai.pdf。

Blocks written to data/policy.json（全ブロック status/source/note を持つ）:
- plans_history: 第1期〜第7期の各期について、計画期間・正式名称・閣議決定日・政府研究開発
  投資目標（官民合計目標も分かる期は併記）・確認できた実績・本文PDF URLを収録。閣議決定日・
  実績値は「本文PDFや公式ページで確認できたものだけ」を埋め、確認できなければnull（推計や
  非一次情報で埋めない）。第7期の60兆円・180兆円・43.6兆円は毎回本文から実際にgrepして
  検証し、見つからなければ例外を投げる（他の期の目標値は本文取得に成功すれば同様にgrepで
  照合するが、失敗しても定数値は保持しログのみ出す＝史料的事実のため404等で欠落させない）。
- plan7_indicators: 第7期基本計画の別紙「第７期科学技術・イノベーション基本計画の指標と
  目標について」に載る全指標（研究力の向上・イノベーション創出の観点も含めた産業の成長・
  投資、の3カテゴリ）。パース検証として総数が19件であること、博士課程入学者数の現状に
  「16,212」・目標に「２万人」を含むこと、国際共著論文率の現状に「36.5%」・目標に「50%」
  を含むことを確認する（不一致なら例外）。
  ※ 発注時の想定は17件（8+7+2）だったが、本文を実際にgrepすると研究力の向上カテゴリが
  11件、イノベーション・産業成長カテゴリが6件、投資カテゴリが2件の計19件だった（後述の
  parse_plan7_indicators docstring参照）。想定件数と実際の本文が食い違う場合は、本文の
  実際の内容を優先し、想定の方を誤りとして扱う。
- indicator_observations: plan7_indicators の19指標のうち、このサイト自身の実測・準実測
  データで追える範囲を積み増すブロック。observations[].indicator は plan7_indicators の
  指標名と完全一致させ、フロント側（policy.js）がそのキーで両ブロックをマージする。
  国際共著論文率（NISTEP表4-1-3）とAI関連論文数世界順位（OpenAlex）はライブ取得・検証、
  それ以外は各一次資料から手動で書き起こした定数（可能な範囲でベストエフォート検証付き）。
  詳細は関数docstring・各 _obs_* 関数を参照。
- tech_domains: 統合イノベーション戦略の「17の重要技術領域」。名称は本文の丸数字見出し
  （①〜⑰）から、要約は各領域の（現状認識）節の冒頭の一文をそのまま抜粋（句点まで丸ごと、
  地の文からの逐語抜粋のみで要約を作文しない。文の長さは原文次第で30〜110字程度まで
  ばらつく）。検証として領域数が17件であること、各要約が句点で終わる完結した文である
  ことを確認する。
- plan_language: 第3〜7期の基本計画本文（pdftotext抽出テキスト、康熙部首正規化・空白除去
  済み）を対象に、キュレーション済み18語の出現回数を数え、本文文字数1万字あたりの回数
  （per10k）に正規化する。生カウント（n）・本文文字数（doc_lengths）も併記する。第1・2期は
  本文PDFが存在しないため対象外（periods_covered = [3,4,5,6,7]）。用語ごとの集約規則
  （スタートアップ=スタートアップ+ベンチャー、ＡＩ=ＡＩ+人工知能+半角AI等）は各termの
  rule フィールドと source note の双方に明記する。検証として、(1) 第7期は安全保障の専章
  （第4章）を持つため「安全保障」の出現回数が第3期を上回ること、(2) 全termのper10kが
  0以上であること、(3) doc_lengthsが対象期の数だけそろっていること、(4)「安全保障」
  （単一表記）について独立した正規表現カウント（grep -o | wc -l 相当）と本採用の集計値が
  一致すること、(5)「ＡＩ」（3表記の合算＋半角AIの境界判定）について集約ロジックを経由
  しない独立集計と本採用の集計値が一致すること（自己検証）を確認する。
- strategy_language: plan_language の年次解像度版。統合イノベーション戦略2018〜2026の
  本文/全体版PDF（STRATEGY_LANGUAGE_URLS）を対象に、plan_language と全く同じ18語・
  同じ集約規則（PLAN_LANGUAGE_TERMS を共用）・同じ正規化（fix_radicals→空白除去→
  per10k）で出現頻度を数える。plan_language との違いは対象が「5年ごとの期」ではなく
  「年」であることのみ。検証として、(1) 2018〜2026の全9年分がそろっていること、
  (2) 各年の本文文字数（正規化後）が20,000字を上回ること（範囲外なら抽出失敗を疑う）、
  (3) 全termの全年のper10kが有限（NaN/inf でない）かつ0以上であること、(4) plan_language
  と同じ「安全保障」「ＡＩ」の独立再集計による自己検証、を確認する。2018〜2020年は
  https://www8.cao.go.jp/cstp/togo{,2019_,2020_}honbun.pdf（tougosenryaku/ 配下ではなく
  cstp/ 直下）、2021〜2023年は tougosenryaku/ 配下の togo{年}_honbun.pdf、2024〜2026年は
  本文（honbun）とは別に「全体版」（zentai、別紙等を含む完全版）が公式ページで案内されて
  いるため zentai を採用する（honbun側のURLも存在するが、公式indexが正式版として案内する
  のはzentai。2026-08の再検証では2026年の両URLが同一サイズを返した — 提供元の差し替えが
  あるため採用はzentaiに固定する）。2024〜2026年は別紙等を含む全体版、2018〜2023年は本文
  のみのPDFであり、対象文書の範囲が年代で異なる点はフロント側の注記にも明示する。
- domain_lineage: 国の重点分野・技術領域の看板が第2期（2001年）から第7期（2026年）の
  17の新興・基盤技術領域までどう分岐・改名・消滅してきたかの系譜。periods は各期の分野・
  技術領域の一覧（第7期分は tech_domains ブロックの domains をそのまま参照し再転記しない）、
  edges は「どの過去の分野が第7期のどの領域に繋がるか」を表す個々の区間（from_period/
  from_item → to_period/to_item）のリストで、各区間には flag（sure=名称（中核語）の
  直接継承または本文で確認できる改名、interp=内容上の対応・編集部の解釈）と、対応する
  第7期領域名（domain）を持たせる。flag は系譜チェーン全体ではなく区間ごとに判定する。第4期
  （課題達成型への転換期）は分野の看板を一度降ろしたため、多くの区間はこの期の項目を経由
  せず前後の期を直接結ぶ。first_appearance は第7期で初めて設定された領域（防衛産業関連
  技術）、national_strategy は第7期のうち国家戦略技術領域（集中投資対象、6領域）、extinct
  は看板としては消滅したが中身は他領域に分散継承された過去の分野名。全ファクトは各期
  基本計画本文（第2期のみNDL WARP保存版）を編集部が直接確認して書き起こした定数であり、
  検証として (1) 全17領域が edges の domain 集合と first_appearance のどちらかに過不足なく
  対応すること、(2) national_strategy が6件でいずれも tech_domains の17領域名に含まれる
  こと、(3) extinct が5件であることを確認する。
- youth_programs: 若手研究者・博士学生を支援する主要9事業（特別研究員、ポストドクター等
  一万人支援計画、さきがけ、テニュアトラック普及・定着事業、卓越研究員事業、ACT-X、
  創発的研究支援事業、SPRING、BOOST）の開始・終了年度、規模、現況。programs は各機関の
  公表資料（JSPS/JST/MEXT公式ページ・パンフレット・実績PDF）を編集部が手動で確認して
  書き起こした定数で、ライブ取得は行わない（本文が5年周期で改定される plans_history 等
  とは異なり、各事業の公募状況は年により変わりうるため、再実行時は各事業の source URL を
  当年の公式ページで再確認すること）。overview/annual_new/current_stock/adoption_rates は
  フロント側の図B（現在の規模、フローとストックを単位を分けて表示）・採用率チップ行が
  直接参照する構造化データ。検証として、(1) programs が9件であること、(2) 終了事業の集合が
  {postdoc_10k, takuetsu} と一致すること（この2件のみ end_fy を持つ想定）を確認する。

Parsing approach / pitfalls:
- 別紙の指標表・重要技術領域の見出しは、いずれも pdftotext -layout（poppler-utils）でのみ
  安定して読める。pypdf の抽出は列レイアウトが崩れるため使わない。ローカル環境・GitHub
  Actionsランナーの両方に poppler-utils が無い場合はブロックを取得できず例外を投げる
  （`brew install poppler` / `apt-get install -y poppler-utils`）。
- 別紙の指標表は「指標／目標／現状」の3列だが、pdftotext -layout 後のテキストでは
  (1) 指標名が複数行に折り返される、(2) 目標・現状の値も複数行に折り返される、
  (3) 指標名の末尾に付く脚注番号（例: "Top10％補正論文数20"）が値の直後に紛れ込む、
  (4) 脚注そのものの本文（出典調査名など）が同じページ内の表の直後に挿入され、次の指標行
  との間に割り込む、(5) ページ番号（"69" 等）も裸の数字行として挟まる、という5重の崩れ方
  をする。総当たりの汎用パーサでは脚注本文と指標値を区別できないため、各指標を「指標名の
  先頭断片」をアンカーにした個別正規表現で抽出し、目標・現状の値は複数行にまたがる分だけ
  明示的にグループ化して連結する方式にした（fetch_gov.py の yosan.pdf 表パーサと同じ
  「既知の表に対する個別正規表現」方針）。指標名や表の言い回し自体が変わると壊れるが、
  基本計画の別紙は5年間は改定されないため、次の全面改定（第8期）まではこれで足りる。
- 重要技術領域の見出し（①〜⑰）は年によって領域数や名称が変わりうるため、丸数字を汎用的に
  検出する正規表現でアンカーを取る。要約は各領域の（現状認識）節の冒頭から最初の句点
  （。）までを丸ごと切り出すだけの単純な方式にした（旧実装は40字で機械的に打ち切っており、
  「…ＡＩ、量子、バイオ、半導体」のように文の途中で終わる不完全な要約になる不具合が
  あった）。各領域の書き出しはその領域が何かを定義する一文になっていることが多く、句点まで
  丸ごと抜き出せば意味の通る完結した文になる。文の長さは原文次第で30〜110字程度まで
  ばらつくため字数の上限は設けていない。
- 別紙のテキスト中には、pdftotext が特定のフォント外字を「康熙部首（Kangxi Radicals,
  U+2F00-U+2FDF）」に置き換えて出力する既知の癖がある（例: 「生」が「⽣」(U+2F63) になる）。
  RADICAL_MAP で既知の10文字だけを標準の漢字に戻す。全角英数・全角記号（ＡＩ、２、（）等）
  は他ページ（gov.json 等）と同様に原資料の表記のまま保持し、NFKC正規化はしない。

Every block carries {status, source, note} so the frontend can state provenance
honestly and degrade gracefully when a source is unavailable.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import shutil
import subprocess
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "policy.json"

USER_AGENT = "gov-sci-tech-watcher/1.0 (+https://science-signal.pages.dev/)"

CSTP_KIHON_BASE = "https://www8.cao.go.jp/cstp/kihonkeikaku/"
CSTP_KIHON_INDEX = CSTP_KIHON_BASE + "kihon-index.html"
# 第2期のみPDFではなくNDL WARP保存版HTML（公式ページに本文PDFへの直接リンクがないため）。
# _fetch_honbun_text() は PLAN_LANGUAGE_PERIODS ([3,4,5,6,7]) と verify_targets の対象期
# （3〜7）にしか呼ばれないので、この非PDF URLがpdftotext/magicチェックに渡ることはない。
NDL_WARP_PERIOD2_URL = (
    "https://warp.ndl.go.jp/20250911/20250901044924/"
    "https://www8.cao.go.jp/cstp/kihonkeikaku/honbun.html"
)
HONBUN_URLS: dict[int, str | None] = {
    1: None,
    2: NDL_WARP_PERIOD2_URL,
    3: CSTP_KIHON_BASE + "honbun.pdf",
    4: CSTP_KIHON_BASE + "4honbun.pdf",
    5: CSTP_KIHON_BASE + "5honbun.pdf",
    6: CSTP_KIHON_BASE + "6honbun.pdf",
    7: CSTP_KIHON_BASE + "7honbun.pdf",
}

TOGO_URL = "https://www8.cao.go.jp/cstp/tougosenryaku/togo2026_zentai.pdf"
TOGO_TITLE = "統合イノベーション戦略2026"
TOGO_DECISION = "2026-07-14"

# 統合イノベーション戦略 各年の本文/全体版PDF URL。2018〜2020年は www8.cao.go.jp/cstp/
# 直下（tougosenryaku/ 配下ではない）、2021〜2023年は tougosenryaku/ 配下の
# togo{年}_honbun.pdf、2024年以降は本文単体ではなく別紙等を含む「全体版」（zentai）を
# 正式版として採用する（2026年分は既存の TOGO_URL/TOGO_DECISION と同一定数を指す）。
# 再実行時、当年分を追加する際は index.html
# (https://www8.cao.go.jp/cstp/tougosenryaku/index.html) と当年の年別サブページ
# (.../tougosenryaku/{year}.html) の両方でURL・閣議決定日をcurl -sIで検証すること。
STRATEGY_LANGUAGE_URLS: dict[int, str] = {
    2018: "https://www8.cao.go.jp/cstp/togo_honbun.pdf",
    2019: "https://www8.cao.go.jp/cstp/togo2019_honbun.pdf",
    2020: "https://www8.cao.go.jp/cstp/togo2020_honbun.pdf",
    2021: "https://www8.cao.go.jp/cstp/tougosenryaku/togo2021_honbun.pdf",
    2022: "https://www8.cao.go.jp/cstp/tougosenryaku/togo2022_honbun.pdf",
    2023: "https://www8.cao.go.jp/cstp/tougosenryaku/togo2023_honbun.pdf",
    2024: "https://www8.cao.go.jp/cstp/tougosenryaku/togo2024_zentai.pdf",
    2025: "https://www8.cao.go.jp/cstp/tougosenryaku/togo2025_zentai.pdf",
    2026: TOGO_URL,
}

STRATEGY_LANGUAGE_DECISIONS: dict[int, str] = {
    2018: "2018-06-15",
    2019: "2019-06-21",
    2020: "2020-07-17",
    2021: "2021-06-18",
    2022: "2022-06-03",
    2023: "2023-06-09",
    2024: "2024-06-04",
    2025: "2025-06-06",
    2026: TOGO_DECISION,
}

STRATEGY_LANGUAGE_YEARS = list(range(2018, 2027))

CACHE_DIR: Path | None = None


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


def fetch(url: str, timeout: int = 120) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urlopen(request, timeout=timeout, context=SSL_CONTEXT) as response:
        return response.read()


def fetch_with_cache(url: str, cache_relpath: str, magic: bytes | None = None) -> bytes:
    """Fetch bytes from `url`; on any network failure OR (if `magic` is given) a
    response that doesn't start with the expected file signature, fall back to a
    local file at CACHE_DIR/cache_relpath if --cache-dir was given. Live fetch is
    always attempted first (same pattern as fetch_gov.py's fetch_with_cache)."""
    try:
        blob = fetch(url)
        if magic is not None and blob[: len(magic)] != magic:
            raise ValueError(
                f"{url} did not return the expected file signature "
                f"(got {blob[:16]!r}) — likely a dead link or HTML error page"
            )
        return blob
    except Exception as error:  # noqa: BLE001
        if CACHE_DIR is not None:
            candidate = CACHE_DIR / cache_relpath
            if candidate.exists():
                cached = candidate.read_bytes()
                if magic is not None and cached[: len(magic)] != magic:
                    raise ValueError(
                        f"cache {candidate} did not return the expected file signature "
                        f"(got {cached[:16]!r}) — refusing to feed a corrupt/HTML cache into pdftotext"
                    ) from error
                print(f"[policy] live fetch failed ({error}) — using cache {candidate}")
                return cached
        raise


def pdftotext_layout(pdf_bytes: bytes) -> str:
    """Render a PDF to text with column layout preserved, via poppler-utils
    `pdftotext -layout`. Both source tables in this script (別紙の指標表、17の重要
    技術領域の見出し) only survive extraction intact with -layout; pypdf's own
    extraction scrambles the indicator table's columns beyond usable recovery."""
    pdftotext_bin = shutil.which("pdftotext")
    if not pdftotext_bin:
        raise FileNotFoundError(
            "pdftotext (poppler-utils) not found on PATH — required for "
            "plan7_indicators/tech_domains. Install with `apt-get install -y "
            "poppler-utils` (CI) or `brew install poppler` (macOS)."
        )
    with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
        tmp.write(pdf_bytes)
        tmp.flush()
        result = subprocess.run(
            [pdftotext_bin, "-layout", tmp.name, "-"], capture_output=True, timeout=60, check=True
        )
    return result.stdout.decode("utf-8", errors="replace")


# pdftotext の既知の外字置換（康熙部首→標準漢字）。docstring 参照。
RADICAL_MAP = str.maketrans({
    "⼒": "力", "⼦": "子", "⽀": "支", "⽣": "生", "⽤": "用",
    "⽴": "立", "⾒": "見", "⾷": "食", "⾼": "高", "⼥": "女",
})


def fix_radicals(text: str) -> str:
    return text.translate(RADICAL_MAP)


# ------------------------------------------------------------- plans_history

PLANS_HISTORY = [
    {
        "period": 1, "fiscal_years": "1996-2000",
        "name": "科学技術基本計画",
        "cabinet_decision_date": None,
        "target_govt_investment_trillion_yen": 17,
        "target_note": None,
        "actual_govt_investment_trillion_yen": None,
        "actual_note": None,
        "history_note": (
            "17兆円の目標に対し、厳しい財政状況下ながら最終的に目標を超える額を実現した"
            "（出典: 第3期基本計画本文の回顧記述。正確な実績額を示す一次資料は今回の調査"
            "では見つからなかった）。"
        ),
        "honbun_url": None,
    },
    {
        "period": 2, "fiscal_years": "2001-2005",
        "name": "科学技術基本計画",
        "cabinet_decision_date": None,
        "target_govt_investment_trillion_yen": 24,
        "target_note": "対GDP比1%、名目GDP成長率3.5%を前提とした試算（第3期基本計画本文の回顧記述による）。",
        "actual_govt_investment_trillion_yen": None,
        "actual_note": None,
        "history_note": (
            "24兆円の目標に対し、予想以上に長期化した経済停滞と深刻な財政事情により未達"
            "だったが、他の政策経費に比べ高い伸びを確保した（出典: 第3期基本計画本文の"
            "回顧記述。正確な実績額を示す一次資料は今回の調査では見つからなかった）。"
        ),
        "honbun_url": HONBUN_URLS[2],
    },
    {
        "period": 3, "fiscal_years": "2006-2010",
        "name": "科学技術基本計画",
        "cabinet_decision_date": "2006-03-28",
        "target_govt_investment_trillion_yen": 25,
        "target_note": "対GDP比1%、名目GDP成長率3.1%を前提とした試算。",
        "actual_govt_investment_trillion_yen": None,
        "actual_note": None,
        "history_note": None,
        "honbun_url": HONBUN_URLS[3],
    },
    {
        "period": 4, "fiscal_years": "2011-2015",
        "name": "科学技術基本計画",
        "cabinet_decision_date": "2011-08-19",
        "target_govt_investment_trillion_yen": 25,
        "target_note": (
            "官民合わせた研究開発投資を対GDP比4%以上にする目標に加え、政府研究開発投資を"
            "対GDP比1%にすることを目指す（名目GDP成長率平均2.8%を前提とした試算）。"
        ),
        "actual_govt_investment_trillion_yen": None,
        "actual_note": None,
        "history_note": None,
        "honbun_url": HONBUN_URLS[4],
    },
    {
        "period": 5, "fiscal_years": "2016-2020",
        "name": "科学技術基本計画",
        "cabinet_decision_date": "2016-01-22",
        "target_govt_investment_trillion_yen": 26,
        "target_note": (
            "官民合わせた研究開発投資を対GDP比4%以上にする目標に加え、政府研究開発投資を"
            "対GDP比1%にすることを目指す（名目GDP成長率平均3.3%を前提とした試算）。"
        ),
        "actual_govt_investment_trillion_yen": None,
        "actual_note": None,
        "history_note": None,
        "honbun_url": HONBUN_URLS[5],
    },
    {
        "period": 6, "fiscal_years": "2021-2025",
        "name": "科学技術・イノベーション基本計画",
        "cabinet_decision_date": "2021-03-26",
        "target_govt_investment_trillion_yen": 30,
        "target_note": "官民合わせて約120兆円の研究開発投資（政府投資が呼び水となり民間投資を促進する想定）。",
        "actual_govt_investment_trillion_yen": 43.6,
        "actual_note": (
            "出典: 第7期基本計画本文別紙。30兆円の目標に対し実績は43.6兆円（基金として"
            "計上され支出は翌年度以降になるものを含む）。この実績値は補正予算や地方公共"
            "団体分等を含み、当初予算額の単純合計とは定義が異なる点に注意。"
        ),
        "history_note": None,
        "honbun_url": HONBUN_URLS[6],
    },
    {
        "period": 7, "fiscal_years": "2026-2030",
        "name": "科学技術・イノベーション基本計画",
        "cabinet_decision_date": "2026-03-27",
        "target_govt_investment_trillion_yen": 60,
        "target_note": (
            "大学ファンド運用益等を含む拡張定義。従前の基本計画における政府研究開発投資の"
            "考え方に基づく科学技術関係予算目標は45兆円で、これに多様な財源・政策ツールを"
            "加えて総額60兆円を目指す（本文脚注18）。官民合わせた研究開発投資は180兆円が目標。"
        ),
        "actual_govt_investment_trillion_yen": None,
        "actual_note": None,
        "history_note": None,
        "honbun_url": HONBUN_URLS[7],
    },
]


def _fetch_honbun_text(period: int) -> str | None:
    url = HONBUN_URLS.get(period)
    if not url:
        return None
    pdf_bytes = fetch_with_cache(url, f"{period}honbun.pdf", magic=b"%PDF")
    return pdftotext_layout(pdf_bytes)


def plans_history_block(previous: dict[str, object] | None) -> dict[str, object]:
    periods = [dict(p) for p in PLANS_HISTORY]

    # 第7期: 60兆円・180兆円・43.6兆円を必ず本文からgrepして検証する（見つからなければ例外）。
    text7 = _fetch_honbun_text(7)
    if text7 is None:
        raise ValueError("plans_history: 第7期本文を取得できない（honbun_urlが空）")
    checks7 = [
        (r"政府研究開発投資の総額は\s*60\s*兆円", "60兆円（政府研究開発投資目標）"),
        (r"官民合わせ\s*た研究開発投資の総額は\s*180\s*兆円", "180兆円（官民合計投資目標）"),
        (r"43\.6\s*兆円", "43.6兆円（第6期実績）"),
    ]
    missing = [label for pattern, label in checks7 if not re.search(pattern, text7)]
    if missing:
        raise ValueError(f"plans_history: 第7期本文で検証できなかった記述: {', '.join(missing)}")
    print("[policy] plans_history: 第7期の60兆円/180兆円/43.6兆円をすべて本文で確認")

    # 第3〜6期: 目標値を本文からベストエフォートで照合する（取得・照合に失敗しても定数は
    # 保持する — 過去の閣議決定文書という史料的事実であり、一時的な404で欠落させない）。
    verify_targets = {
        3: (r"規模を約\s*(?:25|２５)\s*兆円", 25), 4: (r"規模を約\s*(?:25|２５)\s*兆円", 25),
        5: (r"規模は約\s*(?:26|２６)\s*兆円", 26),
        6: (r"約\s*(?:30|３０)\s*兆円の政府研究開発投資|総額の規模[：:]\s*約\s*(?:30|３０)\s*兆円", 30),
    }
    verified = []
    for period, (pattern, expected) in verify_targets.items():
        try:
            text = _fetch_honbun_text(period)
            if text and re.search(pattern, text):
                verified.append(period)
            elif text:
                print(f"[policy] plans_history: 第{period}期 本文で目標値{expected}兆円の記述を確認できなかった（定数値は保持）")
        except Exception as error:  # noqa: BLE001
            print(f"[policy] plans_history: 第{period}期 本文の照合をスキップ（取得失敗: {error}）")

    return {
        "status": "ok",
        "unit": "兆円",
        "periods": periods,
        "source": {
            "title": "内閣府 CSTI「科学技術基本計画及び科学技術・イノベーション基本計画」",
            "url": CSTP_KIHON_INDEX,
        },
        "note": (
            "政府研究開発投資目標・官民合計投資目標は各期の本文（閣議決定文書）に明記された"
            "値。閣議決定日・実績値は本文や公式ページで確認できたものだけを収録し、確認でき"
            "なかった項目はnull（推計では埋めない）。第1期は公式ページに本文PDFへの直接リンク"
            "が確認できず honbun_url は null。第2期は公式ページに本文PDFへの直接リンクがない"
            "が、国立国会図書館WARPの保存版HTML（PDFではない）が確認できるため honbun_url に"
            "そのWARP保存版URLを収録している。第7期の60兆円/180兆円/43.6兆円は本文から実際に"
            "grepして検証済み"
            f"（第3〜6期の目標値は{', '.join(f'第{p}期' for p in verified) if verified else 'いずれも'}"
            "取得・照合できた分のみ突合、それ以外は定数値をそのまま保持）。"
        ),
    }


# ---------------------------------------------------------- plan7_indicators

CAT1 = "我が国の研究力の向上に関する指標"
CAT2 = "イノベーション創出の観点も含めた産業の成長に関する指標"
CAT3 = "科学技術・イノベーションへの投資に関する指標"


def _pct(s: str) -> float | None:
    m = re.search(r"([\d.]+)\s*[%％]", s)
    return float(m.group(1)) if m else None


def _rank(s: str) -> int | None:
    m = re.search(r"第\s*([0-9０-９]+)\s*位", s)
    if not m:
        return None
    digits = m.group(1).translate(str.maketrans("０１２３４５６７８９", "0123456789"))
    return int(digits)


def _count(s: str, unit: str, multiplier: float = 1, last: bool = False) -> float | None:
    matches = re.findall(rf"([\d,，]+\.?\d*)\s*{unit}", s)
    if not matches:
        return None
    chosen = matches[-1] if last else matches[0]
    value = float(chosen.replace(",", "").replace("，", "")) * multiplier
    return int(value) if value == int(value) else round(value, 4)


def _bare_number(s: str) -> float | None:
    m = re.match(r"\s*([\d,，]+\.?\d*)", s)
    if not m:
        return None
    value = float(m.group(1).replace(",", "").replace("，", ""))
    return int(value) if value == int(value) else value


# 各行: (category, name, regex, combine(groups)->(target, current), source_note,
#        target_numeric_fn(target_str)->number|None, current_numeric_fn(current_str)->number|None)
# regex は「本文中に実在する指標名の先頭断片」をアンカーにした個別正規表現。目標・現状が
# 複数行にまたがる場合は該当グループをすべて捕捉し combine で連結する（docstring 参照）。
N = r"\s+"
ROW_SPECS: list[tuple[str, str, str, object, str | None, object, object]] = [
    (CAT1, "Top10％補正論文数",
     rf"Top10％補正論文数\d*{N}(英独と比肩する地位へ){N}(世界第\s*\d+\s*位){N}(（世界第\d+位）){N}(（[\d\-]+\s*年平均）){N}(（\d+\s*年）)",
     lambda g: (g[0] + g[2] + g[4], g[1] + g[3]),
     "科学技術指標（NISTEP）：Article, Reviewを分析対象、分数カウント法。クラリベイト社Web of Science XML(SCIE)を基に科学技術・学術政策研究所が集計。",
     _rank, _rank),
    (CAT1, "第１・２グループ等の大学の研究時間（教員の職務活動のうち、研究活動が占める割合）",
     rf"第１・２グループ等の{N}(\d+%（\d+\s*年度）){N}(\d+\.\d+％)\d*(（\d+\s*年度）){N}大学\d*の研究時間（教員{N}の職務活動のうち、研{N}究活動が占める割合）",
     lambda g: (g[0], g[1] + g[2]),
     "令和５年度大学等におけるフルタイム換算データに関する調査（文部科学省）における日本の大学等の教員の研究時間割合。",
     _pct, _pct),
    (CAT1, "若手を中心とした挑戦的な研究課題の件数",
     rf"若手を中心とした挑戦{N}(\d[\d,，]*\s*件程度){N}(\d[\d,，]*\s*件程度)\d*{N}的な研究課題の件数{N}(（\d+\s*年度）){N}(（\d+\s*年度）)",
     lambda g: (g[0] + g[2], g[1] + g[3]),
     "科研費、創発、戦略創造のうちの関係研究課題数。",
     lambda s: _count(s, "件"), lambda s: _count(s, "件")),
    (CAT1, "日本人研究者の長期海外派遣数",
     rf"日本人研究者の長期海{N}(累計\d+万人){N}(\d[\d,，]*\s*人){N}外派遣数\d*{N}(（\d+[～\-]\d+\s*年度）){N}(（\d+\s*年度）)",
     lambda g: (g[0] + g[2], g[1] + g[3]),
     "国際研究交流の概況（文部科学省）。",
     lambda s: _count(s, "万人", multiplier=10000), lambda s: _count(s, "人")),
    (CAT1, "国際共著論文率",
     rf"国際共著論文率\d*{N}(\d+%（\d+\s*年）){N}(\d+\.\d+%（\d+\s*年）)",
     lambda g: (g[0], g[1]),
     "科学技術指標（NISTEP）：Article, Reviewを分析対象、整数カウント法。クラリベイト社Web of Science XML(SCIE)を基に科学技術・学術政策研究所が集計。",
     _pct, _pct),
    (CAT1, "博士課程入学者数・博士号取得者数",
     rf"博士課程入学者数・博{N}(２万人（\d+\s*年度）){N}(\d[\d,，]*\s*人（\d+\s*年度）、){N}士号取得者数\d*{N}(\d[\d,，]*\s*人（\d+\s*年度）)",
     lambda g: (g[0], g[1] + g[2]),
     "学校基本調査（文部科学省）、学位授与状況調査（文部科学省）。",
     lambda s: _count(s, "万人", multiplier=10000), lambda s: _count(s, "人")),
    (CAT1, "大学の教授等（学長、副学長及び教授）に占める女性の割合",
     rf"大学の教授等（学長、副{N}(\d+％（\d+\s*年度）){N}(\d+\.\d+%（\d+\s*年度）){N}学長及び教授）に占め{N}る[女⼥]性の割合\d*",
     lambda g: (g[0], g[1]),
     "学校基本調査（文部科学省）。",
     _pct, _pct),
    (CAT1, "第１・２グループ等の大学の若手研究者数（40歳未満の大学本務教員数）",
     rf"第１・２グループ等の{N}(約\s*[\d,，]+\s*人、\d+\.\d+%){N}(\d[\d,，]*\s*人、\d+\.\d+%){N}大学の若手研究者数\d*{N}(（\d+\s*年度）){N}(（\d+\s*年度）)",
     lambda g: (g[0] + g[2], g[1] + g[3]),
     "学校教員統計調査（文部科学省）。",
     lambda s: _count(s, "人"), lambda s: _count(s, "人")),
    (CAT1, "第１・２グループ等の大学の研究者１人当たりの高度専門人材数",
     rf"第１・２グループ等の{N}(0\.\d+\s*人（テクニシャン）){N}(0\.\d+\s*人（テクニシャン）)\d*{N}大学の研究者１人当た{N}(（\d+\s*年度）){N}(（\d+\s*年度）){N}りの高度専門人材数",
     lambda g: (g[0] + g[2], g[1] + g[3]),
     "科学技術指標（NISTEP）：大学部門の研究者一人当たりの業務別研究支援者数のうち、テクニシャンの数。",
     lambda s: _count(s, "人"), lambda s: _count(s, "人")),
    (CAT1, "総論文数に対する全分野でのＡＩ関連論文数の割合",
     rf"総論文数に対する全分{N}(世界第\d+位){N}(世界第\s*\d+\s*位){N}野でのＡＩ関連論文数{N}(（\d+\s*年度）){N}(（[\d.]+%・\d+\s*年）){N}\d*{N}の割合{N}(※\d+\s*年は\s*[\d.]+%){N}(（米国）)",
     lambda g: (g[0] + g[2], g[1] + g[3] + g[4] + g[5]),
     "Scopus・ScopusAPIに基づくデータ（2025年10月JST研究開発戦略センター）。順位はAI関連論文数が多い主要国の中でAI関連論文数割合の高い順。",
     _rank, _rank),
    (CAT1, "研究設備・機器の共用化率",
     rf"研究設備・機器の共用{N}(\d+％（\d+\s*年度）){N}(\d+％程度（\d+\s*年度）){N}化率\d*",
     lambda g: (g[0], g[1]),
     "大学・研究開発法人等の外部資金・寄付金獲得に関する調査（内閣府）。",
     _pct, _pct),
    (CAT2, "高等教育機関の研究開発支出に占める国内企業拠出割合",
     rf"高等教育機関の研究開{N}(７％（\d+\s*年度）){N}(\d+\.\d+%（\d+\s*年度）){N}発支出に占める国内企{N}業拠出割合",
     lambda g: (g[0], g[1]),
     None,
     _pct, _pct),
    (CAT2, "大学等における民間企業からの共同研究受入額",
     rf"大学等における民間企{N}([\d,，]+\s*百万円){N}([\d,，]+\s*百万円){N}業からの共同研究受入{N}(（\d+\s*年度）){N}(（\d+\s*年度）){N}額\d*{N}([\d,，]+\s*百万円){N}(（\d+\s*年度・最新）)",
     lambda g: (g[0] + g[2], g[1] + g[3] + "、" + g[4] + g[5]),
     "大学等における産学連携等実施状況について（文部科学省）：調査対象は国公私立大学（短期大学を含む。）、国公私立高等専門学校及び大学共同利用機関。",
     lambda s: _count(s, "百万円"), lambda s: _count(s, "百万円", last=True)),
    (CAT2, "相互運用性が確保され、データ連携が可能なスマートシティサービスを行っている地方公共団体・地域の数",
     rf"相互運用性が確保さ{N}(\d+（\d+\s*年度）){N}(\d+（\d+\s*年度）){N}れ、データ連携が可能{N}なスマートシティサー{N}ビスを行っている地方{N}公共団体・地域の数",
     lambda g: (g[0], g[1]),
     None,
     _bare_number, _bare_number),
    (CAT2, "ISO/IECにおける幹事国引受数",
     rf"ISO/IEC における幹事{N}(上位５位以内を維持){N}(ISO:第\d+位／IEC：第\d+位){N}国引受数{N}(（\d+\s*年度）){N}(（\d+\s*年度）)",
     lambda g: (g[0] + g[2], g[1] + g[3]),
     None,
     lambda s: None, lambda s: None),
    (CAT2, "ＰＰＨ締結国数（実施庁数）",
     rf"ＰＰＨ\d*締結国数（実施{N}(世界第\d+位（\d+\s*年）){N}(世界第\d+位（\d+\s*年）){N}庁数）",
     lambda g: (g[0], g[1]),
     "特許審査ハイウェイ：ある国・地域の審査結果を活用し、他国・地域で簡単な手続で早期に特許審査を受けることができる枠組み。",
     _rank, _rank),
    (CAT2, "イノベーション実現企業率",
     rf"イノベーション実現企{N}(\d+%（\d+\s*年）){N}(\d+%（[\d\-]+\s*年）){N}業率\d*",
     lambda g: (g[0], g[1]),
     "全国イノベーション調査（NISTEP）。",
     _pct, _pct),
    (CAT3, "政府研究開発投資額",
     rf"政府研究開発投資額{N}(\d+\s*兆円){N}(\d+\.\d+\s*兆円){N}(（[\d\-]+\s*年度合計）){N}(（[\d\-]+\s*年度合計）)",
     lambda g: (g[0] + g[2], g[1] + g[3]),
     None,
     lambda s: _count(s, "兆円"), lambda s: _count(s, "兆円")),
    (CAT3, "官民研究開発投資額",
     rf"官民研究開発投資額{N}(\d+\s*兆円){N}(\d+\.\d+\s*兆円（現時点）){N}(（[\d\-]+\s*年度合計）){N}(（[\d\-]+\s*年度合計）)",
     lambda g: (g[0] + g[2], g[1] + g[3]),
     None,
     lambda s: _count(s, "兆円"), lambda s: _count(s, "兆円")),
]


def parse_plan7_indicators(text: str) -> list[dict[str, object]]:
    """第7期基本計画本文の別紙「指標と目標について」をパースする。

    ヘッダの3カテゴリ（研究力の向上/イノベーション創出・産業成長/投資）ごとに件数を
    数えると 11 + 6 + 2 = 19 件で、発注時の想定17件（8+7+2）とは一致しない。実際に本文を
    grep して数えた結果を正としている（想定件数は発注前の見積もりであり、本文そのものが
    一次資料）。19件という総数は本関数の呼び出し側で検証する。
    """
    anchor = "（別紙）"
    if text.count(anchor) != 1:
        raise ValueError(f"plan7_indicators: 「{anchor}」が本文中に{text.count(anchor)}回出現（1回を想定）— 目印がずれている可能性")
    idx = text.index(anchor)
    section = text[idx:]  # 別紙は本文末尾側の独立した節なので、以降を丸ごと渡し切り詰めない

    indicators = []
    for category, name, pattern, combine, source_note, target_fn, current_fn in ROW_SPECS:
        match = re.search(pattern, section, re.DOTALL)
        if not match:
            raise ValueError(f"plan7_indicators: 「{name}」の行を本文から検出できない")
        target_value, current_value = combine(match.groups())
        target_value = fix_radicals(target_value).strip()
        current_value = fix_radicals(current_value).strip().rstrip("、")
        indicators.append({
            "category": category,
            "name": name,
            "current_value": current_value,
            "current_numeric": current_fn(current_value),
            "target_value": target_value,
            "target_numeric": target_fn(target_value),
            "source_note": source_note,
        })
    return indicators


def plan7_indicators_block(previous: dict[str, object] | None) -> dict[str, object]:
    text = _fetch_honbun_text(7)
    if text is None:
        raise ValueError("plan7_indicators: 第7期本文を取得できない")
    indicators = parse_plan7_indicators(text)

    if len(indicators) != 19:
        raise ValueError(f"plan7_indicators: 総数{len(indicators)}件（期待値19件）— パース異常の疑い")

    doctor = next(i for i in indicators if i["name"].startswith("博士課程入学者数"))
    if "16,212" not in doctor["current_value"] or "２万人" not in doctor["target_value"]:
        raise ValueError(
            f"plan7_indicators: 博士課程入学者数の検証値と不一致（現状={doctor['current_value']!r}、"
            f"目標={doctor['target_value']!r}）"
        )
    coauthor = next(i for i in indicators if i["name"] == "国際共著論文率")
    if "36.5%" not in coauthor["current_value"] or "50%" not in coauthor["target_value"]:
        raise ValueError(
            f"plan7_indicators: 国際共著論文率の検証値と不一致（現状={coauthor['current_value']!r}、"
            f"目標={coauthor['target_value']!r}）"
        )
    print(f"[policy] plan7_indicators: {len(indicators)}件を抽出、検証値（博士課程・国際共著論文率）一致")

    return {
        "status": "ok",
        "fiscal_year": 2026,
        "count": len(indicators),
        "indicators": indicators,
        "source": {
            "title": "第7期科学技術・イノベーション基本計画（別紙）第7期科学技術・イノベーション基本計画の指標と目標について",
            "url": HONBUN_URLS[7],
        },
        "note": (
            "研究力の向上に関する指標11件、イノベーション創出・産業成長に関する指標6件、"
            "投資に関する指標2件の計19件。current_numeric/target_numericは指標の性質に応じて"
            "順位・比率・件数・金額のいずれかを機械抽出したもので、順位と比率が併存する指標や"
            "順位のみの指標では片方または両方がnullになる。"
        ),
    }


# ------------------------------------------------------ indicator_observations

# 第7期別紙19指標のうち、plan7_indicatorsの現状値とは別に、このサイト自身の実測・準実測
# 系列で追える範囲を積み増すブロック。indicator は plan7_indicators.indicators[].name と
# 完全一致させる（フロント側の紐付けキー）。kind="series"|"value"|"none"、
# match="direct"（同一定義に近い一次資料からの実測）|"proxy"（定義が異なる代替指標、
# note を必ず表示）。LIVE指定の2件（国際共著論文率のNISTEP表4-1-3、AI関連論文数世界順位の
# OpenAlex集計）は毎回ライブ取得・検証する。それ以外は手動で書き起こした定数を、可能な
# 範囲で一次資料に対する検証（grep相当）付きで保持する — 定数自体は史料的事実として、
# 検証取得の失敗では欠落させない（plans_historyの第3〜6期目標値と同じ方針）。

ZEN2HAN_DIGITS = str.maketrans("０１２３４５６７８９", "0123456789")


def _zen2han(s: str) -> str:
    return s.translate(ZEN2HAN_DIGITS)


def _int_comma(s: str) -> int:
    return int(_zen2han(s).replace(",", "").replace("，", ""))


OPENALEX_MAILTO = "takagi4646@gmail.com"


def openalex_api(path_query: str) -> dict[str, object]:
    api_key = os.environ.get("OPENALEX_API_KEY", "")
    url = f"https://api.openalex.org/{path_query}&mailto={OPENALEX_MAILTO}"
    if api_key:
        url += f"&api_key={api_key}"
    return json.loads(fetch(url).decode("utf-8"))


NISTEP_COAUTHOR_URL = "https://www.nistep.go.jp/sti_indicator/2026/hyoudata/STI2026_4-1-03.xlsx"
NISTEP_COAUTHOR_TITLE = "科学技術指標2026 表4-1-3 主要国の論文共著形態の推移（NISTEP）"

MONEY_SURVEY_URL = "https://www.stat.go.jp/data/kagaku/kekka/kekkagai/pdf/2025ke_gai.pdf"
MONEY_SURVEY_TITLE = "科学技術研究調査（総務省）令和7年（2025年）調査 概要"

NISTEP_INNOVATION_URL = "https://www.nistep.go.jp/archives/61459/"
NISTEP_INNOVATION_TITLE = "全国イノベーション調査2024年調査統計報告（NISTEP REPORT No.207）"

JPO_ANNUAL_URL = "https://www.jpo.go.jp/resources/report/nenji/2026/index.html"
JPO_ANNUAL_TITLE = "特許行政年次報告書2026年版（特許庁）"

CSTI_SHIRYO1_URL = "https://www8.cao.go.jp/cstp/tyousakai/kihon7/11kai/shiryo1.pdf"
CSTI_SHIRYO1_TITLE = "科学技術・イノベーション基本計画専門調査会（第11回、2025-12-19）資料1 別紙"

ECSTI_EQUIPMENT_URL = "https://e-csti.go.jp/wp-content/uploads/2024/06/ecsti-report20230208.pdf"
ECSTI_EQUIPMENT_TITLE = "e-CSTI 研究設備・機器の共用状況等に関する調査報告"

JSPS_KAKEN_R7_URL = "https://www.jsps.go.jp/file/storage/kaken_27_kdata_g_4795/3-1-1_r7_0330.pdf"
JSPS_KAKEN_R7_TITLE = "科学研究費助成事業（科研費）配分状況一覧（令和7年度新規採択分）（JSPS）"

MEXT_FULLTIME_2023_URL = "https://www.mext.go.jp/content/20250327-mxt_chousei01-000040124.pdf"
MEXT_FULLTIME_2023_TITLE = "令和5年度大学等におけるフルタイム換算データに関する調査（文部科学省）"
NISTEP_FULLTIME_COMPARE_URL = "https://www.nistep.go.jp/wp/wp-content/uploads/NISTEP-RM236-SummaryJ1.pdf"
NISTEP_FULLTIME_COMPARE_TITLE = "大学等教員の職務活動の変化（2002・2008・2013年調査の3時点比較）概要（NISTEP RM236）"
MEXT_FULLTIME_2018_URL = (
    "https://www.mext.go.jp/b_menu/houdou/31/06/__icsFiles/afieldfile/2019/06/26/1418365_01_3_1.pdf"
)
MEXT_FULLTIME_2018_TITLE = "平成30年度大学等におけるフルタイム換算データに関する調査 概要（文部科学省）"


def _grep_check(text: str | None, patterns: list[str], label: str) -> None:
    """ベストエフォートの検証: 見つからなくても例外は投げず、ログのみ出す
    （定数値は史料的事実として保持する — plans_historyの第3〜6期目標値と同じ方針）。"""
    if text is None:
        print(f"[policy] indicator_observations: {label} の検証をスキップ（本文取得失敗）")
        return
    missing = [p for p in patterns if not re.search(p, text)]
    if missing:
        print(f"[policy] indicator_observations: {label} を本文で確認できなかった（定数値は保持）: {missing}")
    else:
        print(f"[policy] indicator_observations: {label} を本文で確認")


def _obs_intl_collab() -> dict[str, object]:
    """国際共著論文率（LIVE）— NISTEP 表4-1-3 のExcelから日本ブロックの国際共著%系列を
    1981〜2024年分そのまま抽出する。xlsxパースはbuild_analytics.pyのread_first_sheetと
    同じ手書きstdlibパーサー方式（zipfile+ElementTree、追加依存なし）だが、この表は
    シート「表4-1-3」が実体としてxl/worksheets/sheet2.xmlに入っている（workbook.xml.relsで
    確認、xl/worksheets/sheet1.xmlは表紙シートで埋め込みグラフのみ・セルデータなし）ため
    シート2を直接読む。"""
    blob = fetch_with_cache(NISTEP_COAUTHOR_URL, "STI2026_4-1-03.xlsx", magic=b"PK")
    namespace = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}
    ns_uri = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
    from zipfile import ZipFile
    from xml.etree import ElementTree
    from io import BytesIO

    with ZipFile(BytesIO(blob)) as archive:
        shared: list[str] = []
        if "xl/sharedStrings.xml" in archive.namelist():
            shared_root = ElementTree.fromstring(archive.read("xl/sharedStrings.xml"))
            for item in shared_root.findall("m:si", namespace):
                shared.append("".join(node.text or "" for node in item.iter(f"{ns_uri}t")))
        sheet_root = ElementTree.fromstring(archive.read("xl/worksheets/sheet2.xml"))

    rows: list[dict[str, str]] = []
    for row in sheet_root.findall(".//m:sheetData/m:row", namespace):
        values: dict[str, str] = {}
        for cell in row.findall("m:c", namespace):
            reference = cell.attrib.get("r", "")
            if not reference:
                continue
            column = re.match(r"[A-Z]+", reference.upper()).group(0)  # type: ignore[union-attr]
            value_node = cell.find("m:v", namespace)
            value = "" if value_node is None else (value_node.text or "")
            if cell.attrib.get("t") == "s" and value:
                value = shared[int(value)]
            elif cell.attrib.get("t") == "inlineStr":
                value = "".join(node.text or "" for node in cell.iter(f"{ns_uri}t"))
            values[column] = value.strip()
        rows.append(values)

    header_idx = next((i for i, r in enumerate(rows) if r.get("A", "").startswith("(A)日本")), None)
    if header_idx is None:
        raise ValueError("indicator_observations/国際共著論文率: 「(A)日本」ブロックを検出できない")
    series: list[list[float]] = []
    for r in rows[header_idx + 1:]:
        year_s = r.get("F", "")
        pct_s = r.get("I", "")
        if not re.fullmatch(r"\d{4}", year_s):
            if series:  # 日本ブロックの終端（次の国のブロックへ抜けた）
                break
            continue
        try:
            pct = float(pct_s)
        except ValueError:
            continue
        series.append([int(year_s), round(pct, 2)])
    if not series:
        raise ValueError("indicator_observations/国際共著論文率: 日本ブロックの%系列を抽出できない")
    last_year, last_pct = series[-1]
    if last_year != 2024 or abs(last_pct - 37.87) > 0.2:
        raise ValueError(
            f"indicator_observations/国際共著論文率: 検証値と不一致（最終年={last_year}、値={last_pct}、期待値≈37.87@2024）"
        )
    print(f"[policy] indicator_observations: 国際共著論文率 {series[0][0]}〜{series[-1][0]}年、{len(series)}点、"
          f"検証OK（2024年={last_pct}%）")
    return {
        "indicator": "国際共著論文率",
        "kind": "series",
        "match": "direct",
        "unit": "%",
        "data": {"series": series},
        "source": {"title": NISTEP_COAUTHOR_TITLE, "url": NISTEP_COAUTHOR_URL},
        "note": (
            "整数カウント法（Article, Reviewを対象、クラリベイト社Web of Science XML(SCIE)を基にNISTEPが集計）。"
            "第7期指標の典拠と同一の集計法・出典。"
        ),
        "site_link": {"href": "papers.html#ch-yardsticks", "label": "研究 — 二つの物差しへ"},
    }


def _obs_pubpriv_rd() -> dict[str, object]:
    """官民研究開発投資額 — 総務省科学技術研究調査 表１－１・表１－２（2025年調査、2024年度分）
    から2015〜2024年度の研究費総額（兆円）・対GDP比系列を書き起こした定数。検証として
    2024年度の総額記述「23兆7925億円」・対GDP比「3.70」が本文に現れることを確認する。"""
    text = None
    try:
        pdf_bytes = fetch_with_cache(MONEY_SURVEY_URL, "2025ke_gai.pdf", magic=b"%PDF")
        text = pdftotext_layout(pdf_bytes)
    except Exception as error:  # noqa: BLE001
        print(f"[policy] indicator_observations: 官民研究開発投資額 本文取得失敗（定数値は保持） — {error}")
    _grep_check(text, [r"23兆7925億円", r"3\.70"], "官民研究開発投資額（2024年度23.7925兆円/対GDP比3.70%）")

    series = [
        [2015, 18.9391], [2016, 18.4326], [2017, 19.0504], [2018, 19.5260], [2019, 19.5757],
        [2020, 19.2365], [2021, 19.7408], [2022, 20.7040], [2023, 22.0497], [2024, 23.7925],
    ]
    gdp_ratio_series = [
        [2015, 3.43], [2016, 3.31], [2017, 3.36], [2018, 3.43], [2019, 3.43],
        [2020, 3.47], [2021, 3.42], [2022, 3.50], [2023, 3.56], [2024, 3.70],
    ]
    return {
        "indicator": "官民研究開発投資額",
        "kind": "series",
        "match": "direct",
        "unit": "兆円",
        "data": {"series": series, "gdp_ratio_series": gdp_ratio_series, "gdp_ratio_unit": "%"},
        "source": {"title": MONEY_SURVEY_TITLE, "url": MONEY_SURVEY_URL},
        "note": (
            "これは各年度の年間値であり、指標の目標（180兆円）は2026〜2030年度の5年累計 — "
            "単位が異なるため、そのまま重ねて進捗を読むことはできない。目標を単純換算すると"
            f"年36兆円ペースで、2024年度実績23.7925兆円はその約{round(23.7925 / 36 * 100)}%。"
            "系列は研究費総額（名目、企業・非営利団体/公的機関・大学等の合計）で、第7期指標の"
            "「官民研究開発投資額」の集計主体（総務省科学技術研究調査）と一致。"
        ),
    }


def _obs_innovation_rate() -> dict[str, object]:
    """イノベーション実現企業率 — NISTEP全国イノベーション調査2024年調査（NISTEP REPORT
    No.207）の公表ページから「2021〜2023年の3年間に36%の企業がイノベーションを実現」の
    記述を検証する。過去回の同一定義値は今回の調査では特定できず単一値のみ収録。"""
    text = None
    try:
        raw = fetch_with_cache(NISTEP_INNOVATION_URL, "nistep_61459.html", magic=None)
        text = raw.decode("utf-8", errors="replace")
    except Exception as error:  # noqa: BLE001
        print(f"[policy] indicator_observations: イノベーション実現企業率 本文取得失敗（定数値は保持） — {error}")
    _grep_check(text, [r"36%の企業"], "イノベーション実現企業率（2021-2023年36%）")
    return {
        "indicator": "イノベーション実現企業率",
        "kind": "value",
        "match": "direct",
        "unit": "%",
        "data": {"value": 36, "year": "2021-2023"},
        "source": {"title": NISTEP_INNOVATION_TITLE, "url": NISTEP_INNOVATION_URL},
        "note": "対象母集団のうちプロダクト・イノベーションまたはビジネス・プロセス・イノベーションを実現した企業の割合。前回調査（2018-2020年）より増加。",
    }


def _obs_pph() -> dict[str, object]:
    """PPH（特許審査ハイウェイ）締結国数（実施庁数）— 特許庁「特許行政年次報告書2026年版」の
    公表値。年次報告書の本文PDFはAWS WAF（CloudFront）のJS課題チャレンジで自動取得を
    ブロックしているため、通常のスクリプト実行からの本文grep検証は行わず、索引ページ
    （index.html、こちらはWAF課題の対象外で到達可能）をURL出典として引用するに留める。"""
    return {
        "indicator": "ＰＰＨ締結国数（実施庁数）",
        "kind": "value",
        "match": "direct",
        "unit": "庁",
        "data": {"value": 46, "year": 2026, "as_of": "2026年3月時点"},
        "source": {"title": JPO_ANNUAL_TITLE, "url": JPO_ANNUAL_URL},
        "note": (
            "日本国特許庁が実施するPPH（特許審査ハイウェイ）の相手庁数。「世界1位」はJPO・CSTIの"
            "公表によるもので、各国のPPH締結数を横断集計する独立の一次統計は存在しない。"
            "年次報告書本文PDFは自動取得を防ぐ仕組みがあり、この観測値のみ手動確認・自動検証なし。"
        ),
    }


def _obs_women_professors() -> dict[str, object]:
    """大学の学長・副学長・教授に占める女性割合 — CSTI 資料1別紙の現状値。原データは
    学校教員統計調査（文部科学省）で、調査年は2022年度の可能性が高い（別紙の記載は
    「2024年」公表だが、調査自体の対象年度は明記が別途必要）。"""
    text = None
    try:
        pdf_bytes = fetch_with_cache(CSTI_SHIRYO1_URL, "cstp_kihon7_11kai_shiryo1.pdf", magic=b"%PDF")
        text = pdftotext_layout(pdf_bytes)
    except Exception as error:  # noqa: BLE001
        print(f"[policy] indicator_observations: 女性割合 本文取得失敗（定数値は保持） — {error}")
    _grep_check(text, [r"19\.6%"], "大学の教授等に占める女性の割合（19.6%）")
    return {
        "indicator": "大学の教授等（学長、副学長及び教授）に占める女性の割合",
        "kind": "value",
        "match": "direct",
        "unit": "%",
        "data": {"value": 19.6, "year": 2024},
        "source": {"title": CSTI_SHIRYO1_TITLE, "url": CSTI_SHIRYO1_URL},
        "note": "CSTIが2024年に公表した現状値。原データは学校教員統計調査（文部科学省）で、調査自体の対象年度は2022年度の可能性が高い（公表年と調査年度が一致しない点に注意）。",
    }


def _obs_iso_iec() -> dict[str, object]:
    """ISO/IECにおける幹事国引受数 — CSTI 資料1別紙の現状値（ISO4位／IEC3位、2024年度）。
    各国のISO/IEC幹事国引受数を横断集計する独立の公開一次統計は存在せず、政府公表値の引用。"""
    text = None
    try:
        pdf_bytes = fetch_with_cache(CSTI_SHIRYO1_URL, "cstp_kihon7_11kai_shiryo1.pdf", magic=b"%PDF")
        text = pdftotext_layout(pdf_bytes)
    except Exception as error:  # noqa: BLE001
        print(f"[policy] indicator_observations: ISO/IEC幹事国引受数 本文取得失敗（定数値は保持） — {error}")
    _grep_check(text, [r"ISO[:：]\s*4\s*位", r"IEC[：:]\s*3\s*位"], "ISO/IEC幹事国引受数（ISO4位/IEC3位）")
    return {
        "indicator": "ISO/IECにおける幹事国引受数",
        "kind": "value",
        "match": "direct",
        "unit": "位",
        "data": {"iso_rank": 4, "iec_rank": 3, "year": 2024},
        "source": {"title": CSTI_SHIRYO1_TITLE, "url": CSTI_SHIRYO1_URL},
        "note": "ISO（国際標準化機構）4位・IEC（国際電気標準会議）3位（2024年度、CSTI公表）。各国のISO/IEC幹事国引受数を横断集計する独立の一次統計は存在せず、政府公表値の引用にとどまる。",
    }


def _obs_ai_papers() -> dict[str, object]:
    """総論文数に対する全分野でのAI関連論文数の割合（世界順位）（LIVE）— OpenAlexで
    primary_topic.subfield=Artificial Intelligence（id 1702）・2023年発行論文を国別に
    group_byし、日本の順位・件数と上位10か国を取得する。指標本体はScopus・JST-CRDS集計
    （2025年10月）に基づくため、OpenAlexの機械分類による代替指標であり算出法が異なる。"""
    payload = openalex_api(
        "works?filter=primary_topic.subfield.id:subfields/1702,publication_year:2023"
        "&group_by=institutions.country_code&per-page=25"
    )
    groups = [g for g in payload.get("group_by", []) if g.get("key_display_name")]
    ranked = sorted(groups, key=lambda g: -int(g.get("count", 0)))
    jp_rank = next((i + 1 for i, g in enumerate(ranked) if g.get("key_display_name") == "Japan"), None)
    jp_count = next((int(g.get("count", 0)) for g in ranked if g.get("key_display_name") == "Japan"), None)
    if jp_rank is None or jp_count is None:
        raise ValueError("indicator_observations/AI関連論文数: OpenAlex集計に日本が含まれない")
    if jp_rank != 9 or abs(jp_count - 4613) > 50:
        raise ValueError(f"indicator_observations/AI関連論文数: 検証値と不一致（日本={jp_rank}位・{jp_count}件、期待値≈9位・4613件）")
    top10 = [{"country": g["key_display_name"], "count": int(g["count"])} for g in ranked[:10]]
    print(f"[policy] indicator_observations: AI関連論文数世界順位 検証OK（日本={jp_rank}位・{jp_count}件）")
    return {
        "indicator": "総論文数に対する全分野でのＡＩ関連論文数の割合",
        "kind": "value",
        "match": "proxy",
        "unit": "位",
        "data": {"rank": jp_rank, "year": 2023, "count": jp_count, "top10": top10},
        "source": {"title": "OpenAlex（CC0） 学術論文データベース", "url": "https://openalex.org/"},
        "note": "OpenAlexのprimary_topic（機械分類）でsubfield=Artificial Intelligenceの論文数を国別集計した代替指標。指標本体の典拠（Scopus・ScopusAPIに基づくJST研究開発戦略センター集計、2025年10月）とは分類・集計方法が異なる。",
    }


def _obs_technician() -> dict[str, object]:
    """研究者1人当たりテクニシャン数 — 総務省科学技術研究調査（2025年調査）の「研究関係
    従業者数」の文中記述（2024年度: 研究者91万2800人・研究補助者7万4900人・技能者6万人）
    から算出。指標の「テクニシャン」に対応する公式区分が「技能者」単独か「研究補助者」を
    含むか確定できないため、両方の値を併記する。"""
    text = None
    try:
        pdf_bytes = fetch_with_cache(MONEY_SURVEY_URL, "2025ke_gai.pdf", magic=b"%PDF")
        text = pdftotext_layout(pdf_bytes)
    except Exception as error:  # noqa: BLE001
        print(f"[policy] indicator_observations: テクニシャン数 本文取得失敗（定数値は保持） — {error}")
    researchers = assistants = technicians = None
    if text:
        normalized = _zen2han(text)
        m = re.search(
            r"研究者が(\d+)万(\d*)人.*?研究補助者が(\d+)万(\d*)人.*?技能者が(\d+)万(\d*)人",
            normalized, re.S,
        )
        if m:
            researchers = int(m.group(1)) * 10000 + int(m.group(2) or 0)
            assistants = int(m.group(3)) * 10000 + int(m.group(4) or 0)
            technicians = int(m.group(5)) * 10000 + int(m.group(6) or 0)
    if researchers is None:
        # 抽出できなくても検証済みの定数値（2024年度）を保持する
        researchers, assistants, technicians = 912800, 74900, 60000
        print("[policy] indicator_observations: テクニシャン数 本文からの抽出に失敗（2024年度の定数値を保持）")
    else:
        if (researchers, assistants, technicians) != (912800, 74900, 60000):
            print(f"[policy] indicator_observations: テクニシャン数 抽出値が想定と不一致（研究者{researchers}/研究補助者{assistants}/技能者{technicians}）— 抽出値をそのまま採用")
        else:
            print("[policy] indicator_observations: テクニシャン数 本文で確認（研究者91.28万/研究補助者7.49万/技能者6.0万）")
    technician_only = round(technicians / researchers, 3)
    with_assistants = round((technicians + assistants) / researchers, 3)
    return {
        "indicator": "第１・２グループ等の大学の研究者１人当たりの高度専門人材数",
        "kind": "value",
        "match": "proxy",
        "unit": "人",
        "data": {
            "value": with_assistants, "year": 2024,
            "alt": {"value": technician_only, "year": 2024, "label": "技能者のみ"},
            "label": "技能者＋研究補助者",
            "components": {"researchers": researchers, "research_assistants": assistants, "technicians": technicians},
        },
        "source": {"title": MONEY_SURVEY_TITLE, "url": MONEY_SURVEY_URL},
        "note": (
            "サイトの系列は全部門（企業・非営利/公的機関・大学等を含む）の研究者1人当たり職種別"
            "従事者数。指標は「第１・２グループ等の大学」に限定した「テクニシャン」区分（NISTEP"
            "科学技術指標の大学部門集計）で、対象範囲・区分定義が異なる。「テクニシャン」に対応"
            "する公式区分（技能者のみか、研究補助者を含むか）を特定できないため両方を併記。"
        ),
    }


def _obs_research_time() -> dict[str, object]:
    """大学の研究時間割合（教員の職務活動のうち研究活動が占める割合）— 文科省フルタイム
    換算データ調査の同一定義値を2002・2008・2013年度（NISTEP RM236比較概要）・2018年度
    （文科省H30年度調査概要）・2023年度（文科省R5年度調査、2025-03-27公表）の5時点で
    書き起こす。2023年度のみ「広義」（社会サービス活動:研究関連を含む）36.7%も併記。"""
    text_2023 = None
    try:
        pdf_bytes = fetch_with_cache(MEXT_FULLTIME_2023_URL, "mext_fulltime_2023.pdf", magic=b"%PDF")
        text_2023 = pdftotext_layout(pdf_bytes)
    except Exception as error:  # noqa: BLE001
        print(f"[policy] indicator_observations: 研究時間割合(2023) 本文取得失敗（定数値は保持） — {error}")
    _grep_check(text_2023, [r"32\.2%", r"36\.7%"], "大学の研究時間割合2023年度（32.2%/広義36.7%）")

    text_2018 = None
    try:
        pdf_bytes = fetch_with_cache(MEXT_FULLTIME_2018_URL, "mext_fulltime_2018.pdf", magic=b"%PDF")
        text_2018 = pdftotext_layout(pdf_bytes)
    except Exception as error:  # noqa: BLE001
        print(f"[policy] indicator_observations: 研究時間割合(2018) 本文取得失敗（定数値は保持） — {error}")
    _grep_check(text_2018, [r"32\.9%"], "大学の研究時間割合2018年度（32.9%）")

    text_early = None
    try:
        pdf_bytes = fetch_with_cache(NISTEP_FULLTIME_COMPARE_URL, "nistep_rm236_summary.pdf", magic=b"%PDF")
        text_early = pdftotext_layout(pdf_bytes)
    except Exception as error:  # noqa: BLE001
        print(f"[policy] indicator_observations: 研究時間割合(2002/2008/2013) 本文取得失敗（定数値は保持） — {error}")
    _grep_check(text_early, [r"46\.5"], "大学の研究時間割合2002年度（46.5%、3時点比較概要の書出し文中）")

    series = [[2002, 46.5], [2008, 36.5], [2013, 35.0], [2018, 32.9], [2023, 32.2]]
    return {
        "indicator": "第１・２グループ等の大学の研究時間（教員の職務活動のうち、研究活動が占める割合）",
        "kind": "series",
        # 指標は第1・2グループ等の大学に限定した割合だが、この系列は大学等「全体」の教員平均。
        # 同一調査由来でも母集団が異なるため実測(direct)ではなく近い指標(proxy)として扱う。
        "match": "proxy",
        "unit": "%",
        "data": {
            "series": series,
            "alt": {"year": 2023, "value": 36.7, "label": "広義（社会サービス活動:研究関連を含む）"},
        },
        "source": {"title": "大学等におけるフルタイム換算データに関する調査（文部科学省）各回報告書", "url": MEXT_FULLTIME_2023_URL},
        "note": (
            "文科省フルタイム換算データ調査（2002・2008・2013・2018・2023年度の5回）における"
            "大学等教員の研究時間割合（職務時間全体に占める研究活動時間の割合）で、指標の現状値"
            "（32.2%、2022年度）と同一の調査・定義。ただしサイトの系列は全大学等教員が対象で、"
            "指標が対象とする「第１・２グループ等の大学」限定ではない。2002/2008/2013年度は"
            "NISTEP RM236比較概要、2018年度は文科省H30年度調査概要、2023年度は文科省R5年度調査"
            "（2025-03-27公表）による。"
        ),
    }


def _obs_equipment_sharing() -> dict[str, object]:
    """研究設備・機器の共用化率 — e-CSTI調査報告の国立大学（産学連携に取り組む70機関中、
    経年比較可能な57機関）の共用化率。2021年は資産件数が前年比2倍以上に急増した機関を
    除くと18%（前年並み）になる旨が本文に明記されている。"""
    text = None
    try:
        pdf_bytes = fetch_with_cache(ECSTI_EQUIPMENT_URL, "ecsti_report_20230208.pdf", magic=b"%PDF")
        text = pdftotext_layout(pdf_bytes)
    except Exception as error:  # noqa: BLE001
        print(f"[policy] indicator_observations: 共用化率 本文取得失敗（定数値は保持） — {error}")
    _grep_check(text, [r"18％で前年並みの水準", r"57機関"], "研究設備・機器の共用化率（2020年17%/2021年15%/外れ値調整後18%、57機関）")
    return {
        "indicator": "研究設備・機器の共用化率",
        "kind": "series",
        "match": "proxy",
        "unit": "%",
        "data": {
            "series": [[2020, 17], [2021, 15]],
            "alt": {"year": 2021, "value": 18, "label": "外れ値調整後（資産件数が前年比2倍以上の機関を除く）"},
        },
        "source": {"title": ECSTI_EQUIPMENT_TITLE, "url": ECSTI_EQUIPMENT_URL},
        "note": "国立大学のうち産学連携に取り組む70機関中、データに過不足なく経年比較可能な57機関のみの調査で、指標の対象範囲（全大学等）より狭い。指標本体の一次資料（内閣府「大学・研究開発法人等の外部資金・寄付金獲得に関する調査」）とも母集団が異なる可能性がある。",
    }


def _obs_challenging_research() -> dict[str, object]:
    """若手を中心とした挑戦的な研究課題の件数 — 科研費（令和7年度新規採択分）の「若手研究」
    ＋「挑戦的研究」の採択件数合計。指標の現状値は科研費・創発・戦略創造の合算だが、
    このサイトの観測は科研費のみの集計。参考値として研究活動スタート支援も併記。"""
    text = None
    try:
        pdf_bytes = fetch_with_cache(JSPS_KAKEN_R7_URL, "jsps_kaken_r7_3-1-1.pdf", magic=b"%PDF")
        text = pdftotext_layout(pdf_bytes)
    except Exception as error:  # noqa: BLE001
        print(f"[policy] indicator_observations: 若手挑戦的研究課題 本文取得失敗（定数値は保持） — {error}")
    young, challenge, start = 5290, 1243, 1521
    if text:
        normalized = _zen2han(text)
        m_young = re.search(r"若手研究\s*[＊*]?\s*〔[^〕]*〕\s*〔\s*([\d,]+)\s*〕", normalized)
        m_challenge = re.search(r"挑戦的研究(?!（)\s+〔[^〕]*〕\s*〔\s*([\d,]+)\s*〕", normalized)
        m_start = re.search(r"研究活動スタート支援\s*[＊*]?\s*〔[^〕]*〕\s*〔\s*([\d,]+)\s*〕", normalized)
        if m_young and m_challenge and m_start:
            young, challenge, start = _int_comma(m_young.group(1)), _int_comma(m_challenge.group(1)), _int_comma(m_start.group(1))
            print(f"[policy] indicator_observations: 若手挑戦的研究課題 本文で確認（若手{young}/挑戦的{challenge}/スタート支援{start}）")
        else:
            print("[policy] indicator_observations: 若手挑戦的研究課題 本文からの抽出に失敗（定数値を保持）")
    total = young + challenge
    return {
        "indicator": "若手を中心とした挑戦的な研究課題の件数",
        "kind": "value",
        "match": "proxy",
        "unit": "件",
        "data": {
            "value": total, "year": 2025,
            "breakdown": [{"label": "若手研究", "value": young}, {"label": "挑戦的研究", "value": challenge}],
            "reference": {"label": "研究活動スタート支援（参考）", "value": start},
        },
        "source": {"title": JSPS_KAKEN_R7_TITLE, "url": JSPS_KAKEN_R7_URL},
        "note": f"科研費「若手研究」＋「挑戦的研究」の令和7年度新規採択件数の合計（{young:,}+{challenge:,}={total:,}件）。指標の現状値6,500件程度は科研費・創発・戦略創造のうちの関係研究課題数の合算で、このサイトの観測は科研費のみの集計のため定義が一致しない。",
    }


def indicator_observations_block(previous: dict[str, object] | None) -> dict[str, object]:
    prev_by_name: dict[str, dict[str, object]] = {}
    if previous and previous.get("status") == "ok":
        for obs in previous.get("observations", []) or []:
            if isinstance(obs, dict) and obs.get("indicator"):
                prev_by_name[obs["indicator"]] = obs

    builders: list[tuple[str, object]] = [
        ("国際共著論文率", _obs_intl_collab),
        ("官民研究開発投資額", _obs_pubpriv_rd),
        ("イノベーション実現企業率", _obs_innovation_rate),
        ("ＰＰＨ締結国数（実施庁数）", _obs_pph),
        ("大学の教授等（学長、副学長及び教授）に占める女性の割合", _obs_women_professors),
        ("ISO/IECにおける幹事国引受数", _obs_iso_iec),
        ("総論文数に対する全分野でのＡＩ関連論文数の割合", _obs_ai_papers),
        ("第１・２グループ等の大学の研究者１人当たりの高度専門人材数", _obs_technician),
        ("第１・２グループ等の大学の研究時間（教員の職務活動のうち、研究活動が占める割合）", _obs_research_time),
        ("研究設備・機器の共用化率", _obs_equipment_sharing),
        ("若手を中心とした挑戦的な研究課題の件数", _obs_challenging_research),
    ]

    observations: list[dict[str, object]] = []
    for name, builder in builders:
        try:
            observations.append(builder())
        except Exception as error:  # noqa: BLE001
            print(f"[policy] indicator_observations: {name} FAILED — {error}")
            kept = prev_by_name.get(name)
            if kept:
                observations.append(kept)
                print(f"[policy] indicator_observations: {name} は前回値を保持")

    # スマートシティは一次資料の機械可読な一覧を特定できていないため kind=none で明示する。
    observations.append({
        "indicator": "相互運用性が確保され、データ連携が可能なスマートシティサービスを行っている地方公共団体・地域の数",
        "kind": "none",
        "match": "proxy",
        "unit": None,
        "data": None,
        "source": None,
        "note": "目標180自治体に対応する公開統計を特定できていない。国土交通省等の年度別選定リストは累積・機械可読な一覧が公表されておらず、この観測は行わない。",
    })

    if len(observations) < 6:
        raise ValueError(f"indicator_observations: 構築できた観測が{len(observations)}件のみ（最低限の充実度を満たさない）")

    return {
        "status": "ok",
        "observations": observations,
        "source": {
            "title": "各一次資料（NISTEP・総務省・文部科学省・内閣府CSTI・特許庁・JSPS・OpenAlex、observations内の各sourceを参照）",
            "url": CSTI_SHIRYO1_URL,
        },
        "note": (
            "第7期別紙19指標のうちplan7_indicators単体では追えない指標を、このサイト自身の"
            "実測・準実測系列で補うブロック。match=direct は指標と同一またはごく近い定義の一次"
            "資料からの実測、match=proxy は定義が異なる代替指標（noteの定義差注記を必ず参照）。"
            "公式の現状値一覧はCSTI基本計画専門調査会（第11回、2025-12-19）資料1別紙（pp.56-59）"
            "に基づく確認を併用した。"
        ),
    }


# --------------------------------------------------------------- tech_domains

def _extract_domain_paragraph(chunk: str) -> str:
    idx = chunk.find("（現状認識）")
    if idx == -1:
        raise ValueError("tech_domains: （現状認識）節を検出できない")
    rest = chunk[idx + len("（現状認識）"):]
    end = rest.find("（特に重点")
    if end == -1:
        end = len(rest)
    lines = [line.strip() for line in rest[:end].split("\n") if line.strip() and not re.fullmatch(r"\d+", line.strip())]
    return fix_radicals("".join(lines).replace(" ", ""))


def _first_sentence(paragraph: str) -> str:
    """（現状認識）節の冒頭の一文を、句点（。）まで丸ごと切り出す（逐語抜粋、要約文の
    作文はしない）。各領域の書き出しはその領域が何かを定義する一文になっていることが
    多く、40字程度に機械的に切り詰めると文の途中で終わってしまう（過去の実装の不具合）。
    文の長さは原文次第でばらつく（30〜110字程度）ため、字数上限は設けず「句点まで
    丸ごと」を優先する。"""
    end = paragraph.find("。")
    if end == -1:
        raise ValueError("tech_domains: （現状認識）節の冒頭に句点（。）が見つからない")
    return paragraph[: end + 1]


def parse_tech_domains(text: str) -> list[dict[str, str]]:
    body_marker = "（２）17 の重要技術領域"
    if body_marker not in text:
        raise ValueError("tech_domains: 「（２）17 の重要技術領域」の節を検出できない")
    body = text[text.index(body_marker):]
    headings = list(re.finditer(r"[①-⑳]\s+(\S+技術(?:（[^）]*）)?)\n", body))

    domains = []
    for i, heading in enumerate(headings):
        name = fix_radicals(heading.group(1))
        start = heading.end()
        end = headings[i + 1].start() if i + 1 < len(headings) else len(body)
        paragraph = _extract_domain_paragraph(body[start:end])
        summary = _first_sentence(paragraph)
        domains.append({"name": name, "summary": summary})
    return domains


def tech_domains_block(previous: dict[str, object] | None) -> dict[str, object]:
    pdf_bytes = fetch_with_cache(TOGO_URL, "togo2026_zentai.pdf", magic=b"%PDF")
    text = pdftotext_layout(pdf_bytes)
    domains = parse_tech_domains(text)

    if len(domains) != 17:
        raise ValueError(f"tech_domains: 領域数{len(domains)}件（期待値17件）— パース異常の疑い")
    for domain in domains:
        if not domain["summary"].endswith("。"):
            raise ValueError(f"tech_domains: 「{domain['name']}」の要約が句点で終わっていない（不完全な文の疑い）")
        if len(domain["summary"]) > 200:
            raise ValueError(f"tech_domains: 「{domain['name']}」の要約が異常に長い（{len(domain['summary'])}字）— 抽出範囲がずれている可能性")
    print(f"[policy] tech_domains: {len(domains)}領域を抽出（要約の字数: "
          f"{min(len(d['summary']) for d in domains)}〜{max(len(d['summary']) for d in domains)}字）")

    return {
        "status": "ok",
        "domains": domains,
        "source": {
            "title": TOGO_TITLE,
            "url": TOGO_URL,
            "cabinet_decision": TOGO_DECISION,
        },
        "note": (
            "要約は各領域の（現状認識）節の冒頭の一文をそのまま抜粋（句点まで丸ごと、字数の"
            "機械的な切り詰めはしない）。原文の一文の長さ次第で30〜110字程度までばらつく。"
            "統合イノベーション戦略は毎年6〜7月頃に改定される運用のため、領域の数・名称・"
            "要約は年によって変わりうる。再実行時は TOGO_URL / TOGO_TITLE / TOGO_DECISION を"
            "当年のものに更新すること。17領域の初出・一次資料は第7期科学技術・イノベーション"
            "基本計画本文第3章「新興・基盤技術領域」（2026-03-27閣議決定）であり、統合"
            "イノベーション戦略2026（2026-07-14閣議決定）は名称・順序を踏襲して要約文を"
            "付加したもの（要約文の出典は引き続き統合イノベーション戦略2026）。"
        ),
    }


# ---------------------------------------------------------------- plan_language

# 各要素: (表示用の用語キー, 集約規則の説明, 集約する表記のリスト)。
# "__AI_HALFWIDTH__" は特別扱いで、半角 "AI" を前後が英数字でない場合のみカウントする
# （"MAIN"・"AIR" のような英単語内の偶然一致を避けるため）。
PLAN_LANGUAGE_TERMS: list[tuple[str, str, list[str]]] = [
    ("安全保障", "単純部分一致（「経済安全保障」等の複合語も包含してカウント）。", ["安全保障"]),
    ("イノベーション", "単純部分一致。", ["イノベーション"]),
    ("若手", "単純部分一致。", ["若手"]),
    ("女性", "単純部分一致。", ["女性"]),
    ("博士", "単純部分一致。", ["博士"]),
    ("基礎研究", "単純部分一致。", ["基礎研究"]),
    ("スタートアップ", "「スタートアップ」と「ベンチャー」を合算。", ["スタートアップ", "ベンチャー"]),
    ("ＡＩ", "「ＡＩ」「人工知能」と、半角「AI」（前後が英数字でない場合のみ）を合算。", ["ＡＩ", "人工知能", "__AI_HALFWIDTH__"]),
    ("量子", "単純部分一致。", ["量子"]),
    ("半導体", "単純部分一致。", ["半導体"]),
    ("宇宙", "単純部分一致（「宇宙人」等との誤爆は無視）。", ["宇宙"]),
    ("バイオ", "単純部分一致。", ["バイオ"]),
    ("デジタル", "単純部分一致（「ＩＴ」「情報通信」は合算しない）。", ["デジタル"]),
    ("国際", "単純部分一致。", ["国際"]),
    ("人文・社会科学", "「人文・社会科学」「人文社会科学」「人文学及び社会科学」を合算。", ["人文・社会科学", "人文社会科学", "人文学及び社会科学"]),
    ("大学ファンド", "単純部分一致。", ["大学ファンド"]),
    ("エネルギー", "単純部分一致。", ["エネルギー"]),
    ("防衛", "単純部分一致。", ["防衛"]),
]

_AI_HALFWIDTH_RE = re.compile(r"(?<![A-Za-z0-9])AI(?![A-Za-z0-9])")

PLAN_LANGUAGE_PERIODS = [3, 4, 5, 6, 7]


def _normalize_doc_text(raw_text: str) -> str:
    """康熙部首を標準漢字に戻した上で、空白・改行をすべて除去する（total文字数の分母と
    出現回数カウントを同じ文字列に対して行うことで、両者の整合性を保つ）。日本語は語間に
    空白を使わないため、pdftotextの行折り返しで用語が「安全\\n保障」のように分断された
    ケースもこれで正しく再結合できる。英語混じりの箇所ではまれに語間の空白ごと連結されて
    しまう（例: "…A" + "I think…" → "…AI think…"）が、本文はほぼ日本語であり実務上の
    影響は無視できる（note に明記）。"""
    return re.sub(r"\s+", "", fix_radicals(raw_text))


def _count_term(text: str, variants: list[str]) -> int:
    total = 0
    for variant in variants:
        if variant == "__AI_HALFWIDTH__":
            total += len(_AI_HALFWIDTH_RE.findall(text))
        else:
            total += text.count(variant)
    return total


def plan_language_block(previous: dict[str, object] | None) -> dict[str, object]:
    doc_lengths: dict[str, int] = {}
    normalized_by_period: dict[int, str] = {}
    for period in PLAN_LANGUAGE_PERIODS:
        text = _fetch_honbun_text(period)
        if text is None:
            raise ValueError(f"plan_language: 第{period}期本文を取得できない")
        normalized = _normalize_doc_text(text)
        normalized_by_period[period] = normalized
        doc_lengths[str(period)] = len(normalized)

    terms = []
    for key, rule, variants in PLAN_LANGUAGE_TERMS:
        counts = {}
        for period in PLAN_LANGUAGE_PERIODS:
            n = _count_term(normalized_by_period[period], variants)
            length = doc_lengths[str(period)]
            per10k = round(n / length * 10000, 2) if length else None
            counts[str(period)] = {"n": n, "per10k": per10k}
        terms.append({"term": key, "rule": rule, "counts": counts})

    # 検証1: 第7期は第4章が安全保障の専章のため、出現回数が第3期を上回るはず
    security = next(t for t in terms if t["term"] == "安全保障")
    if not (security["counts"]["7"]["n"] > security["counts"]["3"]["n"]):
        raise ValueError(
            "plan_language: 第7期の「安全保障」出現回数が第3期以下 — "
            f"第3期={security['counts']['3']['n']}、第7期={security['counts']['7']['n']}"
        )
    # 検証2: 全termのper10kが0以上
    for term in terms:
        for period in PLAN_LANGUAGE_PERIODS:
            per10k = term["counts"][str(period)]["per10k"]
            if per10k is None or per10k < 0:
                raise ValueError(f"plan_language: 「{term['term']}」第{period}期のper10kが不正（{per10k}）")
    # 検証3: doc_lengthsが対象期の数だけそろっている（PLAN_LANGUAGE_PERIODS拡張時も
    # マジックナンバー化しないよう、期待値は定数の長さから動的に取る）
    if len(doc_lengths) != len(PLAN_LANGUAGE_PERIODS):
        raise ValueError(
            f"plan_language: doc_lengthsが{len(doc_lengths)}期分しかない"
            f"（{len(PLAN_LANGUAGE_PERIODS)}期分必要）"
        )
    # 検証4-a: 「安全保障」（単純部分一致・単一表記）について、grep -o | wc -l 相当の
    # 独立した正規表現カウントと一致することを自己検証する（基本のカウント機構の検証）。
    security_variants = next(v for k, r, v in PLAN_LANGUAGE_TERMS if k == "安全保障")
    for period in PLAN_LANGUAGE_PERIODS:
        independent = sum(len(re.findall(re.escape(v), normalized_by_period[period])) for v in security_variants)
        official_n = security["counts"][str(period)]["n"]
        if independent != official_n:
            raise ValueError(
                f"plan_language: 自己検証不一致（安全保障, 第{period}期）: "
                f"独立カウント={independent}、本採用値={official_n}"
            )
    # 検証4-b: 「ＡＩ」（3表記の合算＋半角ＡＩの境界判定）について、_count_term を経由
    # しない形で各表記を個別に数えて合算し、集計ロジック自体（ダブルカウントの有無・
    # 境界判定）を独立に検証する。
    ai_official = next(t for t in terms if t["term"] == "ＡＩ")
    for period in PLAN_LANGUAGE_PERIODS:
        doc = normalized_by_period[period]
        independent_ai = (
            len(re.findall("ＡＩ", doc))
            + len(re.findall("人工知能", doc))
            + len(re.findall(r"(?<![A-Za-z0-9])AI(?![A-Za-z0-9])", doc))
        )
        official_n = ai_official["counts"][str(period)]["n"]
        if independent_ai != official_n:
            raise ValueError(
                f"plan_language: 自己検証不一致（ＡＩ, 第{period}期）: "
                f"独立カウント={independent_ai}、本採用値={official_n}"
            )
    print("[policy] plan_language: 自己検証OK（安全保障の独立カウント一致、ＡＩの集約ロジック一致）")

    return {
        "status": "ok",
        "unit": "回/1万字",
        "periods_covered": PLAN_LANGUAGE_PERIODS,
        "terms": terms,
        "doc_lengths": doc_lengths,
        "source": {
            "title": "各期基本計画本文（閣議決定文書）",
            "url": CSTP_KIHON_INDEX,
        },
        # 期別の本文PDF URL（plans_history の honbun_url と同一。出典追跡用に自ブロックにも持たせる）
        "source_urls_by_period": {str(p): HONBUN_URLS.get(p) for p in PLAN_LANGUAGE_PERIODS},
        "note": (
            "単語の出現頻度であり政策の重要度そのものではない。本文PDFの期別URLは"
            "source_urls_by_period（plans_historyの各期honbun_urlと同一）を参照。"
            "第1・2期は本文PDFが公式サイトに"
            "現存せず対象外（第3〜7期のみ）。pdftotextのレイアウト抽出テキストに基づくため、"
            "本文だけでなく表・脚注・目次等も対象に含まれ、抽出時のレイアウト崩れによる誤差が"
            "あり得る。カウントは空白・改行を除去した文字列に対する単純部分一致で、重複部分"
            "文字列は問題視しない（例:「安全保障」は「経済安全保障」を包含してカウント。"
            "「宇宙」が「宇宙人」等に誤爆する可能性も無視する）。集約規則: スタートアップ="
            "「スタートアップ」+「ベンチャー」、ＡＩ=「ＡＩ」+「人工知能」+半角「AI」（前後が"
            "英数字でない場合のみ）、人文・社会科学=「人文・社会科学」+「人文社会科学」+"
            "「人文学及び社会科学」、デジタルは単独集計（「ＩＴ」「情報通信」は合算しない）。"
            "空白除去の副作用として、英語混じりの箇所でまれに語間の連結により半角「AI」の"
            "境界判定に誤差が生じうるが、本文はほぼ日本語のため実務上の影響は無視できる。"
        ),
    }


# ----------------------------------------------------------- strategy_language

def _fetch_strategy_text(year: int) -> str:
    url = STRATEGY_LANGUAGE_URLS[year]
    cache_relpath = url.rsplit("/", 1)[-1]
    pdf_bytes = fetch_with_cache(url, cache_relpath, magic=b"%PDF")
    return pdftotext_layout(pdf_bytes)


MIN_STRATEGY_DOC_LENGTH = 20_000  # 正規化後の文字数がこれ未満なら抽出失敗を疑う


def strategy_language_block(previous: dict[str, object] | None) -> dict[str, object]:
    """plan_language の年次解像度版。統合イノベーション戦略2018〜2026本文を対象に、
    plan_language と同じ18語・同じ集約規則・同じ正規化ロジックで出現頻度を数える
    （PLAN_LANGUAGE_TERMS をそのまま共用し、term一覧・集約規則を重複定義しない）。
    """
    doc_lengths: dict[str, int] = {}
    normalized_by_year: dict[int, str] = {}
    for year in STRATEGY_LANGUAGE_YEARS:
        text = _fetch_strategy_text(year)
        normalized = _normalize_doc_text(text)
        normalized_by_year[year] = normalized
        doc_lengths[str(year)] = len(normalized)

    terms = []
    for key, rule, variants in PLAN_LANGUAGE_TERMS:
        counts = {}
        for year in STRATEGY_LANGUAGE_YEARS:
            n = _count_term(normalized_by_year[year], variants)
            length = doc_lengths[str(year)]
            per10k = round(n / length * 10000, 2) if length else None
            counts[str(year)] = {"n": n, "per10k": per10k}
        terms.append({"term": key, "rule": rule, "counts": counts})

    # 検証1: 2018〜2026の全9年分がそろっている
    missing_years = [y for y in STRATEGY_LANGUAGE_YEARS if str(y) not in doc_lengths]
    if missing_years:
        raise ValueError(f"strategy_language: 本文を取得できなかった年: {missing_years}")
    # 検証2: 各年の本文文字数（正規化後）が20,000字を上回る（抽出失敗の疑いを排除）
    for year in STRATEGY_LANGUAGE_YEARS:
        length = doc_lengths[str(year)]
        if length <= MIN_STRATEGY_DOC_LENGTH:
            raise ValueError(
                f"strategy_language: {year}年の本文文字数が{length}字と少なすぎる"
                f"（{MIN_STRATEGY_DOC_LENGTH}字以下）— 抽出失敗の疑い"
            )
    # 検証3: 全termの全年のper10kが有限かつ0以上
    for term in terms:
        for year in STRATEGY_LANGUAGE_YEARS:
            per10k = term["counts"][str(year)]["per10k"]
            if per10k is None or not math.isfinite(per10k) or per10k < 0:
                raise ValueError(f"strategy_language: 「{term['term']}」{year}年のper10kが不正（{per10k}）")
    # 検証4-a: 「安全保障」について独立した正規表現カウントと本採用の集計値が一致する
    # （plan_language と同じ自己検証パターン）。
    security = next(t for t in terms if t["term"] == "安全保障")
    security_variants = next(v for k, r, v in PLAN_LANGUAGE_TERMS if k == "安全保障")
    for year in STRATEGY_LANGUAGE_YEARS:
        independent = sum(len(re.findall(re.escape(v), normalized_by_year[year])) for v in security_variants)
        official_n = security["counts"][str(year)]["n"]
        if independent != official_n:
            raise ValueError(
                f"strategy_language: 自己検証不一致（安全保障, {year}年）: "
                f"独立カウント={independent}、本採用値={official_n}"
            )
    # 検証4-b: 「ＡＩ」について集約ロジックを経由しない独立集計と本採用の集計値が一致する。
    ai_official = next(t for t in terms if t["term"] == "ＡＩ")
    for year in STRATEGY_LANGUAGE_YEARS:
        doc = normalized_by_year[year]
        independent_ai = (
            len(re.findall("ＡＩ", doc))
            + len(re.findall("人工知能", doc))
            + len(re.findall(r"(?<![A-Za-z0-9])AI(?![A-Za-z0-9])", doc))
        )
        official_n = ai_official["counts"][str(year)]["n"]
        if independent_ai != official_n:
            raise ValueError(
                f"strategy_language: 自己検証不一致（ＡＩ, {year}年）: "
                f"独立カウント={independent_ai}、本採用値={official_n}"
            )
    print("[policy] strategy_language: 自己検証OK（安全保障の独立カウント一致、ＡＩの集約ロジック一致）")

    return {
        "status": "ok",
        "unit": "回/1万字",
        "years_covered": STRATEGY_LANGUAGE_YEARS,
        "terms": terms,
        "doc_lengths": doc_lengths,
        "source_urls_by_year": {str(y): STRATEGY_LANGUAGE_URLS[y] for y in STRATEGY_LANGUAGE_YEARS},
        "decision_dates_by_year": {str(y): STRATEGY_LANGUAGE_DECISIONS[y] for y in STRATEGY_LANGUAGE_YEARS},
        "source": {
            "title": "統合イノベーション戦略（各年、閣議決定文書）",
            "url": "https://www8.cao.go.jp/cstp/tougosenryaku/index.html",
        },
        "note": (
            "plan_languageと同じ18語・同じ集約規則（PLAN_LANGUAGE_TERMSを共用）・同じ正規化"
            "ロジックを、5年ごとの基本計画本文ではなく統合イノベーション戦略の年次本文に"
            "適用したもの。単語の出現頻度であり政策の重要度そのものではない。年別の本文/"
            "全体版PDF URLはsource_urls_by_year、閣議決定日はdecision_dates_by_yearを参照。"
            "2018〜2020年は本文PDFがwww8.cao.go.jp/cstp/直下（tougosenryaku/配下ではない）に"
            "所在。2021〜2023年はtougosenryaku/配下の本文（honbun）PDF、2024〜2026年は本文"
            "単体ではなく別紙等を含む「全体版」（zentai）を正式版として採用（2024・2025年は"
            "honbun.pdfも別途存在するが、公式ページが正式版として案内しているのはzentaiの"
            "方）。pdftotextのレイアウト抽出テキストに基づくため、本文だけでなく表・脚注・"
            "目次等も対象に含まれ、抽出時のレイアウト崩れによる誤差があり得る。カウントは"
            "空白・改行を除去した文字列に対する単純部分一致で、重複部分文字列は問題視しない。"
        ),
    }


# ----------------------------------------------------------- domain_lineage

# 各期の重点分野・技術領域の一覧。groups は本文中のラベル付きグルーピング（ラベルが本文に
# ない期は group に通称であることを note で明記）。第7期分（p7）の items は空のまま残し、
# domain_lineage_block() で tech_domains ブロックの domains から実行時に埋める（再転記しない）。
# 出典: 各期科学技術基本計画・科学技術・イノベーション基本計画本文（閣議決定文書）。
# 第2期のみ本文PDFへの直接リンクが公式ページになく、NDL WARP保存版で確認した
# （https://warp.ndl.go.jp/20250911/20250901044924/https://www8.cao.go.jp/cstp/kihonkeikaku/honbun.html）。
# 第3期以降は HONBUN_URLS と同じ本文PDF（www8.cao.go.jp/cstp/kihonkeikaku/{honbun,4honbun,
# 5honbun,6honbun,7honbun}.pdf）で確認した。
DOMAIN_LINEAGE_PERIODS: list[dict[str, object]] = [
    {
        "key": "p2", "period": 2, "decided": "2001-03-30", "label": "第2期",
        "groups": [
            {
                "group": "重点的に資源配分する4分野",
                "note": "「重点4分野」は通称で本文にラベルなし。",
                "items": ["ライフサイエンス", "情報通信", "環境", "ナノテクノロジー・材料"],
            },
            {"group": "上記以外の4分野", "items": ["エネルギー", "製造技術", "社会基盤", "フロンティア"]},
        ],
    },
    {
        "key": "p3", "period": 3, "decided": "2006-03-28", "label": "第3期",
        "groups": [
            {
                "group": "重点推進４分野",
                "note": "本文で初めてラベル定義。",
                "items": ["ライフサイエンス", "情報通信", "環境", "ナノテクノロジー・材料"],
            },
            {"group": "推進４分野", "items": ["エネルギー", "ものづくり技術", "社会基盤", "フロンティア"]},
        ],
    },
    {
        "key": "p4", "period": 4, "decided": "2011-08-19", "label": "第4期",
        "transition": True,
        "transition_label": "課題達成型へ転換 — 分野の看板を降ろした5年",
        "note": (
            "本文が「重点推進４分野及び推進４分野に基づく重点化から、重要課題の達成に向けた"
            "施策の重点化へ、方針を大きく転換する」と明記。正式用語は課題達成型（「課題解決型」"
            "ではない）。"
        ),
        "groups": [
            {"group": "課題達成型の柱", "items": ["震災からの復興・再生", "グリーンイノベーション", "ライフイノベーション"]},
        ],
    },
    {
        "key": "p5", "period": 5, "decided": "2016-01-22", "label": "第5期",
        "groups": [
            {
                "group": "超スマート社会サービスプラットフォームに必要な基盤技術",
                "items": ["サイバーセキュリティ技術", "IoTシステム構築技術", "ビッグデータ解析技術", "AI技術", "デバイス技術", "ネットワーク技術", "エッジコンピューティング"],
            },
            {
                "group": "新たな価値創出のコアとなる強みを有する基盤技術",
                "items": ["ロボット技術", "センサ技術", "アクチュエータ技術", "バイオテクノロジー", "ヒューマンインターフェース技術", "素材・ナノテクノロジー", "光・量子技術"],
            },
        ],
    },
    {
        "key": "p6", "period": 6, "decided": "2021-03-26", "label": "第6期",
        "note": (
            "本文は独自リストを持たず分野別戦略を束ねる。環境エネルギー・安全・安心は本文"
            "他章に既述だが、分野別戦略の8領域リストには独立項目としては含まれない。"
        ),
        "groups": [
            {"group": "分野別戦略", "items": ["AI技術", "バイオテクノロジー", "量子技術", "マテリアル", "健康・医療", "宇宙", "海洋", "食料・農林水産業"]},
        ],
    },
    {
        "key": "p7", "period": 7, "decided": "2026-03-27", "label": "第7期",
        "note": "17の新興・基盤技術領域。",
        "groups": [{"group": "17の新興・基盤技術領域", "items": []}],  # tech_domainsからdomain_lineage_block()内で充填
    },
]

# 第7期の17領域は1〜17の番号でtech_domainsの並び順（①〜⑰）を指す。国家戦略技術領域
# （集中投資対象）6領域の番号。
DOMAIN_LINEAGE_NATIONAL_STRATEGY_IDX = [12, 13, 14, 15, 16, 17]


def _dl_hop(from_period: str, from_item: str, to_period: str, to_item: str, note: str | None = None) -> dict[str, object]:
    return {"from_period": from_period, "from_item": from_item, "to_period": to_period, "to_item": to_item, "note": note}


def _build_domain_lineage_edges(domain_names: list[str]) -> list[dict[str, object]]:
    """domain_names は tech_domains.domains の17名称（①〜⑰の順）。flag は区間（hop）ごとに
    適用する: sure=名称（中核語）が両端で直接継承されている、または本文で確認できる改名
    （例: 製造技術→ものづくり技術）。interp=名称の継承がなく内容上の対応（編集部の解釈）。
    同名継続（エネルギー→エネルギー等）や中核語の継承（量子/バイオ/宇宙/AI/マテリアル等）
    のみを sure とし、エネルギー→グリーンイノベーションのような名称の切り替わりを伴う
    区間は、系譜として明確でも interp（点線）に倒す。同じ第7期領域に複数の来歴が合流する
    場合は、それぞれ独立したエントリとして追加する。"""
    D = domain_names  # D[i-1] が第7期の i 番目の領域名
    edges: list[dict[str, object]] = []

    def add(idx: int, hops: list[tuple[str, dict[str, object]]]) -> None:
        target = D[idx - 1]
        for flag, h in hops:
            edges.append({"domain": target, "flag": flag, **h})

    add(1, [("interp", _dl_hop("p2", "社会基盤", "p7", D[0]))])
    add(2, [("interp", _dl_hop("p2", "社会基盤", "p7", D[1]))])
    add(3, [
        ("sure", _dl_hop("p2", "情報通信", "p3", "情報通信")),
        ("interp", _dl_hop("p3", "情報通信", "p5", "サイバーセキュリティ技術")),
        ("interp", _dl_hop("p3", "情報通信", "p5", "IoTシステム構築技術")),
        ("sure", _dl_hop("p5", "サイバーセキュリティ技術", "p7", D[2])),
        ("interp", _dl_hop("p5", "IoTシステム構築技術", "p7", D[2])),
    ])
    add(4, [
        ("interp", _dl_hop("p2", "ライフサイエンス", "p6", "食料・農林水産業", "ライフサイエンス分野中の食料に関する記述を編集部が抽出し対応させた（中間期に食料・農林水産業として独立継続した記載はない）。")),
        ("sure", _dl_hop("p6", "食料・農林水産業", "p7", D[3])),
    ])
    add(5, [
        ("sure", _dl_hop("p2", "エネルギー", "p3", "エネルギー")),
        ("interp", _dl_hop("p3", "エネルギー", "p4", "グリーンイノベーション")),
        ("interp", _dl_hop("p4", "グリーンイノベーション", "p7", D[4], "第6期本文では「環境エネルギー」として他章に既述だが、分野別戦略の8領域リストには独立項目としては含まれない。")),
    ])
    add(5, [
        ("sure", _dl_hop("p2", "環境", "p3", "環境")),
        ("interp", _dl_hop("p3", "環境", "p7", D[4], "環境分野（第2〜3期）は資源・エネルギー安全保障・GX関連技術（第7期）へ内容上対応すると編集部が解釈。")),
    ])
    add(6, [
        ("sure", _dl_hop("p2", "社会基盤", "p3", "社会基盤")),
        ("interp", _dl_hop("p3", "社会基盤", "p7", D[5], "第6期本文では「安全・安心」として他章に既述だが、分野別戦略の8領域リストには独立項目としては含まれない。")),
    ])
    add(7, [
        ("sure", _dl_hop("p2", "ライフサイエンス", "p3", "ライフサイエンス")),
        ("interp", _dl_hop("p3", "ライフサイエンス", "p4", "ライフイノベーション")),
        ("interp", _dl_hop("p4", "ライフイノベーション", "p6", "健康・医療")),
        ("sure", _dl_hop("p6", "健康・医療", "p7", D[6])),
    ])
    add(8, [
        ("sure", _dl_hop("p2", "ナノテクノロジー・材料", "p3", "ナノテクノロジー・材料")),
        ("sure", _dl_hop("p3", "ナノテクノロジー・材料", "p5", "素材・ナノテクノロジー")),
        ("interp", _dl_hop("p5", "素材・ナノテクノロジー", "p6", "マテリアル", "「素材」から「マテリアル」への言い換えは内容上の対応として扱う（同一の字面継承ではない）。")),
        ("sure", _dl_hop("p6", "マテリアル", "p7", D[7])),
    ])
    add(8, [
        ("sure", _dl_hop("p2", "製造技術", "p3", "ものづくり技術", "第3期本文で確認できる改名。")),
        ("interp", _dl_hop("p3", "ものづくり技術", "p7", D[7], "ものづくり技術はその後の期で独立区分としては継続せず、マテリアル系へ合流したと編集部が解釈。")),
    ])
    add(9, [
        ("sure", _dl_hop("p2", "社会基盤", "p3", "社会基盤")),
        ("interp", _dl_hop("p3", "社会基盤", "p7", D[8])),
    ])
    add(10, [
        ("sure", _dl_hop("p2", "フロンティア", "p3", "フロンティア")),
        ("interp", _dl_hop("p3", "フロンティア", "p6", "海洋", "海洋開発はフロンティア分野の内訳項目で、独立の看板になるのは第6期。")),
        ("sure", _dl_hop("p6", "海洋", "p7", D[9])),
    ])
    # 11 = 防衛産業関連技術: 歴史的な来歴なし（first_appearanceで別途表現）
    add(12, [
        ("sure", _dl_hop("p5", "AI技術", "p6", "AI技術")),
        ("interp", _dl_hop("p5", "ロボット技術", "p6", "AI技術", "第6期はAI技術に統合、ロボット技術は独立区分として第6期には継続せず。")),
        ("sure", _dl_hop("p6", "AI技術", "p7", D[11])),
    ])
    add(13, [
        ("sure", _dl_hop("p5", "光・量子技術", "p6", "量子技術")),
        ("sure", _dl_hop("p6", "量子技術", "p7", D[12])),
    ])
    add(14, [
        ("interp", _dl_hop("p2", "情報通信", "p5", "デバイス技術")),
        ("interp", _dl_hop("p2", "情報通信", "p5", "ネットワーク技術")),
        ("interp", _dl_hop("p5", "デバイス技術", "p7", D[13])),
        ("interp", _dl_hop("p5", "ネットワーク技術", "p7", D[13])),
    ])
    add(15, [
        ("sure", _dl_hop("p2", "ライフサイエンス", "p3", "ライフサイエンス")),
        ("interp", _dl_hop("p3", "ライフサイエンス", "p5", "バイオテクノロジー")),
        ("sure", _dl_hop("p5", "バイオテクノロジー", "p6", "バイオテクノロジー")),
        ("sure", _dl_hop("p6", "バイオテクノロジー", "p7", D[14])),
    ])
    add(16, [
        ("sure", _dl_hop("p2", "エネルギー", "p3", "エネルギー", "核融合に明示言及。")),
        ("interp", _dl_hop("p3", "エネルギー", "p7", D[15], "独立領域としての切り出しは第7期が初。")),
    ])
    add(17, [
        ("sure", _dl_hop("p2", "フロンティア", "p3", "フロンティア")),
        ("interp", _dl_hop("p3", "フロンティア", "p6", "宇宙", "宇宙開発はフロンティア分野の内訳項目で、独立の看板になるのは第6期。")),
        ("sure", _dl_hop("p6", "宇宙", "p7", D[16])),
    ])
    return edges


def domain_lineage_block(tech_domains: dict[str, object] | None, plan_language: dict[str, object] | None) -> dict[str, object]:
    if not tech_domains or tech_domains.get("status") != "ok" or not isinstance(tech_domains.get("domains"), list):
        raise ValueError("domain_lineage: tech_domainsが取得できていない（第7期17領域名を参照できない）")
    domains = tech_domains["domains"]
    if len(domains) != 17:
        raise ValueError(f"domain_lineage: tech_domainsの領域数が17ではない（{len(domains)}）")
    D = [d["name"] for d in domains]

    periods = [dict(p) for p in DOMAIN_LINEAGE_PERIODS]
    for p in periods:
        p["groups"] = [dict(g) for g in p["groups"]]
        if p["key"] == "p7":
            p["groups"][0] = {**p["groups"][0], "items": list(D)}

    national_strategy = [D[i - 1] for i in DOMAIN_LINEAGE_NATIONAL_STRATEGY_IDX]
    edges = _build_domain_lineage_edges(D)

    # 防衛産業関連技術（11番目）は歴史的来歴を持たない第7期の初出領域。plan_languageで
    # 既に集計済みの「防衛」出現回数（第3〜7期）を裏付けとしてnoteに動的に埋め込む
    # （ハードコードした回数を別途持たない＝出典が二重管理にならない）。
    defense_name = D[10]
    defense_note = "第2〜6期の基本計画本文に先例なし（第7期で初めて重要技術領域として設定）。"
    if plan_language and plan_language.get("status") == "ok":
        term = next((t for t in plan_language.get("terms", []) if t.get("term") == "防衛"), None)
        if term:
            counts = term.get("counts", {})
            pre7 = "、".join(f"第{p}期{counts.get(str(p), {}).get('n', '—')}回" for p in [3, 4, 5, 6])
            n7 = counts.get("7", {}).get("n", "—")
            defense_note = f"第2〜6期の基本計画本文に先例なし。plan_languageの「防衛」出現回数は{pre7}に対し、第7期は{n7}回。"
    first_appearance = {"item": defense_name, "period": "p7", "note": defense_note}

    extinct = [
        {"name": "情報通信", "last_period": "p3", "fate": f"{D[2]}・{D[13]}・{D[11]}へ分散"},
        {"name": "社会基盤", "last_period": "p3", "fate": f"{D[8]}・{D[5]}へ分散"},
        {"name": "フロンティア", "last_period": "p3", "fate": f"{D[16]}・{D[9]}へ分割"},
        {"name": "グリーンイノベーション／ライフイノベーション（柱構造）", "last_period": "p4", "fate": "第7期で技術領域別の構成に回帰"},
        {"name": "安全・安心", "last_period": "p6", "fate": f"{D[5]}へ"},
    ]

    # 検証: 17領域全件が edges の domain 集合 と first_appearance のどちらかに過不足なく対応する
    chain_domains = {e["domain"] for e in edges}
    covered = chain_domains | {first_appearance["item"]}
    all_p7 = set(D)
    if covered != all_p7:
        raise ValueError(
            f"domain_lineage: 17領域とedges/first_appearanceの対応が一致しない"
            f"（missing={all_p7 - covered}, extra={covered - all_p7}）"
        )
    if len(national_strategy) != 6:
        raise ValueError(f"domain_lineage: national_strategyが6件ではない（{len(national_strategy)}件）")
    if not set(national_strategy) <= all_p7:
        raise ValueError("domain_lineage: national_strategyにtech_domainsに存在しない名称が含まれる")
    if len(extinct) != 5:
        raise ValueError(f"domain_lineage: extinctが5件ではない（{len(extinct)}件）")
    print(f"[policy] domain_lineage: {len(edges)}区間・17領域（うち国家戦略{len(national_strategy)}・初出1）を検証")

    return {
        "status": "ok",
        "periods": periods,
        "edges": edges,
        "extinct": extinct,
        "first_appearance": first_appearance,
        "national_strategy": national_strategy,
        "source": {
            "title": "各期科学技術基本計画・科学技術・イノベーション基本計画本文（内閣府CSTI）",
            "url": CSTP_KIHON_INDEX,
        },
        "note": (
            "系譜の対応付けは、名称（中核語）の直接継承または本文で確認できる改名（実線）と、"
            "名称の継承を伴わない内容上の対応（点線・編集部の解釈）を、系譜チェーン全体ではなく"
            "区間ごとに区別している。第2期の「重点4分野」等の呼称は通称で、本文でラベルが定義されるのは"
            "第3期から。第2期は本文PDFへの直接リンクが公式ページになくNDL WARP保存版で確認した"
            "（https://warp.ndl.go.jp/20250911/20250901044924/https://www8.cao.go.jp/cstp/"
            "kihonkeikaku/honbun.html）。第3期以降はplans_historyと同じ本文PDF（www8.cao.go.jp/"
            "cstp/kihonkeikaku/{honbun,4honbun,5honbun,6honbun,7honbun}.pdf）で確認した。"
            "第7期の17領域名・要約はtech_domainsブロックをそのまま参照している。"
        ),
    }


# --------------------------------------------------------------- youth_programs

# 若手研究者・博士学生向けの主要9事業。開始・終了年度、規模、現況は各機関の公表資料
# （JSPS/JST/MEXT公式ページ・パンフレット・実績PDF）を編集部が手動で確認して書き起こした
# 定数（2026-08時点）。target は "博士学生"|"若手研究者"|"機関支援" の1件以上のリストで、
# 複数対象にまたがる事業（特別研究員・BOOST）は両方を保持する。end_fy=null は継続中を表す。
# status_note は「公式に終了・継続未確認」等、一次資料だけでは判定しきれない事項の注記
# （テニュアトラック普及・定着事業のように継続状況を示す一次資料が確認できないケース）。
YOUTH_PROGRAMS: list[dict[str, object]] = [
    {
        "key": "tokubetsu_kenkyuin", "name": "特別研究員（DC/PD/RPD）", "agency": "JSPS",
        "target": ["博士学生", "若手研究者"], "start_fy": 1985, "end_fy": None,
        "status_note": None,
        "scale": (
            "DC月額20万円（2024年度から最終年次に評価条件付き特別手当+3万円、2027年度新規採用"
            "分から22.7万円へ増額予定）。PD/RPD月額36.2万円。R8（2026年度）採用: DC1 634人"
            "（採用率11.3%）/DC2 1,026人（11.9%）/PD 354人（22.9%）/RPD 70人（43.5%）。"
        ),
        "events": [
            {"fy": 2021, "label": "兼業緩和", "projected": False},
            {"fy": 2024, "label": "最終年次手当", "projected": False},
            {"fy": 2027, "label": "増額予定", "projected": True},
        ],
        "source": {"title": "特別研究員 採用状況（JSPS）", "url": "https://www.jsps.go.jp/j-pd/pd_saiyo.html"},
        "sources": [
            {"title": "特別研究員 採用状況（JSPS）", "url": "https://www.jsps.go.jp/j-pd/pd_saiyo.html"},
            {"title": "特別研究員 応募・採用（JSPS）", "url": "https://www.jsps.go.jp/j-pd/pd_oubo.html"},
        ],
    },
    {
        "key": "postdoc_10k", "name": "ポストドクター等一万人支援計画", "agency": "文部省",
        "target": ["若手研究者"], "start_fy": 1996, "end_fy": 2000,
        "status_note": "5年計画として実施され2000年度に終了。",
        "scale": "博士号取得者1万人分の期限付き雇用資金を5年計画で配布。",
        "events": [],
        "source": {"title": "ポストドクター等一万人支援計画（文部省）", "url": None},
    },
    {
        "key": "presto", "name": "さきがけ", "agency": "JST",
        "target": ["若手研究者"], "start_fy": 1991, "end_fy": None,
        "status_note": None,
        "scale": "研究費3,000〜4,000万円/課題（3.5年以内）、30〜40件/領域。",
        "events": [],
        "source": {"title": "戦略的創造研究推進事業 さきがけ について（JST）", "url": "https://www.jst.go.jp/kisoken/presto/about/index.html"},
    },
    {
        "key": "tenure_track", "name": "テニュアトラック普及・定着事業", "agency": "MEXT",
        "target": ["機関支援"], "start_fy": 2011, "end_fy": None,
        "status_note": "正式な終了・統合を示す一次資料は確認できておらず、継続状況は未確認。",
        "scale": "大学等における若手研究者向けテニュアトラック制の導入・定着を機関単位で支援。",
        "events": [],
        "source": {
            "title": "テニュアトラック普及・定着事業（文部科学省）",
            "url": "https://www.mext.go.jp/component/a_menu/science/detail/__icsFiles/afieldfile/2012/03/06/1309499_2.pdf",
        },
    },
    {
        "key": "takuetsu", "name": "卓越研究員事業", "agency": "MEXT",
        "target": ["若手研究者"], "start_fy": 2016, "end_fy": 2023,
        "status_note": "令和6年度以降の公募はなく、事実上終了。",
        "scale": "若手研究者に安定的なポストを用意する機関とのマッチング事業。",
        "events": [],
        "source": {"title": "卓越研究員事業（JSPS）", "url": "https://www.jsps.go.jp/j-le/index.html"},
    },
    {
        "key": "act_x", "name": "ACT-X", "agency": "JST",
        "target": ["若手研究者"], "start_fy": 2019, "end_fy": None,
        "status_note": None,
        "scale": "450〜600万円/課題（2.5年、加速で+最大1,000万円）、60〜90件/領域。前身のACT-I（2016〜）は別事業。",
        "events": [],
        "source": {"title": "戦略的創造研究推進事業 ACT-X について（JST）", "url": "https://www.jst.go.jp/kisoken/act-x/about/index.html"},
    },
    {
        "key": "souhatsu", "name": "創発的研究支援事業", "agency": "JST",
        "target": ["若手研究者"], "start_fy": 2020, "end_fy": None,
        "status_note": None,
        "scale": (
            "令和元年度補正500億円基金。平均700万円/年×原則7年（F1: 3年2,000万円+F2: 4年3,000万円、"
            "最長10年）。採択: 2020〜2025年度で毎期243〜263人、累計1,520人。"
        ),
        "events": [],
        "source": {"title": "創発的研究支援事業 パンフレット（JST）", "url": "https://www.jst.go.jp/souhatsu/document/pamph25.pdf"},
        "sources": [
            {"title": "創発的研究支援事業 パンフレット（JST）", "url": "https://www.jst.go.jp/souhatsu/document/pamph25.pdf"},
            {"title": "創発的研究支援事業 基金創設について（CSTI、2019-12-19）", "url": "https://www8.cao.go.jp/cstp/gaiyo/yusikisha/20191219/siryo2-2-1.pdf"},
        ],
    },
    {
        "key": "spring", "name": "SPRING 次世代研究者挑戦的研究プログラム", "agency": "JST",
        "target": ["博士学生"], "start_fy": 2021, "end_fy": None,
        "status_note": None,
        "scale": (
            "初回公募2021年6月・59プロジェクト60大学。令和6年度実績: 80大学・10,434人。"
            "1人あたり上限290万円/年（生活費相当+研究費）。SPRING単独の年度予算額は大学"
            "フェローシップ創設事業と合算でしか公表されていない。"
        ),
        "events": [],
        "source": {"title": "SPRING 令和6年度支援実績（JST）", "url": "https://www.jst.go.jp/jisedai/spring/dl/disclosure/SPRING_R6_shien_jisseki.pdf"},
        "sources": [
            {"title": "SPRING 令和6年度支援実績（JST）", "url": "https://www.jst.go.jp/jisedai/spring/dl/disclosure/SPRING_R6_shien_jisseki.pdf"},
            {"title": "SPRING パンフレット2025（JST）", "url": "https://www.jst.go.jp/jisedai/spring/dl/brochure2025.pdf"},
        ],
    },
    {
        "key": "boost", "name": "BOOST 次世代AI人材育成プログラム", "agency": "JST",
        "target": ["博士学生", "若手研究者"], "start_fy": 2024, "end_fy": None,
        "status_note": None,
        "scale": "2024年4月に初回29件決定。",
        "events": [],
        "source": {"title": "BOOST 次世代AI人材育成プログラム 初回採択決定（JST）", "url": "https://www.jst.go.jp/pr/info/info1681/index.html"},
    },
]

YOUTH_OVERVIEW_SOURCE = {
    "title": "SPRING 博士後期課程学生への経済的支援（JST）",
    "url": "https://www.jst.go.jp/jisedai/spring/support-doctoral/index.html",
}

YOUTH_LIVING_SUPPORT_RECIPIENTS = [
    {"fy": 2021, "value": 16300, "note": "令和3年度・4施策合計（サイトの人材ページ図Cと同一出典系）"},
    {"fy": 2022, "value": 16000, "note": "既存支援約7,500+新規支援約8,800"},
]
YOUTH_LIVING_SUPPORT_TARGET = {"fy": 2025, "value": 22500, "note": "第6期基本計画の目標（修士からの進学者の約7割相当）"}

# 図B(1) 年間の新規採用・採択（人/年度、ストック量ではなくフロー量）。特別研究員の内訳は
# tokubetsu_kenkyuin.scale の R8採用数、創発は souhatsu.scale の直近期の採択数と同一値を
# 参照する（別々に定数を持たず、ここでも同じ値を書き起こす — 一次資料はどちらも各program
# のsourceと同一）。
YOUTH_ANNUAL_NEW = {
    "unit": "人/年度",
    "items": [
        {"key": "dc1", "label": "DC1", "value": 634, "fy_label": "R8(2026年度)"},
        {"key": "dc2", "label": "DC2", "value": 1026, "fy_label": "R8(2026年度)"},
        {"key": "pd", "label": "PD", "value": 354, "fy_label": "R8(2026年度)"},
        {"key": "rpd", "label": "RPD", "value": 70, "fy_label": "R8(2026年度)"},
        {"key": "souhatsu", "label": "創発", "value": 257, "fy_label": "2025年度"},
    ],
    "note": "各事業のその年度の新規採用・採択人数（ストック＝ある年度に支援を受けている人数とは単位が異なる）。",
}

# 図B(2) ある年度に支援を受けている人数（ストック量）。
YOUTH_CURRENT_STOCK = {
    "unit": "人",
    "items": [
        {"key": "spring", "label": "SPRING", "value": 10434, "fy_label": "令和6年度", "note": "80大学"},
    ],
    "living_support": {
        "value": YOUTH_LIVING_SUPPORT_RECIPIENTS[-1]["value"],
        "fy": YOUTH_LIVING_SUPPORT_RECIPIENTS[-1]["fy"],
        "note": "生活費相当額（年180万円以上）受給の博士学生",
        "target": YOUTH_LIVING_SUPPORT_TARGET,
    },
}

# 採用率チップ行（R8=2026年度採用分、JSPS特別研究員）。
YOUTH_ADOPTION_RATES = {
    "fy_label": "R8(2026年度)採用",
    "items": [
        {"key": "dc1", "label": "DC1", "rate": 11.3},
        {"key": "dc2", "label": "DC2", "rate": 11.9},
        {"key": "pd", "label": "PD", "rate": 22.9},
        {"key": "rpd", "label": "RPD", "rate": 43.5, "note": "出産・育児による中断からの復帰枠、申請者の約8割が女性"},
    ],
    "source": {"title": "特別研究員 採用状況（JSPS）", "url": "https://www.jsps.go.jp/j-pd/pd_saiyo.html"},
}


def youth_programs_block(previous: dict[str, object] | None) -> dict[str, object]:
    programs = [dict(p) for p in YOUTH_PROGRAMS]
    if len(programs) != 9:
        raise ValueError(f"youth_programs: 事業数{len(programs)}件（期待値9件）— 定数の過不足の疑い")
    for p in programs:
        if not p.get("key") or not p.get("name") or not p.get("agency"):
            raise ValueError(f"youth_programs: 必須フィールド欠落 {p}")
        if not isinstance(p.get("target"), list) or not p["target"]:
            raise ValueError(f"youth_programs: target が不正 {p.get('key')}")
        if not isinstance(p.get("start_fy"), int):
            raise ValueError(f"youth_programs: start_fy が不正 {p.get('key')}")
    # postdoc_10k・takuetsu は end_fy を持ちつつ status_note で終了を明記している想定
    expected_terminated = {"postdoc_10k", "takuetsu"}
    actual_terminated = {p["key"] for p in programs if p["end_fy"] is not None}
    if actual_terminated != expected_terminated:
        raise ValueError(f"youth_programs: 終了事業の集合が想定と不一致（実際={actual_terminated}）")
    print(f"[policy] youth_programs: {len(programs)}事業を検証（うち終了{len(actual_terminated)}件）")

    return {
        "status": "ok",
        "programs": programs,
        "overview": {
            "living_support_recipients": YOUTH_LIVING_SUPPORT_RECIPIENTS,
            "target": YOUTH_LIVING_SUPPORT_TARGET,
            "source": YOUTH_OVERVIEW_SOURCE,
        },
        "annual_new": YOUTH_ANNUAL_NEW,
        "current_stock": YOUTH_CURRENT_STOCK,
        "adoption_rates": YOUTH_ADOPTION_RATES,
        "source": {"title": "特別研究員 採用状況（JSPS）ほか各機関公表資料", "url": "https://www.jsps.go.jp/j-pd/pd_saiyo.html"},
        "note": (
            "開始・終了年度と規模はすべて各機関の公表資料で確認した値。SPRINGの単独予算額の"
            "ように合算でしか公表されない値、テニュアトラック事業の継続状況のように一次資料"
            "で確認できない事項は、その旨を明記している。"
        ),
    }


# ---------------------------------------------------------------- run helpers

def run_block(name: str, builder) -> dict[str, object]:
    try:
        block = builder()
        print(f"[policy] {name}: ok")
        return block
    except Exception as error:  # noqa: BLE001 — degrade gracefully, keep provenance
        print(f"[policy] {name}: FAILED — {error}")
        return {"status": "error", "note": str(error)}


BLOCK_NAMES = ["plans_history", "plan7_indicators", "tech_domains", "plan_language", "strategy_language", "indicator_observations", "domain_lineage", "youth_programs"]
# domain_lineage は tech_domains（第7期17領域名）と plan_language（防衛の出現回数）に
# 依存するため、この2ブロックの「前回値保持」フォールバックが確定したあとに構築する
# （フォールバックが起きた回でも domain_lineage が有効な入力を参照できるようにするため）。
_DOMAIN_LINEAGE_DEPS = ["plans_history", "plan7_indicators", "tech_domains", "plan_language", "strategy_language"]


def main() -> int:
    global CACHE_DIR
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--cache-dir", type=Path, default=None,
                         help="Local fallback directory used only when a live fetch fails.")
    args = parser.parse_args()
    CACHE_DIR = args.cache_dir

    previous: dict[str, object] = {}
    if args.output.exists():
        try:
            previous = json.loads(args.output.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            previous = {}

    payload: dict[str, object] = {"generated_at": now_iso()}
    payload["plans_history"] = run_block("plans_history", lambda: plans_history_block(previous.get("plans_history")))
    payload["plan7_indicators"] = run_block("plan7_indicators", lambda: plan7_indicators_block(previous.get("plan7_indicators")))
    payload["tech_domains"] = run_block("tech_domains", lambda: tech_domains_block(previous.get("tech_domains")))
    payload["plan_language"] = run_block("plan_language", lambda: plan_language_block(previous.get("plan_language")))
    payload["strategy_language"] = run_block("strategy_language", lambda: strategy_language_block(previous.get("strategy_language")))
    payload["indicator_observations"] = run_block(
        "indicator_observations", lambda: indicator_observations_block(previous.get("indicator_observations"))
    )
    if payload["indicator_observations"].get("status") != "ok" and previous.get("indicator_observations", {}).get("status") == "ok":
        kept = previous["indicator_observations"]
        kept["note"] = f"{kept.get('note', '')} 直近の取得に失敗したため前回取得値を表示。".strip()
        payload["indicator_observations"] = kept
        print("[policy] indicator_observations: kept previous ok block")

    # 一時的な取得失敗で公開済みの正常データを潰さない: 前回ファイルの正常ブロックを保持
    # （domain_lineage が tech_domains/plan_language に依存するため、このフォールバックを
    # 先に確定させてから domain_lineage_block を呼ぶ）
    for key in _DOMAIN_LINEAGE_DEPS:
        if payload[key].get("status") != "ok" and previous.get(key, {}).get("status") == "ok":
            kept = previous[key]
            kept["note"] = f"{kept.get('note', '')} 直近の取得に失敗したため前回取得値を表示。".strip()
            payload[key] = kept
            print(f"[policy] {key}: kept previous ok block")

    payload["domain_lineage"] = run_block(
        "domain_lineage",
        lambda: domain_lineage_block(payload.get("tech_domains"), payload.get("plan_language")),
    )
    if payload["domain_lineage"].get("status") != "ok" and previous.get("domain_lineage", {}).get("status") == "ok":
        kept = previous["domain_lineage"]
        kept["note"] = f"{kept.get('note', '')} 直近の取得に失敗したため前回取得値を表示。".strip()
        payload["domain_lineage"] = kept
        print("[policy] domain_lineage: kept previous ok block")

    payload["youth_programs"] = run_block("youth_programs", lambda: youth_programs_block(previous.get("youth_programs")))
    if payload["youth_programs"].get("status") != "ok" and previous.get("youth_programs", {}).get("status") == "ok":
        kept = previous["youth_programs"]
        kept["note"] = f"{kept.get('note', '')} 直近の取得に失敗したため前回取得値を表示。".strip()
        payload["youth_programs"] = kept
        print("[policy] youth_programs: kept previous ok block")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    size_mb = len(text.encode("utf-8")) / 1_000_000
    print(f"[policy] payload size: {size_mb:.3f} MB")
    # 実行中断で公開JSONが空・途中状態にならないよう、一時ファイル経由で原子的に置き換える
    tmp_path = args.output.with_suffix(".json.tmp")
    tmp_path.write_text(text, encoding="utf-8")
    os.replace(tmp_path, args.output)
    print(f"[policy] wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
