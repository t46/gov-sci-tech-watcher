# 調査: 日本から学術出版社へ流れるお金

2026-08-09 実施。「お金」ページに学術出版（購読料・APC）の章を追加するための事前調査。
4系統（国内購読費 / 国内APC推計 / 世界の先行分析 / データ実現性）を並行調査し、一次ソースをfetchして検証した結果のまとめ。

凡例: ✅ = 一次ソースを直接確認済み / ⚠️ = 二次情報・未確認（実装時に要再確認）

## 0. 結論サマリー

- 日本→学術出版社のお金は **「購読料（実測）」と「APC（推計）」の2本立て** で描ける。両方に機械可読な公開データがある。
- 規模感: 大学図書館の**電子ジャーナル経費 390億円**（2023年度実測・全大学）＋ **APC支払推定額 約154億円**（2024年・定価ベース推計）。ただし転換契約により一部重複するため**単純合算は不可**（注記必須）。
- 日本のAPC総額の「事実上の標準推計」は **JUSTICE「論文公表実態調査」**。政府文書（CSTI・即時OA基本方針）が引用するのは全てこの系列。**出版社別・機関別・助成機関別の集計xlsxが静的URLで公開**されており、そのまま可視化に使える。
- **日本の「実払い額」データは今回の調査範囲では見つからなかった**（OpenAPC不参加、JUSTICE契約状況調査の出版社別データは会員館限定）。公的に確認できたルートは国立大学法人の随意契約公表（例: 新潟大×Elsevier **契約額** 1.11億円/年 ✅。契約額であり決済実績ではない）。ここを掘れば独自データになる。

## 1. 購読料（実測値の柱）

