#!/usr/bin/env python3
"""Fetch international researcher mobility data for the 人材 atlas ("研究者の国際移動" 章).

章の主役は「移動（頭脳流出/還流）」、MEXTの「交流」統計は補助という構成。7ブロック、
それぞれ別の来歴を持つ:

- mext_flows: 文部科学省「国際研究交流の概況」の年度別推移（派遣／受入 × 短期／中・長期、
  補助データ）。この調査は集計表（xlsx等）を公開しておらず、公表資料はグラフ画像に数値
  ラベルが印字された形でしか存在しない。そのため時系列本体（1993〜2024年度、32年×4系列）は
  スクリプト内の検証済み定数として持つ「手動転記スナップショット」方式を取る
  （data/phd_support.json の dc_stipend_history と同じ流儀）。転記は該当PDFページを
  2回独立に読んで突合し、不一致は3回目の読み直しで確定させた（詳細は転記時の作業
  ログ参照）。**毎年7月頃に新版（翌年度分）が公表されるので、その時期に手動で
  1年度分を追記すること。** 地域別内訳は直近年度（令和6年度）のみを保持。
- oecd_bilateral: OECD「Bibliometric indicators of implied bilateral mobility flows」
  （SDMX API、認証不要）。Scopus著者データから2010-2024年累積で推計した二国間移動の
  単一スナップショットで、年次推移は存在しない。実URLから取得。
- foreign_faculty: e-Stat「学校教員統計調査」の大学における外国人本務教員数（ストック）。
  3年周期の調査。令和7年度（中間報告）のみ実データ取得を確認できた（過去回のファイル
  探索は15分のタイムボックス内で見つからず、無理に推測はしていない）。
- reico_flows（本命）: OECD ReICO「R&I talent circulation」（SDMX API、認証不要）。
  Scopus著者データに基づく年次の流入/流出/帰国者数の推計。日本は2011年を除き毎年
  純流出。実URLから取得し、既知の2024年内訳（流入/流出/帰国/残留）と突合検証する。
- jsps_overseas_fellows: JSPS海外特別研究員の帰国後進路（検証済み静的定数）。単一コホート
  147人の円グラフPDFからの手動転記。
- nsf_sed: 米国で博士号を取得した日本人（一時ビザ）の人数推移と米国残留意向
  （検証済み静的定数）。NCSES Survey of Earned Doctorates の公式xlsxから手動転記・検証済み。
- jdpro: NISTEP「博士人材追跡調査」の国籍別国際移動（検証済み静的定数）。国籍別クロス集計は
  第3次報告書（2020年公表）のみに存在し、それ以降は再掲されていない。

Every block carries {status, source, unit, note} so the frontend can state provenance
honestly and degrade gracefully when a source is unavailable. On fetch failure, the
previous file's ok block is kept rather than overwritten with an empty one.
"""

from __future__ import annotations

import argparse
import csv
import io
import json
import os
from datetime import datetime, timezone
from io import BytesIO
from pathlib import Path
from urllib.request import Request, urlopen
from xml.etree import ElementTree
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "mobility.json"

USER_AGENT = "gov-sci-tech-watcher/1.0 (+https://science-signal.pages.dev/)"

NS = {"m": "http://schemas.openxmlformats.org/spreadsheetml/2006/main"}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def fetch(url: str, timeout: int = 60) -> bytes:
    request = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
    with urlopen(request, timeout=timeout) as response:
        return response.read()


# ---------------------------------------------------------------- xlsx parsing (shared shape with fetch_economy.py)

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


# =============================================================================================
# Block 1: mext_flows — 文部科学省「国際研究交流の概況」（PDFグラフからの手動転記スナップショット）
# =============================================================================================
#
# 出典: 文部科学省「国際研究交流の概況（令和6年度の状況）」（令和8年7月6日公表）
#   https://www.mext.go.jp/content/20260706-mxt_kagkoku_000050876_001.pdf
# 【図1】海外への派遣研究者数、【図2】海外からの受入研究者数（いずれも総数／短期／中・長期の
# 推移、H5(1993)〜R6(2024)年度）に印字された数値ラベルを転記した。X軸は H5〜H31, R2〜R6 の
# 32個で、令和元年度（R1、2019年度）に対応する単独ラベルは無く、H31 のラベルがそのまま
# 2019年度分として使われている（会計年度は令和元年度でも、この図の慣例に従いH31=2019とした）。
#
# 転記の経緯・突合結果:
# 1回目（R6版PDFのH5〜R6元号表記グラフを2エージェントが独立転記）で1994〜2019年度の
# 中・長期派遣系列に1年分のズレが発覚（2014年度の値4,591人の読み落としが原因）。これを機に
# 3回目の照合として、令和3年度公表版「研究者の交流に関する調査報告書」（西暦表記グラフ、
# 元号の曖昧さがない）と、MEXTが毎年公表する単年度版報告書本文（「令和X年度：N人」という
# 形の確定値、対前年度比のパーセンテージから前年度の値を逆算できる記述を含む）を突合の
# 決め手として使った。2010〜2024年度の全15年分は単年度版報告書本文の算術（グラフの
# ピクセル読み取りに頼らない）で確定。1993〜2009年度の17年分は西暦表記グラフを2エージェント
# が「総数－短期＝中長期（既知）」の恒等式で検算しながら独立転記し、32年度×6系列
# （派遣・受入×総数/短期/中長期）すべてで完全一致（不一致0セル）を確認した。
# 例外: 2018年度の受入研究者数は、原公表時（平成30年度版, 2020年8月）の本文では
# 総数39,324/短期26,152だったが、後年の複数の報告書（令和3年度版・令和6年度版）のグラフでは
# 一貫して総数39,398/短期26,226（中・長期13,172は共通）となっており、MEXTによる遡及改定と
# 判断してグラフ側（より新しく複数回再確認された値）を採用した。
# 地域別の中・長期区分で「-」（データなし/僅少）として表内で明示されている国・地域は null とする。

