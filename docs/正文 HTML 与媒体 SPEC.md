# 正文 HTML 与媒体 SPEC

在 Typora 里写的东西，站上要照原样渲染；RSS 要能正常生成。本文规定手写 HTML 的加工边界、本地视频／音频的服务方式、链接与锚点契约和验收口径。

- 图片的存放、引用语法、页面渲染与 RSS 资源规则见 [`Astro图片管线指南.md`](./Astro图片管线指南.md)。
- RSS 的清洗与降级白名单见 [`RSS 全文支持 SPEC.md`](./RSS%20全文支持%20SPEC.md)。
- 模块归属见 [`项目解析.md`](./项目解析.md)。作者步骤见 [`SKILL.md`](../blog-content-publisher-skill/SKILL.md)。

## 1. 范围与设计取舍

正文管线分三层，每层只有一个权威：

| 层 | 权威职责 |
| --- | --- |
| remark（MDAST） | Markdown 语法解析、图片路径登记给 Astro 图片管线 |
| rehype（HAST） | HTML 加工：标题 id／锚点／TOC、表格滚动容器、提示框、公式、媒体引用改写 |
| 资源与服务 | `public/` 静态文件、Astro 图片管线、RSS 白名单 |

核心约束只有一句：**未被解析的原始 HTML 在 HAST 里不是元素而是一串文本，所有 rehype 插件都 `visit` 不到它。** 所以 `rehype-raw` 必须排在自定义 rehype 插件之前；排在最后（Astro 内部管线默认位置）会让手写 `<h2>`／`<table>` 绕过全部加工。

图片与视频互不重叠：图片有 Markdown 语法，归 Astro 图片管线；视频／音频没有，归本站媒体层。

## 2. 手写 HTML 与 Markdown 同待遇

`<div>`、`<span>`、`<br>`、`<details>`、`<a id="…">`、`<style>` 原样透传。会被插件加工的元素与 Markdown 写法获得同样结果：

| 手写 | 结果 |
| --- | --- |
| `<h2>…</h2>` | 拿到 id、`#` 锚点链接，进入 TOC |
| `<table>…</table>` | 拿到横向滚动容器 |
| `<blockquote>` 里的 `[!NOTE]` | 按提示框渲染 |
| `<video>`／`<audio>`／`<source>` 的相对路径 | 改写成站内可服务地址（见 §3） |
| 指向本地媒体文件的 `<a href>` | 和 `src` 一起改写，视频旁的降级链接才能用同一个相对路径 |

CSS 三种写法都生效：`style="…"`、`<style>` 块、`class` + UnoCSS 工具类（`unocss.config.ts` 已扫描 `src/content/**/*.md`）。`<style>` 块是**页面全局**的，不做作用域隔离，会影响同页顶栏、目录和侧栏；需要局部样式时用带前缀的类名或工具类。

## 3. 本地视频与音频

外链平台用 `<iframe>`（B 站、YouTube），原样透传。

本地文件放文章旁边或子目录，用相对路径引用：`<video src="./demo.mp4">`。Typora 按 Markdown 文件所在目录解析，站点把同一路径改写成 `/_media/…`，两边指向同一个物理文件。

**唯一映射规则**（`plugins/media-paths.ts`）：

```text
src/<rel>  →  public/_media/<rel>  →  站点 URL /_media/<rel>
```

`public/_media/` 由 `plugins/astro-media-sync.ts` 在 `astro:config:setup` 从 `src/` 镜像得到，早于 Astro 拷贝 `public/`，因此产物一定完整。镜像按 mtime + 大小跳过未变文件，并清理源文件已删除的陈旧产物；该目录是派生产物，已加入 `.gitignore`。

**镜像范围只有视频／音频扩展名**（`MEDIA_EXTENSIONS`）。这是安全的：视频／音频没有 Markdown 语法，凡放在 `src/` 下的都只可能被 HTML 引用，不存在「已被图片管线处理过、再镜像一份」的重复。图片不镜像——源图已在 `dist/_astro/` 里有一份（62MB），再镜像 144MB 源图会让产物翻倍。

