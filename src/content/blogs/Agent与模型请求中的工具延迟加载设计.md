---
title: Agent 与模型请求中的工具延迟加载设计
description: 解释 Anthropic、OpenAI Responses 与 Pi 如何实现工具 schema 的延迟加载，以及缓存与 Provider 序列化边界。
pubDate: 2026-09-11
tags: [Agent, Tools]
titleImage: /blog-title-images/eva.webp
titleImageAlt: EVA 动漫壁纸
ogImage: false
toc: true
search: true
draft: false
---

> 本文讨论的是 **工具 schema 的延迟进入模型上下文**，不是工具代码的动态 `import()`，也不是工具执行权限控制。
>
> 基线：2026-09-10。Anthropic Tool Search、OpenAI Responses 的相关字段仍可能演进。

## 1. 先说结论

工具延迟加载要解决的不是“Agent 本地是否知道这个工具”，而是：

1. Agent 本地可以注册、索引很多工具；
2. 首次模型请求只让模型看到少量常用工具和一个搜索入口；
3. 模型需要某种能力时先搜索；
4. 搜索命中的完整 schema 在**搜索结果所在的历史位置**进入模型上下文；
5. 后续请求继续保留这个历史加载点，不把新 schema 挪回稳定前缀；
6. 不同模型 API 用不同 JSON 表达同一语义。

因此必须区分三种“上下文”：

| 层面 | 含义 | Anthropic deferred tool 的位置 |
| --- | --- | --- |
| 客户端原始请求 JSON | SDK/Agent 实际发送的字段 | 完整 schema 仍在顶层 `tools[]`，带 `defer_loading: true` |
| 服务端渲染后的模型上下文 | Provider 真正交给模型的 token 序列 | 初始前缀不含 deferred schema；命中后在 `tool_reference` 所在位置展开 |
| Agent 自己的会话记录 | 用于重放、切换模型和下一轮构造请求 | 可以只保存“哪些工具在这个结果后变为可用”的加载点元数据 |

最容易出现的误解是：

> “完整 schema 在 Anthropic 请求的 `tools[]` 中”不等于“完整 schema 已经进入模型的初始上下文前缀”。

同样：

> “schema 在历史位置生效”不等于“客户端必须把 schema 字面量写进 `messages[]`”。Anthropic 可以由服务端根据 `tool_reference` 展开；OpenAI Responses 则可以用后置 input item 直接承载 schema。

---

## 2. 延迟加载的两个层次

### 2.1 工具发现与激活

这一层回答：模型怎么知道还有工具可找，以及搜索后哪些工具变成可调用。

常见方案有两种：

- **Provider 原生 Tool Search**：Provider 接收完整工具目录，搜索和引用展开由服务端完成，例如 Anthropic Tool Search。
- **Agent 自己实现 Tool Search**：Agent 本地维护注册表，暴露一个普通的 `tool_search` 工具；模型调用它后，Agent 搜索本地目录并激活命中的工具，例如 Pi extension。

二者可以产生相同的模型行为，但控制面不同。前者要求 Provider 在第一次请求时就拿到可搜索的完整 schema；后者第一次请求可以完全不发送未激活 schema。

### 2.2 Provider 请求序列化

这一层回答：一个工具已经在会话中途激活以后，怎样把 schema 放进当前历史位置，同时尽量保留缓存前缀。

- Anthropic：顶层继续带完整目录，用 `defer_loading` + `tool_reference` 表达加载点，服务端负责展开。
- OpenAI Responses：顶层只带立即可用工具，在 `input[]` 的历史位置插入 `additional_tools`，或插入一对已完成的 `tool_search_call` / `tool_search_output`。
- 不支持后置工具定义的普通 Chat Completions：通常只能下一轮重发完整当前工具集，缓存收益较弱。

因此“工具发现”和“schema 怎么进入 Provider 上下文”是两件事。Pi 的 `tool_search` extension 负责前者，`pi-ai` provider adapter 负责后者。

---

## 3. Anthropic Messages API

### 3.1 第一次请求：所有 schema 都发给服务端

Anthropic 原生 Tool Search 要求：

- `tools[]` 中至少有一个非延迟工具，通常就是 Tool Search；
- 所有可能被搜到的工具也都必须有完整定义；
- 暂不进入初始模型上下文的工具带 `defer_loading: true`。

简化后的请求如下：

