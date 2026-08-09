#!/usr/bin/env python3
"""Fetch data on Japan's research funding agencies (JSPS/JST/AMED/NEDO etc.).

Blocks written to data/funders.json:
- dual_support: NISTEP 科学技術指標2025 表1-3-19「大学等における負担源別研究開発費」。
  大学の研究開発費を自己資金／政府／会社等／非営利団体／外国等の負担源別に分解した
  実測時系列（2001年度〜）。実測値。単位: 100万円。
  注意: 「自己資金」には国立大学の運営費交付金・施設整備費補助金や私立大学の授業料等
  が混在し、真の基盤的経費だけを表さない。「政府」列も競争的資金とイコールではない
  （補助金・委託費等を含む政府由来の外部資金全体）。
- kakenhi_years: JSPS 科研費データの機関別配分額（新規＋継続）を令和4〜7年度の4年分
  時系列化したもの。既存 scripts/fetch_indicators.py の block_kakenhi() と同じ手法
  （スクレイプでxlsxを発見、「機関名」ヘッダを動的検出して列オフセットを算出）を
  4年度分に拡張。令和5年度版のみ「機関番号」列が挿入され1列右にシフトする罠がある
  ため、列は年ごとに実データから検出する。各年度上位40機関を保持。最新年度（KAKENHI_
  YEARSの最大値）が今回・前回とも取得できない場合は status を "unavailable" にして
  返し、money.js側でindicators.jsonの単年データへフォールバックさせる（古い複数年
  データを新しい単年データより優先して表示しないため）。
- csti_programs: 内閣府CSTI「競争的研究費制度一覧（省庁別予算）」PDFをパースし、
  府省庁別小計・全制度の予算額（百万円）を抽出。制度は手作業で選ばず、パースできた
  全行を当初予算額の大きい順に並べて上位N件をJSONに保持する（total_programs_parsed
  に母数を記録）。実測・単年度（当初予算のみ生存年度が生きたURLの範囲、通常直近1〜2
  年度分）。内数計上の事業・移し替え型（SIP/BRIDGE）は含まれない下限値。基金型は
  造成年度に一括計上されるため、単年度の当初予算額だけを見ると造成年の制度が過大に、
  他年度は過小に見える。パース結果は構造的な妥当性（科研費が最大制度で妥当な金額
  範囲内か、府省庁別小計の合計が総合計と概ね一致するか等）を検証し、既知の年度に
  ついては実測値との完全一致も確認する。検証に失敗した場合は例外を送出し、前回の
  正常値を保持する。過去分のPDFは翌年以降404で消える運用のため、`years` は年度キー
  で蓄積し、過去の取得結果を保持する（＝今年から毎年保存を始めることで時系列を作る）。

Every block carries {status, source, note} so the frontend can state
provenance honestly and degrade gracefully when a source is unavailable.
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

import pypdf

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "funders.json"

USER_AGENT = "gov-sci-tech-watcher/1.0 (+https://science-signal.pages.dev/)"
NISTEP_BASE = "https://www.nistep.go.jp/sti_indicator/2025/hyoudata/"
NISTEP_INDEX = "https://www.nistep.go.jp/sti_indicator/2025/RM349_table.html"
KAKENHI_INDEX = "https://www.jsps.go.jp/j-grantsinaid/27_kdata/kohyo/index.html"
CSTI_INDEX = "https://www8.cao.go.jp/cstp/compefund/"

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


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
    return int(parsed) if parsed.is_integer() and abs(parsed) < 1e15 else round(parsed, 4)


# ---------------------------------------------------------------- xlsx parsing
# (self-contained copy of the pattern used by fetch_indicators.py / fetch_publishing.py)

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
    with ZipFile(BytesIO(blob)) as archive:
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


def _column_index(letters: str) -> int:
    value = 0
    for ch in letters:
        value = value * 26 + (ord(ch) - 64)
    return value


def _column_letter(index: int) -> str:
    letters = ""
    while index > 0:
        index, rem = divmod(index - 1, 26)
        letters = chr(ord("A") + rem) + letters
    return letters


def nistep_table(name: str) -> bytes:
    return fetch(f"{NISTEP_BASE}STI2025_{name}.xlsx")


# ------------------------------------------------------------- dual support

DUAL_SUPPORT_COLUMNS = {
    "B": "self", "C": "government", "D": "inter_university",
    "E": "company", "F": "private_university", "G": "nonprofit",
    "H": "foreign", "I": "total",
}
DUAL_SUPPORT_SECTORS = {"(A)全大学": "all", "（B)国立大学": "national",
                         "(C)公立大学": "public", "(D)私立大学": "private"}


def dual_support_block() -> dict[str, object]:
    """NISTEP 表1-3-19: 大学等における負担源別研究開発費（全大学/国立/公立/私立）."""
    blob = nistep_table("1-3-19")
    rows = read_sheet(blob, sheet_paths(blob)["表1-3-19"])

    sector_starts: list[tuple[str, int]] = []
    for index in sorted(rows):
        label = rows[index].get("A", "")
        if label in DUAL_SUPPORT_SECTORS:
            sector_starts.append((DUAL_SUPPORT_SECTORS[label], index))
    if not sector_starts:
        raise ValueError("表1-3-19: セクター見出し行が見つからない")

    years: list[int] | None = None
    sectors: dict[str, dict[str, list[int | float | None]]] = {}
    for sector_key, start_row in sector_starts:
        header_row = start_row + 2
        if rows.get(header_row, {}).get("A") != "年度":
            raise ValueError(f"表1-3-19: {sector_key} の見出し行がずれている（row {header_row}）")
        series: dict[str, list[int | float | None]] = {key: [] for key in DUAL_SUPPORT_COLUMNS.values()}
        sector_years: list[int] = []
        index = header_row + 1
        while True:
            row = rows.get(index)
            year_text = row.get("A", "") if row else ""
            if not re.fullmatch(r"\d{4}", year_text):
                break
            sector_years.append(int(year_text))
            for column, key in DUAL_SUPPORT_COLUMNS.items():
                series[key].append(number(row.get(column)))
            index += 1
        if not sector_years:
            raise ValueError(f"表1-3-19: {sector_key} の年度行を検出できない")
        if years is None:
            years = sector_years
        elif years != sector_years:
            raise ValueError("表1-3-19: セクター間で年度範囲が一致しない")
        sectors[sector_key] = series

    if "all" not in sectors or not any(v is not None for v in sectors["all"]["government"]):
        raise ValueError("表1-3-19: 全大学の政府列を検出できない")

    return {
        "status": "ok",
        "unit": "100万円",
        "years": years,
        "sectors": sectors,
        "source": {
            "title": "NISTEP 科学技術指標2025 表1-3-19 大学等における負担源別研究開発費",
            "url": NISTEP_INDEX,
            "data_url": f"{NISTEP_BASE}STI2025_1-3-19.xlsx",
        },
        "note": (
            "「自己資金」は研究開発費総額から外部受入研究開発費を除いた額で、国立大学が"
            "国から受け入れた運営費交付金・施設整備費補助金や、私立大学の授業料等由来の"
            "研究費も含まれる＝真の基盤的経費だけを表すわけではない。「政府」列は競争的"
            "資金に限らず補助金・委託費等を含む政府由来の外部資金全体で、競争的資金の額"
            "とイコールではない。原資料: 総務省「科学技術研究調査報告」。"
        ),
    }


# --------------------------------------------------------------- kakenhi × N years

KAKENHI_YEARS = [4, 5, 6, 7]  # 令和4〜7年度（2022〜2025年度）


def _kakenhi_find_xlsx_for_year(reiwa: int) -> str | None:
    """Find the 機関別配分 (3-5) xlsx for a given reiwa year by trying round pages
    in descending order, mirroring fetch_indicators.py's _kakenhi_find_xlsx()."""
    for round_no in ("03", "02", "01"):
        page_url = f"https://www.jsps.go.jp/j-grantsinaid/27_kdata/kohyo/r{reiwa:02d}_{round_no}.html"
        try:
            page_html = fetch(page_url).decode("utf-8", errors="replace")
        except Exception:
            continue
        match = re.search(r"[\"'=,]([^\"'=,]*?3-5_r\d+\.xlsx)", page_html)
        if match:
            url = match.group(1)
            if url.startswith("/"):
                url = f"https://www.jsps.go.jp{url}"
            return url
    return None


