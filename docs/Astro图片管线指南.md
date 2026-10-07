# Astro 图片管线指南

内容图片放在 `src/content/`，由 Astro 图片管线生成 WebP、`srcset`、宽高和懒加载。`public/` 只放站点级资源。本文规定图片的存放方式、引用语法、页面渲染和 RSS 资源规则。视频／音频没有 Markdown 语法，不走这条管线，见[正文 HTML 与媒体 SPEC](./正文%20HTML%20与媒体%20SPEC.md)。

**路径开头决定进不进管线**：

| 开头 | 含义 | 结果 |
| :--- | :--- | :--- |
| `./` | 相对于文章文件 | 进管线：转 WebP、生成 `srcset`、注入宽高；正文图推荐这种写法 |
| `../` | 相对路径向上一层 | 同样进管线；文件存在即可，适合引用上层共享图片 |
| `/` | 站点上已有的文件（作者自己放进 `public/`） | 原样输出，不优化 |
| `http(s)://` | 别人站上的图 | 原样输出，不优化 |

「进不进管线」是 Astro 的内置行为，不靠本项目配置；`astro.config.ts` 的 `image` 只决定转出几档尺寸（`layout: 'constrained'` 产生 `srcset` 与 `sizes`，`domains` 决定哪些远程图也纳入优化）。

## 放哪里

