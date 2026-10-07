---
name: blog-content-publisher
description: >
  维护 YuBlog（Wutong-Yu Astro 站）所有可改内容。按页面改：文稿与配图、首页近期笔墨和标签/归档所依赖的文章元数据、
  项目 JSON、关于作者介绍、拾趣分类（可新增、图标可选）与个人社交、友链 JSON、顶栏导航与顶栏 GitHub、友链申请模板文案。
  触发：发博客、改文章、改封面、改 titleImage、改分类、改关于、改拾趣、新增拾趣分类、给拾趣分类补图标、改设备、改动漫、改影视、改游戏、改书、改 Kpop、改友链、改项目、改导航、改顶栏 GitHub、改关于页社交、改名片站名。
  不要用来做布局/CSS 重构；那些看 docs/项目解析.md。
---

# YuBlog 内容维护

按**页面**改用户能看见的文案和数据。契约以 `src/content/schema.ts` 为准，旧示例和它冲突时听 schema。

先确认仓库根有 `package.json`。不碰无关的工作区改动。不要 commit / push / 部署，除非用户明确说。

## 先判断改哪一页

| 用户在说 | 页面 | 改哪里 |
| :--- | :--- | :--- |
| 发文章、改正文、改封面/标题图、改分类标签、草稿 | 首页近期笔墨 + 文稿 + 标签 + 归档 + 详情 + 全文 RSS | 文：`src/content/blogs/`；正文图：`src/content/blogs/<名>-img/`；封面：`src/content/blogs/_title-images/` + `titleImage` |
| 改标签展示（标签名来自文章） | 标签页 | 改各篇 `tags:`，不要手写标签页数组 |
| 归档多一条/少一条 | 归档 | 同上，靠 `pubDate` |
| 项目卡片 | 项目 | `src/content/projects/data.json` |
| 作者介绍 | 关于 `/about/` | `src/content/about/about.md` |
| 改拾趣内容、新增或重排拾趣分类（如设备、动漫、旅行） | 拾趣入口和对应子页 | `src/content/interests/<id>.md`，图放对应 `<id>/` |
| 友链增删改、申请模板里的站名/链接 | 友链 | `data.json` 或 `FriendsApplyPanel.astro` 的 `friendInfo` |
| 顶栏页面名、顶栏 GitHub | 全站顶栏 | `src/config.ts` 的 `UI` |
| 个人社交（名字、链接、图标） | 首页与关于 | `config.ts` 的 `AUTHOR_LINKS`；若 `about.md` 也展示同一联系方式，再同步该字段 |
| 站点标题、域名 | 全站 SEO | `src/config.ts` 的 `SITE` |

本 skill 管理内容与配置；布局、CSS 和交互逻辑按 `docs/项目解析.md` 的权威表处理，不混入一次内容更新。

读 schema，再读同目录一份现成文件当样例。

---

## 首页 / 标签 / 归档 / 文章详情（同一批文章）

完整列表在 `/blogs/`，首页只显示最近五篇已发布文稿。文章还进入标签、归档、`/blogs/<slug>/` 和全文 RSS。生产不含草稿；开发网页列表／正文可预览草稿，RSS 在开发和生产均只含已发布文章。首页统计／预览和顶部分类菜单只读已发布文章。`search: false` 不会从 RSS 排除文章，RSS 不携带页面导航、封面卡片或主题样式。

