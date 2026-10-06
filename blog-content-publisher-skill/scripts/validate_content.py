#!/usr/bin/env python3
"""Lightweight preflight checks for this Astro blog's content sources."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import subprocess
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


# 用 Astro 自己的解析器读 frontmatter，并把正文渲染成 HTML 后取出真实链接。
# 正文走真实 Markdown 解析而不是正则：代码块里的示例会被转义成文本，
# 不会变成 <a>，因此不需要再去猜围栏、行内代码和引用块的边界。
# 内容按文件路径传入而不是 stdin：`node -e` 要先完成 import 才会读 stdin，
# 而 `readFileSync(0)` 读管道时超过管道缓冲区就全 EAGAIN（实测 ~20KB），
# 那样真实文章永远失败。
ARTICLE_PARSER = """
import { readFileSync } from 'node:fs';
import { createMarkdownProcessor, parseFrontmatter } from '@astrojs/markdown-remark';
try {
  const text = readFileSync(process.argv[1], 'utf8');
  const { frontmatter, content } = parseFrontmatter(text);
  const { code } = await (await createMarkdownProcessor()).render(content ?? '');
  const hrefs = [...code.matchAll(/<a\\s[^>]*?href="([^"]*)"/g)].map((match) => match[1]);
  console.log(JSON.stringify({ frontmatter, hrefs }));
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
"""


def article(path: Path, root: Path) -> tuple[dict[str, object], list[str]]:
    """返回 (frontmatter, 正文里真实链接的 href 列表)。"""
    text = path.read_text(encoding="utf-8")
    if not re.match(r"^---\s*\n(.*?)\n---\s*(?:\n|$)", text, re.DOTALL):
        fail(f"{path}: expected YAML frontmatter fenced by ---")

    try:
        result = subprocess.run(
            ["node", "--input-type=module", "-e", ARTICLE_PARSER, str(path)],
            text=True, capture_output=True, cwd=root,
        )
    except OSError as exc:
        fail(f"{path}: Node.js is required for Astro parsing ({exc})")
    if result.returncode:
        fail(f"{path}: YAML parsing failed (run pnpm install first): {result.stderr.strip()}")

    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        fail(f"{path}: invalid parser output ({exc})")
    if not isinstance(payload, dict):
        fail(f"{path}: parser output must be an object")

    values = payload.get("frontmatter")
    if not isinstance(values, dict):
        fail(f"{path}: YAML frontmatter must be a mapping")

    hrefs = payload.get("hrefs") or []
    return values, [href for href in hrefs if isinstance(href, str)]


def frontmatter(path: Path, root: Path) -> dict[str, object]:
    """只取 frontmatter。保留这个入口给只关心元数据的调用方与测试。"""
    return article(path, root)[0]


def check_body_links(relative_path: str, hrefs: list[str]) -> None:
    """正文里的链接必须是浏览器能直接打开的地址。

    只拦一种写法：指向 `.md`／`.mdx` 文件的相对链接。站点不提供源文件，
    这种链接会被浏览器按当前页面 URL 解析成 `<页面目录>/xxx.md`，点下去是 404，
    而 `pnpm build` 不会报错。跨文章要写站内 URL。

    协议用 urlparse 判断，所以 `HTTPS://…/README.md` 这类外链不受影响，
    `./旧文.md?raw=1` 这种带查询串的写法一样会被拦下。
    目标文章到底在不在站点上，以 `pnpm test:built-markdown` 为准 ——
    那需要知道 slug 生成规则，不在这个预检里重复实现。
    """
    for href in hrefs:
        if href.startswith("//"):
            continue
        parsed = urlparse(href)
        if parsed.scheme:
            continue
        if not parsed.path.endswith((".md", ".mdx")):
            continue
        fail(
            f"{relative_path}: 链接指向 Markdown 源文件：]({href})。"
            "站点不提供 .md 文件，这种链接点下去是 404，且构建不会报错。"
            "跨文章请写站内 URL，例如 /blogs/<分组>/<slug>/#锚点；"
            "若目标文章不在站点上（未发布、已删除或写错），删掉链接保留文字，并向用户说明。"
        )


def validate_blog(root: Path, relative_path: str) -> None:
    path = (root / relative_path).resolve()
    content_root = (root / "src/content/blogs").resolve()
    if not path.is_file() or content_root not in path.parents:
        fail(f"{relative_path}: expected a file under src/content/blogs")
    if path.suffix not in {".md", ".mdx"}:
        fail(f"{relative_path}: expected a .md or .mdx file")

    data, hrefs = article(path, root)
    title = data.get("title")
    if not isinstance(title, str) or not title:
        fail(f"{relative_path}: title is required")
    if len(title) > 60:
        fail(f"{relative_path}: title is {len(title)} characters; maximum is 60")

    pub_date = data.get("pubDate")
    if not isinstance(pub_date, str) or not pub_date:
        fail(f"{relative_path}: pubDate is required")
    try:
        dt.datetime.fromisoformat(pub_date.replace("Z", "+00:00"))
    except ValueError:
        fail(f"{relative_path}: pubDate must be an ISO date or timestamp")

    category = data.get("category")
    if not isinstance(category, str) or not category.strip():
        fail(f"{relative_path}: category is required")

    check_body_links(relative_path, hrefs)

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
