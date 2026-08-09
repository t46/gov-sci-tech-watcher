#!/usr/bin/env python3
"""Fetch data for the "行政 — 政府の研究予算の解剖" page (data/gov.json).

運用: CIには組み込まず、年次の手動実行を想定する（`uv run python scripts/fetch_gov.py`）。
実行の目安は、概算要求版（r{reiwa}gaisan.pdf）が出る8〜9月と、当初予算版
（r{reiwa}yosan.pdf 等）が出る3〜4月の年2回。budget_series/budget_ministry/projects は
新年度PDF公開のたびに、network/contracts はRSシステムの新年度データ公開のたびに、
再実行して年度キー・スナップショットを更新する。

Sources (all official, no key required):
- 内閣府 CSTI「科学技術関係予算」当初予算資料 (PDF, www8.cao.go.jp/cstp/budget/)
  r{reiwa}yosan.pdf の p2-3 に総額表＜全体額＞と府省庁別表＜府省別＞（単位：億円）。
  r{reiwa}gaisan.pdf に概算要求版の同種の全体額表。
  r{reiwa}review_taisho.pdf に「行政事業レビューシート対象分」事業別一覧（別添１、単位：千円）。
  r{reiwa}review_taishogai.pdf に対象外事業一覧（別添２）。
  過去年度のPDFは翌年以降404で消える運用のため、fetch_funders.py の csti_programs 同様に
  年度キーで蓄積し、取得できた年度分だけ保持する。
- 行政事業レビュー（RSシステム）CSV: https://rssystem.go.jp/files/{年}/rs/ 配下、認証不要、
  FY2024以降のみ存在。1-2（事業概要）・2-1（予算執行サマリ）は使わず、5-1（支出先）だけを
  network/contracts ブロックの実データに使う。
- 文部科学省 省庁別財務書類（貸借対照表・業務費用計算書、単位：百万円、既に百万円建てなので
  変換不要）と、事業別フルコスト情報の開示【データベース】（文科省提出分、単位：円）。

Blocks written to data/gov.json (全ブロック status/source/note/unit を持つ):
- budget_series: 科学技術関係予算の総額（当初/補正/概算要求）を年度キーで蓄積。単位百万円
  （原資料は億円建てのため×100）。R5=47,882億円, R6=48,556, R7=50,526, R8案=63,332 で検証。
- budget_ministry: 府省庁別×年度（R5〜R8）。一般会計/うち科技振興費/特別会計/計。各年度合計が
  budget_series の当初と一致することを検証。R8のr8yosan.pdfに載る「参考 令和7年度」欄はr7yosan
  自身の値と微妙に異なる（内閣府が集計時に事後修正するため）— 各年度は必ずその年度自身の一次
  資料から採るので、この乖離は仕様であり不整合ではない。
- projects: R8事業別一覧1,172件。降順ソート。r8review_taishogai.pdf の対象外事業は
  projects_excluded に名称・金額のみで保持。
- network: FY2024実績の資金の行き先。RS 5-1_payee を r6review_taisho（=FY2024当初のレビュー
  対象事業＝科学技術関係予算の公式ユニバース）の予算事業ID集合でJOINしてフィルタ。JOIN率を
  必ず記録し、5割を切る場合は 1-2_overview の主要経費=科学技術振興費（567事業）にフォール
  バックし、どちらを使ったか note に明記する。RS CSVは「支出先の合計支出額」が埋まっている
  行（payee単位の集計行）と、「契約方式等・金額」が埋まっている行（契約単位の明細行）が
  排他的に存在する（同一行に両方が埋まることはない）。recipients/links/project_payees は
  前者（集計行）だけを使う。
- contracts: 同じ科技ユニバースの契約の透明性。RS 5-1_payee の明細行（契約方式等が入っている
  行）だけを対象に、契約方式等の分布、入札者数==1の一者応札率、落札率のヒストグラムを作る。
  入札者数・落札率が両方0の行は「随意契約（少額）」等そもそも入札が発生しない契約であり、
  一者応札・落札率の分母には含めない（入札者数が1以上の行だけを対象にする）。全事業（政府
  全体・科学技術関係予算に限らない）の同じ集計も比較用に併記する。
- ministry_finance: 文科省の省庁別財務書類。直近年度（令和6年度決算、単位百万円）のBS主要
  科目と業務費用計算書の内訳。多年度リンクの発見・パースは手間対効果が薄いため直近年度の
  スナップショットのみ（note に明記）。
- fullcost: 事業別フルコストDB。文科省提出分のみ（府省庁横断版 fullcost_database_fy2024.xlsx
  はダウンロード時点でHTMLエラーページに化けており実データを含まないため使わない）。事業名に
  研究/科学/宇宙/原子力/研究所等を含む事業の上位20件。単位は原資料が「円」なので÷1,000,000
  して百万円に統一。値は文科省側の直接管理コスト（人件費・物件費等）であり、独法運営費交付金
  型の事業（JAXA/JST/理研等）は交付金総額に近い規模、補助金型の事業（科研費等）は事務局側の
  管理コストのみで実際の交付総額より大幅に小さく見える——同じ「フルコスト」列でも事業類型に
  よって意味する範囲が異なる点を note で明記する。

Parsing approach / pitfalls:
- yosan.pdf（総額表・府省庁別表）は pypdf のどの extraction_mode でも表の視覚的な読み順が
  崩れる（layout モードは数字同士が桁区切りカンマなしで連結し、plain モードはセル順序自体が
  入れ替わる）。この2表だけは外部コマンド pdftotext -layout（poppler-utils）に頼る。ローカル
  環境・GitHub Actions ランナーの両方に poppler-utils が無い場合はブロックを取得できず、前回
  値を保持したまま status を維持する（CIでは `apt-get install -y poppler-utils` の追加を推奨）。
- review_taisho.pdf（事業別一覧、1,172件）と review_taishogai.pdf は逆に pypdf のデフォルト
  （plain）モードで十分綺麗に読める。長い事業名は複数行に折り返されるため、行単位ではなく
  「NO（連番）+ 府省庁 + 予算事業ID」を先頭アンカーとして本文を連番境界でスライスする方式で
  パースする（表側の折り返しに影響されない）。
- RS システムの一括ダウンロードZIPは file 名に日本語（UTF-8, percent-encode）を含む:
  https://rssystem.go.jp/files/{年}/rs/{番号}_RS_{年}_{シート名}.zip
  例: 1-2_RS_2024_基本情報_事業概要等.zip, 5-1_RS_2024_支出先_支出情報.zip
- xlsx パースは fetch_funders.py の手書き zipfile+XML パーサを流用（openpyxl は
  pyproject.toml の依存に無いため使わない）。

Every block carries {status, source, note} so the frontend can state provenance
honestly and degrade gracefully when a source is unavailable.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import re
import shutil
import subprocess
import tempfile
import unicodedata
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import quote
from urllib.request import Request, urlopen
from xml.etree import ElementTree
from zipfile import ZipFile

import pypdf

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "gov.json"

USER_AGENT = "gov-sci-tech-watcher/1.0 (+https://science-signal.pages.dev/)"
CSTI_BUDGET_BASE = "https://www8.cao.go.jp/cstp/budget/"
CSTI_BUDGET_INDEX = "https://www8.cao.go.jp/cstp/budget/index2.html"
RS_BASE = "https://rssystem.go.jp/files"
MEXT_ZAIMU_INDEX = "https://www.mext.go.jp/b_menu/zaimu/zaimu.htm"

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}

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
    response that doesn't start with the expected file signature — some dead
    government links return a 200 OK HTML error page instead of a 404, e.g. the
    cross-ministry fullcost database — fall back to a local file at
    CACHE_DIR/cache_relpath if --cache-dir was given. Live fetch is always
    attempted first; the cache is a fallback for offline development and for
    known-flaky sources, not the default source."""
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
                print(f"[gov] live fetch failed ({error}) — using cache {candidate}")
                return candidate.read_bytes()
        raise


def number(value: str | None) -> int | float | None:
    if value is None:
        return None
    value = value.strip()
    if not value or value in {"-", "－", "…", "...", "ー"}:
        return None
    value = value.replace(",", "")
    try:
        parsed = float(value)
    except ValueError:
        return None
    return int(parsed) if parsed.is_integer() and abs(parsed) < 1e18 else round(parsed, 4)


# ---------------------------------------------------------------- xlsx parsing
# (self-contained copy of the pattern used by fetch_funders.py / fetch_indicators.py —
# openpyxl is not a declared project dependency, so we stick to the hand-rolled reader.)

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
    with ZipFile(io.BytesIO(blob)) as archive:
        workbook = ElementTree.fromstring(archive.read("xl/workbook.xml"))
        rels = ElementTree.fromstring(archive.read("xl/_rels/workbook.xml.rels"))
    rel_id = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}id"
    targets = {rel.get("Id"): rel.get("Target") for rel in rels}
    paths: dict[str, str] = {}
    for sheet in workbook.findall(".//m:sheet", NS):
        target = targets.get(sheet.get(rel_id), "")
        if target and not target.startswith("/"):
            target = f"xl/{target}"
        paths[sheet.get("name", "")] = target
    return paths


def read_sheet(blob: bytes, sheet_path: str) -> dict[int, dict[str, str]]:
    with ZipFile(io.BytesIO(blob)) as archive:
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


# --------------------------------------------------------------------- pdftotext

