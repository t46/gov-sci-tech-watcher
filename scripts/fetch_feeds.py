#!/usr/bin/env python3
"""Fetch selected Japanese government science-policy feeds into static JSON.

Each item keeps the official URL plus extracted source text for the reader view.
The original page remains the authoritative source and is always linked.
"""

from __future__ import annotations

import argparse
import html
import io
import json
import re
import sys
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin
from urllib.request import Request, urlopen
from xml.etree import ElementTree

from pypdf import PdfReader


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_OUTPUT = ROOT / "data" / "updates.json"

SCIENCE_TERMS = (
    "科学",
    "技術",
    "イノベーション",
    "研究",
    "研究開発",
    "AI",
    "人工知能",
    "量子",
    "半導体",
    "宇宙",
    "バイオ",
    "生命",
    "核融合",
    "ロボット",
    "GX",
    "カーボンニュートラル",
    "大学",
    "研究者",
    "予算",
    "基金",
    "安全保障",
    "スタートアップ",
)

SOURCES = (
    {
        "id": "cao",
        "name": "内閣府",
        "short_name": "CAO",
        "kind": "RSS 1.0",
        "url": "https://www.cao.go.jp/rss/news.rdf",
        "page": "https://www8.cao.go.jp/cstp/stmain.html",
        "description": "科学技術・イノベーション政策の司令塔から、政策・会議・調査の更新を取得",
        "exclude_terms": ("消費者", "食品", "月例経済", "支払手段"),
    },
    {
        "id": "mext-science",
        "name": "文部科学省",
        "short_name": "MEXT",
        "kind": "公式ページ",
        "mode": "mext_html",
        "url": "https://www.mext.go.jp/a_menu/a003.htm",
        "page": "https://www.mext.go.jp/a_menu/a003.htm",
        "description": "科学技術・学術、研究費、大学、研究環境に関する更新を取得",
    },
    {
        "id": "cstp",
        "name": "内閣府 科学技術・イノベーション",
        "short_name": "CSTI",
        "kind": "公式ページ",
        "mode": "html",
        "url": "https://www8.cao.go.jp/cstp/stmain.html",
        "page": "https://www8.cao.go.jp/cstp/stmain.html",
        "description": "科学技術・イノベーション推進事務局の新着情報を取得",
    },
    {
        "id": "cstp-budget",
        "name": "内閣府 科学技術関係予算",
        "short_name": "CSTP BUDGET",
        "kind": "公式ページ",
        "mode": "budget_html",
        "url": "https://www8.cao.go.jp/cstp/budget/index2.html",
        "page": "https://www8.cao.go.jp/cstp/budget/index2.html",
        "description": "政府の科学技術関係予算の年度別資料を取得",
    },
)


def local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1].lower()


def child_text(node: ElementTree.Element, *names: str) -> str:
    wanted = {name.lower() for name in names}
    for child in node.iter():
        if child is node or local_name(child.tag) not in wanted:
            continue
        text = "".join(child.itertext()).strip()
        if text:
            return re.sub(r"\s+", " ", text)
    return ""


def parse_date(value: str) -> str | None:
    value = value.strip()
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        try:
            parsed = parsedate_to_datetime(value)
        except (TypeError, ValueError):
            return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def fetch_xml(url: str) -> bytes:
    request = Request(
        url,
        headers={
            "User-Agent": "gov-sci-tech-watcher/1.0 (+https://github.com/)",
            "Accept": "application/rss+xml, application/rdf+xml, application/xml;q=0.9, */*;q=0.1",
        },
    )
    with urlopen(request, timeout=30) as response:
        return response.read()


def fetch_html(url: str) -> str:
    request = Request(url, headers={"User-Agent": "gov-sci-tech-watcher/1.0 (+https://github.com/)", "Accept": "text/html, application/xhtml+xml;q=0.9, */*;q=0.1"})
    with urlopen(request, timeout=30) as response:
        return response.read().decode(response.headers.get_content_charset() or "utf-8", "replace")


def fetch_binary(url: str) -> bytes:
    request = Request(url, headers={"User-Agent": "gov-sci-tech-watcher/1.0", "Accept": "application/pdf, */*;q=0.1"})
    with urlopen(request, timeout=25) as response:
        return response.read()


class VisibleTextParser(HTMLParser):
    """Keep article-like text while ignoring navigation, scripts and styles."""

    SKIP_TAGS = {"script", "style", "noscript", "svg", "header", "footer", "nav", "form", "aside"}
    BLOCK_TAGS = {"p", "li", "h1", "h2", "h3", "h4", "dt", "dd", "br", "tr"}

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.skip_depth = 0
        self.parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag in self.SKIP_TAGS:
            self.skip_depth += 1
        if not self.skip_depth and tag in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_endtag(self, tag: str) -> None:
        if tag in self.SKIP_TAGS and self.skip_depth:
            self.skip_depth -= 1
        if not self.skip_depth and tag in self.BLOCK_TAGS:
            self.parts.append("\n")

    def handle_data(self, data: str) -> None:
        if not self.skip_depth:
            self.parts.append(data)


