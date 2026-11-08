# Last.fm 听歌：运行时接口与展示

配置入口见 [开发与部署指南](../guides/development.md#services)。

## 行为契约

首页在近期书影游下方是「近期在听」，分上下两块：上面是正在播放卡片与最近播放列表，下面是专辑封面墙。两块数据都在访问时由运行时接口取得，构建产物里没有任何听歌数据；标题右侧「Last.fm ↗」直接来自站点身份常量，不依赖接口。

**正在播放与最近播放**（`GET /api/lastfm-now`，CDN 缓存 30 秒，页面可见时每分钟刷新一次，离开首页即停止）：取 `user.getRecentTracks` 的前六条。第一条进卡片：封面（背后露出一张唱片，播放时缓慢转动）、状态、歌名、歌手和专辑；Last.fm 只标记 `nowplaying`，不提供进度或开始时间，所以不画进度条，正在播放时显示跳动的均衡器与「正在播放」，否则显示「最近播放 · N 分钟前」。其后五首是列表：小封面、歌名、灰色歌手、点线引导和贴右缘的相对时间。区块宽度足够时卡片在左、列表在右，窄于 34rem 时卡片在上、列表在下且卡片改为封面与文字横排。只有一首记录时不显示列表，卡片单独占一列。加载时是同尺寸骨架；首次加载失败或账户没有记录时整块收起，之后的轮询失败保留上一次结果；无脚本时隐藏。

**封面墙**（`GET /api/lastfm`，CDN 缓存 1 小时）：顶部一行左侧是 `7d`／`30d`／`1y`／`all` 时段切换（默认 30d），右侧是累计 scrobbles。下面是四列方格，按播放次数排前九张专辑：#1 占 2×2，常驻显示「#1 · 时段」、专辑名、歌手和右下角大号次数；其余格子左上角是名次、左下角是次数，悬停或键盘聚焦时浮出「#名次 · N 次」、专辑名和歌手。缺封面的格子用浅斜纹底，专辑名和歌手常驻可见。少于九张时只放实际数量，其余位置留空。格子是指向 Last.fm 专辑页的链接，读屏文本包含名次、专辑、歌手和次数。墙下一行左侧是「30 天里听了 N 张专辑 · 这 K 张共 M 次」（全部时段为「一共听了」），右侧贴缘是更新时间（北京时间）。切换时段只重绘同一份快照，不再请求接口。

封面墙区块有五种状态：加载中（九格骨架，`#1` 位置占 2×2，轻量脉冲；`prefers-reduced-motion: reduce` 时静止；时段按钮禁用，累计数为 `—`）、就绪、当前时段为空（`7 天里还没有听歌记录。`，其它时段仍可切换）、整个账户为空（`还没有听歌记录。`）、失败（`暂时无法获取听歌数据。`，按钮保持禁用）。无脚本时保留骨架并显示说明文字，指向 Last.fm 主页。汇总行在加载时也占住一行高度；九张专辑的快照就绪时区块高度不变，替换骨架时先插入新节点并读取一次 `offsetHeight` 提交布局，再移除旧节点，已经滚到页尾时滚动位置不变。时段专辑少于九张时网格变矮，这是区块在页面底部、可接受的变化。

| 义务 | 不变量与失败结果 |
| --- | --- |
| L1 排行 | 每个时段用 `user.getTopAlbums`（`7day`／`1month`／`12month`／`overall`）取前九张，顺序以 Last.fm 为准；专辑总数来自同一响应的 `@attr.total`；累计数来自 `user.getInfo` |
| L2 最近播放 | `user.getRecentTracks` 前六条；只有第一条可能是正在播放，其余必须带播放时间 |
| L3 封面 | 先用 Last.fm 自带图（过滤空图、通用占位图与其它域名）；缺图时按名称与歌手搜索网易云，名称与歌手都对得上才采用；仍然没有就显示占位，不伪造数据 |
| L4 运行时获取与缓存 | 数据只在请求时取得；同一地址对应一份缓存。Last.fm 关键查询、响应校验失败时接口返回 502，缺少密钥返回 503，两者都不写入缓存。网易云失败只让对应条目缺图，不影响接口状态 |
| L5 页面呈现 | 接口响应先校验再写 DOM，不使用 `innerHTML`。时间、次数、名称、歌手、链接不合格或时段不全时整份按失败处理；封面不合格只当缺图。键盘可聚焦，深浅主题可读，无 JS 保留骨架与说明 |
| L6 凭据 | API Key 仅来自环境变量，不能进入源码、响应、构建 HTML 或日志；构建与页面渲染都不访问 Last.fm 或网易云 |
| L7 启动与导航 | 首页听歌模块先于 ClientRouter 等模块执行；非首页不请求听歌接口。离开首页取消未完成请求和时段切换监听，返回后重新加载，已取消请求不能覆盖新请求的状态 |

API 多次查询期间用户仍可听歌，不提供跨接口事务一致性；缓存窗口内的访问看到的是同一份数据。每次 Last.fm 请求限时 15 秒，单次失败即终止整份快照，不重试。一次快照最多 5 个 Last.fm 请求（`user.getInfo` 加四个时段的 `user.getTopAlbums`）和 36 次网易云搜索；一次正在播放最多 1 个 Last.fm 请求和 6 次网易云搜索。

### 网易云封面回退

只在 Last.fm 没有可用图时触发：封面墙按专辑搜索（`type=10`），最近播放按单曲搜索（`type=1`），搜索词用去掉括号注记后的名称加歌手（注记会把结果带偏，例如「0.5x (零点五倍速)」搜不到「0.5x」），各取前五个候选。名称与歌手先统一全半角、大小写并去掉空白和标点，原名或去掉括号注记（版本、译名、Live）后的名字相等，或较短一方长度不少于另一方的 60% 且被其包含，才算对上（「陈小满」与「陈小满阿」算，「Lin」与「Linkin Park」不算）；歌手同时比对网易云给出的别名与译名；Last.fm 把合作歌手写成一串（「Rosalía, The Weeknd」）时，按逗号、`&`、`feat.`、`x` 等拆开，任一位对上即可。只接受 `p*.music.126.net` 图片，改为 https 并按 300px（大格用 600px）请求缩略图。

每次搜索限时 2.5 秒，同名同歌手的条目由查找器合并成一次搜索，最多六个查找并行；整个回退阶段最多等 2.5 秒，到时仍缺图的条目保持缺图、接口照常返回，迟到的结果不再写入本次响应；若函数实例在响应后仍在运行，结果可能留在缓存里给下一次请求，但不作保证。结果在函数实例内存里缓存：命中和「确认搜不到」缓存 30 分钟，超时、网络错误或异常响应缓存 1 分钟，避免网易云不可用时每次回源都再等一遍超时；缓存最多 500 条，超出时淘汰最早的条目。冷启动的实例从空缓存开始。这份缓存只在服务端，不进浏览器，也不增加页面体积；浏览器侧只看到接口的 CDN 缓存和图片本身的缓存头。

可接受取舍：网易云搜索是非官方接口，可能改版、限流或拒绝海外请求，此时退化为 Last.fm 原有的缺图表现；匹配规则宁缺毋滥：网易云没有收录的歌曲（例如部分欧美曲目）、繁简写法不同的名称，以及网易云上歌手名与 Last.fm 差异较大且没有别名（例如英文名与中文名）时，都会保持缺图。构建产物不含听歌数据，所以首屏（以及无脚本、接口失败的访问）没有可读内容，爬虫也拿不到这部分；冷缓存的一次访问要等 Last.fm 和可能的网易云查询完成，1 小时缓存承担其余访问，定时暖请求只降低访客撞上冷回源的概率。

不提供播放进度、音乐播放、听歌时长、用户切换、任意第三方搜索入口或大图查看器。

## 架构与 authority

```text
访问首页 → RecentListening.astro：卡片与列表骨架 + 时段按钮 + 九格骨架
         → Head.astro 中的 RecentListeningScript.astro（首个模块）
             → GET /api/lastfm-now → parseNowPlayingPayload / renderNowPlaying
             → GET /api/lastfm     → parseListeningPayload / renderListening（切换时段时重绘）
         → api/lastfm-now.js、api/lastfm.js（Vercel 函数）
             → src/utils/lastfm.mjs：查询、校验、排行、最近播放、封面来源
                 → src/utils/netease-cover.mjs：网易云搜索、核对与 30 分钟实例缓存
本地 dev：同一处理函数由 plugins/astro-listening-endpoint.ts 挂到 Vite 中间件
```

| Rule/state/error/resource | Authority module | Interface/seam | Callers | Evidence |
| --- | --- | --- | --- | --- |
| L1、时段列表、API 错误与请求上限 | `src/utils/lastfm.mjs` | `fetchLastfmSnapshot({ apiKey, user, now, fetchImpl, findCover })` → `{ updatedAt, totalScrobbles, periods }` | 接口处理函数、单测 | `test/lastfm.test.mjs` |
| L2 | 同上 | `fetchLastfmNowPlaying({ apiKey, user, fetchImpl, findCover })` → `{ playing, tracks }` | 同上 | `test/now-playing.test.mjs` |
| L3 Last.fm 图片识别、何时回退、并发上限与 2.5 秒总等待 | 同上 | 两个函数共用；`findCover` 是可注入的 seam | 同上 | 两个属主单测 |
| L3 网易云匹配、图片域名、超时、同名同歌手合并与缓存 | `src/utils/netease-cover.mjs` | `createNeteaseCoverFinder({ fetchImpl, now })` → `findCover({ kind, name, artist })` 解析为不带尺寸参数的图片地址或 null，从不 reject；`neteaseSized(url, size)` 按调用方给的边长取缩略图；模块级 `findNeteaseCover` 为实例内共享 | `lastfm.mjs` | `test/netease-cover.test.mjs` |
| 用户身份、主页地址 | `src/utils/lastfm.mjs` | `LASTFM_USER`、`lastfmProfileUrl(user)` | 组件页头链接、适配器 | 产物检查 |
| L4/L6、状态码、错误净化 | 两个接口共用 `api/_lastfm-response.js`；各自的缓存窗口在 `api/lastfm.js`／`api/lastfm-now.js` | `handleListening`／`handleNowPlaying(request, options)`；默认导出读取环境变量 | Vercel、dev 中间件、单测 | `test/listening-endpoint.test.mjs`、`test/now-playing.test.mjs` |
| L4 部署前提：根目录 `api/` 被收集为函数 | `vercel.json`（`framework: null`、`buildCommand`、`outputDirectory`） | 平台按 Other 预设构建，静态产物仍是 `dist` | Vercel 部署 | 预览部署的接口响应 |
| 本地 dev 提供同一接口 | `plugins/astro-listening-endpoint.ts` | 在 `/api/lastfm`、`/api/lastfm-now` 调用同一处理函数；密钥取环境变量或 `.env` | `pnpm dev` | 本地 `curl` 检查 |
| L7、请求启动顺序、导航取消、时段切换监听 | `src/components/home/RecentListeningScript.astro` | `Head.astro` 在 ClientRouter 前输出；`astro:page-load` 加载、`astro:before-swap` 取消（同一个 `AbortSignal` 也移除点击监听） | 首页与站内导航 | 产物脚本顺序检查、`verify-listening-startup.mjs` |
| 时段、封面墙张数与最近播放条数 | `src/utils/recent-listening.js` | `PERIODS`（键即 Last.fm period，顺序即请求、响应与按钮顺序）、`COLLAGE_SIZE`、`RECENT_SIZE` | 适配器按它请求，组件按它画骨架与按钮，校验按它截断 | 端点单测用页面校验器解析适配器输出 |
| L5 响应校验、时段文案、卡片／列表／封面墙渲染、骨架替换 | `src/utils/recent-listening.js` | `DEFAULT_PERIOD`、`parseListeningPayload`、`parseNowPlayingPayload`、`playedAgoLabel`、`renderNowPlaying`、`renderListening(root, snapshot, period)` | 组件（时段按钮文案）、脚本 | `test/recent-listening.test.mjs` |
| L5 骨架、布局、样式与无脚本说明 | `src/components/home/RecentListening.astro` | 容器查询切换两栏／堆叠；四列网格与 2×2 #1；运行时插入的节点由全局样式覆盖 | `index.astro` | built 首页检查、`verify-listening.mjs` |

接口响应只包含页面需要的字段：快照为 `updatedAt`、累计数和四个时段（`key`、`albumTotal`、至多九张专辑的名称、歌手、Last.fm 链接、次数、300px 与 600px 封面）；正在播放为 `playing` 与至多六首（名称、歌手、专辑、封面、链接、播放时间）。外链由属主从名称／歌手生成。页面侧的校验只要求可渲染的形状（名称非空、计数为非负安全整数、链接与封面为 HTTPS、时间可解析、时段齐全且顺序一致），封面来源仍由适配器负责。

封面是远程图片：Last.fm 图片路径的尺寸段可以换成任意边长，封面边长（300px 与 600px）由适配器决定，Last.fm 换路径里的尺寸段，网易云经 `neteaseSized` 改 `param=NyN`。列表和小格用 300px，#1 大格用 600px，都是懒加载的固定宽高 `img`，不把封面下载进仓库，也不要求构建联网。

## 配置与运行

环境变量、Vercel 预设和本地 `.env` 见 [开发指南](../guides/development.md#services)。网易云回退不需要任何凭据。首页标题和无脚本说明里的主页链接在构建时读取 `src/utils/lastfm.mjs` 的 `LASTFM_USER` 常量，环境变量不会改写它。

本地 dev 与线上共用处理函数已定义的状态码，没有密钥时同样返回 503；dev 中间件自身出错时另返回 500。`pnpm preview` 不提供这个接口。仓库用 GitHub Actions（`.github/workflows/warm-lastfm-cdn.yml`）每小时（UTC 第 23 分）请求一次正式站 `/api/lastfm` 以暖 CDN，也可手动触发；这不替代按需回源，也不把听歌数据写进仓库。

## 验收证据

| Obligation | Test / 验证层级 | 原因 |
| --- | --- | --- |
| L1 时段、前九张、专辑总数、累计数，空账户 | 属主单测，注入固定响应 | 不依赖真实账户变动 |
| L2 正在播放与最近五首、播放时间 | 属主单测 | 区分正在播放与已记录播放 |
| L3 何时回退、并发上限、超出总等待后保持缺图 | 属主单测，注入 `findCover`、Promise 闸门与模拟定时器 | 不以真实耗时断言并发与时限 |
| L3 网易云匹配、拒绝错配与外域图片、并发查找合并、30 分钟缓存、失败缓存 1 分钟 | `test/netease-cover.test.mjs`，注入假上游与时钟 | 直接检验匹配与缓存语义，不需要真实网络 |
| L4/L6 缓存头、状态码、失败不外泄、地址与方法的边界 | 端点单测，注入假上游 | 直接检验缓存与失败语义 |
| 接口输出能被页面校验接受 | 端点单测调用 `parseListeningPayload`／`parseNowPlayingPayload` | 跨模块 seam，形状漂移会立刻失败 |
| L5 渲染：时段切换、#1 大图、缺封面文字格、汇总、空／失败状态与时段按钮可用性、轮询失败保留 | `test/recent-listening.test.mjs`（最小 DOM） | 不依赖浏览器即可覆盖渲染分支 |
| L5 骨架结构 | `test:built-restructure` 的首页契约检查 | 覆盖生成 HTML：五行列表骨架、九格骨架、禁用的时段按钮、无脚本说明 |
| L5 布局与交互 | `scripts/verify-listening.mjs`（真实浏览器，固定载荷） | 只验证需要真实浏览器的部分：1440／390／320px 的两栏与堆叠、版心缘线、方格与 2×2、悬停浮出、真实点击切换时段且不重复请求、页尾替换不跳动、失败与空数据时脚本接线离开加载态、无 JS 时正在播放被隐藏 |
| L5 Safari 页尾位置稳定 | `scripts/verify-listening-safari.mjs`（macOS Safari，固定载荷） | 骨架时滚到底部后放行数据，断言页高、滚动位置和区块可见 |
| L7 首个模块与独立启动 | built 首页检查、`scripts/verify-listening-startup.mjs`（暂扣 ClientRouter 响应） | 页面不等无关模块就能请求并呈现；站内往返时请求次数正确 |
| 完整仓库门禁 | format、lint、check、test、build、built 检查 | 核对现有页面与内容回归 |

浏览器检查脚本在 Ego TaskSpace 中运行，先把脚本里的 `__TASK_SPACE_ID__` 和 `__BASE_URL__` 换成实际值。Safari 回归需先启动本地开发服务，再运行 `node scripts/verify-listening-safari.mjs http://127.0.0.1:4322/`（地址改为实际服务地址）；脚本通过临时本地代理注入固定数据，完成后关闭新开的 Safari 窗口。

部署后需另行核实两个接口的成功响应、CDN 命中、真实冷请求耗时、网易云在部署区域是否可用，以及 `stale-if-error`／`stale-while-revalidate` 行为。固定载荷和假上游测试不代表当前部署已经通过这些验证。