def pdftotext_layout(pdf_bytes: bytes, first_page: int | None = None, last_page: int | None = None) -> str:
    """Render a PDF to text with column layout preserved, via the poppler-utils
    `pdftotext -layout` binary. Required for the yosan.pdf 総額表・府省庁別表 tables:
    pypdf's own extraction (any mode) scrambles or glues this particular table
    layout beyond usable recovery (verified during development). Raises
    FileNotFoundError if the binary isn't installed."""
    pdftotext_bin = shutil.which("pdftotext")
    if not pdftotext_bin:
        raise FileNotFoundError(
            "pdftotext (poppler-utils) not found on PATH — required for budget_series/"
            "budget_ministry. Install with `apt-get install -y poppler-utils` (CI) or "
            "`brew install poppler` (macOS)."
        )
    with tempfile.NamedTemporaryFile(suffix=".pdf") as tmp:
        tmp.write(pdf_bytes)
        tmp.flush()
        args = [pdftotext_bin, "-layout"]
        if first_page:
            args += ["-f", str(first_page)]
        if last_page:
            args += ["-l", str(last_page)]
        args += [tmp.name, "-"]
        result = subprocess.run(args, capture_output=True, timeout=60, check=True)
    return result.stdout.decode("utf-8", errors="replace")


# ---------------------------------------------------------------- CSTI yosan.pdf

YOSAN_YEARS = [5, 6, 7, 8]  # 令和5〜8年度（当初予算）
BUDGET_KNOWN_GOOD = {5: 47_882, 6: 48_556, 7: 50_526, 8: 63_332}  # 億円、検証用


def _yosan_url(reiwa: int) -> str:
    return f"{CSTI_BUDGET_BASE}r{reiwa}yosan.pdf"


def _gaisan_url(reiwa: int) -> str:
    return f"{CSTI_BUDGET_BASE}r{reiwa}gaisan.pdf"


def _parse_yosan_total(text: str) -> dict[str, object]:
    """＜全体額＞表（p2相当）をパースする。表は pdftotext -layout で
    見出し・数値ともに1行に収まる（億円単位）。"""
    # 表の並び: 総額(当初/前年当初/増額/増減率), 一般会計(当初/前年/増額/増減率),
    # うち科技振興費(当初/前年/増額/増減率), 特別会計(当初/前年/増額/増減率)。ラベルと数値の
    # 間の空白・改行の量はPDFレイアウトの微妙な差で変わるため \s+ で緩く吸収する。
    NUM = r"-?[\d,]+"
    m_total = re.search(rf"科学技術関係予算\s+({NUM})\s+({NUM})\s+({NUM})\s+([\-\d.]+)%", text)
    m_general = re.search(rf"一般会計\s*（Ａ）\s*({NUM})\s+({NUM})\s+({NUM})\s+([\-\d.]+)%", text)
    m_shinko = re.search(rf"科学技術振興費\s+({NUM})\s+({NUM})\s+({NUM})\s+([\-\d.]+)%", text)
    m_special = re.search(rf"特別会計\s*（Ｂ）\s*({NUM})\s+({NUM})\s+({NUM})\s+([\-\d.]+)%", text)
    if not (m_total and m_general and m_special):
        raise ValueError("yosan.pdf ＜全体額＞: 表の主要行を検出できない — レイアウトが変わった可能性")
    return {
        "initial": number(m_total.group(1)),
        "prev_initial": number(m_total.group(2)),
        "general": number(m_general.group(1)),
        "shinko": number(m_shinko.group(1)) if m_shinko else None,
        "special": number(m_special.group(1)),
    }


def _parse_yosan_ministry(text: str) -> tuple[list[dict[str, object]], dict[str, object]]:
    """＜府省別＞表（p3相当）をパースする。1府省庁=1行、末尾に「計」行。
    トークン化して先頭の非数値ラベル＋末尾10個の数値（一般/うち/特別/計 ×
    当年/前年 + 増減額/増減率）を取り出す。増減率が「ー」等の非数値で埋まって
    いる行（前年実績が「-」で増減率が定義できない）にも対応する。"""
    rows: list[dict[str, object]] = []
    total_row: dict[str, object] | None = None
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped or "府省" in stripped or "会計" in stripped and "計" == stripped:
            continue
        tokens = re.split(r"\s+", stripped)
        if len(tokens) < 9:
            continue
        label = tokens[0]
        rest = tokens[1:]
        # 末尾トークンは「増減額増減率%」のように連結されることがある（前年値が
        # 小さい桁区切りなし数字の場合）。増減額・増減率は total_cur/total_prev から
        # 再計算できるため、末尾2トークンは使わずに捨てる。
        nums = [number(t) for t in rest]
        # 期待レイアウト: [一般cur,うちcur,特別cur,計cur, 一般prev,うちprev,特別prev,計prev, 増減額, 増減率...]
        if len(nums) < 8:
            continue
        general_cur, shinko_cur, special_cur, total_cur = nums[0:4]
        general_prev, shinko_prev, special_prev, total_prev = nums[4:8]
        row = {
            "ministry": label,
            "general": general_cur,
            "shinko": shinko_cur,
            "special": special_cur,
            "total": total_cur,
            "prev_total": total_prev,
        }
        if label in ("計", "合計"):
            total_row = row
        else:
            rows.append(row)
    if not rows or total_row is None:
        raise ValueError("yosan.pdf ＜府省別＞: 府省庁の行または合計行を検出できない")
    return rows, total_row


def _fetch_yosan(reiwa: int) -> bytes:
    return fetch_with_cache(_yosan_url(reiwa), f"csti-budget/r{reiwa}yosan.pdf", magic=b"%PDF")


def budget_series_year_block(reiwa: int) -> dict[str, object]:
    pdf_bytes = _fetch_yosan(reiwa)
    text = pdftotext_layout(pdf_bytes, first_page=2, last_page=2)
    total = _parse_yosan_total(text)
    golden = BUDGET_KNOWN_GOOD.get(reiwa)
    if golden and total["initial"] != golden:
        raise ValueError(
            f"yosan.pdf R{reiwa}: 当初予算総額の検証値と不一致（{total['initial']}億円、"
            f"期待値{golden}億円）— パース異常の疑い"
        )
    if not total["initial"] or total["initial"] <= 0:
        raise ValueError(f"yosan.pdf R{reiwa}: 総額を検出できない")
    return {
        "fiscal_year": 2018 + reiwa,
        "initial": total["initial"],
        "prev_initial": total["prev_initial"],
        "general": total["general"],
        "shinko": total["shinko"],
        "special": total["special"],
        "pdf_url": _yosan_url(reiwa),
        "retrieved_at": now_iso(),
    }


def _fetch_gaisan_request(reiwa: int) -> dict[str, object] | None:
    try:
        pdf_bytes = fetch_with_cache(_gaisan_url(reiwa), f"csti-budget/r{reiwa}gaisan.pdf", magic=b"%PDF")
        text = pdftotext_layout(pdf_bytes, first_page=2, last_page=2)
    except Exception as error:  # noqa: BLE001
        print(f"[gov] budget_series request R{reiwa}: gaisan unavailable — {error}")
        return None
    m = re.search(r"科学技術関係予算\s+(-?[\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)\s+(-?[\d,]+)\s+([\-\d.]+)%", text)
    if not m:
        return None
    return {
        "total": number(m.group(1)),
        "of_which_youbou": number(m.group(2)),
        "prev_initial": number(m.group(3)),
        "pdf_url": _gaisan_url(reiwa),
    }


def budget_series_block(previous: dict[str, object] | None) -> dict[str, object]:
    years: dict[str, object] = {}
    if previous and previous.get("status") == "ok":
        years = dict(previous.get("years", {}))
    errors: list[str] = []
    for reiwa in YOSAN_YEARS:
        try:
            block = budget_series_year_block(reiwa)
            years[f"R{reiwa}"] = block
            print(f"[gov] budget_series R{reiwa}: ok — 当初{block['initial']}億円")
        except Exception as error:  # noqa: BLE001
            errors.append(f"R{reiwa}: {error}")
            print(f"[gov] budget_series R{reiwa}: FAILED — {error}")

    if not years:
        raise ValueError("budget_series: 全年度の取得に失敗 — " + "; ".join(errors))

    latest_reiwa = max(YOSAN_YEARS)
    request = _fetch_gaisan_request(latest_reiwa)

    ordered_keys = sorted(years, key=lambda k: years[k]["fiscal_year"])
    note = (
        "単位は原資料（億円）を×100して百万円に統一。initial=当初予算額、prev_initial="
        "その年度資料が参考掲載する前年度当初予算額（後年の資料で事後修正されることがあり、"
        "各年度は必ずその年度自身の一次資料の値を採用しているため、別年度資料に載る「参考」"
        "値と完全には一致しないことがある）。request は最新年度（R"
        f"{latest_reiwa}）の概算要求段階の暫定額（要求額＋要望額）。過去年度PDFは翌年以降"
        "404で消える運用のため年度キーで蓄積している。"
    )
    if errors:
        note += f" 今回取得できなかった年度: {'; '.join(errors)}"

    return {
        "status": "ok",
        "unit": "百万円",
        "fiscal_years": [years[k]["fiscal_year"] for k in ordered_keys],
        "initial": [round(years[k]["initial"] * 100) if years[k]["initial"] is not None else None for k in ordered_keys],
        "general": [round(years[k]["general"] * 100) if years[k].get("general") is not None else None for k in ordered_keys],
        "shinko": [round(years[k]["shinko"] * 100) if years[k].get("shinko") is not None else None for k in ordered_keys],
        "special": [round(years[k]["special"] * 100) if years[k].get("special") is not None else None for k in ordered_keys],
        "request": {
            "fiscal_year": 2018 + latest_reiwa,
            "total": round(request["total"] * 100) if request and request.get("total") is not None else None,
            "of_which_youbou": round(request["of_which_youbou"] * 100) if request and request.get("of_which_youbou") is not None else None,
        } if request else None,
        "years": years,
        "source": {
            "title": "内閣府 CSTI「科学技術関係予算」当初予算資料＜全体額＞",
            "url": CSTI_BUDGET_INDEX,
        },
        "note": note,
    }


