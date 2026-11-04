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


# 用 Astro 自己的解析器读 frontmatter，把正文渲染成 HTML，再用 HTML 解析器取链接。
#
# 两层都是真解析，不靠正则：
# - Markdown 阶段把代码块里的示例转义成文本，所以不用猜围栏、行内代码和引用块；
# - HTML 阶段取真正的 <a> 元素，所以 `data-href` 不会冒充 `href`、注释里的标签不算
#   链接、实体（`&amp;`、`&#x26;`）会被还原成真实字符——正则这三件事全都会做错。
# - 同一个遍历也取 <img> 的相对 .svg 地址：图片指令那一步会把源路径解析成
#   图片节点，所以只要写对了，这里看到的就是真实文件名而不是字符串猜测。
#
# 内容按文件路径传入而不是 stdin：`node -e` 要先完成 import 才会读 stdin，
# 而 `readFileSync(0)` 读管道时超过管道缓冲区就全 EAGAIN（实测 ~20KB），
# 那样真实文章永远失败。
ARTICLE_PARSER = r"""
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createMarkdownProcessor, parseFrontmatter } from '@astrojs/markdown-remark';
import { fromHtml } from 'hast-util-from-html';
import { visit } from 'unist-util-visit';
let stage = 'YAML parsing';
try {
  const text = readFileSync(process.argv[1], 'utf8');
  const { frontmatter, content } = parseFrontmatter(text);
  stage = 'Markdown parsing';
  const { code } = await (await createMarkdownProcessor()).render(content ?? '');
  stage = 'site configuration';
  const { SITE } = await import(pathToFileURL(resolve('src/config.ts')).href);
  const siteBase = new URL(SITE.base.endsWith('/') ? SITE.base : `${SITE.base}/`, SITE.website);
  const pageBase = new URL('__preflight__/entry/', siteBase);
  stage = 'link parsing';
  const invalidLinks = [];
  const svgSources = [];
  visit(fromHtml(code, { fragment: true }), 'element', (node) => {
    if (node.tagName === 'img') {
      const src = node.properties?.src;
      if (typeof src !== 'string') return;
      const value = src.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '').replace(/[\t\r\n]/g, '');
      // 只挑相对路径的 .svg：外链与 public 根路径不归本仓库正文资源管。
      if (/^(?:[a-z][a-z0-9+.-]*:|\/)/i.test(value)) return;
      if (/\.svg(?:[?#].*)?$/i.test(value)) svgSources.push(value);
      return;
    }
    if (node.tagName !== 'a') return;
    const href = node.properties?.href;
    if (typeof href !== 'string') return;
    // 与浏览器一致：去首尾 C0/空格，并删除所有 tab、CR、LF。
    const value = href.replace(/^[\x00-\x20]+|[\x00-\x20]+$/g, '').replace(/[\t\r\n]/g, '');
    try {
      const url = new URL(value, pageBase);
      // URL 决定归属；正则只排除根路径（含反斜杠）及显式 authority 等形式。
      // 同协议的 https:missing.md 仍相对于页面目录，必须继续检查。
      if (url.origin !== pageBase.origin || /^(?:[a-z][a-z0-9+.-]*:)?[\\/]/i.test(value)) return;
      let pathname = url.pathname;
      try { pathname = decodeURIComponent(pathname); } catch { /* URL 允许未转义的百分号；不把它误报为解析失败。 */ }
      if (/\.mdx?$/.test(pathname)) invalidLinks.push(value);
    } catch (error) {
      throw new Error(`链接解析失败：${JSON.stringify(href)} (${error.message})`);
    }
  });
  console.log(JSON.stringify({ frontmatter, invalidLinks, svgSources }));
} catch (error) {
  console.error(`${stage} failed: ${error.message}`);
  process.exitCode = 1;
}
"""


def article(path: Path, root: Path) -> tuple[dict[str, object], list[str], list[str]]:
    """返回 (frontmatter, 指向 Markdown 源文件的相对链接, 正文引用的相对 .svg)。"""
    text = path.read_text(encoding="utf-8")
    if not re.match(r"^---\s*\n(.*?)\n---\s*(?:\n|$)", text, re.DOTALL):
        fail(f"{path}: expected YAML frontmatter fenced by ---")

    try:
        result = subprocess.run(
            ["node", "--experimental-strip-types", "--input-type=module", "-e", ARTICLE_PARSER, str(path)],
            text=True, capture_output=True, cwd=root,
        )
    except OSError as exc:
        fail(f"{path}: Node.js is required for Astro parsing ({exc})")
    if result.returncode:
        fail(f"{path}: {result.stderr.strip()}")

    try:
        payload = json.loads(result.stdout)
    except json.JSONDecodeError as exc:
        fail(f"{path}: invalid parser output ({exc})")
    if not isinstance(payload, dict):
        fail(f"{path}: parser output must be an object")

    values = payload.get("frontmatter")
    if not isinstance(values, dict):
        fail(f"{path}: YAML frontmatter must be a mapping")

    invalid_links = payload.get("invalidLinks") or []
    svg_sources = payload.get("svgSources") or []
    return (
        values,
        [href for href in invalid_links if isinstance(href, str)],
        [src for src in svg_sources if isinstance(src, str)],
    )


