# 博客 SEO 入门：Canonical、Sitemap、RSS

面向没做过站点收录的读者。先讲每个东西解决什么问题，再讲一般怎么用，最后落到本仓库怎么做。

搜索引擎和订阅器都**不会猜**你的域名。凡是要给站外看的地址，都要用带 `https://` 的绝对路径。本站的根地址只在一处写：`src/config.ts` 的 `SITE.website`（`https://www.wutongyu.site/`），`astro.config.ts` 的 `site` 读的就是它。

## 1. 为什么同一篇文章会变成「好几篇」

人眼看来这些是同一页：

```text
https://www.wutongyu.site/blogs/foo/
https://www.wutongyu.site/blogs/foo
https://www.wutongyu.site/blogs/foo/?utm_source=twitter
https://www.wutongyu.site/blogs/foo/?page=2
```

爬虫默认按 URL 字符串区分。不声明官方地址，权重会散掉，还可能被当成重复内容。

另外两件站外的事：

- 搜索引擎要一份「全站有哪些页」的清单，否则只能顺着链接慢慢爬。
- 读者想用 Feedly 之类订阅「有新文章就告诉我」，需要一份机器可读的更新列表。

对应三件套：**Canonical**、**Sitemap**、**RSS**。

## 2. Canonical：这一页的身份证

**一句话**：在 HTML 里告诉搜索引擎，「请把收录算到这个 URL 上」。

```html
<link rel="canonical" href="https://www.wutongyu.site/blogs/foo/" />
```

它不是重定向，地址栏不会变。只是声明。

### 设计时要想清楚的

- 官方地址要稳定：本站文章永远是 `/blogs/<slug>/`，带尾斜杠。
- 筛选、分页、追踪参数**不要**写进 canonical。文稿 `/blogs/?category=技术向`、`/blogs/#tech` 和新增分类 `/blogs/#旅行` 的官方地址仍是 `/blogs/`；首页兼容筛选书签在客户端转到文稿页。
- 全站一个生成点，避免有的页面忘了写。

### 本站怎么做

`src/components/base/Head.astro`：

```astro
const canonicalURL = new URL(Astro.url.pathname, Astro.site)
---
<link rel="canonical" href={canonicalURL} />
```

`Astro.site` 来自配置里的 `site`。用的是 `pathname`，所以查询串和 URL 片段都不会进 canonical。

分类链接里的 `#tech`／`#旅行` 是 URL 片段，不是新页面，也不是哈希计算结果。浏览器只向服务器请求 `/blogs/`；页面脚本读取 `#` 后的值，从 HTML 已有的全部文章中筛选，再分页。站内分类入口统一生成片段链接；旧 `?category=` 仍可解析，并在启用脚本后转成等价片段，保留原筛选含义、标签和页码。片段和 query 读取后进入同一套筛选逻辑。拾趣的 `/interests/movie/` 则有独立内容和静态 HTML，因此使用路径路由。

这些分类筛选状态不新增 sitemap 条目；文章 `/blogs/<slug>/` 和拾趣 `/interests/<id>/` 等独立页面由构建路由进入 sitemap。在 `src/content/interests/` 顶层新增满足 schema 的 `.md` / `.mdx` 分类文件后，重新构建会自动生成分类页及其菜单入口、canonical 和 sitemap 条目，无需手写路由或 sitemap；`intro.md`、`recent.md` 不生成分类页。图标可选，不影响路由或收录；拾趣不进入只订阅博客集合的 RSS。

自己检查：打开任意文章 → 查看源代码 → 搜 `rel="canonical"`，应看到完整 `https://www.wutongyu.site/...`。

## 3. Sitemap：给爬虫的目录

**一句话**：一个 XML 文件，列出希望被收录的 URL。

长这样：

```xml
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://www.wutongyu.site/blogs/foo/</loc>
    <lastmod>2026-09-16</lastmod>
  </url>
</urlset>
```

页面多了会拆成 `sitemap-0.xml`、`sitemap-1.xml`，再用 `sitemap-index.xml` 当总目录。

### 设计要点

- `<loc>` 必须是绝对 URL。
- 只放要被搜到的页。草稿、跳转壳子、纯工具页可以不进。
- 站点根 `site` 必须配，插件才能拼出域名。

### 本站怎么做

用官方集成 `@astrojs/sitemap`，构建时生成，不手写 XML。

```ts
// astro.config.ts
import sitemap from '@astrojs/sitemap'

export default defineConfig({
  site: SITE.website,
  integrations: [sitemap(), /* … */],
})
```

Head 里挂上总目录：

```astro
<link rel="sitemap" href={withBasePath('/sitemap-index.xml')} />
```

本地看：`pnpm build` 后打开 `dist/sitemap-index.xml`。

向搜索引擎提交（可选）：Google Search Console / 必应站长工具里填

`https://www.wutongyu.site/sitemap-index.xml`

## 4. RSS：给读者的订阅源

**一句话**：一份按时间倒序的文章列表，订阅器定时来拉。你发文，对方时间线出现新条目。

和 sitemap 的差别：sitemap 给爬虫「有这些页」；RSS 给读者「最近更新了什么」。

最小能用的一条：

```xml
<item>
  <title>标题</title>
  <link>https://www.wutongyu.site/blogs/foo/</link>
  <guid>https://www.wutongyu.site/blogs/foo/</guid>
  <pubDate>Tue, 16 Sep 2026 00:00:00 GMT</pubDate>
  <description>摘要</description>
</item>
```

