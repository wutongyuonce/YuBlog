---
title: "memU PR #675：从 Pi Session 到记忆闭环"
description: "从整体架构、使用方式到 session 分类、增量状态、自循环隔离与跨平台调度，解析 memU Pi Host Adapter 的最终实现。"
pubDate: 2026-09-06
tags: [memU, Agent Memory, Pi, PR]
toc: true
search: true
draft: false
---

> 对应 PR：[feat(hosts): add pi coding agent adapter #675](https://github.com/NevaMind-AI/memU/pull/675)  
> 关联 Issue：[[FEATURE] add a dedicated pi coding agent adapter #674](https://github.com/NevaMind-AI/memU/issues/674)  

## 1. 这个 PR 实现了什么

PR #675 为 memU 增加了 Pi Coding Agent 专用命令：

```bash
memu-pi
```

接入后，memU 获得两项能力：

1. **Record**：定期读取 Pi 的 v3 JSONL session，把新增对话和工具轨迹整理成 memory、skill、resource，再提交到 memU；
2. **Retrieval**：把检索指令和 skill 安装到 Pi 的全局上下文目录，让新的 Pi session 能在回答前调用 `memu-pi retrieve`。

它没有新建一套 Pi 专属记忆系统，而是补上 Pi 的宿主差异，然后复用 memU 已有的增量读取、任务生成、记忆提交、检索、安装和调度能力。

最终改动涉及 16 个文件，新增 729 行、删除 13 行。核心代码集中在：

- `src/memu/hosts/pi/sessions.py`：解释 Pi session；
- `src/memu/hosts/pi/cli.py`：声明 Pi 如何接入共享 CLI；
- `src/memu/hosts/scheduling/windows.py`：让 Windows 计划任务通过稳定的 CLI 名称启动宿主。

## 2. 整体架构

Pi adapter 位于 Pi 与 memU 通用 bridging pipeline 之间：

```text
Pi Coding Agent
├─ 写入 ~/.pi/agent/sessions/<encoded-cwd>/*.jsonl
├─ 启动时读取 ~/.pi/agent/AGENTS.md
└─ 支持 pi -p <prompt> 无头运行
            │
            ▼
memu-pi Host Adapter
├─ PiTranscriptSource：发现、分类、清理 session 记录
└─ HostSpec：声明路径、命令、调度方式和 session 身份
            │
            ▼
memU 通用能力
├─ prepare：增量切片并生成 jobs
├─ self-evolve：由 Pi 执行 jobs，修改记忆文件
├─ commit：提交变化并推进 cursor
├─ retrieve：查询 local 或 Cloud backend
└─ instruction / skill / scheduler / uninstall
```

边界可以概括为：

```text
Pi adapter 负责把 Pi 的数据翻译成 memU 已知的输入
memU 通用层负责记忆怎样生成、保存和检索
```

因此，这个 PR 没有修改 `MemoryService`、embedding、数据库 repository、job 模板或 commit 语义，也没有复制 `bridging/` 下的通用流水线。

## 3. 用户实际怎样使用

主要入口如下：

```bash
memu-pi doctor                         # 检查 backend 和 retrieval
memu-pi prepare                        # 从新 session 生成 jobs
memu-pi commit                         # 提交 Pi 处理后的记忆变化
memu-pi retrieve "之前做过什么决定？"  # 手工检索
memu-pi install-instruction            # 安装 retrieval 指令与 skill
memu-pi docs install                   # 查看完整安装指南
memu-pi docs task                      # 查看调度指南
memu-pi docs uninstall                 # 查看卸载指南
```

正常情况下，用户不需要反复手工执行 `prepare` 和 `commit`。安装流程会注册定时任务，由操作系统启动 Pi，让 Pi 自己完成 bridging pipeline。

## 4. Record：一条 session 怎样变成记忆

完整调用链如下：

```text
Pi 写入原始 JSONL
        ↓
PiTranscriptSource.discover()
        ↓
read_incremental() 根据正式 cursor 找出新增行
        ↓
classify() 分成 MESSAGE / TOOL / OTHER
        ↓
sanitize() 清理保留记录中的运行元数据
        ↓
prepare_transcripts()
├─ <n>.jsonl：conversation track
└─ <n>_full.jsonl：full track
        ↓
每个 session 生成 memory job + skill job
全部 session 再生成一个 resource job
        ↓
Pi 按顺序执行 jobs，修改本地 Markdown 记忆文件
        ↓
memu-pi commit
        ↓
local MemoryService 或 Cloud backend
```

对于 `n` 个新 session，`prepare` 会生成 `2n + 1` 个 jobs：每个 session 各有一个 memory job 和 skill job，最后再生成一个 resource job。

memory job 关注用户说了什么、形成了哪些长期事实；skill job 还需要工具调用，因此两者不能共用完全相同的 transcript。

## 5. `PiTranscriptSource`：理解 Pi session

### 5.1 session 目录与发现方式

Pi v3 默认把 session 写到：

```text
~/.pi/agent/sessions/<encoded-cwd>/*.jsonl
```

适配器固定声明：

```python
AGENT_DIR = "~/.pi/agent"
SESSION_DIR = "~/.pi/agent/sessions"
```

`PiTranscriptSource` 只提供根目录，文件发现复用 `TranscriptSource.discover()`：递归寻找 `.jsonl`，再按修改时间从新到旧排序。因此它能扫描多个 encoded working directory。

最终实现有一个明确限制：**定时 bridging 只支持默认 session 目录**。适配器不会读取 `PI_CODING_AGENT_DIR` 或 `PI_CODING_AGENT_SESSION_DIR` 改变默认源，否则安装时与 cron/S4U 运行时可能看到不同路径，使 cursor 跟踪两个数据源。

`prepare --session-dir <path>` 仍可显式读取其他目录，但调度流程不会把该路径固化进任务。完整支持自定义目录需要额外定义持久配置和数据源迁移，不属于本 PR。

### 5.2 为什么不能只看 role

Pi session 中除了 user / assistant message，还有 session header、compaction、模型切换、`toolResult`、`bashExecution`，以及 assistant 的 `text`、`thinking`、`toolCall` content block。

难点在于纯工具调用在外层仍是 assistant message：

```json
{"type":"message","message":{"role":"assistant","content":[{"type":"thinking","thinking":"..."},{"type":"toolCall","name":"read"}]}}
```

如果只判断 `role == "assistant"`，这条记录会被误放进纯对话 transcript。最终实现同时检查 role 和 content block。

### 5.3 最终分类规则

| 输入 | `RecordKind` | conversation | full |
| --- | --- | --- | --- |
| user/assistant，`content` 是字符串 | `MESSAGE` | 写入 | 写入 |
| user/assistant，content block 含 `text` | `MESSAGE` | 写入 | 写入 |
| assistant，无 text，但含 `toolCall` | `TOOL` | 不写 | 写入 |
| `toolResult`、`bashExecution` | `TOOL` | 不写 | 写入 |
| session、compaction、thinking-only | `OTHER` | 不写 | 不写 |
| malformed JSON、未知 role/type | `OTHER` | 不写 | 不写 |

关键判断顺序是：

```python
if "text" in block_types:
    return RecordKind.MESSAGE
if "toolCall" in block_types:
    return RecordKind.TOOL
```

`text` 必须优先。助手一边解释一边调用工具时，这条记录仍包含用户可见回答，应该进入两条轨道；只有纯工具调用才只进入 full。

### 5.4 双轨 transcript

`RecordKind` 直接决定下游输入：

```text
MESSAGE → conversation + full
TOOL    → full
OTHER   → 丢弃
```

同一个 session 最终产生：

```text
1.jsonl       # 用户与助手的可见对话
1_full.jsonl  # 可见对话 + 工具调用与结果
```

这样 memory job 不会被大量执行细节干扰，skill job 又能看到任务具体怎样完成。

## 6. prepared transcript 怎样清理运行字段

原始 Pi session 包含恢复运行和 provider 调用所需的信息。这些字段对 Pi 有用，但不是记忆整理的必要输入。

`sanitize()` 删除以下已知运行字段：

| 层级 | 删除字段 |
| --- | --- |
| record | `id`、`parentId`、`timestamp` |
| message | `api`、`provider`、`model`、`usage`、`stopReason`、`rawStopReason`、`responseId`、`timestamp`、`errorMessage` |
| tool-result message | `details` |
| content block | `thinkingSignature` |

这段实现有三个关键性质。

第一，**只修改 prepared 输出，不修改 Pi 原始文件**。`sanitize()` 操作的是 `json.loads()` 产生的新对象。

第二，**先分类，再清理**：

```text
original → classify(original) → sanitize(original) → prepared transcript
```

分类仍能看到完整的 provider-native 结构。

第三，采用 delete-only，而不是重建字段白名单。用户文本、thinking 正文、tool name、arguments、call ID、错误状态以及未来新增的未知字段都会保留；只有明确属于运行元数据的字段被删除。

增量状态仍根据原始记录计算：

```text
原始行数       → cursor.lines
原始 timestamp → cursor.last_timestamp
清理后的记录   → prepared JSONL
```

所以 prepared 文件中即使删掉 timestamp，也不会影响下一次从哪里继续读取。

## 7. 怎样避免 memU 记忆自己的后台任务

每次定时 bridging 都会创建新的 Pi session，内容正是读取 jobs、执行 `prepare`、修改记忆和执行 `commit`。如果下一轮把它当作用户会话，memU 会反复整理自己的整理过程。

最终实现使用两个身份信号：

```text
MEMU_BRIDGING_RUN=1  → 当前 Pi 由调度任务启动
PI_SESSION_ID        → Pi 导出的当前 session UUID
```

只有处于 bridging run 时，`_cmd_prepare()` 才会在扫描前把当前 UUID 写入 self-session 列表。用户在普通对话中手工运行 `memu-pi prepare`，不会把当前对话永久排除。

Pi 文件名还带时间戳前缀：

```text
2026-09-02T10-31-41-043Z_01a061ac-aaf3-7f05-a295-d95115fef655.jsonl
```

而 `PI_SESSION_ID` 只有 UUID，因此 Pi 覆盖基类的 `session_id()`：

```python
def session_id(self, path: Path) -> str:
    return path.stem.rsplit("_", 1)[-1]
```

文件侧身份与环境变量侧身份由此统一，当前和历史 bridging session 都会在后续扫描中跳过。

## 8. `HostSpec`：用声明接入共享 CLI

`src/memu/hosts/pi/cli.py` 没有重新实现各个命令，只声明 Pi 的宿主事实：

```python
SPEC = HostSpec(
    host="pi",
    display="pi",
    package="memu.hosts.pi",
    task_name="memu-bridging-pi",
    source_factory=PiTranscriptSource,
    session_dir="~/.pi/agent/sessions",
    instruction_path="~/.pi/agent/AGENTS.md",
    skills_dir="~/.pi/agent/skills",
    schedule_backend="os",
    schedule_command="pi -p {prompt}",
    session_id_env="PI_SESSION_ID",
)
```

入口只有：

```python
def main(argv=None) -> int:
    return run(SPEC, argv)
```

共享 `host_cli.run()` 据此注册 `init`、`doctor`、`prepare`、`commit`、`retrieve`、instruction、docs、schedule 和 report 等命令。

这体现了整个 PR 的核心设计：

```text
TranscriptSource 描述数据格式
HostSpec 描述宿主运行环境
共享 CLI 和 pipeline 提供完整能力
```

`pyproject.toml` 将入口注册为：

```toml
memu-pi = "memu.hosts.pi.cli:main"
```

generic detector 也加入 `.pi → memu-pi` 映射，检测到 Pi 工作目录时会引导用户使用专用 classifier，而不是通用 JSONL 猜测逻辑。

## 9. 定时 bridging 怎样运行

### 9.1 所有平台执行同一条业务流程

无论操作系统怎样唤醒 Pi，进入 Pi 后都按顺序执行：

```text
1. 处理上次崩溃遗留的 jobs，并 commit
2. memu-pi prepare
3. 按数字顺序执行本轮 jobs
4. memu-pi commit
```

先处理 leftovers，是为了避免新一轮 `prepare` 覆盖未完成任务。只有 commit 成功后，正式 cursor 和记忆快照才推进。

### 9.2 macOS / Linux

长 prompt 保存在 `~/.memu/hosts/pi/bridge-prompt.txt`，cron 只启动短 wrapper：

```sh
#!/bin/sh
DIR="$HOME/.memu/hosts/pi"
LOCK="$DIR/.bridge.lock"
# 获取目录锁，必要时清理超过 180 分钟的 stale lock
export MEMU_BRIDGING_RUN=1
pi -p "$(cat "$DIR/bridge-prompt.txt")" >> "$DIR/bridge.log" 2>&1
```

wrapper 用目录锁避免两个周期重叠，退出时清理锁，并把输出追加到 `bridge.log`。默认 cron 每小时整点执行；只有用户明确要求时才使用 launchd。

### 9.3 Windows

Windows 使用共享 Task Scheduler backend：

```powershell
memu-pi schedule install
memu-pi schedule verify
memu-pi schedule status
```

它把 prompt 和 PowerShell wrapper 写入磁盘，再注册 `\memU\memu-bridging-pi` S4U 任务。任务无须保存用户密码，可在用户未登录时运行，并用 `IgnoreNew` 避免重叠实例。

安装前，scheduler 用 `shutil.which("pi")` 确认 PATH 能解析 Pi，并把 `pi` 与 `memu-pi` 所在目录写入 wrapper 的 PATH。任务执行时调用裸命令：

```powershell
& 'pi' -p $prompt
```

它不会把安装机器上的 `pi.CMD`、`pi.ps1` 或其他 launcher 绝对路径固化进任务。`HostSpec` 的稳定契约只是命令名 `pi`，安装方式不由 memU 决定。

Pi 没有启用 scheduler 的额外 headless-auth probe，因为交互式 Pi 与 `pi -p` 使用同一份 `~/.pi/agent/auth.json`。因此 `schedule verify` 对 Pi 只检查任务注册和命令解析，不会触发真实 S4U 运行。

端到端验证仍需让操作系统真实唤醒一次，并检查：

- 是否产生新的 Pi session；
- `bridge.log` 是否增长；
- jobs 或 session manifest 是否推进；
- wrapper 锁是否正常清理。

## 10. Retrieval：让 Pi 主动查记忆

Retrieval 链路如下：

```text
Pi 启动新 session
        ↓
读取 ~/.pi/agent/AGENTS.md
        ↓
managed block 指向 ~/.pi/agent/skills/memu-retrieve/SKILL.md
        ↓
Pi 执行 memu-pi retrieve <query>
        ↓
共享 retrieval 实现
        ↓
local MemoryService 或 CloudMemoryClient
```

PR 没有实现新检索算法。`HostSpec` 只告诉共享安装器 instruction 和 skills 应放在哪里。

```bash
memu-pi install-instruction
```

该命令保留 `AGENTS.md` 既有内容，只维护一段带边界标记的 managed block，并创建 `skills/memu-retrieve/SKILL.md`；重复执行是幂等的。

如果 `~/.pi/agent/AGENTS.override.md` 已存在，因为它优先于 `AGENTS.md`，安装时应显式指定：

```bash
memu-pi install-instruction \
  --path ~/.pi/agent/AGENTS.override.md \
  --skills-dir ~/.pi/agent/skills
```

## 11. 状态与失败恢复

这套实现的可靠性依赖磁盘状态何时推进，而不是 Agent 最后一段自我汇报。

### prepare 阶段

```text
正式 cursor
    ↓ 读取新行
pending cursor + prepared transcripts + jobs
```

`prepare` 只写 pending cursor，不提前确认消费成功。

### self-evolve 阶段

Pi 读取 job 指令，修改 memory、skill、resource 文件。一个 job 没有产生文件也是合法结果，Agent 不应为了“完成任务”而编造记忆。

### commit 阶段

```text
比较上次成功快照与当前文件
        ↓
提交变化到 backend
        ↓ 成功后
推进正式 cursor + 更新记忆快照 + 清理本轮状态
```

如果 Pi、网络或 backend 在 commit 前失败，正式 cursor 不会推进。下一轮会先处理遗留 jobs，最多重复一小段工作，不会把尚未持久化的 session 静默跳过。

## 12. 最终文件分工

| 文件 | 职责 |
| --- | --- |
| `src/memu/hosts/pi/sessions.py` | 默认路径、记录分类、输出清理、session ID 归一化 |
| `src/memu/hosts/pi/cli.py` | 声明 Pi `HostSpec`，接入共享 CLI |
| `src/memu/hosts/pi/__init__.py` | 导出 `PiTranscriptSource` |
| `src/memu/hosts/pi/INSTALL.md` | backend、record bridge、retrieval 安装 |
| `src/memu/hosts/pi/BRIDGING_TASK.md` | cron、launchd 和 Task Scheduler 操作 |
| `src/memu/hosts/pi/UNINSTALL.md` | 只清理 Pi adapter 拥有的状态 |
| `src/memu/hosts/scheduling/windows.py` | 生成 wrapper，注册和验证 S4U 任务 |
| `pyproject.toml` | 注册 `memu-pi` console script |
| `src/memu/hosts/generic/detect.py` | 将 `.pi` 路由到专用 adapter |
| `tests/test_host_sessions.py` | 分类、发现、清理、cursor 和默认目录回归 |
| `tests/test_bridging_self_sessions.py` | 当前及历史 bridging session 的跳过行为 |
| `tests/test_scheduling_windows.py` | PATH、裸命令、任务注册、验证和卸载边界 |

## 13. 实现边界

这个 PR 支持的是“把 Pi 接入 memU”，不是完整重放 Pi session：

- 不根据 `id/parentId` 重建活动分支，而是按 JSONL 物理行和 cursor 增量读取；
- session header、compaction、thinking-only 和分支控制记录不会进入 prepared transcript；
- 定时 bridging 固定扫描 `~/.pi/agent/sessions`，不支持自定义 session 根目录；
- `schedule verify` 只验证静态前置条件，不等于真实 OS wake-up；
- Windows 修改位于共享 scheduler，没有为 Pi 复制专属调度实现；
- 卸载默认保留共享 backend 配置、memory store 和已提交 cursor，只删除 Pi 的调度、instruction、skill 与宿主工作文件。

## 14. 总结

PR #675 的本质不是增加新记忆后端，而是补齐 Pi 与 memU 之间的两个接口：

```text
Record：Pi JSONL → TranscriptSource → prepare/self-evolve/commit
Retrieval：Pi 全局指令 → memu-retrieve skill → shared backend
```

真正属于 Pi 的逻辑只有四类：

1. session 在哪里；
2. 哪些记录是对话、工具或噪声；
3. 哪些运行字段不应进入 prepared transcript；
4. Pi 的目录、启动命令和 session 身份怎样映射到共享 `HostSpec`。

其余能力全部复用 memU 现有实现。这使 Pi adapter 保持很薄，同时覆盖增量处理、失败恢复、自循环隔离、跨平台调度和检索安装这一整条记忆闭环。
