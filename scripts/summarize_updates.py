#!/usr/bin/env python3
"""Summarize only new or changed items with an optional local llama.cpp model.

The model is deliberately optional: if llama.cpp or its model is unavailable,
the existing rule-based extraction remains the published fallback.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parents[1]
DEFAULT_INPUT = ROOT / "data" / "updates.json"
DEFAULT_CACHE = ROOT / "data" / "summary_cache.json"
DEFAULT_MODEL = "mmnga/llm-jp-3.1-1.8b-instruct4-gguf:Q4_K_M"


def read_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        return fallback


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def content_hash(item: dict[str, Any]) -> str:
    source = "\n".join((str(item.get("title", "")), str(item.get("body_text", ""))))
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def cache_entry(cache: dict[str, Any], item: dict[str, Any]) -> dict[str, Any]:
    entry = cache.get(str(item.get("url")), {})
    return entry if isinstance(entry, dict) else {}


def clean_text(value: Any, limit: int) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


def parse_json_object(output: str) -> dict[str, Any] | None:
    decoder = json.JSONDecoder()
    for match in re.finditer(r"\{", output):
        try:
            candidate, _ = decoder.raw_decode(output[match.start() :])
        except json.JSONDecodeError:
            continue
        if isinstance(candidate, dict):
            return candidate
    return None


def normalize_result(raw: dict[str, Any] | None) -> dict[str, Any] | None:
    if not isinstance(raw, dict):
        return None
    summary = clean_text(raw.get("summary"), 280)
    impact = clean_text(raw.get("why_it_matters"), 360)
    points = raw.get("points", [])
    if isinstance(points, str):
        points = [points]
    points = [clean_text(point, 180) for point in points if clean_text(point, 180)][:3]
    signals = raw.get("signals", [])
    if isinstance(signals, str):
        signals = [signals]
    signals = [clean_text(signal, 100) for signal in signals if clean_text(signal, 100)][:5]
    if not summary or not points:
        return None
    return {"summary": summary, "points": points, "why_it_matters": impact, "signals": signals}


def build_prompt(item: dict[str, Any]) -> str:
    title = clean_text(item.get("title"), 240)
    body = clean_text(item.get("body_text"), 9000)
    return f"""あなたは、日本の科学技術政策を一般の読者に説明する編集者です。
以下の公式ページ/PDFの本文だけを根拠に、短く正確に整理してください。
本文にない事実、推測、評価、数字は追加しないでください。分からないことは書かないでください。
出力はJSONオブジェクトだけにしてください。Markdown、前置き、コードブロックは禁止です。
キーは summary（120字以内の要約）、points（重要点を3つ以内の配列）、why_it_matters（一般の人にとって何が変わるか。本文から言える範囲で80字以内）、signals（本文に出てくる金額・年度・期限などの短い配列）です。

タイトル:
{title}

本文:
{body}
"""


def run_model(item: dict[str, Any], model_repo: str, timeout: int) -> dict[str, Any] | None:
    command = shutil.which("llama-cli")
    if not command:
        return None

    args = [
        command,
        "--hf-repo",
        model_repo,
        "--ctx-size",
        "8192",
        "--n-predict",
        "280",
        "--temp",
        "0.1",
        "--single-turn",
        "--simple-io",
        "--no-display-prompt",
        "--log-disable",
        "--prompt",
        build_prompt(item),
    ]
    try:
        completed = subprocess.run(
            args,
            capture_output=True,
            text=True,
            encoding="utf-8",
            errors="replace",
            timeout=timeout,
            check=False,
        )
    except subprocess.TimeoutExpired:
        print(f"Local model timed out after {timeout}s; keeping rule-based summaries.", file=sys.stderr)
        return None
    except OSError as exc:
        print(f"Could not execute llama-cli: {exc}", file=sys.stderr)
        return None
    if completed.returncode != 0:
        detail = completed.stderr.strip()[-2000:]
        if detail:
            print(f"llama-cli failed:\n{detail}", file=sys.stderr)
        return None
    parsed = parse_json_object(completed.stdout) if completed.stdout else None
    if parsed is None:
        print("llama-cli returned no readable JSON; keeping rule-based summary.", file=sys.stderr)
        return None
    return normalize_result(parsed)


def apply_result(item: dict[str, Any], result: dict[str, Any], model_repo: str) -> None:
    item["ai_summary"] = result["summary"]
    item["ai_points"] = result["points"]
    item["ai_why_it_matters"] = result["why_it_matters"]
    item["ai_signals"] = result["signals"]
    item["ai_status"] = "generated"
    item["ai_model"] = model_repo


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--cache", type=Path, default=DEFAULT_CACHE)
    parser.add_argument("--model-repo", default=DEFAULT_MODEL)
    parser.add_argument("--max-items", type=int, default=5, help="Maximum new items per refresh")
    parser.add_argument("--timeout", type=int, default=600)
    args = parser.parse_args()

    payload = read_json(args.input, {})
    items = payload.get("items", []) if isinstance(payload, dict) else []
    cache = read_json(args.cache, {})
    if not isinstance(cache, dict):
        cache = {}

    pending = [
        item
        for item in items
        if item.get("body_text")
        and (
            content_hash(item) != cache_entry(cache, item).get("content_hash")
            or cache_entry(cache, item).get("model") != args.model_repo
            or not isinstance(cache_entry(cache, item).get("result"), dict)
        )
    ]
    generated = 0
    for item in pending[: max(args.max_items, 0)]:
        result = run_model(item, args.model_repo, args.timeout)
        if result is None:
            print("Local model was unavailable; keeping rule-based summaries.", file=sys.stderr)
            break
        key = str(item.get("url"))
        digest = content_hash(item)
        cache[key] = {"content_hash": digest, "result": result, "model": args.model_repo}
        apply_result(item, result, args.model_repo)
        generated += 1

    cached_count = 0
    for item in items:
        entry = cache.get(str(item.get("url")), {})
        if (
            isinstance(entry, dict)
            and entry.get("content_hash") == content_hash(item)
            and entry.get("model") == args.model_repo
            and isinstance(entry.get("result"), dict)
        ):
            apply_result(item, entry["result"], str(entry.get("model") or args.model_repo))
            cached_count += 1

    status = "generated" if generated else ("cached" if cached_count else "fallback")
    payload["ai_summary"] = {"status": status, "generated": generated, "cached": cached_count, "model": args.model_repo}
    write_json(args.input, payload)
    write_json(args.cache, cache)
    print(f"AI summaries generated: {generated}; cache entries: {len(cache)}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