```json
{
  "model": "claude-sonnet-...",
  "max_tokens": 2048,
  "messages": [
    { "role": "user", "content": "查询旧金山天气" }
  ],
  "tools": [
    {
      "type": "tool_search_tool_bm25_20251119",
      "name": "tool_search_tool_bm25"
    },
    {
      "name": "get_weather",
      "description": "Get weather for a location",
      "input_schema": {
        "type": "object",
        "properties": {
          "location": { "type": "string" }
        },
        "required": ["location"]
      },
      "defer_loading": true
    }
  ]
}
```

原始 HTTP JSON 中有 `get_weather` 的完整 schema，但 Anthropic 服务端会把 deferred tool 排除在初始 system/tool 前缀之外。第一次真正给模型看的主要是：

```text
[稳定 system prompt]
[非延迟工具：tool_search_tool_bm25]
[用户消息]
```

而不是：

```text
[稳定 system prompt]
[tool_search + get_weather 完整 schema]
[用户消息]
```

### 3.2 搜索后：响应中保存的是引用，不是客户端展开的 schema

原生搜索可能在同一次模型生成中得到：

```json
{
  "role": "assistant",
  "content": [
    {
      "type": "server_tool_use",
      "id": "srvtoolu_search_1",
      "name": "tool_search_tool_bm25",
      "input": { "query": "weather by location" }
    },
    {
      "type": "tool_search_tool_result",
      "tool_use_id": "srvtoolu_search_1",
      "content": {
        "type": "tool_search_tool_search_result",
        "tool_references": [
          { "type": "tool_reference", "tool_name": "get_weather" }
        ]
      }
    },
    {
      "type": "tool_use",
      "id": "toolu_weather_1",
      "name": "get_weather",
      "input": { "location": "San Francisco" }
    }
  ]
}
```

客户端下一轮需要：

1. 原样回传 `server_tool_use`、`tool_search_tool_result` 和其中的 `tool_reference`；
2. 为真正执行的 `get_weather` 返回 `tool_result`；
3. 再次发送相同的完整 `tools[]`，包括 deferred schema；
4. 不要为服务端 Tool Search 的 `srvtoolu_...` 返回客户端 `tool_result`。

真正的展开过程是：

```text
客户端 messages 中的 tool_reference
        ↓
Anthropic 服务端从本次请求的 tools[] 找到同名完整定义
        ↓
在 tool_reference 所在的会话位置展开 schema
        ↓
把展开后的上下文交给 Claude
```

所以更准确的表述是：

> Anthropic 客户端把 `tool_reference` 留在 `messages` 历史中，同时每次在顶层 `tools[]` 提供完整 schema；Anthropic 服务端在把上下文交给模型之前，于引用位置展开 schema。客户端并没有把完整 schema 字面量追加到 `messages[]`。

### 3.3 为什么不会破坏前缀缓存

普通工具增加时，渲染后的 tool/system 前缀会从 N 个定义变成 N+1 个定义，缓存前缀可能变化。

`defer_loading: true` 的语义不同：Anthropic 在构造模型上下文与缓存前缀时先排除这些定义。命中后，schema 在对话历史里的引用位置展开，稳定前缀保持不变。

可以理解为：

```text
稳定前缀：system + 非延迟工具
可增长后缀：user/assistant/tool_result + 被引用后展开的工具定义
```

这里依赖的是 Anthropic 服务端明确实现的 deferred-tool 语义，不是客户端单纯增加一个布尔字段就能在任意 Provider 上自动获得的效果。

### 3.4 自定义客户端搜索

Anthropic 也允许不用内置 BM25/Regex Search，而是调用客户端自己的普通搜索工具。该工具的 `tool_result.content` 可以返回：

```json
[
  { "type": "tool_reference", "tool_name": "get_weather" }
]
```

前提仍然是本次请求顶层 `tools[]` 中存在对应完整定义，通常带 `defer_loading: true`。这与 Pi extension 自己搜索本地目录的思路接近，但 Pi 还需要 adapter 把搜索结果转换成 Anthropic 所需的 `tool_reference`。

---

## 4. OpenAI Responses API

### 4.1 关键差异：未加载 schema 不必留在顶层 `tools`

OpenAI Responses 的延迟工具表达不要求照搬 Anthropic 的顶层目录方式。以当前 Pi adapter 支持的格式为例，首次请求可只发送立即工具：