1. 文件名短而稳。子目录会进 slug。**不要擅自改已有文件名**（会改 URL）。用户明确要求改名时可以改，但本站**没有**旧 slug → 新 slug 跳转，旧链接会 404。
2. `title`（最多 60 字）、`pubDate`、`category` 必填。日期推荐写 `YYYY-MM-DD`；预检也接受 ISO 时间戳，不改写源文件。
3. 用户没说发布就 `draft: true`。只有明确要上线才 `false` 或删掉。
4. `category` 必填，任意非空字符串；不写或写空会构建失败。首页、菜单、列表和归档使用原值，不合并任何别名，没有默认分类；首页／列表／归档直接读 `data.category`。分类名以作者选择为准，未经要求不改已有值。动态入口、颜色、URL 与精确筛选的唯一权威是 `src/utils/blog-browser.js`，不维护固定分类表。发布文章并重新构建后，菜单按已发布文章的分类篇数降序、同数按名称的 `zh-Hans-CN` 排序，每类最多四篇最近文章，发布日期顺序不变；草稿不参与入口、计数或预览，仅含草稿的分类不出现，已发布集合为空时只保留“查看全部文稿”链接。分类统一使用名称编码 URL 片段（如 `/blogs/#旅行`）；旧 `#tech`、`#thought`、`#diary` 仅为 URL 兼容别名，分别精确定位“技术”“思考”“日记”，英文原值 `tech` 等用 `#category=tech` 逃逸。旧 `?category=` 始终按原值精确筛选，启用脚本后转换为等价片段。所有分类颜色统一由原始名称稳定 hash 生成，无固定类别调色板，无需改 CSS 或在页面复制分类判断。`tags` 是独立话题数组。
5. `description` 短、事实。极短文才 `toc: false`。不进搜索才 `search: false`。
6. 正文图：放到 `src/content/blogs/<短名>-img/`（与文章同级；分组文章放同组目录下，例如 `src/content/blogs/算法笔记/algo-img/`）。Markdown 用**相对路径**：`![说明](./<短名>-img/文件.png)`。

   - 图片必须位于该文章所在目录或其子目录内。正文图片**不能用 `../` 向上越级**，否则构建直接报 `ImageNotFound`。
   - 图片一律走 Astro 图片管线：自动转 WebP、生成 `srcset`、注入宽高、懒加载。**不要手工压缩源图**，也不要再放进 `public/`。
   - 必要时用 alt 后缀声明显示宽度：`![说明|w480](./<短名>-img/文件.png)`。只支持像素，不支持百分比；桌面正文列宽 660px，所以「半宽」可写 `|w330`（窄屏仍受实际列宽限制）。**不要把 `|w480` 写进图片 URL**，构建可能不报错但输出不可见的占位图。不写标记就是原图宽度（超过列宽时按列宽显示）。
   - **不要用原始 `<img>` 标签**：本地相对路径会在构建期直接报错并提示改用 Markdown 语法，不会静默 404。代码块里的示例除外。
   - 外链图片（别的站上的图）Markdown 与原始 `<img>` 两种写法等价，都不进管线。`data:` 内联图片（从 Notion／Word／部分网页粘贴时会带出来）构建期报错，先把图存成文件。

7. 列表和详情标题块的封面**只有一条路**：文件放 `src/content/blogs/_title-images/`，frontmatter 用 `titleImage` / `titleImageAlt`。

   ```yaml
   titleImage: ./_title-images/night-lantern.webp
   titleImageAlt: 夜晚提灯的动漫场景
   ```

   - **不要写 `cover` / `coverAlt`**，字段已删除；列表也不会再 fallback。
   - 有 `titleImage` 必须有 `titleImageAlt`。没封面就两行都别写，列表对应位置空着。
   - 路径是相对于本文件的：文章在 `src/content/blogs/` 下写 `./_title-images/<文件>`，在组目录里写 `../_title-images/<文件>`。文件名短、ASCII，如 `night-lantern.webp`。
   - 封面同样进管线，会按列表卡片与文章封面的尺寸自动转 WebP，不必手工压缩。
   - 不要把同一张封面再当正文第一张，除非正文真的还要用。
8. 正文不要再写一个 `# 标题`，frontmatter 的 `title` 已经是页标题。从 `##` 开始。
9. 不编造引用、日期、数据。
10. 跳到另一篇文章写**站内 URL**：`[27移除元素](/blogs/算法笔记/算法-1数组链表/#27)`。`./另一个文件.md#锚点` 在 Typora 里能点，站上是 404，而且**构建不报错**。改写前确认目标文章存在且不是 `draft: true`；目标不在站点上时删掉链接、保留可见文字，并说明移除了哪一条，不要猜 URL。slug 拿不准就先 `pnpm build`，再 `ls dist/blogs/<组>/` 看真实目录名。
11. 自定义锚点写 `<a id="27"></a>`（短 ASCII id，跟在标题那一行末尾）。**不要清理看起来“没人用”的空锚点**：同页 `](#15)` 和跨文章 `/blogs/…/#27` 两类跳转都以它们为目标。

