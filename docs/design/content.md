# 正文内容：图片、卡片、HTML 与媒体

本文是正文内容的现役写法、行为契约与实现入口，适用于博客、拾趣、关于及首页通过共享 Markdown 管线渲染的内容。
作者按任务阅读前半部分，修改插件或浏览器交互时再看模块职责和验证入口。
页面范围与行为边界见 [站点契约](./site.md)，整体架构见 [架构导览](./architecture.md)。
发布操作见 [作者 skill](../../blog-content-publisher-skill/SKILL.md)，可复制语法见 [内容演示](../../src/content/blogs/image-layout-demo.md)。
RSS 的清洗白名单、地址与身份规则统一见 [RSS 全文表达](./distribution.md#rss-content)；本文只保留内容侧必须维持的顺序与资源义务。
文中的 `src/`、`plugins/`、`public/`、`test/`、`scripts/` 路径均相对仓库根目录。

按任务跳转：

- [放图片、写封面与控制宽度](#images)
- [并排、横滚与图文绕排](#image-layouts)
- [写横卡、竖卡与方形陈列架](#cards)
- [查看正文大图与相册](#lightbox)
- [写 HTML、视频与音频](#html-media)
- [嵌入本地 HTML 交互演示](#local-html-demos)
- [处理文章链接、锚点及路径失败](#paths)
- [嵌入 Excalidraw 画布](#excalidraw)
- [插入博文链接卡](#blog-links)
- [定位管线、模块属主与清理职责](#pipeline)
- [选择验证入口与预览方式](#verification)

<a id="images"></a>

## 图片目录、写法与宽度

内容图片放在 `src/content/`，相对于文章文件引用，由 Astro 图片管线生成 WebP、响应式资源、宽高与懒加载属性。
`public/` 放站点图标、头像、字体、默认 OG 图和独立 HTML 演示；正文配图仍优先放内容目录。
图片路径、文章 URL 与 slug 各自维护，不靠改文章路由解决图片路径问题。

```text
src/content/blogs/
  代码库搜索.md
  代码库搜索-img/       本篇正文图
  _title-images/        文章封面
  算法笔记/
    算法 1（数组、链表）.md
    algo-img/           同组文章共享正文图
src/content/interests/
  device.md             分类正文，也支持 .mdx
  device/               与正文文件同级的配图目录
```

拾趣新增分类如 `travel.md` 时，图片可放 `travel/`，用 `./travel/file.png` 引用。
分类入口与菜单由内容元数据生成；`recent.md` 不生成分类子页。菜单图标仅按需配置 `INTEREST_ICONS`，与正文图片无关，不要求占位文件。

| 场景 | 作者写法 | 资源处理 |
| --- | --- | --- |
| 本篇正文图 | `![说明](./代码库搜索-img/file.png)` | 相对文章文件解析，进入图片管线 |
| 上层共享图 | `![说明](../共享图/file.png)` | 同样进入管线，文件必须存在 |
| 限制宽度 | `![说明\|w310](./图.png)` | alt 尾部标记转成图片节点 width |
| 顶层文章封面 | `titleImage: ./_title-images/foo.webp` | schema 的图片字段解析 |
| 子目录文章封面 | `titleImage: ../_title-images/foo.webp` | 同上；有封面时同时写 `titleImageAlt` |
| public 中的图 | `![说明](/avatar.webp)` | 原样服务，不优化 |
| 外链图 | `![说明](https://example.com/a.png)` | 优化取决于当前远程域名配置 |

`SITE.imageDomains` 当前为空，远程图不纳入构建期优化；`astro.config.ts` 将它传给 `image.domains`。
不能把“外链图永远不优化”当作不受配置影响的规则。当前配置下，外链 Markdown 图与外链 `<img>` 都沿用公网资源；放大功能不额外抓取外链。
`/` 开头的 public 图也可用原生 `<img>`；本地相对图片应使用 Markdown，原生标签的例外见 [路径失败](#paths)。

`|w330` 只表示 330 像素，不接受百分比；标记只能放 alt 末尾，不能放 URL。
桌面正文列宽为 660px，半宽可写 `|w330`，窄屏仍受实际列宽限制。源图已更窄时不必写宽度。
`plugins/remark-image-width.ts` 剥离标记并写入节点 `width`，让 Astro 同时生成匹配的 `srcset` 与 `sizes`。
只写 CSS 限宽不会改变管线的选图依据；不写标记时按原图宽度生成变体，页面显示仍受列宽限制。
容器 CSS 可以响应式收窄 gallery／figure 中的图片并保持比例，不改变作者像素宽度的语义。

禁止 `style="zoom:50%"`：它会在窄屏先受 max-width 限制，再按原图比例缩放，尺寸不可预测。
`![](./x.webp|w480)` 会把标记当文件名，通常以找不到图片失败。
GIF 走图片管线并生成保留动画帧的 WebP，HTML 宽高按单帧计算，多档宽度会生成多份动画文件。
源图不降采样；优化减少访客下载量，不减少仓库原图体积。
产物位于 `/_astro/` 且带内容哈希，不得手写文件名；本地内容图始终引用源路径。

### 封面与站点图片的资源选择

| 调用方 | 现役资源与加载义务 |
| --- | --- |
| `PostHero` | `<Image width={660} priority>`，宽度来自 `ARTICLE_COLUMN_WIDTH`；不能改为 full-width，否则 sizes 会变成 100vw |
| `ListItem` | widths 为 `[274, 548, 822]`，sizes 为 `(min-width: 768px) 250px, 100vw`；有图列固定 250px，无图占位列 222px |
| 文稿列表 | 第一项有封面时 priority；其余和标签页图片保持 lazy；首页近期笔墨为纯文字 |
| `RenderPost` | `getImage()` 单独生成 1200px JPEG 分享图再拼绝对 URL，不直接使用封面原图作 og:image |
| 横卡／竖方卡 | 封面默认资源宽度分别为 240／480；显式 `|w` 优先，显示裁切与资源宽度分别管理 |

`titleImage` 使用 schema 工厂提供的 `image().optional()`，不要从 `astro:content` 导入独立 image。
文章页独立 h1 在封面之前，封面中的重复标题用段落，描述优先 description、缺失取 subtitle；作者行展示头像、梧桐雨与日期。
封面深浅主题均为深色遮罩和白字；无封面直接显示独立标题及正文。封面布局与作者行不复制到 RSS。
`public/og/default.png` 由 `scripts/gen-og-cover.mjs` 生成，不能据此另造一套正文图片资源。

<a id="image-layouts"></a>

## gallery、figure 与响应式布局

gallery／figure 保持 660px 版心，不 breakout，静止时完整显示、不裁切图片；图片仍走原有 Astro 管线。

```md
:::gallery
![第一张](./文章-img/a.png)

![第二张](./文章-img/b.png)
:::

:::gallery{layout="grid" columns="3" widths="1fr 2fr 1fr"}
![第一张|w330](./文章-img/a.png) ![第二张](./文章-img/b.png)

![第三张](./文章-img/c.png)
:::

:::gallery{layout="scroll"}
![横图](./文章-img/a.png)

![竖图](./文章-img/b.png)
:::

:::figure{side="left"}
![图示|w240](./文章-img/detail.png)

这段文字在桌面围绕图片阅读，后面还可继续写正文块。
:::
```

- gallery 只允许 `layout`／`columns`／`widths`；默认 grid、两列，columns 仅为 `2` 或 `3`，不是字面量 `2|3`。
- widths 接受二／三个正有限数的 px／fr，可用小数，如 `240px 1fr`；不接受 `%`、auto、calc 或任意 CSS。
- 省略 columns 时按 widths 数量推导，同时写时数量必须匹配。fr 分配扣除间距后的空间，px 为可收窄的列宽目标；过大的固定列会挤窄余列。
- 列轨道不替代 `|w`。只缩小一张图用 `|w`，图片在原列内居中，不把空位让给邻列。
- gallery 至少一张独立 Markdown 直接图片；同段可多图，但只能有图片与空白。不接受说明文字、列表、引用式图片、链接包图及 HTML／MDX 图片。
- figure 只允许 side 为 left／right，默认 right；第一段恰好一张直接图片，后面至少一块有可见文字的正文。注释、br、空 HTML、只有媒体均不算正文。
- gallery／figure 不能嵌套或相互嵌套。非法属性、值、结构带源位置失败，不静默删图；代码块中的语法只是示例。

600px 及以下 grid 单列，figure 图片在前、正文在后，scroll 仍横滚。
scroll 不接受 columns／widths，全部图片静态存在，原生横滚与 scroll snap 无 JS 也能用，不自动播放。
启用 JS 且至少两张时，白色圆形箭头贴图片区域两侧，首尾隐藏不可用方向；图片底部叠加一图一点的页码，当前点为深色。
没有底部工具条和可见滚动条。圆点过多时只滚动分页容器以露出当前点，不移动文章。
当前位置跟随实际滚动，按幻灯片中心对齐；箭头与圆点也按中心翻页。
相册区域高度为 `min(520px, 56svh)`，随视口调整，翻页不随图片高度跳动。
每张幻灯片宽度跟随该图渲染宽度；两端留白按满高 3:4 竖图估算，常见首尾图可居中，更窄的 `|w` 图会贴边。桌面两侧常露出相邻图，窄屏主图常铺满舞台。
图片按原比例完整缩入区域；`|w` 仍是显示宽度上限，区域宽高不足时继续等比缩小。
单张 scroll 不生成增强 wrapper、箭头或页码；无 JS 不显示失效控件，全部图文仍可读。

<a id="cards"></a>

## 横卡与竖方陈列架

`:::card` 可写在共享管线的博客、拾趣、关于和首页 MD 内容中，由 `plugins/remark-media-card.ts` 唯一解析。

### 横卡：封面、介绍、评分与日期

```md
:::card{title="葬送的芙莉莲" href="https://zh.wikipedia.org/wiki/葬送的芙莉莲" score="5" date="2026-10-18" label="日漫"}
![葬送的芙莉莲海报](./anime/frieren.jpg)

好温柔的动漫，世界上有这样的动漫真是太美好了。
:::
```

例子的日期取自 `src/content/interests/anime.md` 已看完条目，不代表日期必须使用此格式；不要与正在看的第二季混用。
省略 layout 或写 `horizontal` 都是横卡。类别在右上，封面在左，右侧依次为标题、可选评分、可选日期、介绍；连续横卡组成自适应网格，当前版心最多两列。
最多一张独立 Markdown 图作封面，推荐相对路径；插件保留图片节点并加 `media-card__cover`，默认资源 width 为 240，显示为 7.25rem × 9.33rem。
评分按需填写，与观看／游玩状态无关；只接受 0–5、步长 0.5 的有限数。评分输出真实文本“评分：…分，满分5分”，星星仅为装饰，读屏和 RSS 不依赖 CSS。
`date` 可选，只 trim 首尾空白，按原文输出，不解析或转换格式；省略、空串、纯空白均不生成日期行。
填写后显示“日期：”及日期值，在评分下、介绍上；没有评分也可独立显示。字号和间距沿用评分，日期值与标题在两种主题下同为绿色。
有封面时右侧高度跟随封面，介绍占剩余空间；标题、评分、日期各占一行时通常露出约三行介绍，随换行变化，超出仍可滚动，不截断原文。

介绍仅允许文字排版和链接，不得包含额外图片或嵌入媒体；插件递归检查 Markdown 图片、引用式图片、HTML、静态 MDX 媒体、Excalidraw／blog-link 及指令有效 hName／hChildren。
普通 HTML 文字、注释、代码示例不误判为媒体。额外媒体、非法评分、嵌套卡片使构建失败，不删内容。
标题 href 只接受 HTTP(S)、mailto 和单 `/` 开头站内路径；反斜杠、控制符／空白及其他危险写法降级为纯文字，不自动推断作品链接。
横卡不接受 meta，也不能设置 scroll。

### 竖卡、方卡与分组

```md
:::card{layout="portrait" title="书名" meta="作者／分类／年份" href="https://example.com/book"}
![书封](./book/cover.jpg)
:::

:::card{layout="square" scroll="auto" title="专辑名" meta="歌手／制作方" href="https://example.com/album"}
![专辑封面](./music/album.jpg)
:::
```

两种陈列架都必须有非空标题和一张独立 Markdown 封面；meta／href 可选，小字不限定为作者，也可写年份、状态或制作方。
不接受介绍、score／date／label、非法 layout／scroll、嵌套；即使 date 为空也不接受，不静默隐藏作者内容。
标题与小字始终输出文本节点，安全链接规则与横卡相同。首页及演示中的作品 href 由作者核实为作品 Wiki，《牧神记》使用萌娘百科，其余现有条目使用 Wikipedia；插件不维护映射。
连续且布局、滚动模式相同的卡片按源顺序分组，插入普通正文或切换模式会分组；同排每张卡片都应写相同 scroll。
每组在静态 HTML 中生成一条 `media-cards__track`，卡片始终在轨道内，脚本不得重新搬动卡片。

竖封面按 2:3、方封面按 1:1 裁切并填满；不要求源图本来是该比例，大图始终完整。默认资源 width 为 480，显式 `|w` 优先。
660px 桌面版心约显示四张半竖卡／五张半方卡，窄容器保留卡片宽度下限、露出后续条目，手机保持单行，不撑宽页面或扩大全站版心。
栏没有灰底框，封面小圆角，标题自然换行，小字最多两行高，超长可独立上下滚动并聚焦；完整小字进入 RSS。
小字与横卡评论的纵向滑块默认隐藏，仅实际滚动时短暂显示，停止 700ms 后隐藏；宽度不变，触控、滚轮、键盘均保持原生滚动，无 JS 仍可滚。
手动栏保留紧邻内容的底部原生横向滚动条，支持触控／触控板／滚动条、聚焦栏后的左右键；Tab 可到后续封面与标题。

### 自动循环与副本

scroll 省略或 manual 为手动；auto 只请求循环，不保证一定启动，竖卡和方卡均可用，横卡不可用。
脚本启用、非减少动态效果、至少两张且作者原始内容宽于容器时才循环；桌面通常竖卡超过四张、方卡超过五张，窄屏更少也可能溢出。
排得开、无 JS 或减少动态时退回手动，不报错、不淡出边缘；相册与图片布局本身仍不自动播放。
循环在已有轨道内复制一组，标记 `data-marquee-clone`，读屏忽略且不进入 Tab；静态 HTML 不复制条目，换页删除副本。
CSS 用 `--marquee-distance` 位移一整组后重合回起点，不改滚动条位置、不另持动画计时器；两侧用页面背景色渐变，不用 mask。
悬停继续滚动，按下或键盘焦点进入时暂停，松开／离开焦点后继续。循环时栏不响应拖动，手动模式仍原生横滑。
封面源卡与副本均可通过文档委托点击看大图，副本不增加键盘焦点；大图集合只保留源卡。
RSS 按作者源顺序保留封面、标题链接、评分／日期／介绍或完整小字，不复制循环、副本、淡出或页面裁切。

<a id="lightbox"></a>

## 正文大图与相册

普通 Markdown 图、gallery／figure 图和 card 封面参与放大；titleImage 头图、文稿列表缩略图、站点头像不参与。
Excalidraw 嵌入及其预览／导出图始终排除；作者另写独立 Markdown 图时按普通图处理。blog-link 头像无 `.image-view`，也不进入相册。
可悬浮的精细指针下，图在原边框内轻微放大、移开复原，不影响周围布局，光标 zoom-in；减少动态效果时不缩放。
普通图不显示角落按钮，图本身具有可聚焦 button 语义；点击、聚焦后 Enter／空格打开原生 dialog。
作者链接包图如 `[![图](./photo.jpg)](https://example.com/)` 或混合文字链接仍跳转，链接外另留仅键盘焦点显露的大图入口，不劫持链接。
链接包图可用于普通正文，不能用作 gallery／figure 要求的直接图片。

同一 `.markdown-content` 根下已经参与放大的 `.image-view` 构成相册，含首页近期书影游、专辑陈列架源封面，不另外发现图片。
仅排除 `data-marquee-clone` 副本，不排除整个陈列架；从副本打开时按 template 原尺寸 src、缺失时可见 src 对齐回源张，打开即定位该张。
图与 alt 说明下方是一行控件：左侧“当前/总数”、中间前后箭头、右侧关闭；说明随图更新。
首尾禁用相应方向，不循环；打开期间左右键翻页，边界 no-op；单张仍显示 1/1 与禁用双箭头。
箭头默认 opacity 约 0.55，active 为 1，disabled 约 0.28，不用粘滞 hover 暗态；键盘 focus-visible 仅 outline。
大图光标 zoom-out，点图、Esc、遮罩或关闭按钮退出；浅色遮罩灰白，深色暗色，控件与说明随主题可读。
退出恢复触发焦点及打开前的滚动锁；卸载时不把焦点还给已断开的节点。

每张普通图配对一份 inert template 内的原尺寸图片节点，可见图保留 `|w`，原尺寸图不沿用缩略图宽度。
两份节点都交给 Astro，不手写 img URL；Astro 认领的大图仅生成单个原尺寸版本，不生成无用途的响应式变体。
浏览器从 template 已解析的 img 取资源，打开 dialog 时才赋给展示图；打开前不下载、不预加载。
接受 HTML 与图片资源随内容量增长，不做虚拟化、定时轮播或额外头图放大。RSS 移除 template 和控件，只输出可见图，保持全部图文源顺序。

<a id="html-media"></a>

## 手写 HTML 与本地音视频

`.md` 中 div、span、br、details、空锚点和 style 原样透传；可加工的手写元素与 Markdown 同待遇。
手写 h2 获得 id、标题后单个 # 链接并进入 TOC；table 获得横滚容器；blockquote 内的 `[!NOTE]` 按提示框渲染。
不归一化标题深度：`##` 始终 h2，没有正文 h1 也不提升；正文 h1／h2／h3／h4–h6 共用 2.125rem／1.6rem／1.1875rem／1rem，页面宋体标题独立。
inline style、style 块和 class + UnoCSS 均可用，`unocss.config.ts` 扫描 `src/content/**/*.md`。
style 块为页面全局样式，会影响导航、目录与侧栏，不自动隔离；局部样式使用前缀类名或工具类。
CSS 中 url 不改写也不校验，相对背景地址可能失效；使用 Markdown 图片、合法外链或可服务站内绝对资源。

本地文件放文章旁或子目录，写 `<video controls src="./demo.mp4"></video>` 或 audio／source；Typora 和站点指向同一个物理文件。
指向本地媒体的 `<a href="./demo.mp4">下载视频</a>` 与 src 使用相同规则，允许 query／fragment，如 `#t=10`、`?download=1`，后缀不参与找文件且原样保留。

```text
src/<rel> → public/_media/<rel> → 带 SITE.base 的 /_media/<rel>
```

镜像范围由 `MEDIA_EXTENSIONS`（音视频）和 `DRAWING_EXTENSIONS`（.excalidraw／.excalidrawlib）合成 `MIRROR_EXTENSIONS`。
图片及预览图不镜像，避免与 `_astro` 重复；.excalidrawlib 只可镜像／下载，不能直接嵌入；需要展示素材库内容时，先在 Excalidraw 中导入素材到画布，再导出为 .excalidraw 场景。
字幕 .vtt 不在范围，`<track src="./sub.vtt">` 被拒绝；放 public 后用带实际 base 的绝对路径。
poster 不走图片优化也不镜像，允许合法 HTTP(S)／协议相对外链和站内绝对路径；本地 poster 自放 public，不能放派生 `_media`，不能用相对路径。
`public/_media/` 是派生产物、已 gitignore，由 `astro-media-sync` 在 config:setup、Astro 拷贝 public 前镜像，确保本次构建带资源。
按 mtime + 大小跳过未变文件，删除源文件后清理旧产物；dev 不监听媒体变化，增删／替换后重启 dev。

正文 audio／iframe 不超过容器宽度；平台视频在 1024px 以下取消额外放大。外部平台可用 iframe，B 站指令在 `plugins/index.ts` 统一 autoplay=0，YouTube 指令沿用平台非自动播放默认值；手写 B 站 iframe 要自行加 autoplay=0。
本地 video／audio 不由插件添加 autoplay，是否播放由作者属性及浏览器决定。
正文聚焦时空格／Shift+空格保持浏览器翻页，不设置全局视频快捷键；播放器先获得焦点再处理内部按键，跨域 iframe 事件不由父页接管。
RSS 删除嵌入控件及子树，作者应在控件外紧邻补说明和普通媒体链接，详见 [RSS 全文表达](./distribution.md#rss-content)。

<a id="local-html-demos"></a>

### 本地 HTML 交互演示

普通 `.md` 可用 iframe 嵌入运行 CSS、JS、Canvas 的独立完整 HTML，不要求 MDX 或 Sketch 组件。
统一放 `public/demos/<稳定文章短名>/`，跨文复用放 `public/demos/shared/`，不为演示改名或迁移现有文章。
当前 base 为 `/`，示例：

```html
<div data-pagefind-ignore>
<iframe
  src="/demos/image-layout-demo/wave.html"
  title="正弦波动画演示"
  sandbox="allow-scripts"
  loading="lazy"
  style="display: block; width: 100%; height: 420px; border: 0;"
></iframe>
</div>
<a href="/demos/image-layout-demo/wave.html">单独打开正弦波演示</a>
```

HTML 不在媒体镜像范围，文章旁 `./wave.html` 不会自动发布；iframe 使用可服务站内绝对路径或外链，子路径部署手写 src 和链接须含实际 base，插件不补。
sandbox 允许脚本但不加 allow-same-origin，避免脚本取得父页 DOM、cookie、localStorage 同源权限；沙箱仍允许网络请求，不等于离线。
推荐内联 CSS／JS／数据；内部资源不经博客管线，本地资源放 public 用站内绝对路径，外链用完整 URL，受 CORS 等限制。
演示自行定义配色与响应式宽度，不继承博客 CSS／主题变量；当前手动指定高度，无自动高度或主题消息同步。
data-pagefind-ignore 排除嵌入区域索引，文字说明和独立链接放外面；RSS 删除 iframe，但保留外部普通文字链接。
public 文件随构建公开，不受文章 draft 控制，草稿演示放进去后文件本身也会公开。
可运行内容见 [演示文章的 HTML 交互动画](../../src/content/blogs/image-layout-demo.md#html-交互动画)。

<a id="paths"></a>

## 链接、锚点与路径失败

手写空锚点 `<a id="27"></a>` 必须保留，同页和跨文章链接都可能依赖它；短锚点比含中文标点、emoji 的自动标题 slug 更稳定。
跨文必须使用已发布页面的站内 URL，如 `/blogs/算法笔记/算法-1数组链表/#27`，不要写 `./另一个文件.md#锚点`；后者 Typora 可用，但线上常成当前文章下的 404，构建未必报错。
改链接前确认文章存在且非 draft；目标未发布时保留可见文字、去掉链接并说明，不猜 URL。
比较 href 的百分号编码片段与未编码 id 前要解码；落点认可任意元素 id 和传统 a name，不把 input name 当锚点。

### 渲染期拒绝与检查例外

无法服务的引用渲染期失败，错误带源文件相对路径、原始字符串与源行号；集合裁剪 frontmatter／前导空行时按源文件换算，读不到或匹配失败才保留原节点行号。

- 拒绝大小写任意的 data 内联内容、file／blob 等不支持协议，以及缺有效主机名或非明确 http(s)://／//host 写法的媒体地址。
- 拒绝原生 img 相对路径，提示改用 Markdown；但该路径同时已在 Astro localImagePaths／remoteImagePaths 登记时按图片管线处理，不因混写报错。
- 拒绝相对 poster、不支持扩展名的相对媒体（图片改 Markdown，字幕等放 public）、逃出 src 的相对媒体／媒体链接。
- 拒绝缺失文件、目录、符号链接，以及解码后路径段含不可服务的 #／?；真实越界与 `..clip.mp4` 这类合法文件名区分。
- `.mdx` 手写标签是 JSX 节点，raw 不会转成 HAST 元素，媒体插件看不到；相对 src／poster 等由全站产物检查拦下，不声称渲染期覆盖。
- iframe／embed／object 的相对地址不在构建期改写或报错，由产物检查兜底；srcset 不是单一 URL，也不改写，响应式图用 Markdown 或绝对 URL。
- 非媒体相对链接不由媒体层推断路由；CSS url 不改写、不报错，代码块里的标签不参与转换。

URL 段与文件名的往返必须一致：`PATH_SEGMENT_SAFE` 允许 &、+、逗号、冒号、@、$、;、= 原样出现；空格、%、中文在服务 URL 中转义。
静态服务按 decodeURI 语义还原，保留字符不还原，所以文件／目录名中的 #、? 两条路径都不能服务，应改名；query／fragment 后缀不算文件名。
`decodeRefPath` 表示作者要找的文件名，`decodeServedPath` 表示服务实际寻找的名字，`findUnservableSegment` 从同一规则推导失败。
检查仅看相对源根的路径段，项目父目录带 ? 不误伤；媒体与绘图镜像 URL 自动包含 SITE.base，手写 public URL 仍由作者负责。

### 镜像安全与正文不为空

枚举不进入源符号链接目录，校验也不放行链接文件，避免产生无产物 URL 或环；需要时把真实文件复制进 src。
镜像根自身和目标路径上的符号链接先删除链接再重建，不进入或修改链接目标；在清理旧产物前完成，避免复制／删除落到外部目录。
源目录变同名文件时先删旧派生目录再复制。只有 `public/_media/` 可写，不手写／提交派生产物。
镜像假定单写入者：一个构建或一个 dev；并发构建或 dev 与 build 共用目录不支持，无跨进程锁或原子发布，force 删除只容忍旧产物已消失。

每个 `.markdown-content` 容器必须含正文元素或非空文本，TOC 控件不算正文，草稿提示在标题区；一页多个容器逐个检查。
`scripts/check-content-rendered.mjs` 在 postbuild 拒绝空正文，覆盖博客、关于、拾趣等全站，不能只依赖测试，因为部署可能只跑 build。
Astro 内容加载器可能吞单条渲染异常后留下空 Content；RSS endpoint 清洗前也拒绝博客空 HTML，页面门禁覆盖未进入 RSS 的正文。
只有媒体的有效正文允许通过；RSS 清洗后只剩原文入口也允许，作者应补说明／链接。真正无需正文的页面不要套正文容器。

<a id="excalidraw"></a>

## Excalidraw：作者入口与只读视口

```md
:::excalidraw{src="./文章-img/diagram.excalidraw" preview="./文章-img/diagram.svg" alt="结构图"}
:::
```

指令必须为空，src 必须是 src 内可镜像的相对 .excalidraw 场景，拒绝 blob、外链、.excalidrawlib 和嵌套，构建错误带位置。
preview 可选；省略时按同名 .svg／.png／.webp／.jpg／.jpeg 顺序查找，显式预览缺失或扩展名非法报错。预览保留图片节点走 Astro，不镜像进 `_media`。
默认卡片固定 16:9，height 可覆盖高度，不允许用户拖窗口改大小。无 JS、源错误、无可显示元素或加载失败时保留可选预览和源下载，失败有可见提示，不挂半成品控件。

相机记录 SVG 坐标中心和相对 fit 的 zoom；初始等比适配并留 10% 空间，实际场景比例固定限制 5%–1600%，极大场景在下限仍可能放不全。
缩放只改倍率，拖动才移动中心；按钮步进 1.2 倍，所有缩放入口围绕当前视口中心，复位回内容中心与 fit；胶囊显示实际比例。
鼠标／单指拖动平移，双指、Ctrl/Cmd+滚轮中心缩放；普通滚轮滚文章。聚焦画布后方向键平移，+／- 缩放，0 适配。
右下胶囊常驻缩小、比例、放大、适配、展开、下载，控件不参与内容变换。
当页 dialog 与正文共用视口实现，保留打开时中心和相对倍率以适配更大固定窗口，内容可四向平移；resize 保留中心和相对倍率并限制绝对边界。
关闭／Esc／遮罩恢复正文原视口、滚动与触发按钮焦点，不重置正文；主题只改外壳、边框、胶囊，保留源背景和颜色，不重新导出或重置。
下载为同站镜像源文件，字节不重新序列化；显示用 SVG Blob 不作持久下载地址，嵌入图不进入普通照片相册。

### 技术选型与一手依据

参考 [Innei 正文画布](https://innei.in/posts/tech/ai-native-ios-e2e-verification) 与 [Yohaku Excalidraw 目录](https://github.com/Innei/Yohaku/tree/main/packages/rich-content/src/lexical/portable/excalidraw)。
参考实现为 div > svg > g[transform]，Scene 按元素类型绘图，InteractiveScene 管视口；旧 Shiro React viewer 不能代表它。
上游按钮以窗口中心按 1.2 倍缩放，滚轮以鼠标、双指以中点为锚，展开独立 SVG；本站统一中心缩放并改当页 dialog，避免切换输入方式时中心跳动。
采用官方 SVG exporter + 独立只读视口：官方负责 restore、rough 线条、箭头、文字、旋转、frame、内嵌图，本站只负责视口、卡片、胶囊与 dialog。
不挂官方 React 编辑器，避免宿主桥接／隐藏 UI 与视口规则重叠；不自制完整 renderer，避免持续追图形、字体、绑定和格式。
锁定 `@excalidraw/excalidraw@0.18.1`，ESM 条件导出、React peer 含 19；仅保留 React／React DOM 运行依赖，不用 @astrojs/react，完整官方包仍需按需下载。

显示链路：源链接 → 距视口 300px 内加载 exporter 与场景 → restore → 过滤已删除元素 → `exportToSvg({ elements, appState, files })` → 图片解码成功 → 挂视口并隐藏预览。
读取完整 files，不把源当只有元素的 JSON；exportScale 固定 1，用官方输出宽高作相机坐标。SVG 以 Blob 图片隔离，内部链接／样式不进入正文 DOM。
exporter 字体从官方 dist/prod/fonts 镜像到 `excalidraw-assets/fonts/`，EXCALIDRAW_ASSET_PATH 随 base 设置，默认内联字体子集。
正文与 dialog 共用同一 SVG，不重复 fetch／导出；关闭仅销毁 dialog view，离页中止 fetch、销毁所有 view 并撤销 URL，无跨页缓存。
成本随场景复杂度增长，不新增队列、大小限额或 worker 协议。上游 main 来源可变，不能将其当锁定版本证据。

一手 sources：

- [Scene.tsx](https://github.com/Innei/Yohaku/blob/main/packages/rich-content/src/lexical/portable/excalidraw/Scene.tsx)、[InteractiveScene.tsx](https://github.com/Innei/Yohaku/blob/main/packages/rich-content/src/lexical/portable/excalidraw/InteractiveScene.tsx)、[open-in-new-window.ts](https://github.com/Innei/Yohaku/blob/main/packages/rich-content/src/lexical/portable/excalidraw/open-in-new-window.ts)。
- [官方导出 API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export)、[0.18.1 类型](https://cdn.jsdelivr.net/npm/@excalidraw/excalidraw@0.18.1/dist/types/utils/export.d.ts)。
- [0.18.1 包元数据](https://cdn.jsdelivr.net/npm/@excalidraw/excalidraw@0.18.1/package.json)、[自托管字体说明](https://www.npmjs.com/package/@excalidraw/excalidraw/v/0.18.1)。

<a id="blog-links"></a>

## blog-link：博文链接卡

```md
:::blog-link{slug="astro"}
:::

:::blog-link{href="/blogs/astro/" title="Astro Notes" description="文章说明"}
:::
```

slug 按内容集合 id 解析，支持子目录、目录 index 和 frontmatter 自定义 slug，构建读取标题与描述；可用 title／description 覆盖。
缺目标或指向草稿带位置失败，不自动反链；双向互链由两篇分别放卡完成。
无 slug 时须有安全 href 和非空 title；链接协议与 card 相同，非法值报错。指令仅属性、不接受正文或嵌套，avatar 可覆盖默认带 base 的站点头像。
渲染居中横卡，桌面宽正文 2/3、600px 以下铺满；右侧 48px 圆角方头像，描述最多两行，头像懒加载且不进普通大图。
悬停／键盘焦点均显示强调色边框和一致范围柔光，浅色 24%、深色 18%，补偿背景亮度差。插件不猜 URL 或自动插入对端内容。

<a id="pipeline"></a>

## 管线、模块职责与生命周期

`astro.config.ts` 显式使用 `@astrojs/markdown-remark` 的 unified processor，不能依赖 Astro 7 默认 Sätteri 代替既有插件。
`plugins/index.ts` 是 Markdown／MDX 装配顺序权威：remark 管语法与图片登记，rehype 管 HTML 元素，静态镜像／Astro 图片管线管资源。

```text
remarkDirective → remarkImageWidth → remarkMediaCard
  → remarkExcalidraw → remarkBlogLink → remarkImageLayouts
  → rehypeCodeMeta → rehypeRaw → rehypeImageSources → rehypeMediaAssets
  → 标题 id／KaTeX／提示框／链接／标题锚点／表格等既有加工
  → Astro 图片解析 → Content
      ├─ 网页：prose.css 静态排版 + 浏览器渐进增强
      └─ RSS：rss-content.js 清洗，按源顺序留下可见图文
```

raw HTML 在 HAST 未解析前只是字符串，visit 不到；raw 必须先于元素消费者，但不必紧邻媒体插件。
raw 会重建元素丢 data.meta，因此 code-meta 先转 Expressive Code 支持的 metastring，保留文件名、行号、高亮和折叠，再交原 raw；不另建代码 renderer。
RSS 提取 Expressive Code 源码行时跳过折叠 summary 控件，隐藏源码完整保留；正文 details 摘要仍保留，细则见 [RSS 全文表达](./distribution.md#rss-content)。
CSS 仅消费插件已验证的 class、轨道与属性，不再解析 Markdown；先确定结构与资源，后由 prose.css 排版裁切，不能用 CSS 修补丢失轨道或替代作者 width。
`prose.css` 管内容布局／交互外观，`markdown.css` 管标题后锚点；UnoCSS 扫正文提取工具类。图片优化不构成修改 cssCodeSplit／inlineStylesheets 的理由。

| 唯一属主 | 职责与调用边界 |
| --- | --- |
| `plugins/remark-image-layouts.ts` | 结构／属性校验、image-view 和原尺寸 template；rehypeImageSources 使 template 图片对 Astro visitor 可见 |
| Astro 图片管线／`remark-image-width.ts` | 源图与资源解析、宽高、srcset／sizes；前者不由浏览器重算，后者只解析作者宽度 |
| `plugins/remark-media-card.ts` | 卡片内容边界、评分／日期文本、链接安全、封面装饰、分组与静态轨道 |
| `plugins/media-paths.ts` | 扩展名、分类、源根边界、URL 段编码、镜像路径唯一推导；除 isMirrorableFile 的 lstat／realpath 外为纯函数 |
| `plugins/rehype-media-assets.ts` | 元素分派、改写与带位置报错，不另推路径 |
| `plugins/astro-media-sync.ts` | 按共享 MIRROR_EXTENSIONS 镜像和清理；复制 exporter 字体，不另推 URL |
| `src/utils/image-lightbox-gallery.js` | 集合过滤、src 键、副本对齐与索引夹取，不在组件再扫一套 DOM |
| `src/utils/image-interactions.ts` | 横滚中心索引／箭头／点；大图状态、键盘、dialog、焦点与监听生命周期 |
| `src/utils/card-rail-marquee.js` | 判断循环、生成／清理视觉副本；位移动画由 CSS 完成 |
| `src/components/widgets/CardScrollbars.astro` | document 捕获 scroll，仅处理小字／评论；每区弱引用计时器，滚动续期并清理 |
| `plugins/remark-excalidraw.ts` | 指令、预览、源链接和源位置错误 |
| `src/utils/excalidraw-canvas.ts` | loadDrawing 共享绘图资源，createDrawingView 返回销毁函数；官方恢复／导出与 UI 输入 |
| `src/utils/excalidraw-viewport.js` | 中心、投影、平移、fit、倍率边界纯数学；正文与 dialog 不重复实现 |
| `src/utils/excalidraw-viewer.ts` | 延迟加载、失败回退、dialog 与页面生命周期 |
| `plugins/remark-blog-link.ts`／`blog-entry.ts` | 链接卡结构／失败与目标博文解析，分别保持权威 |
| `src/styles/prose.css` | 布局、主题、控件状态、滚动条与卡片尺寸，不依赖官方编辑器内部 DOM |
| `src/utils/rss-content.js` | 既有 Content 的顺序降级、清洗与资源绝对化，不新增布局解析器 |

HAST template 的 children／content 共享图片节点：Astro 从 children 原位改属性，最终 raw 从 content 序列化，两侧不替换节点。
仅 Astro 已认领的图片设置单资源输出；未认领的公网／public 图不附内部优化属性，页面可见图仍保留响应式资源。
ImageInteractions widget 在 BaseLayout 只注册接线，不再维护第二套 lightbox 或轮播状态。
横滚增强在 scroll／resize 时按幻灯片中心同步索引、边界与页码；箭头／圆点／键盘按同一中心几何绝对滚到目标张，与原生 snap 共用端留白。区域高度与幻灯片宽度由 CSS 管理。
disconnect 用 AbortController 清监听、释放 dialog 和页面资源；Excalidraw 同时断开 IntersectionObserver、中止 fetch、销毁 view／SVG URL。
滚动锁统一调用 `src/utils/misc.ts` 的 lockScroll() 并持有 release：根节点锁定、按实际稳定留白补偿并恢复旧样式，release 绑定当时 body，旧页释放不得解锁新页。
图片／画布只释放自己持有的锁，不写第二套 overflow 策略；backdrop 按元素持有同一接口的 release，ClientRouter 取消旧页退出动画也不得将它复用到新页。
不向已断开触发节点恢复焦点；循环副本与活动状态换页清理，不让旧监听或旧资源影响新页。
不新增轮播库、第二个 Markdown 解析器、预览后台／manager 或测试框架。

<a id="verification"></a>

## 验证入口与交付边界

下表规定验收接口，不表示当前已执行通过；选择与改动直接相关的层验证，dev 预览不替代生产构建。

| 入口 | 直接验证的义务 |
| --- | --- |
| `test/remark-image-layouts.test.mjs` | 默认值、结构、同段多图、widths 单位／数量／列数推导、非法输入／嵌套与源位置 |
| `test/image-lightbox-gallery.test.mjs` | 同根参与者、源卡／clone 对齐、Excalidraw 排除与索引边界 |
| `scripts/verify-image-layouts.mjs` | 无 JS、窄屏、列宽、箭头／点与长分页、混合比例高度、作者链接、悬浮／减少动态、主题、dialog 四种退出、键盘／焦点／清理；实际原尺寸、无占位符、打开前无请求，不锁视觉像素 |
| `test/scroll-lock.test.mjs` | 补偿、旧样式恢复与不污染替换 body |
| `test/remark-media-card.test.mjs` | 卡片语法、评分／日期、额外媒体拒绝及分组 |
| `test/card-rail-marquee.test.mjs`／`test/card-scrollbars.test.mjs` | 循环条件、复制／暂停／销毁，以及两区独立、滚动续期与收尾 |
| `scripts/verify-card-rails.mjs` | 真实轨道、书页同类一排、循环／大图与 Astro 导航后的卡片行为 |
| `test/media-assets.test.mjs` | 引用分类、编码／后缀、源根、改写与源行号；镜像幂等、旧产物、目录／源链接拒绝、目标链接安全，临时根不碰真实仓库 |
| `test/remark-excalidraw.test.mjs`／`test/excalidraw-viewport.test.mjs` | 作者入口、源／预览／失败；fit、中心缩放、拖动、resize、倍率边界 |
| Excalidraw 浏览器验收 | 正文／展开、真实拖动／双指、下载字节、焦点／滚动恢复、主题、站内导航，不能用类型声明替代 |
| `scripts/check-content-rendered.mjs` | postbuild 中逐个正文容器非空，覆盖未进 RSS 的页面 |
| `scripts/verify-markdown-pipeline.mjs`／`pnpm test:built-markdown` | 全站正文链接／锚点、原生表格包装、zoom 声明、媒体服务地址与真实产物、Astro 占位符；RSS 图片数量／顺序／地址／alt 与转换一致 |
| `node --test test/rss-content.test.mjs`／`pnpm test:rss-feed` | 前者验证 HTML 清洗与降级，后者验证 feed 身份与 XML 序列化；详见 [订阅验证](./distribution.md#verification) |

产物检查覆盖 `.mdx` 和模板中的媒体，含 iframe／embed／object／poster；异源地址也先经共享分类器校验主机名，同站完整域名／协议相对链接仍须带 base 且有产物。
同页链接按浏览器语义容许隐式 #top 和文本片段；跨页仅对 HTML 校验锚点，视频 #t=10 不当锚点，嵌入文档允许带 index.html 的目录路由。
zoom 检查按 CSS 声明解析，还原标识符转义，不把注释切开的无效声明误算；代码真实产物验证围栏参数、源码与复制载荷精确相等，不能只比有序子序列。
作者预检 `validate_content.py` 从真实 Markdown → HTML → a 元素，再按 WHATWG URL 和一次路径解码识别相对 .md／.mdx 链接；代码／注释不误判，JSX 表达式由产物兜底，不猜 slug。

作者修改含布局／卡片／媒体的文章，按 skill 默认启动或复用同 worktree 的 dev；纯文字、普通单图、代码块中的示例不触发预览。
复用前确认 cwd，按日志真实 Local 地址请求文章成功后交付链接，不固定 4321、不杀其他服务。插件变更后若缓存仍旧，可用 `pnpm dev --force`，缺轨道先查产物，不补第二套 CSS。
媒体增删／替换后重启 dev。草稿 dev 可见不代表 RSS 收录；用户禁止启动或环境受限时报告未预览，失败不能称已验证。
最终按仓库门禁执行 format／lint／check／test／build 及 built 检查；build 已带 --force 刷内容缓存，不能绕过 postbuild 空正文检查。
真实阅读器显示、远程资源未来存活与具体浏览器交互只在实际验证后报告，不由文档或源码检查推断兼容性。