指向本地媒体文件的 `<a href>`（例如视频旁的降级链接）与 `src` 用同一套规则改写，所以两边可以写同一个相对路径。指向 `.md` 等非媒体文件的相对链接不归这一层管（见 §4）。

URL 前缀跟随 `SITE.base`，子路径部署时不会请求到错误位置。

## 4. 链接与锚点

手写空锚点 `<a id="27"></a>` **不得清理**：同页 `](#15)` 与跨文章 `/blogs/…/#27` 两类跳转都以它们为目标，清理会静默打断跳转。手写短锚点比依赖标题自动 slug 更稳——标题含 `【🔥中】`、emoji 和中文标点时，自动 slug 又长又容易随文案漂移。

跳转到另一篇文章必须写**站内 URL**：`[27移除元素](/blogs/算法笔记/算法-1数组链表/#27)`。写 `./另一个文件.md#锚点` 在 Typora 里能点，但在站上会解析成 `<当前文章 URL>/另一个文件.md`——该文件不在产物里，点下去是 404，**而构建不报错**。两种写法不能兼得：Typora 要相对文件名，站点要 URL。

改写前要确认目标文章存在且已发布（不是 `draft: true`）；目标不在站点上时删掉链接、保留可见文字，并向用户说明，不要猜 URL。

`href="#…"` 的片段是百分号编码的，而 `id` 不是，比较前必须解码。

## 5. 模块权威和调用边界

| 模块 | 唯一职责 |
| --- | --- |
| `plugins/index.ts` | 管线装配（顺序即规则）。`rehypeRaw` 必须是 `rehypePlugins[0]`，`rehypeMediaAssets` 紧随其后 |
| `plugins/media-paths.ts` | 媒体引用规则：扩展名、`src/` → `public/_media/` 映射、把 `src` 分成 external／rooted／inline／local／outside。纯函数，无副作用 |
| `plugins/rehype-media-assets.ts` | 按元素分派改写与报错策略；不做路径推导 |
| `plugins/astro-media-sync.ts` | 把 `src/` 视频／音频落盘到 `public/_media/`；不做 URL 推导 |

镜像目标与 URL 都由 `media-paths.ts` 推导，另两个模块不各自推断映射。

## 6. 失败与资源语义

无法在站上服务的引用在**渲染期**失败，报出相对文件路径、行号和原始值。共七类：

- `data:` 内联内容（协议名大小写不敏感）
- 其它浏览器打不开的协议（`file:`、`blob:` 等）
- 原生 `<img>` 的相对路径（图片请用 Markdown 语法）
- `<video poster>` 的相对路径（poster 是图片，不在镜像范围）
- 逃出 `src/` 目录的相对路径
- 扩展名不在 `MEDIA_EXTENSIONS` 内
- 指向的不是可镜像的文件：文件缺失、目录、符号链接（枚举不进入链接，校验就不放行，两侧共用一条判据）

含 `#`、`?`、`%` 的文件名无法被引用：这些字符在 `src` 里属于 URL 语法而不是文件名（`#t=10` 是媒体片段，改写后会原样保留），校验会报「不是可镜像的文件」。把它们改名后即可引用。

单篇文章渲染失败会让整次构建失败。Astro 的内容加载器会捕获渲染异常并继续，把该条以空正文存进集合，因此**光靠加载器不会让构建失败**：博客靠写作热力图间接失败，拾趣与关于没有这样的调用方。所以构建末尾有一道校验（`scripts/check-content-rendered.mjs`，串在 `postbuild` 里），发现带正文容器的页面渲染为空就报错并指向 `[glob-loader]`——部署只跑 `pnpm build`，不跑测试，这道校验必须留在构建链里。

`<img>` 的相对路径选择报错而不是改写，是因为改写只能原样服务、拿不到压缩和 `srcset`，而图片有更好的写法。判据是 `file.data.astro.localImagePaths`／`remoteImagePaths`。