def normalize_document_text(value: str) -> str:
    value = html.unescape(value).replace("\u200b", "")
    lines = []
    for line in re.split(r"[\r\n]+", value):
        line = re.sub(r"\s+", " ", line).strip()
        if not line or line in {"現在位置", "トップ", "本文へ", "ページの先頭へ", "メニュー", "サイトマップ", "お問い合わせ"}:
            continue
        lines.append(line)
    return " ".join(lines)


def extract_document_text(url: str) -> str:
    if ".pdf" in url.lower().split("?", 1)[0]:
        reader = PdfReader(io.BytesIO(fetch_binary(url)))
        pages = [(page.extract_text() or "") for page in reader.pages[:12]]
        return normalize_document_text(" ".join(pages))[:32000]
    parser = VisibleTextParser()
    parser.feed(fetch_html(url))
    return normalize_document_text(" ".join(parser.parts))[:32000]


def split_sentences(text: str) -> list[str]:
    return [sentence.strip() for sentence in re.split(r"(?<=[。！？])\s*", text) if len(sentence.strip()) >= 14]


def unique_values(values: list[str], limit: int = 6) -> list[str]:
    result = []
    for value in values:
        value = re.sub(r"\s+", " ", value).strip(" ・")
        if value and value not in result:
            result.append(value)
        if len(result) >= limit:
            break
    return result


def split_body_blocks(text: str, max_chars: int = 520) -> list[str]:
    """Keep extracted source text intact while making it readable on the site."""
    sentences = [sentence.strip() for sentence in re.findall(r".+?(?:[。！？]|$)", text) if sentence.strip()]
    if not sentences:
        return [text[index : index + max_chars] for index in range(0, len(text), max_chars)]

    blocks: list[str] = []
    current = ""
    for sentence in sentences:
        candidate = f"{current}{sentence}" if current else sentence
        if current and len(candidate) > max_chars:
            blocks.append(current)
            current = sentence
        else:
            current = candidate
    if current:
        blocks.append(current)
    return blocks[:80]


def enrich_item(item: dict[str, object], cache: dict[str, str]) -> dict[str, object]:
    url = str(item["url"])
    try:
        text = cache.setdefault(url, extract_document_text(url))
        title = str(item["title"])
        if title in text:
            text = text.rsplit(title, 1)[-1].strip(" :：-–—")
        item["body_text"] = text
        item["body_blocks"] = split_body_blocks(text)
        document_date = japanese_date(text[:180])
        if document_date and item.get("source_id") in {"cstp", "mext-science"}:
            item["published_at"] = document_date
        sentences = split_sentences(text)
        if not sentences:
            raise ValueError("本文から文章を抽出できませんでした")
        keywords = ("予算", "対象", "目的", "事業", "研究", "募集", "開催", "制度", "計画", "概要", "額", "億", "兆", "期限")
        key_points = unique_values([sentence for sentence in sentences if any(keyword in sentence for keyword in keywords)][:5])
        if not key_points:
            key_points = unique_values(sentences[:3])
        money = re.findall(r"(?:約|総額|合計)?\s*[0-9０-９,，.．]+\s*(?:兆|億|万)?\s*円|[0-9０-９.．]+\s*%", text)
        periods = re.findall(r"(?:令和[0-9元]+年(?:度)?|20\d{2}年度|公募期間|募集期間|提出期限|締切)[^。]{0,45}", text)
        item["article_summary"] = "".join(sentences[:2])[:360]
        item["key_points"] = key_points[:3]
        item["highlights"] = unique_values(money + periods)
        item["content_status"] = "extracted"
        item["content_note"] = "公式ページ/PDFから本文を自動整理"
    except Exception as exc:  # One broken document must not stop the whole refresh.
        item["body_text"] = ""
        item["body_blocks"] = []
        item["article_summary"] = "原典の本文を自動取得できませんでした。公式ページで内容をご確認ください。"
        item["key_points"] = []
        item["highlights"] = []
        item["content_status"] = "unavailable"
        item["content_note"] = str(exc)[:120]
    return item


def clean_html(value: str) -> str:
    return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", value))).strip()