MEXT_SOURCE = {
    "title": "文部科学省「国際研究交流の概況（令和6年度の状況）」",
    "url": "https://www.mext.go.jp/content/20260706-mxt_kagkoku_000050876_001.pdf",
}

MEXT_DEFINITION_CHANGES = [
    {"year": 2008, "note": "派遣研究者数の対象にポスドクを追加（平成20年度調査から）。"},
    {"year": 2010, "note": "派遣・受入とも特別研究員等を対象に追加（平成22年度調査から）。"},
    {"year": 2013, "note": "受入研究者の定義を変更。同一年度内に同一研究者を複数機関で受け入れた場合の重複を排除（平成25年度調査から）。"},
    {"year": 2014, "note": "雇用契約を締結し職務を与えられ研究に従事している博士課程在籍学生を、派遣・受入の対象に含めるよう変更（平成26年度調査から）。"},
]

# --- 【図1】海外への派遣研究者数（総数／短期／中・長期） 年度は西暦（FY開始年）----------------
DISPATCH_TOTAL: dict[int, int | None] = {
    1993: 33480, 1994: 41965, 1995: 52414, 1996: 50927, 1997: 81921, 1998: 87817,
    1999: 94217, 2000: 112372, 2001: 103204, 2002: 115838, 2003: 112022, 2004: 124961,
    2005: 137407, 2006: 136751, 2007: 132067, 2008: 141495, 2009: 141165, 2010: 140731,
    2011: 155056, 2012: 165569, 2013: 172592, 2014: 173154, 2015: 170654, 2016: 170789,
    2017: 174602, 2018: 177821, 2019: 158912, 2020: 1329, 2021: 3211, 2022: 57218,
    2023: 110236, 2024: 119795,
}
DISPATCH_SHORT: dict[int, int | None] = {
    1993: 29633, 1994: 37973, 1995: 46767, 1996: 44883, 1997: 74803, 1998: 80732,
    1999: 86631, 2000: 104698, 2001: 96261, 2002: 109323, 2003: 106145, 2004: 119576,
    2005: 132682, 2006: 132588, 2007: 128095, 2008: 137461, 2009: 137079, 2010: 136459,
    2011: 149871, 2012: 160394, 2013: 168225, 2014: 168563, 2015: 166239, 2016: 166426,
    2017: 170284, 2018: 173530, 2019: 154734, 2020: 312, 2021: 1646, 2022: 53973,
    2023: 106613, 2024: 115767,
}
DISPATCH_MID_LONG: dict[int, int | None] = {
    1993: 3847, 1994: 3992, 1995: 5647, 1996: 6044, 1997: 7118, 1998: 7085,
    1999: 7586, 2000: 7674, 2001: 6943, 2002: 6515, 2003: 5877, 2004: 5385,
    2005: 4725, 2006: 4163, 2007: 3972, 2008: 4034, 2009: 4086, 2010: 4272,
    2011: 5185, 2012: 5175, 2013: 4367, 2014: 4591, 2015: 4415, 2016: 4363,
    2017: 4318, 2018: 4291, 2019: 4178, 2020: 1017, 2021: 1565, 2022: 3245,
    2023: 3623, 2024: 4028,
}

# --- 【図2】海外からの受入研究者数（総数／短期／中・長期） ------------------------------------
INFLOW_TOTAL: dict[int, int | None] = {
    1993: 13076, 1994: 13478, 1995: 15285, 1996: 16538, 1997: 20689, 1998: 21170,
    1999: 22078, 2000: 29586, 2001: 30067, 2002: 30130, 2003: 31924, 2004: 31391,
    2005: 34938, 2006: 35083, 2007: 36400, 2008: 39817, 2009: 41251, 2010: 37453,
    2011: 33615, 2012: 37066, 2013: 35649, 2014: 37351, 2015: 39626, 2016: 39049,
    2017: 39473, 2018: 39398, 2019: 35228, 2020: 9497, 2021: 9160, 2022: 20180,
    2023: 27265, 2024: 28736,
}
INFLOW_SHORT: dict[int, int | None] = {
    1993: 6947, 1994: 7306, 1995: 7848, 1996: 8664, 1997: 11592, 1998: 11601,
    1999: 11222, 2000: 15708, 2001: 17037, 2002: 17606, 2003: 19103, 2004: 18084,
    2005: 21715, 2006: 22565, 2007: 24296, 2008: 26562, 2009: 27870, 2010: 23212,
    2011: 20257, 2012: 21872, 2013: 23719, 2014: 24588, 2015: 26489, 2016: 26330,
    2017: 26446, 2018: 26226, 2019: 21948, 2020: 157, 2021: 302, 2022: 8084,
    2023: 14472, 2024: 16039,
}
INFLOW_MID_LONG: dict[int, int | None] = {
    1993: 6129, 1994: 6172, 1995: 7437, 1996: 7874, 1997: 9097, 1998: 9569,
    1999: 10856, 2000: 13878, 2001: 13030, 2002: 12524, 2003: 12821, 2004: 13307,
    2005: 13223, 2006: 12518, 2007: 12104, 2008: 13255, 2009: 13381, 2010: 14241,
    2011: 13358, 2012: 15194, 2013: 11930, 2014: 12763, 2015: 13137, 2016: 12719,
    2017: 13027, 2018: 13172, 2019: 13280, 2020: 9340, 2021: 8858, 2022: 12096,
    2023: 12793, 2024: 12697,
}

