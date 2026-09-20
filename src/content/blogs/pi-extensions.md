---
title: 我的生产 Pi Extensions 合集
description: 记录当前实际装进 Pi 的 extensions、各自干什么、怎么用，以及几个没装但值得看的替代。
pubDate: 2026-09-10
category: 技术向
lastModDate: ''
tags: [Pi, Agent]
titleImage: /blog-title-images/doll-leaves.jpg
titleImageAlt: 可爱玩偶与地面落叶
toc: true
search: true
draft: false
---

核对时间：2026-09-10。只记 `~/.pi/agent/settings.json` 里 `packages` 主动装上的，不记 npm 依赖树上顺带拉下来的东西（比如曾经装过、现在已经不在 `packages` 里的 `@narumitw/pi-file-context`）。`~/.pi/agent/extensions/herdr-agent-state.ts` 是 Herdr 自己写进去的，不算选型。

Pi 当前默认模型是 xAI `grok-4.6`，thinking 开 `high`，`hideThinkingBlock` 为 `true`。

---

## 1. 怎么装、装在哪

全局扩展写在 `~/.pi/agent/settings.json` 的 `packages`。常用三种来源：

```bash
pi install npm:@ff-labs/pi-fff
pi install git:github.com/earendil-works/pi-review-loop
pi install /absolute/path/to/pi-tool-offloading/index.ts
```

装完重启或 `/reload`。批量更新：

```bash
pi update --extensions
```

项目级用 `pi install -l ...`，会进仓库的 `.pi/`，这篇不记那些。

---

## 2. 现在装了哪些

共 23 个。版本以 `~/.pi/agent/npm/package.json` 为准；git / 本地路径没有写进这份 lock。

| 包 | 来源 | 干什么 |
|---|---|---|
| `@ff-labs/pi-fff` | npm `^0.10.6` | 用 FFF 替换内置 find/grep |
| `@mobrienv/pi-tidy-tools` | npm `^0.4.2` | 把工具卡片收成「目标 + 结果」两行 |
| `@narumitw/pi-plan-mode` | npm `^0.57.1` | 改代码前先出一份可批准的计划 |
| `@narumitw/pi-lsp` | npm `^0.49.7` | 按文件扩展名跑 LSP 诊断和 fix |
| `@narumitw/pi-goal` | npm `^0.54.4` | 给会话钉一条目标，闲下来自动续跑 |
| `pi-schedule-prompt` | npm `^0.4.1` | 让 Agent 自己预约以后的 prompt |
| `@narumitw/pi-btw` | npm `^0.58.1` | 旁路提问，不污染主对话 |
| `@aliou/pi-guardrails` | npm `^0.17.1` | 护栏：敏感文件、越权路径、危险 shell |
| `@tintinweb/pi-tasks` | npm `^0.9.0` | 结构化任务列表 + 依赖 |
| `@injaneity/pi-computer-use` | npm `^0.5.1` | 操作本机 GUI |
| `pi-mcp-adapter` | npm `^2.32.1` | MCP 收成一个代理工具，按需发现 |
| `@tintinweb/pi-subagents` | npm `^0.19.0` | 子 Agent / workflow 编排 |
| `@juicesharp/rpiv-web-tools` | npm `^2.9.0` | `web_search` + `web_fetch` |
| `pi-compact-thinking` | npm `^0.2.2` | 思考块收成几行预览 |
| `pi-review-loop` | git `earendil-works` | 边写边审 diff |
| `pi-tool-offloading` | 本地路径 | 大工具结果卸到 sidecar |
| `pi-workspace-history` | npm `^0.4.1` | 工作区级 undo / redo |
| `pi-transcribe` | git `earendil-works` | 本地语音输入和文件转写 |
| `@narumitw/pi-statusline` | npm `^0.50.0` | 底栏：模型、分支、上下文占用 |
| `@narumitw/pi-tool` | npm `^0.3.1` | 浏览当前会话里所有工具 |
| `@juicesharp/rpiv-ask-user-question` | npm `^2.9.0` | 结构化问卷，少猜 |
| `pi-zen-mode` | git `wutongyuonce` | 藏思考和工具，只看正文 |
| `pi-observational-memory` | npm `^3.0.4` | 长会话跨 compact 记住决策 |

