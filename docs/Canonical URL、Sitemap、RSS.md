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
- 筛选、分页、追踪参数**不要**写进 canonical。首页 `/?category=技术向` 的官方地址仍是 `/`。
- 全站一个生成点，避免有的页面忘了写。

### 本站怎么做

`src/components/base/Head.astro`：

```astro
const canonicalURL = new URL(Astro.url.pathname, Astro.site)
---
<link rel="canonical" href={canonicalURL} />
```

`Astro.site` 来自配置里的 `site`。用的是 `pathname`，所以查询串不会进 canonical。

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

**没有**用 `@astrojs/rss`。实现是 `src/pages/rss.xml.js`：读已发布文章（生产环境不含 `draft`），自己拼 RSS 2.0。

当前输出：channel 的 title / link / description；item 的 title / link / guid / pubDate / 可选 description。链接用 `SITE.website + /blogs/<id>/`。特殊字符走 `escapeXml`。

名片「订阅 RSS」和 Head 都指向 `/rss.xml`：

```astro
<link
  rel="alternate"
  type="application/rss+xml"
  title="RSS"
  href={withBasePath('/rss.xml')}
/>
```

自己检查：开发服务器打开 `http://127.0.0.1:4321/rss.xml`，应是 XML 而不是 HTML。

### 要不要换成 Astro 官方 `@astrojs/rss`？

**不必换。现在够用。**

个人站订阅按钮需要的是：稳定链接、标题、日期、摘要、草稿不进源。这些已经有。官方包会帮你生成更标准的 XML（例如 `atom:link`、统一转义），还能选附上全文 HTML。那是「更完整」，不是「现在不能用」。

缺的、以后若要补的：

1. `atom:link rel="self"` 指向 `https://www.wutongyu.site/rss.xml`
2. `language`（`zh-CN`）
3. 若希望阅读器内读完全文：`content:encoded`

补这三项可以继续改 `rss.xml.js`，也可以那时再引入 `@astrojs/rss`。在「订阅能用」已经成立时，为完整性换依赖，收益不大。

**不要**在 RSS 里放相对路径 `/blogs/foo/`：Feedly 不知道你的域名。

## 5. 绝对路径和相对路径

| | 例子 | 用在 |
| :--- | :--- | :--- |
| 绝对 | `https://www.wutongyu.site/blogs/foo/` | canonical、sitemap、RSS、给站外的分享 |
| 相对 | `/blogs/foo/` | 站内 `<a>`、图片、`withBasePath` |

`withBasePath` 在 `src/utils/path.ts`，负责接上 `SITE.base`（若部署在子目录）。站内跳转走它；站外协议走 `SITE.website` 或 `Astro.site`。

## 6. Head 里其它和「被搜到」有关的

同一份 `Head.astro` 还输出：

- `<title>`：`页面名 - Wutong Yu`；描述、作者
- JSON-LD：有 `pubDate` 时是 `BlogPosting`，否则 `webPage`（给搜索结果富摘要，不是收录的前提）
- favicon、web manifest
- `public/shell.css`（和 SEO 无关，只是和 Head 一起加载）

文章 `title` 限制 60 字、`description` 写清摘要，是给人看搜索结果用的，比纠结 RSS 字段更影响点击。

## 7. 从小白到改代码的顺序

1. 理解：canonical = 官方地址，sitemap = 给爬虫的目录，RSS = 给读者的更新列表。
2. 记住：站外地址必须是 `https://...`。
3. 本站三处：`Head.astro`（canonical + 挂 sitemap/RSS）、`@astrojs/sitemap`、`src/pages/rss.xml.js`。
4. 改域名只动 `SITE.website`。
5. 想让订阅源带全文或 `atom:link` 时，再改 RSS 或换官方包；不是现在的阻塞项。

```text
SITE.website
      ↓
astro.config.ts 的 site
      ↓
Head.astro              @astrojs/sitemap           rss.xml.js
canonical + 发现链接     sitemap-index.xml          /rss.xml
```