```md
---
title: 文章标题
description: 给列表、封面描述和 RSS 的一句摘要。
pubDate: 2026-09-18
category: 技术
tags: [Astro]
titleImage: ./_title-images/foo.webp
titleImageAlt: 一句能读的描述
---
```

校验前运行 `pnpm install`，并确保 Node.js 与 Python 3 可用。预检复用 Astro 的 frontmatter YAML 解析器：`pubDate: 2026-09-21 # 发布时间` 的行尾注释会忽略，引号内的 `#` 和多行正文会保留；YAML 语法错误明确失败。日期接受 ISO 日期或时间戳，推荐日常继续写 `YYYY-MM-DD`；不改写源文件，也不替代 Astro schema／构建验证。

校验：

```bash
python3 blog-content-publisher-skill/scripts/validate_content.py --root . --blog src/content/blogs/slug.md
```

---

## 正文里的原生 HTML 与媒体

正文里的 `<h2>`、`<table>`、`<blockquote>` 和 Markdown 写法获得同样处理（标题 id、锚点、目录条目、表格滚动容器、提示框）。契约见 `docs/正文 HTML 与媒体 SPEC.md`。

- `<style>` 块、`style="…"`、`class` 都生效；`<style>` 是**整页全局**的，会影响顶栏和目录，用带前缀的类名或 UnoCSS 工具类。`<div>`、`<span>`、`<br>`、`<details>` 原样透传。
- 图片尺寸写 alt 的 `|w` 标记，例如 `![说明|w330](./x.png)`；不要用 `style="zoom:50%"`（Typora 拖拽缩放、LeetCode 粘贴会自带）。外链图 Markdown 与 `<img>` 两种写法等价。
- 视频：外链平台用 `<iframe>`；本地文件用 `<video src="./demo.mp4">`，文件放文章旁边或子目录，构建自动镜像到 `public/_media/`，Typora 与站点两边都能播，不需要手工复制。
- 视频旁建议补一行文字链接（否则订阅者在 RSS 里只看到空白），指向同一个文件即可：`[本视频](./demo.mp4)`。指向本地媒体文件的链接会和 `src` 一起被改写。
- 下面这些会**构建期报错**（带文件路径与行号），不会静默 404：原生 `<img>` 写相对路径（改用 Markdown 语法；处于 `.mdx` 页面或同一路径也被 Markdown 图片语法引用时例外，见 SPEC）、`<video poster="…">` 写相对路径（poster 是图片，不进管线也不被镜像，请把图片放进 `public/`、不要放 `public/_media/`，再用 `/…` 引用）、`data:` 内联内容（先存成文件）、`file:` 等浏览器打不开的协议、相对路径逃出 `src/` 目录、媒体文件不存在或指向的是目录／符号链接、扩展名不在支持列表、相对路径里含 `#` 或 `?`（文件名与目录名都算，本站取不到，改名即可）。报错给出的是**源文件**行号与作者写的原始路径，可以直接照着改。
- RSS 会删掉 `<video>`／`<iframe>`／`<style>`／`class`，公式降级为 TeX 源码。嵌入视频时旁边补一行纯文字链接，否则订阅者看到的是空白。

---

## 项目 `/projects/`

只改 `src/content/projects/data.json` 数组。先读完整份。

必填：`id`（展示名）、`link`（http/https）、`desc`、`category`。`icon` 可选，格式 `i-collection-name`。

新项追加到数组；`category` 沿用已有分类（如 `Agent`、`Personal`、`RAG`），用户指定了再新开。不要为了好看重排无关项。

---

## 关于与拾趣

`/about/` 只渲染 `src/content/about/about.md`。保持作者原文，仅做必要 Markdown 结构，不编造经历或人设。页面标题／说明由 `src/pages/about.mdx` 配合 `PageHeading` 渲染，不由内容 frontmatter 创建按钮。关于内容仅维护这一个 Markdown 文件。