# --- 地域別（令和6年度＝2024年度のみ）。図7〜10（派遣短期／派遣中長期／受入短期／受入中長期）
# のグラフ右端データ点を転記（図7〜9はR2〜R6実測値の表が併記されておりそちらを優先、図10は
# 中南米/オセアニア/中東/アフリカのみ表があり、アジア/北米/ヨーロッパはグラフ右端ラベルを
# 実物ページで直接確認済み）。「ヨーロッパ（含NIS諸国）」がMEXTの正式な地域区分名。
# 派遣先/受入元エリアが不明なものがあるため、地域別合計は全体の総数・短期・中長期の値とは
# 一致しない（MEXT公表資料の注記どおり）。
REGIONAL_FISCAL_YEAR = 2024
REGIONAL_DISPATCH_SHORT: dict[str, int | None] = {
    "アジア": 47980, "ヨーロッパ（含NIS諸国）": 35981, "北米": 22853,
    "中南米": 1435, "オセアニア": 3928, "中東": 1635, "アフリカ": 1828,
}
REGIONAL_DISPATCH_MID_LONG: dict[str, int | None] = {
    "アジア": 675, "ヨーロッパ（含NIS諸国）": 1809, "北米": 957,
    "中南米": 95, "オセアニア": 210, "中東": 71, "アフリカ": 161,
}
REGIONAL_INFLOW_SHORT: dict[str, int | None] = {
    "アジア": 7652, "ヨーロッパ（含NIS諸国）": 4458, "北米": 2243,
    "中南米": 199, "オセアニア": 502, "中東": 206, "アフリカ": 287,
}
REGIONAL_INFLOW_MID_LONG: dict[str, int | None] = {
    "アジア": 6831, "ヨーロッパ（含NIS諸国）": 2765, "北米": 1332,
    "中南米": 257, "オセアニア": 241, "中東": 215, "アフリカ": 409,
}


def _series(values: dict[int, int | None]) -> list[list[object]]:
    return [[year, values.get(year)] for year in sorted(values)]


def _check_totals(total: dict[int, int | None], short: dict[int, int | None], mid_long: dict[int, int | None], label: str) -> None:
    """総数=短期+中長期の恒等式を全年度で検証する（手動転記の誤りを機械的に検出するため）。
    3系列のキー集合（対象年度）が一致していることも確認する — 年度の抜け漏れ・重複を検出する。"""
    years = set(total) | set(short) | set(mid_long)
    if set(total) != years or set(short) != years or set(mid_long) != years:
        raise ValueError(f"{label}: total/short/mid_long のキー集合（年度）が一致しない: {sorted(years - set(total))=} {sorted(years - set(short))=} {sorted(years - set(mid_long))=}")
    for year in sorted(total):
        t, s, m = total.get(year), short.get(year), mid_long.get(year)
        if t is None or s is None or m is None:
            continue
        if t != s + m:
            raise ValueError(f"{label} {year}: total({t}) != short({s}) + mid_long({m})")


def block_mext_flows() -> dict[str, object]:
    if not DISPATCH_TOTAL or not INFLOW_TOTAL:
        raise ValueError("MEXT flows constants not yet populated (transcription in progress)")
    _check_totals(DISPATCH_TOTAL, DISPATCH_SHORT, DISPATCH_MID_LONG, "dispatch")
    _check_totals(INFLOW_TOTAL, INFLOW_SHORT, INFLOW_MID_LONG, "inflow")
    return {
        "status": "ok",
        "unit": "人（延べ渡航者数。同一人物の複数回渡航を含む）",
        "source": MEXT_SOURCE,
        "note": (
            "文部科学省「国際研究交流の概況」の年度別推移。短期＝30日以内、中・長期＝30日超。"
            "グラフ数値ラベルの独立転記と、MEXT年度別報告書本文の確定値（対前年度比からの逆算含む）"
            "を突合したスナップショット（毎年7月頃の新版公表時に手動で1年度分を追記する）。"
            "全年度で総数＝短期＋中長期の整合を確認済み。地域別内訳は直近年度（令和6年度）のみ。"
        ),
        "definition_changes": MEXT_DEFINITION_CHANGES,
        "dispatch": {
            "total": _series(DISPATCH_TOTAL),
            "short": _series(DISPATCH_SHORT),
            "mid_long": _series(DISPATCH_MID_LONG),
        },
        "inflow": {
            "total": _series(INFLOW_TOTAL),
            "short": _series(INFLOW_SHORT),
            "mid_long": _series(INFLOW_MID_LONG),
        },
        "regional_latest": {
            "fiscal_year": REGIONAL_FISCAL_YEAR,
            "dispatch_short": REGIONAL_DISPATCH_SHORT,
            "dispatch_mid_long": REGIONAL_DISPATCH_MID_LONG,
            "inflow_short": REGIONAL_INFLOW_SHORT,
            "inflow_mid_long": REGIONAL_INFLOW_MID_LONG,
        },
    }


# =============================================================================================
# Block 2: oecd_bilateral — OECD「Bibliometric indicators of implied bilateral mobility flows」
# =============================================================================================

OECD_URL = (
    "https://sdmx.oecd.org/public/rest/data/OECD.STI.STP,DSD_BIBLIO_F@DF_BIBLIO_F,1.0/"
    "...?format=csvfilewithlabels"
)
OECD_SOURCE = {
    "title": "OECD「Bibliometric indicators of implied bilateral mobility flows」（Scopus著者データによる推計）",
    "url": "https://data-explorer.oecd.org/vis?df[ds]=DisseminateFinalDMZ&df[id]=DSD_BIBLIO_F%40DF_BIBLIO_F&df[ag]=OECD.STI.STP",
}