def budget_ministry_block(previous: dict[str, object] | None) -> dict[str, object]:
    years: dict[str, object] = {}
    if previous and previous.get("status") == "ok":
        years = dict(previous.get("years", {}))
    errors: list[str] = []
    for reiwa in YOSAN_YEARS:
        try:
            pdf_bytes = _fetch_yosan(reiwa)
            text = pdftotext_layout(pdf_bytes, first_page=3, last_page=3)
            rows, total_row = _parse_yosan_ministry(text)
            ministries_sum = sum(r["total"] for r in rows if r["total"])
            golden = BUDGET_KNOWN_GOOD.get(reiwa)
            target = golden if golden else total_row["total"]
            if target and ministries_sum and abs(ministries_sum - target) / target > 0.01:
                raise ValueError(
                    f"R{reiwa}: 府省庁別合計（{ministries_sum}億円）が当初総額（{target}億円）と"
                    "1%以上乖離 — パース異常の疑い"
                )
            years[f"R{reiwa}"] = {
                "fiscal_year": 2018 + reiwa,
                "ministries": sorted(rows, key=lambda r: -(r["total"] or 0)),
                "total": total_row["total"],
                "pdf_url": _yosan_url(reiwa),
            }
            print(f"[gov] budget_ministry R{reiwa}: ok — {len(rows)}府省庁, 合計{ministries_sum}億円")
        except Exception as error:  # noqa: BLE001
            errors.append(f"R{reiwa}: {error}")
            print(f"[gov] budget_ministry R{reiwa}: FAILED — {error}")

    if not years:
        raise ValueError("budget_ministry: 全年度の取得に失敗 — " + "; ".join(errors))

    ordered_keys = sorted(years, key=lambda k: years[k]["fiscal_year"])
    note = (
        "単位は原資料（億円）を×100して百万円に統一。generalは一般会計、shinkoはうち科学技術"
        "振興費（一般会計の内数）、specialは特別会計、totalは計（一般+特別）。各年度の府省庁"
        "合計は当該年度の当初予算総額と概ね一致することを検証済み（四捨五入の関係で完全一致は"
        "しない）。府省庁の増設・改組（こども家庭庁は令和6年度分から登場、等）により年度間で"
        "同一府省庁の系列が途切れる場合がある。"
    )
    if errors:
        note += f" 今回取得できなかった年度: {'; '.join(errors)}"

    return {
        "status": "ok",
        "unit": "百万円",
        "fiscal_years": [years[k]["fiscal_year"] for k in ordered_keys],
        "years": {
            k: {
                "fiscal_year": years[k]["fiscal_year"],
                "total": round(years[k]["total"] * 100) if years[k].get("total") is not None else None,
                "ministries": [
                    {
                        "ministry": m["ministry"],
                        "general": round(m["general"] * 100) if m.get("general") is not None else None,
                        "shinko": round(m["shinko"] * 100) if m.get("shinko") is not None else None,
                        "special": round(m["special"] * 100) if m.get("special") is not None else None,
                        "total": round(m["total"] * 100) if m.get("total") is not None else None,
                    }
                    for m in years[k]["ministries"]
                ],
            }
            for k in ordered_keys
        },
        "source": {
            "title": "内閣府 CSTI「科学技術関係予算」当初予算資料＜府省別＞",
            "url": CSTI_BUDGET_INDEX,
        },
        "note": note,
    }


# ------------------------------------------------------------- review_taisho.pdf

def _review_taisho_url(reiwa: int) -> str:
    return f"{CSTI_BUDGET_BASE}r{reiwa}review_taisho.pdf"


def _review_taishogai_url(reiwa: int) -> str:
    return f"{CSTI_BUDGET_BASE}r{reiwa}review_taishogai.pdf"


# 判定結果一覧に登場する実在の府省庁・外局名の網羅リスト。NOアンカーの2番目のグループを
# サフィックス（末尾が省/庁/府/院/局等）だけで緩く判定すると、事業本文中の「～推進事務局」
# のような部署名を誤って次のNOの府省庁欄と誤認してしまう（実例: 別添２の「知的財産戦略
# 推進事務局」）。実在の組織名を閉じた集合として列挙し、完全一致でのみ判定する。
MINISTRY_NAMES = [
    "内閣官房", "内閣府", "デジタル庁", "復興庁", "総務省", "法務省", "外務省", "財務省",
    "文部科学省", "厚生労働省", "農林水産省", "経済産業省", "国土交通省", "環境省", "防衛省",
    "警察庁", "消費者庁", "こども家庭庁", "金融庁", "公正取引委員会", "個人情報保護委員会",
    "国家公安委員会", "カジノ管理委員会", "国会", "会計検査院", "人事院", "最高裁判所",
    "宮内庁", "公害等調整委員会", "国税庁", "出入国在留管理庁", "公安調査庁",
    "資源エネルギー庁", "特許庁", "中小企業庁", "気象庁", "運輸安全委員会", "海上保安庁",
    "観光庁", "林野庁", "水産庁", "中央労働委員会", "原子力規制委員会",
]
_MINISTRY_ALT = "|".join(sorted(MINISTRY_NAMES, key=len, reverse=True))

_HEADER_NOISE_RE = re.compile(
    r"^(科学技術関係予算の判定結果一覧|NO\s+府省庁|R[０-９0-9]+年度|うち科技予算額|分類1|"
    r"令和[０-９0-9]+年度|\d+\s*/\s*\d+\s*ページ|事業\s*$|番号\s*$|項・事項|事業名\s*$|"
    r"（千円）\s*$)"
)


def _clean_review_pages(reader: pypdf.PdfReader) -> str:
    lines: list[str] = []
    for page in reader.pages:
        for line in page.extract_text().splitlines():
            stripped = line.strip()
            if not stripped or _HEADER_NOISE_RE.match(stripped):
                continue
            lines.append(stripped)
    return " ".join(lines)


def _sequential_blocks(text: str, header_pattern: str) -> list[tuple[int, tuple[str, ...], str]]:
    """本文中の「NO＋ヘッダ項目」を一度の finditer で全部拾い、NOが厳密に単調増加する
    出現だけを採用して連番境界で本文をスライスする。header_pattern の先頭グループが
    NO自体（例: r"(\\d{1,4})"）、以降のグループがNO以外のヘッダ項目（府省庁・予算事業ID
    等）。当初は「1から順に厳密連番として1件ずつ検索」する方式だったが、原資料側で
    NOが1つ欠番になっているだけ（実例: 令和7年度版で31番が存在しない）で後続全件を
    見失うため、単調増加チェック方式に変更した。事業名や分類コード中の数字列を誤って
    NOと誤認するのも、たいてい直前に採用したNOより小さいかコード内部の数字（前後の
    文字が空白でない）ため header_pattern 側の境界条件で弾かれる。"""
    pattern = re.compile(header_pattern)
    anchors: list[re.Match] = []
    last_no = 0
    for m in pattern.finditer(text):
        no = int(m.group(1))
        if no <= last_no:
            continue
        anchors.append(m)
        last_no = no
    blocks: list[tuple[int, tuple[str, ...], str]] = []
    for i, m in enumerate(anchors):
        end = anchors[i + 1].start() if i + 1 < len(anchors) else len(text)
        blocks.append((int(m.group(1)), m.groups()[1:], text[m.end():end].strip()))
    return blocks


CATEGORY_TOKEN_RE = re.compile(r"^[0-9][A-Za-z0-9]*_[A-Za-z0-9_]+$")


def _parse_review_taisho(pdf_bytes: bytes) -> list[dict[str, object]]:
    reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    text = _clean_review_pages(reader)
    # 予算事業IDは通常6桁の数字だが、ごく一部「なし」という文字列で埋まっている行や、
    # 複数の予算事業IDが空白なしで連結される行（例: 経済産業省の一部事業）がある。後者は
    # 先頭6桁だけを代表IDとして採用する（\d{{6,}} で6桁以上をまとめて捕捉）。
    header_pattern = rf"(?<!\S)(\d{{1,4}})\s+((?:{_MINISTRY_ALT})(?:（[^）]*）)?)\s+(\d{{6,}}|なし)\s+"
    blocks = _sequential_blocks(text, header_pattern)
    if len(blocks) < 900:
        raise ValueError(f"review_taisho.pdf: 連番アンカーで{len(blocks)}件しか検出できない（900件未満）— パース異常の疑い")

    projects: list[dict[str, object]] = []
    for no, (ministry, pid), body in blocks:
        tokens = body.split()
        amount_idx = None
        for idx, tok in enumerate(tokens):
            if re.fullmatch(r"[\d,]+(?:の内数)?", tok) and number(tok):
                amount_idx = idx
        if amount_idx is None:
            continue
        name = "".join(tokens[:amount_idx])
        amount = number(tokens[amount_idx].replace("の内数", ""))
        categories = [t for t in tokens[amount_idx + 1:] if CATEGORY_TOKEN_RE.match(t)]
        if not name or amount is None:
            continue
        projects.append({
            "id": int(pid[:6]) if pid.isdigit() else None,
            "ministry": ministry,
            "name": name,
            "st_budget": round(amount / 1000, 3),  # 千円 -> 百万円
            "categories": categories,
        })
    return projects