```text
src/content/blogs/
  代码库搜索.md
  代码库搜索-img/                 这一篇的正文图
  _title-images/                  全部文章封面
  算法笔记/
    算法 1（数组、链表）.md
    algo-img/                     组内共享正文图，推荐与文章同目录

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
| 已在 `public/` 的站点图 | `![说明](/avatar.webp)` 或 `<img src="/avatar.webp">`，两者等价，都不进管线 |
| 外链图 | `![说明](https://…)` 与 `<img src="https://…">` 等价，都原样输出、不进管线 |

有封面时同时写 `titleImageAlt`。

## 宽度

`|w330` 只表示 330 像素，不接受百分比。桌面正文列宽 660px，半宽可写 `|w330`；窄屏按实际列宽限制。标记由 `plugins/remark-image-width.ts` 从 alt 剥离，转成图片节点的 `width`。

作者显式指定像素宽度时使用 `|w`，不要只用 CSS 代替标记：管线按节点 `width` 生成 `srcset` 和 `sizes`；只写 CSS 时浏览器仍按原图宽度选图。不写标记时，管线按原图宽度出变体，显示上仍会被列宽限制。源图比目标宽度更宽时才需要标记；图本身已经更窄时不必写。

这不禁止布局容器的响应式 CSS：gallery／figure 在版心、网格单元或窄屏中收窄显示尺寸并保持宽高比，不裁切图片；容器尺寸与作者显式像素宽度是不同职责，布局不改变原有 `|w` 语义。

**不要用 `style="zoom:50%"`**（Typora 拖拽缩放、LeetCode 等站点粘贴时自带）。它按原图的百分比缩放：窄屏上会先被 `max-width:100%` 限制、再缩一半，尺寸不可预测。尺寸一律写进 alt 的 `|w` 标记。

## 正文图片布局

### 网格相册

默认 grid／两列，可以省略属性；三列用 `columns="3"`。`columns` 只接受 `2` 或 `3`，不是字面量 `2|3`。

```md
:::gallery
![第一张](./文章-img/a.png)

![第二张](./文章-img/b.png)
:::

:::gallery{layout="grid" columns="3"}
![第一张|w330](./文章-img/a.png) ![第二张|w330](./文章-img/b.png)

![第三张|w330](./文章-img/c.png)
:::
```

列宽可用 `widths` 控制，它不是图片源宽度，也不替代 `|w`：

```md
:::gallery{widths="1fr 2fr"}
![窄列竖图](./文章-img/a.png)

![宽列横图](./文章-img/b.png)
:::

:::gallery{widths="240px 1fr"}
![第一列](./文章-img/a.png)

![剩余列](./文章-img/b.png)
:::
```

`fr` 是扣除间距后的空间份数；`px` 是列宽目标，窄容器可收窄。支持二／三个正有限数的 `px`／`fr` 值（可小数），不接受 `%`、`auto`、`calc()` 或任意 CSS。省略 columns 时按值数量推导；同时写 columns 时数量必须匹配。`widths="1fr 2fr 1fr"` 为三列 1:2:1。固定列不宜过大，否则剩余列会被挤窄。600px 及以下仍单列。仅想缩小某一张图，用 `|w`；它在原列内居中，不把空位让给邻列。

相册至少一张图，只接受独立 Markdown 直接图片（`![说明](路径)`），可以同段多图，段内除图片外只能有空白。不接受文字说明、列表、引用式图片（`![说明][id]`）、链接包图或 HTML／MDX 图片；说明写在相册外。

### 横滚相册

```md
:::gallery{layout="scroll"}
![第一张](./文章-img/a.png)

![第二张](./文章-img/b.png)
:::
```

scroll 不接受 `columns` 或 `widths`。全部图片静态存在，原生横滚与 scroll snap 无 JS 也可用；启用 JS 后白色圆形箭头位于图片区域左右边缘，首尾隐藏不可用的箭头，图片底部叠加一图一点的页码，深色点表示当前图；只有一张图的相册没有可翻页内容，不生成箭头和页码，只显示完整图片。没有底部工具条、可见滚动条或自动播放；圆点多于分页可见宽度时容器自己滚动到当前点、不移动文章，当前位置跟随实际滚动，区域高度随当前图片变化，混合横竖图不会留下非当前图撑高的底部空白。图片完整保持比例。gallery 只允许 `layout`／`columns`／`widths`，不能加标题、类名等额外属性。

### 图文绕排

```md
:::figure{side="left"}
![图示|w240](./文章-img/detail.png)

这段正文在桌面围绕左侧图片阅读。

后面可以继续写正文块。
:::
```

figure 只允许 `side="left"` 或 `side="right"`，省略属性默认 right。第一段恰好一个直接图片，后面至少一块正文；不把图片塞进正文段，也不先写文字再放图。

gallery／figure 不能嵌套或相互嵌套。非法属性、属性值或结构使 build 失败并带源位置，不静默删图。普通代码块里的写法是示例，不作为实际布局。

所有布局保持 660px 版心、不 breakout，静止时不裁切。600px 及以下 grid 单列，figure 图片在前、正文在后；scroll 仍横滚。图片路径和 Astro 处理规则不变。

## 普通正文图的大图

普通 Markdown 正文图（包括 gallery／figure）启用 JS 后直接点击即可打开原生 dialog，不显示角落放大标识。鼠标悬浮时图片在原边框内轻微放大、移开复原，光标为 `zoom-in`；减少动态偏好下不缩放。键盘聚焦图片后可用 Enter／空格打开。大图光标为 `zoom-out`，点击图片、Esc、遮罩或关闭按钮均可退出，恢复焦点与打开前滚动锁；浅色遮罩灰白、深色暗色。作者用 `[![说明](./文章-img/a.png)](https://example.com/)` 或混合文字 `[![图](./photo.jpg) 文字](url)` 写的图片链接仍跳转，链接外的独立大图入口只在键盘焦点时显示；这种链接包图可用于普通正文，但不满足 gallery／figure 首图的直接图片约束。`titleImage` 的文章头图／文稿列表缩略图和站点头像不属于放大范围；`:::card` 配图属于正文，仍支持放大。

`plugins/remark-image-layouts.ts` 在 `remarkMediaCard` 后生成布局和 image-view 包装；同模块的 `rehypeImageSources` 在 HTML 解析后保持 template 内大图对 Astro 图片 visitor 可见；每个普通 Markdown 正文图旁的 inert template 内有原尺寸 img，仍从图片节点交给 Astro 解析，不是作者手写 `<img>` 或资源 URL。可见图片沿用 `|w`；大图不沿用缩略图宽度，Astro 处理的大图副本只生成一个原尺寸版本，不生成无法使用的响应式变体；打开前不加载、不预加载。浏览器唯一交互属主是 `src/utils/image-interactions.ts`，widget 在 BaseLayout 只接线；关闭／disconnect 负责清理，并释放 `misc.ts` 的共享滚动锁。本地图继续走 Astro；远程图保持既有管线策略，不为放大新增外链抓取。

## 页面与 RSS 渲染

| 位置 | 规则 |
| :--- | :--- |
| 文章封面 `PostHero` | `<Image width={660} priority>`。660 来自 `ARTICLE_COLUMN_WIDTH`，不要改成 `layout="full-width"`，否则 `sizes` 变成 `100vw`。 |
| 列表卡片 `ListItem` | `widths={[274, 548, 822]}`，`sizes="(min-width: 768px) 250px, 100vw"`。有图封面列固定 250px，无图占位列 222px，加宽不进入封面。文稿列表第一项有图时用 `priority`（首页近期笔墨为纯文字），标签页图片保持懒加载，其余 `loading="lazy"`。 |
| 拾趣 `:::card` 封面 | 卡片最多一张独立 Markdown 图片作为封面，使用相对路径引用；右侧介绍不允许额外图片或嵌入媒体，违规由插件报错。插件给封面加 `media-card__cover` 和默认 `width: 240`，不改路径，所以仍进图片管线。显示尺寸由 `prose.css` 固定为 7.25rem × 9.33rem。 |
| `:::card{layout="portrait"}` 封面 | 必须有标题和一张独立 Markdown 封面；`meta` 为可选小字，不接受评分、角标或介绍。沿用 `media-card__cover`，默认资源宽度 480，显式 `|w` 仍优先。CSS 统一 `2:3` 裁切并填满卡片；大图保留完整原图。连续竖卡横滚，不修改全站版心。 |
| 分享图 `RenderPost` | `getImage()` 单独生成 1200px JPEG，再拼成绝对 URL。不要把封面原图直接放进 `og:image`。 |

`titleImage` 用 schema 工厂提供的 `image().optional()`；不要从 `astro:content` 导入独立 `image`。文章页独立 h1 在封面之前，封面内的重复标题、描述、作者行只属于页面，不复制到 RSS。

RSS endpoint 只渲染集合 `Content`，复用相同图片解析；`rss-content.js` 把图片 `src` 转为绝对 URL，去掉 `srcset`／`sizes`／懒加载等站点属性，只留一个 `src`（即与声明宽度匹配的那一档，`width`／`height` 保留）。gallery／figure 和普通正文图沿用既有 sanitizer 去掉 template、样式和控件，剩余全部可见图片与文字按源顺序输出，不复刻布局、不增加 RSS 解析器。feed 中引用的本地资源必须在 `dist/` 存在，`pnpm test:built-markdown` 验证完整文章与资源，不生成另一套图片。


## 硬规则

1. 正文图推荐与文章同目录或放在子目录，使用 `./`；共享图也可用 `../`。两者都按文章文件所在位置解析，只有路径对应的文件不存在时才报 `ImageNotFound`。封面同样支持 `./` 和 `../`。
2. 本地图不要用原生 `<img>`：相对路径既进不了管线也不会被搬运，因此**构建期报错**并提示改用 Markdown 语法。`<img>` 只用于外链图和 `public/` 里的站点图；`data:` 内联图片同样构建期报错。两个例外：`.mdx` 里的手写标签不被这条检查覆盖（由 `pnpm test:built-markdown` 在产物上拦），同一路径已被 Markdown 图片语法引用时手写标签会跟着进管线而不是报错。
3. 外链图（包括 `https://…` 的 `.md` 文件）原样输出、不纳入构建期抓取，Markdown 与 HTML 两种写法等价。
4. `poster` 是例外：它是图片，既不进图片管线也不被镜像，必须自己放进 `public/`（不要放派生的 `public/_media/`）并用 `/…` 引用；写相对路径会构建报错。
5. 代码块里的 `<img>` 是示例文本，不参与图片转换。
6. GIF 走管线，输出保留帧的动画 WebP，HTML 宽高按单帧计算。多档宽度会生成多份动画文件。
7. 产物在 `/_astro/`，文件名带内容哈希，不可手写。内容图片引用相对源文件路径，不手写公共资源路径或构建产物 URL。
8. 源图不降采样。管线减少的是访客下载量，不是仓库体积。

宽度标记写进 URL（`![](./x.webp|w480)`）会被当作文件名的一部分，通常因文件不存在而构建失败；未解析的 Astro 图片占位符由 `pnpm test:built-markdown` 拒绝。标记只能写在 alt 末尾。`pnpm build` 已使用 `--force` 刷新内容缓存，修改插件后直接重新构建即可。

## 资源边界

- 图片路径与文章 URL、slug 各自独立维护。
- 不把图片优化理由用于改 `cssCodeSplit` 或 `inlineStylesheets`。
- RSS 包含正文图片，不额外复制文章封面和页面布局。`scripts/gen-og-cover.mjs` 只生成 `public/og/default.png`。
- 站点图标、头像、字体留在 `public/`。友链头像是远程 URL。

布局验证入口为 `test/remark-image-layouts.test.mjs`（语法、结构、带位置失败）和 `scripts/verify-image-layouts.mjs`（浏览器用户行为、Astro 模板大图资源及打开前无加载，不锁定视觉像素），最终还需 check／test／build／built 检查；这里只规定验收，不表示已通过。

模块归属见 `docs/项目解析.md` §4.8–4.9。作者步骤见 `blog-content-publisher-skill/SKILL.md`。