# 上位に登場する国・地域の日本語対訳（手動整備。ISO3コード基準）
COUNTRY_NAME_JA: dict[str, str] = {
    "USA": "アメリカ合衆国", "CHN": "中国", "IDN": "インドネシア", "GBR": "イギリス",
    "DEU": "ドイツ", "KOR": "韓国", "THA": "タイ", "FRA": "フランス", "IND": "インド",
    "CAN": "カナダ", "BGD": "バングラデシュ", "VNM": "ベトナム", "AUS": "オーストラリア",
    "EGY": "エジプト", "MYS": "マレーシア", "TWN": "台湾", "CHE": "スイス",
    "SGP": "シンガポール", "SWE": "スウェーデン", "ITA": "イタリア", "NLD": "オランダ",
    "ESP": "スペイン", "RUS": "ロシア", "BEL": "ベルギー", "AUT": "オーストリア",
    "PHL": "フィリピン", "PAK": "パキスタン", "IRN": "イラン", "SAU": "サウジアラビア",
    "POL": "ポーランド", "BRA": "ブラジル", "MEX": "メキシコ", "NZL": "ニュージーランド",
    "DNK": "デンマーク", "FIN": "フィンランド", "NOR": "ノルウェー", "ISR": "イスラエル",
    "PRT": "ポルトガル", "TUR": "トルコ", "IRL": "アイルランド", "ZAF": "南アフリカ",
    "CZE": "チェコ", "GRC": "ギリシャ", "HUN": "ハンガリー", "COL": "コロンビア",
    "ARE": "アラブ首長国連邦",
}

EXPECTED_OUTFLOW_TOTAL = 63891
EXPECTED_INFLOW_TOTAL = 58890


def block_oecd_bilateral() -> dict[str, object]:
    text = fetch(OECD_URL).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    outflows: dict[str, list[object]] = {}
    inflows: dict[str, list[object]] = {}
    outflow_total = 0
    inflow_total = 0
    for row in reader:
        if row.get("MEASURE") != "BILAT_AUT":
            continue
        value_text = row.get("OBS_VALUE", "")
        try:
            value = int(float(value_text))
        except ValueError:
            continue
        origin = row.get("ORIGIN", "")
        dest = row.get("DESTINATION", "")
        if origin == "JPN":
            outflow_total += value
            outflows[dest] = [dest, row.get("Destination", ""), value]
        if dest == "JPN":
            inflow_total += value
            inflows[origin] = [origin, row.get("Origin", ""), value]

    if outflow_total != EXPECTED_OUTFLOW_TOTAL:
        raise ValueError(f"OECD outflow total mismatch: got {outflow_total}, expected {EXPECTED_OUTFLOW_TOTAL}")
    if inflow_total != EXPECTED_INFLOW_TOTAL:
        raise ValueError(f"OECD inflow total mismatch: got {inflow_total}, expected {EXPECTED_INFLOW_TOTAL}")

    def top20(rows: dict[str, list[object]]) -> list[dict[str, object]]:
        ranked = sorted(rows.values(), key=lambda item: item[2], reverse=True)[:20]
        return [
            {
                "country_code": code,
                "country_name_ja": COUNTRY_NAME_JA.get(code, name_en),
                "persons": persons,
            }
            for code, name_en, persons in ranked
        ]

    return {
        "status": "ok",
        "unit": "人（2010-2024年累積）",
        "source": OECD_SOURCE,
        "note": (
            "Scopus著者データによる推計。2010-2024年に2本以上の論文がある著者の最初と最後の"
            "所属国の違いを移動とみなす。単一スナップショットで年次推移はない。人文社会科学の"
            "カバレッジは弱い。"
        ),
        "japan_outflows": top20(outflows),
        "japan_inflows": top20(inflows),
        "totals": {"outflow_total": outflow_total, "inflow_total": inflow_total},
    }


# =============================================================================================
# Block 3: foreign_faculty — e-Stat「学校教員統計調査」大学の外国人本務教員数（補助指標）
# =============================================================================================

FOREIGN_FACULTY_ROUNDS = [
    {
        "fiscal_year": 2025,
        "survey_round": "令和7年度（中間報告）",
        "url": "https://www.e-stat.go.jp/stat-search/file-download?statInfId=000040477655&fileKind=0",
    },
]
FOREIGN_FACULTY_SOURCE = {
    "title": "文部科学省「学校教員統計調査」年齢別 職名別 本務教員数（大学）うち外国人（令和7年度中間報告）",
    # 実際に取得しているe-Statのファイル直リンク（一般検索ページではなく取得実体を出典にする）
    "url": FOREIGN_FACULTY_ROUNDS[0]["url"],
}


def _foreign_faculty_point(round_info: dict[str, str]) -> dict[str, object]:
    rows = read_sheet(fetch(round_info["url"]), "xl/worksheets/sheet5.xml")
    for values in rows.values():
        if values.get("A", "").strip() == "本務教員の計":
            # 列A=区分ラベル、列B・Cは結合セルで空、列D=計／E=男／F=女（区分「計」列の内訳）。
            total = int(values["D"].replace(",", ""))
            male = int(values["E"].replace(",", ""))
            female = int(values["F"].replace(",", ""))
            return {
                "fiscal_year": round_info["fiscal_year"],
                "survey_round": round_info["survey_round"],
                "total": total,
                "male": male,
                "female": female,
            }
    raise ValueError(f"row '本務教員の計' not found in {round_info['survey_round']}")


