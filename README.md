# SCIENCE SIGNAL

日本政府の科学技術政策・予算に関する公式更新を、静的サイトで追うためのサービスです。

このシステムの目的、対象ユーザー、情報の扱い、現在の範囲は [SYSTEM.md](SYSTEM.md) にまとめています。

## 仕組み

1. `scripts/fetch_feeds.py` が、内閣府の公式RSSと、内閣府科学技術・イノベーション推進事務局／科学技術関係予算／文部科学省科学技術・学術の公式ページを取得します。
2. 科学・研究・AI・量子・予算などのキーワードで対象を絞り、タイトル・日時・分類・公式URLと、公式ページ/PDFから抽出した本文を `data/updates.json` に保存します。
   HTML本文とPDFは無料の `pypdf` / 標準ライブラリで抽出し、本文は原文を改変せず読みやすいブロックに分けます。
3. `llama.cpp` と日本語対応の小型GGUFモデルをGitHub Actions上で実行し、新着・本文が変わった記事を1回1件だけ要約します。結果はURLと本文ハッシュをキーに `data/summary_cache.json` へ保存し、モデルが利用できない場合はルールベースの整理へフォールバックします。要約は補助機能であり、本文の取得・公開はモデルの成否に依存しません。
4. `scripts/build_analytics.py` が、更新データから政策領域・文書の役割・テーマ・月別の更新を集計し、e-Statの科学技術研究調査から研究開発費と研究者の移動を取得して `data/analytics.json` に保存します。
5. `scripts/fetch_indicators.py` が、NISTEP 科学技術指標2025（Excel表）、OECD MSTI（SDMX）、OpenAlex（論文集計API）から長期時系列を取得し、`data/indicators.json` に保存します。`ESTAT_APP_ID` を設定すると e-Stat API の国内詳細系列も接続できます。`.github/workflows/refresh-indicators.yml` が週次で更新します。
6. サイトは1ページ構成です。`index.html`（観測室）が、これらのデータを 00 観測室 → 01 40年の競争（論文シェアのスクロール・スクラブ） → 02 博士の曲線 → 03 分野の地形 → 04 資金と人の流れ → 05 最新情報（政府公式更新の全件） の6章で描き、フッターの出典台帳が全データソースの原典と接続状態を示します。Canvas粒子・D3・GSAP ScrollTriggerを使用します。`analytics.html` は旧URL向けのリダイレクトです。
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