def _kakenhi_year_block(reiwa: int) -> dict[str, object]:
    url = _kakenhi_find_xlsx_for_year(reiwa)
    if not url:
        raise ValueError(f"令和{reiwa}年度: 機関別配分xlsxのURLを発見できない")
    rows = read_sheet(fetch(url), "xl/worksheets/sheet1.xml")
    header_row = None
    name_column = None
    for index in sorted(rows):
        for column, text in rows[index].items():
            if text == "機関名":
                header_row, name_column = index, column
                break
        if header_row:
            break
    if not header_row or not name_column:
        raise ValueError(f"令和{reiwa}年度: 「機関名」ヘッダが見つからない — 列構成が変わった可能性")
    base = _column_index(name_column)
    count_col = _column_letter(base + 1)
    total_col = _column_letter(base + 6)
    institutions: list[dict[str, object]] = []
    for index in sorted(row for row in rows if row > header_row):
        values = rows[index]
        name = values.get(name_column, "").strip().rstrip("＊*").strip()
        count = number(values.get(count_col))
        total_yen = number(values.get(total_col))
        if not name or count is None or total_yen is None or name in {"機関名"}:
            continue
        institutions.append({"label": name, "count": int(count), "amount": round(total_yen / 1000)})  # 円→千円
    if not institutions:
        raise ValueError(f"令和{reiwa}年度: 機関の行を1件もパースできない")
    year = 2018 + reiwa
    total_amount = sum(entry["amount"] for entry in institutions)
    ranked = sorted(institutions, key=lambda entry: -entry["amount"])
    top10_amount = sum(entry["amount"] for entry in ranked[:10])
    return {
        "reiwa": reiwa,
        "year": year,
        "year_label": f"令和{reiwa}年度（{year}年度）",
        "institution_count": len(institutions),
        "total_amount": total_amount,
        "top10_share": round(top10_amount / total_amount, 4) if total_amount else None,
        "rows": ranked[:40],
        "source_url": url,
    }


