# データソース調査アーカイブ（2026-08 実施）

複数の調査エージェントによる網羅的サーベイの成果物。全URLはダウンロード検証済み（実施日: 2026-08-08）。
運用手順は [finance-sources.md](finance-sources.md)、取得コードは `scripts/fetch_indicators.py` / `scripts/fetch_finance.py` を参照。

## 1. NISTEP 科学技術指標2025（180表・全カタログ確認済み）

- 表データ: `https://www.nistep.go.jp/sti_indicator/2025/hyoudata/STI2025_{章-節-番号}.xlsx`（安定URL・鍵不要）
- 索引: https://www.nistep.go.jp/sti_indicator/2025/RM349_table.html
- 年1回更新（8月頃）。2026年版は `sti_indicator/2026/` になる見込み

### 接続済みの表
| 表 | 内容 | 使用箇所 |
|---|---|---|
| 1-1-3 | 主要国の研究開発費総額の対GDP比率の推移（1981-） | indicators.gerd_gdp |
| 1-1-5 | 負担部門→使用部門への研究開発費の流れ（日米独仏英韓ブロック） | funding_flow |
| 1-2-5 | 政府負担研究開発費の支出先内訳の推移（1981-） | gov_spending_dest |
| 1-2-6 | 基本計画のもとでの科学技術関係予算 | plan_budget |
| 1-2-8 | 府省庁別の科学技術関係予算（1989-、年度バンド複数） | ministry_budget |
| 1-3-10 | 政府による企業R&D直接・間接支援の国際比較 | gov_support_business |
| 1-3-17 | 大学等が企業から受け入れた研究費（1986-） | industry_academia |
| 2-1-3 | 主要国の研究者数の推移（日本は2001年までB列、以降HC/FTE） | researchers |
| 3-2-3 | 博士課程入学者数・専攻別（1981-、ブロックA） | phd_enrollment |
| 3-4-4 | 主要国の博士号取得者数（2000-、ブロックA） | phd_degrees |
| 4-1-7 | 論文数・Top10%・Top1%シェア（整数カウントsheet2、シェア=B..X、実数=AA..BB） | papers |
| 4-1-9 | 分野別論文数割合（年度バンド繰返し構造） | field_share |
| 5-4-5 | 共同研究・受託研究・治験等の受入額（2006-、千円） | joint_research |

### 未接続の有望表
1-2-9〜11（地域の科技予算）、1-3-16（大学の学問分野別研究開発費）、1-3-19（大学の負担源別）、2-1-10〜12（女性研究者）、2-2-16/17（大学教員の年齢構成）、3-3-1〜9（理工系の進路）、4-2系（パテントファミリー）、5-4-8/9（大学発ベンチャー）、5-4-11/12（ユニコーン）

### パーサ実装上の罠
- sharedStringsに**ふりがな（phonetic runs）**が混入 → `<rPh>`を除外して抽出
- 「-」「…」は欠測。データシートは通常 sheet2（sheet1は「必ずお読みください」）
- 4-1-9 / 1-2-8 は年度バンドが縦に繰り返される構造

## 2. 国際・学術API（動作クエリ検証済み）

- **OECD MSTI (SDMX)**: `https://sdmx.oecd.org/public/rest/data/OECD.STI.STP,DSD_MSTI@DF_MSTI,/JPN+USA+KOR+DEU+CHN+FRA+GBR.A.{MEASURE}.{UNIT}..?startPeriod=1990&format=csvfilewithlabels`
  検証済みmeasure: `G.PT_B1GQ`（GERD/GDP）、`T_RS.10P3EMP`（研究者/千人雇用）、`G_FG.PT_GERD`（政府負担率）。他に `C`(GBARD), `G_BR`(基礎研究), `P_PCT`(特許), `TD_E*`(ハイテク貿易) が利用可能
- **OpenAlex**: `https://api.openalex.org/works?filter=institutions.country_code:JP,type:article,publication_year:1990-{年}&group_by=publication_year`
  `type:article` フィルタ必須（無いと2025-26年に異常値混入）。機関別は works の lineage group_by → `/institutions?filter=ids.openalex:ID|ID...` で国コード検証＋`display_name_alternatives` から漢字名取得（`international.display_name.ja` は無い）。CC0