def japanese_date(value: str, fallback_year: int | None = None) -> str | None:
    match = re.search(r"(令和|平成)(\d+|元)年\s*(\d+)月(?:\s*(\d+)日)?", value)
    if match:
        era, year, month, day = match.groups()
        base = 2018 if era == "令和" else 1988
        return f"{base + (1 if year == '元' else int(year)):04d}-{int(month):02d}-{int(day or 1):02d}T00:00:00Z"
    match = re.search(r"(20\d{2})年\s*(\d{1,2})月(?:\s*(\d{1,2})日)?", value)
    if match:
        year, month, day = match.groups()
        return f"{int(year):04d}-{int(month):02d}-{int(day or 1):02d}T00:00:00Z"
    return f"{fallback_year:04d}-01-01T00:00:00Z" if fallback_year else None


def classify(title: str, description: str) -> tuple[str, str, str, list[str]]:
    text = f"{title} {description}"
    tags: list[str] = []
    categories = (
        ("予算・投資", ("予算", "概算要求", "補正", "基金", "投資", "財源")),
        ("AI・デジタル", ("AI", "人工知能", "生成AI", "デジタル", "情報通信")),
        ("量子・半導体", ("量子", "半導体", "ポスト5G", "ポスト５G")),
        ("宇宙・安全保障", ("宇宙", "安全保障", "経済安全保障")),
        ("生命・健康", ("生命", "バイオ", "医療", "健康")),
        ("研究基盤・人材", ("大学", "研究者", "人材", "研究環境")),
    )
    category = "科学技術政策"
    for candidate, terms in categories:
        if any(term in text for term in terms):
            category = candidate
            break
    for term in ("政策", "予算", "研究", "公募", "会議", "戦略"):
        if term in text:
            tags.append(term)

    document_rules = (
        ("予算資料", "資金の配分や使い道を示す", ("予算", "概算要求", "補正", "基金", "財源", "交付")),
        ("基本計画", "政策の方向と目標を定める", ("基本計画", "基本方針", "答申素案")),
        ("統計・白書", "現状を数字と調査結果で測る", ("統計", "白書", "指標", "調査結果")),
        ("公募・支援", "研究や事業への参加機会を示す", ("公募", "募集", "採択", "助成", "支援")),
        ("会議・審議", "論点と意思決定の過程を記録する", ("会議", "委員会", "審議会", "開催", "ワーキンググループ")),
        ("評価・検証", "施策の結果と課題を点検する", ("評価", "検証", "結果", "決定", "認定")),
        ("政策・戦略", "政策の選択肢や実施方針を示す", ("戦略", "制度", "方針", "計画")),
    )
    document_type, document_role = "発表・報告", "公式の事実や進捗を伝える"
    for candidate, role, terms in document_rules:
        if any(term in text for term in terms):
            document_type, document_role = candidate, role
            break
    return category, document_type, document_role, tags[:4]


def base_item(source: dict[str, object], title: str, url: str, date: str | None, summary: str = "") -> dict[str, object]:
    category, document_type, document_role, tags = classify(title, summary)
    return {"id": f"{source['id']}:{url}", "title": title, "summary": summary[:280], "url": url, "source": source["name"], "source_id": source["id"], "category": category, "document_type": document_type, "document_role": document_role, "tags": tags, "published_at": date}


def parse_cstp_page(source: dict[str, object]) -> tuple[list[dict[str, object]], dict[str, object]]:
    checked_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        page = fetch_html(str(source["url"]))
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        return [], {"id": source["id"], "name": source["name"], "url": source["url"], "page": source["page"], "kind": source["kind"], "status": "error", "error": str(exc), "checked_at": checked_at}
    pattern = re.compile(r"<dt[^>]*>\s*(.*?)\s*</dt>\s*<dd[^>]*>\s*<a[^>]+href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", re.I | re.S)
    items = []
    for raw_date, raw_url, raw_title in pattern.findall(page):
        title, date = clean_html(raw_title), japanese_date(clean_html(raw_date))
        if not title or not date:
            continue
        absolute_url = urljoin(str(source["url"]), html.unescape(raw_url))
        items.append(base_item(source, title, absolute_url, date, "内閣府 科学技術・イノベーション推進事務局の公式ページで公開された更新"))
    return items, {"id": source["id"], "name": source["name"], "url": source["url"], "page": source["page"], "kind": source["kind"], "status": "ok", "items": len(items), "checked_at": checked_at}