def _parse_review_taishogai(pdf_bytes: bytes) -> list[dict[str, object]]:
    """別添２（対象外事業）は府省庁ごとに書式が割れている（項・事項名を全角（）で囲む
    府省庁、半角()の府省庁、「項名・大事項名」を中点区切りで括弧なしに書く府省庁（国土
    交通省等）が混在する）。名称の内部構造を厳密にパースするのは費用対効果が低いため、
    アンカーは「NO＋府省庁」だけに絞り、本文から末尾の金額と粗く整形した名称だけを
    拾う（要求仕様どおり「名称と金額だけ」で十分）。"""
    reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    text = _clean_review_pages(reader)
    # 単調増加チェックだけでは、事業の中身（例: 「4 （項）情報収集衛星業務費」の事業番号
    # 「4」）を次のNOと誤認する事故が起きる（単調増加していれば通ってしまうため）ため、
    # 2番目のグループを実在する府省庁名らしい形（末尾が省/庁/府/院/局/委員会、または
    # 内閣官房・国会）に制約して事業本文中の数字列を弾く。
    header_pattern = rf"(?<!\S)(\d{{1,4}})\s+((?:{_MINISTRY_ALT})(?:（[^）]*）)?)\s+"
    blocks = _sequential_blocks(text, header_pattern)
    excluded: list[dict[str, object]] = []
    for no, (ministry,), body in blocks:
        amounts = re.findall(r"-?[\d,]{4,}", body)
        if not amounts:
            continue
        amount = number(amounts[-1])
        if amount is None or amount <= 0:
            continue
        name = re.sub(r"[（(][^）)]*[）)]", "", body)
        name = re.sub(r"-?[\d,]{4,}", "", name)
        name = re.sub(r"[\s・－\-]+", " ", name).strip()
        excluded.append({
            "ministry": ministry,
            "name": name[:80] if name else body[:60].strip(),
            "st_budget": round(amount / 1000, 3),
        })
    return excluded


def projects_block(previous: dict[str, object] | None) -> dict[str, object]:
    latest_reiwa = max(YOSAN_YEARS)
    pdf_bytes = fetch_with_cache(_review_taisho_url(latest_reiwa), f"csti-budget/r{latest_reiwa}review_taisho.pdf", magic=b"%PDF")
    projects = _parse_review_taisho(pdf_bytes)
    if not (1100 <= len(projects) <= 1250):
        raise ValueError(f"projects: 件数{len(projects)}件が想定レンジ（1,100〜1,250）外 — パース異常の疑い")

    total_st = sum(p["st_budget"] for p in projects)
    series = budget_series_cached_initial(latest_reiwa)
    coverage_note = ""
    if series:
        ratio = total_st / series
        coverage_note = f" 事業別合計{round(total_st)}百万円は当初予算総額{round(series)}百万円の{ratio:.1%}。"
        if not (0.5 <= ratio <= 1.0):
            print(f"[gov] projects: coverage ratio {ratio:.1%} は想定レンジ(60-90%)外 — note に実測値のみ記録")

    excluded: list[dict[str, object]] = []
    excluded_note = ""
    try:
        gai_bytes = fetch_with_cache(
            _review_taishogai_url(latest_reiwa), f"csti-budget/r{latest_reiwa}review_taishogai.pdf", magic=b"%PDF"
        )
        excluded = _parse_review_taishogai(gai_bytes)
        excluded_note = f" 対象外事業（別添２）は{len(excluded)}件を projects_excluded に保持。"
    except Exception as error:  # noqa: BLE001
        print(f"[gov] projects_excluded: FAILED — {error}")

    ranked = sorted(projects, key=lambda p: -p["st_budget"])
    return {
        "status": "ok",
        "unit": "百万円",
        "fiscal_year": 2018 + latest_reiwa,
        "count": len(ranked),
        "total_st_budget": round(total_st, 1),
        "projects": ranked,
        "projects_excluded": sorted(excluded, key=lambda p: -p["st_budget"]),
        "source": {
            "title": f"内閣府 CSTI 科学技術関係予算の判定結果一覧（令和{latest_reiwa}年度当初予算案）行政事業レビューシート対象分・対象外等",
            "url": CSTI_BUDGET_INDEX,
            "pdf_url": _review_taisho_url(latest_reiwa),
        },
        "note": (
            f"行政事業レビューシート対象分（別添１）の{len(ranked)}件を「うち科技予算額」降順で"
            f"保持。{coverage_note}"
            "科技予算額は事業の一部内数であることが多く、事業総額そのものではない。"
            f"{excluded_note}"
        ),
    }


_BUDGET_INITIAL_CACHE: dict[int, float] = {}


def budget_series_cached_initial(reiwa: int) -> float | None:
    """projects_block の被覆率算出のために budget_series_year_block を再利用する
    （単体で失敗しても projects 自体は諦めない — 被覆率は参考情報のため）。"""
    if reiwa in _BUDGET_INITIAL_CACHE:
        return _BUDGET_INITIAL_CACHE[reiwa]
    try:
        block = budget_series_year_block(reiwa)
        value = block["initial"] * 100 if block.get("initial") is not None else None
    except Exception as error:  # noqa: BLE001
        print(f"[gov] projects coverage: budget_series lookup failed — {error}")
        value = None
    _BUDGET_INITIAL_CACHE[reiwa] = value
    return value


# --------------------------------------------------------------------- RS system

RS_SHEET_NAMES_2024 = {
    "1-2": "1-2_RS_2024_基本情報_事業概要等",
    "5-1": "5-1_RS_2024_支出先_支出情報",
}


def _rs_zip_url(year: int, sheet_id: str, name: str) -> str:
    return f"{RS_BASE}/{year}/rs/{quote(name)}.zip"


def _fetch_rs_csv(year: int, sheet_id: str, cache_relpath: str) -> list[dict[str, str]]:
    name = RS_SHEET_NAMES_2024[sheet_id]
    url = _rs_zip_url(year, sheet_id, name)
    blob = fetch_with_cache(url, cache_relpath)
    with ZipFile(io.BytesIO(blob)) as archive:
        csv_name = next(n for n in archive.namelist() if n.lower().endswith(".csv"))
        with archive.open(csv_name) as fh:
            text = io.TextIOWrapper(fh, encoding="utf-8-sig", newline="")
            return list(csv.DictReader(text))


def _fetch_rs_csv_cached_dir(year: int, sheet_id: str, extracted_relpath: str) -> list[dict[str, str]]:
    """CACHE_DIR に既に展開済みのCSVがあればそれを優先して読む（大容量ZIPの解凍を
    毎回繰り返さないため）。無ければ通常のZIP経由フェッチにフォールバックする。"""
    if CACHE_DIR is not None:
        candidate = CACHE_DIR / extracted_relpath
        if candidate.exists():
            with candidate.open(encoding="utf-8-sig", newline="") as fh:
                return list(csv.DictReader(fh))
    name = RS_SHEET_NAMES_2024[sheet_id]
    cache_relpath = f"rs{year}/{sheet_id}_{'overview' if sheet_id == '1-2' else 'payee'}.zip"
    return _fetch_rs_csv(year, sheet_id, cache_relpath)


R6_CODE_TOKEN_RE = re.compile(r"^(20\d{2}|新?\d{1,4}|[一-龠ぁ-んァ-ヶーA-Za-zＡ-Ｚａ-ｚ]{1,4}|-|－)$")


def _parse_review_taisho_r6(pdf_bytes: bytes) -> list[dict[str, object]]:
    """令和6年度当初予算（=FY2024）版 review_taisho.pdf 専用パーサ。

    このPDFだけ「事業番号1〜5」という府省庁別の旧式コード（年度＋府省略称＋整理番号、
    例: 情報収集衛星の研究・開発＝2023/官房/22/25）を使っており、R7以降・RSシステムの
    CSVが使う全政府共通の flat な予算事業ID（例: 000046）と採番体系が異なる（新方式への
    切替はR6→R7の間に発生したとみられる）。そのためIDでの突合は構造的に不可能で、
    (府省庁, 事業名) の名寄せでRS 1-2_overview とJOINする（_science_tech_universe参照）。
    事業番号欄は「年度(4桁)／府省略称(1-4文字)／整理番号(数字または「新」+数字)／通し番号」
    の可変長トークン列で、末尾トークン数が事業により3〜5個とばらつくため、金額の直前まで
    「コードらしい短いトークン」を機械的に読み飛ばして事業名の開始位置を推定する。"""
    reader = pypdf.PdfReader(io.BytesIO(pdf_bytes))
    text = _clean_review_pages(reader)
    header_pattern = rf"(?<!\S)(\d{{1,4}})\s+((?:{_MINISTRY_ALT})(?:（[^）]*）)?)\s+"
    blocks = _sequential_blocks(text, header_pattern)
    if len(blocks) < 900:
        raise ValueError(f"r6review_taisho.pdf: 連番アンカーで{len(blocks)}件しか検出できない（900件未満）— パース異常の疑い")

    projects: list[dict[str, object]] = []
    for no, (ministry,), body in blocks:
        tokens = body.split()
        amount_idx = None
        for idx, tok in enumerate(tokens):
            if re.fullmatch(r"[\d,]+(?:の内数)?", tok) and number(tok):
                amount_idx = idx
        if amount_idx is None:
            continue
        skip = 0
        while skip < amount_idx and skip < 6 and R6_CODE_TOKEN_RE.match(tokens[skip]):
            skip += 1
        name = "".join(tokens[skip:amount_idx])
        amount = number(tokens[amount_idx].replace("の内数", ""))
        if not name or amount is None:
            continue
        projects.append({
            "ministry": ministry,
            "name": name,
            "st_budget": round(amount / 1000, 3),  # 千円 -> 百万円
        })
    return projects