def kakenhi_years_block(previous: dict[str, object] | None = None) -> dict[str, object]:
    """科研費 機関別配分額の複数年化（令和4〜7年度）。

    最新年度（KAKENHI_YEARS の最大値）のデータが今回の取得でも前回の保存分でも
    揃わない場合は status を "unavailable" にして返す。money.js は funders.json の
    最新年度が indicators.json の単年データより古い状態で "ok" と誤認しないよう、
    ここで単年フォールバックへ道を譲る。
    """
    year_blocks: dict[int, dict[str, object]] = {}
    errors: list[str] = []
    for reiwa in KAKENHI_YEARS:
        try:
            year_blocks[reiwa] = _kakenhi_year_block(reiwa)
            print(f"[funders] kakenhi_years R{reiwa}: ok")
        except Exception as error:  # noqa: BLE001 — keep going for the years that do work
            errors.append(f"R{reiwa}: {error}")
            print(f"[funders] kakenhi_years R{reiwa}: FAILED — {error}")

    # 今回取得できなかった年度は、前回保存分（同じ年度）があれば補う
    previous_detail: dict[str, object] = {}
    if previous and previous.get("status") == "ok":
        previous_detail = previous.get("years_detail") or {}
    filled_from_previous: list[int] = []
    for reiwa in KAKENHI_YEARS:
        if reiwa in year_blocks:
            continue
        prev_block = previous_detail.get(f"R{reiwa}")
        if isinstance(prev_block, dict) and prev_block.get("rows"):
            year_blocks[reiwa] = prev_block
            filled_from_previous.append(reiwa)

    if not year_blocks:
        raise ValueError("科研費機関別配分: 全年度の取得に失敗 — " + "; ".join(errors))

    latest_target = max(KAKENHI_YEARS)
    if latest_target not in year_blocks:
        return {
            "status": "unavailable",
            "note": (
                f"最新年度（令和{latest_target}年度）の機関別配分xlsxを取得できず、前回"
                "保存分も無いため複数年ブロックを保留（indicators.jsonの単年表示にフォー"
                "ルバックする）。"
                + (f" 取得エラー: {'; '.join(errors)}" if errors else "")
            ),
        }

    ordered = sorted(year_blocks.values(), key=lambda b: b["reiwa"])
    reiwa_sequence = [block["reiwa"] for block in ordered]

    # 直近年度の上位機関について、揃った年度分の配分額推移を組み立てる
    latest = year_blocks[latest_target]
    top_labels = [row["label"] for row in latest["rows"][:8]]
    by_year_label_amount = {
        reiwa: {row["label"]: row["amount"] for row in block.get("rows", [])}
        for reiwa, block in year_blocks.items()
    }
    institutions = [
        {
            "label": label,
            "amounts": [by_year_label_amount[r].get(label) for r in reiwa_sequence],
        }
        for label in top_labels
    ]

    note = (
        "各年度とも新規採択＋継続分。配分額は直接経費＋間接経費の合計。機関名の＊"
        "（新規応募50件以上）は除去。機関の統廃合（例: 東京科学大学は2024年10月に"
        "東京工業大学・東京医科歯科大学が統合して発足）により、年度間で同一機関名"
        "の系列が途切れる場合がある。"
    )
    if filled_from_previous:
        note += f" 今回取得できず前回保存分で補った年度: {'、'.join(f'令和{r}年度' for r in filled_from_previous)}。"
    if errors:
        note += f" 取得できなかった年度: {'; '.join(errors)}"

    return {
        "status": "ok",
        "unit": "千円",
        "reiwa_years": reiwa_sequence,
        "labels": [f"令和{r}年度" for r in reiwa_sequence],
        "calendar_years": [2018 + r for r in reiwa_sequence],
        "total_amount": [block.get("total_amount") for block in ordered],
        "institution_count": [block.get("institution_count") for block in ordered],
        "top10_share": [block.get("top10_share") for block in ordered],
        "institutions": institutions,
        "years_detail": {f"R{block['reiwa']}": block for block in ordered},
        "source": {
            "title": "日本学術振興会 科研費データ 研究機関別採択件数・配分額一覧（令和4〜7年度）",
            "url": KAKENHI_INDEX,
        },
        "note": note,
    }