兴趣内容位于 `src/content/interests/`，入口 `/interests/`，子页 `/interests/<id>/`。分类来自该目录顶层的 `.md` / `.mdx` 文件，排除 `intro.md`、`recent.md`；**不固定分类 ID 或数量**。下表是现有分类示例，不是允许列表：

| ID | 内容 |
| :--- | :--- |
| `device` | 日常设备与软件（原 Use） |
| `anime` | 动漫，含国漫 |
| `movie` | 电影，含动画电影 |
| `tv` | 电视剧与综艺 |
| `game` | 游戏 |
| `book` | 书 |
| `kpop` | 喜欢的团体与 idle |

读取同目录样例后修改。frontmatter 的 `title`、`description` 必须为非空字符串，`order` 必须为非负整数；三者供入口、子页和顶部下拉共同使用，`order` 越小越靠前。子页标题直接是分类名，不加“拾趣-”。

### 新增拾趣分类

1. 在 `src/content/interests/` 顶层新建 `<id>.md`（或 `.mdx`），不要放进配图子目录。文件名去掉扩展名就是分类 ID 和路由；已有文件不要擅自改名，以免改变 URL。
2. 填写元数据和正文。例如 `src/content/interests/travel.md`：

   ```md
   ---
   title: 旅行
   description: 路上的记录
   order: 7
   ---

   这里写正文。
   ```

   `7` 只是示例排序值，不是分类数量上限。拾趣没有 `draft` 开关；新增文件会随下一次构建发布，不套用博客草稿规则。
3. 重新构建后自动生成 `/interests/travel/`，并加入拾趣入口和顶部下拉菜单。无需改 `UI.internalNavs`、手写路由或在组件内复制分类列表。
4. 图标可选。用户未指定图标时，先保留纯文字菜单，不补默认图标、空图标容器或占位间距。需要图标时，只在 `src/config.ts` 的 `INTEREST_ICONS` 中以文件名（不含扩展名）为键添加，例如 `travel: 'i-ri-compass-line'`。映射值已自动进入 UnoCSS safelist，不用再手工维护一份。
5. 运行 `pnpm check`、`pnpm build`、`pnpm test:built-restructure`、`pnpm test:built-markdown`；核对新子页、入口和菜单的标题、说明、顺序及图标状态。分类变多或名称变长时，检查窄屏菜单换行和内部滚动，不把自动收录理解为任意数量都保证布局可用。

### 正文与配图

图片放在对应子目录，例如 `src/content/interests/device/`，Markdown 用 `![说明](./device/file.png)`，需要限宽时写 alt 的 `|w300`。图片仍需位于 Markdown 所在目录或子目录内。拾趣内容和图片统一维护在 `src/content/interests/`。

入口页列表下方的说明只改 `intro.md`。首页近期书影游只改 `recent.md`。这两个文件不进分类集合，不要给它们写 `order`，也不要加进顶部菜单。

电影、电视剧、动漫、游戏、书的条目都用卡片。作者可按需填写评分 `score`，与观看／游玩状态无关；没有作者提供的分数时不生成评分：

```md
:::card{title="片名" href="https://zh.wikipedia.org/wiki/片名" score="5" label="电影"}
![片名海报](./movie/poster.jpg)

原有短评或状态。没有作者原文时不要虚构个人评价；仅有链接的条目保留“正在看／准备看／准备玩”等状态。
:::
```

卡片最多一张独立 Markdown 图片作为封面，也可无封面。介绍只写文字及其排版／链接，不放额外图片或嵌入媒体；包括嵌套 Markdown 图片、HTML／静态 MDX 图片在内的违规会使构建失败，不会自动删图。图片需求放到卡片外的正文；代码里字面的 `<img>` 不算图片。

书卡片的作者写在正文，保留原有评分和顺序；没有封面或书评时不编造。

`score` 用作者写的分数，范围 0 到 5，只接受半星步进；非法分数或嵌套卡片会使构建失败。`href` 只接受 http(s)、mailto 和站内路径。有封面时，只放一张独立成段的图片，路径按图片管线写相对路径。连续卡片按容器宽度自动分列，当前版心最多两列；宽屏单张保留空列、与双卡同宽，窄屏填满一行，Markdown 标题将卡片分成不同网格。首页不另设标题或卡片样式。