- **e-Stat API**: 未接続（`ESTAT_APP_ID` Secret登録待ち）。科学技術研究調査の複数年DB化・学校基本調査（博士入学者1948-）が解禁される
- **死亡・不採用**: RESAS API（2025-03終了）、内閣府予算PDF（NISTEP/OECDで代替）、KAKEN検索API（全量集計は3時間バッチに不向き）

## 3. 科研費（JSPS）

- 索引: https://www.jsps.go.jp/j-grantsinaid/27_kdata/kohyo/index.html
- **リンクは `<a href>` ではなく `<td class="hasLink">` の `data-linkurl` 属性**（カンマ区切りで回次ごと）
- 機関別: `3-5_r{N}.xlsx`。R4は `/27_kdata/kohyo/data/r04/01/`、R5以降は `/file/storage/kaken_27_kohyoN-M/` とパスが変遷 → 毎回スクレイプで発見
- **令和5年度版のみ機関番号列が挿入され1列右にシフト** → 「機関名」ヘッダを動的に探す
- **セル値は円**（表示形式 `#,##0,` で千円に見えるだけ）
- 同梱の有用ファイル: `3-2-2`（採択率上位30: 一橋54.3%等）、`4-1-2`（分野別・大区分/中区分）、`3-1-2`（国公私別）、`4-2`（中区分別上位10機関・5年累計）
- `1-1-2_r7.xlsx` は**作業中シート（「★昆修正」「（没）」）が混入** → シート名を明示指定

## 4. 国立研究開発法人 財務諸表（14機関検証済み）

**統合開示は制度的に存在しない**（通則法38条：各法人が個別電子公告）。総務省・e-Gov・財務省・e-Statすべて確認済みで機械可読の横断データ無し。

| 機関 | FY2024財務諸表URL | パターン | 形式・罠 |
|---|---|---|---|
| 理研 | riken.jp/medialibrary/riken/about/info/zaigen/zaimu-2024-1.pdf | `zaimu-{西暦}-{1..5}.pdf` 完全予測可 | テキスト良好。2019-2024検証済 |
| 産総研 | aist.go.jp/pdf/aist_j/zaimu/r6kakutei.pdf | `r{N}kakutei.pdf` 完全予測可（r7=2025有） | テキスト良好。r2は概要のみで財務諸表なし |
| JAXA | jaxa.jp/about/finance/pdf/finance_r06-01.pdf | `finance_r{NN}-01.pdf` 予測可、2003- | 経常費用2,955億vs収益2,453億の乖離は勘定区分の混在疑い→一般勘定で要再確認 |
| JAEA | jaea.go.jp/02/pdf/zaimu_r06-1.pdf | `zaimu_r{YY}-1.pdf` 予測可、2005- | テキスト良好。総資産8,827億 |
| NICT | nict.go.jp/disclosure/finance-statement/r6/1-3.pdf | 年度フォルダ+連番 予測可、2006- | BS=1-1, PL=1-3 と分割 |
| NIES | nies.go.jp/kihon/zaimu/2024/1-3.pdf | `/kihon/zaimu/{年}/1-N.pdf` ほぼ予測可、2001- | 9分割PDF。交付金の親子二重計上に注意（収益化額15,542,524,341 vs 親16,906,310,511） |
| JAMSTEC | jamstec.go.jp …/data/pdf/{YYYY}/sonneki.pdf | 予測可、2003- | **ASCIIが+0x3DFEシフトした壊れフォント** → `chr(ord(c)-0x3DFE)` で修復。束ねPDF(finance_01)は完全に壊れておりNG |
| QST | qst.go.jp/site/about-qst/1316.html 経由 | 添付ID不透明 → 要スクレイプ、2016- | BS/PL別PDF |
| NIMS | nims.go.jp/nims/disclosure/finance.html 経由 | CMSハッシュdir → 要スクレイプ | `R{n}_finance_financial-statements.pdf` |
| KEK | kek.jp/wp-content/uploads/{年月}/R6zaimushohyou.pdf | ファイル名は安定、uploadsパスが不定 → 要スクレイプ、2004- | **国立大学法人会計基準**（千円、行政コスト計算書なし） |
| ROIS | rois.ac.jp/open/pdf02/R06_zaihyo.pdf | `R{YY}_zaihyo.pdf` 完全予測可、2006- | 国立大学法人会計基準（NII/統数研/遺伝研/極地研を含む） |
| NINS | nins.jp/open/assets/{40桁hash}.pdf | 完全不透明 → 要スクレイプ | 国立大学法人会計基準 |
| NIBIOHN | nibn.go.jp（旧nibiohn.go.jpから移転） | `R{n}zaimu_houjin.pdf` ほぼ予測可 | 勘定別に4分割 |
| NCC | ncc.go.jp/jp/about/org/joho/r6_15_zaimu.pdf | `r{N}_{期数}_zaimu.pdf` | 病院型：受託研究収益の独立行なし（業務収益内） |