def block_foreign_faculty() -> dict[str, object]:
    series = [_foreign_faculty_point(round_info) for round_info in FOREIGN_FACULTY_ROUNDS]
    if not series:
        raise ValueError("no foreign_faculty rounds fetched")
    return {
        "status": "ok",
        "unit": "人（本務教員、ストック）",
        "source": FOREIGN_FACULTY_SOURCE,
        "note": (
            "3年周期の調査（フローではなく在籍者数）。過去回（令和4・令和元・平成28年度等）の"
            "ファイルはe-Statのファイル一覧の探索を15分の時間枠内で行ったが特定できず、直近1"
            "時点（令和7年度中間報告）のみを掲載。推測で埋めていない。"
        ),
        "series": series,
    }


# =============================================================================================
# Block 4: reico_flows — OECD ReICO「R&I talent circulation」（本命データ）
# =============================================================================================
#
# Scopus著者データに基づき、著者の所属国変遷から年次の国際流入/流出/帰国者数を按分推計した
# OECDの新しいデータセット（DSD_REICO_FULL@DF_RDC）。既存の oecd_bilateral（2010-2024年の
# 累積・国別マトリクス）とは別物で、こちらは「ある年に何人流出/流入したか」の年次時系列と
# 多国間比較ができる。実URLから取得し、既知の2024年内訳（調査で確認済み）と突合検証する。

REICO_URL = (
    "https://sdmx.oecd.org/public/rest/data/OECD.STI.STP,DSD_REICO_FULL@DF_RDC,2.0/"
    "JPN+USA+GBR+DEU+FRA+KOR+CAN+ITA+CHN+AUS.RDC.ANNUAL_FLOWS_NB+INFLOW_NB+OUTFLOW_NB+"
    "RETURN_NB+STAY_NB+MOBILITY_NB+AUTHORS_NB.BIBLIO/all?format=csvfilewithlabels"
)
REICO_SOURCE = {
    "title": "OECD ReICO（Research and Innovation Careers Observatory）「R&I talent circulation」",
    "url": "https://sdmx.oecd.org/public/rest/dataflow/OECD.STI.STP/DSD_REICO_FULL@DF_RDC/2.0/?references=all&format=jsondata",
}
REICO_COUNTRIES = ["JPN", "USA", "GBR", "DEU", "FRA", "KOR", "CAN", "ITA", "CHN", "AUS"]
REICO_COUNTRY_NAME_JA: dict[str, str] = {
    "JPN": "日本", "USA": "アメリカ合衆国", "GBR": "イギリス", "DEU": "ドイツ",
    "FRA": "フランス", "KOR": "韓国", "CAN": "カナダ", "ITA": "イタリア",
    "CHN": "中国", "AUS": "オーストラリア",
}
REICO_LATEST_YEAR = 2024
# 検証用の既知値（2024年・日本）。取得値がこれと大きくズレたらAPI仕様変更や取得ミスを疑う。
REICO_EXPECTED_JPN_2024 = {"INFLOW_NB": 3036, "OUTFLOW_NB": 4795, "RETURN_NB": 1438, "STAY_NB": 187284}


def block_reico_flows() -> dict[str, object]:
    text = fetch(REICO_URL).decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    # values[country_code][VAR][year] = observation value
    values: dict[str, dict[str, dict[int, float]]] = {}
    for row in reader:
        country = row.get("REF_AREA", "")
        var = row.get("VAR", "")
        year_text = row.get("TIME_PERIOD", "")
        obs_text = row.get("OBS_VALUE", "")
        if not (country and var and year_text and obs_text):
            continue
        try:
            year = int(year_text)
            value = float(obs_text)
        except ValueError:
            continue
        values.setdefault(country, {}).setdefault(var, {})[year] = value

    jpn = values.get("JPN", {})
    annual_net_map = jpn.get("ANNUAL_FLOWS_NB", {})
    if not annual_net_map:
        raise ValueError("no ANNUAL_FLOWS_NB series for Japan")
    annual_net = [[year, round(annual_net_map[year], 2)] for year in sorted(annual_net_map)]

    latest_breakdown = {
        "fiscal_year": REICO_LATEST_YEAR,
        "inflow": jpn.get("INFLOW_NB", {}).get(REICO_LATEST_YEAR),
        "outflow": jpn.get("OUTFLOW_NB", {}).get(REICO_LATEST_YEAR),
        "returnees": jpn.get("RETURN_NB", {}).get(REICO_LATEST_YEAR),
        "stay": jpn.get("STAY_NB", {}).get(REICO_LATEST_YEAR),
        "mobility": jpn.get("MOBILITY_NB", {}).get(REICO_LATEST_YEAR),
        "authors_total": jpn.get("AUTHORS_NB", {}).get(REICO_LATEST_YEAR),
    }
    for key, var in (("inflow", "INFLOW_NB"), ("outflow", "OUTFLOW_NB"), ("returnees", "RETURN_NB"), ("stay", "STAY_NB")):
        expected = REICO_EXPECTED_JPN_2024[var]
        actual = latest_breakdown[key]
        if actual is None or abs(actual - expected) > 1:
            raise ValueError(f"reico {var} {REICO_LATEST_YEAR}: got {actual}, expected ~{expected}")
    # 検証値のないmobility/authors_totalも、欠損のままstatus:okで公開しない
    for key in ("mobility", "authors_total"):
        value = latest_breakdown[key]
        if value is None or not isinstance(value, (int, float)) or value <= 0:
            raise ValueError(f"reico {key} {REICO_LATEST_YEAR}: missing or non-positive ({value})")

    country_comparison = []
    for code in REICO_COUNTRIES:
        net = values.get(code, {}).get("ANNUAL_FLOWS_NB", {}).get(REICO_LATEST_YEAR)
        authors = values.get(code, {}).get("AUTHORS_NB", {}).get(REICO_LATEST_YEAR)
        if net is None or authors is None or authors <= 0:
            continue
        country_comparison.append({
            "country_code": code,
            "country_name_ja": REICO_COUNTRY_NAME_JA.get(code, code),
            "annual_net": round(net, 2),
            "authors_total": int(authors),
            "net_flow_rate_pct": round(net / authors * 100, 3),
        })

    return {
        "status": "ok",
        "unit": "人（Scopus著者データに基づく年次推計。按分のため小数）",
        "source": REICO_SOURCE,
        "note": (
            "Scopus著者データに基づくOECDの推計（按分のため小数）。著者の所属国変遷から流入・"
            "流出・帰国を年次で推定している。ReICOは新しいプロジェクトで方法論の詳細公開が"
            "限定的。内訳指標（流入/流出/帰国/残留/移動経験者数）は2024年分のみ提供されており、"
            "過去年（2011-2024）は純流入数（annual_net）のみ利用可能。net_flow_rate_pctは"
            "純流入数を総著者数（残留者+国際移動経験者）で割った比率で、OECD提供の事前計算"
            "比率変数（ANNUAL_FLOWS_NBXAUTHORS）は値が未整備だったためスクリプト内で算出した。"
        ),
        "annual_net": annual_net,
        "latest_breakdown": latest_breakdown,
        "country_comparison": country_comparison,
    }


