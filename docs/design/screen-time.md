# ActivityWatch 屏幕时间

首页的时间进度下方展示最近一次同步当天的活跃时长和最近七个北京时间自然日的柱状图。它反映这台电脑上「有前台窗口且未离开」的时间，不等同于系统亮屏时间或多设备屏幕使用时间。未采集到窗口或 AFK 记录的日期为 `null`，显示「—／暂无记录」；有采集但没有活跃交集时才显示零。

## 数据与边界

```text
本机 ActivityWatch → sync-screen-time.mjs → public/data/screen-time.json
                                          ↓ git commit + push
                             Vercel 构建 → ScreenTime.astro → 静态首页
```

只读取当前机器的 `aw-watcher-window` 和 `aw-watcher-afk` bucket，要求每种恰好一个。查询在 ActivityWatch 内对窗口与 `not-afk` 时段求交集、按日求和，只返回数字；七天通过一次查询完成，不导出原始事件。共两次本机 HTTP 请求，每次限时 30 秒，不自动重试。默认地址 `http://127.0.0.1:5600`；`AW_URL` 只允许本机 HTTP 地址，`AW_HOSTNAME` 可覆盖当前机器名，安装的定时任务使用默认值。

公开 JSON 仅包含 `timeZone`、`updatedAt` 和七个 `{ date, seconds }`。应用名、窗口标题、网址、机器名和设备 ID 不进入公开快照。日期、顺序和每日时长均验证后才写入；当前日截止于采集时刻。非法响应、缺 bucket 或本机服务不可用时失败并保留旧文件。初装软件之前无法补出历史记录。

快照通过临时文件原子替换。首页在构建时读取并验证 JSON，不在构建、访问页面或 Vercel 中连接本机 ActivityWatch。无 JavaScript 也可阅读日期、时长和图表；脚本只将当日日期文案增强为「今天活跃」，旧日期保持明确标注。更新时间始终以北京时间显示，页面数据以该时间为准。

| 事实 | 唯一属主 | 验证 |
| --- | --- | --- |
| 北京时间、七日窗口、公开形状、缺失值与展示格式 | `src/utils/screen-time.js` | `test/screen-time.test.mjs` |
| 当前机器 bucket、活跃交集、API 校验、写入与 Git 发布 | `scripts/sync-screen-time.mjs` | 同一测试的上游夹具、文件与真实本地 Git 仓库 |
| 版面、七根柱、静态回退、导航与日期增强 | `src/components/home/ScreenTime.astro` | 构建、真实浏览器的深浅主题／窄屏／无脚本／站内往返 |
| 每日计划、Node 和仓库绝对路径、日志 | `scripts/install-screen-time-launchd.mjs` | `plutil`、`launchctl print` 和手动触发 |

## 本机运行

```bash
# 只更新本地文件，供预览或构建
node scripts/sync-screen-time.mjs

# 更新并发布数据；需要已登录的 Git 凭据
node scripts/sync-screen-time.mjs --publish

# 安装／重新安装当前用户的每日任务（macOS）
node scripts/install-screen-time-launchd.mjs
```

launchd 每天按电脑本地时间 **23:50** 运行，不在安装或登录时立即触发。当前电脑为北京时间；切换系统时区后，任务仍按当地 23:50 执行，统计日期仍为北京时间。电脑睡眠期间错过日历任务会在唤醒时补执行；关机或未登录时不能运行。不负责启动 ActivityWatch，也不主动唤醒电脑。

发布仅允许 `main`：先 fetch 并确认 `origin/main` 是本地 HEAD 的祖先，已有待推送提交（含合并提交自身的变更）必须全部只修改快照；否则报错，不自动拉取、合并或变更分支。使用 `git commit --only -- public/data/screen-time.json` 保留用户其它暂存和未暂存修改。推送失败后保留有效数据与本地提交，恢复网络后再次执行即可。远端领先或存在其它未推送提交时，需要先自行同步代码。每次成功推送会触发现有部署，不需要额外公网数据库、API 或 token。

任务使用 `.local/screen-time-sync.lock` 目录防止重入，正常退出或异常都会释放。若进程被强制终止导致锁残留，确认没有同步进程后移除该目录再运行。移动仓库或更换 Node 路径后重新运行安装器。

```bash
# 查看任务与日志
launchctl print gui/$(id -u)/site.wutongyu.screen-time
# 日志：~/Library/Logs/YuBlog-screen-time.log

# 立即触发一次已安装任务（会提交并推送数据）
launchctl kickstart gui/$(id -u)/site.wutongyu.screen-time

# 停止并卸载
launchctl bootout gui/$(id -u)/site.wutongyu.screen-time
rm ~/Library/LaunchAgents/site.wutongyu.screen-time.plist
```

检查：`node --test test/screen-time.test.mjs`，之后执行开发指南里的仓库门禁。此功能不提供应用排行、窗口明细、年度日历或实时同步；每日提交的历史会留在 Git 中。
