---
name: blog-content-publisher
description: >
  维护 YuBlog（Wutong-Yu Astro 站）所有可改内容。按页面改：首页文章与配图、标签/归档所依赖的文章元数据、
  项目 JSON、关于页 intro/Use/Hobby/Soul、友链 JSON、顶栏导航与社交、友链申请模板文案。
  触发：发博客、改文章、改封面、改 titleImage、改分类、改关于、改 Use、改 Hobby、改友链、改项目、改导航、改社交链接、改名片站名。
  不要用来做布局/CSS 重构；那些看 docs/项目解析.md。
---

# YuBlog 内容维护

按**页面**改用户能看见的文案和数据。契约以 `src/content/schema.ts` 为准，旧示例和它冲突时听 schema。

先确认仓库根有 `package.json`。不碰无关的工作区改动。不要 commit / push / 部署，除非用户明确说。

## 先判断改哪一页

| 用户在说 | 页面 | 改哪里 |
| :--- | :--- | :--- |
| 发文章、改正文、改封面/标题图、改分类标签、草稿 | 首页列表 + 标签 + 归档 + 详情 + RSS | 文：`src/content/blogs/`；正文图：`public/blogs/<名>-img/`；封面：`public/blog-title-images/` + `titleImage` |
| 改标签展示（标签名来自文章） | 标签页 | 改各篇 `tags:`，不要手写标签页数组 |
| 归档多一条/少一条 | 归档 | 同上，靠 `pubDate` |
| 项目卡片 | 项目 | `src/content/projects/data.json` |
| 介绍、Use、Hobby、Soul、关于页加一栏 | 关于 `/about/` | `src/content/about/` |
| 友链增删改、申请模板里的站名/链接 | 友链 | `data.json` 或 `FriendsApplyPanel.astro` 的 `friendInfo` |
| 顶栏页面名、社交图标 | 全站顶栏 | `src/config.ts` 的 `UI` |
| 站点标题、域名 | 全站 SEO | `src/config.ts` 的 `SITE` |

布局、右栏结构、`shell.css` 不是本 skill。用户要改「看起来的结构」时停，指向 `docs/项目解析.md`。

读 schema，再读同目录一份现成文件当样例。

---

## 首页 / 标签 / 归档 / 文章详情（同一批文章）

文章出现在首页、标签、归档、`/blogs/<slug>/`、RSS。改一篇，四处一起变。没有 `/blogs/` 列表页；旧索引已删除，该地址 404。

1. 文件名短而稳。子目录会进 slug。**不要擅自改已有文件名**（会改 URL）。用户明确要求改名时可以改，但本站**没有**旧 slug → 新 slug 跳转，旧链接会 404。
2. `title`（最多 60 字）、`pubDate`（`YYYY-MM-DD`）、`category` 必填。
3. 用户没说发布就 `draft: true`。只有明确要上线才 `false` 或删掉。
4. `category` 必填，任意非空字符串；不写或写空会构建失败。现有值有 `技术向`、`工具向`、`思考向`，沿用已有分类，用户指定了再新开。没有默认分类。`tags` 是独立话题数组。
5. `description` 短、事实。极短文才 `toc: false`。不进搜索才 `search: false`。
6. 正文图：放到 `public/blogs/<短名>-img/`，Markdown 用 `/blogs/<短名>-img/文件.png`。现有目录：`Astro-img`、`MCP-img`、`RAG-img`、`agent-skill-img`、`deploy-img`、`harness-engineering-img`、`jianquan-img`、`juc-img`、`kv-prefix-prompt-semantic-caching-img`、`memu-img`、`prompt-caching-img`、`代码库搜索-img`、`多模态Agent-img`。新文章新建 `public/blogs/<短名>-img/`，不要写回 `public/` 根目录。
7. 列表和详情标题块的封面**只有一条路**：文件放 `public/blog-title-images/`，frontmatter 用 `titleImage` / `titleImageAlt`。

   ```yaml
   titleImage: /blog-title-images/night-lantern.webp
   titleImageAlt: 夜晚提灯的动漫场景
   ```

   - **不要写 `cover` / `coverAlt`**，字段已删除；列表也不会再 fallback。
   - 有 `titleImage` 必须有 `titleImageAlt`。没封面就两行都别写，列表对应位置空着。
   - 路径必须是 `/blog-title-images/<文件>`，不要 `..`、空格、查询串。文件名短、ASCII，如 `night-lantern.webp`。
   - 优先 WebP，宽不必超过 1600px。用户丢来超大 jpg 时先压再引用，不要原样提交 4K/8K。
   - 不要把同一张封面再当正文第一张，除非正文真的还要用。
8. 正文不要再写一个 `# 标题`，frontmatter 的 `title` 已经是页标题。从 `##` 开始。
9. 不编造引用、日期、数据。

```md
---
title: 文章标题
description: 给列表和 RSS 的一句摘要。
pubDate: 2026-09-18
category: 技术向
tags: [Astro]
titleImage: /blog-title-images/foo.webp
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

## 关于 `/about/`

全部在 `src/content/about/`。

| 文件 | 页面上的位置 |
| :--- | :--- |
| `intro.md` | 顶部介绍。必须 `tab: false` |
| `use.md` | 按钮 Use |
| `hobby.md` | 按钮 Hobby |
| `soul.md` | 按钮 Soul |

frontmatter：`title`（按钮字）、`order`（越小越靠前）、`tab`（介绍为 false）。

加一栏：同目录新 `.md`，写 `title`、`order`，不要改 `AboutView.astro`。

配图放 `public/about/<标签>/`，不要放在 `src/content/about/` 旁边：

```text
public/about/intro/
public/about/use/
public/about/hobby/
public/about/soul/
```

Markdown 用站点根路径：`![说明](/about/hobby/foo.jpg)`。

用户给原文就照写，只做必要的 Markdown 结构（标题层级、列表）。不扩写、不改人设。

---

## 友链 `/friends/`

### 卡片

`src/content/friends/data.json`。先读完整份。

必填：`id`、`name`、`link`、`desc`、`category`。`avatar`、`siteLabel`、`order` 有默认。

- `id` 稳定、宜小写 slug；已有的不要改。
- `link` 必须 http/https。没可靠头像就 `avatar: ""`。
- 新项默认 `category: "Friends"`，`order` 取全文件最大 order + 1，除非用户指定。
- `desc` 短、具体。不要为美观重排数组；展示顺序是 `order` 再按中文名。

```json
{
  "id": "example-blog",
  "name": "Example Blog",
  "link": "https://example.com/",
  "avatar": "",
  "desc": "一句话介绍。",
  "category": "Friends",
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
- 社交：`UI.socialLinks`（link / title / icon）
- 站点名、描述、域名：`SITE`

新社交图标若顶栏空白：把 `i-simple-icons-xxx` 加进 `unocss.config.ts` 的 `safelist`。

---

## 校验与交接

改完后按改动跑：

```bash
pnpm check
```

文章或友链再跑上面的 `validate_content.py`。能跑 `pnpm build` 更好，失败只修这次内容，或说明是原有问题。

交接时写清：改了哪一页、文件路径、上线后的路由、是否草稿。用户没说部署就不要部署。
