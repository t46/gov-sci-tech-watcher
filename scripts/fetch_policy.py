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

Sources (all official, no key required):
- 内閣府 CSTI「科学技術基本計画及び科学技術・イノベーション基本計画」本文PDF
  (www8.cao.go.jp/cstp/kihonkeikaku/) — 第3期はhonbun.pdf、第4期以降はNhonbun.pdf
  （N=4,5,6,7）。第1・2期は同ページから直接の本文PDFリンクが確認できず（国立国会図書館
  WARPの archived ページへのリンクのみ）、honbun_url は null のままとする。
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
- tech_domains: 統合イノベーション戦略の「17の重要技術領域」。名称は本文の丸数字見出し
  （①〜⑰）から、要約は各領域の（現状認識）節の冒頭の一文をそのまま抜粋（句点まで丸ごと、
  地の文からの逐語抜粋のみで要約を作文しない。文の長さは原文次第で30〜110字程度まで
  ばらつく）。検証として領域数が17件であること、各要約が句点で終わる完結した文である
  ことを確認する。

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
HONBUN_URLS: dict[int, str | None] = {
    1: None,
    2: None,
    3: CSTP_KIHON_BASE + "honbun.pdf",
    4: CSTP_KIHON_BASE + "4honbun.pdf",
    5: CSTP_KIHON_BASE + "5honbun.pdf",
    6: CSTP_KIHON_BASE + "6honbun.pdf",
    7: CSTP_KIHON_BASE + "7honbun.pdf",
}

TOGO_URL = "https://www8.cao.go.jp/cstp/tougosenryaku/togo2026_zentai.pdf"
TOGO_TITLE = "統合イノベーション戦略2026"
TOGO_DECISION = "2026-07-14"

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
        "honbun_url": None,
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
            "なかった項目はnull（推計では埋めない）。第1・2期は公式ページに本文PDFへの直接"
            "リンクが確認できず honbun_url は null（国立国会図書館WARPの archived ページの"
            "みリンクあり）。第7期の60兆円/180兆円/43.6兆円は本文から実際にgrepして検証済み"
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
            "当年のものに更新すること。"
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


BLOCK_NAMES = ["plans_history", "plan7_indicators", "tech_domains"]


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

    # 一時的な取得失敗で公開済みの正常データを潰さない: 前回ファイルの正常ブロックを保持
    for key in BLOCK_NAMES:
        if payload[key].get("status") != "ok" and previous.get(key, {}).get("status") == "ok":
            kept = previous[key]
            kept["note"] = f"{kept.get('note', '')} 直近の取得に失敗したため前回取得値を表示。".strip()
            payload[key] = kept
            print(f"[policy] {key}: kept previous ok block")

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
