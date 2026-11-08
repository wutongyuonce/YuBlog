# ActivityWatch 屏幕时间

首页在近期笔墨下方、近期书影游上方展示最近同步当天的活跃时长和最近七个北京时间自然日的应用堆叠图。统计这台电脑上前台窗口与 `not-afk` 时段的交集。未采集的日期在柱顶显示「—」，当天摘要和明细总时长显示「暂无记录」；已采集但没有活跃时间时显示「0 分钟」。旧的仅总时长快照保留总量，单独标为「明细缺失」。

## 运行时数据路径

数据只在访问时取得，构建产物里没有任何屏幕时间数据。区块由服务端输出的加载态骨架、空的消息位和无脚本提示组成，客户端脚本请求接口、校验响应后把图表与失败文案填进去。

```text
本机定时任务（每小时 :50，跑已安装的采集程序）
  → 查 ActivityWatch → 聚合七天 → parseScreenTime 校验
  → 覆盖写入 Blob 的 screen-time.json（不提交、不部署、不重建站点）
        ↓
GET /api/screen-time ← 读取该对象，先校验再带缓存头返回
        ↓
ScreenTime.astro：骨架 → 客户端拉取 → 渲染 → 绑定交互
```

上游与听歌不同：Last.fm 是公网 API，服务端可以直接查询；ActivityWatch 只在本机 `127.0.0.1`，而且原始接口会返回窗口标题、网址与文件路径。所以本机只上报已脱敏的聚合快照，既不开放本机服务，也不让服务端去连接它。本机离线只影响新鲜度——远端始终保留最后一次成功的快照，页面不会因此空白。

区块只有三种状态：加载中（骨架，不可聚焦，`prefers-reduced-motion: reduce` 时脉冲静止）、就绪、失败（`暂时无法获取屏幕时间数据。`，收起骨架）。无脚本时保留骨架并显示说明文字。`aria-busy` 由脚本在开始请求时设置：无脚本时没有东西在加载，不应标成忙碌。骨架与就绪共用同一套全局样式——运行时插入的节点拿不到 Astro 的 scoped 属性。

## 统计与展示

每次同步重新查询最近七天，当前日截止于同步开始时刻。只读取当前机器各一个窗口、AFK bucket；两次本机 HTTP 请求各限时 30 秒，不自动重试。默认服务为 `http://127.0.0.1:5600`；手动同步可用 `AW_URL` 指定本机 HTTP 地址、`AW_HOSTNAME` 覆盖机器名，定时任务使用默认值。

公开快照只有时区、更新时间和每日 `{ date, seconds, apps }`；应用条目只含名称与活跃秒数。窗口标题、网址、文件路径和设备标识不输出。应用聚合保留上游精度，日总量四舍五入到秒，校验容许一秒舍入差；所有应用先验证，再判断是否缺采集。请求或校验失败时不上传也不改写本地副本。带 `--publish` 时先覆盖远端，成功后再更新本地副本；不带该标志只更新本地副本。

七天累计时长的 Top 5 共用颜色与堆叠顺序，其余合并为「其他」。柱高按绝对时长，段占比按当天应用时长总和计算。每次新快照重算排名，颜色允许随排名变化；小色块不设最小高度。悬浮、聚焦或点击整根柱子可查看全部应用的时长与占比，应用名在明细中完整换行显示；色块悬浮高亮对应明细。明细是限高滚动区，键盘可用 Tab 进入后滚动。长列表展开在视口内定位；焦点在明细内时 Escape 关闭并归还该柱子，落在别处时只关闭；点击外部收起。

刷新网页会重新请求接口，但看到的仍是本机最近一次同步的聚合结果。陈旧数据按快照所属日期显示，更新时间以北京时间标注。不提供窗口明细、年度日历、多设备合并或实时采集；初装前的记录无法补出。

## 缓存与失败

接口只接受不带查询参数的 `GET`；其它方法返回 405（`Allow: GET`），带查询参数返回 400。成功响应由 CDN 缓存 600 秒，过期后 60 秒内先返回旧数据并在后台刷新，上游出错时最多再沿用一天旧数据；失败响应一律不缓存。Blob 对象自身缓存 60 秒（Vercel Blob 的下限）。访客还要经过上面的 CDN 缓存，所以新鲜度不是写入后一分钟内可见。整体上限由每小时任务决定；缓存时长同时决定上游请求次数，Hobby 的 Blob 操作额度有限，所以没有取更短的值。

