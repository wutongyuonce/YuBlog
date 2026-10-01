# YuBlog

[中文](README.md) · [Changelog](CHANGELOG.md) · [Architecture](docs/项目解析.md) · [SEO](docs/Canonical%20URL、Sitemap、RSS.md) · [Astro](docs/Astro.md)

[![Astro](https://img.shields.io/badge/Astro-7-ff5a03?logo=astro&logoColor=white)](https://astro.build)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![UnoCSS](https://img.shields.io/badge/UnoCSS-66-656565?logo=unocss&logoColor=white)](https://unocss.dev)
[![Pagefind](https://img.shields.io/badge/Pagefind-search-4b32c3)](https://pagefind.app)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

*WutongRain*’s personal site: Astro 7, static, black-and-white, built around article browsing, tag classification, unified archiving, project display, personal profile and friend link information.

## Pages and content

| Route | Purpose | Source |
| :--- | :--- | :--- |
| `/` | Author, RSS, socials and five recent posts; no pager or personal sidebar | `BlogProfile`, `RecentWriting` |
| `/blogs/` | Full list, category/tag filtering, seven posts per page | `src/content/blogs/**/*.{md,mdx}` |
| `/blogs/#tech`, `#thought`, `#diary` | Technology, thoughts and diary; query URLs are also supported | `utils/blog-browser.js` |
| `/tags/` | Sortable tag directory, multi-select AND, results after selection | Post tags |
| `/archives/` | One timeline grouped by year with category badges | Post dates/categories |
| `/interests/`, `/interests/<id>/` | Equipment, anime, films, TV, games, books and Kpop | `src/content/interests/*.md` |
| `/projects/` | Page heading and project groups | Projects JSON |
| `/about/` | Author introduction, no tabs or animated background | `src/content/about/about.md` |
| `/friends/` | Recommended and mutual links, exchange template | Friends JSON |
| `/blogs/<slug>/` | Title, optional cover, content; persistent desktop TOC, mobile control | Post collection |
| `/rss.xml` | Complete article HTML with stable identity and summaries | `src/pages/rss.xml.js` |

The “梧桐雨の博客” brand returns home; navigation text uses the local serif font. Navigation contains manuscripts, tags, archives, interests, projects, about and More, followed by the repository GitHub link, search and theme. Articles select manuscripts; interest subpages select interests. More contains Friends and an external placeholder Album link marked ↗, configured in `MORE_LINKS`. The footer shows the Moe ICP link on desktop and mobile. Home socials use `AUTHOR_LINKS` independently of the About Markdown.

Content and the independently configured desktop navigation are 620px wide. Home author details are centered. The TOC sits 16px outward from the center of the space between the reading column and viewport gutter, at most 208px wide and half a viewport high, with its center 32px above the viewport midpoint and internal scrolling. Tags, interests, projects and about share a serif heading; article titles use bold serif in lists and regular serif in archives; body text and internal Markdown headings use sans-serif. Interests and subpages use the dot background. About has no background; projects use rose.

Covers use `titleImage`/`titleImageAlt` under `src/content/blogs/_title-images/`. Body images belong inside the article directory or a child directory; reference them relatively without traversing upward. Interest images live under `src/content/interests/<id>/`. About content is maintained only in `src/content/about/about.md`.

See the [content skill](blog-content-publisher-skill/SKILL.md), [image pipeline](docs/Astro图片管线指南.md), [site behavior SPEC](docs/站点行为%20SPEC.md), [architecture](docs/项目解析.md) and [full-content RSS SPEC](docs/RSS%20全文支持%20SPEC.md).

## Stack

- Astro 7 + TypeScript, Markdown / MDX Content Collections (using the unified Remark / Rehype plugin pipeline)
- Content images go through Astro's image pipeline: relative paths plus a `|w` width marker, automatic WebP, `srcset`, dimensions and lazy loading; `public/` holds site-level assets only
- Article title font is subset to the glyphs actually used (the glyph set changes with content)
- Body font Inter and code font DM Mono are local Latin subsets in `public/fonts/`, not Google Fonts
- KaTeX CSS and fonts are bundled locally (no CDN) and shipped as woff2 only
- UnoCSS + `public/shell.css` (navigation, layout, home, archive and pagination — one owner for chrome styles)
- Pagefind indexes blogs only, and loads only when search is opened
- `astro-expressive-code`
- Light / dark theme, ClientRouter
- Backgrounds `dot` / `rose` / `snow` per page; about turns them off. The dot field batches strokes into 6 alpha buckets and widens spacing on large screens toward about 8000 points (edge padding can exceed that; it is not a hard cap). 1440×900 stays at 15px. Canvas backgrounds respect `prefers-reduced-motion` (shared gate in `src/utils/reduced-motion.js`)

## Run

Node.js `22.12+` (we recommend `24`, as used in CI), and `pnpm@12.6.0`.

```bash
pnpm install
pnpm dev
```

```bash
pnpm check                 # Astro type and content checks
pnpm build                 # production build (includes Pagefind)
pnpm test:built-pagination # check manuscript pagination and the no-JS fallback
pnpm test:built-restructure # check page structure, menus, friends and article semantics
pnpm test:built-markdown   # check images, reading metadata, and Markdown plugins in the build
pnpm preview
pnpm test                  # all unit tests
pnpm test:blog-browser     # pagination and URLs
pnpm test:blog-tags        # tag AND filtering
pnpm test:blog-stats       # profile stats
pnpm test:recent-post-date # recent-post dates
pnpm test:progress-stats   # day-of-year and progress
pnpm test:cjk-emphasis     # emphasis next to CJK punctuation
pnpm test:toc-active       # current-heading picker
pnpm test:css-ownership    # one owner per global selector
pnpm test:canvas-size      # canvas backing store & DPR cap
pnpm test:reduced-motion   # reduced-motion gate
pnpm lint
pnpm format
```

## Layout

```text
src/
  components/     nav, home, lists, interests, about, friends, TOC
  content/        blogs / about / interests / projects / friends
  layouts/        BaseLayout, BlogIndexLayout, StandardLayout
  pages/          routes
  styles/         prose and Markdown
  utils/          lists, stats, filters, paths
public/shell.css  one owner for chrome styles (nav, layout, home, archives, pagination)
docs/             architecture, Astro notes, SEO tutorial
```

## Making it yours

1. Edit `SITE`, `UI` and `AUTHOR_LINKS` in `src/config.ts`. Brand copy is in `NavBar`; author/motto in `BlogProfile`. Maintain any contact details shown in About separately.
2. Change posts, projects, about, interests and friends with the content skill. The field authority is `src/content/schema.ts`.
3. Replace `public/avatar.webp`. Exchange-template values in `FriendsApplyPanel.friendInfo` are separate from `SITE`.
4. Read the architecture before changing layout. Index pages use `BlogIndexLayout` without a sidebar. Keep one owner per CSS selector.
5. Content images use Astro; site assets stay in `public/`. Build after image changes, and run the required checks before preparing a PR.

## Documentation and changelog

README, specifications and guides describe the current implementation. Record meaningful feature, UI, publishing, dependency and maintenance changes under **Unreleased** in [CHANGELOG.md](CHANGELOG.md). Consolidate related adjustments into their final outcome; assign a version and date only when released.

## Using the content skill

The skill lives at `blog-content-publisher-skill/SKILL.md`.

- Put it in your agent’s skills directory.
- Say which page to change, e.g. new post, edit equipment, add a friend link, change the navbar GitHub link, or edit About socials. The agent should match the page table first, then edit files.
- It edits Markdown / JSON / `SITE` and `UI` in `src/config.ts`. Keep `draft: true` unless you asked to publish. Do not push unless you asked to deploy.
- Do not use this skill for structure, CSS, or pagination logic — use `docs/项目解析.md`.

MIT