镜像假定只有一个写入者（一次构建，或一个 dev 服务器）。同时跑两个构建或构建与 dev 共用同一个 `public/_media/` 不在支持范围：删除陈旧产物用 `force` 容错，但覆盖不是原子发布，也不做跨进程加锁。

`srcset` 不处理：它没有单一 URL 可改写，相对路径会静默 404。响应式图片用 Markdown 语法或绝对 URL。

## 7. 非目标

- **不让原生 `<img>` 走 Astro 图片管线。** 要打通得在 remark 阶段解析 html 节点、伪造 mdast image 节点，还会丢掉 `style="zoom:50%"` 这类粘贴痕迹；而 Typora 拖拽／粘贴产出的本来就是 Markdown 图片语法。
- **不给 `<style>` 做自动作用域。** 需要引入 CSS 解析器改写选择器；用写作约定（前缀类名或工具类）代替。
- **不镜像图片。** 见 §3，会让产物翻倍。
- **不放宽 RSS 白名单。** 订阅器不执行嵌入，保留 `video`／`iframe` 会给阅读器塞不确定行为。因此视频嵌入要在紧邻处补一行纯文字链接。
- **不清理手写空锚点。** 见 §4。
- **不处理 `srcset` 相对路径。** 见 §6。
- **不接管 `.mdx` 的渲染期检查。** `.mdx` 里的手写标签是 JSX 节点（`mdxJsxFlowElement`），不是 HAST 元素，`rehype-raw` 也不会把它们变成元素，媒体插件看不到。产物测试会扫全站拦下这类引用（含 `<video poster>`），报错点从构建期移到测试期。
- **不接受符号链接作为媒体文件。** 枚举不进入链接（避免镜像成环），校验就不能放行，否则会产生一个没有产物的 URL；需要时把文件复制进 `src/`。
- **同一路径同时被 Markdown 图片来源和手写 `<img>` 引用时，按图片管线处理。** 归属判据是 `localImagePaths`（按路径），不是节点来源；这种混写下图片会被正常优化而不是报错，不会产生 404。

## 8. 验收

`test/media-assets.test.mjs`（无需构建）：引用分类互不重叠且「可镜像」与「逃出源根」分开；`?query`／`#fragment` 不当文件名、百分号编码按浏览器方式解码；映射函数只认源根以内且支持注入别的根；相对路径的 `video`／`audio`／`source` 与媒体链接被改写，外链、站内绝对路径和非媒体相对链接保留；Markdown 图片不被媒体层改写；七类非法引用失败且报错含文件与行号；镜像幂等、清理陈旧产物、跳过符号链接与目录（测试用临时目录当两个根，不碰真实仓库）。

`scripts/verify-markdown-pipeline.mjs`（产物级，`pnpm test:built-markdown`）：每个 `](#…)` 同页跳转有落点（同时锁住空锚点不被清理）；每个站内链接在产物里能找到文件（`](./xxx.md#…)` 在这里失败，而构建不会）；每个 `<table>` 有滚动容器（同时锁住 `rehype-raw` 的位置）；正文不出现 `style="zoom:…"`；**全站**每个媒体 `src` 都是可服务的绝对地址，且站内地址对应的产物真的存在（覆盖 `.mdx` 与模板）。

`scripts/check-content-rendered.mjs`（构建链，串在 `postbuild`）：每个带正文容器的页面都必须渲染出非空正文。

`validate_content.py`（预检，无需构建）：拦住正文里指向 `.md`／`.mdx` 的相对链接（`\`\`\`` 与 `~~~` 围栏、行内代码、引用块里的围栏都排除在外）。它只认「目标以 `.md` 结尾」这一条铁定错误的形式，不需要 slug 生成规则，所以不与产物测试重复；目标文章在不在站点上由产物测试判定。

`pnpm test:rss-feed` 覆盖 RSS 侧清洗与降级。
