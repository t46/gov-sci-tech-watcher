#!/usr/bin/env python3
"""Fetch international researcher mobility data for the 人材 atlas ("研究者の国際移動" 章).

Three blocks, three very different provenance stories:

- mext_flows: 文部科学省「国際研究交流の概況」の年度別推移（派遣／受入 × 短期／中・長期）。
  この調査は集計表（xlsx等）を公開しておらず、公表資料はグラフ画像に数値ラベルが
  印字された形でしか存在しない。そのため時系列本体（1993〜2024年度、32年×4系列）は
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
    }

    # 一時的な取得失敗で公開済みの正常データを潰さない: 前回ファイルの正常ブロックを保持
    if args.output.exists():
        try:
            previous = json.loads(args.output.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            previous = {}
        for key in ("mext_flows", "oecd_bilateral", "foreign_faculty"):
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