# ---------------------------------------------------------------- CSTI PDF

# 金額トークンはASCII数字のみ許容（\d はPython正規表現ではUnicode全角数字も拾ってしまい、
# 「注１」「Ｒ7」等の脚注・年度表記の全角数字を金額と誤認する恐れがあるため [0-9] に限定する）。
NUM_RE = re.compile(
    r"(?<![0-9])(?:[0-9]{1,3}(?:,[0-9]{3})+|[0-9]{1,3})(?:の内数)?(?![0-9])"
    r"|(?<!\S)-(?!\S)"  # bare dash placeholder
)
MINISTRIES = ["内閣府", "総務省", "文部科学省", "厚生労働省", "農林水産省",
              "経済産業省", "国土交通省", "環境省", "防衛省"]

# 担当機関（実施機関）の正式名 → 表示用の短縮ラベル。制度名ではなく「誰が配分するか」の
# 目印として使う。ここに無い実施機関は所属府省名で代表させる。
INSTITUTION_LABELS = {
    "日本学術振興会": "JSPS",
    "科学技術振興機構": "JST",
    "日本医療研究開発機構": "AMED",
    "新エネルギー・産業技術総合開発機構": "NEDO",
    "宇宙航空研究開発機構": "JAXA",
    "情報通信研究機構": "NICT",
    "環境再生保全機構": "環境再生保全機構",
    "生物系特定産業技術研究支援センター": "生研支援センター",
    "防衛装備庁": "防衛装備庁",
}
# 「制度名ではなく担当機関名だけの行」と判定するためのストップリスト
AGENCY_STOPWORDS = set(INSTITUTION_LABELS) | {
    "本省", "政策統括官（沖縄政策担当）", "食品安全委員会", "消費者庁", "こども家庭庁", "消防庁",
}
ERAD_CODE_RE = re.compile(r"[SＳ][0-9]{5,7}")


def _trailing_amounts(line: str) -> list[str] | None:
    tokens = [m.group(0) for m in NUM_RE.finditer(line)]
    return tokens[-3:] if len(tokens) >= 3 else None


def _amount_matches(line: str) -> list[re.Match] | None:
    matches = list(NUM_RE.finditer(line))
    return matches[-3:] if len(matches) >= 3 else None