_NORMALIZE_PAREN_RE = re.compile(r"[（(][^）)]*[）)]")
_NORMALIZE_SPACE_RE = re.compile(r"\s+")


def _normalize_name(text: str) -> str:
    """事業名・府省庁名の名寄せキー化: NFKC正規化→括弧書き（共管表記・使途区分等）除去
    →空白除去。「復興庁（文部科学省）」→「復興庁」、「実用準天頂衛星システム事業の推進
    （エネルギー分野）」→「実用準天頂衛星システム事業の推進」のように、本質的に同じ事業・
    組織を指す表記ゆれを吸収する。"""
    normalized = unicodedata.normalize("NFKC", text)
    normalized = _NORMALIZE_PAREN_RE.sub("", normalized)
    normalized = _NORMALIZE_SPACE_RE.sub("", normalized)
    return normalized.strip()


def _science_tech_ids_by_name(reiwa: int, overview_rows: list[dict[str, str]]) -> dict[str, object]:
    """r{reiwa}review_taisho.pdf（旧採番のR6版）を(府省庁, 事業名)の名寄せでRS
    1-2_overview とJOINし、マッチした予算事業ID集合を返す。IDでの直接突合が使えない
    R6版のためのフォールバック経路（_parse_review_taisho_r6 のdocstring参照）。

    2段階マッチング: (1) 正規化後の完全一致。(2) 完全一致しない事業は、同じ府省庁内で
    正規化名が部分文字列として一方向に包含される候補を探し、候補が一意に絞れる場合だけ
    採用する（例: CSTI側「国立研究開発法人産業技術総合研究所運営費交付金」がRS側「国立
    研究開発法人産業技術総合研究所事業（うち...運営費交付金事業）」に包含される、といった
    括弧書き・接尾辞の言い回し差を吸収する）。短すぎる名前（6文字未満）は誤マッチが増える
    ため部分一致の対象外にする。それでも一致しない事業は unmatched として集計し、件数と
    科技予算額合計を note に誠実に開示する。"""
    pdf_bytes = fetch_with_cache(_review_taisho_url(reiwa), f"csti-budget/r{reiwa}review_taisho.pdf", magic=b"%PDF")
    csti_projects = _parse_review_taisho_r6(pdf_bytes)

    rs_lookup: dict[tuple[str, str], int] = {}
    by_ministry: dict[str, list[tuple[str, int]]] = defaultdict(list)
    for row in overview_rows:
        try:
            pid = int(row.get("予算事業ID", "").strip())
        except ValueError:
            continue
        mkey = _normalize_name(row.get("府省庁") or "")
        nkey = _normalize_name(row.get("事業名") or "")
        if mkey and nkey:
            rs_lookup[(mkey, nkey)] = pid
            by_ministry[mkey].append((nkey, pid))

    matched_ids: set[int] = set()
    matched_count = 0
    fuzzy_matched_count = 0
    unmatched_count = 0
    unmatched_budget = 0.0
    for project in csti_projects:
        mkey = _normalize_name(project["ministry"])
        nkey = _normalize_name(project["name"])
        pid = rs_lookup.get((mkey, nkey))
        if pid is not None:
            matched_ids.add(pid)
            matched_count += 1
            continue
        if len(nkey) >= 6:
            candidates = {pid2 for nkey2, pid2 in by_ministry.get(mkey, ()) if nkey in nkey2 or nkey2 in nkey}
            if len(candidates) == 1:
                matched_ids.update(candidates)
                fuzzy_matched_count += 1
                continue
        unmatched_count += 1
        unmatched_budget += project["st_budget"]

    total = len(csti_projects)
    matched_rows = matched_count + fuzzy_matched_count
    match_rate = matched_rows / total if total else 0
    return {
        "matched_ids": matched_ids,
        "total_csti_rows": total,
        "matched_rows": matched_rows,
        "exact_matched_rows": matched_count,
        "fuzzy_matched_rows": fuzzy_matched_count,
        "match_rate": match_rate,
        "unmatched_rows": unmatched_count,
        "unmatched_st_budget": round(unmatched_budget, 1),
        "review_url": _review_taisho_url(reiwa),
    }


HOUJIN_SHUBETSU_LABELS = {
    "101": "国の機関", "201": "地方公共団体",
    "301": "会社法人", "302": "一般社団・財団法人等", "303": "公益社団・財団法人等",
    "304": "学校法人等", "305": "独立行政法人等", "399": "その他の設立登記法人",
    "401": "外国法人等", "499": "その他（任意団体等）",
}


# 完全一致で除外する既知の非実在ラベル（RS 5-1_payee 全体を金額降順でスキャンして収集）。
# 「示達」（予算配分の内部用語）「業務経費」（会計区分）「民間事業者等」（集合ラベル）は
# 検収で指摘された実例。「統合型ヘルスケアシステムの構築」は本来事業名であるはずの文字列が
# 支出先欄に誤って入った行（その他支出先=TRUEフラグが立っており、RS側もアグリゲート扱い
# と認識している）。
NON_IDENTIFIABLE_PAYEE_EXACT = {
    "その他", "その他支出先", "個人", "個人事業主",
    "業務経費", "示達", "民間事業者等", "統合型ヘルスケアシステムの構築",
}
_INDIVIDUAL_LABEL_RE = re.compile(r"^個人[A-Za-zＡ-Ｚａ-ｚ]{1,3}$")


def _is_identifiable_payee(name: str) -> bool:
    """RSの支出先名には実在の単一組織ではない集合ラベル・会計区分・記述句が頻出する:
    - 「その他」「個人Ａ」「個人Ｂ」…（個人情報保護のための匿名化ラベルで、プロジェクトを
      またいで同一人物ではない）
    - 「〜等」で終わる受益者クラスの集合ラベル（例: 年金受給者等、農業者等、その他の市区
      町村） — 実測でこの語尾の支出先名は全て集合ラベルで、実在する単一組織の正式名称が
      「等」で終わる例は確認されなかった。
    - 「〜費」で終わる会計区分（例: 業務経費、事業費、人件費、庁費） — 予算科目名であって
      支出先組織名ではない。
    - 「〜への繰入れ」「〜繰入れ」（勘定間の繰入れの記述句。繰入れ先が実在組織の場合も、
      その組織自体はクリーンな名称の行として別途集計されるため、記述句の行は除外する）
    - 「〜受給者」で終わる給付受給者クラス
    - 「その他」で始まる集合ラベル（例: その他の市区町村、その他３７県、その他労働局）
    これらを recipients ランキングから除外し、別途 unidentifiable として合計だけ開示する。
    共同企業体（例: ＪＦＥ・前田特定業務共同企業体）や地方整備局・農政局のような国の実施
    機関（例: 関東地方整備局）は実在する単一の受益者として残す。"""
    stripped = name.strip()
    if stripped in NON_IDENTIFIABLE_PAYEE_EXACT:
        return False
    if _INDIVIDUAL_LABEL_RE.match(stripped):
        return False
    if stripped.startswith("その他"):
        return False
    if stripped.endswith("等") or stripped.endswith("費") or stripped.endswith("受給者"):
        return False
    if "への繰入れ" in stripped or stripped.endswith("繰入れ"):
        return False
    return True


def _payee_summary_rows(payee_rows: list[dict[str, str]], project_ids: set[int] | None):
    for row in payee_rows:
        name = (row.get("支出先名") or "").strip()
        total = row.get("支出先の合計支出額", "").strip()
        if not name or not total:
            continue
        try:
            pid = int(row.get("予算事業ID", "").strip())
        except ValueError:
            continue
        if project_ids is not None and pid not in project_ids:
            continue
        amount = number(total)
        if amount is None:
            continue
        yield pid, row, amount