def parse_mext_page(source: dict[str, object]) -> tuple[list[dict[str, object]], dict[str, object]]:
    checked_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        page = fetch_html(str(source["url"]))
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        return [], {"id": source["id"], "name": source["name"], "url": source["url"], "page": source["page"], "kind": source["kind"], "status": "error", "error": str(exc), "checked_at": checked_at}
    pattern = re.compile(r"<a[^>]+href=[\"']([^\"']+)[\"'][^>]*>(.*?)</a>", re.I | re.S)
    items = []
    seen = set()
    info_area = re.search(r'<div id="area_information".*?<!-- area_information END -->', page, re.I | re.S)
    sections = re.findall(r'<div class="info_item[^>]*>.*?<h2 class="info_ttl">(.*?)</h2>.*?<ul class="event_list">(.*?)</ul>', info_area.group(0) if info_area else "", re.I | re.S)
    for raw_heading, event_list in sections:
        heading = clean_html(raw_heading)
        if not any(term in heading for term in ("会見・報道", "政策・審議会")):
            continue
        for raw_url, raw_title in pattern.findall(event_list):
            title = clean_html(raw_title)
            absolute_url = urljoin(str(source["url"]), html.unescape(raw_url))
            if not title or absolute_url in seen:
                continue
            seen.add(absolute_url)
            items.append(base_item(source, title, absolute_url, japanese_date(title), "文部科学省「科学技術・学術」公式ページで公開された更新"))
    return items, {"id": source["id"], "name": source["name"], "url": source["url"], "page": source["page"], "kind": source["kind"], "status": "ok", "items": len(items), "checked_at": checked_at}


def parse_budget_page(source: dict[str, object]) -> tuple[list[dict[str, object]], dict[str, object]]:
    checked_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        page = fetch_html(str(source["url"]))
    except (HTTPError, URLError, TimeoutError, OSError) as exc:
        return [], {"id": source["id"], "name": source["name"], "url": source["url"], "page": source["page"], "kind": source["kind"], "status": "error", "error": str(exc), "checked_at": checked_at}
    current_section = re.search(r"<td[^>]*>\s*令和8年度\s*</td>(.*?)(?=<td[^>]*>\s*令和7年度\s*</td>)", page, re.I | re.S)
    items = []
    if current_section:
        for raw_url, raw_title in re.findall(r"<a[^>]+href=[\"']([^\"']+\.pdf)[\"'][^>]*>(.*?)</a>", current_section.group(1), re.I | re.S):
            title = clean_html(raw_title)
            date = japanese_date(title)
            absolute_url = urljoin(str(source["url"]), html.unescape(raw_url))
            item = base_item(source, title, absolute_url, date, "令和8年度の科学技術関係予算に関する内閣府の公式資料")
            item["category"], item["document_type"], item["document_role"], item["tags"] = "予算・投資", "予算資料", "資金の配分や使い道を示す", ["予算", "令和8年度"]
            items.append(item)
    return items, {"id": source["id"], "name": source["name"], "url": source["url"], "page": source["page"], "kind": source["kind"], "status": "ok", "items": len(items), "checked_at": checked_at}


def parse_feed(source: dict[str, str]) -> tuple[list[dict[str, object]], dict[str, object]]:
    fetched_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    try:
        root = ElementTree.fromstring(fetch_xml(source["url"]))
    except (HTTPError, URLError, TimeoutError, ElementTree.ParseError, OSError) as exc:
        return [], {"id": source["id"], "name": source["name"], "url": source["url"], "page": source["page"], "status": "error", "error": str(exc), "checked_at": fetched_at}

    items = []
    for node in root.iter():
        if local_name(node.tag) != "item":
            continue
        title = child_text(node, "title")
        link = child_text(node, "link")
        date = parse_date(child_text(node, "date", "pubdate", "published", "issued", "updated"))
        description = child_text(node, "description", "summary")
        if not title or not link or not date:
            continue
        searchable = f"{title} {description} {link}"
        if any(term.lower() in searchable.lower() for term in source.get("exclude_terms", ())):
            continue
        if not any(term.lower() in searchable.lower() for term in SCIENCE_TERMS):
            continue
        items.append(base_item(source, title, link.strip(), date, description))

    return items, {"id": source["id"], "name": source["name"], "url": source["url"], "page": source["page"], "status": "ok", "items": len(items), "checked_at": fetched_at}


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    args = parser.parse_args()

    all_items: list[dict[str, object]] = []
    source_statuses: list[dict[str, object]] = []
    for source in SOURCES:
        mode = source.get("mode", "feed")
        if mode == "html":
            items, status = parse_cstp_page(source)
        elif mode == "mext_html":
            items, status = parse_mext_page(source)
        elif mode == "budget_html":
            items, status = parse_budget_page(source)
        else:
            items, status = parse_feed(source)
        all_items.extend(items)
        source_statuses.append(status)
        print(f"{source['name']}: {len(items)} items ({status['status']})")

    unique_items = {item["id"]: item for item in all_items}
    sorted_items = sorted(unique_items.values(), key=lambda item: str(item.get("published_at") or ""), reverse=True)[:120]
    content_cache: dict[str, str] = {}
    for item in sorted_items:
        enrich_item(item, content_cache)
    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    payload = {
        "generated_at": generated_at,
        "item_count": len(sorted_items),
        "sources": source_statuses,
        "items": sorted_items,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {len(sorted_items)} items to {args.output}")
    return 0 if any(status["status"] == "ok" for status in source_statuses) else 1


if __name__ == "__main__":
    sys.exit(main())
