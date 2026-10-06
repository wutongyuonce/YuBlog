# YuBlog

[English](README_ENG.md) · [更新日志](CHANGELOG.md) · [项目解析](docs/项目解析.md) · [SEO](docs/Canonical%20URL、Sitemap、RSS.md) · [Astro](docs/Astro.md)

[![Astro](https://img.shields.io/badge/Astro-7-ff5a03?logo=astro&logoColor=white)](https://astro.build)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.9-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![UnoCSS](https://img.shields.io/badge/UnoCSS-66-656565?logo=unocss&logoColor=white)](https://unocss.dev)
[![Pagefind](https://img.shields.io/badge/Pagefind-search-4b32c3)](https://pagefind.app)
![License: MIT](https://img.shields.io/badge/license-MIT-green)

*梧桐雨* 的个人站点：Astro 7 静态生成，黑白主题，文章浏览、标签分类、统一归档、项目展示、个人简介、友链信息。

线上地址：[https://www.wutongyu.site/](https://www.wutongyu.site/)

## 页面与内容

| 路由 | 说明 | 内容源 |
| :--- | :--- | :--- |
| `/` | 作者、RSS、社交、写作热力、最近五篇文稿与近期书影游；无文章分页和个人侧栏 | `BlogProfile`、`WritingHeatmap`、`RecentWriting`、`recent.md` |
| `/blogs/` | 完整文稿，分类／标签筛选，每页七篇 | `src/content/blogs/**/*.{md,mdx}` |
| `/blogs/#tech`、`#thought`、`#diary` | 技术、思考、日记及自动发现的新分类（如 `#旅行`）；兼容旧 query | `src/utils/blog-browser.js` |
| `/tags/` | 标签目录和排序，多选 AND；选择后展示列表 | 文章 `tags` |
| `/archives/` | 单条按年时间线，带分类徽标 | 文章 `pubDate`／`category` |
| `/interests/`、`/interests/<id>/` | 拾趣入口与按内容自动生成的分类子页 | `src/content/interests/*.{md,mdx}`（排除 `intro.md`、`recent.md`） |
| `/projects/` | 项目页头与分类网格 | `src/content/projects/data.json` |
| `/about/` | 作者介绍；无子页标签，背景关闭 | `src/content/about/about.md` |
| `/friends/` | 推荐／双向两组友链和交换模板 | `src/content/friends/data.json` |
| `/blogs/<slug>/` | 标题、可选封面、正文；桌面常驻目录，窄屏浮动入口 | 文章集合 |
| `/rss.xml` | 完整正文 RSS，保留摘要和文章身份，独立于页面布局 | `src/pages/rss.xml.js` |

发布带新 `category` 的文章后，重新构建会自动扩展文稿菜单、数量和最近四篇预览；新分类使用 `/blogs/#旅行` 这样的 URL 片段链接（`#` 后是分类标识，浏览器会编码中文），归档徽标自动分配稳定的深浅主题颜色。旧 `?category=` 链接仍可用，启用脚本后转换为等价的片段链接。RSS 仍订阅全部已发布博客。分类筛选依赖 JavaScript；拾趣的 `/interests/movie/` 是独立内容页，可直接阅读。

新增拾趣分类：在 `src/content/interests/` 直接添加 `<id>.md`（也支持 `.mdx`），填写非空 `title`、`description` 和非负整数 `order`。重新构建后自动生成 `/interests/<id>/`，并按 `order` 加入拾趣入口和顶部下拉菜单；分类不限于当前的设备、动漫、电影、电视剧、游戏、书、Kpop。无需修改路由或导航数组。图标可选，在 `src/config.ts` 的 `INTEREST_ICONS` 中以不含扩展名的文件名为键配置；未配置时菜单显示纯文字，不留图标占位。拾趣没有 `draft` 开关，新增分类随下一次构建发布；`intro.md`、`recent.md` 不作为分类。

顶部品牌“梧桐雨の博客”返回首页，顶栏文字统一使用宋体。导航依次为文稿、标签、归档、拾趣、项目、关于、更多，工具为本仓库 GitHub、搜索、主题。“更多”下拉包含友链和相册，友链指向 `/friends/`，相册指向 `https://photos.wutongyu.site/`，带 ↗ 并在新标签页打开；菜单数据在 `MORE_LINKS`。页脚使用宋体，作者名指向首页，电脑和手机上均显示萌 ICP 链接。访问统计由 `Head.astro` 加载 Umami Cloud 脚本，页面不显示计数或徽章。文章属于文稿，拾趣子页属于拾趣；导航准备、取消和历史返回共用父级定位。首页个人社交来自 `AUTHOR_LINKS`，不依赖关于 Markdown 是否包含社交链接。

全站内容以 660px 版心居中，顶栏引用同一版心宽度并同步响应式收窄。首页作者／名言／社交居中；写作热力标题与近期笔墨左对齐，年份在标题右侧。目录在版心右侧留白中线基础上向右移 16px，最大宽 208px、高度最多半屏，中心比视口中线高 32px。标签、拾趣、项目、关于共用宋体页头，文稿列表文章标题使用宋体加粗，归档文章标题使用常规字重宋体，正文与 Markdown 内部标题使用普通字体。首页、标签、归档、文稿、拾趣及其子页使用点阵背景，项目使用 rose，关于关闭背景。

封面用 `titleImage`／`titleImageAlt`，源图位于 `src/content/blogs/_title-images/`；正文图位于文章所在目录或子目录，以相对路径引用，不能向上越级。拾趣图片位于 `src/content/interests/<id>/`。入口说明只维护 `intro.md`，首页近期书影游只维护 `recent.md`；二者不生成拾趣子页或菜单项。`:::card` 与标题都使用共享 Markdown 管线和 `prose.css`：连续卡片按容器宽度自动分列，当前版心最多两列，标题将卡片分组。正文标题共用 `.markdown-content`。评分由作者按需填写，与观看／游玩状态无关；未填写时不生成评分。关于内容只维护 `src/content/about/about.md`。

作者操作见 [内容发布 skill](blog-content-publisher-skill/SKILL.md)，图片写法见 [图片管线指南](docs/Astro图片管线指南.md)。页面行为契约见 [站点行为 SPEC](docs/站点行为%20SPEC.md)，模块权威与边界见 [项目解析](docs/项目解析.md)，全文订阅见 [RSS SPEC](docs/RSS%20全文支持%20SPEC.md)。

## 技术

- Astro 7 + TypeScript，Markdown / MDX Content Collections（使用 unified 的 Remark / Rehype 插件管线）
- 内容图片走 Astro 图片管线：相对路径 + `|w` 宽度标记，自动 WebP、`srcset`、宽高与懒加载；`public/` 只放站点级资源
- 文章标题字体构子集：只下载实际用到的字形（实际字形集合随内容更新）
- 正文 Inter、代码 DM Mono 使用 `public/fonts/` 里的拉丁子集，不请求 Google Fonts
- KaTeX 样式与字体本地打包（不依赖 CDN），产物只留 woff2
- UnoCSS + `public/shell.css`（导航、版心、首页、归档、分页等壳层样式集中一个属主）
- Pagefind 只索引博客，且仅在打开搜索时加载
- `astro-expressive-code` 代码块
- 明暗主题、ClientRouter 转场
- 背景：`dot` / `rose` / `snow`，按页配置；关于页关闭。点阵按透明度分 6 档描边；大屏间距按约 8000 点放大（边缘补点会略超，不是硬上限），1440×900 仍是 15px。canvas 背景响应 `prefers-reduced-motion`（闸门在 `src/utils/reduced-motion.js`）

## 本地运行

需要 Node.js `22.12+`（推荐与 CI 一致的 `24`），以及 `pnpm@12.9.1`。

```bash
pnpm install
pnpm dev
```

```bash
pnpm check                 # Astro 类型与内容检查
pnpm build                 # 生产构建（含 Pagefind）
pnpm test:built-pagination # 检查文稿分页与无 JS 回退
pnpm test:built-restructure # 检查页面结构、菜单、友链与文章语义
pnpm test:built-markdown   # 检查构建后图片、标题、卡片与 RSS 全文
pnpm preview
pnpm test                  # 运行全部单元测试
pnpm test:blog-browser     # 分页与 URL
pnpm test:blog-tags        # 标签 AND 筛选
pnpm test:blog-stats       # 字数统计与格式
node --test test/blog-heatmap.test.mjs # 上海日历与年度汇总
node --test test/remark-media-card.test.mjs # Markdown 卡片
pnpm test:recent-post-date # 近期文章日期
pnpm test:progress-stats   # 年积日与进度
pnpm test:cjk-emphasis     # CJK 旁强调语法
pnpm test:toc-active       # 当前章节判定
pnpm test:canvas-size      # canvas 后备存储尺寸与 DPR 上限
pnpm test:reduced-motion   # 减少动效闸门
pnpm lint
pnpm format
```

## 结构

```text
src/
  components/     导航、首页、列表、拾趣、关于、友链、TOC
  content/        blogs / about / interests / projects / friends
  layouts/        BaseLayout、BlogIndexLayout、StandardLayout
  pages/          路由
  styles/         正文与 Markdown
  utils/          列表、统计、筛选、路径
public/shell.css  跨页保留的壳层样式
docs/             项目解析（架构）、图片管线指南、Astro 语法、SEO 教程
```

## 个人二次开发

1. 修改 `src/config.ts` 的 `SITE`、`UI`、`AUTHOR_LINKS`；品牌文字在 `NavBar`，作者名称和名言在 `BlogProfile`，关于正文中的联系方式按作者实际内容维护。
2. 按 [内容发布 skill](blog-content-publisher-skill/SKILL.md) 修改文章、项目、关于、拾趣或友链。字段以 `src/content/schema.ts` 为准，不先改页面结构。
3. 更换 `public/avatar.webp`。交换模板信息在 `FriendsApplyPanel` 的 `friendInfo`，不随 `SITE` 自动同步。
4. 调整页面结构前读 [项目解析](docs/项目解析.md)。索引页面复用 `BlogIndexLayout` 内容壳，不复制侧栏；共享样式集中维护；需要局部覆盖时检查作用域和层叠效果。
5. 内容图片走 Astro 管线，站点资源留在 `public/`。新增或改图片必须构建校验；准备 PR 时运行全部必需检查和构建产物检查。

## 文档与更新日志

README、SPEC 和操作指南描述当前实现。网页结构、交互和代码的有效变化记入 [CHANGELOG.md](CHANGELOG.md) 的「未发布」；文章、关于、拾趣、项目、友链等内容数据不记入。同一功能的相关调整合并为最终结果，发布时再填写实际版本与发布日期。

## Skill 怎么用

仓库里是 `blog-content-publisher-skill/SKILL.md`。

- 放到 Agent 的 skills 目录
- 直接说要改哪一页即可，例如：发博客、改设备、新增拾趣分类、给分类补图标、加友链、改顶栏 GitHub、改关于页社交。Agent 应先对表再动文件。
- 它会改 Markdown / JSON / `src/config.ts` 里的站点信息；新博客文章在用户没说发布时保持 `draft: true`（不适用于拾趣）；没有明确授权就不要 commit、push 或部署。
- 改结构、CSS、分页算法时不要走这个 skill，用 `docs/项目解析.md`。

MIT