```json
{
  "model": "gpt-...",
  "input": [
    { "role": "user", "content": "查询旧金山天气" }
  ],
  "tools": [
    {
      "type": "function",
      "name": "tool_search",
      "description": "Search and activate tools",
      "parameters": {
        "type": "object",
        "properties": {
          "query": { "type": "string" }
        },
        "required": ["query"]
      }
    }
  ]
}
```

本地搜索激活 `get_weather` 后，Pi 可在搜索工具结果之后插入：

```json
[
  {
    "type": "function_call_output",
    "call_id": "call_search_1",
    "output": "Found get_weather"
  },
  {
    "type": "additional_tools",
    "role": "developer",
    "tools": [
      {
        "type": "function",
        "name": "get_weather",
        "description": "Get weather for a location",
        "parameters": {
          "type": "object",
          "properties": {
            "location": { "type": "string" }
          },
          "required": ["location"]
        },
        "strict": false
      }
    ]
  }
]
```

这里完整 schema 的确位于 `input[]` 的后部，而不是顶层 `tools[]` 的稳定前缀。

### 4.2 `tool_search_call` / `tool_search_output` 兼容路径

如果模型支持 Tool Search item、但不支持 `additional_tools`，Pi 当前还可以合成一对已经完成的客户端搜索记录：

```json
[
  {
    "type": "tool_search_call",
    "call_id": "pi_tool_load_xxx",
    "execution": "client",
    "status": "completed",
    "arguments": {
      "query": "get_weather",
      "limit": 1
    }
  },
  {
    "type": "tool_search_output",
    "call_id": "pi_tool_load_xxx",
    "execution": "client",
    "status": "completed",
    "tools": [
      {
        "type": "function",
        "name": "get_weather",
        "description": "Get weather for a location",
        "parameters": { "type": "object", "properties": {} },
        "strict": false,
        "defer_loading": true
      }
    ]
  }
]
```

这条路径同样把 schema 锚定在历史加载点。`defer_loading` 在这里属于 Tool Search 输出中工具定义的属性，不能反推为“OpenAI 所有接口都应该把全部 deferred schema 放在顶层 tools”。

### 4.3 OpenAI 的缓存逻辑

对于这种请求格式，缓存友好的关键是：

- 首次和后续请求的 `instructions`、稳定 input 前缀、顶层立即工具不变；
- 新工具定义出现在历史后缀的固定位置；
- 不因为激活新工具而改写 system prompt；
- 不把所有已激活工具重新塞回顶层 `tools[]`。

这与 Anthropic 的目标一致，但实现位置不同：Anthropic 由服务端把引用展开到历史位置；OpenAI Responses 可直接由客户端把 schema 作为后置 input item 发送。

### 4.4 API 边界

OpenAI 当前文档把 Tool Search 标为 hosted 或 BYOT（bring your own tool）搜索，并定义了 `tool_search_call`、`tool_search_output` 等 item。具体模型是否支持 `additional_tools` 或 Tool Search，需要由 adapter 的模型兼容能力判断，不能只看 API 名称。

不支持这些格式时，应退化为普通工具调用：下一轮顶层发送完整当前工具集。功能仍然正确，只是不再保证相同的缓存收益。

---

## 5. Anthropic 与 OpenAI 的格式对照

| 问题 | Anthropic Messages | OpenAI Responses |
| --- | --- | --- |
| 首次请求是否发送所有 deferred schema | 是，完整定义仍在顶层 `tools[]` | 可以不发送，只保留立即工具 |
| 首次模型上下文是否看到 deferred schema | 否 | 否 |
| 历史加载点如何表达 | `tool_reference` | `additional_tools`，或 `tool_search_call` + `tool_search_output` |
| 谁把引用变成完整 schema | Anthropic 服务端 | 客户端直接放入 input item，或 Provider 解释搜索输出 |
| 后续顶层工具目录 | 继续发送全部工具及 `defer_loading` | 仍可只发送 immediate tools |
| 缓存稳定的关键 | deferred schema 不进入渲染后的前缀 | schema 放入 input 后缀，不改变稳定前缀 |
| 不支持时的退化 | 把工具变为立即工具 | 顶层重发完整当前工具集 |

统一的只是语义：

```text
这个工具从某个历史节点开始可用
```

不应统一成某一家 Provider 的 JSON。

---

## 6. Claude Code 如何适配 Anthropic Tool Search

