# 文章 TOC 与响应式导航说明

> 这份文档只以当前代码为准，说明文章详情页 TOC 的结构、显示逻辑和关键参数，方便后续继续调整。

## 1. 当前实现范围

- `src/components/views/RenderPost.astro`
- `src/components/base/DesktopAside.astro`
- `src/components/toc/TocSidebar.astro`
- `src/components/toc/MobileTocControl.astro`
- `src/components/toc/Toc.astro`
- `src/components/toc/TocItem.astro`

这些文件共同负责：

- 桌面端右侧 TOC 显示
- 小宽度下切换为右下角目录按钮
- 移动端目录卡片展开、收起与跳转
- 当前章节高亮和自动滚动

## 2. 渲染链路

文章页入口在 `RenderPost.astro`。

当前逻辑：

1. 文章通过 `render(post)` 得到 `Content` 和 `headings`
2. 只有同时满足以下条件时才显示 TOC
   - `FEATURES.toc` 开启
   - 文章 frontmatter 中 `toc: true`
   - `headings.length > 0`
3. 满足条件后，在 `RenderPost.astro` 中统一挂载一层 `<Toc isArticle={true}>`
4. `Toc` 内部同时挂载两个展示组件
   - `DesktopAside`：桌面端右侧 TOC
   - `MobileTocControl`：小宽度下的浮动目录按钮和目录卡片

这样做的作用：

- 桌面端和移动端共用同一套 TOC 观察与高亮逻辑
- 避免之前那种桌面和移动各自包一层 `Toc`，导致重复创建观察器和重复自动滚动的问题

当前关键判断变量：

- `tocEnabled`
- `haveHeadings`

## 3. 桌面端 TOC

桌面端容器在 `DesktopAside.astro`。

### 3.1 当前核心参数

- `--article-width: 65ch`（`1280px` 及以上为 `70ch`）
  - 与 `.prose.post-content` 的 `max-width` 对齐，用来计算右侧空白
- `--toc-inset-start: calc(clamp(3.25rem, 6.5vw, 8.5rem) - 1.4rem)`
  - TOC 块相对正文的间距，比靠视口一侧更大，避免贴住正文
- `--toc-inset-end: calc(1.2rem + 1.4rem)`
  - TOC 块相对视口右缘的间距；相对居中再整体左移 `1.4rem`
- `--desktop-toc-width: calc(50% - article/2 - start - end)`
  - 宽度等于右侧空白减去两侧 inset
  - 视口越宽 TOC 越宽；到隐藏断点时最窄
- `top: 8.875rem`
  - 整个右侧 TOC 距离页面顶部的位置
- `right: var(--toc-inset-end)`
  - 靠视口右缘定位，不在右侧空白里绝对居中
- `@media (max-width: 1199.9px)`
  - 页面宽度小于这个值时，桌面 TOC 直接隐藏

### 3.2 TOC 触发标题

桌面端顶部标题文案当前是 `TOC`。

当前样式参数：

- `font-size: var(--blog-reading-size)`
- `font-weight: 500`
- 默认 `opacity: 0.55`
- `always` / `hover` / `content` 模式激活后 `opacity: 0.82`

其中 `--blog-reading-size` 当前定义在 `src/styles/main.css`：

- `--blog-reading-size: 1.0625rem`

### 3.3 目录列表本体

目录列表在 `TocSidebar.astro`。

当前参数：

- `width: 100%`
  - 目录列表跟 `DesktopAside` 的流体宽度走，避免子元素里的 `%` 相对 aside 再算一遍
- `font-size: calc(var(--blog-reading-size) * 0.9)`
  - 当前目录字体比正文基准略小
- `max-height: 74vh`
  - 控制目录整体最大高度
- `.desktop-toc__list`
  - `overflow-y: auto`
  - `margin-top: -0.5rem`

## 4. 小宽度下的移动 TOC

移动目录入口在 `MobileTocControl.astro`。

### 4.1 显示断点

当前断点与桌面 TOC 保持一致：

- `@media (max-width: 1199.9px)`
  - 右下角目录按钮显示
- `window.matchMedia('(min-width: 1200px)')`
  - 页面放大回桌面宽度时，自动关闭移动目录卡片

如果后续要改 TOC 消失临界值，这里至少要同步改 3 处：

1. `DesktopAside.astro` 里的桌面 TOC 隐藏断点
2. `MobileTocControl.astro` 里的移动目录按钮显示断点
3. `MobileTocControl.astro` 里的 `matchMedia('(min-width: ... )')`

