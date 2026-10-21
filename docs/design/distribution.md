# SEO 与全文订阅

任务目录：

- [理解 canonical、sitemap 与 RSS 的用途](#overview)
- [配置域名、base 与 canonical；处理地址迁移](#canonical)
- [生成并提交 sitemap](#sitemap)
- [订阅、发布与修改文章](#rss-publishing)
- [检查 RSS 全文表达](#rss-content)
- [修改模块接口、身份、失败与资源行为](#rss-design)
- [运行验证并说明验证边界](#verification)

本文说明站点收录操作与全文 RSS 契约。内容写法见 [内容与写作](./content.md)，页面行为见 [站点行为](./site.md)，整体模块关系见 [架构](./architecture.md)，发布变化见 [CHANGELOG](../../CHANGELOG.md)。实现、测试与本文应同步维护。

<a id="overview"></a>

## 用途总览

搜索引擎和订阅器需要明确的站外地址。本站使用三个互补入口：

| 入口 | 面向谁 | 解决什么问题 | 本站输出 |
| --- | --- | --- | --- |
| Canonical | 搜索引擎 | 声明同一内容应归到哪个官方 URL，避免追踪参数等分散身份 | HTML 的 `link[rel=canonical]` |
| Sitemap | 搜索引擎 | 提供可发现页面清单，辅助抓取；提交不保证收录 | `/sitemap-index.xml` 及分片 |
| RSS 2.0 | 订阅读者 | 阅读器定期拉取文章更新，在阅读器中读完整正文 | `/rss.xml`，摘要与 `content:encoded` 共存 |

全文指文章正文，不是整个网页。不复制导航、目录控件、作者头像行、页脚、封面布局或主题交互；正文里的卡片封面仍是正文资源。阅读器使用自己的字体与排版，不保证视觉一致。

站外协议中的页面及资源地址应是带协议、域名的绝对 URL，线上通常使用 HTTPS。站内发现链接可以使用带部署 base 的根路径；阅读器缓存刷新、离线图片缓存由阅读器决定。

<a id="canonical"></a>

## 域名、base 与 canonical

### 配置与地址分工

根地址统一在 [src/config.ts](../../src/config.ts) 的 `SITE.website`，当前为 `https://www.wutongyu.site/`；部署子路径由 `SITE.base` 表示，当前为 `/`。[astro.config.ts](../../astro.config.ts) 分别读取为 `site`、`base`。

| 地址种类 | 例子 | 生成规则 |
| --- | --- | --- |
| 站外页面地址 | `https://www.wutongyu.site/blogs/foo/` | canonical、sitemap、RSS、分享和 `og:image` 使用绝对 URL |
| 站内路径 | `/blogs/foo/` | [path.ts](../../src/utils/path.ts) 的 `withBasePath()` 接部署 base；`resolvePath()` 还补尾斜杠 |
| 内容图片 | 源文件 `./图片目录/文件.png` → 产物 `/_astro/<hash>.webp` | 源 Markdown/frontmatter 写相对路径，Astro 图片管线决定产物名，不能手写哈希 |

文章 [RenderPost.astro](../../src/components/views/RenderPost.astro) 为社交分享封面生成 1200px JPEG，再交 Head 拼成绝对 `og:image`。RSS 只渲染正文，不额外调用这条封面流程。

### 官方地址与筛选状态

[Head.astro](../../src/components/base/Head.astro) 是 canonical 的统一生成点：

```astro
---
const canonicalURL = new URL(Astro.url.pathname, Astro.site)
---
<link rel="canonical" href={canonicalURL} />
```

只取 `pathname`，查询串和片段不进入 canonical。文章官方路径为 `/blogs/<slug>/`；canonical 是声明，不是重定向，不改变地址栏。

文稿 `/blogs/?category=技术`、`/blogs/#tech`、`/blogs/#旅行` 的官方地址仍为 `/blogs/`。片段不产生服务器页面请求，脚本从已有文章中筛选并分页；首页兼容筛选书签会转到文稿页。

分类入口按 `category` 原值编码，不合并分类。旧 `#tech`、`#thought`、`#diary` 仅兼容“技术”“思考”“日记”；英文原值用 `#category=tech` 等逃逸。旧 `?category=` 按原值精确筛选，脚本转为等价片段并保留标签、页码。

动态入口、URL 和筛选由 [blog-browser.js](../../src/utils/blog-browser.js) 统一负责；归档分类配色由 [blog-category-colors.js](../../src/utils/blog-category-colors.js) 分配并持久记录。这些状态不新增 sitemap 条目，也不改变文章 URL、GUID、发布日期或 RSS 范围。

独立内容页如 `/interests/movie/` 有静态 HTML 和独立 canonical。新增满足 schema 的 `src/content/interests/` 顶层 `.md` / `.mdx` 文件，重新构建会自动生成分类页、菜单入口和 sitemap 条目；`recent.md` 不生成分类页。图标可选，不影响收录，拾趣不进入博客 RSS。

Head 同时输出页面标题（通常为“页面名 - Wutong Yu”）、描述、作者、社交元信息，以及有 `pubDate` 时的 `BlogPosting`、否则的 `WebPage` JSON-LD；结构化数据不是收录前提。favicon、manifest 也在此挂载，随 Head 内联的 shell CSS 与 SEO 无关。文章标题 schema 限制 60 字符，清晰摘要有助于搜索结果点击。

### 地址迁移必须单独处理

修改域名的配置入口是 `SITE.website`，但“换域名只改配置即可”不足以完成迁移。当前 GUID 就是本站文章绝对 URL；域名、文章 ID/slug、base 任一变化都会改变文章身份，订阅器可能把旧文章识别为新条目。本项目没有跨改名、换域名的永久 ID 系统。

迁移前记录旧、新文章与 feed 地址对应关系，评估订阅去重和历史链接；在托管层安排旧页面及旧 feed 的跳转/保留策略，更新 sitemap 提交并核对新 canonical、GUID、self、图片地址。若必须延续旧 GUID，需要另行设计、实现并验证身份映射；本站当前不会自动完成，也不能承诺所有阅读器无重复。

<a id="sitemap"></a>

## Sitemap 生成与提交

[astro.config.ts](../../astro.config.ts) 中的官方集成 `@astrojs/sitemap` 使用 `site: SITE.website` 在生产构建时生成 XML，不手写页面清单。总目录为 `sitemap-index.xml`，其引用 `sitemap-0.xml` 等分片；页面多时可拆多个分片。`<loc>` 必须是绝对 URL。

sitemap 来自构建路由，不来自文稿筛选结果。生产文章路由排除草稿；独立文章、拾趣分类等页面随静态路由进入清单。当前使用 `sitemap()` 默认配置，没有额外按 `search`、redirect 或工具页设置的自定义过滤器；不能把“通常应排除跳转壳/工具页”的建议当成现有实现保证，也不承诺默认生成 `<lastmod>`。

Head 挂载 `rel="sitemap"`，地址为 `withBasePath('/sitemap-index.xml')`。日常检查与提交：

1. 正常发布流程运行 `pnpm build`，查看 `dist/sitemap-index.xml` 及其引用分片，核对域名、base 与页面范围。
2. 部署后访问线上总目录，确认可获取 XML。
3. 可在 Google Search Console / 必应站长工具提交 `https://www.wutongyu.site/sitemap-index.xml`；子路径部署时填带 base 的实际绝对地址。
4. 新增文章/拾趣分类后重新构建与部署，无需手写 sitemap；地址迁移按上一节重新核对及提交。

<a id="rss-publishing"></a>

## 订阅及发布操作

### 读者订阅与作者发布

首页“订阅 RSS”和 Head 的发现链接均指向 `withBasePath('/rss.xml')`。把线上完整地址交给 Feedly 等阅读器，即可定期获取更新：

```astro
<link rel="alternate" type="application/rss+xml" title="RSS"
  href={withBasePath('/rss.xml')} />
```

1. 按 [内容与写作](./content.md) 新增/编辑博客；设置 `draft: false` 或移除 `draft` 以发布，保留正确 `pubDate` 与摘要。
2. 正常构建并部署后，新文章进入 feed；修改已有正文只更新内容，不使用 `lastModDate` 替换 RSS `pubDate`，也不因正文修改生成新身份。
3. 开发检查使用服务日志的实际 Local 地址，保留 base 后打开 `rss.xml`；根部署常见为 `http://127.0.0.1:4321/rss.xml`。应返回 XML 且不含草稿。
4. 阅读器何时刷新已有条目由其缓存策略决定，本站不强制刷新。

### 发布范围与兼容字段

范围唯一来源是 [data.ts](../../src/utils/data.ts)：`getPublishedBlogPosts()` 在开发和生产均排除草稿；`getSortedPosts()` 按 `pubDate` 降序，同日期按 ID 排序。**不按未来日期过滤，没有定时发布规则**；不能靠未来 `pubDate` 隐藏文章。

网页 `getFilteredPosts()` 在开发可预览草稿，生产排除草稿；网页可见不代表 RSS 发布。`search: false` 只影响搜索，非草稿仍进入 feed。RSS 覆盖全部已发布博客，不截断正文、不限制篇数、不新增分页源；空集合生成合法空 channel。

所有分类进入同一 `/rss.xml`，不输出分类元数据、不提供分类订阅。关于、拾趣、友链及页面布局不扩展 feed 集合；新增分类无需修改 RSS。分类颜色也不影响身份或日期。

| 字段 | 用途及当前行为 | 缺少时/取舍 |
| --- | --- | --- |
| `title` / `link` / `guid` / `pubDate` | 标题、访问、去重、发布时间；日期由官方包输出为 RFC 1123（`toUTCString()`） | 本站保留这些基本字段 |
| `description` | 可选摘要，与全文共存 | 无摘要时阅读器时间线可能只显示标题 |
| `content:encoded` | 完整正文 HTML | 本站必须提供，不能静默降回摘要 |
| `atom:link rel="self"` | 源自身的绝对地址 | 多数阅读器无它也能用，本站输出 |
| `language` | 来自 `SITE.lang` | 本站输出 |
| `lastBuildDate` / author | 更新时间提示/作者信息 | 不新增依赖当前时间的 `lastBuildDate`，不新增作者邮箱 |

条目 `link = post.data.redirect || articleUrl`，可去外站；GUID、正文相对地址解析基准和文末“阅读原文”仍为本站 `articleUrl`，正文来自本地文章，不能抓 redirect 目标替代正文。身份与序列化接口见 [模块契约](#rss-design)。

<a id="rss-content"></a>

## RSS 全文表达

正文通过 Astro `render(post)` 和 Container 渲染 `Content`，复用 [Markdown 插件管线](../../plugins/index.ts) 及 Astro 图片处理，不建立另一套 Markdown 解析器。`@astrojs/rss` 只负责 XML 序列化，不是加入 integrations 就能自动生成全文的插件。当前验收覆盖仓库实际 Markdown；schema 支持 MDX 不等于任意客户端组件都已适配。

### 静态降级表

| 内容 | 阅读器中的表达与义务 |
| --- | --- |
| 标题、段落、强调、删除线、列表、引用、分隔线 | 保留基础语义和文字；只移除自动标题 `#` 控件，保留作者普通链接 |
| 表格 | 保留行列、表头、单元格和必要跨行/跨列属性，不保证窄屏布局 |
| 横向 `:::card` | 保留类别、标题链接、封面、可选数值评分、可选日期与介绍；不依赖 CSS 星星或配色 |
| 竖卡/方卡 | 保留封面、标题链接、完整小字，按源顺序展开卡片栏，不含自动滚动副本 |
| 提示框/指令 | 保留标题、正文、有效链接、图片，可退化为普通块 |
| 普通代码 / Expressive Code | 基础 `pre > code`，保留源码、缩进、逻辑行、空行及已有文件名/标题；去掉按钮、行号装饰和代码折叠摘要，保留全部隐藏源码 |
| 行内/块级公式 | 读取 KaTeX `annotation[encoding="application/x-tex"]`，分别输出 `code` / `pre > code`；每个公式只出现一次，不输出重复 MathML/视觉树、不请求公式图片服务；缺源码明确失败 |
| Mermaid | 保留代码块源码，当前不新增图表渲染器 |
| 任务列表 | 复选框转 `[x]` / `[ ]` 文本，保留状态，去除交互表单 |
| 正文折叠内容 | 展开并保留摘要标题和隐藏区文字，不能只剩标题 |
| 嵌入媒体 | 移除播放器等控件及其子树，保留控件外说明/普通链接；不新增播放器或媒体 URL 提取适配 |
| 网页封面、导航、侧栏、页脚 | 不属于正文，不复制进 feed；正文卡片自身的图片仍保留 |

共享 [remark-media-card.ts](../../plugins/remark-media-card.ts) 负责评分/日期文字，RSS 不另算分数或日期：

| 卡片信息 | 网页与读屏 | RSS / 无样式降级 |
| --- | --- | --- |
| 评分 | CSS 星星 `aria-hidden="true"`；读屏读取“评分：3.5 分，满分 5 分” | 保留同一数值文字，不靠星星图形传意；缺评分不显示，0 分仍有效 |
| 日期 | 独立于评分，位于评分下、介绍前；读屏读取“日期：2026.10.18” | 保留原日期文本；未填/空白不输出，不推导日期也不替代文章 `pubDate` |
| 竖/方卡小字 | 共享插件输出完整文本 | 去除滚动样式后完整按序保留；竖/方卡不接受评分和日期 |

Expressive Code 的 `.ec-line` 用布局表达行，不能直接取整个 `pre.textContent`。清洗前跳过代码内 `summary` 子树，从每条源码 `.ec-line` 的 `.code` 取文本并用换行连接；单个换行占位节点规范成一条空行，非空行不 `trim()`。普通 `pre/code` 沿用原文本换行；普通正文 `details` 的摘要仍保留。

每篇清洗后的正文后统一附加“阅读原文”，目标是本站永久 URL，不能用它替代原正文。成功渲染的纯媒体正文被清洗后只剩此链接是允许的；渲染本身为空则由入口拒绝，详见失败契约。

### 图片、URL 与安全清洗

- 图片取 Astro 已渲染的 `src`，保留 `alt`、有效尺寸及可选 `title`，不能从源 Markdown 路径猜产物名，也不追加网页封面。
- `gallery` / `figure`、放大包装去掉 inert `template`、样式和控件后，剩余图片及文字按源顺序保留，不新增 RSS 布局解析器。
- 去掉 `srcset`、`sizes`、懒加载属性和样式，只留单个有效 `src`；`picture` 保留其中 `img`，不维护第二套响应式图片策略。
- HTTP(S) 地址保持可用；`//host/path` 按本站协议解析；相对 `href`、`../` 和 `#fragment` 基于本站文章 URL；根路径资源基于 origin 解析，渲染资源已含 base 时不能再加。保留中文、嵌套路径编码。
- `a.href` 只允许 HTTP(S)、`mailto:`、`tel:`，图片只允许 HTTP(S)。`javascript:`、`data:`、`file:` 等被拒绝；非法链接移除地址并保留文字，图片无合法 `src` 则抛错。
- `.md` 源链接只按标准 URL 解析，不猜新 slug，不在 RSS 内实现第二套路由映射或全站断链检查。
- 删除 `script/style`、嵌入控件、已识别按钮等子树及事件属性、class、style、站点 data 属性、不必要的 id/name；普通未知包装内文字仍保留。
- 代码、公式、地址等依赖 class/属性识别的转换必须先完成，再用成熟 HAST sanitizer 清洗。文字与属性走 AST/序列化器转义，不拼未经处理的文章 HTML；清洗后只序列化，不再注入未清洗 HTML。

<a id="rss-design"></a>

## 模块接口、身份、失败与资源义务

### 唯一属主与调用链

```text
GET /rss.xml → 已发布集合与排序 → 本站 articleUrl
  → 单 Container 逐篇 render(post) / renderToString(Content)
  → toRssHtml(html, articleUrl) → createRssXml(...) → 官方序列化 → Response
```

| 决策/资源 | 唯一属主与接口 | 边界 |
| --- | --- | --- |
| 集合/排序 | [data.ts](../../src/utils/data.ts)：`getPublishedBlogPosts()`、`getSortedPosts()` | endpoint 不重写过滤与排序 |
| base / 路径编码 | [path.ts](../../src/utils/path.ts)：`withBasePath()`；[rss-feed.js](../../src/utils/rss-feed.js)：`encodePathSegments()` | 各管自己的路径操作；endpoint 对 `/blogs/${post.id}/` 逐段编码，加 base 并解析一次本站 `articleUrl` |
| Markdown 与源图片解析 | Astro 配置、[plugins/index.ts](../../plugins/index.ts)、公共内容 API | `render(post)` 得到 `Content`，不调用私有图片替换函数 |
| 正文表达/URL/清洗 | [rss-content.js](../../src/utils/rss-content.js)：`toRssHtml(html, articleUrl): string` | 同步纯转换，抛原始错误；不读集合、SITE、磁盘、网络；endpoint 是唯一生产 caller |
| 字段与身份装配 | [rss-feed.js](../../src/utils/rss-feed.js)：`createRssXml({ site, homeUrl, feedUrl, items }): Promise<string>` | 接受已准备字段，不重推身份；准备 self、语言及 XML customData |
| XML/content 编码 | 官方 `@astrojs/rss`：`getRssString()` | wrapper 只装配参数；全文 HTML 交官方包序列化 |
| 顺序、空渲染、错误上下文、Container 生命周期 | [rss.xml.js](../../src/pages/rss.xml.js)：`GET()` | 全部成功后才返回 Response，不拼 XML，不调用 RenderPost、不抓网页或 postbuild 覆写 feed |

正文工具使用 `hast-util-from-html` 解析 fragment，局部转换后由 `hast-util-sanitize` 清洗、`hast-util-to-html` 输出；只允许正文必需的元素、属性、协议。[package.json](../../package.json) 声明依赖，[pnpm-lock.yaml](../../pnpm-lock.yaml) 固定实际依赖图。

### 身份与外层字段

items 输入为 `title`、`pubDate`、可选 `description`，以及已确定的 `link`、`guid`、`content`。GUID 稳定以前述域名、ID/slug 和 base 不变为前提，redirect 不改变 GUID。

`guid` 是本站 wrapper 输入，不是直接传给官方包的参数；wrapper 将它转换成 `<guid isPermaLink="true">` 的 `customData`，避免默认 GUID 跟随 redirect link。关闭官方自动追加尾斜杠，保留调用方准备的 URL。

channel 标题、介绍、语言取 `SITE.title`、`SITE.description`、`SITE.lang`；home 和 Atom self 使用带 base 的绝对 URL。响应为 `application/rss+xml; charset=utf-8`，使用官方默认 content 命名空间。站点值和 GUID 插入 customData 前必须 XML 转义，全文 HTML 不预先整段 XML 转义，避免重复转义。

不新增 stylesheet、分类协议、Atom/JSON Feed、全文开关、RSS 专属 frontmatter、跟踪统计或最近 N 篇源；不修改现有文章、全站路由、草稿语义或另设 RSS 专用 Markdown 插件。未使用的 React/Vue/客户端 MDX 组件不建立兼容层；新增不支持内容必须暴露错误，扩大支持需同步更新契约。

### 失败与资源边界

- 一次 GET 创建一个 Container，复用它按排序逐篇完成渲染与转换，不对全量文章 `Promise.all()`。全部条目与 XML 序列化成功后才返回 Response。
- 任一渲染、转换、序列化失败即本次生成失败；开发请求明确失败，生产构建失败。不跳过条目、不部分成功、不静默降回摘要。
- endpoint 在清洗前拒绝空/纯空白渲染 HTML，防止 Astro loader 吞错后返回空 Content；`toRssHtml()` 本身仍接受空输入。合法媒体渲染后被清洗为空不属于渲染失败。
- 单篇错误由 endpoint 补文章 ID 并保留 `cause`；工具在错误产生处抛出，全局 XML 错误保留原错误，无需另建错误码层次。修复后可重新构建，无持久恢复状态。
- postbuild 的 [check-content-rendered.mjs](../../scripts/check-content-rendered.mjs) 另检查全站每个正文容器，包括关于和拾趣；目录控件不掩盖空正文，图片/视频本身算内容。
- 内存保存所有条目和最终 XML，空间随全文总量增长。串行只限制同时正文渲染为一篇，不承诺常量内存；没有任意篇数/正文大小上限或固定构建耗时保证，遇到实际限制需重评设计，不能自动截断。
- 无持久缓存、锁、重试队列、断点续传、可配置并发或后台抓取。不同开发请求独立；构建中修改源码或多构建写同一目录不提供额外快照/隔离，取消遵循 Astro/进程行为。
- Astro 图片处理照常执行；RSS 适配层不新增 HTTP 请求，不抓远程正文、不自行下载/内嵌媒体、不探测远程存活。同站产物存在性由构建验收检查，远程资源未来可用性不作保证。
- 失败可能留下未完成的本地 `dist`，不得将失败构建当成功产物交付；本功能不清理/回滚整个目录，也不实现部署平台原子发布或回滚。

项目当前使用 Astro 7 系列；Container 是实验 API，通过锁文件和产物测试约束升级风险。主题、语法高亮色、KaTeX 排版、复制按钮、图表交互不在 RSS 保证内，公式源码是明确的产品取舍。

<a id="verification"></a>

## 验证

### 用户检查与开发验收所有权

查看任意文章源代码，搜索 `rel="canonical"`，确认本站绝对 URL；对筛选 URL 确认 canonical 不含 query/hash。检查 sitemap 总目录及分片，订阅地址保留部署 base；浏览器能显示 XML 只能证明可访问，不能证明真实阅读器兼容。

每条义务在最直接的属主接口验证，使用 `node:test` 与小 fixture，不引入测试框架；XML 用声明依赖 `fast-xml-parser`，不从包内部路径导入。

| 验收义务 | 所有权与证据 |
| --- | --- |
| 全文首尾、无截断、文字/图片/链接顺序 | 正文工具小 fixture；[verify-markdown-pipeline.mjs](../../scripts/verify-markdown-pipeline.mjs) 对真实页面正文清洗结果逐条比对，图片数量、地址、alt 完整 |
| 代码、公式、表格、提示、折叠 | [rss-content.test.mjs](../../test/rss-content.test.mjs) 验证逻辑行/缩进/空行/实体、代码摘要跳过、单次 TeX、缺 annotation 失败；产物核对真实非终端代码与复制载荷精确一致、公式源码存续 |
| 卡片评分/日期与完整小字 | [remark-media-card.test.mjs](../../test/remark-media-card.test.mjs) 属共享插件，验证读屏文字与 RSS 降级；布局/图片仍由共享管线与产物检查验证 |
| URL、图片、安全 | 正文工具验证中文/嵌套路径、base、`../`、片段、协议相对 URL、mailto/tel，移除危险协议/脚本/事件/样式；构建核对同站图片真实文件且无 Astro 占位符 |
| 身份、外层字段、XML、空集合 | [rss-feed.test.mjs](../../test/rss-feed.test.mjs) 调真实官方包解析 XML，核对 redirect link 与 GUID 分离、日期/摘要/语言/self/base，以及 `&`、`<`、`]]>` 不损坏 XML、不重复转义 |
| 集合与空渲染接线 | endpoint 回归模拟开发网页可见草稿，确认 RSS 不渲染草稿；拒绝空渲染、允许合法纯媒体降级；产物 canonical 集合核对 feed 集合及日期顺序，不硬编码篇数 |
| 失败不可隐藏 | 正文工具对非法图片/缺公式源码抛错；受控临时坏文章构建必须非零退出且有文章上下文；临时草稿不得进入生产 feed；恢复后最终构建成功 |
| Container 与成本 | 检查 endpoint 单 Container、串行、无抓取/缓存，不用固定时间阈值猜并发；篇数、资源数、耗时仅报告观察值 |

真实样本按内容选择：带图片的文章看宽度/alt，技术文章看代码/表格/Mermaid，算法文章看公式，提示框文章看说明文字。只检查 HTML fixture 不能替代真实 Astro 渲染。临时草稿/坏文章用于受控构建，恢复后再跑最终成功构建，不提交内容、不加生产专用测试开关。

测试消融要求：去掉 `content`、地址绝对化、逐行代码提取，或让 GUID 回退 link 时，对应检查应失败。保留表达义务的测试，删除被替代/重复的 fixture，不能靠测试数量证明完整。

### 门禁与真实阅读器限制

仓库门禁以 [.github/workflows/ci.yml](../../.github/workflows/ci.yml) 为准：`pnpm install --frozen-lockfile`、`pnpm format`、`pnpm lint`、`pnpm test`、`pnpm check`、`pnpm build`、`pnpm test:built-pagination`、`pnpm test:built-restructure`、`pnpm test:built-markdown`。它们是实现验收流程，不表示本次文档合并已运行这些检查。

Astro、Expressive Code、RSS 或清洗依赖升级时必须重跑真实构建及正文转换验证。实际阅读器至少抽查一篇带图片/代码的文章和一篇带公式的文章，单独报告显示效果；没有访问条件必须写明“未进行真实阅读器验证”，不能以浏览器显示 XML 替代，不能声称所有阅读器兼容。

一手参考：[Astro 全文 RSS](https://docs.astro.build/en/recipes/rss/#including-full-post-content)、[Container API（实验）](https://docs.astro.build/en/reference/container-reference/)、[官方 RSS 源码](https://github.com/withastro/astro/blob/main/packages/astro-rss/src/index.ts)、[HAST sanitizer](https://github.com/syntax-tree/hast-util-sanitize)。依赖升级后的代码/公式结构兼容由产物回归验证。