需要区分“Anthropic 官方 API 契约”和“Claude Code 客户端怎样提示模型”。

### 6.1 标准 API 适配

Claude Code 面向 Anthropic API 时，可以直接使用官方混合模式：

1. 常用工具和 Tool Search 是 non-deferred；
2. 延迟工具仍以完整 schema 出现在原始 `tools[]`，并带 `defer_loading: true`；
3. Claude 先调用 Tool Search；
4. 服务端返回 `tool_reference` 并在模型上下文中自动展开；
5. Claude 随后正常产生目标工具的 `tool_use`；
6. 客户端原样保留搜索响应块，并执行真正的工具调用。

从模型推理过程看，这是“先发现、再使用”两个逻辑阶段；使用 Anthropic 内置服务端 Tool Search 时，它们可能出现在同一次 Messages 响应中，不应机械理解为一定需要客户端发两次 HTTP 请求。若使用客户端自定义搜索，则通常确实需要一次搜索工具执行和下一次模型续跑。

### 6.2 模型最初如何知道可以搜什么

Anthropic 官方搜索会匹配工具名称、描述、参数名和参数描述，所以服务端已经掌握完整目录。模型至少需要知道：

- 有 Tool Search 可用；
- 大致有哪些工具类别或外部系统；
- 找不到当前能力时应该先搜索。

Claude Code 可以在稳定 system prompt 中列出延迟工具名称或能力摘要，以提高发现率。这属于客户端的提示策略，不是 Anthropic API 强制要求。某个版本里有“23 个延迟工具”只能视为当时的工具清单快照，不能写成 Tool Search 的固定数量或协议要求。

### 6.3 为什么 Claude Code 的做法缓存友好

只要：

- Tool Search 和常用工具集合稳定；
- 延迟工具目录的 system prompt 摘要稳定；
- deferred schema 被 Anthropic 排除在渲染前缀之外；
- 搜索命中后只在历史位置展开 schema；

那么增加或使用一个延迟工具不会把已有 system/tool 前缀整体改写。需要注意：如果连 system prompt 中的工具名称目录也发生变化，该目录本身仍可能改变缓存前缀；`defer_loading` 只保证 deferred tool schema 的服务端渲染规则，不会让普通 system 文本自动不参与缓存。

---

## 7. Pi 的设计：统一会话语义，分 Provider 序列化

Pi 当前不是内置一个特殊的 `ToolSearch` 工具类型，而是把问题拆成四段：

```text
registerTool
    ↓ 本地候选工具目录
setActiveTools
    ↓ 下一轮 Context.tools
wrapper 记录 addedToolNames
    ↓ 工具在历史中的激活点
splitDeferredTools
    ↓ immediate + deferred
provider adapter
    ↓ Anthropic / OpenAI / Kimi 各自 JSON
```

### 7.1 注册：`pi.registerTool()`

Extension 注册工具只表示：工具实现和 schema 已进入 Pi 本地 registry。

```ts
pi.registerTool({
  name: "Calculator",
  description: "Evaluate an arithmetic expression",
  parameters: Type.Object({ expr: Type.String() }),
  async execute(...) { ... }
});
```

注册不等于该 schema 已经发送给模型。一个工具可以已注册但未激活。

### 7.2 激活：`pi.setActiveTools()`

Extension 可以在 `session_start` 只保留搜索入口：

```ts
pi.on("session_start", () => {
  pi.setActiveTools(["tool_search"]);
});
```

搜索命中以后采用追加式激活：

```ts
const active = pi.getActiveTools();
pi.setActiveTools([...active, "Calculator"]);
```

`setActiveToolsByName()` 会：

1. 从 registry 取出对应工具；
2. 更新 `agent.state.tools`；
3. 使用当前 active tool 名称重建 base system prompt；
4. 新工具从下一次 Agent 续跑开始生效。

因此首次请求里没有 `Calculator` 并不是问题。Pi 自己的 `tool_search` 查的是本地 registry，不需要 Provider 先拿到所有 deferred schema。这与 Anthropic 内置 Tool Search 的控制面不同。

### 7.3 历史加载点：`addedToolNames`

Pi 的 wrapper 会比较一个工具执行前后的 active tool 集合。如果变化是纯追加，就把新增名称写进当前工具结果：

```ts
type ToolResultMessage = {
  role: "toolResult";
  // ...
  addedToolNames?: string[];
};
```

它表达的是：