共通の罠: ①ラベルの文字間スペース → 全空白除去後に照合 ②「経常収益合計」を先に照合（附属明細書に「運営費交付金収益」が多数再出現）③交付金は損益計算書の収益化額と決算報告書の交付額を混ぜない ④FY2019以前は行政サービス実施コスト計算書の時代で非比較 ⑤国立健康危機管理研究機構（旧NCGM+NIID）は2025年4月統合。FY2024 交付金収益の序列: JAXA 1,093億 > JAEA 1,049億 > 産総研 727億 > 理研 540億 > JAMSTEC 341億 > …

## 5. 私立大学セクター

- **私大連「加盟大学財務状況の推移」**: shidairen.or.jp/publications/ からタイトルでスクレイプ（URLは不透明ID）。表5=9年の事業活動収支、表7=1972年〜の長期系列。110法人加盟（**東京理科は非加盟**）。抽出済み → `data/private_sector_series.json`
- **私学事業団 経常費補助金 交付状況**: shigaku.go.jp/s_kouhujoukyou.htm — 全私大835校×23年分（平成15-令和7）。平成29以降PDF（テキスト良好）、以前はHTML表。学校別の唯一の横断機械可読系列。**未接続・次の拡張候補**
- 「今日の私学財政」は有償・認証制で不可。MEXT私学基礎データは**全部PNG画像**で不可。e-Statに私大財務なし

## 6. 国立大学法人

- **NIAD 法人別概要財務諸表**（資料編Ⅰ）: 1つのxlsxに92法人×6年のBS/PL/CF＋約60の財務比率シート。特性別（Ⅱ）・規模別（Ⅲ）・分類別（Ⅳ）の同型ファイルもあり（ピアグループ比較に有用）
- JANU（janu.jp/univ/finance/）は各大学へのリンク集のみ。MEXT決算資料はPDFで下位互換。**科研費等間接経費は独立表示なし**（受託研究等収益・雑益に吸収）

## 7. 主要私立16大学の開示URL（FY2025検証済み）

詳細な取得の罠は [finance-sources.md](finance-sources.md) を参照。抽出値は `data/private_finance_fy2025.json`（独立二重抽出で全値一致確認済み）。

| 法人 | 開示ページ |
|---|---|
| 早稲田大学 | waseda.jp/top/about/work/organizations/financial-affairs/financial-statements |
| 慶應義塾 | keio.ac.jp/ja/about/data/ |
| 上智学院 | sophia-sc.jp/disclosure/operating_plan |
| 立教学院 | rec.rikkyo.ac.jp/disclosure/reports/ |
| 青山学院 | aoyamagakuin.jp/introduction/data/finance/index.html |
| 法政大学 | hosei.ac.jp/hosei/disclosure/hokoku/ |
| 中央大学 | chuo-u.ac.jp/aboutus/overview/biz_overview/financial_results/ |
| 明治大学 | meiji.ac.jp/zaimu/ |
| 関西学院 | ef.kwansei.ac.jp/disclosure/report |
| 立命館 | ritsumeikan-trust.jp/publicinfo/about/finance/ |
| 同志社 | doshisha.ed.jp/finance/ |
| 関西大学 | kansai-u.ac.jp/zaimu/ |
| 津田塾大学 | tsuda.ac.jp/aboutus/disclosure/financial/index.html |
| 日本女子大学 | corp.jwu.ac.jp/about/disclosure/ |
| 国際基督教大学 | icu.ac.jp/about/info/ |
| 東京理科大学 | tus.ac.jp/about/data/project/settlement/ |