def _nearest_amounts(lines: list[str], index: int, window: int = 2) -> list[str] | None:
    """府省庁別小計・総合計のラベル行の近傍から金額3つを探す。窓を狭く保つのは、脚注や
    別の行の数字を誤って拾わないため（小計/合計の値は実際には同じ行か次の1行にしか
    出現しない）。"""
    found = _trailing_amounts(lines[index])
    if found:
        return found
    for distance in range(1, window + 1):
        if index + distance < len(lines):
            found = _trailing_amounts(lines[index + distance])
            if found:
                return found
        if index - distance >= 0:
            found = _trailing_amounts(lines[index - distance])
            if found:
                return found
    return None


def _amount_value(token: str | None) -> int | None:
    if token is None or token == "-":
        return None
    return int(token.replace(",", "").replace("の内数", ""))


def _clean_label(line: str) -> str:
    """小計/合計 判定用: 数字・カンマ・ダッシュ・空白を除去した残りの文字列。"""
    return re.sub(r"[0-9,\-\s]", "", line)


def _segments(text: str) -> list[str]:
    """テキストを、e-Rad制度コード・基金マーカー等を除いたうえで、pdftotext/pypdfの
    列間の空白（複数スペース）を区切りとしたセグメント列に分ける。制度名自体は分かち書き
    されない日本語の連続文字列なので、内部の空白は失わずセグメント境界として使う（全部の
    空白を潰すと「本省/日本学術振興会」＋「科学研究費補助金」のような機関名と制度名が
    無区切りで連結してしまう）。"""
    text = ERAD_CODE_RE.sub(" ", text)
    text = re.sub(r"[／/]", " ", text)
    text = re.sub(r"[○◯]", " ", text)
    text = re.sub(r"追記予定|の内数", " ", text)
    return [s for s in re.split(r"\s+", text) if s]


_TRAILING_CODE_NOISE_RE = re.compile(r"[0-9SＳ]{1,10}$")


def _strip_trailing_code_noise(text: str) -> str:
    """複数行にまたがるe-Radコード列の断片（「S0」「582」等、空白を挟まず制度名の末尾に
    連結してしまう）を取り除く。実際の制度名が末尾を裸の数字・S記号で終えることはない
    ため、末尾の数字/S列だけを安全に削れる。"""
    return _TRAILING_CODE_NOISE_RE.sub("", text)


def _classify_label(before_text: str, after_text: str, prev_line_text: str = "") -> tuple[str, str | None]:
    """金額トークンの前後のテキストから (制度名, 実施機関の短縮ラベル) を推定する。

    先頭から並ぶ「担当機関名」セグメントを剥がして実施機関のヒントとして扱い、残りを
    制度名候補とする（例: 「本省 日本学術振興会 科学研究費補助金」→ 実施機関=JSPS、
    制度名候補=「科学研究費補助金」）。金額の直後に空白なしで連結される制度名（表側の
    折り返しレイアウトの結果）が拾えた場合はそちらを優先する。金額行自体に制度名が無く
    「※」で始まる備考文だけが乗っているような行（防衛装備庁の契約ベース注記など）は、
    直前行に制度名が折り返されている可能性が高いため、そちらを試す。
    """
    before_segments = _segments(before_text)
    agency_hint: str | None = None
    while before_segments and before_segments[0] in AGENCY_STOPWORDS:
        agency_hint = INSTITUTION_LABELS.get(before_segments[0]) or agency_hint
        before_segments.pop(0)
    program_from_before = "".join(before_segments)
    program_from_after = "".join(_segments(after_text))
    label = program_from_after or program_from_before
    label = _strip_trailing_code_noise(label)
    if "※" in label:
        prev_segments = _segments(prev_line_text)
        while prev_segments and prev_segments[0] in AGENCY_STOPWORDS:
            agency_hint = INSTITUTION_LABELS.get(prev_segments[0]) or agency_hint
            prev_segments.pop(0)
        prev_label = _strip_trailing_code_noise("".join(prev_segments))
        if prev_label and "※" not in prev_label:
            label = prev_label
    return label, agency_hint


def _current_reiwa_year() -> int:
    return datetime.now(timezone.utc).year - 2018


