"""サイトのアクセス状況を Cloudflare Web Analytics (RUM) から取得して表示する。

Cloudflare Web Analytics は Cookie を使わない計測で、ダッシュボードで有効化すると
Pages のレスポンスにビーコンが自動挿入される（サイト側のコード変更は不要）。
このスクリプトはそこに溜まったデータを GraphQL API から読み出す。

    uv run python scripts/site_traffic.py            # 直近7日
    uv run python scripts/site_traffic.py --days 30  # 直近30日

認証は次の順で解決する:
  1. 環境変数 CLOUDFLARE_API_TOKEN（Account Analytics:Read 権限が必要）
  2. wrangler のログイン情報（~/Library/Preferences/.wrangler/config/default.toml ほか）
アカウントIDは CLOUDFLARE_ACCOUNT_ID があればそれを使い、無ければ wrangler の
設定から解決する。どちらもリポジトリには書かない。

「データがありません」と出る場合、まだ Web Analytics を有効化していない可能性が高い:
ダッシュボード → Web Analytics → Add a site → Pages プロジェクトを選択 → 有効化。
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tomllib
import urllib.error
import urllib.request
from datetime import date, timedelta
from pathlib import Path

GRAPHQL_ENDPOINT = "https://api.cloudflare.com/client/v4/graphql"

WRANGLER_CONFIG_PATHS = (
    Path.home() / "Library/Preferences/.wrangler/config/default.toml",
    Path.home() / ".wrangler/config/default.toml",
    Path.home() / ".config/.wrangler/config/default.toml",
)


def resolve_token() -> str | None:
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if token:
        return token
    for path in WRANGLER_CONFIG_PATHS:
        if not path.exists():
            continue
        try:
            data = tomllib.loads(path.read_text())
        except (OSError, tomllib.TOMLDecodeError):
            continue
        if data.get("oauth_token"):
            return str(data["oauth_token"])
    return None


def resolve_account_id(token: str) -> str | None:
    account = os.environ.get("CLOUDFLARE_ACCOUNT_ID")
    if account:
        return account
    # wrangler の設定にアカウントIDは無いことが多いので、APIから引く（1件だけなら自明）
    request = urllib.request.Request(
        "https://api.cloudflare.com/client/v4/accounts?per_page=50",
        headers={"Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            payload = json.load(response)
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError):
        return None
    accounts = payload.get("result") or []
    if len(accounts) == 1:
        return accounts[0].get("id")
    if len(accounts) > 1:
        print("複数のアカウントが見つかった。CLOUDFLARE_ACCOUNT_ID で指定すること:", file=sys.stderr)
        for item in accounts:
            print(f"  {item.get('id')}  {item.get('name')}", file=sys.stderr)
    return None


def graphql(token: str, query: str, variables: dict[str, object]) -> dict[str, object]:
    body = json.dumps({"query": query, "variables": variables}).encode()
    request = urllib.request.Request(
        GRAPHQL_ENDPOINT,
        data=body,
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    if payload.get("errors"):
        raise SystemExit(f"GraphQL エラー: {payload['errors']}")
    return payload.get("data") or {}


# rumPageloadEventsAdaptiveGroups: 1行=1ページロード（sum.visits は「訪問」= 外部からの着地数）
QUERY = """
query Traffic($account: String!, $since: Date!, $until: Date!) {
  viewer {
    accounts(filter: {accountTag: $account}) {
      daily: rumPageloadEventsAdaptiveGroups(
        limit: 100
        filter: {date_geq: $since, date_leq: $until}
        orderBy: [date_ASC]
      ) {
        count
        sum { visits }
        dimensions { date }
      }
      pages: rumPageloadEventsAdaptiveGroups(
        limit: 15
        filter: {date_geq: $since, date_leq: $until}
        orderBy: [count_DESC]
      ) {
        count
        dimensions { requestPath }
      }
      referrers: rumPageloadEventsAdaptiveGroups(
        limit: 10
        filter: {date_geq: $since, date_leq: $until}
        orderBy: [count_DESC]
      ) {
        count
        dimensions { refererHost }
      }
      countries: rumPageloadEventsAdaptiveGroups(
        limit: 10
        filter: {date_geq: $since, date_leq: $until}
        orderBy: [count_DESC]
      ) {
        count
        dimensions { countryName }
      }
    }
  }
}
"""


def bar(value: int, peak: int, width: int = 24) -> str:
    if peak <= 0:
        return ""
    return "█" * max(1, round(value / peak * width)) if value else ""


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--days", type=int, default=7, help="遡る日数（既定: 7）")
    args = parser.parse_args()

    token = resolve_token()
    if not token:
        print("Cloudflare の認証情報が見つからない。CLOUDFLARE_API_TOKEN を設定するか wrangler login を実行すること。", file=sys.stderr)
        return 1
    account = resolve_account_id(token)
    if not account:
        print("アカウントIDを解決できなかった。CLOUDFLARE_ACCOUNT_ID を設定すること。", file=sys.stderr)
        return 1

    until = date.today()
    since = until - timedelta(days=args.days - 1)
    data = graphql(token, QUERY, {"account": account, "since": since.isoformat(), "until": until.isoformat()})
    accounts = (data.get("viewer") or {}).get("accounts") or []
    if not accounts:
        print("アカウントのデータを取得できなかった。", file=sys.stderr)
        return 1
    result = accounts[0]

    daily = result.get("daily") or []
    total_views = sum(row["count"] for row in daily)
    total_visits = sum((row.get("sum") or {}).get("visits") or 0 for row in daily)

    print(f"SCIENCE SIGNAL アクセス状況  {since.isoformat()} 〜 {until.isoformat()}（{args.days}日間）")
    print("=" * 62)
    if not total_views:
        print("計測データがありません。")
        print("Web Analytics が未設定の可能性: ダッシュボード → Web Analytics → Add a site →")
        print("Pages プロジェクト（science-signal）を選んで有効化すると、以後ここに数値が出る。")
        return 0

    print(f"ページビュー {total_views:,} / 訪問 {total_visits:,}"
          f"（1日あたり平均 {total_views / max(1, len(daily)):.1f} ページビュー）")
    print()
    peak = max(row["count"] for row in daily)
    for row in daily:
        day = row["dimensions"]["date"]
        views = row["count"]
        visits = (row.get("sum") or {}).get("visits") or 0
        print(f"  {day}  {views:5,} PV  {visits:4,} 訪問  {bar(views, peak)}")

    def section(title: str, rows: list[dict[str, object]], key: str, empty: str = "(なし)") -> None:
        print()
        print(title)
        if not rows:
            print(f"  {empty}")
            return
        for row in rows:
            label = (row.get("dimensions") or {}).get(key) or "(直接アクセス)"
            print(f"  {row['count']:5,}  {label}")

    section("よく見られたページ", result.get("pages") or [], "requestPath")
    section("参照元", result.get("referrers") or [], "refererHost")
    section("国・地域", result.get("countries") or [], "countryName")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