# =============================================================================================
# Block 5: jsps_overseas_fellows — JSPS海外特別研究員の帰国後進路（検証済み静的定数）
# =============================================================================================

JSPS_SOURCE = {
    "title": "日本学術振興会「海外特別研究員の就職状況調査結果について」（令和7年度調査、令和4年度採用者分）",
    "url": "https://www.jsps.go.jp/file/storage/j-ab/data/syusyoku/ab_syusyoku_r7.pdf",
}
# 円グラフPDF（採用終了後の身分、令和4年度採用者147人）からの手動転記。合計=147人になることを検証。
JSPS_DESTINATIONS = [
    {"label": "常勤の研究職（国内）", "count": 60, "pct": 40.8},
    {"label": "常勤の研究職（海外）", "count": 25, "pct": 17.0},
    {"label": "非常勤の研究職", "count": 5, "pct": 3.4},
    {"label": "ポスドク（国内）", "count": 3, "pct": 2.0},
    {"label": "ポスドク（海外）", "count": 43, "pct": 29.3},
    {"label": "非研究職", "count": 11, "pct": 7.5},
]
# 採用状況発表ページの各年度値（令和4〜8年度）。
JSPS_ACCEPTANCE_TREND = [
    {"fiscal_year": 2022, "accepted": 149, "rate_pct": 26.4},
    {"fiscal_year": 2023, "accepted": 135, "rate_pct": 26.5},
    {"fiscal_year": 2024, "accepted": 160, "rate_pct": 27.3},
    {"fiscal_year": 2025, "accepted": 188, "rate_pct": 31.2},
    {"fiscal_year": 2026, "accepted": 195, "rate_pct": 27.6},
]


def block_jsps_overseas_fellows() -> dict[str, object]:
    n_total = sum(d["count"] for d in JSPS_DESTINATIONS)
    if n_total != 147:
        raise ValueError(f"JSPS destinations do not sum to 147: got {n_total}")
    # 転記したpctが人数から再計算した値と一致するか（原典の丸め±0.15ppまで許容）
    for d in JSPS_DESTINATIONS:
        recomputed = d["count"] / n_total * 100
        if abs(recomputed - d["pct"]) > 0.15:
            raise ValueError(f"JSPS pct mismatch for {d['label']}: {d['pct']} vs recomputed {recomputed:.1f}")
    abroad_count = sum(d["count"] for d in JSPS_DESTINATIONS if "海外" in d["label"])
    return {
        "status": "ok",
        "unit": "人",
        "source": JSPS_SOURCE,
        "note": (
            "選抜された若手研究者（単年コホート147人、令和4年度採用者）であり博士人材全体を"
            "代表しない。円グラフPDFからの手動転記。abroad_totalは「常勤の研究職（海外）」と"
            "「ポスドク（海外）」の合計＝任期終了後も日本に戻らず海外に残った者。"
        ),
        "cohort_fiscal_year": 2022,
        "survey_fiscal_year": 2025,
        "n_total": n_total,
        "destinations": JSPS_DESTINATIONS,
        "abroad_total": {"count": abroad_count, "pct": round(abroad_count / n_total * 100, 1)},
        "acceptance_trend": JSPS_ACCEPTANCE_TREND,
    }


# =============================================================================================
# Block 6: nsf_sed — 米国博士号取得者の国籍別人数・米国残留意向（検証済み静的定数）
# =============================================================================================
# NCSES Survey of Earned Doctorates の公式xlsx（Table 7-8, Table 2-8）から、openpyxlで
# 全行を機械的に確認して転記した数値（手読みではなくセル値の直接検証）。

