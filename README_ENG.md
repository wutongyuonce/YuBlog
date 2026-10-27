# YuBlog

[Live site](https://www.wutongyu.site/) · [中文](README.md) · [Documentation](docs/README.md) · [Development and deployment](docs/guides/development.md) · [Changelog](CHANGELOG.md)

[![Astro](https://img.shields.io/badge/Astro-7-ff5a03?logo=astro&logoColor=white)](https://astro.build)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![UnoCSS](https://img.shields.io/badge/UnoCSS-66-656565?logo=unocss&logoColor=white)](https://unocss.dev)
[![Pagefind](https://img.shields.io/badge/Pagefind-search-4b32c3)](https://pagefind.app)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

WutongRain’s personal blog, built with Astro 7, TypeScript and Markdown/MDX. It combines article reading with projects, interests, an author profile and friend links. Pages are generated as static HTML; Last.fm uses a runtime endpoint, and Giscus stores comments in GitHub Discussions.

## Pages

| Page | Route | Purpose |
| --- | --- | --- |
| Home | `/` | Author, socials, writing heatmap, time progress, screen time, five recent posts, recent media and Last.fm seven-day TOP 10 |
| Blog | `/blogs/` | All posts, category/tag filters, eight posts per page and random browsing |
| Tags | `/tags/` | Sortable tags with multi-select AND filtering |
| Archives | `/archives/` | One yearly timeline with category badges and tag links |
| Article | `/blogs/<slug>/` | Content, desktop/mobile TOC, adjacent/random posts and comments |
| Interests | `/interests/`, `/interests/<id>/` | Categories generated from Markdown, including equipment, anime, films, games and books |
| Projects | `/projects/` | Project groups from JSON |
| About | `/about/` | One author-introduction Markdown file |
| Friends | `/friends/` | Recommended/mutual links, exchange template and comments |
| Feed | `/rss.xml` | Full content of all published blog posts |

Blog categories use filtering URLs such as `/blogs/#技术`; interest categories are independent static routes. The album and traffic dashboard in More are external sites. See the [page contracts](docs/design/site.md).

## Features

- Dynamic categories, tag intersections, pagination/history restoration, archives, adjacent posts and random browsing.
- Markdown/MDX, Expressive Code, KaTeX, callouts, blog-link cards, Excalidraw, HTML and audiovisual embeds.
- Astro image optimization, grid/scroll/wrap layouts, image viewing and gallery navigation, horizontal cards with optional ratings/dates, portrait and square rails.
- Light/dark themes, five accent palettes, responsive layouts, ClientRouter navigation and reduced-motion support. Fonts are served locally.
- Pagefind search loaded when opened; full RSS with static, reader-friendly content conversion.
- Writing heatmap, [ActivityWatch screen time](docs/design/screen-time.md), Last.fm, Giscus, Umami and an optional hosted Oneko cat.

See the [custom-style article](src/content/blogs/image-layout-demo.md) for working examples and copyable syntax. Detailed design documents are currently maintained in Chinese.

## Quick start

Use Node.js **22.12+** (recommended: **24**, matching CI) and **pnpm 12.9.1**. The full test suite also requires Python 3.

```bash
pnpm install
pnpm dev --open
```

Use the actual Local URL in the log. For production search and static output:

```bash
pnpm build
pnpm preview
```

dev uses mock search results; preview serves the most recent build and does not provide `/api/lastfm`. The dev server provides the local listening endpoint. Drafts are visible in dev web pages, but remain excluded from RSS and production pages.

See [verification](docs/guides/development.md#verification) for format, lint, tests, type checks, builds and artifact checks, and [deployment](docs/guides/development.md#deployment) for hosting requirements.

## Content

| Content | Location |
| --- | --- |
| Posts and body assets | `src/content/blogs/`; assets next to the article or in a child directory |
| Article covers | `src/content/blogs/_title-images/`, referenced with `titleImage`/`titleImageAlt` |
| Interest categories and assets | `src/content/interests/<id>.md` or `.mdx`, with matching asset directories |
| Home recent media | `src/content/interests/recent.md` |
| Author introduction | `src/content/about/about.md` |
| Projects / friends | `src/content/projects/data.json` / `src/content/friends/data.json` |

Fields are owned by `src/content/schema.ts`. New interest categories need `title`, `description` and `order`; routes and menus follow automatically. Content images use relative source paths and the Astro pipeline.

Follow the [content guide](docs/guides/development.md#content), or install the complete [content-publisher skill package](blog-content-publisher-skill/SKILL.md) in your agent’s skills directory. It manages content and configuration; implementation changes belong in the design workflow.

## Making it yours

| Change | Entry point |
| --- | --- |
| Domain, title, navigation, socials and feature switches | `src/config.ts`: `SITE`, `UI`, `MORE_LINKS`, `AUTHOR_LINKS`, `FEATURES` |
| Brand, author/motto, avatar and footer registration | `NavBar.astro`, `BlogProfile.astro`, `public/avatar.webp`, `Footer.astro` |
| Page composition | `src/pages/`, `src/layouts/`, `src/components/views/` |
| Shared chrome, theme and prose styles | `public/shell.css`, `src/styles/` |
| Markdown and media processing | `plugins/index.ts` and the Remark/Rehype modules |
| Comments, listening, analytics and Oneko | `GISCUS`, `api/lastfm.js`, `Head.astro`, `FEATURES.oneko` |

Replace demo accounts and registration details. Some displayed copy is independent of `SITE`; the [personalization table](docs/guides/development.md#personalization) lists those locations.

Domain, base or slug changes affect permanent URLs, RSS identity and comment associations; review [address migration](docs/design/distribution.md#canonical). Vercel serves static output and the root `api/` function together. Static hosting of `dist/` alone cannot provide the listening API.

## Documentation

Start with [docs/README.md](docs/README.md), organized by task:

| Document | Scope |
| --- | --- |
| [Development and deployment](docs/guides/development.md) | Local modes, configuration, content, services, deployment and verification |
| [Site and pages](docs/design/site.md) | Page contracts, browsing, navigation, themes and comments |
| [Architecture and module boundaries](docs/design/architecture.md) | Data flow, rule ownership, lifecycle and extension points |
| [Content and media](docs/design/content.md) | Images, cards, galleries, HTML/media, drawings and blog links |
| [SEO and full-content RSS](docs/design/distribution.md) | Canonical, sitemap, identity, sanitization and reader output |
| [Last.fm](docs/design/listening.md) / [Oneko](docs/design/oneko.md) | Integration-specific configuration and design |
| [Astro notes](docs/reference/astro.md) | Framework learning material, separate from the current project contract |

Current documents follow the implementation; history lives in [CHANGELOG.md](CHANGELOG.md). Licensed under [MIT](LICENSE); third-party assets retain their respective attribution and licensing requirements.
