---
name: blog-content-publisher
description: >
  维护 YuBlog（Wutong-Yu Astro 站）所有可改内容。按页面改：文稿与配图、首页近期笔墨和标签/归档所依赖的文章元数据、
  项目 JSON、关于作者介绍、拾趣七个分类与个人社交、友链 JSON、顶栏导航与顶栏 GitHub、友链申请模板文案。
  触发：发博客、改文章、改封面、改 titleImage、改分类、改关于、改拾趣、改设备、改动漫、改影视、改游戏、改书、改 Kpop、改友链、改项目、改导航、改顶栏 GitHub、改关于页社交、改名片站名。
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
| 设备、动漫、电影、电视剧、游戏、书、Kpop | 拾趣入口和对应子页 | `src/content/interests/<id>.md`，图放对应 `<id>/` |
| 友链增删改、申请模板里的站名/链接 | 友链 | `data.json` 或 `FriendsApplyPanel.astro` 的 `friendInfo` |
| 顶栏页面名、顶栏 GitHub | 全站顶栏 | `src/config.ts` 的 `UI` |
| 个人社交（名字、链接、图标） | 首页与关于 | `config.ts` 的 `AUTHOR_LINKS` 和 `about.md` 同步 |
| 站点标题、域名 | 全站 SEO | `src/config.ts` 的 `SITE` |

本 skill 管理内容与配置；布局、CSS 和交互逻辑按 `docs/项目解析.md` 的权威表处理，不混入一次内容更新。

读 schema，再读同目录一份现成文件当样例。

---

## 首页 / 标签 / 归档 / 文章详情（同一批文章）

完整列表在 `/blogs/`，首页只显示最近五篇已发布文稿。文章还进入标签、归档、`/blogs/<slug>/` 和全文 RSS。生产不含草稿；开发列表和 RSS 可含草稿。首页统计／预览只读已发布文章。`search: false` 不会从 RSS 排除文章，RSS 不携带页面导航、封面卡片或主题样式。

1. 文件名短而稳。子目录会进 slug。**不要擅自改已有文件名**（会改 URL）。用户明确要求改名时可以改，但本站**没有**旧 slug → 新 slug 跳转，旧链接会 404。
2. `title`（最多 60 字）、`pubDate`（`YYYY-MM-DD`）、`category` 必填。
3. 用户没说发布就 `draft: true`。只有明确要上线才 `false` 或删掉。
4. `category` 必填，任意非空字符串；不写或写空会构建失败。导航显示技术、思考、日记，映射权威为 `src/utils/blog-browser.js` 的 `BLOG_CATEGORIES`。技术包含技术向／工具向，思考包含思考向；新文章可写技术、思考、日记。保留已有原值，未知分类不自动归类；新分类若要进入导航需另行调整该映射并验证，不在页面复制判断。没有默认分类。`tags` 是独立话题数组。
5. `description` 短、事实。极短文才 `toc: false`。不进搜索才 `search: false`。
6. 正文图：放到 `src/content/blogs/<短名>-img/`（与文章同级；分组文章放同组目录下，例如 `src/content/blogs/算法笔记/algo-img/`）。Markdown 用**相对路径**：`![说明](./<短名>-img/文件.png)`。

   - 图片必须位于该文章所在目录或其子目录内。正文图片**不能用 `../` 向上越级**，否则构建直接报 `ImageNotFound`。
   - 图片一律走 Astro 图片管线：自动转 WebP、生成 `srcset`、注入宽高、懒加载。**不要手工压缩源图**，也不要再放进 `public/`。
   - 必要时用 alt 后缀声明显示宽度：`![说明|w480](./<短名>-img/文件.png)`。只支持像素，不支持百分比；桌面正文列宽 620px，所以「半宽」可写 `|w310`（窄屏仍受实际列宽限制）。**不要把 `|w480` 写进图片 URL**，构建可能不报错但输出不可见的占位图。不写标记就是原图宽度（超过列宽时按列宽显示）。
   - **不要用原始 `<img>` 标签**：它完全不进管线，浏览器会直接 404。代码块里的示例除外。
   - 远程图片（外链到别人的站）目前仍是原始 `<img>`，不受管线管。

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

