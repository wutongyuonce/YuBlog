# ActivityWatch 屏幕时间

首页在近期笔墨下方、近期书影游上方展示最近同步当天的活跃时长和最近七个北京时间自然日的应用堆叠图。统计这台电脑上前台窗口与 `not-afk` 时段的交集；未采集的日期显示「—」，已采集但没有活跃时间时显示零。旧的仅总时长快照保留总量，单独标为「明细缺失」。

## 统计与展示

每次同步重新查询最近七天，当前日截止于同步开始时刻。若七天数据与已有快照相同，不重写文件、不提交、不部署，`updatedAt` 只随真实变化前进；这样高频同步不会产生空提交。只读取当前机器各一个窗口、AFK bucket；两次本机 HTTP 请求各限时 30 秒，不自动重试。默认服务为 `http://127.0.0.1:5600`；手动同步可用 `AW_URL` 指定本机 HTTP 地址、`AW_HOSTNAME` 覆盖机器名，定时任务使用默认值。

公开快照只有时区、更新时间和每日 `{ date, seconds, apps }`；应用条目只含名称与活跃秒数。窗口标题、网址、文件路径和设备标识不输出。应用聚合保留上游精度，日总量四舍五入到秒，校验容许一秒舍入差；所有应用先验证，再判断是否缺采集。请求或校验失败时保留上次文件，成功后通过临时文件原子替换。

七天累计时长的 Top 5 共用颜色与堆叠顺序，其余合并为「其他」。柱高按绝对时长，段占比按当天应用时长总和计算。每次新快照重算排名，颜色允许随排名变化；小色块不设最小高度。悬浮、聚焦或点击整根柱子可查看全部应用的时长与占比，应用名在明细中完整换行显示；色块悬浮高亮对应明细。明细是限高滚动区，键盘可用 Tab 进入后滚动。长列表展开在视口内定位；焦点在明细内时 Escape 关闭并归还该柱子，落在别处时只关闭；点击外部收起。无脚本仍可点击原生 details 查看。

首页在构建时读取快照，不连接本机 ActivityWatch。开发服务随快照文件热更新；生产需重新构建、部署。刷新网页不会重新采集。陈旧数据显示所属日期，更新时间以北京时间标注。不提供窗口明细、年度日历、多设备合并或实时采集；初装前的记录无法补出，每日提交的聚合历史会留在 Git 中。

## 同步与发布

```bash
# 本地预览：查询并在数据变化时更新当前目录的快照，不提交
node scripts/sync-screen-time.mjs

# main 分支的正式目录：数据变化时只提交快照并推送
node scripts/sync-screen-time.mjs --publish
```

发布先 fetch，要求远端 main 是本地 HEAD 的祖先，已有待推送提交（含合并提交自身变更）只能修改快照。它不自动合并、切分支，也不夹带其它暂存或未暂存文件；远端领先或存在业务提交时需先自行同步。推送失败保留有效文件和数据提交，下次运行可重试。成功推送通过仓库已有部署流程更新博客。

`.local/screen-time-sync.lock` 防止同一目录重复同步。普通请求、校验或写入异常会释放锁；进程被终止时可能残留，确认没有同步进程后再移除锁目录。运行同步时不要同时切换分支或提交该目录。

## macOS 每小时任务

使用用户级 **launchd LaunchAgent**，不是 systemd；按电脑本地时间每小时的第 **50** 分钟执行。安装时不会立即采集，也不在每次登录时运行。单次运行只有两次本机请求，代价可以忽略；真正的外部影响是数据变化时的一次提交与部署，所以没有新活跃记录的整点不会触发部署。睡眠错过的任务在唤醒后补执行；关机、未登录或 ActivityWatch 未运行时无法采集，不负责唤醒电脑或启动 ActivityWatch。

| 项目 | 位置或内容 |
| --- | --- |
| 服务标签 | `site.wutongyu.screen-time` |
| 服务文件 | `~/Library/LaunchAgents/site.wutongyu.screen-time.plist` |
| 标准输出与错误日志 | `~/Library/Logs/YuBlog-screen-time.log` |
| 执行命令 | 安装时的 Node 绝对路径 + 仓库 `scripts/sync-screen-time.mjs --publish` |
| 工作目录 | 执行安装器的仓库绝对路径 |

安装器写入绝对路径，计划为每小时第 50 分钟；移动仓库或删除原 Node 版本后需要重装。同名任务只有一份，在另一个 worktree 重装会替换它。本地预览目录只手动同步，不安装任务；用 `launchctl print` 核实实际脚本和工作目录。合入已安装的目录后，原任务就会执行新代码；`kickstart` 触发的是已安装路径的版本。

```bash
# 在正式目录的 main 分支安装或重装
node scripts/install-screen-time-launchd.mjs

# 查看实际脚本、工作目录、计划和最近退出码；等待计划时未运行是正常状态
launchctl print gui/$(id -u)/site.wutongyu.screen-time

# 立即触发已安装版本（会提交并推送数据）
launchctl kickstart gui/$(id -u)/site.wutongyu.screen-time

# 卸载每小时任务
launchctl bootout gui/$(id -u)/site.wutongyu.screen-time
rm ~/Library/LaunchAgents/site.wutongyu.screen-time.plist
```

## 职责与验证

| 事实 | 唯一属主 | 验证 |
| --- | --- | --- |
| 北京时间、快照校验、缺失值、Top 5 分组与格式 | `src/utils/screen-time.js` | `test/screen-time.test.mjs` |
| 本机 bucket、活跃交集、原始字段转换、文件写入与发布 | `scripts/sync-screen-time.mjs` | 同一测试的上游夹具、失败保留和本地 Git 仓库 |
| 图表、原生 details、增强交互与导航清理 | `src/components/home/ScreenTime.astro` | 真实浏览器的深浅主题、窄屏、键盘、触摸、无脚本与站内往返 |
| 每小时计划、路径和日志 | `scripts/install-screen-time-launchd.mjs` | `plutil -lint`、`launchctl print`；安装会变更本机任务 |

运行 `node --test test/screen-time.test.mjs`，再按 [开发指南](../guides/development.md#verification) 执行仓库门禁。
