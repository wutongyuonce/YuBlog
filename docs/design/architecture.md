# 架构与模块边界

开发导览：从目录、模块属主和调用边界定位改动。页面行为与视觉约束见 [站点与页面](./site.md)，正文管线见 [正文与媒体](./content.md)，订阅见 [SEO 与全文订阅](./distribution.md)。本地运行、个性化及部署见 [开发与部署指南](../guides/development.md)。下文源码路径均相对仓库根目录。

快速定位：[页面入口](#routes) · [模块属主](#ownership) · [实现边界](#boundaries) · [运行链路](#flow) · [目录](#structure) · [页面实现](#pages) · [工具接口](#utilities) · [扩展位置](#extension) · [验证](#verification)

本文用这些词：

- **模块**：有界面、有实现的一块（函数、文件、页面拼装都可以）。
- **界面**：调用方必须知道的全部事实：签名、不变量、错误、配置、性能。
- **实现**：模块里面的代码。
- **seam**：界面所在的位置；可以在这里换实现、而不改调用方。
- **权威**：某类事实只允许在一处定义。别处只能读，不能再发明一份。

## 1. 这是什么站

Astro 7 静态站。主路径是**读文章**：首页名片、写作热力与近期笔墨、文稿列表、标签筛选、年份归档、文章详情。文稿、标签、归档、拾趣、项目、关于、友链共用同一套居中单栏布局与悬浮导航。黑白主题，配置集中在 `src/config.ts`。

线上：`https://www.wutongyu.site/`。

构建：`pnpm build` → `dist/`（不进 git）→ `postbuild` 跑 Pagefind，再跑 `scripts/postbuild.mjs`（清理 Pagefind UI 文件）与 `scripts/check-content-rendered.mjs`（校验全站每个正文容器确实渲染出了内容，包括关于、拾趣，空正文让构建失败）。

<a id="routes"></a>

## 2. 页面地图

| 路由 | 人看到的 | 入口 | 数据权威 |
| :--- | :--- | :--- | :--- |
| `/` | 作者介绍、写作热力、近期五篇笔墨、屏幕时间、近期书影游与 Last.fm 听歌排行 | `src/pages/index.astro` | 已发布 `blogs`、`interests/recent.md`、`public/data/screen-time.json`、运行时 `/api/lastfm` |
| `/blogs/` | 完整文稿列表，八篇分页，原始分类共用 URL 片段精确筛选 | `src/pages/blogs/index.astro` | `blogs` 集合 |
| `/interests/`、`/interests/<id>/` | 分类入口与按内容自动生成的独立页面 | `src/pages/interests.astro`、`src/pages/interests/[id].astro` | `interests` 集合：顶层 `*.{md,mdx}`，排除 `recent.md` |
| `/tags/` | 标签芯片；多选 AND；未选不列出文章 | `src/pages/tags.astro` | 同上，标签从文章 frontmatter 汇总 |
| `/archives/` | 按年时间线 | `src/pages/archives.astro` | 同上，按 `pubDate` 分组 |
| `/projects/` | 分类网格 | `src/pages/projects.mdx` | `src/content/projects/data.json` |
| `/about/` | 作者介绍 | `src/pages/about.mdx` | `src/content/about/about.md` |
| `/friends/` | 友链卡片 + 申请模板 | `src/pages/friends.mdx` | `src/content/friends/data.json` |
| `/blogs/[slug]/` | 正文、右侧 TOC | `src/pages/blogs/[...slug].astro` | 单篇 `blogs` |
| `/rss.xml` | 订阅源 | `src/pages/rss.xml.js` | 已发布 `blogs`（不含拾趣或 `recent.md`） |

顶栏页面链接由 `src/config.ts` 的 `UI.internalNavs` 维护；更多菜单由 `MORE_LINKS` 提供友链、相册及访问统计条目，友链页对应更多选中态。相册链接指向独立部署的 `https://photos.wutongyu.site/`，访问统计链接指向无需登录的 Umami 公开分享看板；两个外链均带 ↗ 并在新标签页打开。拾趣与更多下拉框最大宽度 200px。工具组读取 `UI.socialLinks` 中的本仓库 GitHub 链接，并包含搜索、配色和主题按钮。个人社交由 `AUTHOR_LINKS` 维护：首页 GitHub 指向个人主页，与 X、Instagram、Bilibili、小红书、邮箱一起展示；关于正文独立维护作者希望公开的联系方式。

`nav-path.js` 统一导航路径归一化、下拉类型和父级选中，服务端 `NavBar`／`NavItem` 与客户端共用规则；配置的尾斜杠及站点 base 不改变结果。

`NavBar.astro` 负责导航滑块：Astro 确认接管任意站内链接时，先按链接目标路径解析其顶层按钮，再把滑块移向该按钮，旧正文继续显示。拾趣子页统一对应「拾趣」，文稿分类和最近文章统一对应「文稿」；同一父级内切换保持滑块原位。下拉链接的 offset 相对于面板，不能用来定位顶栏滑块。标签、归档、首页近期笔墨等正文入口即使位于顶栏之外，也在导航准备阶段更新文稿高亮，不能等到页面交换完成才补播。

滑块的不透明底色需要标签同时换色，所以有两个属性：`aria-current` 始终表示用户真正所在的页面（给读屏器和「当前页」语义），`data-nav-current` 表示滑块画在哪个项上（给 `shell.css` 的配色），导航预览期间只有后者会先走。

`astro:page-load` 也会由 window load 或上一次导航触发，因此只有 pathname 已追上当前 pending 目标时才清除预览，已排队的旧页面交换不能冒充新目标完成，否则保留待导航状态。

前进／后退也从 Astro 事件目标 URL 解析父级；after-swap 在新页面绘制前同步最终高亮，page-load 再做幂等核对。只有当前请求的取消信号可撤回预览，旧请求不能撤回更新的导航。返回首页收起滑块并清除动画起点，下次显示直接定位。字体就绪与缩放期间不打断待导航的目标。品牌在首页带 aria-current，强调色及轻微文字加厚不改变它的宽度。外链、新标签页与浏览器默认处理的点击不走预览。

背景：首页 / 文稿 / 标签 / 归档 `dot`，项目 `rose`，友链 `snow`，拾趣及子页 `dot`，关于关闭。权威是各页传给 `BaseLayout` 的 `bgType`。

`dot` / `snow` 是 canvas 动画（`src/components/backgrounds/`）：

- `prefers-reduced-motion: reduce` 时只画一帧静态背景，不启动 RAF 循环，并在系统设置变化时启停。
- `dot` 每帧按透明度分 6 档批量描边。布点规则在 `Dot.astro`：基础间距 15px；估算点数超过约 8000 时按面积放大间距。这是密度目标，边缘补点可能超过它，不是硬上限。

<a id="ownership"></a>

## 3. 权威表（先看这里再改）

一类事实只应有一个主人。调用方从界面读，不要复制一份。

| 事实 | 权威 | 不要 |
| :--- | :--- | :--- |
| 站点 URL、标题、语言 | `src/config.ts` `SITE` | 在页面里写死域名 |
| 更多菜单及相册地址 | `src/config.ts` `MORE_LINKS`，图标自动加入 UnoCSS safelist | 在下拉组件中另写条目或手工复制图标 safelist |
| 顶栏导航、顶栏 GitHub | `src/config.ts` `UI.internalNavs` / `UI.socialLinks` | 在 `NavBar` 里加死链接 |
| 个人社交展示 | 首页 `config.ts` 的 `AUTHOR_LINKS`；关于页正文仅维护作者希望展示的联系方式 | 写入顶栏 `UI.socialLinks`，或在首页组件另写账号 |
| TOC / 搜索开关 | `src/config.ts` `FEATURES` | 在 TOC 组件里另做一套开关语义 |
| Oneko 像素猫开关与皮肤 | `src/config.ts` `FEATURES.oneko`；挂载见 `BaseLayout`，隐藏按钮见 `Footer`，说明见 [Oneko 像素猫](./oneko.md) | 自托管脚本、在页面重复注入，或自写隐藏状态 |
| 文章字段合不合法 | `src/content/schema.ts` `postSchema` | 在页面里重新约定字段 |
| 已发布文章列表、排序、按年分组 | `src/utils/data.ts` | 在视图里 `getCollection` 再 filter 一遍 |
| 原值分类的动态入口、URL 的分类 hash／兼容 query、精确筛选、标签、页码 | `src/utils/blog-browser.js` | 写固定分类允许表、合并别名或在 `ListView` 里手写 `URLSearchParams` |
| 单标签选中链接 | `src/utils/blog-browser.js` 的 `tagSelectionLinks`；`TagLinks` 只呈现 | 用 ` / ` 拼接标签，或在文章元信息、归档、列表卡片里手写 `?tag=` |
| 归档分类配色领取、唯一性、持久化与容量失败 | `src/utils/blog-category-colors.js`；预设及记录在 `src/data/blog-category-colors.json` | 在视图中推断颜色、循环复用或按分类顺序重排已有分配 |
| 首页各板块标题、名片与居中布局样式 | `public/shell.css` | 通过 JS 重复测量或复制卡片模板 |
| 标签 AND 匹配 | `src/utils/blog-tag-filter.js` | 在点击处理里写 `every`/`includes` |
| 路径是否带 `base`、是否补尾斜杠 | `src/utils/path.ts` | 字符串拼接 `/tags` |
| 顶栏、布局、归档线、分页的跨页 CSS | `public/shell.css` | 复制共享规则；需要局部覆盖时不检查作用域和层叠效果 |
| 索引版心与文章阅读宽度 | `src/styles/main.css` 的 `--blog-shell-width` / `--blog-prose-width` | 在页面或目录组件另写宽度值 |
| 文稿列表封面列宽 | `ListItem.astro` 的 250px／222px | 在 `main.css` 或列表页再写一份列宽 |
| 拾趣分区与菜单名称、说明、顺序 | `src/content/interests/*.{md,mdx}` 的 `title`/`description`/`order`；集合范围在 `src/content.config.ts` | 在导航与页面各写一份或限制分类 ID／数量 |
| 拾趣菜单可选图标 | `src/config.ts` 的 `INTEREST_ICONS`，键为文件名去掉扩展名；UnoCSS 自动加入 safelist | 为无图标分类补占位或重复维护图标 safelist |
| 友链申请模板里的站名 / 链接 | `FriendsApplyPanel.astro` 里的 `friendInfo` | 在其他组件复制申请模板 |
| 访问统计脚本 | `src/components/base/Head.astro` 的 Umami `<script is:inline>` | 放进页脚、再复制一份，或加 `data-astro-rerun` / 在 `astro:page-load` 手动 `track()` |
| Markdown 卡片单封面／文字介绍、属性、链接安全、评分、日期与连续分组 | `plugins/remark-media-card.ts`；展示只在 `prose.css` | 组件自行识别卡片或覆写网格；RSS 从 CSS 猜评分 |
| Excalidraw 指令、渲染和交互 | `remark-excalidraw.ts` 生成宿主与源链接；`excalidraw-canvas.ts` 调官方 SVG exporter 并绑定控件／输入；`excalidraw-viewport.js` 唯一负责相机数学；`excalidraw-viewer.ts` 管加载／回退／dialog／清理；`prose.css` 管外观；`astro-media-sync` 镜像源文件和本地字体。详见 [设计依据](./content.md#excalidraw) | 重挂 React 编辑器、复制元素渲染器或缩放公式、把临时 SVG URL 当源下载、给展开另写一套手势 |
| 博文链接卡 slug 解析与卡片结构 | `plugins/remark-blog-link.ts` + `plugins/blog-entry.ts`；样式在 `prose.css` | 客户端抓取元数据；自动反链；改全站圆形头像规则 |
| gallery／figure 的属性、结构、嵌套与带位置失败；普通 Markdown 正文图的 image-view／原尺寸 template 包装 | `plugins/remark-image-layouts.ts`，在 `remarkMediaCard` 后执行 | 在组件、RSS 或浏览器再解析 Markdown，或手写大图产物 URL |
| 全站输入方式与鼠标／键盘焦点提示 | `BaseLayout.astro` 捕获 pointerdown／keydown，`main.css` 统一抑制指针焦点外框 | 在各个图片／相册组件重复跟踪输入方式，或 blur 导致焦点恢复丢失 |
| 相册箭头／圆点状态、dialog 放大与正文大图相册翻页、焦点与滚动锁 release 生命周期、监听清理 | `src/utils/image-interactions.ts` | 把交互再放进 Astro widget；widget 在 BaseLayout 只接线；另起第二套 lightbox |
| 共享 Markdown 标题排版 | `prose.css` 的 `.prose.markdown-content` | 为首页、拾趣、关于各写标题字号 |
| 屏幕时间日期、公开形状与缺失值 | `src/utils/screen-time.js`；本机 API、写入与发布在 `scripts/sync-screen-time.mjs`，详见 [设计](./screen-time.md) | 在组件内推断活跃状态或连接本机 API |
| Last.fm 查询、统计、专辑匹配、资料缺失与请求上限 | `src/utils/lastfm.mjs`；缓存与失败语义在 `api/lastfm.js` | 在视图中重新调用 API 或推断排行／周总数 |
| 写作热力统计与失败语义 | `blog-heatmap.js` | 在组件重算年度字数、将缺失字数当 0 |
| 热力提示交互与页面清理 | `WritingHeatmap.astro` | 用旧根节点的定时器关闭新页面的提示层 |
| 内容图片的路径与写入规则 | `src/content/**` 里的相对路径；正文宽度标记由 `plugins/remark-image-width.ts` 解析 | 把图片放进 `public/`、在正文写原始 `<img>`（相对路径会构建报错）、手写 `_astro` 地址 |
| 正文媒体／绘图源引用的路径与落盘 | `plugins/media-paths.ts`（`MEDIA_EXTENSIONS`＋`DRAWING_EXTENSIONS`→`MIRROR_EXTENSIONS`）；`rehype-media-assets` 改写与报错；`astro-media-sync` 镜像到 `public/_media/` | 在这三个模块之外各自推断映射；把预览图／正文图也纳入镜像 |
| 点阵间距与约 8000 点目标 | `src/components/backgrounds/Dot.astro` | 另写一个网格工具，或把 8000 当成硬上限 |
| 点缀预设、默认与存储规则、强调色变量 | `src/utils/accent-palette.js`；`Head`／`AccentSwitch` 调用 | 在 CSS、首屏脚本和选项中复制调色板或默认值判断 |
| 配色面板和焦点生命周期 | `AccentSwitch.astro` | 在 `NavBar` 重建配色状态；导航只读面板展开状态 |
| 实际主题变化订阅与退订 | `src/utils/theme-observer.js`；Dot／Snow 只负责重绘 | 在背景中各写一份根元素 class 观察逻辑 |

<a id="boundaries"></a>

## 4. Seam：该从哪切开

### 4.1 内容 seam

界面：Content Collections + Zod。  
实现：磁盘上的 md / json。  
调用方：`getCollection` / `getEntry` / `src/utils/data.ts`。

内容字段先在 schema 约定，页面读取集合。拾趣分区的标题、说明、顺序来自 Markdown；在 `src/content/interests/` 顶层新增 `.md` / `.mdx` 并满足 schema 字段，重新构建后页面、入口和菜单自动生成，不固定分类 ID 或数量。可选图标映射在 `config.ts` 的 `INTEREST_ICONS`，键为文件名去掉扩展名；不配图标时菜单显示纯文字，不渲染图标占位。关于页只读取 `about.md`，新增 Markdown 不会自动变成页签。

### 4.2 列表数据 seam

界面：`getFilteredPosts`、`getSortedPosts`、`getBlogListItems`、`getGroupedPostsByYear`、`getRecentBlogPosts`、`getPublishedBlogPosts`；上下篇／随便逛逛纯函数在 `post-nav.ts`（`getPostNeighbors`、`pickRandomOther`）。
实现：草稿过滤、日期排序、渲染 `minutesRead`、按年 reduce；邻接与随机候选不在组件内重排。

首页、文稿、顶部分类预览、标签、归档、RSS、名片、近期笔墨都应穿过这里取文章集合。顶部分类菜单和开发／生产 RSS 均只读取 `getPublishedBlogPosts`；开发网页列表／正文仍可预览草稿，不属于菜单排除草稿的设计边界。写作热力只从这里取已发布文章，按日聚合篇数，并按上海自然年汇总字数，规则在 `blog-heatmap.js`（`test/blog-heatmap.test.mjs`）。字数格式测试见 `test/blog-stats.test.mjs`。

#### 上下篇与随机入口的模块职责

| 事实 | 权威模块 | 不要 |
| --- | --- | --- |
| 排序 | `getSortedPosts`（`src/utils/data.ts`） | 在组件内另写排序 |
| 邻接与随机纯函数 | `src/utils/post-nav.ts` | 在 Astro 模板内手算下标 |
| 详情 UI | `src/components/blog/PostNav.astro` | 把按钮散落进 `RenderPost` 模板 |
| 列表顶行 | `src/components/blog/RandomBrowse.astro` + `ListView.astro` | 把随机行塞进分页 HTML |
| 首页入口 | `RecentWriting.astro` 复用 `RandomBrowse` | 另写一套随机逻辑 |
| 随机 `href` 重写 | `src/utils/post-nav-random.js` | 每页复制一份内联随机逻辑 |
| 文稿 URL | 与列表一致：`redirect \|\| withBasePath(\`/blogs/${id}/\`)` | 自造路径编码 |


### 4.3 浏览器状态 seam

界面：`serializeBlogQuery` / 解析查询串（`blog-browser.js`）。  
实现：`category`、`tags[]`、`page`、每页 8 篇。

`ListView` 负责把 DOM 和这个状态接上。改每页数量时，除了 `blog-browser.js` 和测试，还须同步 `ListView.astro` 的首屏 CSS `nth-child(n + 9)`（CSS 选择器不能读取 JS 常量）；标签匹配的 AND/OR 规则在 `blog-tag-filter.js` 的匹配接口修改，`blog-browser.js` 只调用它，不要在点击处理里复制判断。

页码窗口由 `getPageNumbers` 统一生成，包含省略号最多 6 项（上一页 / 下一页另计）：总页数 ≤6 时全部显示；>6 时，优先判断当前页 ≤4，显示 `1 2 3 4 … N`；否则当前页 ≥N−3 显示 `1 … N−3 N−2 N−1 N`；其余显示 `1 … p p+1 … N`。省略号不可点击，至少代表两页；首尾和当前页始终可见。中间窗口优先展示下一页，无法同时保留前后邻页时可用独立的上一页 / 下一页控件连续翻页。生成窗口的计算和输出大小不随总页数增长。

`ListView` 负责标记当前页、禁用首尾的上一页/下一页，以及在 0 或 1 页时隐藏分页。分页渲染成一行胶囊条：两端是同一枚箭头（`‹` / `›`，用 `aria-label` 给出「上一页 / 下一页」），中间是页码窗口，当前页画成填充块。`>480px` 时单项 `2.25rem`；`≤480px` 时单项降到 `1.9rem`、列间距降到 `0.25rem`、页码间距归零，让「箭头 + 六项窗口」共 8 项在 320px 视口内仍保持一行而不横向溢出。分页视觉统一放在 `public/shell.css`，由文稿和标签页共用，组件通过同一份样式呈现。页码边界和 1–50 页所有有效当前页组合由 `test/blog-browser.test.mjs` 验证。

### 4.4 壳层样式 seam

界面：`public/shell.css` 的 class（`header.nav-bar`、`.blog-profile`、`.archive-*`、`.nav-dropdown`、`[data-pagination]`）。
加载：`Head.astro` 是公共样式输出的唯一入口，以 `?inline` 导入 `src/styles/main.css`、`prose.css`、`markdown.css`，让 Vite 展开依赖、处理资源 URL 并应用既有 PostCSS 插件；`public/shell.css` 仍以 `?raw` 读取，保留构建末尾才生成的标题字体子集路径。四份源码按 shell → main → prose → markdown 顺序组成一个 `<style id="site-styles">`，不包含页面数据。`BaseLayout` 不再重复导入它们。每个站点页面输出的该样式内容相同，ClientRouter 因而保留同一个节点。

首屏契约：HTML 到达后，首页的导航、名片、写作热力和正文布局不等待任何外链 CSS，也不依赖 JavaScript 加载样式；CSS 请求慢载或失败不会造成白屏或先无样式后补齐。字体保持 `font-display: swap`，下载失败时使用回退字体；深浅主题、320px 起的响应式布局及 ClientRouter 往返导航保持可读。无 JavaScript 时使用默认浅色和原有静态内容。HTML 自身慢载、第三方页面和外部暗化工具不在此保证内。

实现取舍：公共源码继续按职责分文件，不复制规则、不新增打包插件或客户端加载器。公共样式仍随每份 HTML 传输，跨页复用的是浏览器中的样式节点，不声称消除重复传输。`cssCodeSplit: true` 与 `inlineStylesheets: 'always'` 仅继续负责组件／工具类等按页样式，避免把所有组件装进公共包。接受每页 HTML 携带样式的成本，保留无脚本首屏，不新增外链依赖。颜色／版心变量仍只由 `main.css` 维护，点阵定位仍由 `Dot.astro` 的工具类表达。`shell.css` 维护跨页壳层规则及构建后字体子集引用；正文与 Markdown 规则在 `src/styles/`，友链卡片等组件样式由对应组件维护。目录链接的共享规则在 `main.css`，桌面目录位置和尺寸分别由 `DesktopAside`、`TocSidebar` 管理。共享规则集中维护；组件可以按需局部覆盖，以硬刷新和跨页导航中的实际效果验证，不将跨文件同名选择器一概判为错误。

验收：`scripts/verify-blog-restructure.mjs` 逐页检查生产 HTML——公共样式唯一、内容跨页一致、没有重复混入页面包、依赖已展开且本地 CSS 资源存在；除文章页既有的 ExpressiveCode 代码块样式表外不引用外链样式。首页另检查版心与背景定位样式。`scripts/verify-navigation-fonts.mjs` 用真实切页检查公共样式节点复用与已加载字形宽度稳定。浏览器在 CSS 和字体请求不可用时检查首绘与布局，并验证无脚本、深浅主题、窄屏和 ClientRouter 往返。

KaTeX 样式与字体来自本地 `katex` 包，由 Vite 打包到 `/_astro/`；版本与公式渲染依赖一致，浏览器按实际页面内容加载所需字体。

静态防撑宽职责：`main.css` 维护 `html` 横向 `overflow-x: clip` 兜底与宽度变量；纵向滚动及 `scrollbar-gutter: stable` 留白统一归页面根节点，`body` 不另建滚动容器，使固定顶栏、正文与页脚共享居中基准。`prose.css` 维护正文限宽；`markdown.css` 维护行内 code 断行与块级公式局部横滚。弹层临时锁滚动仍由 `misc.lockScroll()` 维护：锁定根节点，已有稳定留白时不再补偿；释放只恢复同页的根节点和原 body 留白。版心与手机页脚四行居中由 `scripts/verify-shell-alignment.mjs` 浏览器验收。

`--font-heading`（本地思源宋体 400 字重）用于页面大标题、文章顶部标题、作者名、写作热力与近期笔墨；文稿列表与归档文章标题使用同一宋体，字重分别为 700 与 400，分别由 `ListItem.astro` 的 `.post-preview h2` 和 `shell.css` 的 `.archive-post__title` 维护；标签筛选结果复用 `ListItem`。字体资源提供 400 字重，700 由浏览器合成加粗。Markdown 内部 h1–h6、正文和标签使用 Inter／系统无衬线字体。顶栏及下拉菜单文字使用宋体；品牌为「梧桐雨の博客」，使用桌面 16px、601–799px 为 14.72px、600px 及以下为 14.4px 思源宋体，行高 1；归档年份与日期也使用思源宋体。`PageHeading` 是标签、拾趣（含子页）、项目、关于的共享页头：标题 28px 宋体 400 字重，说明 14px 普通字体；友链分组标题为 24px 宋体。

正文字体 Inter 和代码字体 DM Mono 也在本地：`public/fonts/Inter-latin.woff2`、`public/fonts/DMMono-latin.woff2`，与思源宋体一起由 `public/shell.css` 的 `@font-face` 引用。这些声明随 `site-styles` 跨页保留，避免已加载字体回退；不要把共享字体声明放进会被替换的组件样式。不要再接 Google Fonts 或 `presetWebFonts`。这两份只含拉丁字符，中文走字体栈后面的系统字体。保留的两种手写字体 `@font-face` 在 `public/shell.css` 中，优先引用构建结束后生成的 `*-title.woff2` 子集，再回退到完整字体；`plugins/astro-subset-title-fonts.ts` 在构建后检查每个子集引用和文件都存在。Vite 不会提前解析尚未生成的字体路径。开发服务器没有子集时会回退到同一次声明里的完整文件，那不是线上行为。

主题、搜索、回顶、遮罩的点击在脚本执行时就绑定，不等第一次 `window` `load`。`astro:page-load` 只负责换页后的新节点，并用元素上的 `dataset` 避免重复绑定。

主题由根元素的 `dark` class 表示；`Head.astro` 仅恢复合法的 `light`／`dark` 保存值，缺失或非法时回退系统，`ThemeSwitch.astro` 负责手动切换及系统模式变化。两处的 `color-scheme` meta 只声明当前方案；存储读写失败不打断显示和切换，但不保证跨导航／刷新保留选择。`main.css` 的根元素规则同步 `only light`／`only dark`，声明原生控件和页面画布的当前配色，禁用浏览器常规自动暗化；外部暗化工具仍可能覆盖实际样式，页面不保证其覆盖后的配色与主题按钮一致。

`theme-observer.js` 订阅实际主题变化，忽略转场等无关 class 更新；Dot／Snow 在变化时重绘，并在断开时退订。页面交换先连接背景再恢复主题时，也会按最终主题补画；减少动效时不启动动画循环。`scripts/verify-theme-refresh.mjs` 在真实浏览器中验证首访、非法或不可用存储、系统偏好与保存主题相反、按钮切换、连续刷新、实际背景像素及 ClientRouter 导航后的恢复与资源清理。

`plugins/postcss-katex-woff2-only.ts` 挂在 `vite.css.postcss`，在 Vite 生成 CSS 产物**之前**把 KaTeX `@font-face` 里的 woff / ttf 源去掉。因为发生在产物生成前，CSS 文件名的哈希仍然对应所服务的字节；不能改到构建后处理（那时文件名已经定下）。上游 KaTeX 若变结构，插件会报错而不是静默产出坏字体。

装饰背景层级由 `src/styles/main.css` 的 `body { isolation: isolate }` 统一维护；点阵、雪花和 rose 保持 `z-index: -1`，在主体内部位于底色之上、内容之下。主体底色不遮挡背景，隔离层级不改变 fixed 元素的视口定位。`scripts/verify-background-layering.mjs` 用不透明主体底色和截图像素验证静态／动画点阵的可见性、滚动定位及换页，不仅检查 Canvas 缓冲区。

#### 点缀配色 seam

点缀行为以[页面配色契约](./site.md#appearance)为准。`src/utils/accent-palette.js` 的 `ACCENT_PALETTES` 是唯一预设表，首项原粉色决定默认配色；浅色主色为原粉色 `#ad526c`、灰紫 `#665477`、深紫 `#3a1b74`、雾蓝 `#476d89`、鼠尾草绿 `#52735c`。每套都生成不同的浅色与深色强调色；`--accent-swatch` 始终是浅色主色。灰紫深色为 `#d0adf2`，深紫深色为 `#a987e8`，原粉色保留旧深色 `#e7a1b5`，雾蓝深色为 `#7fafd2`，鼠尾草绿深色为 `#7fd298`。未单独指定的深色仍按主色 45% 混入白色，未单独指定的浅色柔和色按主色 72% 混入白色。`main.css` 保留黑白基底，不另写点缀表。

`createAccentPreference(palettes)` 提供 `resolve`／`restore`／`select`，统一合法值、默认和 localStorage `accent-palette` 的异常语义。工厂自包含，`Head.astro` 将同一函数和配置序列化为内联初始化，并输出未依赖 JS 的配色变量；选择器模块直接调用同一工厂。在 `astro:before-swap` 对传入根元素恢复偏好，硬导航则由 Head 在首屏前恢复；无需新协议、状态缓存或主题观察器。配色写入根元素 `data-accent-palette`，与现有 `.dark` 独立，视图通过 CSS 变量立即更新。

`AccentSwitch.astro` 只拥有面板、选中呈现和键盘／焦点交互：连接时读取偏好结果并显示入口，断开时通过 AbortController 清理局部和 document 监听。五行 menuitemradio 同时显示名称和勾选；关闭不锁页面滚动。`UI.navBarLayout` 的 `accentButton` 决定入口位置，`NavBar` 只读取 `[data-open]` 来保持可见，`shell.css` 负责工具尺寸及视口内面板。无 JS 隐藏选择器，默认变量仍生效。

存储失败只放弃跨加载保存，不回滚当前颜色；缺失／非法保存值使用首项。切换不导航也不重绘内容；黑白 canvas／花瓣背景、分类徽标和语义色保持其原属主。配色表固定五项，选择和存储操作有界，不新增依赖、任意颜色编辑、跨设备或多标签页同步。

偏好义务由 `test/accent-palette.test.mjs` 直接验证同一首屏工厂、恢复与失败；真实样式覆盖、读屏状态、键盘、窄屏、刷新、ClientRouter、存储降级和无脚本由 `scripts/verify-accent-palette.mjs` 检查，不以 CSS 文本快照代替页面验收。运行方式与既有浏览器脚本一致。

### 4.5 布局 seam

- `BaseLayout`：文档头、背景、悬浮导航、主槽、页脚。文档头由 `Head.astro` 输出，其中一份 Umami Cloud 脚本只负责访问统计，不渲染界面。脚本带 `is:inline` 和 `defer`；不要加 `data-astro-rerun`，也不要在 `astro:page-load` 再调用 `umami.track()`，避免换页重复计数。可选 Oneko 由 `FEATURES.oneko` 控制：布局用 `createOneko` 挂载；`ClientRouter` 换页可能移除 body 上的猫，故在 `astro:page-load` 缺失时重建；详见 [Oneko 像素猫](./oneko.md)。
- `BlogIndexLayout`：导航页面的居中单栏容器。
- `StandardLayout`：文章标题、正文与普通内容排版。

全站没有个人右侧栏；`BlogProfile` 只在首页出现，其下依次是 `WritingHeatmap`、`ProgressStats`、`RecentWriting`、`ScreenTime`、`RecentMedia`、`RecentListening`。导航页统一通过 `BlogIndexLayout` 限制宽度。文章详情使用 `StandardLayout`，TOC 独立放在正文外侧。

顶栏的 `--site-nav-width` 引用 `--blog-shell-width`，与内容版心共用 660px 目标；更多右侧保留剩余空白。内容宽度同时受 `100vw - 两侧外边距` 限制；1200px 及以上再减去 32rem，避免加宽正文时把目录从 208px 挤窄。顶栏与正文同步收窄，小屏两排导航仍受响应式外边距 `--site-gutter` 约束。`--blog-prose-width` 引用版心宽度，标题、正文与返回链接对齐；目录读取同一个 `--blog-prose-width`，在正文边缘与视口外边距之间的留白中线基础上向外移 16px，最大 208px、受视口剩余空间约束。文稿列表卡片的封面列固定为无图 222px、有图 250px，版心宽度变化只进入左侧文字；768px 及以上封面垂直居中，更窄时改为单列并隐藏空封面列。目录与正文读取同一版心宽度。小屏由可用视口宽度约束。

导航是一条有细边框、轻阴影和柔和当前态的居中悬浮条，品牌、页面入口、工具按钮分组。≥800px 为一排，更窄视口为品牌／工具和页面入口两排。用 `top` 与 opacity 隐藏，不在包含搜索面板的祖先上使用 transform 或 backdrop-filter，保证搜索弹窗仍相对于视口定位。

所有页面的初始顶部位置由 `shell.css` 的 `.site-main` 统一维护：桌面顶部内边距 104px，799px 及以下 136px，扣除顶栏占位后留白约 40px／36px。目录点击后的锚点间距仍由 TOC 单独维护，不用初始页面留白推断滚动落点。

### 4.6 导航与首页 seam

`nav-scroll.js` 负责滚动方向与阈值：顶部 80px 内始终显示；同方向累计 18px 后下滑隐藏、上滑显示。`NavBar` 将其结果呈现到 `data-scroll-hidden`，每帧最多处理一次，菜单展开、键盘焦点或搜索打开时保持可见，跨页导航重置。无脚本时导航保持显示；减少动态效果时关闭过渡。

部署层保留 `/blogs/` 的静态列表路由，`vercel.json` 不配置将 `/blogs` 或 `/blogs/` 指向首页的重定向。名称编码分类片段及旧 `#tech`／`#thought`／`#diary` 兼容链接共用此路由，因此部署重定向会同时破坏菜单入口和分类筛选；本地 Astro preview 不读取 Vercel 重定向，构建回归另检查部署配置。

文稿菜单由 `NavDropdown` 保存当前预览分类，只在实际分类链接的 pointerenter／focusin 时切换，鼠标走过行间隙时保留选择；无脚本的 hover／focus 降级仅应用于未绑定脚本的菜单。Escape 的文档级监听关闭已展开菜单，包括鼠标悬停展开但焦点仍在菜单外的情况；只有焦点原本在该菜单内才返回触发链接。浏览器回归脚本为 `scripts/verify-nav-dropdown.mjs`。

顶部分类菜单只读取 `getPublishedBlogPosts`，由 `blog-browser.js` 的 `getCategoryPreviews` 按 `data.category` 原值统计分类，保留每类最多四篇已发布文章预览，发布日期顺序不变；入口按篇数降序，同数按名称的 `zh-Hans-CN` 排序。`draft` 不参与入口、计数或最近文章，是明确的设计决策边界：仅含草稿的分类消失，删除最后一篇已发布文章后对应入口消失；已发布集合为空时类别为空，仅保留“查看全部文稿”链接，不保留固定类别。开发网页列表与正文预览不属于此边界，行为不变。菜单 URL 通过共享 `serializeBlogQuery` 生成。桌面左列与右列各占一格：左列固定间距自上而下，右列只显示当前预览；面板高度取较高的一列，未选中预览不占高度，所以切换分类不移动左列。右列在面板滚动时保持可见，小屏仍逐类排列。写作热力的上海日历与年度汇总在 `blog-heatmap.js`；进度数字在 `progress-stats.js`；近期五篇在 `getRecentBlogPosts`（与列表筛选无关）。近期五篇仅在首页显示。首页板块标题共用 `shell.css` 的 `.home-section-header`，各自内容样式留在组件或共享正文样式；热力提示层的焦点、滚动限高、定时器与监听清理由 `WritingHeatmap` 唯一持有，页面交换前清理。

#### Last.fm 运行时接口 seam

`src/utils/lastfm.mjs` 拥有查询、校验与快照；`api/lastfm.js` 拥有缓存、状态码及错误响应，dev 中间件复用同一处理函数。`RecentListening` 仅输出模板，客户端从接口校验后写入 DOM，以 `content:added` 通知现有陈列架与图片查看器接管。启动顺序、取消请求、资源上限与失败语义见 [Last.fm 设计](./listening.md)。

### 4.7 TOC seam

`FEATURES.toc` 决定开不开、标题层级、左右。
`RenderPost`、`InterestsView` 和 `AboutView` 把 Markdown 渲染返回的 `headings` 交给共享 `Toc`；文章另传 `frontmatter.toc` 作为单篇开关。`Toc` 统一根据全局功能开关、页面开关与标题级别调用 `generateToc` 一次，`generateToc` 拥有级别过滤与父子树生成，结果非空时 `Toc` 才挂载目录；桌面和移动端只呈现同一棵树。正文级别与页面顶部标题的行为约定见 [文章与目录](./site.md#article)。`TocSidebar` 负责高度（不超过 `min(50vh, 28rem)`）和内部滚动。
`DesktopAside` 在 1200px 及以上始终显示目录，无顶部开关；宽度为侧边留白减 48px 与 208px 中的较小值，靠正文一侧至少留 40px、外侧至少留 8px（另有视口外边距）；在正文边缘与视口外边距之间的留白中线基础上向外移 16px，中心比视口中线高 32px。更窄视口继续使用 `MobileTocControl` 浮动入口，展开时通知共享目录逻辑将当前项滚入可视范围。

当前章节由 `src/utils/toc-active.js` 的 `pickActiveHeadingIndex()` 决定：激活线取标题的 `scrollMarginTop`，到页面底部时最后一个标题胜出。`Toc` 唯一维护 `--post-anchor-offset`：导航隐藏时 20px，显示时为导航顶部位置加实际高度再加 12px。`nav-scroll.js` 唯一保存累计滚动状态，`NavBar` 用 `updateNavVisibility()` 更新它；点击前 `Toc` 用 `predictNavVisibility()` 从同一状态预测导航显隐，不消耗累计距离，原生锚点直接消费对应距离；滚动、导航显隐、缩放和字体加载后重新核对同一基准。保留正常 fragment 与历史记录行为，不补播第二次滚动。正文标题仅使用透明度入场，锚点位置不随入场动画变化；无脚本时保留导航可见所需的静态距离。

桌面目录各级标题完整换行；当前项超出内部区域时，`Toc` 将其滚回可视范围。

### 4.8 正文与媒体边界

卡片、gallery／figure、正文大图、HTML 与镜像媒体共用 Markdown 管线，规则与实现集中在 [正文与媒体](./content.md#pipeline)。该文维护插件先后、图片资源与 `|w`、原尺寸 template、Excalidraw、循环轨道、浏览器焦点及滚动锁释放职责；这里不再复制这些规则。

修改 Markdown 插件后，先确认服务属于当前 worktree，再用 `pnpm dev --force` 刷新内容缓存；构建命令已有 `--force`。网页与 RSS 消费同一个集合 `Content`，RSS endpoint 只编排，转换和序列化见 [订阅设计](./distribution.md#rss-design)。

### 4.9 评论 seam

`GiscusComments.astro` 提供可选的 `title`／`description`，调用方只负责挂载位置：`RenderPost` 通过 `BaseLayout` 的 `after-content` slot 放在正文和 `PostNav` 之后、`FriendsView` 的申请说明之后、`InterestsView` 有 `entry` 的分类正文之后。`BaseLayout` 只提供正文之后的通用 slot，不判断评论范围。评论组件自身以 `width: 100%`／`max-width: var(--blog-prose-width)` 复用正文版心，不能依赖外层恰好套有 `BlogIndexLayout`；否则文章标题／正文虽然受 `.prose` 限制，默认 slot 里的评论仍会铺满 `<main>`。

| 规则／状态 | Authority | Interface／调用方 | 证据 |
| --- | --- | --- | --- |
| 仓库与 Discussion 分类 | `config.ts` 的 `GISCUS` | 共享组件读取公开配置 | 构建接线检查 |
| 页面关联键与严格匹配 | `GiscusComments` | `mapping="specific"`，`term` 为编码后的规范 pathname，复用 `ensureTrailingSlash`；`strict="1"` | 每个产物的键与 canonical 路径相同且唯一 |
| 正式站回链 | `Head` 的 `giscus:backlink` meta | 与 canonical 同源，Giscus 消费；本地测试产生的讨论也指回正式 URL | 构建 meta 检查 |
| 按需加载、主题与释放 | `GiscusComments` | custom element 连接／断开；复用 `observeTheme` | 浏览器检查 |
| OAuth、Discussion 创建、评论、错误与 iframe 消息 | 官方 `giscus` Web Component 和 Giscus 服务 | 组件属性；认证和数据持久化由 GitHub 管理 | 真实账号留言验收 |

服务端只产出评论标题、备用 GitHub 链接与 inert template。空闲时预取同域 `giscus` 模块并预连接 giscus.app；IntersectionObserver 使用 `rootMargin: '640px 0px'`，评论进入该范围时挂载 template 内的 widget，iframe 与 GitHub 请求仅在挂载后加载；短页可能无需滚动即挂载。OAuth 的 `?giscus=` 回调跳过可见性等待，由官方组件保存登录结果；官方构造器清理回调 URL 后，本站恢复该条目的 Astro history state，以保留前进／后退语义。模块加载完成后若页面已经离开，不再挂载。每页最多一个 widget，换页断开时取消观察并退订主题；官方组件移除自己的消息监听。亮暗变化只更新 widget 的 `theme` 属性，由官方组件 postMessage 更新现有 iframe；不复制 OAuth 存储与消息协议。

采用官方 Web Component 是为了复用认证、iframe 与事件清理，不直接反复注入长期注册全局监听的 `client.js`。成本是一个按需加载的 `giscus` 依赖及其 Lit 依赖。第三方请求和权限错误由 Giscus 呈现；模块下载失败显示备用入口提示。没有评论缓存、轮询、后端或自动友链写入。路径改变会改变讨论键，域名和临时查询参数不改变它；评论组件始终在 Markdown 正文外，RSS 不消费它。

范围与关联义务由 `verify-blog-restructure.mjs` 在真实静态页面验证，加载／主题／导航／宽度由 `verify-giscus.mjs` 验证；真实 OAuth 与持久化通过账号在评论框发送留言并刷新验收。行为契约见[页面评论契约](./site.md#comments)。

<a id="flow"></a>

## 5. 运行链路

```text
src/content/*                 md / mdx / json
        ↓
src/content.config.ts         集合 + schema
        ↓
astro.config.ts + plugins/*   Markdown 管线（阅读时间、标题 id、外链、图片宽度标记、图片管线…）
        ↓
src/pages/*                   路由
        ↓
layouts                      壳
        ↓
components/views             这一页怎么拼
        ↓
shell.css + src/styles       壳层 + 正文
```

公共样式由 `Head.astro` 统一处理和内联，组件样式继续由 `astro.config.ts` 的 `cssCodeSplit: true` 与 `inlineStylesheets: 'always'` 按页输出。首屏契约、固定顺序与取舍见 §4.4。修改加载方式时，需验证硬刷新与 ClientRouter 跨页导航中的组件样式。

<a id="structure"></a>

## 6. 目录（实现放哪）

```text
src/
  config.ts  types.ts  content.config.ts
  content/   blogs  about  interests  projects  friends
  pages/
  layouts/   BaseLayout  BlogIndexLayout  StandardLayout
  components/
    nav/          顶栏
    blog/         首页作者介绍
    home/         写作热力、近期笔墨、屏幕时间、近期书影游、最近在听
    views/        列表、标签、归档、拾趣、关于、友链、项目
    toc/
    widgets/      搜索、主题、进度
    backgrounds/  dot rose snow
  styles/         正文、Markdown
  utils/
public/shell.css
public/                       站点级资源：favicon、icon-*.png、avatar.webp、og/default.png、fonts/
  demos/<文章短名>/            独立 HTML 交互演示；跨文章复用放 demos/shared/
docs/
  README.md                   按任务查找文档
  guides/                     使用、配置、部署与验证
  design/                     页面、架构、正文、订阅及外部服务设计
  reference/                  框架学习资料
test/
plugins/
```

<a id="pages"></a>

## 7. 各页实现要点

### 首页 `/`

`BlogProfile` 无卡片背景：头像与作者信息作为一组居中，头像右侧的名字与 INTJ 上下两行排列，INTJ 在名字下方，字号为 13px；RSS 居右；下方依次是一行居中的六个 15px 社交图标和独立一行居中的斜体名言「我与我周旋久，宁做我」。图标横向间距为桌面 15px／窄屏 9px，名言较长时在版心内自动换行，没有全站总数。社交入口由 `config.ts` 的 `AUTHOR_LINKS` 维护，名称保留给读屏器和悬停提示。窄屏仍保持作者组居中、RSS 靠右同一行，社交仍为单行、名言在其下方，缩小图标间隔；时间进度标签和数字上下排列。`WritingHeatmap` 放在名片下方，首页随后呈现独立的 `ProgressStats` 三列细时间进度，再显示近期笔墨和屏幕时间。屏幕时间读取已提交的七日聚合快照，数据边界与本机同步见 [设计](./screen-time.md)。标题与近期笔墨左对齐，年份在标题右侧以自定义下拉选择（多一年时；列表在触发器下方展开）；日历按上海时区自然年、周一起始，只计已发布文章。每年摘要显示篇数、字数和有文章的天数。单篇格子是链接，多篇在脚本启用后从提示层进入。`RecentWriting` 在其下显示最近五篇已发布文稿，无卡片底色，标题大小接近正文。`RecentMedia` 再往下渲染 `src/content/interests/recent.md`，不另画边框，宽度跟首页版心走。正文标题和卡片仅使用共享 `prose.css`，没有首页专用覆盖；近期条目使用连续 `:::card{layout="portrait"}` 组成一排，原封面、标题和顺序保留，原评论精简后放入 `meta`，不显示评分或类别角标，作品标题 `href` 直接指向对应 Wiki；不写 `scroll="auto"`，仅手动横滑。标题右侧「全部拾趣」进入拾趣入口。Markdown 标题按原层级分段并保留锚点。该文件排除出拾趣集合，不生成子页。`RecentListening` 接在近期书影游下方展示 Last.fm 听歌排行。首页不显示文章分页或个人侧栏。首页带 `?page=`、`?category=`、`?tag=` 的兼容书签在客户端转到 `/blogs/`。

### 文稿 `/blogs/`

这里的 hash 指 URL 片段，即 `#` 后的分类标识，不是哈希计算。访问 `/blogs/#tech` 只向服务器请求 `/blogs/`；脚本读取片段并执行筛选。归档分类配色由预设池分配并持久记录，见下方归档实现。

首页、列表与归档直接读取 `data.category` 原值，不经过别名合并或固定分类映射；顶部分类菜单只统计已发布内容，分类名称与数量不作为文档快照维护。`ListView` 渲染全部文章节点并预置第一页导航；浏览器按 URL 精确筛选后分页，每页八篇。分类统一使用名称编码，如 `/blogs/#旅行`；旧 `#tech`、`#thought`、`#diary` 仅作为 URL 兼容别名，分别定位原值“技术”“思考”“日记”，不合并其他名称。兼容的 `?category=` 始终按原值精确匹配；任意合法分类 hash 优先于该 query，`categoryFromHash` 负责解码，英文原值 `tech`、`thought`、`diary` 用 `#category=tech` 等形式逃逸。畸形编码回退 query。`ListView` 将旧 query 转成等价 hash，保留其他 URL 参数。首屏内联脚本保守隐藏带非空 hash 的列表，最终分类判定由共享解析器完成，避免先显示未筛选文章。分页保留分类 hash 与标签，前进后退恢复状态；无 JS 时显示全部文章并说明筛选与分页不可用。列表项 `ListItem` 使用响应式图文布局。

### 拾趣 `/interests/`

拾趣各类有独立 Markdown 和静态 HTML，因此使用路径路由；博客分类复用全量文稿 HTML 并在客户端筛选，因此使用 hash。两者表达不同内容结构。

`src/content.config.ts` 扫描 `src/content/interests/` 顶层 `*.{md,mdx}`，排除 `recent.md`；配图目录内的文件不自动成为分类。`interestSchema` 要求非空 `title`、`description` 和非负整数 `order`，不限定分类 ID 或数量，也没有 `draft` 过滤。`[id].astro` 的 `getStaticPaths()` 为集合条目生成静态子页，因此新增文件在重新构建后自动加入页面、入口与菜单。入口页按 `order` 升序展示分类链接；首页近期书影游只读取 `recent.md`，该文件不生成子页或菜单项。分类子页把 `render(entry)` 返回的 `headings` 交给共享 `Toc`，无符合级别的正文标题时不挂载目录。

`InterestsView` 在 `/interests/<id>/` 只渲染该分类的内容，页面标题直接使用分类名。入口和顶部下拉菜单读取同一份集合元数据，内容无需 JS 即可阅读。`NavDropdown` 仅在 `INTEREST_ICONS` 自身含该 ID 且图标非空时输出图标节点，不读取原型链，无图标分类保留文字与链接、不留占位；`unocss.config.ts` 自动将映射值加入 safelist。分类增加后仍需检查菜单换行、窄屏边界与内部滚动。

入口与子页均使用点状背景。当前内容包括设备、动漫、电影、电视剧、游戏、书与 Kpop，分类列表和说明可以随内容调整。电影、电视剧、动漫、游戏的条目用默认 `:::card`，按容器宽度自动分列，当前版心最多两列。作者可按需填写 `score`，不由观看／游玩状态决定；未填写时不生成评分。书页使用竖卡，原作者姓名放在 `meta`、不显示评分；内容按类型用三级标题分组，每类独立一排横滑栏，组内保留原顺序，封面位于 `src/content/interests/book/`；当前版心大约四本半显示并继续横滑。封面放在对应分类子目录，仍走图片管线。

### 标签 `/tags/`

`TagFilter` 汇总标签。`ListView requireTags`：一篇不选则列表隐藏。排序（数量 / 名称）不得改已选集合。多选 AND，再点取消。防连点有 debounce。文章标题下、归档标题下和文稿列表卡片的 `#标签名` 链接到 `/tags/?tag=`，页面加载后只选中该标签；链接形状由 `tagSelectionLinks` 生成，不在组件里另写查询串。

排序控件以 `aria-pressed` 为唯一选中状态，CSS 伪元素在两个等宽按钮间滑动，选中底色为主题文字色、文字为背景色；未选中项悬停使用灰底。键盘焦点可见，减少动态效果时取消过渡；排序只重排现有标签，不新增一份选中状态或测量规则。

### 全站搜索

`SearchSwitch` 负责搜索、键盘选中、结果跳转与加载分页逻辑，`Backdrop` 负责关闭。搜索面板、输入框、结果、快捷键和遮罩的视觉样式统一放在静态加载的 `public/shell.css`，避免面板背景和阴影依赖未生效的工具类。面板使用主题的实色背景、边框和阴影；遮罩压暗并模糊页面，结果摘要与快捷键使用明确的次级文字颜色，选中结果有底色及左侧标记。手机端保留快捷键提示，长结果只在面板中间区域滚动；减少动画设置下关闭过渡。

Pagefind **按需加载**：面板打开时调 `window.ensurePagefind()`（打开与输入两处触发，带 memo），否则不拉 `pagefind.js` 与 worker；`pagefind-highlight.js` 只在带 `?search=` 的页面加载于 `astro:page-load`。没打开过搜索的访问因此零 Pagefind 请求。

面板声明了 `role="dialog" aria-modal="true"`，所以 Tab 在面板内循环（`SearchPanel.#handlePanelTab`），退出靠 Escape 或点击遮罩，两者都会把焦点还给搜索按钮。结果项是 `role="option" tabindex="-1"`，用方向键选择，并用 `aria-activedescendant` 把当前高亮项报给读屏器。

开发模式搜索仍使用模拟数据；真实 Pagefind 搜索需先 build，再在 preview 中验证。

### 归档 `/archives/`

`ArchiveView` ← `getGroupedPostsByYear`。点线 + 年份空心圆 + 文章小点。年份与日期位于时间线左侧，日期在列内右对齐并靠近时间线；日期、标记和标题首行共用 24px 高度。每篇文章的标签在标题下方自然换行，每个 `#标签名` 是只选中该标签的链接；标题下划线跟文字走，不拉满格子。

`blog-category-colors.js` 是分类配色的唯一属主，数据在 `src/data/blog-category-colors.json`：`palette` 初始提供 16 个不同色相的配色 ID，`assignments` 保存分类原值到 ID 的已领取映射。浅色主题统一 32% 饱和度／36% 亮度，深色 32%／72%；当前技术／思考／日记保留蓝／暖红／青色。`ArchiveView` 获取按年分组后，把实际呈现的分类集合交给 `syncCategoryColors`，它保留全部历史分配，将同批新名称去重、按字典序排列，依次领取预设池中未占用的 ID，容量不足先报错而不修改记录。只有有新分配时才将完整 JSON 写入同目录临时文件并替换旧记录；随后 `getBlogCategoryColors` 从这份结果中取得颜色。页面只将深浅颜色写入 CSS 变量，`shell.css` 选择当前主题并呈现徽标，宽度最多占标题行的 40%，长名称换行。模块仅在服务端使用，不进入浏览器筛选代码。

本地访问归档或构建时会自动补充映射，开发归档中的草稿分类也计入；记录必须与新分类文章一起提交，CI／Vercel 不会自动提交生成的映射。删除分类不释放颜色，重新出现沿用原色；改名视为新分类。池耗尽、配置无效或重复、记录读写失败都明确失败；补充不同整数色相的新预设后可重试，不重置已有分配。不同颜色值不代表都能肉眼区分，分类文字仍保留。记录按本地单写者维护，不支持并发进程分配；不新增数据库、监听器、客户端状态或自动改名迁移。

分类与 URL、预览数量、编码冲突和空集合由 `test/blog-browser.test.mjs` 验证；预设唯一性、已有颜色不变、持久化、容量耗尽不部分写入及补充预设后的恢复由 `test/blog-category-colors.test.mjs` 验证。构建菜单检查核对当前已发布集合中的原值分类、计数及排序、每类最多四篇预览的已发布链接，并核对名称编码 hash 链接与归档徽标变量，验证数据到页面的接线。

### 项目 `/projects/`

页头由共享 `PageHeading` 展示「项目／我的项目与开源实践。」；`GroupView` ← `projects` JSON。`icon` 可选。分类字符串来自数据，组件不写死类名；`GroupView` 用无原型字典分组，`constructor`、`__proto__` 等名称不与内建属性冲突，每条项目保留一次。分类标题及局部样式也由 `GroupView` 维护。卡片网格由 `GroupItem` 固定两列（`repeat(2, minmax(0, 1fr))`），宽度随版心伸缩，不因窄屏收成单列。

### 关于 `/about/`

页头由共享 `PageHeading` 展示「关于／关于我，也关于这个博客。」；`AboutView` 只读取 `about/about.md`，无子页面按钮、隐藏面板或切换脚本。关于内容仅维护 `about.md`；`AboutView` 将渲染返回的 `headings` 交给共享 `Toc`，无符合级别的标题时不显示目录。设备与兴趣内容由拾趣集合提供。关于页不放背景。首页社交链接由 `AUTHOR_LINKS` 独立维护，关于正文不必重复社交链接。

### 友链 `/friends/`

卡片交互样式由 `FriendsView` 维护：悬停／键盘焦点时头像放大 10%，头像和外边框使用 35% 主题强调色柔光，无实色光圈；离开后以 180ms 过渡复原，减少动态偏好下取消过渡。黑夜卡片背景为纯黑。

`FriendsView` 按数据 `category` 分成「推荐」「双向」两组，宋体小标题配简短说明。「推荐」是单向收藏，「双向」是已交换友链；schema 限定这两个值，避免无效分组被静默漏掉。组内按 `order`／名称排序并展示卡片；卡片网格固定两列、宽度随版心伸缩，窄屏不收成单列。底部由 `FriendsApplyPanel` 展示交换说明。920px 以上说明和参考格式各占一半并等高，更窄时上下排列；说明里的 PR 按钮靠底，模板代码横向滚动。交换友链标题使用普通无衬线字体、700 字重。规则是“先友后链”和“使用 https 协议”。

### 文章 `/blogs/[slug]/`

`RenderPost` + 常驻右侧 TOC。最大高度 `min(50vh, 28rem)`，水平位置在侧边留白中线基础上向外移 16px、中心比视口中线高 32px，超出内部滚动；窄屏使用浮动目录按钮。文章主标题独立渲染，封面作者头像 40px。

页脚由 `Footer.astro` 用宋体显示版权、Astro 与“萌ICP备20269668号”；启用 Oneko 时另有「隐藏小猫」按钮（左侧装饰性 `🐾`）。宽屏段间用次要字色 `·` 分隔，窄屏纵向堆叠并隐藏分隔符。作者名、Astro 和备案都是带下划线的链接：作者名指向站点首页，Astro 指向 `https://astro.build`，备案指向 `https://icp.gov.moe/?keyword=20269668` 并在新标签页打开。悬停或键盘焦点时链接变为强调色。窄屏纵向排列，备案入口不隐藏。

<a id="utilities"></a>

## 8. 工具模块

| 模块 | 界面（调用方该用的） |
| :--- | :--- |
| `data.ts` | 过滤、排序、分组、近期五篇 |
| `blog-heatmap.js` | 上海日历日、强度、年份范围、年度字数与字数缺失／非法失败 |
| `blog-browser.js` | 原值分类动态入口与预览、URL 兼容别名与精确筛选状态、分页 |
| `blog-category-colors.js` | 预设校验、分类配色领取与持久化、耗尽失败 |
| `blog-tag-filter.js` | 标签计数、AND |
| `blog-stats.js` | 可读字数统计与「万」格式 |
| `progress-stats.js` | 年积日、年进度、日进度 |
| `recent-post-date.js` | 「n 天前」 |
| `canvas-size.js` | canvas 后备存储尺寸与 2× DPR 上限 |
| `toc.ts` | 桌面／移动目录共用的层级树；优先延续已有父级，仅在实际跳级时补空项 |
| `toc-active.js` | 当前章节判定（`pickActiveHeadingIndex`） |
| `nav-path.js` | 路径归一化、下拉类型与父级选中 |
| `nav-scroll.js` | 共享累计滚动状态、显隐更新与只读预测 |
| `sliding-indicator.js` | 指示条几何与过渡起点 |
| `reduced-motion.js` | 减少动效闸门（`createReducedMotionGate`，Dot / Snow 共用） |
| `accent-palette.js` | `ACCENT_PALETTES`、`accentPaletteStyles()`、`createAccentPreference()`：配置、变量和偏好属主 |
| `theme-observer.js` | 订阅实际主题变化并返回清理函数，Dot / Snow 共用 |
| `misc.ts` | `lockScroll()` 提供带滚动条补偿、恢复先前样式的 release；backdrop 和图片查看器复用 |
| `image-interactions.ts` | `ImageInteractions` 自定义元素；唯一管理横滚控件、原生 dialog（含正文大图相册翻页）与连接／断开资源 |
| `path.ts` | `withBasePath`、`resolvePath` |

数据与算法检查直接调用这些接口；导航事件、目录定位等 DOM 行为在其组件属主接口和真实浏览器中验证，不用纯函数通过来代替页面接线检查。

<a id="extension"></a>

## 9. 后续怎么加功能（按 seam 选点）

| 你想… | 动哪里 | 不要 |
| :--- | :--- | :--- |
| 新写一篇文章 | `src/content/blogs/`；正文图 `src/content/blogs/<名>-img/`；标题图 `src/content/blogs/_title-images/`；本地视频／音频放文章旁用相对路径 | 改路由；把图片放进 `public/`；手工复制视频到 `public/` |
| 新增／修改拾趣分区 | `src/content/interests/<id>.md`（或 `.mdx`），填写 `title`／`description`／`order`，重新构建 | 改导航数组、手写路由或在组件里复制文案 |
| 为拾趣分类补图标 | `src/config.ts` 的 `INTEREST_ICONS`；不配置即纯文字菜单 | 给无图标分类补占位或手工复制 safelist |
| 改顶栏链接或顶栏 GitHub | `src/config.ts` | `NavBar.astro` |
| 开关或换装 Oneko 像素猫 | `src/config.ts` `FEATURES.oneko`；说明 [Oneko 像素猫](./oneko.md) | 拷贝 CDN 进 `public/`，或在多处重复挂载 |
| 改个人社交名字或链接 | `src/config.ts` 的 `AUTHOR_LINKS`；若关于正文也展示同一联系方式，再同步该字段 | 改顶栏 `UI.socialLinks` |
| 改分页大小 | `blog-browser.js`、`ListView.astro` 首屏 CSS、测试 | JS 常量与 `nth-child(n + 9)` 的镜像 |
| 改写作热力的日期、年份或年度字数口径 | `src/utils/blog-heatmap.js` | 在 `WritingHeatmap.astro` 里重算日期或字数 |
| 新增居中导航页面 | 新页套 `BlogIndexLayout` | 复制版心宽度 |
| 增加或调整点缀配色 | `src/utils/accent-palette.js` 的 `ACCENT_PALETTES`；首项为默认 | 在组件或 CSS 复制配色表与默认判断 |
| 改导航/布局样子 | `public/shell.css` | 只改组件 style |
| 调整 gallery／figure 语法与结构 | `plugins/remark-image-layouts.ts`，同步正文设计／示例及属主单测 | 让 widget／RSS 再判断结构，或改变原有 `|w` 语义 |
| 调整正文图放大、大图相册翻页或横滚控件 | `src/utils/image-interactions.ts`，样式在 `prose.css`；契约见 `docs/design/content.md` | 在 `ImageInteractions.astro` 复制交互、另起 lightbox，或扩大到 `titleImage` 头图／文稿列表缩略图、头像 |
| RSS 正文表达 | `rss-content.js`，endpoint 只编排 | 在 Head 拼 XML、解析第二次 Markdown 或抓网页 |
| 新社交图标不显示 | `unocss.config.ts` `safelist` | 怪 `NavItem` |

<a id="verification"></a>

## 10. 校验

仓库检查命令、构建产物检查和真实浏览器脚本用法统一见 [开发与部署指南](../guides/development.md#verification)。模块测试在自己的界面验证规则；纯函数通过不代表 DOM 接线、OAuth、CDN 缓存或真实阅读器已通过验收。正文与订阅的详细映射见各自设计文档。