> 在这个工具结果之后，这几个工具才变为可用。

它不是 schema，也不是 Anthropic/OpenAI 的协议字段。它是 Pi 自己的 provider-neutral 会话元数据。

如果一次变化同时删除旧工具并增加新工具，wrapper 不会把它误记成安全的纯追加加载点。此时 adapter 需要走保守退化路径。

### 7.4 重建 immediate/deferred：`splitDeferredTools()`

下一轮请求时，`Context.tools` 只回答“现在有哪些工具”；仅靠它无法知道每个工具何时加入。

`splitDeferredTools()` 联合读取：

- 当前 `Context.tools`；
- 历史 assistant `toolCall`；
- 历史 tool result 的 `addedToolNames`。

然后得到：

```ts
{
  immediate: Tool[];
  deferred: Map<string, Tool>;
}
```

这里的 `deferred` 不是“以后也不能调用”，而是“应该在历史加载点进入 Provider 上下文，不能被重新挪到初始前缀”。如果工具在记录加载点之前已经用过，算法不会错误地把它回溯成 deferred。

### 7.5 Anthropic adapter

Pi 的 Anthropic adapter：

1. 调用 `splitDeferredTools()`；
2. 把 immediate 和 deferred 都转换进原始顶层 `tools[]`；
3. 给 deferred 定义加 `defer_loading: true`；
4. 在对应 tool result 处把 `addedToolNames` 转成 `tool_reference`；
5. 由 Anthropic 服务端在引用处展开 schema。

Anthropic 不允许在同一个 `tool_result.content` 中混合普通内容与 `tool_reference`。Pi 因此把引用保留在 tool result 中，并把原普通结果内容拆成相邻 content block。

此外，如果分类后没有任何 immediate tool、却存在 deferred tool，Pi 会回退为全部立即加载，因为 Anthropic 拒绝“所有工具都 deferred”的请求。

### 7.6 OpenAI Responses / Codex adapter

Pi 的 OpenAI adapter 同样先使用 `splitDeferredTools()`，但序列化方式不同：

- 顶层 `tools` 只放 `immediate`；
- 遍历消息历史时，在拥有 `addedToolNames` 的结果后寻找相应 schema；
- 支持时插入 `additional_tools`；
- 否则插入已完成的 `tool_search_call` + `tool_search_output`；
- 再不支持则回退为普通完整工具列表。

这说明 Pi 不需要把 Anthropic 的 `tool_reference` 硬塞给 OpenAI，也不需要为了 OpenAI 改写 extension 的激活逻辑。

### 7.7 普通 Chat Completions

缺少这种协议能力的普通 Chat Completions provider，则只能下一轮重发完整 active tools。

---

## 8. 为什么延迟工具不应携带 active-only `promptSnippet`

Pi 的工具 schema 和 system prompt 不是同一条通道。工具定义除 name/description/schema 外，还可以通过 coding-agent 的 `promptSnippet`、`promptGuidelines` 参与 system prompt 组装。

问题在于 `setActiveTools()` 当前会调用 `_rebuildSystemPrompt(validToolNames)`。如果一个延迟工具携带只在激活时加入的 snippet：

```text
激活前 system prompt = A
激活后 system prompt = A + 新工具 snippet
```

即使 Provider adapter 已经把 schema 正确放到了历史后缀，system prompt 前缀仍被改写，缓存还是可能失效。

因此缓存友好的延迟工具应遵守：

- 延迟工具自身不要带 active-only `promptSnippet`；
- 不要带会随激活集合变化的 `promptGuidelines`；
- 搜索入口可以有稳定 snippet，因为它从会话开始就处于 active；
- 延迟工具的名称或能力目录如需告诉模型，应作为一次性、稳定的 session system prompt 内容加入。

这里不是说所有延迟工具在类型层面必须永久禁止 snippet，而是：

> 若目标包含“工具激活不改变 system prompt 前缀”，就必须禁止或隔离所有随 active tool 集变化的 prompt 贡献。

只让 `setActiveTools()` 不调用 `_rebuildSystemPrompt()` 并不是完整修复，因为正常的工具加载确实需要刷新 prompt；更稳妥的做法是把稳定目录与 active-only 工具说明分开设计。

---

## 9. Pi PR #9434 补上的能力

