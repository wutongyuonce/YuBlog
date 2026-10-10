# 首页 Last.fm：SPEC 与设计

## 行为契约

首页在近期书影游下方增加「最近在听 Top10」。用户 `ztyonce` 的过去七天歌曲排行保持 Last.fm 的顺序，最多十首；不足十首按实际数量展示。歌曲保持单行，超出容器时按现有陈列架规则自动头尾循环：两端淡出，按下或键盘聚焦暂停，悬停继续。减少动态效果、无 JS 或排得开时使用原生手动横滑。沿用现有方形尺寸，封面下方大字为歌曲名，小字用 `歌手 - 专辑名`。点击封面或键盘 Enter／空格可用现有查看器打开 Last.fm 原尺寸图片，关闭后恢复焦点。歌名展示区固定两行，超长文字省略，但完整文字保留在链接文本和悬停提示中；小字沿用陈列架两行限高、可上下滚动。标题右侧「Last.fm ↗」链接到用户主页，歌曲标题链接到对应 Last.fm 歌曲页，外链新标签打开。

同一区域用一行辅助统计展示过去七天听歌次数、累计记录数、过去七天最常听歌手；窄屏允许统计换行，排行仍单行。更新时间明确说明这是定时数据。浏览页面无需 Last.fm API Key、无需脚本，且不请求 Last.fm API。

| 义务 | 不变量与失败结果 |
| --- | --- |
| L1 排行 | 使用 `user.getTopTracks` 的 `7day`，最多十首；不以最近播放顺序或 Top 10 次数之和代替排行与周总数 |
| L2 统计 | 七天次数来自固定 UTC 起止时间的 `user.getRecentTracks` 总数；不包含正在播放；累计来自 `user.getInfo`；常听歌手来自 `user.getTopArtists` 的 `7day` 第一项 |
| L3 专辑资料 | 从窗口内最近一次匹配歌手与歌名的已记录播放获取专辑；缺专辑显示「专辑信息暂缺」；无可用封面显示音符占位，不伪造数据 |
| L4 静态同步 | 每小时以及手动触发获取快照。关键查询、响应验证或写入失败时任务失败，已有快照保持；下一次任务可重试。可选专辑不存在（error 6）允许无封面；成功的专辑响应必须是含图片数组的对象，空对象、数组或错误字段类型都视为验证失败并保留旧快照 |
| L5 可用性 | 横滑不撑宽页面，键盘可聚焦并浏览，深浅主题可读；无 JS 仍有全部歌名、统计和原生滚动；零播放显示真实零值和空状态 |
| L6 凭据 | API Key 仅来自 `LASTFM_API_KEY` 环境变量或 GitHub Actions Secret，不能进入源码、快照、构建 HTML 或日志；一般构建不访问 Last.fm |

API 多次查询期间用户仍可听歌，不提供跨接口事务一致性；时间窗以同步开始的秒级 UTC 时间为准。快照发布后的统计不随访问时间重新计算。定时任务每小时发起，不保证 GitHub 调度或 Vercel 部署恰好整点完成。

同步仅读取七天内的播放记录，每页最多 200 条、最多十页，找到所有排行歌曲的专辑后提前结束。资料超过扫描范围时显示缺失专辑，不截断排行或周总数。每首缺封面的歌曲最多查询两次专辑：原名，以及去掉末尾 `Explicit`／`Deluxe Version` 等版本标签的基础专辑名；只补封面，展示仍保留真实播放记录的专辑名。使用基础专辑封面是可接受取舍，不能保证豪华版专用封面。每次 API 请求限时 15 秒，最多 33 次，无无限重试；同一同步工作流串行运行。

不提供正在播放、音乐播放、听歌时长、听歌热力图、用户切换或第三方音乐搜索。

## 架构与 authority

```text
GitHub Actions（每小时 / 手动） + LASTFM_API_KEY
  → scripts/sync-lastfm.mjs
  → scripts/lib/lastfm.mjs：查询、校验、排行和统计、专辑封面
  → src/data/lastfm.json（完整成功后原子替换）
  → 提交快照至 main → 既有 Vercel Git 部署
  → RecentListening.astro（构建读取）→ 首页静态 HTML
```