```md
---
title: 文章标题
description: 给列表、封面描述和 RSS 的一句摘要。
pubDate: 2026-09-18
category: 技术向
tags: [Astro]
titleImage: ./_title-images/foo.webp
titleImageAlt: 一句能读的描述
---
```

校验：

```bash
python3 blog-content-publisher-skill/scripts/validate_content.py --root . --blog src/content/blogs/slug.md
```

---

## 项目 `/projects/`

只改 `src/content/projects/data.json` 数组。先读完整份。

必填：`id`（展示名）、`link`（http/https）、`desc`、`category`。`icon` 可选，格式 `i-collection-name`。

新项追加到数组；`category` 沿用已有分类（如 `Agent`、`Personal`、`RAG`），用户指定了再新开。不要为了好看重排无关项。

---

## 关于与拾趣

`/about/` 只渲染 `src/content/about/about.md`。保持作者原文，仅做必要 Markdown 结构，不编造经历或人设。页面标题／说明由 `src/pages/about.mdx` 配合 `PageHeading` 渲染，不由内容 frontmatter 创建按钮。关于内容仅维护这一个 Markdown 文件。

兴趣内容位于 `src/content/interests/`，入口 `/interests/`，子页 `/interests/<id>/`。文件和分类：

| ID | 内容 |
| :--- | :--- |
| `device` | 日常设备与软件（原 Use） |
| `anime` | 动漫，含国漫 |
| `movie` | 电影，含动画电影 |
| `tv` | 电视剧与综艺 |
| `game` | 游戏 |
| `book` | 书 |
| `kpop` | 喜欢的团体与 idle |

读取同目录样例后修改。frontmatter 的 `title`、`description`、`order` 供入口、子页和顶部下拉共同使用。子页标题直接是分类名，不加“拾趣-”。新增文件会成为静态页面，但增加新导航分类还需更新 `config.ts` 的 `INTEREST_ICONS`；不要为内容修改重复实现导航。

图片放在对应子目录，例如 `src/content/interests/device/`，Markdown 用 `![说明](./device/file.png)`，需要限宽时写 alt 的 `|w300`。图片仍需位于 Markdown 所在目录或子目录内。拾趣内容和图片统一维护在 `src/content/interests/`。

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
- 更多菜单中的友链／相册：`MORE_LINKS`。友链保持 `/friends/`，相册链接标为外链并显示 ↗；当前相册是占位地址。
- 顶栏 GitHub：`UI.socialLinks`，只留本仓库链接。和搜索、主题同属右侧工具组。
- 站点名、描述、域名：`SITE`

个人社交不在 `UI.socialLinks`。首页读取 `AUTHOR_LINKS`，关于正文独立维护作者希望展示的联系方式；若也展示同一账号，再同步该字段。个人 GitHub 指向主页，顶栏 GitHub 指向本仓库。首页名言／作者文案在 `BlogProfile`，品牌文案在 `NavBar`；不要以为修改 `SITE.title` 会同步所有正文文案。

图标类名构建后若空白：首页身份图标由 `AUTHOR_LINKS` 自动加入 safelist；关于页独有图标才需检查 `unocss.config.ts`。关于页图标尺寸在 `public/shell.css` 的 `.about-social__icon`，本 skill 不改 CSS。

---

## 校验与交接

改完先跑 `pnpm check`；文章或友链再跑上面的 `validate_content.py`，它只检查基础元数据，**不完整验证 schema、图片或封面**，最终仍以 Astro 检查／构建为准。新增文章、修改正文图或封面时必须跑 `pnpm build`：Astro 的 schema 和图片管线才是路径解析及 `titleImageAlt` 的权威校验。含 `|w` 的图片还要人工核对标记写在 alt 而不是 URL 中（构建可能静默产出占位图）。构建失败只修这次内容，或说明是原有问题。

发文章涉及订阅时，构建后运行 `pnpm test:built-markdown` 核对全文与资源。列表／内容结构修改运行 `pnpm test:built-restructure`；分页修改运行 `pnpm test:built-pagination`。

将用户可见的内容发布、站点信息或维护规则变更记入 `CHANGELOG.md` 的「未发布」，合并为最终结果；未发布内容不填写已发布版本或日期。README、SPEC 和指南保持当前状态，不添加开发过程记录。

交接时写清：改了哪一页、文件路径、上线后的路由、是否草稿。用户没说部署就不要部署。