读取不需要凭据：公开存储的地址由 `BLOB_STORE_ID` 决定（`store_` 前缀可有可无，域名部分不带前缀且小写，与该存储在 Dashboard 里的 Base URL 一致），接口直接取该地址，不做 `head()` 元数据查询——`head()` 计一次 Simple Operation，按接口缓存频率它会是最大的开销来源。未连接存储（缺 `BLOB_STORE_ID`）时接口返回 503；读取失败或快照畸形返回 502，页面进入失败状态。

服务端在返回前用 `parseScreenTime` 校验一次，页面拿到响应后又校验一次：接口响应属于信任边界之外的数据，畸形就整块按失败处理，不解析部分字段也不补默认值。两处调用同一个属主函数，所以线上与本机 dev 对畸形数据的反应一致；页面侧这一层不是额外的规则，而是对同一份数据在另一侧的复查。

## 首次配置

采集只支持 macOS 与 Windows，并且是可选的：不安装时首页这一块显示拿不到数据，其它页面和构建不受影响。数据是这一台电脑的，不会跟着账号到另一台机器。

1. Vercel 项目 → Storage → Create → Blob，访问模式选 **Public**；创建后在该存储页 **Connect to Project**，环境勾 Production + Preview，并勾上生成 `BLOB_READ_WRITE_TOKEN`。Sensitive 不要勾，否则之后无法从 Dashboard 把 token 复制给安装器。网站只用平台注入的 `BLOB_STORE_ID` 读；写入 token 只留在这台电脑上。
2. 本机安装 ActivityWatch，确认它在 `127.0.0.1:5600` 监听。在仓库根目录执行 `pnpm install`。
3. 安装采集程序。token 可以先放进环境变量，或临时写在仓库根目录的 `.env`；安装器把它存进系统凭据库，并删掉 `.env` 里的这一行。终端里也会隐藏输入。

```bash
BLOB_READ_WRITE_TOKEN='从 Dashboard 复制' node scripts/install-screen-time.mjs
```

4. 推送网站代码，让 `/api/screen-time` 上线。安装不会马上采集；要立刻看到数据，再跑一次 `node scripts/sync-screen-time.mjs --publish`。

## 同步与发布

```bash
# 只更新本机快照，供 pnpm dev 预览；不上传，也不需要 token
node scripts/sync-screen-time.mjs

# 覆盖写入 Blob。每小时任务走这条路径
node scripts/sync-screen-time.mjs --publish
```

`--publish` 每小时覆盖写入一次，即使七天数据与上次相同：本机快照只说明上次同步的结果，不能证明远端对象还在。这样快照丢失、存储被重建或对象被删都能在下一个整点自愈，代价是每月 720 次 Advanced Operations（Hobby 额度 2000 次）。上传先于写本机快照：上传失败时快照仍是旧数据，下一次运行会重新尝试。

本机快照在应用目录的 `screen-time.json`，只给 `pnpm dev` 用。dev 中间件读这一份并调用同一个处理函数；文件不在时首页显示失败说明。快照不进仓库，也不进 `dist/`。上传用的 token 优先取这一次进程的环境变量，否则读系统凭据库，不读仓库 `.env`。Vercel 侧连接存储后由平台注入 `BLOB_STORE_ID`，接口无需额外配置。

存储必须是 **Public**：接口按公开地址匿名读取，`put` 也以 `access: 'public'` 写入，而这个访问模式在创建后不能修改。建成 Private 时接口会一直返回 502，只能重建存储并重新连接项目。

应用目录里的 `screen-time-sync.lock` 防止重复同步。普通请求、校验或写入异常会释放锁；进程被终止时可能残留，确认没有同步进程后再删掉这个锁目录。

## 本机每小时任务

安装器把采集脚本、快照校验和 `@vercel/blob` 复制到固定的应用目录，再登记每小时第 **50** 分钟的任务。之后任务只跑这个目录，不再打开 Git 仓库。安装时不会立即采集，也不在每次登录时跑。单次运行只有两次本机请求和一次远端覆盖写入；没有新活跃记录的整点也会写一次，用于自愈。睡眠错过的那一次在唤醒后补上；关机、未登录或 ActivityWatch 未运行时无法采集，不负责唤醒电脑或启动 ActivityWatch。