NSF_SED_SOURCE = [
    {
        "title": "NCSES Survey of Earned Doctorates, Table 7-8（2024年、一時ビザ保有者・上位40か国）",
        "url": "https://ncses.nsf.gov/pubs/nsf25349/assets/data-tables/tables/nsf25349-tab007-008.xlsx",
    },
    {
        "title": "NCSES Survey of Earned Doctorates, Table 7-8（2022年、比較用）",
        "url": "https://ncses.nsf.gov/pubs/nsf24300/assets/data-tables/tables/nsf24300-tab007-008.xlsx",
    },
    {
        "title": "NCSES Survey of Earned Doctorates, Table 2-8（米国残留意向、2018-2024年）",
        "url": "https://ncses.nsf.gov/pubs/nsf25349/assets/data-tables/tables/nsf25349-tab002-008.xlsx",
    },
]

NSF_SED_RANK_BY_YEAR = {
    2022: {
        "total_all": 19107, "total_countries": 157,
        "countries": {
            "JPN": {"rank": 25, "count": 121}, "CHN": {"rank": 1, "count": 6664},
            "IND": {"rank": 2, "count": 2671}, "KOR": {"rank": 3, "count": 1076},
        },
    },
    2024: {
        "total_all": 18819, "total_countries": 159,
        "countries": {
            "JPN": {"rank": 23, "count": 138}, "CHN": {"rank": 1, "count": 6756},
            "IND": {"rank": 2, "count": 2649}, "KOR": {"rank": 3, "count": 1061},
        },
    },
}

# "definite plans to stay in the United States" 率（％）、2018-2024年次推移＋累計。
NSF_SED_STAY_INTENT = {
    "JPN": {
        "country_name_ja": "日本",
        "series": [[2018, 50.0], [2019, 51.6], [2020, 50.0], [2021, 49.6], [2022, 52.1], [2023, 50.4], [2024, 55.8]],
        "cumulative_2018_24_pct": 51.5, "cumulative_2018_24_n": 857,
    },
    "CHN": {
        "country_name_ja": "中国",
        "series": [[2018, 79.4], [2019, 79.2], [2020, 80.1], [2021, 73.8], [2022, 76.7], [2023, 77.6], [2024, 79.3]],
        "cumulative_2018_24_pct": 78.0, "cumulative_2018_24_n": 45103,
    },
    "IND": {
        "country_name_ja": "インド",
        "series": [[2018, 87.1], [2019, 85.9], [2020, 88.0], [2021, 85.8], [2022, 88.2], [2023, 89.0], [2024, 88.4]],
        "cumulative_2018_24_pct": 87.6, "cumulative_2018_24_n": 16738,
    },
    "KOR": {
        "country_name_ja": "韓国",
        "series": [[2018, 63.6], [2019, 65.3], [2020, 66.9], [2021, 63.8], [2022, 65.1], [2023, 71.1], [2024, 69.7]],
        "cumulative_2018_24_pct": 66.5, "cumulative_2018_24_n": 7543,
    },
    "ALL": {
        "country_name_ja": "全一時ビザ保有者平均",
        "series": [[2018, 72.0], [2019, 71.2], [2020, 73.0], [2021, 70.8], [2022, 74.3], [2023, 76.2], [2024, 75.8]],
        "cumulative_2018_24_pct": 73.4, "cumulative_2018_24_n": 130525,
    },
}


def block_nsf_sed() -> dict[str, object]:
    # 手動転記定数の構造検証: 率は0-100%、系列は2018-2024の連続年、人数・母数は正
    for year, table in NSF_SED_RANK_BY_YEAR.items():
        if table["total_all"] <= 0 or table["total_countries"] <= 0:
            raise ValueError(f"nsf_sed rank table {year}: non-positive totals")
        for code, row in table["countries"].items():
            if row["rank"] <= 0 or row["count"] <= 0:
                raise ValueError(f"nsf_sed rank table {year}/{code}: invalid rank/count")
    for code, entry in NSF_SED_STAY_INTENT.items():
        years = [y for y, _ in entry["series"]]
        if years != list(range(2018, 2025)):
            raise ValueError(f"nsf_sed stay_intent {code}: years not continuous 2018-2024")
        if not all(0 <= pct <= 100 for _, pct in entry["series"]):
            raise ValueError(f"nsf_sed stay_intent {code}: pct out of range")
        if not 0 <= entry["cumulative_2018_24_pct"] <= 100 or entry["cumulative_2018_24_n"] <= 0:
            raise ValueError(f"nsf_sed stay_intent {code}: invalid cumulative values")
    return {
        "status": "ok",
        "unit": "人（一時ビザ保有者の博士号取得者数）／％（米国残留意向）",
        "source": NSF_SED_SOURCE,
        "note": (
            "一時ビザ保有者のみが対象（米国永住権者・市民権者は含まない）。残留『意向』であり"
            "博士号取得後に実際に米国に居住し続けたかを検証した数値ではない（SED回答時点の"
            "自己申告）。日本は年間100人台と絶対数が小さいため、年次のパーセンテージ変動は"
            "統計的ノイズを含みうる。"
        ),
        "rank_by_year": NSF_SED_RANK_BY_YEAR,
        "stay_intent": NSF_SED_STAY_INTENT,
    }


# =============================================================================================
# Block 7: jdpro — NISTEP「博士人材追跡調査」の国籍別国際移動（検証済み静的定数）
# =============================================================================================

JDPRO_SOURCE = [
    {"title": "NISTEP「博士人材追跡調査」第3次報告書（NISTEP Report No.188、2020年11月）", "url": "https://doi.org/10.15108/nr188"},
    {"title": "NISTEP「博士人材追跡調査」第4次報告書（NISTEP RM317、2022年1月）", "url": "https://doi.org/10.15108/rm317"},
    {"title": "NISTEP「博士人材追跡調査」第5次報告書（NISTEP RM356、2026年5月）", "url": "https://doi.org/10.15108/rm356"},
]