def _csti_candidate_urls() -> list[str]:
    current = _current_reiwa_year()
    seen: set[str] = set()
    urls: list[str] = []
    for target in (current, current - 1, current - 2, 7):  # 7 は既知の生存版へのフォールバック
        pair = f"r{target - 1}-{target}"
        if pair in seen:
            continue
        seen.add(pair)
        urls.append(f"https://www8.cao.go.jp/cstp/compefund/kyoukin_{pair}.pdf")
    return urls


CSTI_TOP_N = 25  # 上位何件をJSONに保持するか（フロントはさらにその一部だけ描画してよい）

# reiwa_current（当該年度）ごとの既知の正解値。このセッションで一次データを検証した年度
# のみ登録する。将来年度は未登録のまま（構造的な妥当性チェックのみ適用され、金額そのもの
# は年ごとに変わって当然なので固定値では検証しない）。
CSTI_KNOWN_GOOD = {
    7: {"kakenhi_initial": 237_850, "grand_total_initial": 734_618},
}


def _parse_csti_lines(lines: list[str]) -> tuple[list[dict[str, object]], list[dict[str, object]], list[str] | None]:
    """(府省庁別小計, 制度ごとの行, 総合計トークン) を組み立てる。

    制度別の行は、事業一覧表のすべての行を対象に機械的に抽出する（あらかじめ主要制度を
    決め打ちしない）。府省庁名は表側で縦結合されたセルのため、そのテキストがブロックの
    途中や末尾に出現することがある（先頭に出るとは限らない）。単純な「直近に見た府省名」
    による前方追跡だと、ブロック前半の行が前の府省に誤帰属してしまうため、まず各ブロック
    の「小計」行の位置と府省名を確定させ（小計行に到達する頃には府省名テキストは必ず
    出現済みなので、この対応は正しく決まる）、そのあとで各制度行を「自分より後ろにある
    最初の小計」に紐づける2パス方式にしている。
    """
    current_ministry: str | None = None
    ministries: list[dict[str, object]] = []
    ministry_boundaries: list[tuple[int, str]] = []  # (小計行のindex, 府省名) — 出現順
    grand_total: list[str] | None = None
    program_lines: list[tuple[int, str, str, str, list[re.Match]]] = []

    for index, line in enumerate(lines):
        stripped = line.lstrip()
        lead = len(line) - len(stripped)
        if lead < 4:
            for ministry in MINISTRIES:
                if stripped.startswith(ministry):
                    current_ministry = ministry
                    break

        marker = _clean_label(line)
        if marker == "小計" and current_ministry:
            amounts = _nearest_amounts(lines, index)
            if amounts:
                ministries.append({
                    "name": current_ministry,
                    "prev_initial": _amount_value(amounts[0]),
                    "supplementary": _amount_value(amounts[1]),
                    "initial": _amount_value(amounts[2]),
                })
                ministry_boundaries.append((index, current_ministry))
            continue
        if marker == "合計":
            amounts = _nearest_amounts(lines, index)
            if amounts:
                grand_total = amounts
            continue

        matches = _amount_matches(line)
        if not matches:
            continue
        before_text = line[: matches[0].start()]
        after_text = line[matches[-1].end():]
        prev_line_text = lines[index - 1] if index > 0 else ""
        program_lines.append((index, before_text, after_text, prev_line_text, matches))

    def ministry_for(idx: int) -> str | None:
        for boundary_idx, name in ministry_boundaries:
            if boundary_idx >= idx:
                return name
        return None

    programs: list[dict[str, object]] = []
    for idx, before_text, after_text, prev_line_text, matches in program_lines:
        label, agency_hint = _classify_label(before_text, after_text, prev_line_text)
        if not label or len(label) < 4 or label in MINISTRIES:
            continue

        initial = _amount_value(matches[2].group(0))
        if not initial or initial <= 0:
            continue
        # 実施機関名がこの行自身のテキストから読み取れた場合だけJSPS/JST/AMED/NEDO等の
        # 短縮ラベルを使う。読み取れない行は所属府省名で代表させる（前の行の実施機関を
        # 引き継ぐと、無関係な行に誤って同じ実施機関を付けてしまう — 例:
        # 「科学研究費助成事業（科研費）」の合計行の直前がAMEDの行だと誤ってAMED表示に
        # なってしまう — ため、あえて引き継がない）。
        programs.append({
            "label": label,
            "agency": agency_hint or ministry_for(idx) or "",
            "prev_initial": _amount_value(matches[0].group(0)),
            "supplementary": _amount_value(matches[1].group(0)),
            "initial": initial,
        })

    return ministries, programs, grand_total


