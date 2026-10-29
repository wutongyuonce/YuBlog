# YuBlog

[在线预览](https://www.wutongyu.site/) · [文档导航](docs/README.md) · [开发与部署](docs/guides/development.md) · [English](README_ENG.md) · [更新日志](CHANGELOG.md)

[![Astro](https://img.shields.io/badge/Astro-7-ff5a03?logo=astro&logoColor=white)](https://astro.build)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![UnoCSS](https://img.shields.io/badge/UnoCSS-66-656565?logo=unocss&logoColor=white)](https://unocss.dev)
[![Pagefind](https://img.shields.io/badge/Pagefind-search-4b32c3)](https://pagefind.app)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

梧桐雨的个人博客，使用 Astro 7、TypeScript 和 Markdown／MDX 构建。以文章阅读为主，兼顾项目、书影游、个人介绍和友链；提供亮暗主题、可选点缀配色、全文搜索和全文 RSS。

页面与文章在构建时生成静态 HTML，普通阅读不依赖后端。首页 Last.fm 排行与[拾趣歌单](docs/design/playlists.md)通过运行时接口获取，评论由 GitHub Discussions／Giscus 提供。

[页面总览](#页面总览) · [主要功能](#主要功能) · [快速开始](#快速开始) · [维护内容](#维护内容) · [二次开发](#二次开发) · [详细文档](#详细文档)

## 页面总览

| 页面 | 路由 | 可以做什么 |
| --- | --- | --- |
| 首页 | `/` | 作者与社交、写作热力、时间进度、最近五篇文稿、屏幕时间、近期书影游、Last.fm 七日 TOP 10 |
| 文稿 | `/blogs/` | 浏览全部文章，按分类和标签筛选，每页八篇，随便逛逛 |
| 标签 | `/tags/` | 按名称或数量排序，多选标签取交集 |
| 归档 | `/archives/` | 按年浏览文章时间线，查看分类和标签 |
| 文章 | `/blogs/<slug>/` | 阅读正文、桌面／手机目录、上下篇、随机文章和评论 |
| 拾趣 | `/interests/`、`/interests/<id>/` | 设备、动漫、电影、游戏、书等内容；分类随 Markdown 文件自动生成 |
| 项目 | `/projects/` | 按分类展示项目卡片 |
| 关于 | `/about/` | 作者介绍，维护一份 Markdown |
| 友链 | `/friends/` | 推荐／双向友链、交换模板、留言申请 |
| 订阅 | `/rss.xml` | 订阅所有已发布博客的完整正文 |

顶栏提供文稿分类预览、拾趣分类菜单和“更多”入口。相册与访问统计看板是配置的外部站点。博客分类使用 `/blogs/#技术` 这样的筛选地址，拾趣分类使用独立静态子页；两者不共用路由机制。完整行为见 [站点与页面](docs/design/site.md)。

## 主要功能

- **文章浏览**：动态分类、标签 AND 筛选、分页与历史恢复、归档时间线、上下篇和随机阅读。草稿可在 dev 预览，生产与 RSS 排除草稿。
- **正文写作**：Markdown／MDX、代码高亮与折叠、KaTeX、提示框、博文链接卡、HTML 与音视频嵌入。
- **图片与书影游**：Astro 图片优化，网格／横滑／绕排、点击大图与相册翻页，横卡可选评分和日期，竖卡／方卡可横滑或按条件循环。
- **阅读体验**：桌面常驻目录与手机浮动目录、站内转场、亮暗主题、五套点缀配色、响应式版心和减少动态效果支持。正文、代码与标题字体在本地加载。
- **搜索与订阅**：Pagefind 构建全文索引，打开搜索时才加载；RSS 保留全文图文与代码，复杂组件转换为阅读器可用的基础内容。
- **个人站点功能**：写作热力、[ActivityWatch 屏幕时间](docs/design/screen-time.md)、近期书影游、Last.fm 七日排行、Giscus 评论、Umami 统计及可选 Oneko 像素猫。

功能参数、资源边界与实现细节集中在 [docs](docs/README.md)。[正文样式指南文章](src/content/blogs/image-layout-demo.md) 提供可运行效果与可复制写法。

## 快速开始

需要 Node.js **22.12+**（推荐 CI 使用的 **24**）和 **pnpm 12.9.1**；完整测试还需要 Python 3。

```bash
pnpm install
pnpm dev --open
```

使用日志中的实际 Local 地址。生产预览：

```bash
pnpm build
pnpm preview
```

dev 搜索使用模拟数据，真实 Pagefind 搜索需先构建再预览。`pnpm preview` 只服务静态产物，不提供听歌、歌单和屏幕时间接口；这三个本地接口由 dev 提供。

准备部署或修改功能时，按 [检查与验收](docs/guides/development.md#verification) 运行格式、lint、单测、类型与构建检查。环境变量、Vercel 和其它平台的差异见 [部署指南](docs/guides/development.md#deployment)。

## 维护内容

| 想修改 | 文件／目录 |
| --- | --- |
| 博客与正文资源 | `src/content/blogs/`；文章配图放同目录或子目录 |
| 文章封面 | `src/content/blogs/_title-images/`，用 `titleImage`／`titleImageAlt` 引用 |
| 拾趣分类与配图 | `src/content/interests/<id>.md` 或 `.mdx`，配图放对应子目录 |
| 歌单 | `src/data/playlists.json`，封面放 `src/content/interests/playlists/` |
| 首页近期书影游 | `src/content/interests/recent.md` |
| 作者介绍 | `src/content/about/about.md` |
| 项目／友链 | `src/content/projects/data.json`／`src/content/friends/data.json` |

文章字段以 `src/content/schema.ts` 为准；新增拾趣分类填写 `title`、`description` 和 `order` 即可，不改导航数组或路由。内容图用相对路径交给 Astro，不手写构建后的资源地址。

详细操作见 [内容维护指南](docs/guides/development.md#content)。使用 AI Agent 时，可安装整个 [内容发布 skill 包](blog-content-publisher-skill/SKILL.md)，直接提出发文章、换封面、加拾趣或友链等任务；它维护内容和配置，布局与交互开发走设计文档。

## 二次开发

先把站点变成自己的，再调整功能和布局：

| 任务 | 修改入口 | 说明 |
| --- | --- | --- |
| 域名、标题、导航、社交与开关 | `src/config.ts` | `SITE`、`UI`、`MORE_LINKS`、`AUTHOR_LINKS`、`FEATURES` |
| 品牌、首页作者／名言、头像与页脚 | `NavBar.astro`、`BlogProfile.astro`、`public/avatar.webp`、`Footer.astro` | 这些文案与备案不全部由 `SITE` 自动同步 |
| 页面结构 | `src/pages/`、`src/layouts/`、`src/components/views/` | 先查 [架构与模块边界](docs/design/architecture.md) |
| 壳层、主题与正文样式 | `public/shell.css`、`src/styles/` | 共享变量、壳层与正文各有属主，见 [样式边界](docs/design/architecture.md#boundaries) |
| Markdown 语法与媒体处理 | `plugins/index.ts`、各 Remark／Rehype 插件 | 见 [正文与媒体](docs/design/content.md#pipeline) |
| 评论、听歌、统计与像素猫 | `GISCUS`、`api/lastfm.js`、`Head.astro`、`FEATURES.oneko` | 先替换演示账号，见 [外部服务配置](docs/guides/development.md#services) |

更换域名、base 或文章 slug 会影响永久地址、RSS 去重及评论关联，需要单独核对迁移，见 [SEO 与全文订阅](docs/design/distribution.md#canonical)。Vercel 配置同时服务静态页面与根目录 API；仅把 `dist/` 放到静态托管不能提供听歌与屏幕时间接口。

目录速查：

```text
src/config.ts       站点身份、导航、功能开关
src/content/        Markdown／MDX／JSON 内容与 schema
src/pages/          路由与 RSS 入口
src/layouts/        通用页面壳与正文布局
src/components/     页面拼装、导航、目录与控件
src/utils/          集合、筛选、状态与交互逻辑
src/styles/         全局变量、正文与 Markdown 样式
plugins/            正文管线、媒体镜像、构建集成
api/                Last.fm 运行时接口
public/             站点资源、独立 HTML 演示、shell.css
docs/               使用指南、设计与学习参考
test/、scripts/     单元测试、构建产物与浏览器检查
```

## 详细文档

完整索引见 [docs/README.md](docs/README.md)，也可直接按主题进入：

| 文档 | 内容 |
| --- | --- |
| [开发与部署](docs/guides/development.md) | 本地模式、个性化、内容维护、外部服务、部署与验收 |
| [站点与页面](docs/design/site.md) | 页面契约、导航／筛选／上下篇、目录、配色与评论 |
| [架构与模块边界](docs/design/architecture.md) | 调用链路、模块属主、共享样式及扩展位置 |
| [正文与媒体](docs/design/content.md) | 图片、卡片日期、相册、HTML／音视频、Excalidraw 与博文链接卡 |
| [SEO 与全文订阅](docs/design/distribution.md) | canonical、sitemap、RSS 身份与内容降级 |
| [Last.fm](docs/design/listening.md)／[Oneko](docs/design/oneko.md) | 两个可选集成的配置与设计 |
| [Astro 学习笔记](docs/reference/astro.md) | 框架组件、插槽与模板语法；不作为项目现行规范 |

当前行为与设计随代码维护；历史变化见 [CHANGELOG](CHANGELOG.md)。项目采用 [MIT](LICENSE) 许可，第三方资源另遵循各自署名与许可。