# 第3次報告書 概要図表9-3・9-4より。日本国籍の博士課程修了者のうち「海外居住・研究活動実施」の割合。
JDPRO_JAPANESE_ABROAD = {
    "cohort2012": [{"elapsed_years": 1.5, "pct": 5.2}, {"elapsed_years": 3.5, "pct": 4.7}, {"elapsed_years": 6.5, "pct": 2.5}],
    "cohort2015": [{"elapsed_years": 0.5, "pct": 4.0}, {"elapsed_years": 3.5, "pct": 5.3}],
}
# 第3次報告書 概要図表9-1・9-2より。外国籍の博士課程修了者のうち「日本居住継続・研究活動実施」の割合。
JDPRO_FOREIGN_STAY_JAPAN = {
    "cohort2012": [{"elapsed_years": 1.5, "pct": 44.3}, {"elapsed_years": 6.5, "pct": 24.1}],
    "cohort2015": [{"elapsed_years": 0.5, "pct": 38.9}, {"elapsed_years": 3.5, "pct": 28.1}],
}
# 参考値: 国籍非区分（全回答者、外国籍を含む）の「現在の居住国」単純集計。第4次・第5次報告書。
JDPRO_LATEST_RESIDENCE = [
    {"cohort_fiscal_year": 2018, "report": "第4次報告書", "japan_pct": 80.0},
    {"cohort_fiscal_year": 2021, "report": "第5次報告書", "japan_pct": 80.9},
]


def block_jdpro() -> dict[str, object]:
    # 手動転記定数の構造検証: 経過年数は昇順、率は0-100%
    for name, table in (("japanese_abroad", JDPRO_JAPANESE_ABROAD), ("foreign_stay_japan", JDPRO_FOREIGN_STAY_JAPAN)):
        for cohort, points in table.items():
            elapsed = [p["elapsed_years"] for p in points]
            if elapsed != sorted(elapsed):
                raise ValueError(f"jdpro {name}/{cohort}: elapsed_years not ascending")
            if not all(0 <= p["pct"] <= 100 for p in points):
                raise ValueError(f"jdpro {name}/{cohort}: pct out of range")
    if not all(0 <= r["japan_pct"] <= 100 for r in JDPRO_LATEST_RESIDENCE):
        raise ValueError("jdpro latest_residence: pct out of range")
    return {
        "status": "ok",
        "unit": "%（コホート内割合）",
        "source": JDPRO_SOURCE,
        "note": (
            "国籍別の国際移動集計は第3次報告書のみに存在し、第4次・第5次報告書では再掲されて"
            "いない。コホートごとに追跡経過年数が異なり単純な時系列比較はできない（2012年度"
            "コホートは1.5/3.5/6.5年後、2015年度コホートは0.5/3.5年後）。japanese_abroad=日本"
            "国籍修了者のうち海外居住・研究活動実施の割合、foreign_stay_japan=外国籍修了者の"
            "うち日本居住継続・研究活動実施の割合（低下＝離日の増加）。latest_residenceは国籍"
            "非区分（外国籍を含む全回答者のうち日本居住の割合）の参考値で、海外就職率とは"
            "別の指標。PDF掲載値の手動転記。"
        ),
        "japanese_abroad": JDPRO_JAPANESE_ABROAD,
        "foreign_stay_japan": JDPRO_FOREIGN_STAY_JAPAN,
        "latest_residence": JDPRO_LATEST_RESIDENCE,
    }


def run_block(name: str, builder) -> dict[str, object]:
    try:
        block = builder()
        print(f"[mobility] {name}: ok")
        return block
    except Exception as error:  # noqa: BLE001 — degrade gracefully, keep provenance
        print(f"[mobility] {name}: FAILED — {error}")
        return {"status": "error", "note": str(error)[:300]}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    payload: dict[str, object] = {
        "schema_version": 1,
        "generated_at": now_iso(),
        "mext_flows": run_block("mext_flows", block_mext_flows),
        "oecd_bilateral": run_block("oecd_bilateral", block_oecd_bilateral),
        "foreign_faculty": run_block("foreign_faculty", block_foreign_faculty),
        "reico_flows": run_block("reico_flows", block_reico_flows),
        "jsps_overseas_fellows": run_block("jsps_overseas_fellows", block_jsps_overseas_fellows),
        "nsf_sed": run_block("nsf_sed", block_nsf_sed),
        "jdpro": run_block("jdpro", block_jdpro),
    }

    # 一時的な取得失敗で公開済みの正常データを潰さない: 前回ファイルの正常ブロックを保持
    if args.output.exists():
        try:
            previous = json.loads(args.output.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            previous = {}
        for key in ("mext_flows", "oecd_bilateral", "foreign_faculty", "reico_flows", "jsps_overseas_fellows", "nsf_sed", "jdpro"):
            if payload[key].get("status") != "ok" and previous.get(key, {}).get("status") == "ok":
                kept = previous[key]
                kept["note"] = f"{kept.get('note', '')} 直近の取得に失敗したため前回取得値を表示。".strip()
                payload[key] = kept
                print(f"[mobility] {key}: kept previous ok block")

    args.output.parent.mkdir(parents=True, exist_ok=True)
    # 実行中断で公開JSONが空・途中状態にならないよう、一時ファイル経由で原子的に置き換える
    tmp_path = args.output.with_suffix(".json.tmp")
    tmp_path.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    os.replace(tmp_path, args.output)
    print(f"[mobility] wrote {args.output} ({args.output.stat().st_size:,} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