def _validate_csti(reiwa_curr: int, kaken_initial: int | None, grand_initial: int | None,
                    ministries_sum: int) -> None:
    """パース結果の妥当性を検証する。異常が疑われる場合は例外を送出し、呼び出し側で
    前回の正常値を保持させる（レイアウト変更で静かに壊れたデータを公開しないため）。"""
    if kaken_initial is None:
        raise ValueError("CSTI PDF: 科研費の予算額を検出できない")
    if not (100_000 <= kaken_initial <= 400_000):
        raise ValueError(f"CSTI PDF: 科研費の予算額が妥当な範囲外（{kaken_initial}百万円）— パース異常の疑い")
    if grand_initial is None or grand_initial <= 0:
        raise ValueError("CSTI PDF: 総合計を検出できない")
    if grand_initial < kaken_initial * 2:
        raise ValueError(f"CSTI PDF: 総合計（{grand_initial}百万円）が科研費の2倍未満 — パース異常の疑い")
    if ministries_sum and abs(ministries_sum - grand_initial) / grand_initial > 0.05:
        raise ValueError(
            f"CSTI PDF: 府省庁別小計の合計（{ministries_sum}百万円）が総合計（{grand_initial}百万円）"
            "と5%以上乖離 — パース異常の疑い"
        )
    golden = CSTI_KNOWN_GOOD.get(reiwa_curr)
    if golden and (kaken_initial != golden["kakenhi_initial"] or grand_initial != golden["grand_total_initial"]):
        raise ValueError(
            f"CSTI PDF: 令和{reiwa_curr}年度の既知の検証値と不一致（科研費{kaken_initial}百万円/"
            f"合計{grand_initial}百万円、期待値 科研費{golden['kakenhi_initial']}百万円/"
            f"合計{golden['grand_total_initial']}百万円）— PDF構成が変わった可能性"
        )