### 文科省「学術情報基盤実態調査」 ✅
- 全国公私立大学の悉皆調査。前身「大学図書館実態調査」が1966年開始、2005年度から現名称。e-Statに平成14(2002)〜令和7(2025)年度分の統計表。
- 主要数値（令和6年度調査 = 2023年度決算）✅ [概要PDF](https://www.mext.go.jp/content/20250325-mxt_jyohoka01-000041092_1.pdf):
  - 図書館資料費 総額 748億円 / **電子ジャーナル経費 390億円**（前年比 +10.2%）
  - 電子ジャーナル経費の時系列（百万円）: 2013 24,596 → 2019 32,495 → 2020 32,565 → 2021 32,856 → 2022 35,438 → 2023 39,039
  - 図書館資料費 国公私立別（2023、百万円）: 国立 23,268 / 公立 4,744 / 私立 46,740
- データ入手: e-Stat [統計表一覧](https://www.e-stat.go.jp/stat-search/files?tstat=000001015878)（toukei=00400601, tstat=000001015878）。
  Excel直リンク形式 `https://www.e-stat.go.jp/stat-search/file-download?statInfId=…&fileKind=0` は安定して機能 ✅。
  例: 令和5年度「6-1 図書館資料費」= statInfId `000040156879`（列: 電子ジャーナル_出版社_国内/国外/計、雑誌_和/洋 等）✅
- **statInfIdは年度ごとに異なる** → 各年度のdatalistスクレイプ or e-Stat API `getStatsList`（要appId・無料）でID解決が必要。
- 粒度: 年次×国公私立。**大学別・出版社別の金額はない**。大学図書館経由の支出のみ（研究費から直接払う分・病院・研究所は対象外）。

### JUSTICE（大学図書館コンソーシアム連合）
- 契約状況調査の公開版はグラフPDFのみで**出版社別支払額は会員館限定** ✅。
- 公開Excel（グラフ用・静的URL）✅: [図書館資料費の推移 1975〜](https://contents.nii.ac.jp/sites/default/files/justice/2026-07/expenditure2026_0.xlsx) / [海外学術雑誌価格の推移](https://contents.nii.ac.jp/sites/default/files/justice/2026-04/JournalPrice_2026_.xlsx) / [為替レート推移](https://contents.nii.ac.jp/sites/default/files/justice/2026-04/ExchangeRate_20260213.xlsx)
- 内閣府CSTI資料（2023-03-02 国大協ヒアリング）✅ [PDF](https://www8.cao.go.jp/cstp/gaiyo/yusikisha/20230302/siryo1-1.pdf): JUSTICE会員館の海外ジャーナル購読支出は**上位3社で50%**（A社26.2% / B社13.0% / C社11.2%、2021年。社名は伏字）。

### 出版社別「契約額」の鉱脈: 随意契約公表 ✅
- 国立大学法人は一定額以上の随意契約を公表する義務があり、ここに出版社との**契約額**が載る（決済実績ではない点に注意）。
  検証例: 新潟大学 契約実績一覧に「ScienceDirect電子ジャーナル利用 / エルゼビア・ビー・ブイ / **契約金額 111,191,041円** / 随意契約」✅
- JETRO政府公共調達データベースで大学×出版社の公示を横断検索可能（金額は公示に無く、各大学の実績一覧PDFに載る）。
- 全国立大分を集めれば出版社別の契約額マップになる（今回の調査範囲では同種の公開集計は見つからなかった）。PDFスクレイピングの工数大。将来の拡張候補。

## 2. APC（推計値の柱）

### JUSTICE「論文公表実態調査」= 標準推計 ✅
- 手法: Clarivate提供WoSデータで「責任著者所属国=Japan」の論文を抽出 → OAフラグで フルOA/ハイブリッド/ブロンズ に分類 → 独自APC価格表（出版社定価＋DOAJ、不明誌は一律€2,000）× 年平均為替。**割引・免除・転換契約は未考慮の定価ベース**（報告書自身が明記）。
- 最新（2025年度報告、2026-03-19公表）✅ [PDF](https://contents.nii.ac.jp/sites/default/files/justice/2026-03/2025_ronbunchosa.pdf) / [xlsx](https://contents.nii.ac.jp/sites/default/files/justice/2026-03/2025_ronbunchosa.xlsx):

  | 出版年 | APC支払推定額（フルOA＋ハイブリッド） |
  |---|---|
  | 2020 | 約64.3億円 |
  | 2021 | 約87.4億円 |
  | 2022 | 約108.4億円 |
  | 2023 | 約129.7億円 |
  | 2024 | **約153.8億円**（フル93.7億＋ハイブリッド60.1億） |

- 2024年 出版社別: **MDPI 23.2億 / Elsevier 22.3億 / Wiley 22.3億 / Springer 16.2億 / NPG 11.3億円**。上位10社で約74%。
- 機関別（2024）: 東大12.9億 / 東北大6.6億 / 阪大6.1億円など。**助成機関別集計**も新設（JSPS関与論文31,120件等）→「科研費由来APC」の規模感を出せる。
- 長期系列: 2012年 約10〜12.5億円 → 2024年 約154億円（10年強で約12倍）。※年度版により同じ出版年の数値が改訂される（WoS再抽出のため）。過年度xlsxは2020/2021/2023/2024/2025年度版が[資料ページ](https://contents.nii.ac.jp/justice/documents)に公開。
- 2024年度版はElsevierハイブリッド過大計上の[注意事項](https://contents.nii.ac.jp/justice/ronbunchosa2024caution)あり ✅。

### 補強エビデンス
- NISTEP 調査資料-354（2026-03、池内・林）✅: 研究者1,279名調査。回答者が過去3年に出版した査読付き論文のうち**66.2%でAPCを支払ってOA化**（論文ベースの割合。回答者ベースではない）。APC支払意思額は平均20.9万円・中央値15万円。論文を公開しない理由1位「APC等の資金がない」54.2%。[リポジトリ](https://nistep.repo.nii.ac.jp/records/2000290)
- NISTEP DP206（2022、西川）✅: APC支払経験者（複数回答）の**86%が財源に「個人で獲得した外部資金（科研費等、分担者含む）」を挙げた**。支出額シェアではないが、APCの主な原資が研究費側にあることを示す最良のエビデンス。[PDF](https://nistep.repo.nii.ac.jp/record/6789/files/NISTEP-DP206-FullJ.pdf)
- 科研費の費目別（論文掲載料）公式集計は**見つからなかった**（費目は4区分で「その他」内訳非公表）✅。
- 「購読料9年で1.3倍、APC9年で5.5倍」の政府引用は内閣府[2023年度オープンサイエンス委託調査報告書](https://www8.cao.go.jp/cstp/r5_os_report.pdf)収載の検討経緯文書にある（即時OA基本方針本文ではない）✅。文科省オープンアクセス加速化事業（83機関採択）は「戦略的APC支援・転換契約APC分」が補助対象 ✅。

## 3. 世界の先行分析（比較の物差し）

- **Larivière, Haustein & Mongeon (2015)** [PLOS ONE](https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0127502) ✅: WoS 4,448万文献(1973–2013)。大手5社（Reed-Elsevier, Springer, Wiley-Blackwell, ACS, T&F）の論文シェアは**自然・医学系（NMS）**で1973年約20% → **2013年53%**。Reed-Elsevier STM部門の利益率 **38.9%**（2013）。
- **Butler et al. (2023)** [QSS / Zenodo受理版](https://zenodo.org/records/8322555) ✅: 大手5社のAPC収入 2015–2018年計 **10.6億ドル**（定価ベース）。[データ公開](https://doi.org/10.5281/zenodo.7086420)。
- **Haustein et al. (2024)** [arXiv:2407.16551](https://arxiv.org/abs/2407.16551) ✅: 6社（Elsevier, Frontiers, MDPI, PLOS, Springer Nature, Wiley）への世界のAPC 2019–2023年計 **83.5億ドル**、2023年単年 **25.4億ドル**（2019年の約3倍）。OpenAlexベースで手法再現可能。APC定価の年次オープンデータセットあり（[arXiv:2406.08356](https://arxiv.org/pdf/2406.08356)）。
- **市場規模** ✅ [STM Global Brief 2021](https://s3.eu-west-2.amazonaws.com/stm.offloadmedia/wp-content/uploads/2024/08/10032918/2021_10_19_STM_Global_Brief_2021_Economics_and_Market_Size-1.pdf): 世界STM市場 約270億ドル/年、うちジャーナル収入 **約100億ドル/年**（2019年 108.1億ドル）。地域粒度はAPACまで（日本単体なし）。
- **出版社決算**: Springer Nature FY2024 Research部門 €14.1億・margin約28% ✅ / RELX STM £30.5億・margin 38.4% ⚠️ / Wiley Research $10.7億・EBITDA margin 32.1% ⚠️。日本単体売上を開示する大手は無し。
- **国レベル可視化の先行例**: 英国FOIプロジェクト（Lawson & Meghreblian、153大学×10出版社の購読料実額、2010–19年で£9.8億、[CC0データ](https://zenodo.org/records/3657776)）✅ / OpenAPC（€6.1億・29万論文・482機関、ODbL、**日本の機関ゼロ** ✅）/ 独DEAL・仏Couperin（Elsevier全国契約 年€33M）⚠️ / ESAC Registryに日本の転換契約は掲載あるが**金額データなし** ✅。日本の機関別・出版社別の支払データを集めた公開プロジェクトは、今回の調査範囲では見つからなかった。

## 4. 独自推計パイプラインの実現性（OpenAlex）

検証済みの事実:
- `https://api.openalex.org/works?filter=authorships.countries:JP,publication_year:2023&group_by=primary_location.source.publisher_lineage` → 198,212件、出版社別集計が返る ✅。ただし publisher_lineage は**親子が別グループで返る**（Springer Nature / Nature Portfolio 等）→ トップレベル正規化が必要。
- OAステータス別（2023 JP）: closed 66,301 / gold 44,860 / diamond 28,764 / green 26,018 / bronze 16,628 / hybrid 15,641 ✅。
- **罠**: `authorships.countries:JP,is_corresponding:true` は「JP著者を含み、かつ誰かが責任著者」の意味になり**日本責任著者にならない** ✅（実レコードで確認）。正しくは (i) 日本の機関IDで `corresponding_institution_ids` をOR指定、または (ii) 全件取得してクライアント側で `is_corresponding × countries` 判定（198k件 ≈ 1,000リクエスト、cursor pagingで可能）。
- APCカバレッジ: gold論文の**約82%に apc_list（定価）**が付く ✅。`apc_paid` はOpenAPC実績→DOAJ定価フォールバックで、**日本はOpenAPC不在のため apc_paid ≒ 定価**（実払いではない）✅。
- 2026年2月からOpenAlex APIは実質キー制（無料キーで約1万クエリ/日）⚠️。大規模処理はCC0のS3スナップショット推奨。
- DOAJ APIでジャーナル別APC定価（複数通貨）が取れる ✅（現在価格のみ・履歴なし。ビルド時Pythonからは200、ブラウザ系プロキシは403）。

方法論的限界（可視化の注記に必須）:
1. 定価≠実払い（割引・免除・転換契約未反映 → 過大方向）
2. 転換契約でAPCが購読側に包含 → 購読柱とAPC柱の**二重計上リスク**（年々拡大）
3. 責任著者判定はメタデータ依存で欠損あり
4. e-Stat側は大学図書館経由のみ / 調査年度と出版年のズレ
5. 通貨換算ルールの固定が必要（APC定価は22通貨混在 ✅）

## 5. 可視化の実装案（次段階）

money.html に新章「学術出版へ流れるお金」を追加する場合の推奨構成:

1. **二本柱の時系列**（最小構成・すぐ作れる）: 電子ジャーナル経費（e-Stat実測 2002–2023）と APC推計（JUSTICE 2012–2024）を並べる。「実測」「定価ベース推計」のラベルを明確に分離。
2. **出版社別APCの内訳**（JUSTICE xlsxそのまま）: MDPI/Elsevier/Wiley/Springer/NPG…の年次推移。世界のAPC市場（Haustein 2024）と比較。
3. **文脈カード**: 大手5社で自然・医学系論文の53%・Elsevier margin 38%・世界ジャーナル市場100億ドル/年・APC支払経験者の86%が財源に外部資金を挙げる、等の確認済みファクト。
4. （将来）OpenAlexによる独自推計で JUSTICE を検証・機関別に展開。
5. （将来・独自データ）国立大随意契約公表のスクレイピングで出版社別**契約額** — 公開集計が見当たらない領域で、報道価値のあるデータ。

データ取得はビルド時Python（`scripts/`）で JUSTICE xlsx + e-Stat Excel をfetch→パース→JSON化。どちらも静的URLで、既存の refresh パイプラインに乗る。
