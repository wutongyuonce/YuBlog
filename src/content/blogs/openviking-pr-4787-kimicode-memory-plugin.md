---
title: "OpenViking PR #4787：Kimi Code 记忆插件实现报告"
description: 从最终合并代码出发，拆解 Kimi Code 的 Hook 适配、共享 runtime、wire 增量捕获、MCP 接入与安装组装链路。
pubDate: 2026-09-13
lastModDate: 2026-09-23
category: 技术向
tags: [OpenViking, Kimi Code, Agent Memory, PR]
titleImage: /blog-title-images/yae-miko.webp
titleImageAlt: 八重神子动漫角色壁纸
toc: true
search: true
draft: false
---

> 对应 PR：[feat(plugins): add Kimi Code CLI memory plugin #4787](https://github.com/volcengine/OpenViking/pull/4787)
>
> 关联 Issue：[[Feature]: 请做 zcode 和 kimicode 适配 #3442](https://github.com/volcengine/OpenViking/issues/3442)
>
> 本文关注插件本身的宿主适配与代码调用链。OpenViking Server 的记忆提取、存储和检索机制另见《[看懂 OpenViking：从服务运行到上下文写入、检索与记忆提取](https://www.wutongyu.site/blogs/openviking/)》。
>
> 源码基线：PR 合并提交 [03391bae](https://github.com/volcengine/OpenViking/commit/03391bae4335eacf440a62d942f3951de6a63cbe)。Kimi Code 宿主协议按仓库中的 host contract 核对，目标版本为 CLI 0.43.1。

## 1. 先说结论：Kimi 是一个 host adapter，不是一套新 runtime

PR #4787 的工作，是把 Kimi Code 的 Hook、会话 transcript 和原生插件安装机制接到 OpenViking 已有的 agent-hook runtime 上。

最终结构是：

```text
Kimi Code 生命周期与会话数据
          │ Hook stdin/stdout、wire.jsonl、MCP
          ▼
examples/agent-hook-plugin/
  hosts/kimicode.mjs       Kimi 协议适配
  hosts/kimicode-turns.mjs wire 日志解析
  scripts/hook.mjs         共用 Hook dispatcher
          │
          ├── examples/memory-plugin-shared/lib/
          │     配置、身份、召回、捕获过滤、队列、HTTP、MCP 代理
          ▼
     OpenViking Server
```

Kimi 专属代码负责回答“这个宿主怎样表达事件、输入和输出”；共享 runtime 负责“记忆插件怎样召回、捕获、重试并调用 OpenViking”。

最终实现可以从 [Kimi host adapter](https://github.com/volcengine/OpenViking/blob/03391bae4335eacf440a62d942f3951de6a63cbe/examples/agent-hook-plugin/hosts/kimicode.mjs)、[共用 dispatcher](https://github.com/volcengine/OpenViking/blob/03391bae4335eacf440a62d942f3951de6a63cbe/examples/agent-hook-plugin/scripts/hook.mjs) 和 [host contract](https://github.com/volcengine/OpenViking/blob/03391bae4335eacf440a62d942f3951de6a63cbe/examples/agent-hook-plugin/hosts/kimicode/DESIGN.md) 三处顺着读。

## 2. 目录与职责：差异留在 adapter，共性留在 dispatcher

代码的职责边界大致如下：

| 路径 | 负责什么 |
| --- | --- |
| `hosts/kimicode/kimi.plugin.json` | Kimi 原生插件 manifest：注册 Hooks 与 MCP server |
| `hosts/kimicode.mjs` | 事件映射、prompt 解析、响应格式、URI guard 和 Kimi commit 时机 |
| `hosts/kimicode-turns.mjs` | 从 Kimi 的索引与 wire 日志中恢复尚未捕获的对话 turn |
| `hosts/incremental-turn-capture.mjs` | 将 turn 变成待发消息、追踪确认与推进游标 |
| `scripts/hook.mjs` | 跨宿主共用的 Hook 状态机与生命周期编排 |
| `scripts/uri-guard.mjs` | 统一入口；把宿主输入交给对应 adapter 的 guard |
| `examples/memory-plugin-shared/lib/` | 配置解析、Session 身份、profile/recall、消息写入、pending 队列和 MCP 传输 |
| `examples/memory-plugin-shared/install.sh` | 组装运行目录并调用 Kimi 原生插件安装器 |

这意味着 Kimi adapter 没有复制一份 prompt 去重、跨进程锁、配置解析或消息队列。Kimi 的协议差异由 `HOSTS.kimicode` 这个对象表达；共用 dispatcher 根据这个 adapter 提供的事件阶段和回调执行流程。

插件 manifest 与 adapter 也有不同用途：manifest 告诉 Kimi“何时启动哪个命令”；adapter 告诉 OpenViking dispatcher“这个事件在本宿主里意味着什么”。

## 3. Hook 适配的关键：把 Kimi 的输入输出契约翻译准确

Kimi 原生 manifest 在 [`kimi.plugin.json`](https://github.com/volcengine/OpenViking/blob/03391bae4335eacf440a62d942f3951de6a63cbe/examples/agent-hook-plugin/hosts/kimicode/kimi.plugin.json) 中声明了这些 Hook：

| Kimi 事件 | 传给共享 dispatcher 的阶段 | 目的 |
| --- | --- | --- |
| `SessionStart` | `start` | 重放 pending 写入；为本会话初始化状态 |
| `UserPromptSubmit` | `prompt` | 召回上下文，并在首轮注入 profile |
| `PreToolUse` | 独立 URI guard | 阻止 Read / Glob / Grep 把 `viking://` 当本地路径 |
| `Stop` | `capture` | 读取 wire 增量并按阈值决定是否 commit |
| `PreCompact` | `capture` | 压缩前捕获 |
| `SessionEnd` | `capture` | 会话结束时捕获并提交 |
| `Interrupt` | `capture-sync` | 中断时同步捕获 |

### 3.1 Prompt 字段和注入输出

Kimi 传入的 prompt 字段是 `prompt`，而且可以是字符串，也可以是带 `text` 的 content-part 数组。adapter 的 `prompt()` 从 `input.prompt` 读取，并将数组部分合并为文本后清理。

输出格式同样由宿主决定。Kimi 的 `UserPromptSubmit` 接受 stdout 上的原始文本，adapter 的 `envelope()` 因此直接返回召回文本；它不包成 ZCode 等宿主使用的 JSON envelope。只有 `PreToolUse` 拒绝访问 `viking://` 时，adapter 才返回 Kimi 要求的 `hookSpecificOutput.permissionDecision` 结构。

所以这两个转换必须成对正确：

```text
Kimi stdin: prompt
→ adapter.prompt(input.prompt)
→ shared dispatcher: profile + recall
→ adapter.envelope(...): 原始文本
→ Kimi 把 stdout 文本加入当前模型上下文
```

### 3.2 为什么 profile 放在第一次 prompt 注入

Kimi 的 `SessionStart` Hook 不用于注入模型上下文。因此 adapter 声明 `profileStage: "first-prompt"`：

- `SessionStart` 负责 pending 队列回放和去重状态；
- 第一次 `UserPromptSubmit` 才读取 profile；
- 后续 prompt 不重复注入 profile，只按当前问题做 recall。

这项策略不在 Kimi hook 脚本里再造一套状态机，而是由共用 dispatcher 的 `sessionStart()` 和 `promptSubmit()` 按 adapter 配置执行。

## 4. Prompt 进入 OpenViking 的完整调用链

一次提问前的自动召回可沿着以下路径追踪：

```text
kimi.plugin.json
→ scripts/hook.mjs <user-prompt-submit> kimicode
→ runHookStage() 解析 stdin、配置、cwd 和 session
→ HOSTS.kimicode.prompt(input)
→ promptSubmit(ctx)
    ├─ 按 session 加锁并读取 hook state
    ├─ 用事件 id 去重；缺 id 时用 prompt hash + 500ms 窗口
    ├─ 首次 prompt 时 buildAgentProfile()
    └─ recallForPrompt(..., { sessionId })
→ adapter.envelope()
→ stdout 原始上下文文本
```

共用 dispatcher 会用 Kimi 原生 `session_id` 解析本地状态身份，再由 adapter 的 `prefix: "kc-"` 派生 OpenViking Session ID。这个 ID 会作为 recall 调用的 `sessionId` 传入共享 runtime，使服务端可以把本次查询关联到同一个 OpenViking 会话。

本地 hook state 也按 Kimi 会话隔离，记录 profile 是否注入、最近 prompt 的去重信息、召回块、待捕获 prompt 和 wire 游标等。共享的 `withAgentHookLock()` 避免同一会话并发 Hook 互相覆盖状态；不同 Kimi 会话仍各自维护状态。

需要注意，Hook 失败时不会因为记忆服务不可用而拒绝用户提问。这个边界由共享 Hook 流程处理：错误记录到插件日志，prompt hook 尽量正常结束；因此“Agent 继续运行”并不表示“本轮一定成功召回”。

## 5. 回合结束后：以 wire.jsonl 为 transcript 来源

Kimi Hook 输入可能包含摘要或预览，但最终实现将本地会话的 `agents/main/wire.jsonl` 作为对话捕获来源。解析器先读 `session_index.jsonl`，用 Kimi 的 `session_id` 找到对应 `sessionDir`，再打开：

```text
<KIMI_CODE_HOME>/session_index.jsonl
  └─ sessionId → sessionDir
       └─ agents/main/wire.jsonl
```

如果索引缺失或找不到 session，解析器会扫描 sessions 目录里的候选路径。核心逻辑在 [`kimicode-turns.mjs`](https://github.com/volcengine/OpenViking/blob/03391bae4335eacf440a62d942f3951de6a63cbe/examples/agent-hook-plugin/hosts/kimicode-turns.mjs)。

解析器关心的是能形成用户/助手消息的少量 wire 事件：

| wire 事件 | 插件如何处理 |
| --- | --- |
| `context.append_message` 且角色为 user | 收集用户文本，等待与 turn 绑定 |
| `turn.prompt` | 在没有 append message 文本时作为用户文本来源 |
| `context.append_loop_event` 中的 `content.part` 且类型为 text | 按 turn id 拼接助手文本 |
| `turn.ended` | 结束当前 turn，并绑定尚未绑定的用户消息 |

`turn.ended` 不能省略：工具调用或中断可能结束一个没有助手文本的 turn。若解析器只在遇到助手文本时才关账，用户消息就可能滞留，甚至被错误地绑定到后续 turn。

解析时会跳过损坏的 JSON 行，只提取文本，不把 think 或任意工具事件原样写入记忆消息。最后，`cleanKimicodeText()` 会去掉此前注入的 OpenViking context 等标记，避免把召回内容再当成新对话捕获。

## 6. 增量捕获：确认后再推进游标

`kimicode-turns.mjs` 根据 hook state 的 `lastTurnId` 产出后续 turn；`incremental-turn-capture.mjs` 再调用共享的 `shouldCaptureText()` 做过滤，并为每条消息构造去重键：

```text
有 wire turn id：<turnId>:<role>
无 turn id：stableHash(role, content)
```

插件把尚未确认的消息交给共享 runtime 的 `addAgentMessages()`，优先走批量写入。共享 runtime 返回已写入数和已进入 pending 队列数；两者都视为插件侧已接手。状态只确认连续成功的前缀，并把去重键集合限制在最近 1000 条。只有一个 turn 的候选消息都确认后，`lastTurnId` 才推进到该 turn。

```text
wire 新增 turn
→ 过滤与清理
→ 去重并生成 payload
→ addAgentMessages()
→ 成功写入或进入 pending queue
→ 更新 capturedTurnIds / lastTurnId
```

这一顺序避免两类问题：反复发送已经接收的消息，以及某条消息尚未持久化就把游标越过它。pending 重试、HTTP 和消息写入实现都属于共享 runtime；Kimi adapter 只提供它所需的真实 turn 和宿主状态。

当前代码没有旧稿提到的“wire 不可用时从 Hook stdin 的 response preview 回退生成助手消息”路径。wire 解析若返回 missing 或 unreadable，adapter 会记录捕获状态并结束这次捕获；这让数据来源保持单一、可追踪。

## 7. 捕获与 commit 是两个阶段

消息进入 OpenViking Session 后，Kimi adapter 再按事件和已捕获消息数决定是否调用 `commitAgentSession()`：

- `Stop`：累计捕获消息达到 `commitTurnThreshold` 时提交，默认阈值为 8；
- `PreCompact`：按 `autoCommitOnCompact` 决定是否提交；
- `SessionEnd` 和 `Interrupt`：本次有新捕获消息时提交；
- 没有新增消息：不提交。

对应策略集中在 [`shouldCommitKimicodeCapture()`](https://github.com/volcengine/OpenViking/blob/03391bae4335eacf440a62d942f3951de6a63cbe/examples/agent-hook-plugin/hosts/kimicode.mjs)。因此不是每次 Stop 都触发一次完整记忆提取。插件负责写入 Session 和发出 commit；commit 之后 OpenViking 服务端如何归档、总结和抽取长期记忆，不由 Kimi adapter 实现。

### 7.1 为什么 Interrupt 同步，其余捕获可以脱离

共用 dispatcher 通过 `maybeDetach()` 处理耗时的捕获阶段：Stop、PreCompact、SessionEnd 可以启动后台 worker，让 Kimi 不必等待完整网络写入。

Interrupt 则映射到 `capture-sync`，不进入 detached 分支。因为中断可能代替 Stop，插件需要在宿主会话状态变化前读完 wire 并保存已有内容。Kimi adapter 为 Interrupt 设置 2 秒共享请求预算；预算耗尽时，Hook 结束而不无限等待。

## 8. MCP 是按需工具通道，和自动召回分开

自动召回由 `UserPromptSubmit` 在每次提问前触发；MCP 则提供 Agent 主动调用 OpenViking 的工具通道。原生 manifest 注册一个 stdio MCP server：

```text
Kimi Code MCP client
→ agent-integrations/kimicode/servers/mcp-proxy.mjs
→ shared stdio-to-HTTP proxy
→ OpenViking Server /mcp
```

身份、凭据、HTTP 细节和 MCP 会话转发沿用共享代理，不是 Kimi 再实现一套。另一个窄适配点是 URI guard：`PreToolUse` 只对 Read、Glob、Grep 检查 `tool_input`；若普通文件工具试图读取 `viking://`，就返回 Kimi 能识别的拒绝结构，提示改用 OpenViking MCP 工具。

这条 guard 是工具路由保护，不是操作系统级权限边界。它不取代 Kimi Code 自己的授权机制。

## 9. 安装时组装，而非把共享目录复制进仓库

用户执行：

```bash
bash examples/memory-plugin-shared/install.sh --harness kimicode
```

安装脚本使用 `assemble_agent_integration()`，结合共享运行时的 `MANIFEST`，把 host 插件实际 import 的模块组装进临时 bundle；随后：

1. 删除测试、文档以及其他宿主的无关文件；
2. 将 Kimi manifest 放到 bundle 根目录；
3. 保存一份轻量安装/卸载 helper；
4. 调用 `kimicode-plugin.mjs install`；
5. 通过暂存目录替换 Kimi managed plugin；注册表也先写入临时文件，再 rename 到 `plugins/installed.json`。

入口代码见 [`install_kimicode()`](https://github.com/volcengine/OpenViking/blob/03391bae4335eacf440a62d942f3951de6a63cbe/examples/memory-plugin-shared/install.sh)；Kimi 注册表和 managed directory 的维护见 [`kimicode-plugin.mjs`](https://github.com/volcengine/OpenViking/blob/03391bae4335eacf440a62d942f3951de6a63cbe/examples/memory-plugin-shared/lib/install/kimicode-plugin.mjs)。

这样源码仓库只维护共享 runtime 的一个权威版本，而 Kimi 安装目录仍然是可独立运行的自包含插件。安装不再编辑旧式 `config.toml` 或 `mcp.json`，也不依赖不存在的 `kimi plugin install` CLI 子命令。

这解释了最终实现与早期版本的结构差异：PR 最初有独立的 Kimi 目录和重复 shared runtime；重构后，Kimi host adapter 收敛到 `agent-hook-plugin`，安装器负责按依赖闭包组装。旧稿中关于 `kimicode-hook.mjs`、`kimicode-capture.mjs`、`merge-config.mjs` 和手工修改配置文件的叙述，均不代表最终合并代码。

## 10. 最终实现与待跟进项

PR #4787 的最终链路可以概括为：

```text
安装器按 manifest 组装 Kimi 原生插件
→ SessionStart 恢复必要状态
→ UserPromptSubmit 读取 prompt、注入首轮 profile 并召回
→ Kimi 运行 Agent，wire.jsonl 记录真实对话
→ Stop / PreCompact / SessionEnd / Interrupt 触发增量捕获
→ shared runtime 写入或排队
→ adapter 按策略 commit OpenViking Session
```

这次实现的关键不在于新增了多少 Kimi 专属代码，而在于把最小宿主差异放到正确 seam：Kimi 的 prompt 和 Hook 响应协议、事件生命周期、wire transcript 与原生安装注册由 adapter 处理；召回、状态协调、过滤、HTTP 和 pending 队列继续复用共享 runtime。

还有一个合并时记录的后续小修：Kimi manifest 为 `SessionStart` 设置了 `OPENVIKING_PENDING_REPLAY_LIMIT=2`，但 Kimi 的 `enabledHooks()` 会用 `KIMI_CODE_HOME` 与 `KIMI_PLUGIN_ROOT` 覆盖每个 hook 的 `env`，所以这个 replay limit 在当前实现中可能不会生效。该项不影响本次 prompt 字段修复和 PR 合并，适合作为后续适配修正单独处理。