def csti_programs_year_block() -> tuple[str, dict[str, object]]:
    """CSTI「競争的研究費制度一覧（省庁別予算）」PDFをパースする。

    Returns (year_key, block) where year_key is like "R7".
    """
    last_error: Exception | None = None
    for url in _csti_candidate_urls():
        try:
            pdf_bytes = fetch(url)
            break
        except Exception as error:  # noqa: BLE001
            last_error = error
            continue
    else:
        raise ValueError(f"CSTI PDF: どの候補URLも取得できなかった（最後のエラー: {last_error}）")

    reader = pypdf.PdfReader(BytesIO(pdf_bytes))
    full_text = "\n".join(page.extract_text(extraction_mode="layout") for page in reader.pages)
    lines = full_text.splitlines()

    title_match = re.search(r"令和(\d+)年度当初予算額・補正予算額、令和(\d+)年度当初予算額", full_text)
    if not title_match:
        raise ValueError("CSTI PDF: タイトル行から年度を検出できない — PDF構成が変わった可能性")
    reiwa_prev, reiwa_curr = int(title_match.group(1)), int(title_match.group(2))
    year_key = f"R{reiwa_curr}"

    ministries, programs_raw, grand_total = _parse_csti_lines(lines)
    if not ministries:
        raise ValueError("CSTI PDF: 府省庁別小計を1件も検出できない — レイアウトが変わった可能性")
    if not grand_total:
        raise ValueError("CSTI PDF: 総合計行を検出できない")

    # 同一行が重複して拾われた場合に備え (ラベル, 金額) で重複排除してから機械的に上位N件を選ぶ
    seen: set[tuple[str, int]] = set()
    deduped: list[dict[str, object]] = []
    for row in programs_raw:
        key = (row["label"], row["initial"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(row)
    ranked_programs = sorted(deduped, key=lambda row: -row["initial"])
    total_programs_parsed = len(ranked_programs)
    top_programs = ranked_programs[:CSTI_TOP_N]

    ministries_ranked = sorted(ministries, key=lambda m: -(m["initial"] or 0))
    grand_initial = _amount_value(grand_total[2])
    ministries_sum = sum(m["initial"] for m in ministries_ranked if m["initial"])
    kaken_row = next((p for p in ranked_programs if "科研費" in p["label"] or "科学研究費助成事業" in p["label"]), None)
    kaken_initial = kaken_row["initial"] if kaken_row else None

    _validate_csti(reiwa_curr, kaken_initial, grand_initial, ministries_sum)

    block = {
        "reiwa_current": reiwa_curr,
        "reiwa_prev": reiwa_prev,
        "fiscal_year": 2018 + reiwa_curr,
        "initial_total": grand_initial,
        "supplementary_total": _amount_value(grand_total[1]),
        "prev_initial_total": _amount_value(grand_total[0]),
        "ministries": ministries_ranked,
        "programs": top_programs,
        "total_programs_parsed": total_programs_parsed,
        "pdf_url": url,
        "retrieved_at": now_iso(),
    }
    return year_key, block


def csti_programs_block(previous: dict[str, object] | None) -> dict[str, object]:
    years: dict[str, object] = {}
    if previous and previous.get("status") == "ok":
        years = dict(previous.get("years", {}))
    try:
        year_key, block = csti_programs_year_block()
        years[year_key] = block
        top_amount = block["programs"][0]["initial"] if block["programs"] else "?"
        print(f"[funders] csti_programs {year_key}: ok — 上位制度{top_amount}百万円 / 合計{block['initial_total']}百万円 / パース済み{block['total_programs_parsed']}件")
    except Exception as error:  # noqa: BLE001 — keep whatever years we already have
        print(f"[funders] csti_programs: FAILED to fetch a new year — {error}")
        if not years:
            raise
    latest_key = max(years, key=lambda key: years[key]["reiwa_current"])
    latest = years[latest_key]
    top_n_shown = min(15, len(latest.get("programs", [])))
    return {
        "status": "ok",
        "unit": "百万円",
        "latest_year": latest_key,
        "years": years,
        "source": {
            "title": "内閣府 CSTI「競争的研究費制度一覧（省庁別予算）」",
            "url": CSTI_INDEX,
            "pdf_url": latest["pdf_url"],
        },
        "note": (
            f"表中の全{latest.get('total_programs_parsed', '?')}制度・事業のうち、当該年度"
            f"当初予算額が大きい順に上位{top_n_shown}件を機械的に選んで表示（手作業での制度"
            "選定はしていない）。表脚注のとおり、予算額を内数としている事業は含まれていない"
            "＝制度一覧の下限値。SIP・BRIDGEのような他省庁への移し替え型は金額欄が空欄で合計"
            "に計上されない。基金型の制度は造成年度に予算が一括計上され、翌年度以降は「-」に"
            "なるため、単年度の当初予算額だけを横並びにすると基金型が過小に、造成年の制度が"
            "過大に見える（例: 宇宙戦略基金は文科省分が令和6年度補正予算に一括計上）。内閣府"
            "サイトは古い年度のPDFを404で消す運用のため、取得できた年度のみ`years`に蓄積して"
            "いる。"
        ),
    }


# ---------------------------------------------------------------- run helpers

def run_block(name: str, builder) -> dict[str, object]:
    try:
        block = builder()
        print(f"[funders] {name}: ok")
        return block
    except Exception as error:  # noqa: BLE001 — degrade gracefully, keep provenance
        print(f"[funders] {name}: FAILED — {error}")
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

    payload = {
        "generated_at": now_iso(),
        "dual_support": run_block("dual_support", dual_support_block),
        "kakenhi_years": run_block("kakenhi_years", lambda: kakenhi_years_block(previous.get("kakenhi_years"))),
        "csti_programs": run_block("csti_programs", lambda: csti_programs_block(previous.get("csti_programs"))),
    }

    # 一時的な取得失敗で公開済みの正常データを潰さない: 前回ファイルの正常ブロックを保持
    for key in ("dual_support", "kakenhi_years", "csti_programs"):
        if payload[key].get("status") != "ok" and previous.get(key, {}).get("status") == "ok":
            kept = previous[key]
            kept["note"] = f"{kept.get('note', '')} 直近の取得に失敗したため前回取得値を表示。".strip()
            payload[key] = kept
            print(f"[funders] {key}: kept previous ok block")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"[funders] wrote {args.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
