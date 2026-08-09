# SCIENCE SIGNAL

日本政府の科学技術政策・予算に関する公式更新を、静的サイトで追うためのサービスです。

このシステムの目的、対象ユーザー、情報の扱い、現在の範囲は [SYSTEM.md](SYSTEM.md) にまとめています。

## 仕組み

1. `scripts/fetch_feeds.py` が、内閣府の公式RSSと、内閣府科学技術・イノベーション推進事務局／科学技術関係予算／文部科学省科学技術・学術の公式ページを取得します。
2. 科学・研究・AI・量子・予算などのキーワードで対象を絞り、タイトル・日時・分類・公式URLと、公式ページ/PDFから抽出した本文を `data/updates.json` に保存します。
   HTML本文とPDFは無料の `pypdf` / 標準ライブラリで抽出し、本文は原文を改変せず読みやすいブロックに分けます。
3. `llama.cpp` と日本語対応の小型GGUFモデルをGitHub Actions上で実行し、新着・本文が変わった記事を1回1件だけ要約します。結果はURLと本文ハッシュをキーに `data/summary_cache.json` へ保存し、モデルが利用できない場合はルールベースの整理へフォールバックします。要約は補助機能であり、本文の取得・公開はモデルの成否に依存しません。
4. `scripts/build_analytics.py` が、更新データから政策領域・文書の役割・テーマ・月別の更新を集計し、e-Statの科学技術研究調査から研究開発費と研究者の移動を取得して `data/analytics.json` に保存します。
5. `scripts/fetch_indicators.py` が、NISTEP 科学技術指標2025（Excel表）、OECD MSTI（SDMX）、OpenAlex（論文集計API）、JSPS科研費データから長期時系列を取得し、`data/indicators.json` に保存します。`ESTAT_APP_ID` を設定すると e-Stat API の国内詳細系列も接続できます。`scripts/fetch_finance.py` は、NIADの国立大学法人財務諸表Excel（91法人×6年）と、国立研究開発法人・大学共同利用機関法人の財務諸表PDF（検証済みレジストリ `data/institute_sources.json` 駆動。フォント破損年はvision抽出値で補完）を取得し、主要私立16大学の抽出済みデータ（`data/private_finance_fy2025.json`、年次更新時に再抽出）と私大連セクター系列を合わせて `data/finance.json` に保存します。`scripts/fetch_publishing.py` は、学術出版へ流れるお金のデータ — JUSTICE「論文公表実態調査」xlsx（APC支払推定額。出版社別・機関別・助成機関別）と大学図書館資料費の長期系列（JUSTICE集計Excel。原典は文科省「学術情報基盤実態調査」）— を取得し、`data/openalex_apc.json`（`scripts/estimate_openalex_apc.py` によるOpenAlex独自推計のローカル一括実行結果）と `data/publisher_contracts.json`（随意契約公表から手動検証で収集した契約額）があれば合流させて `data/publishing.json` に保存します。`scripts/fetch_topics.py` は、OpenAlexの分野分類（primary_topic.field、26分野）を日本の論文について1980〜2025年の各年で集計し、`data/topics.json`（papers.html「テーマの変遷」章の元データ。論文という成果側のテーマ構成であり、予算配分ではない）に保存するローカル一括実行スクリプトです。`scripts/fetch_funders.py` は、研究助成機関のデータ — NISTEP 科学技術指標2025 表1-3-19（大学等における負担源別研究開発費の実測時系列）、JSPS科研費の機関別配分額xlsx（令和4〜7年度の4年分）、内閣府CSTI「競争的研究費制度一覧（省庁別予算）」PDF（pypdfのlayoutモード抽出でパース）— を取得し、`data/funders.json` に保存します。CSTI PDFは過去年度版が404で消える運用のため年度キーで蓄積し、パース結果は既知の年度について科研費額・全制度合計額の妥当性を検証してから採用します。`scripts/fetch_economy.py` は、サイト共通の経済の物差し — 総務省統計局CPI長期系列（暦年・年度、1970年〜）とWorld Bank年平均為替（USD/JPY）— を `data/economy.json` に保存します（`data/phd_support.json` は学振DC採用状況・生活費支援の検証済み静的スナップショット）。`.github/workflows/refresh-indicators.yml` が週次で更新します。
6. サイトは5分野構成です。`index.html`（観測室）はヒーローと観測窓を持つハブで、`signals.html`（情報 — 政策シグナルのフィルタ付きコンソール）、`policy.html`（政策 — 計画の30年・計画の言葉（第3〜7期本文の用語頻度スペクトル）・戦略の言葉（統合イノベーション戦略2018〜2026の年次用語頻度）・19の指標（サイト実測系列との照合＝計測可能性の監査つき）・重点領域の系譜（第2期8分野→第7期17領域の系譜図）・重点技術17領域の6章）、`people.html`（人材 — 博士の曲線・キャリアの構造・研究者の移動・国際移動（OECD ReICOの年次純流出、世界地図の移動フロー、OECD二国間移動、JSPS海外特別研究員・JD-Pro・NSF SEDのスナップショット、参考として交流統計）・博士の経済の5章）、`money.html`（資金 — 資金の流れに続き、予算の全体像・予算のサイクル・事業の星図・資金の行き先・契約の透明性・省庁の帳簿の政府予算章群、研究助成・財務・学術出版を含む17章）、`papers.html`（研究 — 40年の競争・分野の地形・テーマの変遷）に分かれます。共有ヘルパーは `obs-core.js`、ページ別の描画は `hub.js` / `signals.js` / `policy.js` / `people.js` / `papers.js` / `money.js`（`gov.js` は money.html の政府予算章群を描画）。各ページのフッターの出典台帳がそのページのデータソースの原典と接続状態を示します（ハブは全分野分）。Canvas粒子・D3・GSAP ScrollTriggerを使用します。`analytics.html` と `gov.html` は旧URL向けのリダイレクトです。

   資金ページの政府予算章群のデータは `scripts/fetch_gov.py` が `data/gov.json` に生成します。内閣府CSTI「科学技術関係予算」PDF（当初予算・概算要求・行政事業レビュー対象事業一覧。過去年度版が404で消えるため年度キーで蓄積）、行政事業レビュー見える化サイト（RSシステム）のCSV一括ダウンロード（事業概要・支出先・契約情報。政府標準利用規約）、文部科学省の省庁別財務書類Excel・事業別フルコスト情報を取得し、事業から支出先への資金集約・一者応札率・落札率分布まで事前計算します。CSTI資料の更新が年1〜2回のため、CIには入れず手動で年次実行します（`uv run python scripts/fetch_gov.py`）。

   政策ページのデータは `scripts/fetch_policy.py` が `data/policy.json` に生成します。科学技術・イノベーション基本計画の各期本文PDF（第1〜7期の政府研究開発投資目標、第7期別紙「指標と目標」の19指標、第3〜7期本文の用語出現頻度＝計画の言葉）、統合イノベーション戦略の各年版本文2018〜2026（年次の用語出現頻度＝戦略の言葉。17領域の要約文は2026年版から抽出。なお17領域の初出・一次資料は第7期基本計画本文第3章）をpdftotextで抽出し、目標額・主要指標値の一致検証つきでパースします（実績値は公式一次資料で確認できた第6期の43.6兆円のみ収録）。重点領域の系譜（第2〜7期の重点分野・技術領域の対応関係）は各期本文で検証した手動転記の定数で、名称の直接継承と内容上の対応（編集部の解釈）をフラグで区別しています。基本計画は5年ごと・統合戦略は年1回の更新のため、CIには入れず手動で年次実行します（`uv run python scripts/fetch_policy.py`）。人材ページの国際移動のデータは `scripts/fetch_mobility.py` が `data/mobility.json` に生成します。移動（移籍）系はOECD ReICOの年次流入・流出・帰国（SDMX API、Scopus著者ベース推計）とOECDの二国間研究者移動（同）、JSPS海外特別研究員の帰国後進路・NISTEP博士人材追跡調査（JD-Pro）第3次報告書の国籍別集計・NCSES Survey of Earned Doctorates（いずれも検証済み手動転記スナップショット）。参考の交流統計は文部科学省「国際研究交流の概況」の32年時系列（グラフ画像のみのPDFのため、複数回の独立転記と年度別報告書本文の対前年度比からの逆算で検証した手動転記。全年度で総数＝短期＋中・長期の整合を検証）とe-Stat学校教員統計調査（外国人本務教員）。これも手動で年次実行します（`uv run python scripts/fetch_mobility.py`、概況の新版は毎年7月頃）。世界地図の陸形状は `data/land-110m.json`（world-atlas、Natural Earth由来）を同梱しています。
7. GitHub Actions が3時間おきに取得・要約・統計更新・コミットします。
8. Cloudflare Pages が静的サイトを配信します。`CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` をGitHub ActionsのSecretsに設定すると、更新後にCloudflare Pagesへ自動デプロイします。

本文と要約は、公式ページ/PDFの確認を助けるための表示です。要約はローカルモデルによる補助情報であり、政策判断の根拠にはせず、必ず原典をご確認ください。掲載内容の正確性・掲載期間・利用条件は各公式サイトの案内を優先してください。特にRSSや本文の再利用を提供元が制限している場合があるため、公開運用前に必ず確認してください。

## ローカルで確認

```bash
uv run python scripts/fetch_feeds.py
uv run python scripts/build_analytics.py
uv run python -m http.server 4173
```

ブラウザで <http://127.0.0.1:4173/> を開きます。

## Cloudflare Pagesで公開

`main` ブランチの `.github/workflows/refresh-data.yml` が、データ更新とCloudflare Pagesへのデプロイをまとめて実行します。データ更新だけを確認したい場合は、GitHub Actionsの `workflow_dispatch` から手動実行できます。
