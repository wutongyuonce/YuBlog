# Astro 图片管线指南

内容图片放在 `src/content/`，由 Astro 图片管线生成 WebP、`srcset`、宽高和懒加载。`public/` 只放站点级资源。本文规定图片的存放方式、引用语法、页面渲染和 RSS 资源规则。

## 放哪里

```text
src/content/blogs/
  代码库搜索.md
  代码库搜索-img/                 这一篇的正文图
  _title-images/                  全部文章封面
  算法笔记/
    算法 1（数组、链表）.md
    algo-img/                     组内共享正文图，必须在文章目录内

src/content/interests/
  <id>.md                        分类正文，也支持 <id>.mdx
  <id>/                          该分类的配图目录，与正文文件同级
```

拾趣分类不限于已有列表；例如新增 `travel.md` 时，配图放在 `travel/`，正文写 `![说明](./travel/file.png)`，重新构建后自动生成页面、入口和菜单。`intro.md`、`recent.md` 不作为分类。菜单图标不是正文图片，只按需在 `src/config.ts` 的 `INTEREST_ICONS` 配置；没有图标时显示纯文字，不需要创建图标文件或占位。

## 怎么写

| 场景 | 写法 |
| :--- | :--- |
| 正文图 | `![说明](./代码库搜索-img/file.png)` |
| 组内共享图 | `![说明](./algo-img/file.png)` |
| 限制宽度 | `![说明\|w310](./图.png)` |
| 顶层文章封面 | `titleImage: ./_title-images/foo.webp` |
| 组内文章封面 | `titleImage: ../_title-images/foo.webp` |
| 拾趣配图 | `![说明\|w300](./device/file.png)` |

有封面时同时写 `titleImageAlt`。

## 宽度

`|w330` 只表示 330 像素，不接受百分比。桌面正文列宽 660px，半宽可写 `|w330`；窄屏按实际列宽限制。标记由 `plugins/remark-image-width.ts` 从 alt 剥离，转成图片节点的 `width`。

必须用 `width`，不要用 CSS 限宽。管线按 `width` 生成 `srcset` 和 `sizes`；只写 CSS 时浏览器仍按原图宽度选图。不写标记时，管线按原图宽度出变体，显示上仍会被列宽限制。源图比目标宽度更宽时才需要标记；图本身已经更窄时不必写。

## 页面与 RSS 渲染

| 位置 | 规则 |
| :--- | :--- |
| 文章封面 `PostHero` | `<Image width={660} priority>`。660 来自 `ARTICLE_COLUMN_WIDTH`，不要改成 `layout="full-width"`，否则 `sizes` 变成 `100vw`。 |
| 列表卡片 `ListItem` | `widths={[274, 548, 822]}`，`sizes="(min-width: 768px) 250px, 100vw"`。有图封面列固定 250px，无图占位列 222px，加宽不进入封面。文稿列表第一项有图时用 `priority`（首页近期笔墨为纯文字），标签页图片保持懒加载，其余 `loading="lazy"`。 |
| 拾趣 `:::card` 封面 | 卡片内第一张相对路径图片。插件只给图片加 `media-card__cover` 和默认 `width: 240`，不改路径，所以仍进图片管线。显示尺寸由 `prose.css` 固定为 7.25rem × 9.33rem。 |
| 分享图 `RenderPost` | `getImage()` 单独生成 1200px JPEG，再拼成绝对 URL。不要把封面原图直接放进 `og:image`。 |

`titleImage` 用 schema 工厂提供的 `image().optional()`；不要从 `astro:content` 导入独立 `image`。文章页独立 h1 在封面之前，封面内的重复标题、描述、作者行只属于页面，不复制到 RSS。

RSS endpoint 只渲染集合 `Content`，复用相同图片解析；`rss-content.js` 把图片 `src` 转为绝对 URL，去掉 `srcset`／`sizes`／懒加载等站点属性。feed 中引用的本地资源必须在 `dist/` 存在，`pnpm test:built-markdown` 验证完整文章与资源，不生成另一套图片。

## 硬规则

1. 正文图必须在该文章所在目录或其子目录内，路径以 `./` 开头。`../` 会让构建报 `ImageNotFound`。封面可以 `./` 或 `../`。
2. 原始 `<img>` 不进管线。本地图不要写 HTML 标签。
3. 远程图保持原始 `<img>`。外链图片不纳入构建期抓取。
4. 代码块里的 `<img>` 是示例文本，不参与图片转换。
5. GIF 走管线，输出保留帧的动画 WebP，HTML 宽高按单帧计算。多档宽度会生成多份动画文件。
6. 产物在 `/_astro/`，文件名带内容哈希，不可手写。内容图片引用相对源文件路径，不手写公共资源路径或构建产物 URL。
7. 源图不降采样。管线减少的是访客下载量，不是仓库体积。

宽度标记若写进 URL（`![](./x.webp|w480)`），构建不报错，产物会留下不可见的 `<img __ASTRO_IMAGE_="...">`。改 remark / rehype 插件后要删 `node_modules/.astro/`，否则会构建出缓存的旧 HTML。

## 资源边界

- 图片路径与文章 URL、slug 各自独立维护。
- 不把图片优化理由用于改 `cssCodeSplit` 或 `inlineStylesheets`。
- RSS 包含正文图片，不额外复制文章封面和页面布局。`scripts/gen-og-cover.mjs` 只生成 `public/og/default.png`。
- 站点图标、头像、字体留在 `public/`。友链头像是远程 URL。

模块归属见 `docs/项目解析.md` §4.8。作者步骤见 `blog-content-publisher-skill/SKILL.md`。
