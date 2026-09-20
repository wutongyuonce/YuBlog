---
title: "Deer Workflow PR #7：Pi Coding Agent 统一 Harness 实现报告"
description: "拆解 Deer Workflow PR #7 如何通过 subprocess Harness 接入 Pi Coding Agent，并保持统一的 Agent 调用与结构化输出契约。"
pubDate: 2026-09-06
category: 技术向
tags: [Workflow, Pi, Multi-Agent, PR]
toc: true
search: true
---

> 对应 PR：[feat: support Pi Coding Agent 0.84.1 #7](https://github.com/deerwork-ai/deer-workflow/pull/7)  
> 关联 Issue：[feat: 支持 Pi Coding Agent 0.84.1 #6](https://github.com/deerwork-ai/deer-workflow/issues/6)  
> 阅读前提：本文只解释 PR #7 怎样把 Pi 接入 Deer Workflow 已有的 Agent seam，不重复展开 Workflow、Flow、Runner 和 TUI 的通用实现。

## 1. 本质总结

PR #7 没有把 Pi SDK 嵌入 Deer Workflow，也没有使用 Pi RPC。它新增了一个 `PiAgent` CLI Harness，把统一的：

```ts
run<TOutput = string>(
  prompt: string,
  options?: AgentOptions,
): Promise<TOutput>
```

翻译成 Pi 0.84.1 能执行的两种非交互协议：

```text
无 Schema
agent(prompt, options)
→ PiAgent.run()
→ pi --print --no-session
→ Prompt 通过 stdin 输入
→ stdout 最终文本
→ string

有 Schema
agent<T>(prompt, { schema })
→ PiAgent.run<T>()
→ 临时生成 structured-output Extension
→ pi --mode json --extension <临时文件> --no-session
→ Pi 完整执行 Agent Loop
→ 模型调用 deer_workflow_final_response
→ Pi 按调用方 Schema 校验工具参数
→ tool_execution_end.result.details
→ TOutput
```

真正困难的不是启动 `pi`，而是 Pi 0.84.1 没有 Codex `--output-schema` 或 Claude Code `--json-schema` 那样的终态 Schema 参数。PR 因此把调用方 JSON Schema 转换成一个只存在于本次运行的 terminating tool，再从 Pi JSON Event Stream 中提取经过工具参数校验的 `details`。

最终得到的是协议适配，不是公共接口扩张：Workflow 仍只认识 `Agent`、`AgentOptions` 和 `agent()`；Pi 的命令参数、事件格式、Extension 和工具策略都封装在 `src/agents/pi-agent.ts` 内。

## 2. PR 的结果与边界

PR 从 `main` 的 `4cf5f2f` 开始，最终 head 为 `5a5f22e`，于 2026-08-09 合并。净改动为 19 个文件、1195 行新增、49 行删除。

核心代码集中在：

| 文件 | 职责 |
| --- | --- |
| `src/agents/pi-agent.ts` | Pi 进程、文本/JSONL 双协议、终态工具、权限策略、取消、错误和清理 |
| `src/agents/types.ts` | 增加 `PiAgentConfig`、解析后配置和错误详情类型 |
| `src/agents/index.ts` | 公开导出 `PiAgent`、`PiAgentError`、`PiCliNotFoundError` |
| `src/cli/agent-selection.ts` | 把 `pi` 加入 `create --agent` 解析与显示名称 |
| `src/cli/create.ts` | 选择 Pi 生成器，并复用同一 Workflow Creator Prompt、Schema 和只读策略 |
| `src/cli.ts` | 顶层帮助与 Pi 错误输出 |
| `tests/agents/pi-agent.test.ts` | Pi Harness 的进程边界测试 |
| `tests/cli/create.test.ts` | 完整 CLI 子进程中的 Pi 选择与生成契约 |

其余改动是双语文档、Skill API reference、安装说明和关键词。

以下内容没有改变：

- `Agent` 接口没有增加 Pi 专属字段；
- `bindAgent()` 仍只把函数调用转发给 `runtime.run()`；
- 导出的 `agent()` 仍绑定共享 `CodexAgent`，默认 Runtime 没有变；
- Workflow 的控制流、事件、Runner、TUI 和最终返回值协议没有变；
- 没有引入 `@earendil-works/pi-coding-agent` 生产依赖；
- 没有接入 `--mode rpc`、会话恢复、steering、follow-up queue 或 Pi 登录 UI；
- 没有实现操作系统级 Sandbox。

这个 seam 很窄：Pi 只负责把同一个 Agent 调用契约翻译成自己的 CLI 协议。

## 3. 修改前为什么不能只“加一个 pi 命令”

Deer Workflow 原有三个关键承诺：

1. `agent()` 表示完整的工具型 Agent Loop，不是一次普通模型 completion；
2. 无 Schema 返回文本，有 Schema 返回已经受约束并解析的对象；
3. 调用者使用同一组 cwd、model、sandbox、env、signal 选项，不感知底层供应商。

Codex 和 Claude Code 都有相对直接的结构化输出入口：

| Harness | 非交互入口 | Schema 入口 | 最终值来源 |
| --- | --- | --- | --- |
| Codex | `codex exec` | `--output-schema <file>` | `--output-last-message <file>` |
| Claude Code | `claude --print --output-format json` | `--json-schema <json>` | `structured_output` |
| Pi | `pi --print` / `pi --mode json` | 没有对应终态参数 | 必须另建终态桥接 |

如果 Pi 只执行：

```text
请严格返回 JSON，不要解释
```

然后对 assistant 文本做 `JSON.parse()`，只能证明文本语法像 JSON，不能证明它经过调用方 Schema 校验；模型还可能添加 Markdown fence、解释文字或缺少必填字段。这会破坏统一 `Agent` 契约。

因此 PR 需要同时解决四个适配问题：执行协议、终态 Schema、权限语义和进程生命周期，而不只是 CLI 选择。

## 4. 统一 `Agent` seam 怎样保持不变

公共类型仍定义为：

```ts
export interface Agent {
  run<TOutput = string>(
    prompt: string,
    options?: AgentOptions,
  ): Promise<TOutput>;
}
```

`AgentOptions` 继续只包含通用概念：

```ts
interface AgentOptions {
  cwd?: string;
  model?: string;
  schema?: JsonSchema;
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  additionalWritableDirectories?: string[];
  env?: Record<string, string | undefined>;
  signal?: AbortSignal;
}
```

`bindAgent()` 没有 Pi 分支：

```ts
export function bindAgent(runtime: Agent): AgentFunction {
  return (prompt, options) => runtime.run(prompt, options);
}
```

因此真正的调用边界是：

```text
Workflow
→ agent(prompt, options)
→ bindAgent(selected runtime)
→ runtime.run(prompt, options)
→ 各 Harness 自己保证相同终态语义
```

TypeScript 的 `TOutput` 只表达调用方预期类型，不提供运行时校验。运行时约束必须由具体 Harness 完成；Pi 的实现位置正是在这里。

## 5. 文本协议：`pi --print`

当调用没有 Schema，且不是需要临时路径策略的 `workspace-write` 时，`PiAgent.run()` 直接进入最快路径：

```ts
const result = await this.#runProcess(prompt, options, ["--print"]);
return result.stdout.trimEnd() as TOutput;
```

最终命令大致为：

```text
pi [commandArgs] [extraArgs] --print --no-session [--model <model>]
```

Prompt 不拼进 shell 字符串，而是通过 stdin 写入：

```ts
subprocess.stdin.write(prompt);
subprocess.stdin.end();
```

这同时避免 shell quoting、命令注入和长 Prompt 命令行限制。`Bun.spawn()` 接收参数数组，也没有中间 shell。

默认 `ephemeral: true` 会追加 `--no-session`。调用者显式设置 `ephemeral: false` 时才允许 Pi 持久化 session。

文本模式只把最终 stdout 返回给调用方，不把 Pi 内部事件转换成 Deer Workflow Event。Workflow 的阶段、日志和生命周期事件仍由 Deer 的 Runner 负责。

## 6. 结构化协议：Schema 怎样变成 terminating tool

### 6.1 每次运行创建独立 Extension

收到 `options.schema` 后，`PiAgent` 创建唯一临时目录，并写入 `structured-output.ts`：

```text
<tmp>/deer-workflow-pi-XXXXXX/
└── structured-output.ts
```

生成内容的核心是：

```ts
const parameters = <调用方 JSON Schema>;

export default function registerStructuredOutput(pi) {
  pi.registerTool({
    name: "deer_workflow_final_response",
    parameters,
    async execute(_toolCallId, params) {
      return {
        content: [{ type: "text", text: "Structured response accepted." }],
        details: params,
        terminate: true,
      };
    },
  });
}
```

Deer Workflow 主进程没有 import Pi SDK。它只生成 Extension 源码；真正加载 Extension、提供 `pi.registerTool()` 并校验工具参数的是外部 Pi CLI 进程。因此 package.json 只增加 `pi` 关键词，没有增加 Pi 运行时依赖。

### 6.2 为什么 `details` 是终态值

工具的参数就是模型提交的结构化结果。参数先经过 Pi 的工具 Schema 验证，成功后才进入 `execute()`；实现再把同一个 `params` 放入 `result.details`：

```text
模型构造 tool arguments
→ Pi 按 parameters Schema 校验
→ execute(params)
→ result.details = params
→ JSONL tool_execution_end
```

所以 Deer 接收的不是“模型声称自己输出了合法 JSON”，而是“Pi 已接受并执行的工具参数”。

### 6.3 为什么必须 `terminate: true`

普通工具调用结束后，Agent Loop 通常还会把工具结果交回模型，进入下一轮 assistant response。终态工具如果也这样运行，会多一次无意义模型调用，而且后续文本可能模糊哪个结果才是最终答案。

`terminate: true` 告诉 Pi：当前工具批次完成后结束 Agent Loop，不再要求模型补一轮自然语言总结。它同时减少一次模型请求，并固定终态边界。

### 6.4 为什么使用 `--mode json`，而不是 RPC

Schema 调用使用：

```text
pi --mode json --extension <structured-output.ts>
```

`--mode json` 是单次非交互运行的 JSON Lines Event Stream。它不是 `--mode rpc`：

```text
{"type":"agent_start"}
{"type":"tool_execution_end", ...}
{"type":"agent_end", ...}
```

Deer 等待进程结束后逐行 `JSON.parse()`，寻找：

```ts
event.type === "tool_execution_end" &&
event.toolName === "deer_workflow_final_response" &&
event.isError === false &&
event.result?.details !== undefined
```

命中后返回 `event.result.details`。任意非空行不是合法 JSON，或者整个流没有成功终态工具事件，都会抛出 `PiAgentError`。普通 assistant 文本即使长得像 JSON，也不会被接受。

## 7. Sandbox 适配的真实含义

Pi 0.84.1 没有与 Codex 等价的操作系统 Sandbox。PR 没有掩盖这个差异，而是把 Deer 的通用策略映射成“Pi 可用工具集合”：

| `AgentOptions.sandbox` | Pi 参数与工具 | 实际边界 |
| --- | --- | --- |
| `read-only` | `--no-extensions --no-approve --tools read,grep,find,ls` | 不开放内置修改工具和 bash |
| `workspace-write` | 再加入 `edit,write`，加载路径策略 Extension | 只允许受检查路径的 edit/write，仍不开放 bash |
| `danger-full-access` | 不追加受限工具参数 | 使用 Pi 进程本身的宿主权限 |
| 未设置 | 不追加受限工具参数 | 保留 Pi 默认宿主行为 |

Schema 模式会在工具白名单中额外加入 `deer_workflow_final_response`。

`--no-extensions` 禁止自动发现的第三方或项目 Extension 绕过当前工具策略；本次运行需要的 Extension 仍通过显式 `--extension` 加载。`--no-approve` 则避免无人值守运行依赖交互批准。

### 7.1 为什么 `workspace-write` 禁用 bash

路径守卫只能拦截 Pi 的 `edit` 和 `write` 工具调用。只要开放任意 shell，模型就可以通过 `cp`、重定向或脚本写到授权目录外，Harness 无法再声称写入范围受控。

所以该模式选择：

```text
read / grep / find / ls / edit / write
```

而不是开放 bash 后再假装有可靠 Sandbox。需要真正命令隔离时，边界必须放在容器、虚拟机或其他 OS 隔离层。

### 7.2 路径策略怎样阻止逃逸

`workspace-write` 会生成第二个临时 Extension，监听 Pi 扩展独有的 `tool_call` 事件，只检查 `write` 和 `edit`：

```text
tool_call(write/edit)
→ 取得 input.path
→ 相对路径按 cwd resolve
→ 对已存在目标执行 realpath
→ 新文件向上寻找最近存在祖先，再拼回缺失片段
→ 同样 canonicalize 每个 writable root
→ node:path.relative(root, target) 判断包含关系
→ 越界则 block
```

向上寻找已存在祖先很关键：新文件本身还不存在，不能直接 `realpath(newFile)`。先解析真实祖先再拼回文件名，既支持创建新文件，也能识别授权目录内指向外部的符号链接。

允许根目录为：

```text
resolve(cwd)
+ additionalWritableDirectories.map(resolve)
```

测试覆盖授权根内写入、绝对外部路径和 symlink escape。没有开放 bash，因此这套策略只需要守住两个写工具的共同入口。

## 8. 进程生命周期与失败契约

`PiAgent.run()` 按以下顺序处理边界：

```text
校验非空 Prompt
→ 拒绝能覆盖协议/权限的 extraArgs
→ 检查已 abort 的 signal
→ Bun.which() 检查 CLI
→ 必要时创建临时目录和 Extension
→ Bun.spawn()
→ stdin 写 Prompt
→ 并行读取 stdout、stderr 并等待 exited
→ 检查 abort / exit code / JSONL 终态
→ finally 删除监听器和临时目录
```

这个顺序避免在 Prompt、取消状态或 CLI 已知无效时先创建临时资源。

### 8.1 配置优先级

model、cwd、sandbox 和 env 遵循：

```text
进程环境 < PiAgent 构造配置 < 本次 run options
```

env 中的 `undefined` 表示删除前一层变量，而不是字符串化为 `"undefined"`。每次 spawn 使用合并后的独立环境对象。

### 8.2 取消

已经 abort 的 signal 通过 `throwIfAborted()` 在进程启动前失败。运行中 abort 时，监听器调用 `subprocess.kill()`；实现仍等待 stdout、stderr 和退出状态收敛，然后抛出原始 `signal.reason`，最后移除监听器和临时目录。

### 8.3 错误

找不到命令时抛出 `PiCliNotFoundError`，包含固定 0.84.1 安装、认证和版本检查。进程非零退出、JSONL 非法或缺少结构化终态时抛出 `PiAgentError`，保留：

```ts
exitCode
stdout
stderr
```

顶层 CLI 对 Codex、Claude 和 Pi 的 AgentError 走同一诊断路径：错误摘要和底层 stderr 写到 stderr，stdout 继续留给生成源码或 Workflow 结果。

### 8.4 为什么限制 `extraArgs`

如果调用者可以在 `extraArgs` 中加入 `--tools bash`、`--extension`、`--mode` 或 `--resume`，就能覆盖 Harness 已承诺的权限、终态和临时会话语义。

因此实现拒绝输出模式、session、extension、approval 和 tool-control 等保留参数。model 等不改变协议安全边界的参数仍可使用。

## 9. `create --agent pi` 的完整调用链

CLI 解析同时接受：

```bash
deer-workflow create --agent pi "..."
deer-workflow create --agent=pi "..."
```

缺省值仍是 `codex`；重复 `--agent`、缺失值和未知值都会报 usage error。

运行链路为：

```text
src/cli.ts
→ runCreateCommand(values)
→ parseAgentSelection()
→ new PiAgent()
→ 读取参数或 stdin 中的用户请求
→ buildWorkflowCreatorPrompt()
   ├─ 指向包内 workflow-creator/SKILL.md
   └─ 追加用户请求
→ selectedAgent<CreatedWorkflow>(..., {
     cwd: process.cwd(),
     sandbox: "read-only",
     schema: workflowCreatorOutputSchema,
   })
→ Pi structured-output Extension
→ { source, exampleArgsJson }
→ 去除整层 Markdown source fence
→ stdout 输出 TypeScript 源码
```

`workflowCreatorOutputSchema` 与 Codex、Claude 共用：

```ts
{
  type: "object",
  properties: {
    source: { type: "string", minLength: 1 },
    exampleArgsJson: { type: "string", minLength: 2 },
  },
  required: ["source", "exampleArgsJson"],
  additionalProperties: false,
}
```

因此“Pi 支持”没有产生第二套 Workflow 生成格式。不同 Harness 最终都必须交回同一个 `CreatedWorkflow`。

生成开始前，stdout 先写入：

```ts
/* Generating a DeerFlow Dynamic Workflow with Pi */
```

这样 `> workflow.ts` 后目标文件会立即非空，而且内容始终是合法源码注释。进度和错误走 stderr，最终 `source` 才追加到 stdout。

## 10. Skill 兼容没有复制第二份目录

`deer-workflow skill install` 原本会安装到已存在的：

```text
~/.agents/skills
~/.claude/skills
```

Pi 0.84.1 已能发现共享的 `~/.agents/skills`，因此 PR 只补充 CLI help 和双语文档，没有新增 `~/.pi/...` 复制逻辑。

这保持了单一 Skill 副本：Deer Workflow 更新 `workflow-creator` 时，不需要同步维护一份 Pi 专属安装目录。

## 11. 两个提交分别做了什么

| Commit | 内容 |
| --- | --- |
| [`f7abe89`](https://github.com/deerwork-ai/deer-workflow/commit/f7abe898ebcb51eb00b20de6506b34120871d4d8) | 增加 Pi Harness、CLI 选择、文档和测试；1227 行新增、49 行删除 |
| [`5a5f22e`](https://github.com/deerwork-ai/deer-workflow/commit/5a5f22ede505e62d628babdef42391784392033e) | 删除 32 行真实 Pi 集成测试，使默认测试完全 hermetic |

第二个提交删除的是受 `DEER_WORKFLOW_PI_INTEGRATION=1` 控制的真实 Pi 0.84.1 Schema 调用。最终仓库不会因为环境误设、凭据或真实模型服务而访问外部系统。

PR 描述仍记录了一次人工 smoke test：真实 Pi 0.84.1 成功调用终态工具并提取 `{ "ok": true }`。这属于作者声明的手工证据，不是当前测试文件中可重复运行的集成测试。

## 12. 回归测试证明了什么

最终 `tests/agents/pi-agent.test.ts` 使用 Bun 脚本冒充 `pi` 可执行文件，从公开 `PiAgent.run()` seam 验证可观察行为，而不是测试私有 command builder。

Pi Harness 测试覆盖：

- `--print` 文本结果和默认 `--no-session`；
- JSON Schema 被写进临时 Extension；
- 成功 `tool_execution_end.details` 返回对象；
- 缺少终态工具、非法 JSONL 和非零退出；
- 缺失 CLI 的安装诊断；
- read-only 工具白名单；
- workspace-write 的授权根、外部路径和 symlink escape；
- active abort 和原始 abort reason；
- 保留参数不能被 `extraArgs` 覆盖；
- constructor/per-run model、cwd、env 和 ephemeral 优先级；
- 空 Prompt 和 already-aborted signal 在 command lookup 前失败。

CLI 测试把 `codex`、`claude` 和 `pi` stub 放到 PATH，再启动真实 `src/cli.ts`，证明：

- `--agent=pi` 能进入 Pi Harness；
- create 使用 JSON 模式、显式 Extension 和 read-only 工具；
- stdout 首行正确显示 Pi；
- 同一 Workflow Creator Prompt 与终态 Schema 被复用；
- 顶层和 create help 同时列出 `codex|claude|pi`；
- Codex 仍是默认值；
- 被移除的通用 `deer-workflow agent` 命令没有被重新引入。

## 13. 当前设计的明确限制

第一，`read-only` 和 `workspace-write` 是 Harness 工具策略，不是 OS Sandbox。Pi 进程、模型 provider、显式 Extension 或未来新增能力仍需要版本兼容审查；高风险执行应放入外部隔离环境。

第二，结构化结果只接受第一个成功匹配的终态工具事件，但适配器在进程结束后一次性读取完整 stdout，再逐行解析。它没有把 Pi 的中间进度实时映射到 Deer Workflow Event，也没有实现长 JSONL 流的增量消费。

第三，Schema 的真实运行时校验由 Pi 的工具系统承担。Deer Workflow 返回 `details as TOutput`，不会在主进程再次使用独立 JSON Schema validator 校验。若 Pi 的工具参数验证契约变化，需要同步更新 Harness 和兼容测试。

第四，PR 固定目标版本为 Pi 0.84.1。命令参数、JSONL 事件形状、Extension API 或 `terminate` 语义升级后都需要重新核对，不能把当前实现直接描述成对未来版本永久兼容。

第五，最终仓库没有真实 Pi 集成测试。stub tests 能证明 Deer 的参数构造、解析和清理逻辑，但不能自动证明某个新 Pi 版本仍接受这些参数和事件契约。

## 14. 最终结论

PR #7 的核心不是“支持第三个 CLI”，而是保持一个统一终态契约：

```text
调用方只提供 prompt + AgentOptions
Harness 负责执行完整 Agent Loop
无 Schema 必须返回最终文本
有 Schema 必须返回受运行时约束的结构化值
失败、取消、权限和资源清理必须具有一致语义
```

Pi 与 Codex、Claude Code 的差异被压在 `PiAgent` 内：

```text
Codex：原生 output schema + last-message file
Claude：原生 json schema + structured_output
Pi：临时 terminating tool + JSON Event Stream
```

因此最准确的表述是：

> Deer Workflow 通过 subprocess Harness 接入 Pi 0.84.1。普通调用把 Prompt 经 stdin 交给 `pi --print` 并返回 stdout；Schema 调用把通用 JSON Schema 编译成一次性 `deer_workflow_final_response` 工具，通过 `pi --mode json` 运行完整 Agent Loop，只接受成功 `tool_execution_end.result.details` 作为终态。它没有引入 Pi SDK 生产依赖或 RPC，也没有改变公共 `Agent` 接口和 Codex 默认 Runtime。
