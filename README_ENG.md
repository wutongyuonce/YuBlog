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
| `/` | Author, RSS, socials, writing heatmap, five recent posts and recent media; no pager or personal sidebar | `BlogProfile`, `WritingHeatmap`, `RecentWriting`, `recent.md` |
| `/blogs/` | Full list, category/tag filtering, seven posts per page | `src/content/blogs/**/*.{md,mdx}` |
| `/blogs/#tech`, `#thought`, `#diary` | Built-in groups and discovered categories such as `#旅行`; legacy query URLs still work | `utils/blog-browser.js` |
| `/tags/` | Sortable tag directory, multi-select AND, results after selection | Post tags |
| `/archives/` | One timeline grouped by year with category badges | Post dates/categories |
| `/interests/`, `/interests/<id>/` | Interest index and content-driven category pages | `src/content/interests/*.{md,mdx}` (excluding `intro.md` and `recent.md`) |
| `/projects/` | Page heading and project groups | Projects JSON |
| `/about/` | Author introduction, no tabs or animated background | `src/content/about/about.md` |
| `/friends/` | Recommended and mutual links, exchange template | Friends JSON |
| `/blogs/<slug>/` | Title, optional cover, content; persistent desktop TOC, mobile control | Post collection |
| `/rss.xml` | Complete article HTML with stable identity and summaries | `src/pages/rss.xml.js` |

Publishing a post with a new `category` and rebuilding automatically adds its menu entry, count and up to four recent previews. New categories use name fragments such as `/blogs/#旅行` (URL-encoded) and stable light/dark archive badge colors. Legacy `?category=` links remain supported and normalize to equivalent fragment URLs when JavaScript is enabled. RSS continues to include all published blog posts. Blog filtering requires JavaScript; interest routes such as `/interests/movie/` are independent content pages.

To add an interest category, place `<id>.md` (or `.mdx`) directly in `src/content/interests/` with a non-empty `title` and `description` and a non-negative integer `order`. Rebuilding automatically creates `/interests/<id>/` and adds the category to the index and navbar dropdown, sorted by `order`. Categories are not limited to the current equipment, anime, films, TV, games, books and Kpop; no route or navigation-array edits are needed. Icons are optional: configure `INTEREST_ICONS` in `src/config.ts` using the filename without its extension as the key. Unconfigured entries show text only, with no icon placeholder. Interests have no `draft` switch and are published in the next build. `intro.md` and `recent.md` are not categories.

The “梧桐雨の博客” brand returns home; navigation text uses the local serif font. Navigation contains manuscripts, tags, archives, interests, projects, about and More, followed by the repository GitHub link, search and theme. Articles select manuscripts; interest subpages select interests. More contains Friends and the external Album link at `https://photos.wutongyu.site/` marked ↗, configured in `MORE_LINKS`. The footer uses the local serif font. The author name links home, and the Moe ICP link remains visible on desktop and mobile. Page views are collected by one Umami Cloud script in `Head.astro`; the page shows no counter or badge. Home socials use `AUTHOR_LINKS` independently of the About Markdown.

Content targets 660px. Navigation uses the same width variable and responsive constraints. Home author details are centered. The writing-heatmap title aligns left with recent posts, and the year switch sits on that title's right. The TOC sits 16px outward from the center of the space between the reading column and viewport gutter, at most 208px wide and half a viewport high, with its center 32px above the viewport midpoint and internal scrolling. Tags, interests, projects and about share a serif heading; article titles use bold serif in lists and regular serif in archives; body text and internal Markdown headings use sans-serif. Interests and subpages use the dot background. About has no background; projects use rose.

Covers use `titleImage`/`titleImageAlt` under `src/content/blogs/_title-images/`. Body images belong inside the article directory or a child directory; reference them relatively without traversing upward. Interest images live under `src/content/interests/<id>/`. The interests index note lives in `intro.md`; home media lives in `recent.md`. Neither creates a subpage or menu item. Both use the shared Markdown pipeline and `prose.css`. Consecutive `:::card` entries form responsive grids (up to two columns at the current shell width); headings separate groups and share `.markdown-content` typography. Author scores are optional regardless of watching/playing status; omitted scores are not invented. About content is maintained only in `src/content/about/about.md`.

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

Node.js `22.12+` (we recommend `24`, as used in CI), and `pnpm@12.9.1`.

```bash
pnpm install
pnpm dev
```

```bash
pnpm check                 # Astro type and content checks
pnpm build                 # production build (includes Pagefind)
pnpm test:built-pagination # check manuscript pagination and the no-JS fallback
pnpm test:built-restructure # check page structure, menus, friends and article semantics
pnpm test:built-markdown   # check built images, headings, cards and complete RSS content
pnpm preview
pnpm test                  # all unit tests
pnpm test:blog-browser     # pagination and URLs
pnpm test:blog-tags        # tag AND filtering
pnpm test:blog-stats       # readable word counts and formatting
node --test test/blog-heatmap.test.mjs # Shanghai calendar and yearly totals
node --test test/remark-media-card.test.mjs # Markdown cards
pnpm test:recent-post-date # recent-post dates
pnpm test:progress-stats   # day-of-year and progress
pnpm test:cjk-emphasis     # emphasis next to CJK punctuation
pnpm test:toc-active       # current-heading picker
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
4. Read the architecture before changing layout. Index pages use `BlogIndexLayout` without a sidebar. Keep shared styles centralized; check scope and cascade when applying component overrides.
5. Content images use Astro; site assets stay in `public/`. Build after image changes, and run the required checks before preparing a PR.

## Documentation and changelog

README, specifications and guides describe the current implementation. Record meaningful webpage structure, interaction and code changes under **Unreleased** in [CHANGELOG.md](CHANGELOG.md). Do not record content-data edits such as posts, about, interests, projects or friend links. Consolidate related adjustments into their final outcome; assign a version and date only when released.

## Using the content skill

The skill lives at `blog-content-publisher-skill/SKILL.md`.

- Put it in your agent’s skills directory.
- Say which page to change, e.g. new post, edit equipment, add an interest category, add a category icon, add a friend link, change the navbar GitHub link, or edit About socials. The agent should match the page table first, then edit files.
- It edits Markdown / JSON / site configuration in `src/config.ts`. New blog posts keep `draft: true` unless you asked to publish; this does not apply to interests. Do not commit, push or deploy without explicit authorization.
- Do not use this skill for structure, CSS, or pagination logic — use `docs/项目解析.md`.

MIT
