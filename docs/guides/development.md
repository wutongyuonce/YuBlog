# 开发与部署指南

从这里完成本地运行、个性化配置、内容维护与部署。页面规则见 [站点与页面](../design/site.md)，改代码前先查 [架构与模块边界](../design/architecture.md#ownership)。本文中的源码路径均相对仓库根目录。

[本地运行](#local) · [个性化](#personalization) · [内容维护](#content) · [外部服务](#services) · [部署](#deployment) · [检查与验收](#verification)

<a id="local"></a>

## 本地运行

需要 Node.js 22.12 或更高版本，推荐与 CI 一致的 Node.js 24；包管理器为 `package.json` 声明的 pnpm 12.9.1。完整测试还需要 Python 3，发布预检会通过它调用已安装的 Astro 解析器。

```bash
pnpm install
pnpm dev --open
```

以终端日志中的实际 `Local` 地址为准，端口被占用时 Astro 会选其它端口。复用服务前核对进程的工作目录属于当前仓库／worktree，例如 `lsof -a -p <pid> -d cwd`。

| 模式 | 能验证什么 | 边界 |
| --- | --- | --- |
| `pnpm dev` | 内容与组件热更新、草稿网页、本地 `/api/lastfm` | 搜索使用模拟数据；RSS 仍排除草稿 |
| `pnpm build` | 生产页面、图片资源、字体子集、Pagefind 索引及正文检查 | 不查询 Last.fm，不启动网站服务 |
| `pnpm preview` | 最近一次 `dist/` 的静态页面与真实搜索 | 不提供 `/api/lastfm`；不反映构建后的源码修改 |

Markdown 插件修改后若 dev 仍输出旧结构，用 `pnpm dev --force` 清内容缓存；普通刷新不会重新编译缓存的 Markdown。生产构建命令已带 `--force`。

<a id="personalization"></a>

## 个性化配置

先替换身份、内容和外部服务，再调整布局。不要把演示站的账号当成自己的配置。

| 要改什么 | 入口 | 注意事项 |
| --- | --- | --- |
| 站名、域名、语言、默认分享图与部署 base | `src/config.ts` → `SITE` | 换域名／base／文章 slug 会影响永久地址、RSS 身份与评论关联，见 [SEO 与订阅](../design/distribution.md#canonical) |
| 顶栏入口、仓库 GitHub 与工具顺序 | `src/config.ts` → `UI` | 顶栏 GitHub 是仓库地址；个人主页属于 `AUTHOR_LINKS` |
| 更多菜单中的友链、相册、访问统计 | `src/config.ts` → `MORE_LINKS` | 相册和统计看板是外部站点，不由本项目生成 |
| 首页社交入口 | `src/config.ts` → `AUTHOR_LINKS` | 关于正文里的联系方式独立维护 |
| 首页名字、INTJ、名言 | `src/components/blog/BlogProfile.astro` | 品牌文案在 `src/components/nav/NavBar.astro`，不随 `SITE.title` 自动同步 |
| 头像、图标、默认 OG 图 | `public/avatar.webp`、`public/` 及 `SITE.socialImage` | 正文配图放 `src/content/`，不放这里 |
| 关于介绍 | `src/content/about/about.md` | 只有一个正文入口，不自动生成页签 |
| 友链申请模板 | `src/components/views/FriendsApplyPanel.astro` → `friendInfo` | 与 `SITE` 独立，需同步替换模板中的个人信息 |
| 页脚署名、备案 | `src/components/base/Footer.astro` | 替换演示站备案，或按自己的站点情况移除 |
| TOC、搜索、Oneko 开关 | `src/config.ts` → `FEATURES` | Oneko 皮肤与访客隐藏见 [像素猫设计](../design/oneko.md) |
| 拾趣菜单图标 | `src/config.ts` → `INTEREST_ICONS` | 键为分类文件名，不含扩展名；未配即纯文字菜单 |
| 点缀配色预设 | `src/utils/accent-palette.js` | 亮暗主题与点缀独立，预设首项为默认 |

样式职责保持清晰：跨页壳层与共享字体声明在 `public/shell.css`，全局变量与目录样式在 `src/styles/main.css`，正文组件在 `prose.css`，Markdown 基础排版在 `markdown.css`；四份公共源码由 `Head.astro` 统一输出为跨页固定的 `site-styles`，其中三份 `src/styles/` CSS 通过 `?inline` 使用 Vite 处理，不可改为 `?raw`。局部组件样式仍由组件拥有并按页打包。字体、首屏内联和 ClientRouter 生命周期见 [架构设计](../design/architecture.md#boundaries)。

<a id="content"></a>

## 内容维护

完整字段以 `src/content/schema.ts` 为准，集合扫描范围以 `src/content.config.ts` 为准。

| 内容 | 维护位置 | 发布方式 |
| --- | --- | --- |
| 博客 | `src/content/blogs/**/*.{md,mdx}` | 生产排除 `draft: true`；文件路径／slug 决定地址 |
| 文章封面 | `src/content/blogs/_title-images/`，用 `titleImage`、`titleImageAlt` 引用 | 配置封面时必须有 alt |
| 正文图片、音视频、绘图源 | 文章同目录或子目录 | Markdown 使用相对路径；处理方式见 [正文与媒体](../design/content.md) |
| 项目 | `src/content/projects/data.json` | 按原始 `category` 分组 |
| 友链 | `src/content/friends/data.json` | `category` 为推荐或双向，组内按 `order`／名称排序 |
| 拾趣分类 | `src/content/interests/<id>.md` 或 `.mdx` | 顶层文件自动生成子页、入口和菜单；无草稿开关 |
| 首页近期书影游 | `src/content/interests/recent.md` | 不生成分类子页，使用竖卡 |

新博客的最小起点：

```md
---
title: 我的第一篇文章
pubDate: 2026-10-21
category: 技术
tags: [Astro]
draft: true
---

## 从这里开始

正文。
```

示例日期需替换为实际发布日期。博客 `category` 是必填的非空原值，新分类随已发布内容自动进入菜单。归档会为新分类领取配色并更新 `src/data/blog-category-colors.json`，把记录与文章一起提交；已有分类的颜色不重排，删除后仍保留占位，预设用尽需扩充 `palette`。

新增拾趣分类只需在顶层放文件并填写非空 `title`、`description` 和非负整数 `order`，不改路由或导航数组。`recent.md` 排除出分类集合，配图子目录也不生成分类。

作者操作与 AI 内容维护使用仓库内可独立安装的 [内容发布 skill](../../blog-content-publisher-skill/SKILL.md)。将整个 `blog-content-publisher-skill/` 复制到 Agent 的 skills 目录，保留 `SKILL.md`、脚本等依赖；可以直接提出“发博客”“新增拾趣分类”“换封面”“加友链”。skill 负责内容与配置，新博客在未明确发布时保留草稿；提交、推送和部署需有用户授权。

公式写 `$…$` 或独立行 `$$`，不使用 `\(...\)`／`\[...\]`。复杂排版、卡片日期和媒体参数见 [正文与媒体](../design/content.md)，可运行示例及完整可复制语法见 [正文样式指南文章](../../src/content/blogs/image-layout-demo.md)。

<a id="services"></a>

## 外部服务

### Last.fm

首页排行在访问时从 `/api/lastfm` 获取，仓库不存听歌快照。Vercel Production 与 Preview 环境均需配置 `LASTFM_API_KEY`；可选 `LASTFM_USER` 覆盖默认账户。本地将同名变量放在被忽略的 `.env`，由 dev 中间件调用同一个接口处理函数。

```dotenv
LASTFM_API_KEY=你的_API_Key
LASTFM_USER=你的_Lastfm_用户名
```

`LASTFM_USER` 环境变量仅覆盖接口查询账户。首页标题和无脚本说明中的主页链接在构建时读取 `src/utils/lastfm.mjs` 的 `LASTFM_USER` 常量；换成自己的账户时还需同步修改该常量并重新构建，避免排行与主页链接指向不同用户。

缺密钥时接口返回 503，页面显示失败说明；不影响静态博客的构建。接口缓存、扫描上限、空数据与取消请求语义见 [Last.fm 设计](../design/listening.md)。密钥只在服务端使用，不写入源码或公开配置。

### ActivityWatch 屏幕时间

首页屏幕时间读取本机生成、随仓库发布的聚合快照，包含日期、总时长、应用名与应用时长。首次同步、macOS 每小时任务的服务文件和日志位置、发布边界及卸载步骤统一见 [屏幕时间设计](../design/screen-time.md)。

### Giscus 评论

在自己的公开 GitHub 仓库启用 Discussions 并安装 Giscus App，用生成的仓库和分类信息替换 `src/config.ts` 的 `GISCUS`。评论出现在博客文章、友链页和全部拾趣分类子页，访客用 GitHub 登录后留言。

关联键为带尾斜杠的规范 pathname，本地与正式站的同一路径会使用同一讨论。修改 slug 或 base 需要处理旧讨论关联，本站不自动迁移。加载、主题和 OAuth 边界见 [评论契约](../design/site.md#comments) 与 [实现边界](../design/architecture.md#boundaries)。

### Umami 与 Oneko

Umami 脚本位于 `src/components/base/Head.astro`；二次部署时更换或移除演示站的统计配置，`MORE_LINKS` 里的公开看板入口也需对应修改。脚本只加载一份，不在 `astro:page-load` 手动重复上报。

Oneko 使用外部托管脚本，开关与皮肤配置在 `FEATURES.oneko`。页脚可隐藏，减少动态时隐藏；详情和许可见 [Oneko 设计](../design/oneko.md)。

<a id="deployment"></a>

## 部署

生产构建输出 `dist/`，`postbuild` 自动生成 Pagefind 索引、清理默认 UI 文件并检查正文是否成功渲染。`dist/`、`public/_media/` 等派生产物不提交。

### Vercel

仓库的 `vercel.json` 使用 `framework: null`（Other）、`buildCommand: pnpm build`、`outputDirectory: dist`，以同时提供静态页面和根目录 `api/lastfm.js` 函数。保留这套配置；直接改用 Astro 框架预设可能导致根 `api/` 不被收集、听歌接口返回 404。

部署前核实 `SITE.website`／`SITE.base`、Giscus、统计及 Last.fm 账户。不要把 `/blogs/` 重定向到首页，它承载文章列表和分类筛选。

### 其它静态平台

静态页面可从 `dist/` 托管；`/api/lastfm` 需要自行适配平台函数或独立服务，单独托管静态文件不能提供它。子路径部署先配置 `SITE.base` 并验证文章、资源、canonical、RSS 和评论路径；手写 `/demos/` 等根路径引用时也需包含实际 base。

发布后核实页面、搜索、RSS、评论和所启用的外部服务。构建通过不能说明 DNS、Giscus OAuth、CDN 缓存或线上 API 已验证。

<a id="verification"></a>

## 检查与验收

仓库 CI 的检查顺序见 [ci.yml](../../.github/workflows/ci.yml)，具体脚本以 [package.json](../../package.json) 为准。

```bash
pnpm format
pnpm lint
pnpm test
pnpm check
pnpm build
pnpm test:built-pagination
pnpm test:built-restructure
pnpm test:built-markdown
```

三项 `test:built-*` 必须在本次成功构建后运行。它们分别验证分页与无 JS 回退、页面和菜单结构、Markdown／媒体／RSS 全文与本地资源。dev 预览不能代替生产构建。

| 改动 | 补充检查 |
| --- | --- |
| 只改仓库说明文档 | 格式、相对链接和锚点，以及与代码／配置的一致性；无需重跑无关页面交互 |
| 文章与友链 | `validate_content.py` 基础预检，再构建并按需执行相关产物检查；预检不代替 Astro schema |
| 列表、分类、标签、分页 | 对应 `blog-browser`／`blog-tag-filter` 单测与 built 分页、结构检查 |
| 图片、卡片、HTML／音视频 | [正文验证映射](../design/content.md#verification)，检查源码资源与产物引用 |
| RSS／canonical／sitemap | [订阅验证映射](../design/distribution.md#verification)，真实阅读器另验 |
| 布局、导航、主题、搜索、评论 | 对应真实浏览器脚本、深浅主题及 1440／390／320px 可读性与横向溢出；字体声明或 CSS 拆分改动另跑 `scripts/verify-navigation-fonts.mjs`，检查切页时已加载字体不回退 |
| Last.fm 接口 | 属主和端点单测、固定载荷浏览器检查，部署后再验真实凭据与缓存 |

```bash
python3 blog-content-publisher-skill/scripts/validate_content.py --root . --blog src/content/blogs/slug.md
python3 blog-content-publisher-skill/scripts/validate_content.py --root . --friends
```

### 浏览器脚本

`scripts/verify-*.mjs` 中面向 Ego 的脚本复用已有 TaskSpace，不自行管理服务。确认服务 cwd 属于当前 worktree，再将 `__TASK_SPACE_ID__`、`__BASE_URL__` 替换为实际空间 ID 和服务日志的 Local 地址（含 base 与末尾 `/`），例如：

```bash
sed -e 's/__TASK_SPACE_ID__/<id>/g' \
  -e 's|__BASE_URL__|<实际 Local 地址>|g' \
  scripts/verify-nav-dropdown.mjs | ego-browser nodejs
```

按功能选用 `verify-home-content.mjs`、`verify-toc-navigation.mjs`、`verify-theme-refresh.mjs`、`verify-accent-palette.mjs`、`verify-background-layering.mjs`、`verify-shell-alignment.mjs`、`verify-prose-overflow.mjs`、`verify-media-focus.mjs`、`verify-card-rails.mjs`、`verify-giscus.mjs` 和 `verify-listening-startup.mjs`；以脚本内的占位符说明为准。目录检查覆盖 1200px 阈值及不同高度。

`verify-image-layouts.mjs` 还需将 `__REPO_ROOT__` 替换为当前 worktree 的绝对路径，它会创建并清理临时草稿和 SVG 夹具，不应修改真实文章。评论脚本不发送留言，OAuth 和评论持久化需单独用账号验收。

内容 skill 修改含实际图片排版、卡片或媒体的博客后，会启动或复用同 worktree 的 dev、核实目标文章 HTTP 成功再交付预览链接；纯文字或仅普通正文图不必预览。禁止启动或环境受限时明确说明未预览，不交付猜测的链接。

## 维护文档

README 是总览，`docs/README.md` 是查找入口，设计文档按功能维护现行契约，源码与测试是核实依据。新增规则放到已有主题，避免每次改动新建一份 SPEC。结构、交互和代码的有效变更记入 `CHANGELOG.md` 的未发布区；内容数据不记入，发布时再填写版本与日期。