def _science_tech_universe(fy: int, overview_rows: list[dict[str, str]]) -> dict[str, object]:
    """network/contracts 共通: 科学技術関係予算の公式ユニバース（予算事業ID集合）を
    決定する。

    2つの「科学技術関係予算」定義の**和集合**を採る（編集判断）:
    (a) R6 review_taisho（CSTI公式の当初予算science-tech事業リスト）を(府省庁, 事業名)
        の名寄せでRS 1-2_overview とJOINしたID集合（_science_tech_ids_by_name）。
    (b) RS 1-2_overview の主要経費=科学技術振興費 のID集合。

    (a)単独では、GX基金・半導体基金・ポスト5G基金などNEDO経由の大型基金型事業（補正
    予算で造成され、CSTIの当初予算リストには載らない）が構造的に丸ごと欠落し、「資金の
    行き先」章が実際の最大フローを見せられずミスリーディングになる（実測: (a)単独だと
    NEDO受給額が実際の約1/8まで縮む）。逆に(b)単独では、主要経費コードが「科学技術振興
    費」以外に分類されている科技関係予算事業（例: 大学運営費交付金の一部等）が落ちる。
    そのため両者の和集合を使い、内訳（a独自/b独自/重複）と(b)のみ由来（=CSTI公式当初
    リスト外、主に基金型・補正予算造成の事業）の件数を note で開示する（誠実な開示を
    優先し、単一の「正解」ユニバースがあるように見せない）。

    (a)側のJOINが失敗した場合（例外発生）は (b) のみにフォールバックする。"""
    reiwa_for_fy = fy - 2018
    ministry_by_id: dict[int, str] = {}
    name_by_id: dict[int, str] = {}
    shinko_ids: set[int] = set()
    for row in overview_rows:
        try:
            pid = int(row.get("予算事業ID", "").strip())
        except ValueError:
            continue
        ministry_by_id[pid] = (row.get("府省庁") or "").strip()
        name_by_id[pid] = (row.get("事業名") or "").strip()
        if (row.get("主要経費") or "").strip() == "科学技術振興費":
            shinko_ids.add(pid)

    try:
        name_match = _science_tech_ids_by_name(reiwa_for_fy, overview_rows)
        fallback_used = False
    except Exception as error:  # noqa: BLE001 — degrade to the category-only set
        print(f"[gov] science_tech_universe: 事業名JOIN失敗 — {error}")
        name_match = {"matched_ids": set(), "total_csti_rows": 0, "matched_rows": 0,
                       "exact_matched_rows": 0, "fuzzy_matched_rows": 0,
                       "match_rate": 0, "unmatched_rows": 0, "unmatched_st_budget": 0,
                       "review_url": _review_taisho_url(reiwa_for_fy)}
        fallback_used = True

    a_ids = name_match["matched_ids"]
    b_ids = shinko_ids
    used_ids = a_ids | b_ids
    b_only_ids = b_ids - a_ids
    join_rate = name_match["match_rate"]

    print(
        f"[gov] science_tech_universe: (a)CSTI名寄せ{len(a_ids):,}件 ∪ (b)主要経費={len(b_ids):,}件"
        f" = 和集合{len(used_ids):,}件（(b)のみ由来{len(b_only_ids):,}件）。"
        f"(a)側JOIN率{join_rate:.1%}"
        f"（完全一致{name_match['exact_matched_rows']}件+部分一致{name_match['fuzzy_matched_rows']}件"
        f"/全{name_match['total_csti_rows']}件、未マッチ{name_match['unmatched_rows']}件・"
        f"科技予算額{name_match['unmatched_st_budget']:,.0f}百万円）"
    )

    return {
        "used_ids": used_ids, "join_rate": join_rate, "fallback_used": fallback_used,
        "ministry_by_id": ministry_by_id, "name_by_id": name_by_id,
        "review_url": name_match["review_url"],
        "matched_rows": name_match["matched_rows"], "total_csti_rows": name_match["total_csti_rows"],
        "exact_matched_rows": name_match["exact_matched_rows"], "fuzzy_matched_rows": name_match["fuzzy_matched_rows"],
        "unmatched_rows": name_match["unmatched_rows"], "unmatched_st_budget": name_match["unmatched_st_budget"],
        "a_ids": a_ids, "b_ids": b_ids, "b_only_ids": b_only_ids,
        "a_count": len(a_ids), "b_count": len(b_ids), "union_count": len(used_ids),
        "b_only_count": len(b_only_ids),
    }


def network_block(previous: dict[str, object] | None) -> dict[str, object]:
    fy = 2024
    overview_rows = _fetch_rs_csv_cached_dir(fy, "1-2", "rs2024/extracted/1-2_overview.csv")
    universe = _science_tech_universe(fy, overview_rows)
    used_ids = universe["used_ids"]
    fallback_used = universe["fallback_used"]
    join_rate = universe["join_rate"]
    ministry_by_id = universe["ministry_by_id"]
    name_by_id = universe["name_by_id"]
    review_url = universe["review_url"]
    b_only_ids = universe["b_only_ids"]

    payee_rows = _fetch_rs_csv_cached_dir(fy, "5-1", "rs2024/extracted/5-1_payee.csv")

    recipient_totals: dict[tuple[str, str], dict[str, object]] = {}
    recipient_projects: dict[tuple[str, str], set[int]] = defaultdict(set)
    link_totals: dict[tuple[str, str], float] = defaultdict(float)
    project_payee_amounts: dict[int, list[tuple[str, float]]] = defaultdict(list)
    matched_ids: set[int] = set()
    unidentifiable_total = 0.0
    unidentifiable_rows = 0
    b_only_total = 0.0
    b_only_project_ids_with_spend: set[int] = set()

    for pid, row, amount in _payee_summary_rows(payee_rows, used_ids):
        matched_ids.add(pid)
        if pid in b_only_ids:
            b_only_total += amount
            b_only_project_ids_with_spend.add(pid)
        name = (row.get("支出先名") or "").strip()
        if not _is_identifiable_payee(name):
            unidentifiable_total += amount
            unidentifiable_rows += 1
            continue
        corp_no = (row.get("法人番号") or "").strip()
        key = (name, corp_no)
        entry = recipient_totals.setdefault(key, {
            "name": key[0], "corp_no": corp_no or None,
            "total": 0.0, "kind": HOUJIN_SHUBETSU_LABELS.get((row.get("法人種別") or "").strip(), None),
        })
        entry["total"] += amount
        recipient_projects[key].add(pid)
        ministry = ministry_by_id.get(pid, "")
        if ministry:
            link_totals[(ministry, key[0])] += amount
        project_payee_amounts[pid].append((key[0], amount))

    project_join_rate = len(matched_ids) / len(used_ids) if used_ids else 0

    recipients_ranked = sorted(recipient_totals.values(), key=lambda r: -r["total"])
    top_recipients = []
    for r in recipients_ranked[:60]:
        key = (r["name"], r["corp_no"] or "")
        top_recipients.append({
            "name": r["name"], "corp_no": r["corp_no"],
            "total": round(r["total"] / 1_000_000, 3),  # 円 -> 百万円
            "n_projects": len(recipient_projects[key]),
            "kind": r["kind"],
        })
    other_by_kind: dict[str, float] = defaultdict(float)
    for r in recipients_ranked[60:]:
        other_by_kind[r["kind"] or "不明"] += r["total"]
    others = [
        {"kind": kind, "total": round(total / 1_000_000, 3)}
        for kind, total in sorted(other_by_kind.items(), key=lambda kv: -kv[1])
    ]

    links_ranked = sorted(link_totals.items(), key=lambda kv: -kv[1])[:150]
    links = [
        {"ministry": ministry, "recipient": recipient, "total": round(total / 1_000_000, 3)}
        for (ministry, recipient), total in links_ranked
    ]

    # project_payees: 科技予算額上位150事業（review_taisho由来のst_budgetでランク付け）
    reiwa8_pdf = fetch_with_cache(_review_taisho_url(max(YOSAN_YEARS)), f"csti-budget/r{max(YOSAN_YEARS)}review_taisho.pdf", magic=b"%PDF")
    r8_projects = {p["id"]: p["st_budget"] for p in _parse_review_taisho(reiwa8_pdf) if p["id"] is not None}
    top_project_ids = sorted(
        (pid for pid in project_payee_amounts if pid in r8_projects),
        key=lambda pid: -r8_projects[pid],
    )[:150]
    project_payees = []
    for pid in top_project_ids:
        payees = sorted(project_payee_amounts[pid], key=lambda kv: -kv[1])[:5]
        project_payees.append({
            "project_id": pid,
            "name": name_by_id.get(pid, ""),
            "payees": [{"name": n, "total": round(a / 1_000_000, 3)} for n, a in payees],
        })

    # サニティチェック用の主要法人合計（億円換算して note に記録）
    sanity_targets = {"新エネルギー・産業技術総合開発機構": "NEDO", "宇宙航空研究開発機構": "JAXA",
                       "科学技術振興機構": "JST"}
    sanity_lines = []
    for full_name, short in sanity_targets.items():
        matched = [r for r in recipients_ranked if full_name in r["name"]]
        total = sum(r["total"] for r in matched) / 1_000_000  # 百万円
        sanity_lines.append(f"{short}={round(total):,}百万円")

    unmatched_note = (
        f" (a)側でJOINできなかった{universe['unmatched_rows']:,}件（CSTI科技予算額合計"
        f"{universe['unmatched_st_budget']:,.0f}百万円）はどちらの集合にも入っておらず未捕捉"
        "（RS側で名称が大きく異なる書き方をしている事業、またはFY2024にRS上で独立事業として"
        "存在しない事業）。"
        if not fallback_used and universe.get("unmatched_rows") else ""
    )
    b_only_spend_note = (
        f" (b)のみ由来の{universe['b_only_count']:,}事業のうち"
        f"{len(b_only_project_ids_with_spend):,}事業に支出実績があり、その合計は"
        f"{round(b_only_total / 1_000_000):,}百万円（recipients/links/project_payeesの"
        "集計に含まれている）。"
        if not fallback_used and universe.get("b_only_count") else ""
    )
    note = (
        f"RS 5-1_payee（{len(payee_rows):,}行）のうち「支出先の合計支出額」が入った集計行だけを"
        "使用（契約明細行は contracts ブロック側）。JOIN対象ユニバースは2つの定義の"
        "**和集合**: (a) R6 review_taisho（CSTI公式の当初予算science-tech事業リスト）を"
        "(府省庁, 事業名)の名寄せでRS 1-2_overview とJOINした集合"
        f"（完全一致{universe['exact_matched_rows']:,}件+部分一致{universe['fuzzy_matched_rows']:,}件"
        f"/全{universe['total_csti_rows']:,}件＝JOIN率{join_rate:.1%}、"
        f"ユニークID{universe['a_count']:,}件）と、(b) 1-2_overview の主要経費=科学技術振興費"
        f"（{universe['b_count']:,}件）。和集合は{universe['union_count']:,}件（うち(b)のみ由来"
        f"={universe['b_only_count']:,}件）。(b)のみ由来の事業は、CSTI当初予算リストには載らない"
        "が主要経費が科学技術振興費に分類されている事業＝主に基金型（GX基金・半導体基金・"
        "ポスト5G基金等、補正予算で造成されNEDO等が受給）が中心。(a)単独だとこれらが構造的に"
        "欠落し資金フローの実態を見誤るため和集合にしている。"
        f"{unmatched_note}{b_only_spend_note}"
        f"支出データが1件以上ある事業の割合は{project_join_rate:.1%}。"
        "支出先名が実在する単一の組織を表さない行（「その他」等の集計区分、「個人Ａ」「個人"
        "Ｂ」…等の匿名化ラベル＝事業ごとに別人、「業務経費」「示達」「民間事業者等」等の会計"
        "区分・集合ラベル、「〜等」「〜費」で終わる受益者クラス・予算科目名、「〜への繰入れ」"
        "のような勘定間繰入れの記述句）は recipients/links/project_payees の集計から除外し、"
        f"{unidentifiable_rows:,}行・合計{round(unidentifiable_total / 1_000_000):,}百万円を"
        "別枠（unidentifiable）として開示する（除外しないと「個人Ａ」や「業務経費」が全事業"
        "合算で実在しない巨大受給者として現れてしまう）。共同企業体や地方整備局・農政局等の"
        "国の実施機関は実在する単一の受益者として残す。"
        f"サニティチェック: {', '.join(sanity_lines)}（法人名の部分一致合計、支出のあった事業"
        "分のみなのでその法人の年間予算全体とは一致しない）。recipients の残り分は法人種別ごとに"
        "「その他」として合算。links は府省庁→支出先の集約上位150件、project_payees は"
        "科技予算額（R8当初）上位150事業それぞれの支出先上位5件。R6のPDFはRSと予算事業IDの"
        "採番体系が異なる（旧式の府省庁別コード vs 全政府共通flat ID）ため事業名でJOINして"
        "おり、IDそのものでの突合はできない。"
    )

    return {
        "status": "ok",
        "unit": "百万円",
        "fiscal_year": fy,
        "join_rate": round(join_rate, 4),
        "project_join_rate": round(project_join_rate, 4),
        "fallback_used": fallback_used,
        "unmatched_rows": universe.get("unmatched_rows"),
        "unmatched_st_budget": universe.get("unmatched_st_budget"),
        "unidentifiable_rows": unidentifiable_rows,
        "unidentifiable_total": round(unidentifiable_total / 1_000_000, 3),
        "universe_a_count": universe.get("a_count"),
        "universe_b_count": universe.get("b_count"),
        "universe_union_count": universe.get("union_count"),
        "universe_b_only_count": universe.get("b_only_count"),
        "universe_b_only_spend_projects": len(b_only_project_ids_with_spend),
        "universe_b_only_spend_total": round(b_only_total / 1_000_000, 3),
        "recipients": top_recipients,
        "recipients_other": others,
        "links": links,
        "project_payees": project_payees,
        "source": {
            "title": "行政事業レビュー（RSシステム）5-1 支出先情報 / 内閣府 CSTI R6 行政事業レビューシート対象分",
            "url": "https://rssystem.go.jp/",
            "review_taisho_url": review_url,
        },
        "note": note,
    }