自己写的两件：[`pi-zen-mode`](https://github.com/wutongyuonce/pi-zen-mode)、[`pi-tool-offloading`](https://github.com/wutongyuonce/pi-tool-offloading)。其余是社区包。

下面按干活时真正碰到的顺序写，不按安装顺序。

---

## 3. 搜代码

### `@ff-labs/pi-fff`

内置 `find` / `grep` 每次都拉 `fd` / `rg` 子进程。fff 是 Rust 原生库，会话开始时在后台建索引，搜索按 frecency 排，git 改动过的文件会往前靠。模型侧工具名变成 `fffind`、`ffgrep`，还有一个 `fff-multi-grep` 做多模式 OR。

```bash
pi install npm:@ff-labs/pi-fff
```

装完不用改命令。Agent 搜文件会走 FFF；`@` 补全也走同一套索引。仓库：[dmtrKovalenko/fff](https://github.com/dmtrKovalenko/fff)。

### `@narumitw/pi-lsp`

给当前改的那几个文件跑 LSP，不替代仓库自己的 lint / typecheck / CI。默认目录里有 biome、ty、ruff、rust-analyzer、gopls，命令得自己装到 `PATH`。工具是 `lsp_diagnostics` 和 `lsp_fix`。

```bash
pi install npm:@narumitw/pi-lsp
/lsp          # 看哪些 server 在 PATH 上
```

中间反馈用它，收工前还是跑项目自己的检查。仓库：[narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-lsp)。

---

## 4. 改代码时别把会话看花、别把机器搞坏

### `@mobrienv/pi-tidy-tools`

Pi 原生工具卡片又大又吵，看不出这一步想干什么。tidy-tools 把 `read` / `write` / `edit` / `bash` / `grep` / `find` / `ls` 收成一两行：目标、对象、结果。`/diff` 能把上一轮改动再过一遍。

```bash
pi install npm:@mobrienv/pi-tidy-tools
/diff
```

同一套件还有 `pi-tidy-subagents`、`pi-tidy-memory`，我只装了 tools。仓库：[mikeyobrien/pi-tidy-tools](https://github.com/mikeyobrien/pi-tidy-tools)。

### `@aliou/pi-guardrails`

四件一套：文件保护、工作区外路径、危险 shell 确认，再加一个给 Herdr 报「正在等你点允许」的适配。`.env`、私钥、乱删目录这类事先拦下来。

```bash
pi install npm:@aliou/pi-guardrails
/guardrails:onboarding
/guardrails:settings
```

仓库：[aliou/pi-guardrails](https://github.com/aliou/pi-guardrails)。

### `pi-review-loop`

开一个常驻的 diff 窗。提交一次 review 会记下当前工作区，下次只看这之后的改动。批注不会自动发给模型，先落进编辑器，你改完再回车。

```bash
pi install git:github.com/earendil-works/pi-review-loop
/diff-review
```

两种模式：`Since review`（相对上次 checkpoint）和 `vs HEAD`。仓库：[earendil-works/pi-review-loop](https://github.com/earendil-works/pi-review-loop)。

### `@injaneity/pi-computer-use`

应用没有 API、只能点界面时才用。给 Agent 找窗口、看控件、点、打字、等变化。macOS 14+，辅助功能和屏幕录制要授给 `~/Applications/pi-computer-use.app`。

```bash
pi install npm:@injaneity/pi-computer-use
/computer-use
```

有可靠 CLI 或 MCP 时别走这条。仓库：[injaneity/pi-computer-use](https://github.com/injaneity/pi-computer-use)。

---

## 5. 把任务钉住

### `@narumitw/pi-plan-mode`

非平凡改动先 `/plan`。规划期间挡住写文件、危险 shell，问清楚歧义，你批准计划之后再动手。可以在当前会话实施，也可以开一条带批准计划的新会话。

```bash
pi install npm:@narumitw/pi-plan-mode
/plan
/plan 把鉴权从 session 迁到 JWT
```

仓库：[narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-plan-mode)。

### `@narumitw/pi-goal`

会话级目标。Pi 真正闲下来（排队、重试、compact 都结束）之后续跑一次。模型用 `goal_complete` / `goal_blocked` / `goal_wait` 收口，不能自己 pause。默认自动跑 25 轮，连续 3 轮没进展会停下来让你看。

```bash
pi install npm:@narumitw/pi-goal
/goal 把测试补到覆盖 scheduler 的失败重试
/goal            # 暂停、改目标、清掉
```

配置在 `~/.pi/agent/pi-goal.json`。仓库：[narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-goal)。

### `@tintinweb/pi-tasks`

Claude Code 那套任务工具搬过来：`TaskCreate` / `TaskList` / `TaskGet` / `TaskUpdate`，加上依赖和 `TaskExecute` 把带 `agentType` 的任务丢给子 Agent。编辑器上方有任务条。

```bash
pi install npm:@tintinweb/pi-tasks
```

多步、有依赖的活让模型建任务；一句话能做完的事没必要开。仓库：[tintinweb/pi-tasks](https://github.com/tintinweb/pi-tasks)。

### `@tintinweb/pi-subagents`

主 Agent 用 `Agent` 工具拉子会话，默认后台跑，做完再通知。`Explore` / `Plan` 是内置类型，自定义写在 `.pi/agents/<name>.md`。需要确定性编排时把 JavaScript 交给 `SubagentWorkflow`：`agent()`、`parallel()`、`pipeline()`。

```bash
pi install npm:@tintinweb/pi-subagents
```

和 `pi-tasks` 的关系：tasks 管清单，subagents 管子进程。仓库：[tintinweb/pi-subagents](https://github.com/tintinweb/pi-subagents)。

### `pi-schedule-prompt`

让 Agent 给自己预约 prompt。cron、间隔、相对时间（`+30m`）、一次性 ISO 都能写。可选 `model`，预约任务会在独立会话里跑，不搅当前聊天。

```bash
pi install npm:pi-schedule-prompt
/schedule-prompt
```

口语也能用：「三十分钟后提醒我看 CI」「每小时检查一次构建」。仓库：[tintinweb/pi-schedule-prompt](https://github.com/tintinweb/pi-schedule-prompt)。

---

## 6. 上下文别被撑爆

### `pi-observational-memory`

长会话 compact 几次之后，决策理由会先没。这个扩展边干活边记 observation / reflection，compact 时把该留的折进去，而不是事后再让模型默写一遍历史。V3 和 V2 的设置、存储不兼容。

```bash
pi install npm:pi-observational-memory
/om:status
/om:view
/om:view full
```

我这边的触发写成按模型窗口比例：

```json
"observational-memory": {
  "compactAfterTokens": 81000,
  "compactAfterTokensMode": "ratio",
  "compactAfterTokensRatio": 0.68
}
```

Agent 可以用 `recall(<id>)` 把某条记忆的原文证据翻出来。仓库：[elpapi42/pi-observational-memory](https://github.com/elpapi42/pi-observational-memory)。

### `pi-tool-offloading`

自己写的。超过 4 KiB 的内置 `bash` / `read` 结果写到会话旁边的 `offloads/<session-id>/`。`bash` 立刻变成引用；大 `read` 先给模型看一遍，下一轮再收成引用。需要全文时让模型 `read` 那个 sidecar。失败就保留原文，不藏数据。

```bash
pi install /absolute/path/to/pi-tool-offloading/index.ts
```

sidecar 不会自动清，得自己删。仓库：[wutongyuonce/pi-tool-offloading](https://github.com/wutongyuonce/pi-tool-offloading)。

### `pi-workspace-history`

聊天树导航和真实工作区快照绑在一起。`/undo` 可以只回对话、也可以连文件一起回；中间你手改过的内容不会被悄悄盖掉。快照不进项目 Git。

```bash
pi install npm:pi-workspace-history
/undo
/redo
/tree
/checkpoint
```

Agent 把工作区改砸时用这个，不是编辑器里那套字符 undo。仓库：[wcldyx/pi-workspace-history](https://github.com/wcldyx/pi-workspace-history)。

### `pi-compact-thinking`

把「Thinking blocks: hidden」换成几行动画预览。和 `hideThinkingBlock: true` 一起用。配置在 `~/.pi/agent/compact-thinking.json`。它补丁的是 Pi 内部渲染，升 Pi 之后有可能要等扩展跟一版。

```bash
pi install npm:pi-compact-thinking
```

仓库：[nostalfinals/pi-compact-thinking](https://github.com/nostalfinals/pi-compact-thinking)。

---

## 7. 终端里怎么看、怎么问

### `@narumitw/pi-statusline`

底栏：模型、thinking、目录、分支、上下文占用、时间。窗口变窄时先扔优先级低的段。`/statusline` 换配色和信息量。

```bash
pi install npm:@narumitw/pi-statusline
/statusline
```

仓库：[narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-statusline)。

### `pi-zen-mode`

自己写的。思考和工具调用可以藏起来，正文照常流。跑完被藏的过程折成一行占位。`Ctrl+Alt+R` 展开最近一轮，`Ctrl+Alt+S` 挑更早的轮。关着的时候完全不碰 compact-thinking 的渲染。

```bash
pi install git:github.com/wutongyuonce/pi-zen-mode
/zen
```

| 键 | 作用 |
|---|---|
| `Ctrl+Alt+F` | 开关专注模式 |
| `Ctrl+Alt+R` | 展开 / 收起最近一轮 |
| `Ctrl+Alt+S` | 挑选更早的折叠轮 |

仓库：[wutongyuonce/pi-zen-mode](https://github.com/wutongyuonce/pi-zen-mode)。

### `@narumitw/pi-btw`

主任务进行中冒出一个不相干的问题，用 `/btw` 开旁路线程。默认不写回主对话，你明确「带回去」才进编辑器。

```bash
pi install npm:@narumitw/pi-btw
/btw 这个 TypeScript 报错是什么意思
```

仓库：[narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-btw)。

### `@juicesharp/rpiv-ask-user-question`

给模型一个 `ask_user_question`：最多 4 道题，每题 2–4 个选项，可带 preview。需求含糊时让它问，而不是猜完再改。

```bash
pi install npm:@juicesharp/rpiv-ask-user-question
```

仓库：[juicesharp/rpiv-mono](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-ask-user-question)。

### `@narumitw/pi-tool`

把当前会话里所有工具摊开：内置、SDK、扩展，带 schema 和系统提示片段。只读，不开关工具。扩展装多了，用它核对「模型到底看见哪些工具」。

```bash
pi install npm:@narumitw/pi-tool
/tool
```

仓库：[narumiruna/pi-extensions](https://github.com/narumiruna/pi-extensions/tree/main/packages/pi-tool)。

### `pi-transcribe`

本地语音。默认 `Ctrl+Alt+Z` 开始/结束录音，转写插到光标处。Agent 还可以对本地音视频调 `transcribe_file`（需要本机 `ffmpeg`）。模型得先 `/transcribe` 选一次并下载。

```bash
pi install ssh://git@github.com/earendil-works/pi-transcribe
/transcribe
```

仓库：[earendil-works/pi-transcribe](https://github.com/earendil-works/pi-transcribe)。

---

## 8. 联网和外部工具

### `@juicesharp/rpiv-web-tools`

两条工具：`web_search` 查，`web_fetch` 读页面。后端可以换 Brave / Tavily / Serper / Exa / Jina / Firecrawl / Perplexity / SearXNG / Ollama 等，钥匙按家存，切后端不会丢。`web_fetch` 挡私网和 loopback。

```bash
pi install npm:@juicesharp/rpiv-web-tools
/web-tools
```

也可以只丢环境变量，比如 `BRAVE_SEARCH_API_KEY`。仓库：[juicesharp/rpiv-mono](https://github.com/juicesharp/rpiv-mono/tree/main/packages/rpiv-web-tools)。

### `pi-mcp-adapter`

MCP 工具定义很肥，接几个 server 能在开聊前烧掉上万 token。这个适配器暴露一个大约 200 token 的 `mcp` 代理：先 `search` / `describe`，再用时才连对应 server。

```bash
pi install npm:pi-mcp-adapter
```

配置还是那些常见文件：`~/.config/mcp/mcp.json`、`.mcp.json`、`~/.pi/agent/mcp.json`、`.pi/mcp.json`。仓库：[nicobailon/pi-mcp-adapter](https://github.com/nicobailon/pi-mcp-adapter)。

---

## 9. 这套东西在一次活里怎么叠

非平凡改动大致是这个顺序，不是每次全开：

1. 需求含糊 → 问卷或 `/plan`
2. 搜仓库 → fff
3. 长任务 → tasks + goal；要平行探索 → subagents
4. 改文件时看 tidy-tools；危险命令走 guardrails
5. 大段 grep / 日志被 offloading 卸走；决策留给 observational-memory
6. 改砸了 → `/undo`；要人工看 diff → `/diff-review`
7. 当前文档过时 → web-tools；某个 MCP 能力 → mcp-adapter
8. 只想看结论 → zen-mode

---

## 10. 没装、但值得看的三个

### `pi-hermes-memory`

[chandra447/pi-hermes-memory](https://github.com/chandra447/pi-hermes-memory)

`pi-observational-memory` 管的是**同一条会话**跨 compact 不断线。Hermes 管的是**跨会话**：用 SQLite FTS5 搜以前聊过什么，把偏好、踩坑、纠正写成 markdown，后台每隔若干轮学习一次，还扫密钥避免写进记忆。

```bash
pi install npm:pi-hermes-memory
/memory-index-sessions
/learn-memory-tool
```

没装的原因：和 observational-memory 叠在一起，记忆写入会打两次，职责也糊。同一条会话的连贯我已经用 OM 了；跨会话检索以后若真缺，再单开它。

### `pi-lens`

[apmantza/pi-lens](https://github.com/apmantza/pi-lens)

比 `pi-lsp` 重一档。每次 write/edit 跑语言相关的 lint / typecheck，还有 impact cascade、ast-grep / tree-sitter 规则、`symbol_search`、`/lens-map` 依赖图、read-guard（没读过不准改）。也可以当 MCP server 给别的客户端用。

```bash
pi install npm:pi-lens
```

没装的原因：我已经有 `pi-lsp` 做中间诊断，仓库自己的检查才是收工标准。lens 的编辑时流水线更全，代价是更重、行为面更大。要结构搜索和符号漏斗时再换。

### `pi-web-access`

[nicobailon/pi-web-access](https://github.com/nicobailon/pi-web-access)

`rpiv-web-tools` 的另一个联网方案。提供商更多（含无 key 的 DuckDuckGo、自建 SearXNG、可选的浏览器 cookie Gemini Web），还有页面抽取和视频理解。可以零配置先搜起来。

```bash
pi install npm:pi-web-access
```

没装的原因：现在 `rpiv-web-tools` 的 `web_search` / `web_fetch` 够用，`/web-tools` 换后端也熟。两套联网工具同时注册，模型会选花。哪天需要无 key 兜底或视频帧，再迁过去，不要两套并行。

---

## 11. 更新这份清单时看哪

- 是否在生产会话里：`~/.pi/agent/settings.json` 的 `packages`
- npm 版本：`~/.pi/agent/npm/package.json`
- 本地镜像和解析笔记：[wutongyuonce/pi-extensions](https://github.com/wutongyuonce/pi-extensions)
- 自己写的两件：`pi-zen-mode`、`pi-tool-offloading`
