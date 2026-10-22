# Last.fm 听歌：运行时接口与展示

配置入口见 [开发与部署指南](../guides/development.md#services)，通用卡片与图片交互见 [正文与媒体](./content.md)。

## 行为契约

首页在近期书影游下方保留「最近在听 TOP10」。区块由服务端输出的加载态骨架（十张方卡形占位）和一张卡片模板组成；听歌数据在访问时由运行时接口取得，构建产物里没有任何听歌数据。接口成功后区块呈现过去七天 TOP 10 歌曲（封面、歌名、`歌手 - 专辑名`）与辅助统计（七天听歌次数、累计记录数、七天最常听歌手）和更新时间；标题右侧「Last.fm ↗」直接来自站点身份常量，不依赖接口。歌曲保持单行。首页这条轨道不是滚动容器：超出部分始终裁切，由循环把卡片从一端送回另一端，两端淡出；按下或键盘聚焦轨道时暂停，悬停继续。减少动态效果时循环和淡出停止，轨道仍然只裁切、不出现滚动条。无脚本时轨道保持骨架，不改成可横滑。点击封面或键盘 Enter／空格可用现有查看器打开 Last.fm 原尺寸图片，关闭后恢复到相应源卡片的焦点（循环副本不增加重复焦点入口）。歌名展示区最多两行，小字沿用陈列架两行限高；骨架与真实卡片共用可容纳两行歌名、两行说明及间距的文字区高度，短文案和缺封面也不收缩。

区块只有四种状态：加载中（十张不可聚焦的方卡形骨架占位，轻量脉冲；`prefers-reduced-motion: reduce` 时静止；统计与时间显示占位 `—`）、就绪（统计、卡片、更新时间；骨架被清空）、真实空数据（`过去 7 天还没有听歌记录。`，隐藏卡片区）、失败（`暂时无法获取听歌数据。`，隐藏卡片区）。无脚本时保留骨架卡并显示说明文字，指向 Last.fm 主页。封面仍按既有 `img` 懒加载，不为图片另做第二套骨架；真实卡片的封面容器延续骨架底色，避免接口就绪后、远程图片尚未下载时露出透明空框。

听歌轨道不使用正文陈列架的横向滚动条，加载、就绪、减少动态和无脚本都保持裁切，因此数据就绪不会先出现滚动条再关掉。统计项按内容宽度紧凑排列，600px 及以下为两列且歌手独占第二行；每项保持单行，过长内容省略显示，原值保留在正文及悬停提示中。加载到非空数据就绪时，区块高度、统计行、卡片轨道与更新时间的位置保持稳定；已经滚到底部时，先插入新卡片，通过一次 `offsetHeight` 读取完成布局，再移除骨架，保持页尾滚动位置不变。真实空数据和失败仍收起卡片区。

听歌接口只接受不带查询参数的 `GET /api/lastfm`；其它方法返回 405（`Allow: GET`），带查询参数返回 400。成功响应由 CDN 缓存 30 分钟，过期后 5 分钟内先返回旧数据并在后台刷新，上游出错时最多再沿用一天旧数据。失败响应一律不缓存。 仓库用 GitHub Actions（`.github/workflows/warm-lastfm-cdn.yml`）约每 25 分钟（UTC）请求一次正式站该地址以暖 CDN，也可手动触发；这不替代按需回源，也不把听歌数据写进仓库。

| 义务 | 不变量与失败结果 |
| --- | --- |
| L1 排行 | 使用 `user.getTopTracks` 的 `7day`，最多十首；不以最近播放顺序或 TOP 10 次数之和代替排行与周总数 |
| L2 统计 | 七天次数来自固定 UTC 起止时间的 `user.getRecentTracks` 总数；不包含正在播放；累计来自 `user.getInfo`；常听歌手来自 `user.getTopArtists` 的 `7day` 第一项 |
| L3 专辑资料 | 从窗口内最近一次匹配歌手与歌名的已记录播放获取专辑；缺专辑显示「专辑信息暂缺」；无可用封面显示音符占位，不伪造数据 |
| L4 运行时获取与缓存 | 数据只在请求时从 Last.fm 取得；同一地址对应一份缓存。关键查询、响应校验失败时接口返回 502，缺少密钥返回 503，两者都不写入缓存，页面进入失败状态 |
| L5 页面呈现 | 接口响应先校验再写 DOM；任何字段不合规都按失败处理，不用可疑字段渲染部分结果。键盘可聚焦并浏览，深浅主题可读，无 JS 保留骨架与说明 |
| L6 凭据 | API Key 仅来自环境变量（Vercel 环境变量或本地 `.env`），不能进入源码、响应、构建 HTML 或日志；构建与页面渲染都不访问 Last.fm |
| L7 启动与导航 | 首页听歌模块先于 ClientRouter 等模块执行，不等待无关模块的网络依赖；非首页不请求听歌接口。离开首页取消未完成请求，返回后重新加载，已取消请求不能覆盖新请求的状态 |

API 多次查询期间用户仍可听歌，不提供跨接口事务一致性；时间窗以请求开始时的秒级 UTC 时间为准。缓存窗口内的访问看到的是同一份数据。

同步仅读取七天内的播放记录，每页最多 200 条、最多十页，找到所有排行歌曲的专辑后提前结束。资料超过扫描范围时显示缺失专辑，不截断排行或周总数。每首缺封面的歌曲最多查询两次专辑：原名，以及去掉末尾 `Explicit`／`Deluxe Version` 等版本标签的基础专辑名；只补封面，展示仍保留真实播放记录的专辑名。使用基础专辑封面是可接受取舍，不能保证豪华版专用封面。每次 API 请求限时 15 秒，最多 33 次，无无限重试。

每次快照补封面时按最多三首一批并行处理；同一歌手与同一专辑（含原名和基础版回退）共享该次快照内的查询 Promise，失败或缺图结果也不重复请求。复用表最多二十项，随快照调用结束释放，不引入跨请求缓存。版本名回退仍按原名、基础版的顺序执行，完成顺序不改变排行；畸形响应仍让整个快照失败。

可接受取舍：构建产物不含听歌数据，所以首屏（以及无脚本、接口失败的访问）没有可读排行，爬虫也拿不到这部分内容；冷缓存的一次访问要等 Last.fm 完成查询，30 分钟缓存承担其余访问，定时暖请求只降低访客撞上冷回源的概率。这些取舍由「不把听歌数据写进仓库、不再定时提交快照」的目标换来。

不提供正在播放、音乐播放、听歌时长、听歌热力图、用户切换或第三方音乐搜索。

## 架构与 authority

```text
访问首页 → RecentListening.astro：十张骨架卡 + 卡片模板
         → Head.astro 中的 RecentListeningScript.astro（首个模块）
             → GET /api/lastfm → recent-listening.js 校验与写 DOM → content:added
         → api/lastfm.js（Vercel 函数）
             → src/utils/lastfm.mjs：查询、校验、排行和统计、专辑封面
             → 30 分钟 CDN 缓存
本地 dev：同一处理函数由 plugins/astro-listening-endpoint.ts 挂到 Vite 中间件
```

| Rule/state/error/resource | Authority module | Interface/seam | Callers | Evidence |
| --- | --- | --- | --- | --- |
| L1/L2、七天窗口、API 错误、分页与请求上限 | `src/utils/lastfm.mjs` | `fetchLastfmSnapshot({ apiKey, user, now, fetchImpl })` → 标准快照 | 接口处理函数、单测 | `test/lastfm.test.mjs` |
| L3、Last.fm 图片占位识别、专辑匹配与基础版封面 | 同上 | 同一函数，不向视图暴露 API 原始数据 | 同上 | 同一单测 |
| 用户身份、主页地址 | 同上 | `LASTFM_USER`、`lastfmProfileUrl(user)` | 组件页头链接、适配器 | 产物检查 |
| L4/L6、缓存策略、状态码、错误净化 | `api/lastfm.js` | `handleListening(request, { apiKey, user, fetchImpl, now })`；默认导出读取环境变量 | Vercel、dev 中间件、单测 | `test/listening-endpoint.test.mjs` |
| L4 部署前提：根目录 `api/` 被收集为函数 | `vercel.json`（`framework: null`、`buildCommand`、`outputDirectory`） | 平台按 Other 预设构建，静态产物仍是 `dist` | Vercel 部署 | 预览部署的接口响应 |
| 本地 dev 提供同一接口 | `plugins/astro-listening-endpoint.ts` | 在 `/api/lastfm` 调用同一处理函数；密钥取环境变量或 `.env` | `pnpm dev` | 本地 `curl` 检查 |
| L7、请求启动顺序与导航取消 | `src/components/home/RecentListeningScript.astro` | `Head.astro` 在 ClientRouter 前输出；`astro:page-load` 加载、`astro:before-swap` 取消 | 首页与站内导航 | 产物脚本顺序检查、阻滞其它模块的浏览器检查 |
| 响应形状校验、统计文案、卡片渲染、清空骨架 | `src/utils/recent-listening.js` | `parseListeningPayload`、`listeningStats`、`listeningUpdatedLabel`、`renderListening`（先放入新卡片并提交布局，再移除骨架） | `RecentListeningScript.astro` | `test/recent-listening.test.mjs`、`verify-card-rails.mjs` |
| L5、加载态骨架卡、空／失败状态、无脚本说明与切换高度 | `src/components/home/RecentListening.astro` | 复用方卡尺寸与 `.media-cards--auto` 循环；轨道溢出由听歌区自己裁切，不使用正文滚动条；骨架不参与循环；预留相同文字高度并稳定统计行 | `index.astro` | built 首页检查、`verify-card-rails.mjs` |
| 方卡尺寸、循环与文字排版 | 既有 `prose.css` | 复用 `.media-cards--rail` / `.media-card--square` 的尺寸和循环；首页不复用其横向滚动 | 首页、Markdown 卡片 | 浏览器检查 |
| 循环条件、副本与清理 | 既有 `src/utils/card-rail-marquee.js` | `refresh(rail)`：内容被替换后清掉旧副本再重算 | 首页听歌排、Markdown 卡片 | 既有单测与新增 `refresh` 用例 |
| 注入内容的重新接管 | `content:added` 约定 | 陈列架与图片查看器各自监听并重算／重绑 | 听歌区块脚本 | `verify-card-rails.mjs` |
| 封面大图、焦点与滚动锁 | 既有 `src/utils/image-interactions.ts` | `bindViews()` 由 `content:added` 再次触发；用 `data-image-view-bound` 防止重复绑定 | 首页、正文图片 | `verify-card-rails.mjs`、图片布局检查 |

接口响应只包含用户、主页地址、`updatedAt`、七天总数、累计数、最常听歌手和十首以内歌曲（歌名、歌手、专辑、缩略图与原尺寸封面 URL、Last.fm 链接及周播放次数）。外链由属主从歌名／歌手生成；封面只接受 HTTPS 的 Last.fm 图片域名，过滤通用占位图。页面侧的校验只要求可渲染的形状（名称非空、计数为非负安全整数、链接为 HTTPS、时间可解析），美术资源的来源仍由适配器负责。

Last.fm 缩略图是 300px 远程图片，模板用固定宽高与懒加载的 `img`；不把封面下载进仓库，也不要求构建联网。`lastfmOriginalCover` 在适配器内把缩略图地址映射为保留原尺寸的 `ar0` 地址，快照 `fullCover` 交给模板里的 inert `template`，查看器打开前不加载。无封面时脚本用同一个占位类替换封面元素，保持方形尺寸。页面不新增 Markdown 解析器，也不为听歌区块单独写循环或查看器逻辑。

接口失败时 Last.fm 的错误消息已经过适配器净化（不含密钥与上游原文），处理函数只把它写入运行日志，响应体只返回机器可读的错误码。响应头的缓存策略、状态码和错误码都在 `api/lastfm.js` 一处决定。

## 配置与运行

Vercel 项目的 Framework Preset 必须是 Other：仓库根目录 `api/` 只在没有框架预设接管时才被收集为函数，用 Astro 预设时该地址返回 404。`vercel.json` 用 `"framework": null` 加 `buildCommand`、`outputDirectory` 固定这一点，静态产物仍是 `dist`，Pagefind 与构建后检查不受影响。

Vercel 项目环境变量（Production 与 Preview 都需要）：`LASTFM_API_KEY`；可选 `LASTFM_USER` 覆盖接口查询账户。本地在被忽略的 `.env` 中设置同名变量，`pnpm dev` 会把它交给同一个处理函数。首页标题及无脚本说明中的主页链接由 `RecentListening.astro` 从源码 `src/utils/lastfm.mjs` 的 `LASTFM_USER` 常量生成，环境变量不会改写这些静态链接；更换账户时需同步修改该常量并重新构建：

```dotenv
LASTFM_API_KEY=你的_API_Key
```

```bash
pnpm dev
curl -i http://localhost:4321/api/lastfm
node --test test/listening-endpoint.test.mjs test/lastfm.test.mjs test/recent-listening.test.mjs
```

本地 dev 与线上共用 `handleListening`，所以失败语义一致：没有密钥时本地同样返回 503 并显示失败状态。`pnpm preview` 只提供构建产物，不提供接口。

## 验收证据

| Obligation | Test / 验证层级 | 原因 |
| --- | --- | --- |
| L1/L2 与真实零值，忽略 nowplaying | 属主单测，注入固定响应与固定时间 | 可以区分排行与总数，不依赖真实账户变动 |
| L3 匹配、翻页、占位图、专辑缺失与基础版补图 | 同一属主单测，小夹具 | 防止错误专辑／歌手匹配和伪封面 |
| L4/L6 缓存头、状态码、失败不外泄、地址与方法的边界 | 端点单测，注入假上游 | 直接检验缓存与失败语义，不需要真实网络 |
| 接口输出能被页面校验接受 | 端点单测调用 `parseListeningPayload` | 接口与页面是跨模块 seam，形状漂移会立刻失败 |
| L5 与加载态骨架结构 | `test:built-restructure` 的首页契约检查 | 覆盖生成 HTML：十张骨架卡、模板、无脚本说明 |
| L5 与运行时接线、加载到就绪的布局稳定 | `verify-card-rails.mjs`（真实浏览器，固定载荷） | 暂扣响应，在 1440／390／320px、正常／减少动态模式下比较短文案单卡与长文案十卡切换前后的高度及行位置；并覆盖卡片、统计、占位封面、循环与副本、焦点、大图、失败与空状态、无 JS |
| L5 Safari 页尾位置稳定 | `scripts/verify-listening-safari.mjs`（macOS Safari，固定载荷） | 骨架时滚到底部后放行数据，断言页高、滚动位置和完整卡片可见 |
| L3 并行上限、同专辑复用与排行顺序 | 属主单测，以 Promise 闸门控制响应 | 不以真实耗时断言并发，验证每批至多三首且没有重复专辑查询 |
| L7 首个模块与独立启动 | built 首页检查、`scripts/verify-listening-startup.mjs`（暂扣 ClientRouter 响应） | 确认页面不等无关模块就能请求并呈现听歌数据；正常恢复模块后继续检查站内往返 |
| 完整仓库门禁 | format、lint、check、test、build、三项 built 检查 | 核对现有页面与内容回归 |

Safari 回归需先启动本地开发服务，再运行 `node scripts/verify-listening-safari.mjs http://127.0.0.1:4322/`（地址改为实际服务地址）。脚本通过临时本地代理注入固定数据，在 Safari 新窗口中验证骨架换成卡片后页高和滚动位置不变、完整卡片仍可见，完成后关闭该窗口。

部署后需另行核实 `GET /api/lastfm` 的成功响应、CDN 命中、真实冷请求耗时，以及 `stale-if-error`／`stale-while-revalidate` 行为。固定载荷、模块阻滞和假上游测试不代表当前部署已经通过这些验证。
