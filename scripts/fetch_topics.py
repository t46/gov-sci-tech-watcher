#!/usr/bin/env python3
"""Fetch Japan's research theme composition (OpenAlex primary_topic.field / .subfield) by year.

One-shot local batch (not part of the scheduled refresh):
    uv run python scripts/fetch_topics.py

Method:
- OpenAlex works?filter=authorships.countries:JP,publication_year:{Y},type:article
  &group_by=primary_topic.field.id / primary_topic.subfield.id を1980〜2025年の各年で叩く
  （年2リクエスト = field 1回 + subfield 1回、計約92回）。
- group_by が返す26分野（field — Scopus ASJC相当の広域分類）および252下位分野（subfield）別件数を、
  その年の分類済み論文合計に対する割合（%）に変換してフロント側で描画する。subfieldのシェアの分母は
  常にfield（26分野、上位200件の枠にかからず完全集計）のその年の合計を使う——subfield側の合計を
  分母にすると200件キャップで欠けた分だけ実際より過大なシェアになってしまうため。
- subfieldのgroup_byは1リクエストにつき上位200グループまでしか返さない。ある年にJPの論文がある
  subfieldが200を超えていれば、下位のものはその年のレスポンスに出現しない。group_byはゼロ件の
  グループを返さない仕様上、「真に0件」と「200件の枠外に落ちて取得できなかった」は元データから
  区別できないため、該当年のcountsは0ではなく null で埋める（下記参照）。フロント側もcountsに
  null があり得る前提で扱い、null の年に架空の順位・シェア値を作らない。ただし上位ランクの分析
  （上位12〜15 subfieldのシェア推移）には実務上影響しない — 200位を争うほど僅少なsubfieldが
  トップ争いに入ることはないため。
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

# OpenAlexの primary_topic.subfield は252の下位分野（Scopus ASJC 4桁相当）。上位に来る主要な
# ものだけ丁寧な日本語訳を付け、残りは英語表記のまま出す（機械的な誤訳を避けるため）。
SUBFIELD_NAME_JA = {
    "Artificial Intelligence": "人工知能",
    "Computer Vision and Pattern Recognition": "コンピュータビジョン・パターン認識",
    "Computer Networks and Communications": "計算機ネットワーク・通信",
    "Software": "ソフトウェア",
    "Information Systems": "情報システム",
    "Computer Science Applications": "計算機科学の応用",
    "Human-Computer Interaction": "ヒューマンコンピュータインタラクション",
    "Signal Processing": "信号処理",
    "Hardware and Architecture": "ハードウェア・アーキテクチャ",
    "Theoretical Computer Science": "理論計算機科学",
    "Materials Chemistry": "材料化学",
    "Condensed Matter Physics": "物性物理学",
    "Electronic, Optical and Magnetic Materials": "電子・光学・磁性材料",
    "Ceramics and Composites": "セラミックス・複合材料",
    "Metals and Alloys": "金属・合金",
    "Surfaces, Coatings and Films": "表面・コーティング・薄膜",
    "Polymers and Plastics": "高分子・プラスチック",
    "Biomaterials": "生体材料",
    "Genetics": "遺伝学",
    "Molecular Biology": "分子生物学",
    "Biochemistry": "生化学",
    "Cell Biology": "細胞生物学",
    "Structural Biology": "構造生物学",
    "Cancer Research": "がん研究",
    "Oncology": "腫瘍学",
    "Immunology": "免疫学",
    "Microbiology": "微生物学",
    "Pharmacology": "薬理学",
    "Organic Chemistry": "有機化学",
    "Inorganic Chemistry": "無機化学",
    "Analytical Chemistry": "分析化学",
    "Physical and Theoretical Chemistry": "物理化学・理論化学",
    "Catalysis": "触媒化学",
    "Electrochemistry": "電気化学",
    "Electrical and Electronic Engineering": "電気電子工学",
    "Mechanical Engineering": "機械工学",
    "Civil and Structural Engineering": "土木・構造工学",
    "Industrial and Manufacturing Engineering": "生産・製造工学",
    "Control and Systems Engineering": "制御・システム工学",
    "Automotive Engineering": "自動車工学",
    "Aerospace Engineering": "航空宇宙工学",
    "Biomedical Engineering": "生体医工学",
    "Ecology, Evolution, Behavior and Systematics": "生態学・進化学",
    "Plant Science": "植物科学",
    "Animal Science and Zoology": "畜産学・動物学",
    "Agronomy and Crop Science": "作物学・農学",
    "Food Science": "食品科学",
    "Public Health, Environmental and Occupational Health": "公衆衛生・環境保健・産業保健",
    "Epidemiology": "疫学",
    "Internal Medicine": "内科学",
    "Surgery": "外科学",
    "Radiology, Nuclear Medicine and Imaging": "放射線・核医学・画像診断",
    "Neurology": "神経内科学",
    "Psychiatry and Mental Health": "精神医学",
    "Ophthalmology": "眼科学",
    "Urology": "泌尿器科学",
    "Orthopedics and Sports Medicine": "整形外科・スポーツ医学",
    "Obstetrics and Gynecology": "産婦人科学",
    "Pediatrics, Perinatology and Child Health": "小児科・周産期医学",
    "Health Policy": "保健政策",
    "Health Informatics": "医療情報学",
    "Economics and Econometrics": "経済学・計量経済学",
    "Finance": "金融論",
    "Business and International Management": "経営学・国際経営",
    "Strategy and Management": "経営戦略論",
    "Law": "法学",
    "Political Science and International Relations": "政治学・国際関係論",
    "Sociology and Political Science": "社会学・政治学",
    "Linguistics and Language": "言語学",
    "Literature and Literary Theory": "文学・文学理論",
    "History": "歴史学",
    "Philosophy": "哲学",
    "Education": "教育学",
    "Developmental and Educational Psychology": "発達・教育心理学",
    "Applied Psychology": "応用心理学",
    "Clinical Psychology": "臨床心理学",
    "Social Psychology": "社会心理学",
    "Experimental and Cognitive Psychology": "実験・認知心理学",
    "Numerical Analysis": "数値解析",
    "Algebra and Number Theory": "代数学・数論",
    "Applied Mathematics": "応用数学",
    "Computational Mathematics": "計算数学",
    "Discrete Mathematics and Combinatorics": "離散数学・組合せ論",
    "Geometry and Topology": "幾何学・位相幾何学",
    "Mathematical Physics": "数理物理学",
    "Statistics and Probability": "統計学・確率論",
    "Statistics, Probability and Uncertainty": "統計学・確率・不確実性",
    "Astronomy and Astrophysics": "天文学・天体物理学",
    "Atomic and Molecular Physics, and Optics": "原子分子物理学・光学",
    "Nuclear and High Energy Physics": "原子核・高エネルギー物理学",
    "Instrumentation": "計測工学",
    "Renewable Energy, Sustainability and the Environment": "再生可能エネルギー・持続可能性・環境",
    "Energy Engineering and Power Technology": "エネルギー工学・電力技術",
    "Fuel Technology": "燃料技術",
    "Environmental Chemistry": "環境化学",
    "Environmental Engineering": "環境工学",
    "Global and Planetary Change": "地球規模・惑星規模の変動",
    "Ecology": "生態学",
    "Atmospheric Science": "大気科学",
    "Oceanography": "海洋学",
    "Geochemistry and Petrology": "地球化学・岩石学",
    "Geophysics": "地球物理学",
    "Space and Planetary Science": "宇宙惑星科学",
    "Forestry": "林学",
    "Horticulture": "園芸学",
    "Soil Science": "土壌学",
    "Insect Science": "昆虫学",
    "Aquatic Science": "水圏科学",
    "Cardiology and Cardiovascular Medicine": "循環器学",
    "Gastroenterology": "消化器学",
    "Endocrinology, Diabetes and Metabolism": "内分泌・糖尿病・代謝学",
    "Hematology": "血液学",
    "Nephrology": "腎臓学",
    "Pulmonary and Respiratory Medicine": "呼吸器学",
    "Rheumatology": "リウマチ学",
    "Dermatology": "皮膚科学",
    "Anesthesiology and Pain Medicine": "麻酔科学・疼痛医学",
    "Emergency Medicine": "救急医学",
    "Critical Care and Intensive Care Medicine": "集中治療医学",
    "Complementary and Manual Therapy": "補完医療・手技療法",
    "Otorhinolaryngology": "耳鼻咽喉科学",
    "Dentistry (miscellaneous)": "歯学",
    "Oral Surgery": "口腔外科学",
    "Periodontics": "歯周病学",
    "Genetics (clinical)": "臨床遺伝学",
    "Molecular Medicine": "分子医学",
    "Drug Discovery": "創薬科学",
    "Toxicology": "毒性学",
    "Bioengineering": "生物工学",
    "Biophysics": "生物物理学",
    "Biotechnology": "バイオテクノロジー",
    "Physiology": "生理学",
    "Anatomy": "解剖学",
    "Histology": "組織学",
    "Aging": "老年学",
    "Geriatrics and Gerontology": "老年医学",
    "Nutrition and Dietetics": "栄養学",
    "Speech and Hearing": "言語聴覚学",
    "Rehabilitation": "リハビリテーション医学",
    "Physical Therapy, Sports Therapy and Rehabilitation": "理学療法・スポーツ療法",
    "Building and Construction": "建築・建設工学",
    "Architecture": "建築学",
    "Ocean Engineering": "海洋工学",
    "Safety, Risk, Reliability and Quality": "安全・リスク・信頼性・品質工学",
    "Modeling and Simulation": "モデリング・シミュレーション",
    "Media Technology": "メディア技術",
    "Computer Graphics and Computer-Aided Design": "コンピュータグラフィックス・CAD",
    "Library and Information Sciences": "図書館情報学",
    "Management Information Systems": "経営情報システム論",
    "Management of Technology and Innovation": "技術・イノベーション経営論",
    "Communication": "コミュニケーション学",
    "Cultural Studies": "文化研究",
    "Anthropology": "人類学",
    "Archaeology": "考古学",
    "Applied Microbiology and Biotechnology": "応用微生物学・バイオテクノロジー",
    "Virology": "ウイルス学",
    "Parasitology": "寄生虫学",
    "Infectious Diseases": "感染症学",
    "Public Administration": "行政学",
    "Human Factors and Ergonomics": "人間工学",
    "Transportation": "交通工学",
    "Fluid Flow and Transfer Processes": "流体力学・移動現象",
    "Process Chemistry and Technology": "プロセス化学・工学",
    "Colloid and Surface Chemistry": "コロイド・表面化学",
    "Waste Management and Disposal": "廃棄物管理・処理",
    "Pollution": "汚染科学",
    "Management, Monitoring, Policy and Law": "資源管理・モニタリング・政策・法",
    "Nature and Landscape Conservation": "自然・景観保全",
    "Spectroscopy": "分光学",
    "Mechanics of Materials": "材料力学",
    "Cellular and Molecular Neuroscience": "細胞分子神経科学",
    "Cognitive Neuroscience": "認知神経科学",
    "Biological Psychiatry": "生物学的精神医学",
    "Psychiatry and Mental health": "精神医学・メンタルヘルス",
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


def fetch_year(year: int, group_by: str) -> list[dict]:
    params = {
        "filter": f"authorships.countries:JP,publication_year:{year},type:article",
        "group_by": group_by,
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
    subfield_names: dict[str, str] = {}  # subfield_id -> English display name
    subfield_counts: dict[str, dict[int, int]] = defaultdict(dict)
    requests_made = 0

    for year in years:
        groups = fetch_year(year, "primary_topic.field.id")
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

        sub_groups = fetch_year(year, "primary_topic.subfield.id")
        requests_made += 1
        for group in sub_groups:
            key = str(group.get("key") or "")
            if not key:
                continue
            subfield_id = key.rsplit("/", 1)[-1]
            name = str(group.get("key_display_name") or "")
            if name:
                subfield_names[subfield_id] = name
            subfield_counts[subfield_id][year] = int(group.get("count", 0))
        sub_total = sum(int(g.get("count", 0)) for g in sub_groups)
        print(f"[topics] {year}: {len(sub_groups)} subfields, {sub_total} papers (classified)")
        time.sleep(0.2 if API_KEY else 0.4)

    fields = []
    for field_id, name in sorted(field_names.items(), key=lambda kv: kv[1]):
        name_ja = FIELD_NAME_JA.get(name, name)
        counts = [field_counts[field_id].get(y, 0) for y in years]
        fields.append({"id": field_id, "name": name, "name_ja": name_ja, "counts": counts})

    subfields = []
    for subfield_id, name in sorted(subfield_names.items(), key=lambda kv: kv[1]):
        name_ja = SUBFIELD_NAME_JA.get(name, name)
        # 欠損年（当年group_byの上位200件に入らなかった年）は null で埋める。group_by はゼロ件の
        # グループを返さないため、「真に0件」と「200件の枠外に落ちて取得できなかった」は元データから
        # 区別できない。0で埋めると偽の実測値を作ってしまうので、判別不能であることを null で明示する。
        counts = [subfield_counts[subfield_id].get(y) for y in years]
        subfields.append({"id": subfield_id, "name": name, "name_ja": name_ja, "counts": counts})

    payload = {
        "status": "ok",
        "generated_at": now_iso(),
        "source": {"title": "OpenAlex API（CC0）", "url": "https://openalex.org/"},
        "years": years,
        "fields": fields,
        "subfields": subfields,
        "requests": requests_made,
        "note": (
            "日本の所属を含む著者による論文（type:article）を、OpenAlexのprimary_topic.field（26分野、"
            "Scopus ASJC相当の広域分類）で年別に集計し、その年の分類済み論文数に対する割合に換算した。"
            "これは研究という成果の側のテーマ構成であり、国の予算配分ではない。日本の科学技術関係予算は"
            "府省庁別にしか公式区分されておらず、テーマ別の予算の長期系列データは存在しない。"
            "分野分類（primary_topic）はOpenAlexのアルゴリズムによる推定であり、著者の自己申告ではない。"
            "1980年代・90年代前半は収録論文自体が少なく、シェアの振れが大きい点に留意。"
        ),
        "subfield_note": (
            "primary_topic.subfield（252下位分野、Scopus ASJC 4桁相当）による年別集計。field（26分野）"
            "よりも一段細かい解像度で、日本の論文がどのテーマで増減してきたかを追える。シェア（%）の分母"
            "は同じ年のfield（26分野、上位200件の枠にかからず常に完全集計）の合計を用いている。group_by "
            "は1リクエストにつき上位200件までしか返さないため、ある年に該当論文が極めて少ないsubfieldは"
            "その年のデータに現れないことがあり、その場合はcountsをnull（0件ではなく「取得不能」）として"
            "いる。上位ランクの推移分析には実務上影響しない。"
        ),
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(f"[topics] wrote {args.output} ({requests_made} requests, {len(fields)} fields, {len(subfields)} subfields)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