快照形状的权威仍是仓库里的 `src/utils/screen-time.js`。本机那份是安装当下的复制品。形状或上传方式变了，或者 Node 的安装路径变了，要在仓库里重跑安装器；不重跑的话，旧程序仍按旧格式上传，新网站可能校验失败。同一用户只有一份任务，在另一个工作副本里重装会换成那一份代码。

| 项目 | macOS | Windows |
| --- | --- | --- |
| 应用目录 | `~/Library/Application Support/YuBlog/` | `%LOCALAPPDATA%\YuBlog\` |
| 任务 | 用户级 launchd，`site.wutongyu.screen-time` | 任务计划程序，同名；只在当前用户登录时跑 |
| 任务定义 | `~/Library/LaunchAgents/site.wutongyu.screen-time.plist` | 由 `schtasks` 按安装器写入的 XML 登记 |
| 日志 | 应用目录里的 `screen-time.log` | 同左 |
| 写入凭证 | 登录钥匙串项目 `site.wutongyu.screen-time` | 应用目录里的 `blob-token.dpapi`，只有当前用户解得开 |

任务里记的是安装当时的 Node 绝对路径。日志不放在 `~/Library/Logs`，避免被清理工具清掉。

```bash
# 安装或更新。已经存过凭证时，直接重跑即可
node scripts/install-screen-time.mjs

# macOS：查看实际脚本、工作目录和最近退出码；等待计划时未运行是正常状态
launchctl print gui/$(id -u)/site.wutongyu.screen-time

# macOS：立即跑已安装的那一份（会上传）
launchctl kickstart gui/$(id -u)/site.wutongyu.screen-time

# 停止采集并删掉凭证。本机快照仍留着，供本地预览
node scripts/install-screen-time.mjs --uninstall
```

移除分两层：

- **只停采集**：跑上面的 `--uninstall`。页面继续显示最后一次快照，不再更新。
- **彻底移除**：在上述基础上，到 Vercel 解绑并删除该 Blob 存储（连带注入的 `BLOB_STORE_ID` 等变量），删掉 `api/screen-time.js`、`plugins/astro-screen-time-endpoint.ts` 和首页区块后重新部署。应用目录可以一并删掉。

## 职责与验证

| 事实 | 唯一属主 | 验证 |
| --- | --- | --- |
| 北京时间、快照校验、缺失值、Top 5 分组与格式 | `src/utils/screen-time.js` | `test/screen-time.test.mjs` |
| 本机 bucket、活跃交集、原始字段转换、本机快照与发布顺序 | `scripts/sync-screen-time.mjs` | 同一测试的上游夹具、失败保留与重试 |
| Blob 路径与公开地址推导、覆盖写入、读取 | `src/utils/screen-time-store.mjs` | `test/screen-time-endpoint.test.mjs` |
| 缓存策略、状态码、响应校验与错误净化 | `api/screen-time.js` | 同一测试的注入读取器 |
| 响应形状校验、柱高刻度、文案与 DOM 渲染 | `src/utils/screen-time-view.js` | `test/screen-time-view.test.mjs` |
| 骨架、失败与无脚本状态、图表交互与导航清理 | `src/components/home/ScreenTime.astro` | 真实浏览器 |
| 本地 dev 提供同一接口 | `plugins/astro-screen-time-endpoint.ts` | 本地 `curl` 检查 |
| 每小时计划、应用目录、凭证与日志；安装时复制权威实现 | `scripts/install-screen-time.mjs` | plist 与 Windows 任务 XML 单测；安装会变更本机任务 |

运行 `node --test test/screen-time.test.mjs test/screen-time-view.test.mjs test/screen-time-endpoint.test.mjs`，再按 [开发指南](../guides/development.md#verification) 执行仓库门禁。

真实浏览器验收覆盖：骨架换成图表时不带动后续内容跳动、点击柱子打开键盘可用的明细、接口失败时骨架收起并显示说明；构建产物检查确认无脚本时保留骨架与说明。部署后还需核实真实 Blob 写入、`GET /api/screen-time` 的成功响应与 CDN 缓存命中；固定载荷与单测不代表线上存储已连通。
