#!/usr/bin/env python3
"""Lightweight preflight checks for this Astro blog's content sources."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path
from urllib.parse import urlparse


def fail(message: str) -> None:
    print(f"ERROR: {message}", file=sys.stderr)
    raise SystemExit(1)


def is_http_url(value: object) -> bool:
    if not isinstance(value, str):
        return False
    parsed = urlparse(value)
    return parsed.scheme in {"http", "https"} and bool(parsed.netloc)


def frontmatter(path: Path) -> dict[str, object]:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"^---\s*\n(.*?)\n---\s*(?:\n|$)", text, re.DOTALL)
    if not match:
        fail(f"{path}: expected YAML frontmatter fenced by ---")

    values: dict[str, object] = {}
    for line in match.group(1).splitlines():
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        key, separator, value = stripped.partition(":")
        if not separator:
            continue
        values[key.strip()] = value.strip().strip("'\"")
    return values


def validate_blog(root: Path, relative_path: str) -> None:
    path = (root / relative_path).resolve()
    content_root = (root / "src/content/blogs").resolve()
    if not path.is_file() or content_root not in path.parents:
        fail(f"{relative_path}: expected a file under src/content/blogs")
    if path.suffix not in {".md", ".mdx"}:
        fail(f"{relative_path}: expected a .md or .mdx file")

    data = frontmatter(path)
    title = data.get("title")
    if not isinstance(title, str) or not title:
        fail(f"{relative_path}: title is required")
    if len(title) > 60:
        fail(f"{relative_path}: title is {len(title)} characters; maximum is 60")

    pub_date = data.get("pubDate")
    if not isinstance(pub_date, str) or not pub_date:
        fail(f"{relative_path}: pubDate is required")
    try:
        dt.date.fromisoformat(pub_date)
    except ValueError:
        fail(f"{relative_path}: pubDate must use YYYY-MM-DD")

    category = data.get("category")
    if not isinstance(category, str) or not category.strip():
        fail(f"{relative_path}: category is required")

    for key in ("redirect",):
        value = data.get(key)
        if value and not is_http_url(value):
            print(f"WARN: {relative_path}: {key} is not an http(s) URL; Astro will validate a local reference.")

    print(f"OK: blog metadata passed basic checks: {relative_path}")


def validate_friends(root: Path) -> None:
    path = root / "src/content/friends/data.json"
    try:
        entries = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        fail(f"{path}: invalid JSON ({exc})")
    if not isinstance(entries, list):
        fail(f"{path}: expected a JSON array")

    ids: set[str] = set()
    for index, entry in enumerate(entries):
        label = f"friends[{index}]"
        if not isinstance(entry, dict):
            fail(f"{label}: expected an object")
        for key in ("id", "name", "desc", "category"):
            if not isinstance(entry.get(key), str) or not entry[key].strip():
                fail(f"{label}: {key} must be a non-empty string")
        identifier = entry["id"].strip()
        if identifier in ids:
            fail(f"{label}: duplicate id {identifier!r}")
        ids.add(identifier)
        if not is_http_url(entry.get("link")):
            fail(f"{label}: link must be a complete http(s) URL")
        avatar = entry.get("avatar", "")
        if not isinstance(avatar, str):
            fail(f"{label}: avatar must be a string")
        if avatar and not is_http_url(avatar) and not avatar.startswith("/"):
            fail(f"{label}: avatar must be an http(s) URL, a /public path, or an empty string")
        order = entry.get("order", 999)
        if isinstance(order, bool) or not isinstance(order, int):
            fail(f"{label}: order must be an integer")

    print(f"OK: Friends data passed basic checks ({len(entries)} entries)")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", default=".", help="repository root (default: current directory)")
    parser.add_argument("--blog", action="append", default=[], metavar="PATH", help="blog path relative to root; repeat as needed")
    parser.add_argument("--friends", action="store_true", help="validate src/content/friends/data.json")
    args = parser.parse_args()
    if not args.blog and not args.friends:
        parser.error("choose --blog and/or --friends")

    root = Path(args.root).resolve()
    if not (root / "package.json").is_file():
        fail(f"{root}: package.json not found; pass the repository root with --root")
    for blog in args.blog:
        validate_blog(root, blog)
    if args.friends:
        validate_friends(root)


if __name__ == "__main__":
    main()
