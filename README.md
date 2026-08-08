# SCIENCE SIGNAL

日本政府の科学技術政策・予算に関する公式更新を、静的サイトで追うためのサービスです。

このシステムの目的、対象ユーザー、情報の扱い、現在の範囲は [SYSTEM.md](SYSTEM.md) にまとめています。

## 仕組み

1. `scripts/fetch_feeds.py` が、内閣府の公式RSSと、内閣府科学技術・イノベーション推進事務局／科学技術関係予算／文部科学省科学技術・学術の公式ページを取得します。
2. 科学・研究・AI・量子・予算などのキーワードで対象を絞り、タイトル・日時・分類・公式URLと、公式ページ/PDFから抽出した本文を `data/updates.json` に保存します。
   HTML本文とPDFは無料の `pypdf` / 標準ライブラリで抽出し、本文は原文を改変せず読みやすいブロックに分けます。
3. `llama.cpp` と日本語対応の小型GGUFモデルをGitHub Actions上で実行し、新着・本文が変わった記事を1回1件だけ要約します。結果はURLと本文ハッシュをキーに `data/summary_cache.json` へ保存し、モデルが利用できない場合はルールベースの整理へフォールバックします。要約は補助機能であり、本文の取得・公開はモデルの成否に依存しません。
4. `scripts/build_analytics.py` が、更新データから政策領域・文書の役割・テーマ・月別の更新を集計し、e-Statの科学技術研究調査から研究開発費と研究者の移動を取得して `data/analytics.json` に保存します。
5. `scripts/fetch_indicators.py` が、NISTEP 科学技術指標2025（Excel表）、OECD MSTI（SDMX）、OpenAlex（論文集計API）、JSPS科研費データから長期時系列を取得し、`data/indicators.json` に保存します。`ESTAT_APP_ID` を設定すると e-Stat API の国内詳細系列も接続できます。`scripts/fetch_finance.py` は、NIADの国立大学法人財務諸表Excel（91法人×6年）と、国立研究開発法人・大学共同利用機関法人の財務諸表PDF（検証済みレジストリ `data/institute_sources.json` 駆動。フォント破損年はvision抽出値で補完）を取得し、主要私立16大学の抽出済みデータ（`data/private_finance_fy2025.json`、年次更新時に再抽出）と私大連セクター系列を合わせて `data/finance.json` に保存します。`scripts/fetch_publishing.py` は、学術出版へ流れるお金のデータ — JUSTICE「論文公表実態調査」xlsx（APC支払推定額。出版社別・機関別・助成機関別）と大学図書館資料費の長期系列（JUSTICE集計Excel。原典は文科省「学術情報基盤実態調査」）— を取得し、`data/openalex_apc.json`（`scripts/estimate_openalex_apc.py` によるOpenAlex独自推計のローカル一括実行結果）と `data/publisher_contracts.json`（随意契約公表から手動検証で収集した契約額）があれば合流させて `data/publishing.json` に保存します。`.github/workflows/refresh-indicators.yml` が週次で更新します。
6. サイトは4分野構成です。`index.html`（観測室）はヒーローと「4つの観測窓」を持つハブで、`signals.html`（最新情報 — 政策シグナルのフィルタ付きコンソール）、`people.html`（人 — 博士の曲線と研究者の移動）、`money.html`（お金 — 資金の流れと大学・研究機関の財務9章）、`papers.html`（論文 — 40年の競争と分野の地形）に分かれます。共有ヘルパーは `obs-core.js`、ページ別の描画は `hub.js` / `signals.js` / `people.js` / `papers.js` / `money.js`。各ページのフッターの出典台帳がそのページのデータソースの原典と接続状態を示します（ハブは全分野分）。Canvas粒子・D3・GSAP ScrollTriggerを使用します。`analytics.html` は旧URL向けのリダイレクトです。
7. GitHub Actions が3時間おきに取得・要約・統計更新・コミットします。
6. Cloudflare Pages が静的サイトを配信します。`CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` をGitHub ActionsのSecretsに設定すると、更新後にCloudflare Pagesへ自動デプロイします。

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