| Rule/state/error/resource | Authority module | Interface/seam | Callers | Evidence |
| --- | --- | --- | --- | --- |
| L1/L2、七天窗口、API 错误、分页与请求上限 | `scripts/lib/lastfm.mjs` | `fetchLastfmSnapshot({ apiKey, user, now, fetchImpl })` → 标准快照 | 同步 CLI、单测 | `test/lastfm.test.mjs` |
| L3、Last.fm 图片占位识别、专辑匹配与基础版封面 | 同上 | 同一函数，不向视图暴露 API 原始数据 | 同上 | 同一单测及真实账户同步 |
| L4/L6、环境变量、快照原子替换 | `scripts/sync-lastfm.mjs` | `syncLastfm({ destination, ...options })`；CLI `pnpm sync:lastfm` | 本地、Actions | 文件保留回归测试 |
| 定时触发、串行与持久发布 | `.github/workflows/lastfm.yml` | `schedule` / `workflow_dispatch`，快照提交 | GitHub Actions、Vercel Git 集成 | 工作流审查；上线后的执行另验证 |
| L5、空状态、歌曲与统计呈现 | `RecentListening.astro` | 只读取快照；用既有 `.home-section-header` 和方卡 class | `index.astro` | built 首页检查、真实浏览器 |
| 方卡尺寸、横滑和文字排版 | 既有 `prose.css` | 复用 `.media-cards--rail` / `.media-card--square` | 首页、Markdown 卡片 | 浏览器检查 |
| 循环条件、副本与清理 | 既有 `card-rail-marquee.js` | `.media-cards--auto` 请求循环 | 首页、Markdown 卡片 | 既有单测、`verify-card-rails.mjs` |
| 封面大图、焦点与滚动锁 | 既有 `image-interactions.ts` | `.markdown-content .image-view` 与 inert template | 首页、正文图片 | `verify-card-rails.mjs` |

快照只保存用户、主页地址、`updatedAt`、七天总数、累计数、最常听歌手和十首以内歌曲（歌名、歌手、专辑、缩略图与原尺寸封面 URL、Last.fm 链接及周播放次数）。外链由属主从歌名／歌手生成；封面只接受 HTTPS 的 Last.fm 图片域名，过滤通用占位图。

Last.fm 缩略图是 300px 远程图片，组件使用固定宽高及懒加载的 `img`；没有将封面下载保存到仓库，也不依赖 Astro 构建时联网下载。`lastfmOriginalCover` 在适配器内把缩略图地址映射为保留原尺寸的 `ar0` 地址，快照 `fullCover` 给组件直接读取。原图放在 inert template，查看器打开前不加载；原始上传图的清晰度仍取决于 Last.fm 源文件。无封面同样占据方形空间。组件只接现有循环与大图的 DOM seam，不另持前端状态，不新增 Markdown 解析器。

CLI 完成所有查询与验证后写临时文件，再 rename；失败清理临时文件。工作流只提交快照文件，提交使用仓库所有者的 GitHub noreply 身份供既有 Vercel Git 集成识别；由 `GITHUB_TOKEN` 推送不会触发本仓库另一轮 CI，完整检查在功能变更交付时运行。快照提交是否能自动部署仍取决于现有 Vercel Git 项目配置及访问权限。

## 配置与运行

GitHub 仓库 Actions Secret：`LASTFM_API_KEY`。用户名由同步函数默认值提供；可用 `LASTFM_USER` 环境变量覆盖。本地 `.env` 已被忽略：

```dotenv
LASTFM_API_KEY=你的_API_Key
```

```bash
pnpm sync:lastfm
node --test test/lastfm.test.mjs
pnpm dev
```

定时工作流必须进入仓库默认分支才会运行；本地实现与真实同步不等于线上定时任务已启用。手动运行可在 Actions 的 `Sync Last.fm` 页面触发。

## 验收证据

| Obligation | Test / 验证层级 | 原因 |
| --- | --- | --- |
| L1/L2 与真实零值，忽略 nowplaying | 属主单测，注入固定响应与固定时间 | 可以区分排行与总数，不依赖真实账户变动 |
| L3 匹配、翻页、占位图、专辑缺失与基础版补图 | 同一属主单测，小夹具 | 防止错误专辑／歌手匹配和伪封面 |
| L4/L6 API/无效响应失败，旧文件不变 | CLI seam 文件测试，临时目录 | 验证持久化边界，无需真实网络失败 |
| L5 与静态数据接线 | `test:built-restructure` 的首页契约检查及浏览器 | 覆盖生成 HTML 和真实横滑／窄屏／主题，而非 CSS 文本快照 |
| 完整仓库门禁 | format、lint、check、test、build、三项 built 检查 | 核对现有首页与内容回归 |

本地验证已完成：192 项测试全部通过且无跳过；format、lint、Astro check、生产构建和三项 built 检查通过。check 有既有的 5 条弃用提示；Markdown/RSS 全站七项检查整批通过且无跳过。针对周总数的临时错误实现会使属主测试失败，说明测试可以识别把周总数误算成 Top 10 次数之和的问题。

真实账户首次同步取得十首歌曲和十张有效封面。Ego 浏览器验证 1440／390／320px 的深浅主题、单行与正方形封面、两行歌名、页面无溢出、键盘横滑、封面加载、无脚本与真实 ClientRouter 返回首页。缺图占位仍保持方形尺寸。`verify-card-rails.mjs` 验证书页分类成排、听歌循环副本、` - ` 分隔符、关闭焦点恢复、点击副本加载原图、打开前不加载原图、减少动态效果及无 JS 回退。

组件、同步脚本、快照和工作流均已实现，`LASTFM_API_KEY` 仓库 Secret 已配置。工作流进入默认分支后，仍需验证定时任务与 Vercel 发布；本地与浏览器结果不能代替上线后的 Actions／Vercel 运行结果。