### 4.2 目录按钮

当前按钮位于页面右下角“返回顶部”按钮上方。

当前参数：

- `right: 1.25rem`
- `bottom: 4.75rem`
- `width: 2.5rem`
- `height: 2.5rem`
- `border-radius: 9999px`
- 默认 `opacity: 0.55`
- 展开或 hover 时 `opacity: 0.92`

### 4.3 目录卡片

当前卡片参数：

- `right: 1.25rem`
- `bottom: 7.75rem`
- `width: min(24rem, calc(100vw - 2rem))`
- `max-height: min(60vh, 32rem)`
- `border-radius: 1rem`
- `backdrop-filter: blur(16px)`

这意味着：

- 宽屏手机下卡片最大宽度为 `24rem`
- 更窄的屏幕会自动退让为 `100vw - 2rem`

### 4.4 卡片头部

当前头部文本是 `Table of Contents`。

当前参数：

- `min-height: 3.35rem`
- `padding: 0.8rem 1.125rem 0.65rem`
- `font-size: 1rem`
- `font-weight: 600`
- `border-bottom: 1px solid rgba(125, 125, 125, 0.22)`
- `background: rgb(255, 255, 255)`
- 暗色模式：`background: rgb(12, 12, 12)`

当前头部作用：

- 作为卡片内部的固定头部区域
- 通过真实布局占位来遮挡下面滚动上来的目录项
- 不再依赖 `sticky + 估算高度` 这种更容易出错的实现

### 4.5 卡片目录列表

当前目录列表参数：

- `flex: 1 1 auto`
- `min-height: 0`
- `padding: 0.35rem 1.5rem 1rem`
- `overflow-y: auto`

当前列表行为：

- 去掉了默认 `li` 圆点
- 去掉了伪元素前缀
- 去掉了每项下方横线
- 只保留文本和缩进表示层级

当前卡片布局补充：

- `.mobile-toc-control__panel` 使用 `display: flex` 和 `flex-direction: column`
- 头部是固定占位区
- 列表只占用剩余空间滚动
- 不再通过 `max-height: calc(... - 头部高度)` 手动估算列表高度

### 4.6 层级表现

当前目录层级不是通过前置符号区分，而是通过缩进和字号区分：

- 一级标题
  - `font-weight: 600`
- 二级标题
  - `padding-left: 1rem`
  - `font-size: 0.96em`
  - `font-weight: 500`
- 三级标题
  - `padding-left: 2rem`
  - `font-size: 0.92em`
  - `font-weight: 500`

### 4.7 交互逻辑

当前卡片的打开和关闭规则如下：

- 点击目录按钮：打开或关闭卡片
- 点击卡片外部：关闭卡片
- 页面放大回桌面宽度：关闭卡片
- 点击目录项跳转：**不关闭卡片**

当前隐藏实现补充：

- 卡片默认带 `hidden`
- 由于卡片本身使用了 `display: flex`
- 当前额外补了：
  - `.mobile-toc-control__panel[hidden] { display: none; }`

这样才能保证：

- 再次点击目录按钮能真正隐藏卡片
- 点击页面其他位置也能真正隐藏卡片

最后这条是当前特意保留的行为，方便连续跳转多个标题。

## 5. 共享的 TOC 高亮逻辑

桌面 TOC 和移动 TOC 都被包在 `Toc.astro` 里，因此共用同一套高亮逻辑。

### 5.1 当前参数

`Toc.astro` 会从 `FEATURES.toc[1]` 里读取：

- `minHeadingLevel`
- `maxHeadingLevel`

并写到组件属性：

- `data-min-h`
- `data-max-h`

### 5.2 当前高亮机制

`Toc.astro` 通过 `IntersectionObserver` 监听正文标题。

当前 observer 参数：

- `root: null`
- `rootMargin: '0% 0% -75% 0%'`
- `threshold: 0`

当前命中逻辑：

- 当正文标题进入观察区域时，对应 TOC 链接会被加上 `aria-current="true"`
- 已激活且当前可见的 TOC 链接会自动执行：
  - `scrollIntoView({ behavior: 'smooth', block: 'center' })`

这也是为什么桌面 TOC 和移动 TOC 都会自动跟随当前阅读位置。

当前还做了两项收敛处理：

- `Toc.astro` 现在只收集带 `data-toc-link` 的真实目录链接
- 不会把 `Skip toc` 这类辅助链接误加入标题映射

