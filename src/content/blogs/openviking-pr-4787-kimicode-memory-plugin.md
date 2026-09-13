---
title: "OpenViking PR #4787：Kimi Code 记忆插件实现报告"
description: 从 Hook 映射、召回注入、wire 日志增量捕获与 MCP 代理，拆解 Kimi Code 如何接入 OpenViking 长期记忆。
pubDate: 2026-09-13
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
> 本文默认读者已经读过《[看懂 OpenViking：从服务运行到上下文写入、检索与记忆提取](https://www.wutongyu.site/blogs/openviking/)》，因此不再重复 OpenViking Server、`viking://` 文件系统和长期记忆提取的内部原理。
>
> 源码基线：PR 当前最终实现提交 [`0409529a`](https://github.com/volcengine/OpenViking/commit/0409529aa59c6812703490182ca50065085afb55)。Kimi Code 宿主协议按插件中记录的 CLI 0.41.0 实现。

## 1. 本质总结

PR #4787 给 OpenViking 增加了一个 Kimi Code CLI 宿主适配器。它并没有在 Kimi Code 中重新实现记忆系统，而是把 Kimi Code 已有的 Hook、会话日志和 MCP 扩展面，接到 OpenViking 已有的共享 memory plugin runtime 上。

最终形成两条相互独立、又共用身份与凭据的链路：

```text
自动记忆链路：
Kimi Code 生命周期事件
→ Hook 子进程
→ 提问前从 OpenViking 召回上下文
→ 通过 stdout 注入当前模型回合
→ 回合结束后解析 wire.jsonl
→ 向 OpenViking Session 增量写入用户/助手消息
→ commit 触发后续记忆处理

主动工具链路：
Kimi Code 中的 Agent
→ 调用 openviking MCP 工具
→ 本地 stdio MCP 代理
→ OpenViking Server /mcp
→ 搜索、读取或操作 viking:// 上下文
```

前一条链路不依赖模型“记得使用记忆工具”：召回发生在提问提交时，捕获发生在回合停止、压缩、会话结束或中断时。后一条链路才是模型按需主动调用的工具面。

## 2. PR 实现了哪一层

对已经理解 OpenViking 的读者，这个 PR 可以放在以下位置：

```text
┌─────────────────────────────────────────────┐
│ Kimi Code CLI                              │
│ prompt / tool / session / wire transcript │
└──────────────────┬──────────────────────────┘
                   │ Hook stdin/stdout + stdio MCP
┌──────────────────▼──────────────────────────┐
│ kimicode-memory-plugin                      │
│ 宿主适配：事件、输出协议、日志解析、安装配置     │
└──────────────────┬──────────────────────────┘
                   │ 调用共享能力
┌──────────────────▼──────────────────────────┐
│ memory-plugin-shared                       │
│ 凭据 / peer / recall / profile / capture / queue │
│ session API / MCP HTTP proxy                │
└──────────────────┬──────────────────────────┘
                   │ HTTP / MCP
┌──────────────────▼──────────────────────────┐
│ OpenViking Server                           │
│ 上下文检索、Session 归档、记忆提取与持久化       │
└─────────────────────────────────────────────┘
```

Kimi 适配层只解决四类宿主问题：

- 在哪些 Kimi Code 事件上触发召回或捕获；
- Hook 的 stdin 怎样解析，stdout 应该返回什么格式；
- 怎样从 Kimi Code 的 `wire.jsonl` 恢复可写入 OpenViking 的 turn；
- 怎样在不破坏用户现有配置的情况下安装 Hook 和 MCP。

凭据解析、工作区 peer 身份、召回预算、profile 组装、消息批量写入、失败队列和 MCP 转发等通用逻辑，仍然由 `examples/memory-plugin-shared/lib/` 维护。`sync.mjs` 把 Kimi Code 需要的共享模块生成到插件目录，所以 `scripts/shared/` 是发布时自包含的运行时副本，不是第二套记忆实现。

## 3. 为什么不能把 ZCode 插件直接改名

PR 以已合并的 ZCode 适配器为结构模板，但两个宿主的协议不同：

| 接入点 | Kimi Code | ZCode |
| --- | --- | --- |
| Hook 配置 | `~/.kimi-code/config.toml` 中的 `[[hooks]]` | JSON `hooks.events` |
| MCP 配置 | `~/.kimi-code/mcp.json` 中的 `mcpServers` | CLI config 中的 `mcp.servers` |
| Hook 输入 | `session_id`、`hook_event_name`、`tool_name` 等 snake_case 字段 | 另一套 JSON 结构 |
| 召回注入 | `UserPromptSubmit` 的纯 stdout 文本 | `hookSpecificOutput.additionalContext` JSON |
| 可用结束事件 | `Stop`、`PreCompact`、`SessionEnd`、`Interrupt` | 没有完全对等的事件集 |
| 会话真相源 | `session_index.jsonl` 指向的 `wire.jsonl` | `model-io-*.jsonl` rollout |

其中最容易出错的是输出协议。Kimi Code 在 `UserPromptSubmit` 上会把 Hook stdout 直接追加到模型上下文。如果沿用 ZCode 的 JSON 包装，模型看到的会是 JSON 文字本，而不是被宿主解包后的 additional context。

所以 `kimicode-hook.mjs` 专门使用：

```js
function outputPlainContext(text) {
  if (!text) return;
  process.stdout.write(`${text}\n`);
}
```

这个差异不是格式偏好，而是召回内容能否真正进入本回合 prompt 的协议边界。

## 4. 安装后实际改变了什么

共享安装器增加 `kimicode` harness：

```bash
bash examples/memory-plugin-shared/install.sh --harness kimicode
```

它会识别 `kimi` 可执行文件或 `~/.kimi-code/` 目录，然后完成三件事：

1. 把自包含的运行时组装到 `~/.openviking/agent-integrations/kimicode/`；
2. 向 `~/.kimi-code/config.toml` 写入 OpenViking 的 `[[hooks]]` 配置块；
3. 向 `~/.kimi-code/mcp.json` 写入 `mcpServers.openviking`。

Hook 配置被包在一对明确的注释标记中：

```toml
# >>> openviking kimicode integration
[[hooks]]
event = "UserPromptSubmit"
command = ".../node '.../scripts/kimicode-hook.mjs' user-prompt-submit"
timeout = 20
# ...
# <<< openviking kimicode integration
```

重复安装时，`merge-config.mjs` 先移除旧的 OpenViking 标记块，再写入新块。它不重建整份 TOML，因此 Herdr、Orca 或用户手写的其他 Hook 会保留。MCP 则只 upsert `mcpServers.openviking`，不删除其他 server。

写配置时会保留 `.bak` 备份，新内容先写入同目录临时文件，再通过 rename 替换目标，避免进程中断留下半份配置。卸载时也只删除这个标记块，MCP 条目只在能确认由 OpenViking 管理时移除。

### 4.1 为什么同时还有 `kimi.plugin.json`

Kimi Code 也支持原生插件清单。`kimi.plugin.json` 声明同一组 Hook 和 `openviking` MCP server，因此源码目录还可以通过 Kimi Code 的 `/plugins install <path>` 安装。

两种入口的运行逻辑相同：

- 共享 `install.sh` 负责跨 harness 安装、凭据与存量配置合并；
- `kimi.plugin.json` 让 Kimi Code 自己能识别和管理这个插件包。

它们不是两套功能实现。

## 5. 生命周期映射

`kimi.plugin.json` 和安装器最终都注册下列事件：

| Kimi Code 事件 | 插件行为 | 是否向当前回合输出内容 |
| --- | --- | --- |
| `SessionStart` | 重置本会话的 profile 注入标记，回放离线 pending 队列 | 否 |
| `UserPromptSubmit` | 获取当前问题，召回记忆，首次时同时注入 profile | 是，纯文本 |
| `PreToolUse` + `Read\|Glob\|Grep` | 拒绝用普通文件工具直接读 `viking://` | 仅在拒绝时返回决策 JSON |
| `Stop` | 捕获本轮对话并 commit | 否，始终放行 Stop |
| `PreCompact` | 在上下文压缩前捕获对话 | 否 |
| `SessionEnd` | 会话关闭时做最后一次捕获 | 否 |
| `Interrupt` | 用户中断当前 turn 时同步捕获 | 否 |

`SessionStart`、`SessionEnd`、`PreCompact` 和 `Interrupt` 都是 observation-only 事件，它们的返回值不会被宿主用来注入上下文。因此 profile 不在 `SessionStart` 上打印，而是延迟到本会话第一次 `UserPromptSubmit`。

`Interrupt` 的语义也必须单独处理：用户按 Esc 中断时，Kimi Code 发出 `Interrupt` 而不再发 `Stop`。如果只监听 Stop，被中断 turn 中已经出现的用户消息和部分助手输出就不会进入捕获链路。

## 6. 会话身份和本地状态

Hook stdin 中的 Kimi Code `session_id` 是宿主会话身份。插件先用它找本地 Hook 状态，再派生出带 `kc-` 前缀的 OpenViking Session ID：

```text
Kimi Code session_id
├──→ ~/.openviking/hook-state/kimicode/<native-session-id>.json
└──→ OpenViking session: kc-<derived-id>
```

本地状态主要保存：

- `profileInjected`：本会话是否已注入过 profile；
- `promptHash` / `promptEventId` / `promptAt`：识别重复的提问 Hook；
- `recallBlock`：相同 prompt 重入时复用已召回内容；
- `pendingPrompt`：在 wire 尚不可用时作为用户消息回退源；
- `capturedTurnIds`：已被服务器接收或已进入重试队列的消息键；
- `lastTurnId`：已完整确认的 wire turn 游标。

因为 Kimi Code 可能在很短时间内发出多个 Hook 子进程，状态读改写被 `withAgentHookLock()` 包住。这是一个按 `clientId + nativeSessionId` 划分的本地目录锁：同一 Kimi 会话的召回和捕获不会同时覆盖状态，不同会话不共用一把锁。状态文件同样通过临时文件加 rename 原子替换。

## 7. 提问前：profile 和召回内容怎样进入回合

### 7.1 `SessionStart` 只做准备

会话启动时，Hook 会：

1. 用 2 秒窗口过滤重复的 SessionStart；
2. 把 `profileInjected` 重置为 `false`；
3. 尝试回放以前因 OpenViking 暂时不可用而留在本地的 pending 写入。

它不输出 profile。这不是延迟优化，而是因为 Kimi Code 对 SessionStart 返回值不做上下文注入。

### 7.2 `UserPromptSubmit` 是唯一的自动注入点

提问提交后，`kimicode-hook.mjs` 从多个可能的输入字段取出用户文本，先删除可能已存在的 OpenViking 注入块，再进入锁内的召回流程。

去重优先使用 Kimi Code 提供的 `prompt_id`、`request_id` 或 `message_id`。如果都没有，就用 prompt hash 加 500 ms 时间窗口识别近距离重复事件。相同 prompt 已经获得过 `recallBlock` 时，也不会重复请求服务器。

真正的召回由共享 runtime 完成：

```text
prompt + cwd
→ 解析 workspace peer 身份
→ POST /api/v1/search/search
   mode = context
   purpose = coding
   session_id = kc-...
→ OpenViking 执行查询扩展、跨 turn 去重、检索与预算组装
→ <openviking-context>...</openviking-context>
```

这里把派生后的 OpenViking Session ID 传给 search 很重要。它不只表示“这是哪段对话”，还让服务器能基于该会话做 query expansion 和近期召回结果去重。

如果服务器不支持新的 context search 形状，共享 runtime 会退到 `/api/v1/search/recall`，再在更老的部署上退到分类搜索和本地组装。这些兼容逻辑不在 Kimi 适配器中重复。

### 7.3 profile 只注入一次

本会话第一次有效提问还会调用 `buildAgentProfile()`，根据当前 workspace peer 读取用户与 Agent 的稳定背景。profile 被包成：

```xml
<openviking-context source="session-start">
  ...profile...
</openviking-context>
```

然后与本次 query 的 recall block 拼接，一次性作为纯文本写到 stdout。之后的提问只召回与当前问题相关的上下文，避免每一轮都重复注入整份 profile。

## 8. MCP 工具和 `viking://` URI 守卫

自动召回只适合把有限的相关上下文放入 prompt。当 Agent 需要继续搜索、读取某个 URI 的详细内容或使用其他 OpenViking 能力时，走的是 MCP 链路。

Kimi Code 启动 `servers/mcp-proxy.mjs` 作为本地 stdio server。它不实现另一份 OpenViking tool schema，而是：

```text
Kimi Code JSON-RPC/stdin
→ mcp-proxy.mjs
→ 加入 API key、account、user、actor peer 和 User-Agent
→ HTTP POST OpenViking /mcp
→ 保留 MCP session id 与协议版本
→ 将 JSON 或 SSE 结果返回 Kimi Code stdout
```

与此同时，`PreToolUse` 只匹配 `Read|Glob|Grep`。`uri-guard.mjs` 检查这些普通文件工具的输入；如果目标是 `viking://` URI，它返回 Kimi Code 支持的拒绝结构：

```json
{
  "hookSpecificOutput": {
    "permissionDecision": "deny",
    "permissionDecisionReason": "..."
  }
}
```

这不是为 OpenViking 增加 OS 级权限隔离。它只是防止模型把虚拟 URI 当成本地路径交给 `Read`、`Glob` 或 `Grep`，并引导它改用理解 `viking://` 协议的 MCP 工具。Kimi Code Hook 本身是 fail-open，不应被解释为安全边界。

## 9. 回合后：怎样从 `wire.jsonl` 恢复对话

### 9.1 先用索引定位真实日志

Kimi Code 的权威增量会话日志不是 Hook stdin 中的一段预览文本，而是主 Agent 的 `wire.jsonl`。`kimicode-turns.mjs` 先在：

```text
$KIMI_CODE_HOME/session_index.jsonl
```

查找当前 `session_id` 对应的 `sessionDir`，再定位：

```text
<sessionDir>/agents/main/wire.jsonl
```

索引不存在、损坏或没找到对应行时，解析器才扫描 `$KIMI_CODE_HOME/sessions/` 下的候选会话目录。

### 9.2 wire 事件怎样合成 user/assistant turn

解析器只取记忆链路需要的文本：

| wire 事件 | 处理方式 |
| --- | --- |
| `context.append_message` 且 `role=user` | 保存待绑定的用户文本 |
| `turn.prompt` | 当 append message 没有提供文本时作为回退 |
| `context.append_loop_event` + `content.part(type=text)` | 按 `turnId` 拼接助手文本分片 |
| `turn.ended` | 关闭当前 turn，即使该 turn 没有助手文本 |

`think` 内容不会进入捕获结果。助手的多个 text part 会按同一 `turnId` 连接，用户消息和助手消息再转换为 OpenViking 接受的：

```json
{
  "role": "assistant",
  "content": "...",
  "turn_id": "..."
}
```

`turn.ended` 是一个关键边界。工具型 turn 或用户中断的 turn 可能没有助手 text part；如果只在看到助手文本时才把 pending user 绑定到 turn，这类用户消息会一直悬空，还可能错绑到下一轮。

### 9.3 捕获前先去掉注入内容

模型看到的上下文可能已经包含：

- `<openviking-context>`；
- `<relevant-memories>` / `<relevant-memory>`；
- `<system-reminder>`。

`cleanKimicodeText()` 在生成捕获 turn 前删除这些注入块。否则上一轮从 OpenViking 召回的内容会被当成新对话再写回 OpenViking，形成记忆自我复制。

### 9.4 wire 缺失时的回退

只有当 `wire.jsonl` 无法获取时，插件才从 Hook stdin 里尝试取 `responseText`、`responsePreview`、`last_assistant_message` 等助手文本，并用提问阶段保存的 `pendingPrompt` 恢复用户文本。

这个回退保证了日志尚未落盘或路径不可用时仍然可以尝试捕获，但不会反过来覆盖 wire 日志这个主真相源。

## 10. 增量捕获、确认和 commit

`buildKimicodeCapturePlan()` 不会把每次 Hook 看到的整份 wire 日志重发。它先从 `lastTurnId` 之后取未见 turn，然后依次执行：

```text
原始 turn
→ 按角色和内容过滤不应捕获的文本
→ 对过长内容截断
→ 生成 turnId:role 去重键
→ 排除 capturedTurnIds 中已确认项
→ 构造 role/content/turn_id payload
```

有 `turnId` 时，用户和助手文本分别用 `<turnId>:user` 和 `<turnId>:assistant` 去重；无 `turnId` 的回退消息才使用 `role + content` 的稳定 hash。去重键使用截断前的原始 turn，所以日后调大捕获长度上限也不会把旧 turn 再发一次。

写入优先使用批量端点：

```text
POST /api/v1/sessions/<kc-session-id>/messages/batch
```

共享 runtime 以 100 条为一批发送。旧服务器对该端点返回 404 或 405 时，它再回退到逐条调用 `/messages`。

服务器成功接收，或者暂时失败但消息已成功进入本地 pending 队列，都算插件侧已确认。插件只从待发列表头部连续推进确认状态，不会越过一条未保存消息去确认更后面的 turn。`lastTurnId` 也只能推进到用户与助手候选都已确认的完整 turn，这避免局部写入后把游标跳到缺口之后。

只要本次有新捕获内容，Hook 就继续调用：

```text
POST /api/v1/sessions/<kc-session-id>/commit
```

因此插件的职责到“将会话消息增量写入并提交 OpenViking Session”为止。commit 后如何生成会话摘要、提取并去重长期记忆，仍然是 OpenViking Server 的职责。

## 11. 为什么大部分写入使用分离进程

`Stop`、`PreCompact` 和 `SessionEnd` 触发时，Hook 进程首先读完 stdin，然后启动一个脱离当前终端的 Node 子进程，把原始输入转交给它，父进程立即正常结束：

```text
Kimi Code Hook 调用
→ parent 读完 stdin
→ spawn detached worker，设 OV_HOOK_WORKER=1
→ parent 不输出阻断内容并返回
→ worker 重新进入 kimicode-hook.mjs
→ 解析 wire、写 messages、commit、更新状态
```

这样网络写入不占用 Kimi Code 等待 Hook 返回的时间。事件名会先复制到 `OPENVIKING_HOOK_EVENT` 环境变量，因为 worker 重启时只复用当前脚本路径，不会自动带上原来的事件 argv。

`Interrupt` 刻意不走 detached worker。它会代替 Stop，如果中断 Hook 也立即返回，宿主会话可能在后台 worker 来得及读取前改变或退出。所以 Interrupt 在 Hook 进程内同步完成捕获，用更短的宿主超时预算换取中断轮次的持久化边界。

## 12. 网络失败时如何不丢写入

Hook 的总体策略是对 Kimi Code fail-open：配置关闭、命中 bypass 规则、输入 JSON 损坏或处理异常时，脚本都不应卡住用户的 Agent 回合。召回失败时本轮只是没有附加记忆，不会拒绝提问。

写入路径则在 fail-open 之外增加本地 pending 队列：

```text
addMessage / commitSession 失败
→ 判断是否为可重试失败
→ 按操作类型 + session + payload 生成去重键
→ 以 0600 文件写入 ~/.openviking 下的 pending 目录
→ 下次 SessionStart 有界地按时间顺序回放
```

回放时先用 rename 把 `.json` 文件原子声明为 processing，只有抢到该文件的 Hook 进程才会发起请求。成功后删除；可重试失败则增加重试次数；非可重试失败则不再无限循环。每次 SessionStart 的回放数也有上限，避免服务恢复时一次性冲击服务器。

这个设计把两个结果分开了：

- OpenViking 暂时不可用，不应让 Kimi Code 无法继续工作；
- Kimi Code 继续工作，也不意味着已经形成的对话只能直接丢弃。

## 13. 完整运行时序

一次正常会话的数据流可以收敛为：

```text
启动会话
Kimi Code
  → SessionStart
  → 插件重置 profileInjected，回放 pending 写入

用户提问
Kimi Code
  → UserPromptSubmit(prompt, session_id, cwd)
  → 插件派生 kc-session-id 和 workspace peer
  → OpenViking context search(session_id=kc-session-id)
  → 首轮额外读取 profile
  → 插件 stdout 输出纯文本 <openviking-context>
  → Kimi Code 把内容追加到当前模型上下文

Agent 执行
Kimi Code
  → 模型回答与工具调用
  → 需要详细上下文时，经 stdio proxy 调用 OpenViking MCP
  → 持续写入 agents/main/wire.jsonl

回合收尾
Kimi Code
  → Stop / PreCompact / SessionEnd，或以 Interrupt 取代 Stop
  → 插件从 lastTurnId 后解析新 user/assistant turn
  → 删除注入块，过滤并去重
  → messages/batch（旧服务器退到 messages）
  → commit
  → 更新 capturedTurnIds / lastTurnId / pendingPrompt
```

这里的双向数据不对称：召回内容是一次性 prompt context，不应被写回记忆；用户和助手的真实 turn 才是捕获对象。`cleanKimicodeText()` 正是这两条方向之间的隔离点。

## 14. 文件边界

不把生成的 shared runtime 逐个重复展开时，最终实现可以按职责读成以下几组：

| 文件 | 职责 |
| --- | --- |
| `examples/kimicode-memory-plugin/kimi.plugin.json` | Kimi Code 原生插件清单，声明 Hook 和 MCP server |
| `scripts/kimicode-hook.mjs` | 事件分发、纯文本召回注入、捕获与 commit 编排 |
| `scripts/kimicode-turns.mjs` | 定位并解析 `wire.jsonl`，生成增量 user/assistant turns |
| `scripts/kimicode-capture.mjs` | 捕获筛选、去重 payload、确认集与连续游标推进 |
| `scripts/uri-guard.mjs` | 把 Kimi Code `PreToolUse` 输入/输出映射到共享 URI guard |
| `scripts/merge-config.mjs` | 幂等合并 `config.toml` 和 `mcp.json` |
| `servers/mcp-proxy.mjs` | 读取 Kimi 集成凭据与 peer，启动共享 stdio-to-HTTP MCP proxy |
| `scripts/shared/*.mjs` | 从 `memory-plugin-shared/lib` 生成的发布时共享运行时 |
| `examples/memory-plugin-shared/install.sh` | 识别、安装、诊断和卸载 Kimi Code 集成 |
| `examples/memory-plugin-shared/sync.mjs` | 声明 Kimi 插件需要的 shared capability 集并生成副本 |
| Marketplace 脚本与集成文档 | 把 Kimi 插件加入发布物和公开接入索引 |

## 15. 实现边界

这个 PR 提供的是“Kimi Code 与 OpenViking 之间的长期记忆闭环”，但它有清楚的边界：

- 插件不内嵌 OpenViking Server，仍需要可访问的 OpenViking 服务与正确凭据；
- 插件只捕获适合写入 Session 的用户/助手文本，不把完整 wire 事件、think 或所有工具载荷原样存档；
- `viking://` guard 是工具选路保护，不是操作系统沙箱或强安全边界；
- Hook 失败不会阻断 Kimi Code，因此“Agent 继续回答”不能反证“本轮已经成功召回或持久化”；
- 长期记忆的抽取、合并、检索和删除语义属于 OpenViking，Kimi 适配器只负责提供正确的宿主时机、身份和对话数据。

## 16. 最终结论

PR #4787 的核心价值不是多了一个“可以连 MCP”的示例，而是把 Kimi Code 的完整会话生命周期连成了一个自动记忆闭环：

```text
SessionStart 恢复待写数据
→ UserPromptSubmit 根据当前问题召回，并以纯文本注入
→ MCP 提供按需深入访问 OpenViking 的工具面
→ wire.jsonl 记录实际发生的回合
→ Stop / Compact / End / Interrupt 触发增量捕获
→ messages + commit 把新对话交给 OpenViking 处理
```

实现中最关键的不是某一个 API 调用，而是对宿主协议的准确映射：只在 `UserPromptSubmit` 输出可注入的纯文本；以 `wire.jsonl` 而不是 Hook 预览作为会话真相源；用 `turn.ended` 关闭无助手文本的 turn；在 `Interrupt` 替代 `Stop` 时仍然完成捕获；同时把通用的召回、凭据、peer、重试和 MCP 转发继续留在 shared runtime。

因此这个插件可以准确表述为：

> Kimi Code 仍然负责运行 Agent、管理会话和记录 wire 事件；Kimi 适配器在宿主的正确生命周期节点上转换事件、注入召回结果并增量捕获真实对话；OpenViking 则负责对这些上下文进行持久化、检索和长期记忆处理。