[PR #9434](https://github.com/earendil-works/pi/pull/9434) 提议允许 `session_start` handler 返回 append-only 的 `systemPromptAppend`：

```ts
pi.on("session_start", () => {
  return {
    systemPromptAppend: `
Additional tools can be discovered with tool_search:
- Calculator: arithmetic expressions
- github_search_issues: search repository issues
`.trim()
  };
});
```

它适合承担“稳定工具目录/能力分类”的职责，因为贡献在会话开始时生成一次，并折叠进 base system prompt；之后工具激活、资源发现等重建仍复用该 session snapshot。

完整组合是：

```text
PR #9434：在 session_start 写入稳定的工具目录提示
        ↓
extension：只把 tool_search 设为初始 active tool
        ↓
模型：根据稳定目录判断何时调用 tool_search
        ↓
extension：搜索本地 registry，追加调用 setActiveTools()
        ↓
Pi wrapper：记录 addedToolNames 历史加载点
        ↓
pi-ai：按 Anthropic/OpenAI/Kimi 能力序列化
```

PR #9434 **没有**单独实现以下能力：

- 不提供 Pi 内置的 `tool_search`；
- 不建立新的工具索引；
- 不负责 `setActiveTools()`；
- 不产生 `addedToolNames`；
- 不实现 `tool_reference`、`additional_tools` 等 Provider JSON；
- 不让普通 system prompt 文本自动退出缓存 key。

它补的是此前缺失的一块：extension 能在 `session_start`、首次请求之前，向稳定 base system prompt 追加目录信息，而不必把目录拆散到每个延迟工具的 active-only snippet 中。

PR 当前设计还包括：

- 多个贡献按 extension/handler 顺序收集；
- 对内容进行 trimming，并保留来源元数据；
- 沿用已有 handler 错误隔离；
- 在 startup、session replacement、reload、tool changes、resource discovery 等 base prompt 重建路径中复用 session snapshot。

这正好保证“重建 prompt”与“重新计算 session 目录”不是同一件事。

---

## 10. 推荐的 Pi extension 实现

### 10.1 会话开始时

1. 所有工具照常 `registerTool()`，形成完整本地 registry；
2. 选 3～5 个高频工具和一个 `tool_search` 为初始 active；
3. 用 PR #9434 的 `systemPromptAppend` 写入稳定能力目录；
4. 延迟工具不提供 active-only snippet/guidelines。

### 10.2 搜索工具执行时

1. 从 registry 读取候选元数据；
2. 使用确定性过滤、BM25 或 embedding 查找；
3. 返回少量结果，避免一次激活过多工具；
4. 只做追加式激活：`setActiveTools([...current, ...matches])`；
5. 不手写 `addedToolNames`，交给 wrapper 从前后 active 集合推导。

### 10.3 请求发送时

Extension 不判断当前 Provider JSON。`pi-ai` 根据模型兼容能力处理：

```text
supportsToolReferences
    → Anthropic defer_loading + tool_reference

supportsAdditionalTools
    → OpenAI additional_tools

supportsToolSearch
    → OpenAI tool_search_call + tool_search_output

kimi deferred mode
    → 后续 system tools message

均不支持
    → 完整当前工具集回退
```

这里最重要的抽象边界不是额外发明一个通用 `Action/Adapter` 领域层，而是复用 Pi 已有的边界：

- coding-agent extension 决定注册、搜索和激活；
- agent transcript 记录 provider-neutral 的加载点；
- pi-ai adapter 负责 wire format。

### 10.4 切换 Provider

同一份 Pi 会话切换 Provider 时，不能直接重放上一家 Provider 的私有 JSON。正确做法是继续保留 Pi 的统一消息和 `addedToolNames`，然后由新 adapter 重新构造：

- 切到 Anthropic：重新生成顶层 deferred 定义和历史 `tool_reference`；
- 切到 OpenAI：重新生成 immediate 顶层工具和历史 `additional_tools`/Tool Search item；
- 切到不支持的 Provider：退化为完整当前工具集。

这也是 `addedToolNames` 比直接把某一家 Provider block 存成核心状态更适合作为会话事实的原因。



---

## 11. 最小测试矩阵

| 场景 | 应验证的结果 |
| --- | --- |
| 首次请求 | 只有搜索入口和常用工具进入模型初始上下文 |
| 搜索无结果 | active tools 不变，不产生 `addedToolNames` |
| 搜索命中一个工具 | wrapper 在对应 tool result 写入新增名称 |
| 重复搜索同一工具 | 不重复写入加载点，不重复注入 schema |
| 一次命中多个工具 | schema 顺序稳定，历史位置一致 |
| 删除并新增工具 | 不误判为纯追加；触发保守回退 |
| Anthropic | raw `tools[]` 有 deferred schema；历史处有 `tool_reference` |
| OpenAI additional tools | 顶层无 deferred schema；历史处有 `additional_tools` |
| OpenAI tool search fallback | 历史处有 completed call/output，schema 在 output 中 |
| 不支持延迟格式 | 下一轮完整工具集可正常调用 |
| system prompt | 激活无 snippet 的延迟工具后，稳定前缀内容不变 |
| resume / fork / reload | session 目录与历史加载点都保留 |

若要验证“没有破坏缓存”，不能只比较客户端的 `Context.tools` 数量，还应比较 Provider 最终请求和服务端缓存指标：

- Anthropic：确认 deferred 标记、引用位置与 cache read/write token；
- OpenAI：确认顶层 tools 前缀未增长、schema 只出现在后置 input item，并观察 cached input tokens；
- Pi：确认 `_rebuildSystemPrompt()` 前后得到的最终 system prompt 文本一致。

---

## 12. 常见错误

### 错误一：认为 `defer_loading` 会让 schema 不出现在 Anthropic 请求 JSON

错误。Anthropic 仍要求完整定义位于顶层 `tools[]`；被省掉的是初始**模型渲染上下文**，不是原始 HTTP payload。

### 错误二：认为完整 schema 被客户端追加进 Anthropic `messages[]`

错误。客户端保存的是 `tool_reference`；服务端依据顶层目录在引用点展开。

### 错误三：认为 Pi 自带一个特殊 loader/tool_search 类型

错误。Pi 提供注册、active 集合、wrapper 加载点和 provider adapter；`tool_search` 是 extension 注册的普通工具。

### 错误四：只调用 `setActiveTools()` 就天然缓存稳定

不一定。它会重建 system prompt；若新增工具带 active-only snippet/guidelines，前缀仍会改变。

### 错误五：为了模仿 Claude Code，让 OpenAI 也在顶层发送全部 deferred schema

没有必要。Pi 应统一会话语义，再按 Provider 原生格式序列化。OpenAI 可以只在历史加载点加入完整 schema。

### 错误六：认为第一次请求没有延迟工具 schema 就无法搜索

只对 Provider 服务端搜索成立。Pi 的客户端搜索查本地 registry，第一次请求不发送未激活 schema 也可以正常工作。

---

## 13. 一句话总结

> 工具延迟加载的核心不是动态修改 `tools[]`，而是把“工具何时变为可用”记录成 provider-neutral 的历史事实，再由 Anthropic、OpenAI 等 adapter 把这个事实序列化为各自支持的后置 schema 机制；同时保持 system prompt 和立即工具前缀稳定。

Pi 已经具备注册、激活、`addedToolNames`、`splitDeferredTools()` 和多 Provider 序列化这条主链。PR #9434 补充的是 session 开始前稳定写入“可搜索工具目录”的入口，使延迟工具不必通过激活时的 `promptSnippet` 修改 system prompt，从而把“模型知道可以搜什么”与“某个工具已经激活”彻底分开。

---

## 14. 参考资料与源码入口

官方资料：

- [Anthropic Tool Search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)
- [Anthropic Tool Reference](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference)
- [OpenAI Responses API Reference](https://developers.openai.com/api/reference/cli/resources/beta/subresources/responses)

Pi 当前源码：

- `pi/packages/coding-agent/src/core/agent-session.ts`：`setActiveToolsByName()` 与 system prompt 重建
- `pi/packages/coding-agent/src/core/extensions/wrapper.ts`：从 active 集变化生成 `addedToolNames`
- `pi/packages/ai/src/types.ts`：`ToolResultMessage.addedToolNames` 与 Provider capability
- `pi/packages/ai/src/utils/deferred-tools.ts`：`splitDeferredTools()`
- `pi/packages/ai/src/api/anthropic-messages.ts`：`defer_loading` 与 `tool_reference`
- `pi/packages/ai/src/api/openai-responses-shared.ts`：`additional_tools`、`tool_search_call`、`tool_search_output`
- `pi/packages/ai/src/api/openai-codex-responses.ts`：OpenAI/Codex 请求构造与能力选择