`guid` 应长期稳定，通常就用文章永久链接。`pubDate` 用 RFC 1123（`Date#toUTCString()`）。

### 订阅器还认什么（完整度）

| 字段 | 有了会怎样 | 没有会怎样 |
| :--- | :--- | :--- |
| title / link / guid / pubDate | 能订阅、能去重 | 源基本不可用 |
| description | 时间线能看到摘要 | 只有标题 |
| `atom:link rel="self"` | 阅读器知道源自己的地址 | 多数仍能用 |
| language / lastBuildDate | 更规范 | 一般无所谓 |
| `content:encoded` 全文 | 可在阅读器里读完 | 要点进站点 |
| author | 多作者站有用 | 个人站可省 |

### 本站怎么做

使用官方 `@astrojs/rss` 输出 RSS 2.0 全文源，入口是 `src/pages/rss.xml.js`。使用共享集合工具完成生产草稿过滤和日期排序，每篇保留标题、日期、摘要、GUID、链接和 `content:encoded`。

正文通过 Astro 的 `render(post)` 和 Container 渲染，复用现有 Markdown 插件与图片管线；`src/utils/rss-content.js` 将结果转换成阅读器可用的 HTML：图片和链接改成绝对地址，代码保留换行，公式以 LaTeX 源码显示，去掉脚本、样式和交互控件。文末保留「阅读原文」。全文不截断、不限制篇数，也不额外复制封面。页面布局、文稿分类、拾趣、友链独立于 feed 范围：只有博客集合进入 RSS，生产排除草稿；`search: false` 不等于不发布，未标为草稿的文章仍进入源。页面封面卡片、作者头像行、目录和主题不会进入正文 HTML。

新增或修改文章的分类无需修改 RSS：`/rss.xml` 继续订阅全部已发布博客，不按文稿页的片段或 query 筛选；不输出分类元数据，也不提供独立分类订阅源。分类分组、入口及徽标配色不会修改文章永久 URL、GUID、发布日期或正文。新分类中的已发布文章会随重新构建进入同一个源。

`src/utils/rss-feed.js` 负责官方包的字段装配、稳定 GUID、语言和 Atom self 链接。文章配置 redirect 时，条目 link 可以指向外站，但 GUID 和正文地址基准仍是本站文章 URL。任意文章转换失败会使生成失败，不会静默降回摘要。

首页「订阅 RSS」和 Head 都指向 `/rss.xml`：

```astro
<link
  rel="alternate"
  type="application/rss+xml"
  title="RSS"
  href={withBasePath('/rss.xml')}
/>
```

自己检查：开发服务器打开 `http://127.0.0.1:4321/rss.xml`，应是 XML 而不是 HTML。

### 官方包负责什么

`@astrojs/rss` 负责 XML 序列化，正文渲染和图片地址适配由本站负责。它不是在 Astro integrations 中开启就能自动生成全文的插件。具体行为、模块边界和验收要求见 [RSS 全文支持 SPEC](./RSS%20全文支持%20SPEC.md)。

全文表示正文信息完整，不代表阅读器复制博客主题或执行客户端组件。当前覆盖仓库的 Markdown 内容；Container 是实验 API，升级 Astro 时必须重跑产物测试。图片使用部署资源，离线缓存由阅读器决定。

## 5. 绝对路径和相对路径

| | 例子 | 用在 |
| :--- | :--- | :--- |
| 绝对 | `https://www.wutongyu.site/blogs/foo/` | canonical、sitemap、RSS、给站外的分享、`og:image` |
| 相对 | `/blogs/foo/` | 站内 `<a>`、`withBasePath` |
| 内容图片 | `./图片目录/文件.png`（源文件）→ `/_astro/<hash>.webp`（产物） | Markdown / frontmatter 写相对路径，产物地址由 Astro 图片管线生成，不可手写 |

`withBasePath` 在 `src/utils/path.ts`，负责接上 `SITE.base`（若部署在子目录）。站内跳转走它；站外协议走 `SITE.website` 或 `Astro.site`。文章页的 `og:image` 是运行时由图片管线生成后再拼成绝对 URL 的（见 `RenderPost.astro`）。

## 6. Head 里其它和「被搜到」有关的

同一份 `Head.astro` 还输出：

- `<title>`：`页面名 - Wutong Yu`；描述、作者
- JSON-LD：有 `pubDate` 时是 `BlogPosting`，否则 `WebPage`（给搜索结果富摘要，不是收录的前提）
- favicon、web manifest
- `public/shell.css`（和 SEO 无关，只是和 Head 一起加载）

文章 `title` 限制 60 字、`description` 写清摘要，是给人看搜索结果用的，比纠结 RSS 字段更影响点击。

## 7. 从小白到改代码的顺序

1. 理解：canonical = 官方地址，sitemap = 给爬虫的目录，RSS = 给读者的更新列表。
2. 记住：站外地址必须是 `https://...`。
3. 本站三处：`Head.astro`（canonical + 挂 sitemap/RSS）、`@astrojs/sitemap`、`src/pages/rss.xml.js`。
4. 改域名只动 `SITE.website`。
5. `pnpm build` 后运行 `pnpm test:built-markdown`，核对全文、稳定 GUID、代码和图片产物。

```text
SITE.website
      ↓
astro.config.ts 的 site
      ↓
Head.astro              @astrojs/sitemap           rss.xml.js
canonical + 发现链接     sitemap-index.xml          /rss.xml
```