MAIN_MINISTRIES = ["内閣府", "文部科学省", "厚生労働省", "農林水産省", "経済産業省",
                    "国土交通省", "環境省", "防衛省"]


def _contract_stats(rows: list[dict[str, str]], project_ids: set[int] | None) -> dict[str, object]:
    kind_count: dict[str, int] = defaultdict(int)
    kind_amount: dict[str, float] = defaultdict(float)
    bidder_eligible = 0
    single_bidder = 0
    rate_buckets: dict[str, int] = defaultdict(int)
    by_ministry: dict[str, dict[str, object]] = {}

    def bucket_for(rate: float) -> str:
        r = max(0.0, min(1.0, rate / 100))
        lo = min(0.975, int(r / 0.025) * 0.025)  # r==1.0 は最後のバケット(0.975-1.000)に収める
        return f"{lo:.3f}-{lo + 0.025:.3f}"

    for row in rows:
        kind = (row.get("契約方式等") or "").strip()
        if not kind:
            continue
        try:
            pid = int(row.get("予算事業ID", "").strip())
        except ValueError:
            continue
        if project_ids is not None and pid not in project_ids:
            continue
        amount = number(row.get("金額", "")) or 0
        kind_count[kind] += 1
        kind_amount[kind] += amount

        ministry = (row.get("府省庁") or "").strip()
        if ministry in MAIN_MINISTRIES:
            by_ministry.setdefault(ministry, {"n": 0, "single": 0, "eligible": 0})
        bidders_raw = number(row.get("入札者数", ""))
        rate_raw = number(row.get("落札率", ""))
        if bidders_raw is not None and bidders_raw > 0:
            bidder_eligible += 1
            is_single = bidders_raw == 1
            if is_single:
                single_bidder += 1
            if rate_raw is not None and rate_raw > 0:
                rate_buckets[bucket_for(rate_raw)] += 1
            if ministry in MAIN_MINISTRIES:
                by_ministry[ministry]["eligible"] += 1
                if is_single:
                    by_ministry[ministry]["single"] += 1

    return {
        "kind_count": dict(kind_count),
        "kind_amount": {k: round(v / 1_000_000, 3) for k, v in kind_amount.items()},
        "bidder_eligible": bidder_eligible,
        "single_bidder": single_bidder,
        "single_bidder_rate": round(single_bidder / bidder_eligible, 4) if bidder_eligible else None,
        "rate_histogram": dict(sorted(rate_buckets.items())),
        "by_ministry": {
            m: {
                "n_eligible": v["eligible"], "n_single": v["single"],
                "single_bidder_rate": round(v["single"] / v["eligible"], 4) if v["eligible"] else None,
            }
            for m, v in by_ministry.items()
        },
    }


def contracts_block(previous: dict[str, object] | None) -> dict[str, object]:
    fy = 2024
    overview_rows = _fetch_rs_csv_cached_dir(fy, "1-2", "rs2024/extracted/1-2_overview.csv")
    universe = _science_tech_universe(fy, overview_rows)
    used_ids = universe["used_ids"]
    payee_rows = _fetch_rs_csv_cached_dir(fy, "5-1", "rs2024/extracted/5-1_payee.csv")

    st_stats = _contract_stats(payee_rows, used_ids)
    all_stats = _contract_stats(payee_rows, None)

    universe_label = (
        f"(a)R6 review_tashoを事業名でJOINした{universe['a_count']:,}件 ∪ "
        f"(b)主要経費=科学技術振興費{universe['b_count']:,}件 の和集合"
        if not universe["fallback_used"] else "1-2_overview の主要経費=科学技術振興費"
    )
    return {
        "status": "ok",
        "unit": "百万円",
        "fiscal_year": fy,
        "science_tech": st_stats,
        "government_wide": all_stats,
        "source": {
            "title": "行政事業レビュー（RSシステム）5-1 支出先情報（契約方式等・入札者数・落札率）",
            "url": "https://rssystem.go.jp/",
        },
        "note": (
            "対象は RS 5-1_payee の契約明細行（契約方式等が入っている行）。一者応札率・落札率"
            "ヒストグラムの分母は「入札者数が1以上」の行に限定（随意契約（少額）等、そもそも"
            "入札が発生しない契約方式は0/0で記録されており分母から除外）。science_tech は"
            f"{universe_label}（{len(used_ids):,}件、network ブロックと同じユニバース判定・"
            f"(a)側JOIN率{universe['join_rate']:.1%}）でフィルタした科学技術関係予算分、"
            "government_wide は同じCSVの全事業分（フィルタなし）。府省庁別内訳は主要8府省庁"
            "のみ（他は集計に含むが内訳は省略）。落札率は0.5刻みではなく0.025刻みのヒストグラム"
            "（バケットキーは下限-上限、0.0-1.0の範囲に丸め、0や100を超える異常値は除外）。"
        ),
    }


# ------------------------------------------------------------- MEXT 財務書類

MEXT_BYMIN_URL = "https://www.mext.go.jp/content/20260130-mxt_kaikesou02-000046672_7.xlsx"