对应实现位置：

- `TocItem.astro`：给真实目录链接加 `data-toc-link`
- `Toc.astro`：只查询 `[data-toc-link]`

### 5.3 自定义元素注册保护

当前 `Toc.astro` 和 `MobileTocControl.astro` 都加了自定义元素注册保护：

- `if (!customElements.get('table-of-contents'))`
- `if (!customElements.get('mobile-toc-control'))`

作用：

- 避免同一页面重复注册自定义元素时报错

## 6. 当前最常改的参数

如果后续要继续调整，通常优先看这些参数：

### 6.1 改桌面 TOC 宽度

文件：

- `src/components/base/DesktopAside.astro`

优先改：

- `--toc-inset-start`：TOC 与正文的间距，变大则 TOC 变窄、更不贴正文
- `--toc-inset-end`：TOC 与视口边缘的间距，变小则更靠右
- `--article-width`：必须与 `.prose.post-content` 的 `max-width` 保持一致

说明：

- 宽度由右侧空白自动算出，不要再写死成 `12rem`
- `TocSidebar` 使用 `width: 100%` 跟随 aside，不要在子元素里再用带 `%` 的 `--desktop-toc-width`

### 6.2 改 TOC 提前/延后消失

文件：

- `src/components/base/DesktopAside.astro`
- `src/components/toc/MobileTocControl.astro`

必须同步改：

- `@media (max-width: ...)`
- `matchMedia('(min-width: ...)')`

### 6.3 改桌面 TOC 字号

文件：

- `src/components/toc/TocSidebar.astro`

当前值：

- `font-size: calc(var(--blog-reading-size) * 0.9)`

### 6.4 改移动卡片头部

文件：

- `src/components/toc/MobileTocControl.astro`

重点参数：

- `min-height`
- `padding`
- `font-size`
- `border-bottom`

### 6.5 改移动卡片层级表现

文件：

- `src/components/toc/MobileTocControl.astro`

重点参数：

- `padding-left`
- `font-size`
- `font-weight`

## 7. 当前结论

基于现有代码，文章页 TOC 现在是“两套显示形态，一套高亮逻辑”：

- 宽度足够时：显示右侧桌面 TOC
- 宽度不足时：切换成右下角目录按钮 + 目录卡片
- 两边都由 `RenderPost.astro` 外层统一包裹的 `Toc.astro` 管理当前章节高亮

当前最重要的几个控制参数是：

- 桌面 TOC 宽度：随右侧空白流体变化，偏靠视口右缘
- 桌面 TOC 隐藏断点：`1199.9px`
- 移动 TOC 恢复桌面断点：`1200px`
- 桌面 TOC 字号：`calc(var(--blog-reading-size) * 0.9)`
- 移动卡片头部高度：`3.35rem`
- 移动卡片最大高度：`min(60vh, 32rem)`

## 8. 最近几次更新总结

基于当前代码，可以把最近这一轮 TOC 相关更新概括为：

- 桌面端 TOC 宽度随右侧空白流体变化
  - 宽度由 `--desktop-toc-width` 按正文 `max-width` 和视口计算
  - 字号为 `calc(var(--blog-reading-size) * 0.9)`
- 桌面 TOC 的消失断点提前到 `1199.9px`
  - 目的是在目录快接近正文右边界之前提前切换
- 小宽度下新增了右下角目录按钮和目录卡片
  - 目录按钮与“返回顶部”按钮并列工作
  - 点击按钮可以展开或收起目录卡片
- 移动目录卡片的样式被重新整理
  - 去掉默认圆点和伪元素
  - 去掉每项横线
  - 层级改为通过缩进和字号体现
  - 头部区域改为真实占位布局，避免深层标题滚动时侵入头部
- TOC 交互逻辑做了收敛
  - 点击目录项跳转时卡片不会自动关闭
  - 点击页面其他区域或再次点击按钮会关闭卡片
  - 放大回桌面宽度时会自动关闭卡片
- TOC 结构层级做了清理
  - `RenderPost.astro` 外层统一包一层 `Toc`
  - `DesktopAside` 和 `MobileTocControl` 不再各自重复包 `Toc`
  - 只保留一套观察器和一套当前章节高亮逻辑
- TOC 链接映射逻辑做了精确化
  - 只处理真实目录项链接
  - 避免把辅助跳转链接错误纳入高亮或自动滚动逻辑