def check_body_links(relative_path: str, invalid_links: list[str]) -> None:
    """只呈现 Node 按本站配置和浏览器 URL 语义判定的错误链接。

    目标文章是否存在由产物测试判定；这里不重复实现 slug 或 URL 解析。
    """
    for href in invalid_links:
        fail(
            f"{relative_path}: 链接指向 Markdown 源文件：]({href})。"
            "站点不提供 .md 文件，这种链接点下去是 404，且构建不会报错。"
            "跨文章请写站内 URL，例如 /blogs/<分组>/<slug>/#锚点；"
            "若目标文章不在站点上（未发布、已删除或写错），删掉链接保留文字，并向用户说明。"
        )


SVG_TAG = re.compile(r"<svg\b[^>]*>", re.IGNORECASE)
SVG_PIXEL = re.compile(r"^\d+(?:\.\d+)?(?:px)?$")


def svg_root_tag(path: Path) -> str:
    """跳过 XML 声明、DOCTYPE 和前导注释，只取根 SVG 的开标签。"""
    head = path.read_text(encoding="utf-8", errors="replace")[:4096]
    rest = re.sub(r"^\s*(?:<\?[^>]*\?>)?", "", head)
    while True:
        rest = rest.lstrip()
        if rest.startswith("<!--"):
            end = rest.find("-->")
            if end == -1:
                return ""
            rest = rest[end + 3 :]
            continue
        if re.match(r"<!doctype", rest, re.IGNORECASE):
            end = rest.find(">")
            if end == -1:
                return ""
            rest = rest[end + 1 :]
            continue
        break
    match = SVG_TAG.match(rest)
    return match.group(0) if match else ""


def check_svg_sources(relative_path: str, root: Path, sources: list[str]) -> None:
    """正文引用的相对 .svg 必须在根标签上写像素 width/height。

    只有 viewBox 的 SVG 缺少固有像素尺寸，Astro 生成的 <img> 会把它当成
    300×150 的默认框；灯箱按这个假尺寸显示，图就只有一百多像素宽（仍清晰，
    但小到读不出字）。写 width="100%" 的图同理，在灯箱里也失去固有尺寸。
    """
    base = (root / relative_path).parent
    for src in sources:
        target = (base / src.split("#")[0].split("?")[0]).resolve()
        if not target.is_file():
            continue  # 文件是否存在由构建与产物检查判定。
        tag = svg_root_tag(target)
        if not tag:
            continue
        sizes = [
            re.search(rf"\b{name}\s*=\s*[\"']([^\"']*)[\"']", tag)
            for name in ("width", "height")
        ]
        if all(m and SVG_PIXEL.match(m.group(1).strip()) for m in sizes):
            continue
        box = re.search(r"\bviewBox\s*=\s*[\"']([^\"']*)[\"']", tag)
        parts = box.group(1).split() if box else []
        hint = f'，例如 width="{parts[2]}" height="{parts[3]}"' if len(parts) == 4 else ""
        fail(
            f"{relative_path}: {src} 的根 <svg> 没有像素级的 width/height。"
            "只写 viewBox 或 width=\"100%\" 时这张图没有固有像素尺寸，"
            f"灯箱里会缩成一百多像素宽，字读不出来。请补上{hint}。"
        )


def validate_blog(root: Path, relative_path: str) -> None:
    path = (root / relative_path).resolve()
    content_root = (root / "src/content/blogs").resolve()
    if not path.is_file() or content_root not in path.parents:
        fail(f"{relative_path}: expected a file under src/content/blogs")
    if path.suffix not in {".md", ".mdx"}:
        fail(f"{relative_path}: expected a .md or .mdx file")

    data, invalid_links, svg_sources = article(path, root)
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

    check_body_links(relative_path, invalid_links)
    check_svg_sources(relative_path, root, svg_sources)

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
