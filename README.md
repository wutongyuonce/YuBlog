# YuBlog

[English](README_ENG.md) · [项目解析](docs/项目解析.md) · [SEO](docs/Canonical%20URL、Sitemap、RSS.md) · [Astro](docs/Astro.md)

[![Astro](https://img.shields.io/badge/Astro-5-ff5a03?logo=astro&logoColor=white)](https://astro.build)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![UnoCSS](https://img.shields.io/badge/UnoCSS-66-656565?logo=unocss&logoColor=white)](https://unocss.dev)
[![Pagefind](https://img.shields.io/badge/Pagefind-search-4b32c3)](https://pagefind.app)
[![License: MIT](https://img.shields.io/badge/license-MIT-green)](LICENSE)

*梧桐雨* 的个人站点：Astro 5 静态生成，黑白主题，文章浏览、标签分类、统一归档、项目展示、个人简介、友链信息。

线上地址：[https://www.wutongyu.site/](https://www.wutongyu.site/)

## 预览

[![YuBlog 页面演示动图](README-img/yublog-promo.gif)](https://github.com/wutongyuonce/YuBlog/blob/main/README-img/yublog-promo-4k.mp4)

GitHub 不支持在 Markdown 里内嵌 `<video>`，所以这里放 8 秒动图。点图或[下载完整 4K 演示（30 秒，55 MB）](https://github.com/wutongyuonce/YuBlog/blob/main/README-img/yublog-promo-4k.mp4)。

### 首页

![image-20260918220616992](README-img/image-20260918220616992.png)

### 标签

![PixPin_2026-09-18_22-07-23](README-img/PixPin_2026-09-18_22-07-23.png)

### 归档

![PixPin_2026-09-18_22-07-59](README-img/PixPin_2026-09-18_22-07-59.png)

### 关于

![PixPin_2026-09-18_22-08-39](README-img/PixPin_2026-09-18_22-08-39.png)

### 友链

![image-20260918220924204](README-img/image-20260918220924204.png)

## 页面

| 路由 | 说明 |
| :--- | :--- |
| `/` | 首页。文章列表（分类、日期、阅读时间、标题、摘要、可选配图），七篇分页。右栏：名片、近期文章、分类。 |
| `/tags/` | 标签页。标签可按数量或名称排序；多选为 AND。未选标签时不显示列表。 |
| `/archives/` | 归档。按年份时间线列出全部文章。 |
| `/projects/` | 项目。按分类网格展示，数据来自 JSON。 |
| `/about/` | 关于。About / Use / Hobby / Soul 四个标签，默认 About。无背景特效。 |
| `/friends/` | 友链。卡片列表 + 申请说明 + `friend.txt` 参考模板。 |
| `/blogs/[slug]/` | 文章详情。点击右侧 TOC 按钮显示目录，再点隐藏。 |
| `/rss.xml` | RSS。 |

顶栏：`WutongRain's Blog`、首页 / 标签 / 归档 / 项目 / 关于 / 友链，右侧只留 GitHub（本仓库）、搜索、主题。当前页加粗。X、Instagram、B 站、小红书和个人 GitHub 在关于页。

首页、标签、归档、项目、关于、友链共用 `BlogIndexLayout` 和右栏。文章详情单独排版。

## 内容

| 路径 | 用途 |
| :--- | :--- |
| `src/content/blogs/**/*.{md,mdx}` | 文章。`title`、`pubDate`、`category` 必填；`category` 为任意非空字符串。封面用 `titleImage: ./_title-images/...`。 |
| `src/content/about/*.md` | 关于页。每个文件按 `title`、`order` 成为一个标签，`about.md` 默认第一项。`tab: false` 的文件不进标签栏。 |
| `src/content/projects/data.json` | 项目卡片。 |
| `src/content/friends/data.json` | 友链卡片。 |
| `src/content/blogs/_title-images/` | 列表与标题块配图（全部文章共用） |
| `src/content/blogs/<名>-img/` | 正文配图，Markdown 写 `./<名>-img/文件.png` |
| `src/content/about/<tab>/` | 关于页各栏配图 |
| `src/config.ts` | 站点信息、导航、顶栏 GitHub、TOC / 搜索开关。个人社交在关于页默认栏。 |

改各页文案和数据，按 `blog-content-publisher-skill/SKILL.md`（按页面分）。架构和 seam 见 `docs/项目解析.md`。

## 技术

- Astro 5 + TypeScript，Markdown / MDX Content Collections
- 内容图片走 Astro 图片管线：相对路径 + `|w` 宽度标记，自动 WebP、`srcset`、宽高与懒加载；`public/` 只放站点级资源
- 文章标题字体构子集：只下载实际用到的字形（7.65 MB → 73 KiB）
- 正文 Inter、代码 DM Mono 使用 `public/fonts/` 里的拉丁子集，不请求 Google Fonts
- KaTeX 样式与字体本地打包（不依赖 CDN），产物只留 woff2
- UnoCSS + `public/shell.css`（导航、右栏、归档、关于标签、分页等壳层样式集中一个属主）
- Pagefind 只索引博客，且仅在打开搜索时加载
- `astro-expressive-code` 代码块
- 明暗主题、ClientRouter 转场
- 背景：`dot` / `rose` / `snow`，按页配置；关于页关闭。点阵按透明度分 6 档描边；大屏间距按约 8000 点放大（边缘补点会略超，不是硬上限），1440×900 仍是 15px。canvas 背景响应 `prefers-reduced-motion`（闸门在 `src/utils/reduced-motion.js`）

## 本地运行

需要 Node.js `18.20.8` / `20.9+` / `22` / `24`，以及 `pnpm@12.6.0`。

```bash
pnpm install
pnpm dev
```

```bash
pnpm check                 # Astro 类型与内容检查
pnpm build                 # 生产构建（含 Pagefind）
pnpm test:built-pagination # 检查构建后的首页分页与无 JS 回退
pnpm preview
pnpm test                  # 运行全部单元测试
pnpm test:blog-browser     # 分页与 URL
pnpm test:blog-sidebar     # 右栏锁定阈值
pnpm test:blog-tags        # 标签 AND 筛选
pnpm test:blog-stats       # 名片统计
pnpm test:recent-post-date # 近期文章日期
pnpm test:progress-stats   # 年积日与进度
pnpm test:cjk-emphasis     # CJK 旁强调语法
pnpm test:toc-active       # 当前章节判定
pnpm test:css-ownership    # 全局样式与组件样式的属主唯一
pnpm test:canvas-size      # canvas 后备存储尺寸与 DPR 上限
pnpm test:reduced-motion   # 减少动效闸门
pnpm lint
pnpm format
```

## 结构

```text
src/
  components/     导航、右栏、列表、归档、关于、友链、TOC
  content/        blogs / about / projects / friends
  layouts/        BaseLayout、BlogIndexLayout、StandardLayout
  pages/          路由
  styles/         正文与 Markdown
  utils/          列表、统计、筛选、路径
public/shell.css  跨页保留的壳层样式
docs/             项目解析（架构）、图片管线指南、Astro 语法、SEO 教程
```

## 个人二次开发

欢迎 fork 之后改成自己的站，可以让 AI 阅读下文和文档进行改造。

1. Fork / clone，改 `src/config.ts` 的 `SITE`（网址、标题、描述、作者、语言）和 `UI`（导航文案、顶栏 GitHub）。个人社交在 `src/content/about/about.md`。
2. 换内容，不要先动布局：
   - 文章：`src/content/blogs/`，正文图 `src/content/blogs/<名>-img/`，标题图 `src/content/blogs/_title-images/`
   - 关于：`src/content/about/`，图 `src/content/about/<栏>/`
   - 项目 / 友链：对应 `data.json`

   内容图片都走 Astro 图片管线（自动 WebP、`srcset`、宽高、懒加载），用相对路径引用，不要再放进 `public/`。正文需要限制宽度时用 alt 后缀 `|w480`。约定见 `docs/Astro图片管线指南.md`。
3. 换头像：`public/avatar.webp`。友链申请模板里的站名和链接在 `FriendsApplyPanel.astro` 的 `friendInfo`，和 `SITE` 不是同一处。
4. 改版式、顶栏、右栏、归档线：先读 `docs/项目解析.md` 的权威表和 seam。壳层 CSS 只改 `public/shell.css`，不要只写在组件 `<style>` 里。
5. 新索引页要带右栏：套 `BlogIndexLayout`，不要复制侧栏。
6. 改完：`pnpm check`，需要时再 `pnpm build`。

字段契约以 `src/content/schema.ts` 为准。

## Skill 怎么用

仓库里是 `blog-content-publisher-skill/SKILL.md`。

- 放到 Agent 的 skills 目录
- 直接说要改哪一页即可，例如：发博客、改 Use、加友链、改顶栏 GitHub、改关于页社交。Agent 应先对表再动文件。
- 它会改 Markdown / JSON / `src/config.ts` 里的站点信息；用户没说发布就保持 `draft: true`；没说部署就不要 push。
- 改结构、CSS、分页算法时不要走这个 skill，用 `docs/项目解析.md`。

MIT