内容集合 schema／图片验证由 `pnpm check` 和 `pnpm build` 完成；轻量 Python 校验器目前只支持博客与友链，不假装能完整校验兴趣集合。

---

## 友链 `/friends/`

### 卡片

`src/content/friends/data.json`。先读完整份。

必填：`id`、`name`、`link`、`desc`、`category`。`avatar`、`siteLabel`、`order` 有默认。

- `id` 稳定、宜小写 slug；已有的不要改。
- `link` 必须 http/https。没可靠头像就 `avatar: ""`。
- `category` 只允许 `推荐`（单向收藏）或 `双向`（已交换友链），不能把尚未确认的站点标成双向。用户未明确时放推荐；`order` 取全文件最大 order + 1，除非用户指定。
- `desc` 短、具体。不要为美观重排数组；展示顺序是 `order` 再按中文名。

```json
{
  "id": "example-blog",
  "name": "Example Blog",
  "link": "https://example.com/",
  "avatar": "",
  "desc": "一句话介绍。",
  "category": "推荐",
  "siteLabel": "",
  "order": 15
}
```

```bash
python3 blog-content-publisher-skill/scripts/validate_content.py --root . --friends
```

### 申请模板（右下角 friend.txt）

站名、简介、链接、头像 URL 在 `src/components/views/FriendsApplyPanel.astro` 的 `friendInfo`。改「Name: …」只动这里，不要以为改 `SITE.title` 会同步。

---

## 顶栏（所有页面）

`src/config.ts`：

- 页面链接：`UI.internalNavs`（path / title / text）
- 更多菜单中的友链／相册：`MORE_LINKS`。友链保持 `/friends/`，相册链接标为外链并显示 ↗；当前相册指向 `https://photos.wutongyu.site/`。
- 顶栏 GitHub：`UI.socialLinks`，只留本仓库链接。和搜索、主题同属右侧工具组。
- 站点名、描述、域名：`SITE`

个人社交不在 `UI.socialLinks`。首页读取 `AUTHOR_LINKS`，关于正文独立维护作者希望展示的联系方式；若也展示同一账号，再同步该字段。个人 GitHub 指向主页，顶栏 GitHub 指向本仓库。首页名言／作者文案在 `BlogProfile`，品牌文案在 `NavBar`；不要以为修改 `SITE.title` 会同步所有正文文案。

图标类名构建后若空白：首页身份图标由 `AUTHOR_LINKS`、拾趣菜单图标由 `INTEREST_ICONS` 自动加入 safelist；关于页独有图标才需检查 `unocss.config.ts`。关于页图标尺寸在 `public/shell.css` 的 `.about-social__icon`，本 skill 不改 CSS。

---

## 校验与交接

改完先跑 `pnpm check`；文章或友链再跑上面的 `validate_content.py`，它只检查基础元数据，**不完整验证 schema、图片或封面**，并拦住正文里指向 `.md`／`.mdx` 的相对链接；站内链接能否打开、锚点是否有落点由 `pnpm test:built-markdown` 判定。

发文章涉及订阅时，构建后运行 `pnpm test:built-markdown` 核对全文与资源。列表／内容结构或拾趣分类／图标修改运行 `pnpm test:built-restructure`；拾趣正文修改运行 `pnpm test:built-markdown`；分页修改运行 `pnpm test:built-pagination`。构建测试跟随当前配置和内容，不要求保留具体文章、友链名单、拾趣分类数量或观看状态。

文章、关于、拾趣、项目、友链等内容数据不记入 `CHANGELOG.md`。只有这次改动同时改变了网页结构、交互或代码时，才把那部分结构或代码结果写入「未发布」；未发布条目不填写已发布版本或日期。README、SPEC 和指南保持当前状态，不添加开发过程记录。

交接时写清：改了哪一页、文件路径、上线后的路由、博客是否草稿；新增拾趣分类说明图标是否配置，以及构建与菜单／页面校验结果。用户没说部署就不要部署。