def ministry_finance_block(previous: dict[str, object] | None) -> dict[str, object]:
    blob = fetch_with_cache(MEXT_BYMIN_URL, "mext_bymin_fy2025_bs.xlsx", magic=b"PK")
    paths = sheet_paths(blob)
    bs_rows = read_sheet(blob, paths["貸借対照表"])
    cost_rows = read_sheet(blob, paths["業務費用計算書"])

    # BS: A列=資産科目, C列=本会計年度資産額 / D列=負債科目, F列=本会計年度負債額。
    # 「資産合計」「負債合計」「資産・負債差額」「負債及び資産・負債差額合計」は内訳ではなく
    # 小計/合計行なので、明細リストから外して別フィールドに拾う。
    SUMMARY_LABELS = {"資産合計", "負債合計", "資産・負債差額", "負債及び資産・\n負債差額合計",
                       "負債及び資産・負債差額合計"}
    assets: list[dict[str, object]] = []
    liabilities: list[dict[str, object]] = []
    asset_total = liability_total = net_worth = None
    for idx in sorted(bs_rows):
        row = bs_rows[idx]
        a_label = (row.get("A") or "").strip()
        d_label = (row.get("D") or "").strip().replace("\n", "")
        if a_label and row.get("C") and number(row["C"]) is not None and "＜" not in a_label:
            amount = number(row["C"])
            if a_label == "資産合計":
                asset_total = amount
            else:
                assets.append({"label": a_label, "amount": amount})
        if d_label and row.get("F") and number(row["F"]) is not None and "＜" not in d_label:
            amount = number(row["F"])
            if d_label == "負債合計":
                liability_total = amount
            elif d_label == "資産・負債差額":
                net_worth = amount
            elif "負債及び資産" in d_label:
                pass  # = 資産合計と同額の合計行、別途 asset_total を使うので保持しない
            else:
                liabilities.append({"label": d_label, "amount": amount})
    if not assets or not liabilities:
        raise ValueError("財務書類: 貸借対照表の資産/負債行を検出できない")

    costs: list[dict[str, object]] = []
    total_cost = None
    for idx in sorted(cost_rows):
        row = cost_rows[idx]
        label = row.get("A", "")
        amount = number(row.get("C"))
        if not label or amount is None:
            continue
        if "合計" in label:
            total_cost = amount
        else:
            costs.append({"label": label, "amount": amount})
    if total_cost is None:
        raise ValueError("財務書類: 業務費用合計行を検出できない")

    return {
        "status": "ok",
        "unit": "百万円",
        "fiscal_year": 2024,
        "fiscal_year_label": "令和6年度決算",
        "assets": sorted(assets, key=lambda a: -abs(a["amount"]))[:15],
        "asset_total": asset_total,
        "liabilities": sorted(liabilities, key=lambda a: -abs(a["amount"]))[:15],
        "liability_total": liability_total,
        "net_worth": net_worth,
        "costs": sorted(costs, key=lambda c: -abs(c["amount"])),
        "total_cost": total_cost,
        "source": {
            "title": "文部科学省 省庁別財務書類（令和6年度）貸借対照表・業務費用計算書",
            "url": MEXT_ZAIMU_INDEX,
            "data_url": MEXT_BYMIN_URL,
        },
        "note": (
            "単位は原資料どおり百万円（変換不要）。直近年度（令和6年度決算）のスナップショット"
            "のみで、複数年度の時系列化は行っていない（年度ごとに個別ファイルが分かれており、"
            "費用科目の並びが年度で変わることがあるため）。資産・負債は金額の絶対値が大きい順に"
            "上位15科目、業務費用は「本年度業務費用合計」に対する内訳全科目。"
        ),
    }


# -------------------------------------------------------------------- fullcost

# 府省庁横断版データベース（14省庁提出分をまとめたもの）。列レイアウトが年やファイルの
# 版で微妙にずれる（実測: このURLの版はA=省庁名だが、文科省単独提出版はB=省庁名だった）
# ため、列は固定レターではなくヘッダ行のラベル文字列を動的検出して使う。
MEXT_FULLCOST_URL = "https://www.mof.go.jp/policy/budget/topics/fullcost/fy2024/datebase.xlsx"
FULLCOST_KEYWORD_RE = re.compile(
    r"研究|科学|宇宙|原子力|放射光|スーパーコンピュータ|富岳|加速器|大学|留学|奨学|学術"
)
FULLCOST_HEADER_LABELS = {
    "ministry": "省庁名", "name": "事業・業務名", "fullcost": "フルコスト合計",
    "personnel": "人にかかるコスト", "physical": "物にかかるコスト",
}


def _find_fullcost_columns(rows: dict[int, dict[str, str]]) -> dict[str, str] | None:
    """ヘッダはA〜数行にまたがって分割されている（例: 「人にかかるコスト」は
    「省庁名」等とは別の行）ため、先頭数行を走査してラベルが見つかるたびに蓄積する。"""
    found: dict[str, str] = {}
    for idx in sorted(rows)[:10]:
        row = rows[idx]
        for col, text in row.items():
            for key, label in FULLCOST_HEADER_LABELS.items():
                if text == label and key not in found:
                    found[key] = col
    if "ministry" in found and "name" in found and "fullcost" in found:
        return found
    return None


def fullcost_block(previous: dict[str, object] | None) -> dict[str, object]:
    try:
        blob = fetch_with_cache(MEXT_FULLCOST_URL, "mext_fullcost_r6.xlsx", magic=b"PK")
        paths = sheet_paths(blob)
        sheet_name = next((s for s in paths if s.startswith("令和6年度")), None)
        if not sheet_name:
            raise ValueError("フルコストDB: 令和6年度シートが見つからない")
        rows = read_sheet(blob, paths[sheet_name])
        cols = _find_fullcost_columns(rows)
        if not cols:
            raise ValueError("フルコストDB: ヘッダ行（省庁名/事業・業務名/フルコスト合計）を検出できない")
    except Exception as error:  # noqa: BLE001
        return {"status": "unavailable", "note": f"事業別フルコストDBの取得・パースに失敗: {error}"}

    items: list[dict[str, object]] = []
    ministries_seen: set[str] = set()
    for idx in sorted(rows):
        row = rows[idx]
        ministry = row.get(cols["ministry"], "")
        name = row.get(cols["name"], "")
        fullcost = number(row.get(cols["fullcost"]))
        personnel = number(row.get(cols.get("personnel", ""))) if cols.get("personnel") else None
        physical = number(row.get(cols.get("physical", ""))) if cols.get("physical") else None
        if not ministry or not name or fullcost is None or ministry in {"省庁名"} or name in {"プルダウンから選択して下さい"}:
            continue
        ministries_seen.add(ministry)
        if not FULLCOST_KEYWORD_RE.search(name):
            continue
        items.append({
            "ministry": ministry, "name": name,
            "fullcost": round(fullcost / 1_000_000, 3),
            "personnel": round(personnel / 1_000_000, 3) if personnel is not None else None,
            "physical": round(physical / 1_000_000, 3) if physical is not None else None,
            "year": 2024,
        })
    if not items:
        return {"status": "unavailable", "note": "フルコストDB: 研究関連キーワードに合致する行を検出できなかった"}

    ranked = sorted(items, key=lambda i: -i["fullcost"])[:20]
    return {
        "status": "ok",
        "unit": "百万円",
        "fiscal_year": 2024,
        "items": ranked,
        "source": {
            "title": "事業別フルコスト情報の開示【データベース】（府省庁横断版）",
            "url": "https://www.mof.go.jp/policy/budget/report/public_finance_fact_sheet/index.html",
            "data_url": MEXT_FULLCOST_URL,
        },
        "note": (
            f"府省庁横断版データベース（{len(ministries_seen)}府省庁、{len(rows) - 6}事業）のうち、"
            "事業名に研究/科学/宇宙/原子力/放射光/スーパーコンピュータ/加速器/大学/留学/奨学/学術の"
            "いずれかを含む事業の上位20件。単位は原資料の円を÷1,000,000して百万円に統一。「フル"
            "コスト」の意味する範囲は事業類型で異なる点に注意: 独立行政法人運営費交付金型の事業"
            "（JAXA・JST・理化学研究所等の運営費交付金事業）は交付金総額に近い規模になる一方、"
            "補助金・給付金型の事業（科学研究費助成事業＝科研費等）は実施省庁側の直接管理コスト"
            "（人件費・物件費等）のみを表し、実際の交付総額（科研費の場合は年間2,000億円超）より"
            "はるかに小さく見える。同じ「fullcost」列の値を事業類型をまたいで単純比較しないこと。"
        ),
    }


# ---------------------------------------------------------------- run helpers

def run_block(name: str, builder) -> dict[str, object]:
    try:
        block = builder()
        print(f"[gov] {name}: ok")
        return block
    except Exception as error:  # noqa: BLE001 — degrade gracefully, keep provenance
        print(f"[gov] {name}: FAILED — {error}")
        return {"status": "error", "note": str(error)}


BLOCK_NAMES = [
    "budget_series", "budget_ministry", "projects", "network", "contracts",
    "ministry_finance", "fullcost",
]


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
    payload["budget_series"] = run_block("budget_series", lambda: budget_series_block(previous.get("budget_series")))
    payload["budget_ministry"] = run_block("budget_ministry", lambda: budget_ministry_block(previous.get("budget_ministry")))
    payload["projects"] = run_block("projects", lambda: projects_block(previous.get("projects")))
    payload["network"] = run_block("network", lambda: network_block(previous.get("network")))
    payload["contracts"] = run_block("contracts", lambda: contracts_block(previous.get("contracts")))
    payload["ministry_finance"] = run_block("ministry_finance", lambda: ministry_finance_block(previous.get("ministry_finance")))
    payload["fullcost"] = run_block("fullcost", lambda: fullcost_block(previous.get("fullcost")))

    # 一時的な取得失敗で公開済みの正常データを潰さない: 前回ファイルの正常ブロックを保持
    for key in BLOCK_NAMES:
        if payload[key].get("status") not in ("ok",) and previous.get(key, {}).get("status") == "ok":
            kept = previous[key]
            kept["note"] = f"{kept.get('note', '')} 直近の取得に失敗したため前回取得値を表示。".strip()
            payload[key] = kept
            print(f"[gov] {key}: kept previous ok block")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    text = json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n"
    size_mb = len(text.encode("utf-8")) / 1_000_000
    print(f"[gov] payload size: {size_mb:.2f} MB")
    if size_mb > 1.5:
        print(f"[gov] WARNING: payload exceeds 1.5MB budget ({size_mb:.2f} MB) — consider trimming top-N limits")
    args.output.write_text(text, encoding="utf-8")
    print(f"[gov] wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
