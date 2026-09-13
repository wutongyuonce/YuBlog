# YuBlog

[![Astro](https://img.shields.io/badge/Astro-5-ff5a03?logo=astro&logoColor=white)](https://astro.build)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![UnoCSS](https://img.shields.io/badge/UnoCSS-66-656565?logo=unocss&logoColor=white)](https://unocss.dev)
[![MDX](https://img.shields.io/badge/MDX-ok-1b1f24?logo=mdx&logoColor=white)](https://mdxjs.com)
[![Pagefind](https://img.shields.io/badge/Pagefind-search-4b32c3)](https://pagefind.app)
[![pnpm](https://img.shields.io/badge/pnpm-12.4-f69220?logo=pnpm&logoColor=white)](https://pnpm.io)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

A streamlined Astro 5 personal site inspired by the Antfu-style visual language. This repository focuses on a small, opinionated feature set: homepage, blog, projects, insights, friends, and search, while keeping the codebase easy to extend.

## Home Page

The homepage uses a dedicated `HomeHeader` with a pure-CSS retro desktop illustration. It switches to a vertical layout on narrow screens. Below the subtitle it shows published blog count, word count, and the span from first to latest post; below the introduction it lists the five newest published posts. The navbar shows day-of-year plus annual and daily progress beside the logo. The body presents the profile, stack, GitHub stats, and social links. See [`docs/feature/首页与导航近期功能说明.md`](docs/feature/首页与导航近期功能说明.md) for the source-level notes.

<p align="center">
  <img src="img/image-20260914021124817.png" alt="图片" width="750">
</p>
<p align="center">
  <img src="img/image-20260914021225104.png" alt="图片" width="750">
</p>


## Blogs Page

`/blogs/` aggregates every visible post tag with its post count and supports multi-tag AND filtering. On wide screens the tag panel sits to the left and aligns with the `Blogs` heading; it scrolls away with the document. When the container becomes narrow, it moves between the subtitle and year groups. See [`docs/feature/Blogs标签汇聚与筛选说明.md`](docs/feature/Blogs标签汇聚与筛选说明.md) for the source-level design and implementation notes.

<p align="center">
  <img src="img/PixPin_2026-09-12_22-42-02.png" alt="图片" width="800">
</p>


### blog Page

<p align="center">
  <img src="img/PixPin_2026-09-14_02-10-18.png" alt="图片" width="800">
</p>


## Projects Page

Projects are grouped in a compact responsive grid with small category labels. The project `icon` field is optional, and the current project data is intentionally icon-free.

<p align="center">
  <img src="img/PixPin_2026-09-12_22-44-28.png" alt="图片" width="800">
</p>


## Insights Page

The `/insights/` page is currently cleared into a blank placeholder page. The route is kept so the page can be redesigned and rebuilt later.

## Friends Page

<p align="center">
  <img src="img/image-20260914021618840.png" alt="图片" width="800">
</p>



## Overview

- Framework: Astro 5 + TypeScript
- Styling: UnoCSS + custom CSS
- Content: Markdown / MDX via Astro Content Collections
- Search: Pagefind (blogs only)
- UX: light/dark theme switching with view transitions
- Content extras: article TOC, reading-friendly blog layout, and an optional OG image generation pipeline

## Feature Highlights

- Home page at `/`, with blog statistics and a five-post recent-writing timeline
- Day-of-year, annual progress, and daily progress beside the navbar logo
- Blog index at `/blogs/` and article pages at `/blogs/[slug]/`
- Responsive blog tag counts and multi-tag AND filtering with light/dark themes
- Project showcase page at `/projects/` with compact category grids and optional icons
- Insights page at `/insights/`, currently kept as a blank placeholder route for future redevelopment
- Friends page at `/friends/` with a single card list, a GitHub PR application panel, and light/dark theme support
- Full-text blog search powered by Pagefind
- Right-side article TOC for blog detail pages
- OG image generation remains available, but its global switch is currently disabled
- Four built-in background effects: `plum`, `dot`, `rose`, and `snow`
- Social links and navigation configured from a single config file

## Tech Stack

- `astro` for routing, static generation, and content rendering
- `@astrojs/mdx` for MDX support
- `unocss` for utility-first styling
- `astro-expressive-code` for code block presentation
- `pagefind` for static search indexing
- `sharp` + `satori` for image and OG generation
- `eslint` + `prettier` for code quality and formatting

## Requirements

- Node.js `18.20.8`, `20.9.0+`, `22+`, or `24+`
- `pnpm@12.4.1`

## Quick Start

```bash
pnpm install
pnpm dev
```

Then open the local Astro dev server shown in the terminal.

## Available Commands

```bash
pnpm dev          # start local development server
pnpm check        # run Astro type/content checks
pnpm build        # create production build
pnpm preview      # preview the production build locally
pnpm test:blog-tags        # verify blog tag aggregation and AND matching
pnpm test:blog-stats       # verify home blog word counts, date span, and formatting
pnpm test:recent-post-date # verify recent-writing relative and absolute dates
pnpm test:progress-stats   # verify navbar day-of-year and progress percentages
pnpm test:cjk-emphasis     # verify Markdown emphasis next to CJK punctuation
pnpm lint         # run ESLint
pnpm lint:fix     # fix lint issues where possible
pnpm format       # check formatting with Prettier
pnpm format:write # format files with Prettier
```

## Routes

| Route | Purpose |
| :--- | :--- |
| `/` | Homepage with a custom header, blog stats, retro desktop, profile content, and recent writing |
| `/blogs/` | Blog index with tag aggregation, counts, and multi-tag AND filtering |
| `/blogs/[slug]/` | Blog post detail page |
| `/projects/` | Compact categorized project grid with optional icons |
| `/insights/` | Insights page: currently a blank placeholder route with only the base page shell |
| `/friends/` | Friends page: single card list, GitHub PR application, reference format, and page-level `cd ..` alignment |
| `/search/` | Search page powered by Pagefind |

## Content And Customization

| File | Purpose |
| :--- | :--- |
| `src/content/home/index.md` | Homepage body content |
| `src/content/blogs/**/*.{md,mdx}` | Blog posts rendered at `/blogs/` |
| `src/content/projects/data.json` | Project card data |
| `src/content/insights/**/*.{md,mdx}` | Insight content source files, not rendered on the page right now |
| `src/content/friends/data.json` | Friends card data |
| `src/content/schema.ts` | Collection schemas (page, post, project, insight, friend) |
| `src/config.ts` | Site metadata, nav items, social links, and feature switches |
| `astro.config.ts` | Astro integrations, Markdown pipeline, image config, and build settings |

### Main Config Entry Points

- `SITE` in `src/config.ts`: website URL, title, description, locale, image domains
- `UI` in `src/config.ts`: internal navs, social links, navbar layout, post/group display rules
- `FEATURES` in `src/config.ts`: TOC, search, slide animation, OG image defaults

## Project Structure

```text
src/
  components/
    backgrounds/  # Background, Dot, Plum, Rose, Snow
    base/         # Head, Link, Footer, Backdrop, PostMeta, Divider
    home/         # HomeHeader, TinyDesktop, RecentWriting
    nav/          # NavBar, NavItem, NavSwitch
    toc/          # Toc, TocSidebar, TocItem
    views/        # page composition; ListView and TagFilter power the blog index filtering
    widgets/      # LogoButton, ProgressStats, SearchSwitch, ThemeSwitch, BackLink
  content/
    blogs/        # Blog posts (Markdown / MDX)
    home/         # Homepage content
    projects/     # Project data (JSON)
    insights/     # Insight content source files organized by year (currently not rendered)
    friends/      # Friends data (JSON)
    schema.ts     # Shared Zod schemas for all content collections
  layouts/        # BaseLayout, StandardLayout
  pages/          # Route definitions
  styles/         # main.css, prose.css, markdown.css
  utils/          # path, datetime, data, blog tag filtering, blog stats, recent dates, progress stats, misc, and TOC helpers
test/             # Node built-in tests covering blog tags, home stats, recent dates, progress stats, and CJK emphasis
plugins/          # remark/rehype plugins, OG helpers
public/           # Static assets such as favicon, fonts, and generated images
docs/             # Project documentation and customization guides
```

## Architecture Notes

**Content flow**

```text
src/content/*                -> raw Markdown / MDX / JSON content
src/content.config.ts        -> schema validation and parsing
astro.config.ts + plugins/*  -> Markdown / MDX processing
src/pages/*                  -> route generation
src/layouts/*                -> page shell
src/components/views/*       -> page-level composition
src/components/* + styles/*  -> final UI output
```

**Cross-cutting files**

- `src/config.ts` centralizes site, UI, and feature configuration
- `src/types.ts` defines shared TypeScript types for config and features (including `BgType`)

## Documentation

Project-specific documentation is kept in `docs/`:

- `docs/项目解析.md` - Full project architecture and data flow analysis
- `docs/feature/首页与导航近期功能说明.md` - Home blog statistics, recent writing, and navbar progress
- `docs/feature/Blogs标签汇聚与筛选说明.md` - Blog tag data, AND filtering, responsive layout, and maintenance notes
- `docs/feature/Insights模块更新说明.md` - Current Insights module status, wiring, and restoration notes
- `docs/feature/友链模块说明.md` - Friends module structure, data flow, and maintenance guide
- `docs/feature/文章TOC与响应式导航说明.md` - TOC behavior and responsive navigation details
- `blog-content-publisher-skill/SKILL.md` - Blog content, frontmatter, title images, and publishing validation

## Positioning

This repository is a trimmed variant of the original `astro-antfustyle-theme`. It removes less relevant modules and keeps a smaller, easier-to-maintain surface area.

Removed or excluded parts:

- Extra pages such as photos, shorts, changelog, feeds, streams, releases, and pull requests
- Unused integrations such as GitHub activity, RSS, Bluesky, and comments
- Upstream boilerplate metadata and demo-oriented assets

Retained core experience:

- Home, blog, blog detail, projects, insights, friends, and search
- Config-driven social links and navbar layout
- Blog-only search via Pagefind
- Article TOC on post pages
- Theme switching with view transitions
- Optional OG image generation pipeline (currently disabled globally)
- Multiple background effects (`plum`, `dot`, `rose`, `snow`)

MIT
