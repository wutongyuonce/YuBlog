# YuBlog

[中文](README.md) · [Architecture](docs/项目解析.md) · [SEO](docs/Canonical%20URL、Sitemap、RSS.md) · [Astro](docs/Astro.md)

[![Astro](https://img.shields.io/badge/Astro-5-ff5a03?logo=astro&logoColor=white)](https://astro.build)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![UnoCSS](https://img.shields.io/badge/UnoCSS-66-656565?logo=unocss&logoColor=white)](https://unocss.dev)
[![Pagefind](https://img.shields.io/badge/Pagefind-search-4b32c3)](https://pagefind.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

*WutongRain*’s personal site: Astro 5, static, black-and-white, built around reading posts.

Live: [https://www.wutongyu.site/](https://www.wutongyu.site/)

## Preview

### Home

![image-20260918220616992](README-img/image-20260918220616992.png)

### Tags

![PixPin_2026-09-18_22-07-23](README-img/PixPin_2026-09-18_22-07-23.png)

### Archive

![PixPin_2026-09-18_22-07-59](README-img/PixPin_2026-09-18_22-07-59.png)

### About

![PixPin_2026-09-18_22-08-39](README-img/PixPin_2026-09-18_22-08-39.png)

### Friends

![image-20260918220924204](README-img/image-20260918220924204.png)

## Pages

| Route | What it is |
| :--- | :--- |
| `/` | Home. Post list (category, date, reading time, title, summary, optional image), six per page. Sidebar: profile, recent posts, categories. |
| `/tags/` | Tags. Sort by count or name. Multi-select is AND. No list until a tag is selected. |
| `/archives/` | Archive timeline grouped by year. |
| `/projects/` | Project grid from JSON. |
| `/about/#use` | About. Intro plus Use / Hobby / Soul markdown tabs. No background effect. |
| `/friends/` | Friend links, apply notes, and a `friend.txt` template. |
| `/blogs/[slug]/` | Post. Right TOC; click TOC to pin. |
| `/blogs/` | Legacy index; redirects home and keeps the query string. |
| `/rss.xml` | RSS. |

Nav: `WutongRain's Blog`, Home / Tags / Archive / Projects / About / Friends, then GitHub, X, Instagram, Bilibili, Xiaohongshu, search, theme. The current page is bold.

Home, tags, archive, projects, about, and friends share `BlogIndexLayout` and the sidebar. Post pages use a separate layout.

## Content

| Path | Purpose |
| :--- | :--- |
| `src/content/blogs/**/*.{md,mdx}` | Posts. `title` and `pubDate` required; `category` is `技术向` or `工具向`. Title images use `titleImage: /blog-title-images/...`. |
| `src/content/about/*.md` | About. `intro.md` is the top copy (`tab: false`); other files become tabs via `title` and `order`. |
| `src/content/projects/data.json` | Project cards. |
| `src/content/friends/data.json` | Friend-link cards. |
| `public/blog-title-images/` | List and title-block images |
| `public/blogs/<name>-img/` | In-article images |
| `public/about/<tab>/` | About-tab images |
| `src/config.ts` | Site, nav, socials, TOC / search flags |

Edit page copy and data with `blog-content-publisher-skill/SKILL.md` (one page at a time). Architecture and seams: `docs/项目解析.md`.

## Stack

- Astro 5 + TypeScript, Markdown / MDX Content Collections
- UnoCSS + `public/shell.css` (nav, sidebar, archive, about tabs — survives ClientRouter)
- Pagefind indexes blogs only
- `astro-expressive-code`
- Light / dark theme, ClientRouter
- Backgrounds `dot` / `rose` / `snow` per page; about turns them off

## Run

Node.js `18.20.8` / `20.9+` / `22` / `24`, and `pnpm@12.4.1`.

```bash
pnpm install
pnpm dev
```

```bash
pnpm check                 # Astro type and content checks
pnpm build                 # production build (includes Pagefind)
pnpm preview
pnpm test:blog-browser     # pagination and URLs
pnpm test:blog-tags        # tag AND filtering
pnpm test:blog-stats       # profile stats
pnpm test:recent-post-date # recent-post dates
pnpm test:progress-stats   # day-of-year and progress
pnpm test:cjk-emphasis     # emphasis next to CJK punctuation
pnpm lint
pnpm format
```

## Layout

```text
src/
  components/     nav, sidebar, lists, archive, about, friends, TOC
  content/        blogs / about / projects / friends
  layouts/        BaseLayout, BlogIndexLayout, StandardLayout
  pages/          routes
  styles/         prose and Markdown
  utils/          lists, stats, filters, paths
public/shell.css  chrome styles that persist across pages
docs/             architecture, Astro notes, SEO tutorial
```

## Forking / making it yours

Fork it and turn it into your own site. You can point an AI at this README and the docs.

1. Fork / clone, then edit `SITE` (URL, title, description, author, language) and `UI` (nav labels, social links) in `src/config.ts`.
2. Swap content before touching layout:
   - Posts: `src/content/blogs/`, body images `public/blogs/<name>-img/`, title images `public/blog-title-images/`
   - About: `src/content/about/`, images `public/about/<tab>/`
   - Projects / friends: the matching `data.json`
3. Avatar: `public/avatar.webp`. The friends apply template (`friendInfo` in `FriendsApplyPanel.astro`) is not the same as `SITE`.
4. Chrome (nav, sidebar, archive line): read the authority table and seams in `docs/项目解析.md`. Edit `public/shell.css` only — do not put those rules solely in component `<style>` tags.
5. New index pages that need the sidebar should use `BlogIndexLayout`; do not copy the sidebar.
6. After changes: `pnpm check`, then `pnpm build` if needed.

Field contract: `src/content/schema.ts`.

## Using the content skill

The skill lives at `blog-content-publisher-skill/SKILL.md`.

- Put it in your agent’s skills directory.
- Say which page to change, e.g. new post, edit Use, add a friend link, change nav socials. The agent should match the page table first, then edit files.
- It edits Markdown / JSON / `SITE` and `UI` in `src/config.ts`. Keep `draft: true` unless you asked to publish. Do not push unless you asked to deploy.
- Do not use this skill for structure, CSS, or pagination logic — use `docs/项目解析.md`.

MIT
