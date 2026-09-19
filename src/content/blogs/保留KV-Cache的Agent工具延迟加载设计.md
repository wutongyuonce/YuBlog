---
title: 不破坏 KV Cache 缓存的 Agent 工具延迟加载设计
description: 关于 Agent 工具延迟加载：Anthropic、OpenAI 如何把工具 schema 推迟到历史加载点，以及 Pi 是如何在不破坏前缀缓存的前提下做 API 适配的。
pubDate: 2026-09-19
tags: [Agent, Tools, KV Cache]
titleImage: /blog-title-images/eva.webp
titleImageAlt: EVA 动漫壁纸
toc: true
search: true
---

> 本文讨论的是 **工具 schema 的延迟进入模型上下文**，不是工具代码的动态 `import()`，也不是工具执行权限控制。
>
> 基线：2026-09-19。Anthropic Tool Search、OpenAI Responses 的相关字段仍可能演进。
>
> - [Anthropic Tool Search](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-search-tool)
> - [Anthropic Tool Reference](https://platform.claude.com/docs/en/agents-and-tools/tool-use/tool-reference)
> - [OpenAI Tool Search](https://developers.openai.com/api/docs/guides/tools-tool-search)
> - [OpenAI Responses API Reference](https://developers.openai.com/api/reference/cli/resources/beta/subresources/responses)

## 1. TL;DR

工具延迟加载要解决的不是“Agent 本地是否知道这个工具”，而是：**如何让大量工具已经注册在 Agent 本地，但只让少量常用工具进入模型的初始上下文；等模型搜索到某项能力后，再让对应的完整 schema 从搜索结果所在的历史位置开始生效，同时不改写此前已经稳定的上下文前缀。**

这里有三层不同的“上下文”：Agent 自己维护 system prompt、工具注册表和 transcript；每轮再把这些模块序列化成 Provider 接受的 JSON 请求；Provider 最后解释这些字段，拼成真正交给 LLM 的 `system prompt + tools schema + messages`。因此，某个 schema 已经存在于 Agent 内存甚至请求 JSON 中，并不等于它已经进入模型上下文。

延迟加载由两个独立环节组成：

1. **工具发现与激活**：模型怎样找到工具，以及 Agent 从什么时候开始允许调用它；
2. **Provider 请求序列化**：工具 schema 通过什么 JSON 结构，在对话的哪个位置进入真正的模型上下文。

搜索可以由 Provider 服务端执行，也可以由 Agent 本地的普通搜索工具执行；但 schema 最终怎样进入模型上下文，必须遵守对应 Provider 的协议。Anthropic 使用 `defer_loading + tool_reference` 表达加载点；OpenAI Responses 使用 hosted/client-executed Tool Search，或在高级场景使用 `additional_tools`。不支持后置加载的 Provider 只能在下一轮重发完整工具列表，功能仍然正确，但会改变稳定前缀并影响 KV Cache。

Claude Code、Codex 这类与单一模型服务深度绑定的 Agent，可以直接围绕自家 Provider 的请求格式组织 `tools` 和 `messages`。Pi、OpenCode 这类多 Provider Agent 则需要维护一套 Provider-neutral 的工具状态和会话历史，再由 adapter 转成各家的 JSON。后文先看两家 Provider 如何表达延迟加载，再看 Pi 如何把统一状态适配过去。

---

## 2. Anthropic Messages API

Anthropic 的关键设计是：**候选工具的完整 schema 可以存在于请求顶层 `tools[]`，但被标为 `defer_loading: true` 后，不进入 Claude 的初始工具上下文；等历史中出现对应的 `tool_reference`，服务端才在该位置展开 schema。**

工具搜索既可以由 Anthropic 原生 Tool Search 执行，也可以由 Agent 自己实现。这里的“原生”只修饰搜索器，被搜索和最终执行的业务工具仍然可以由 Agent 定义：

| 对象 | 谁定义 | 谁执行 |
| --- | --- | --- |
| `tool_search_tool_bm25` / `tool_search_tool_regex` | Anthropic | Anthropic 服务端 |
| `get_weather` 等 deferred business tool | Agent | Agent |

Anthropic 不会读取 Agent 的本地 registry，也不会替 Agent 执行业务函数。使用原生搜索时，Agent 必须把搜索器声明和全部候选 schema 一起发给 Anthropic。

### 2.1 原生 Tool Search：服务端搜索请求中的候选目录

一个最小请求如下：

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

Anthropic 收到 `get_weather` 的完整 schema 后，只把它作为本次搜索的候选项。Claude 初始只看到 Tool Search 和非延迟工具；需要天气能力时再调用 Tool Search。服务端命中 `get_weather` 后生成 `tool_reference`，并从该历史位置开始把完整 schema 展开给 Claude。Claude 随后生成普通 `tool_use`，真正的 `get_weather` 仍由 Agent 执行。

这里存在两层工具循环：外层是 Agent 自己的 agent loop，负责调用模型和执行普通业务工具；内层是 Anthropic API 提供的 **server-side agentic loop**，只负责执行 Tool Search 等 Server Tool。它不是另一个独立 Agent，而是 Anthropic 在 Claude 外围提供的一层固定编排：Claude 生成 `server_tool_use` 后，服务端暂停当前生成、执行搜索、补充搜索结果和命中的 schema，再让同一个 Claude 继续当前 turn。

完整链路可以概括为：

```text
外层 Agent 发起一次 Messages API 请求
        ↓
Anthropic 组装初始上下文，暂不放入 deferred schemas
        ↓
Claude 生成 server_tool_use，请求 Tool Search
        ↓
内层 server-side agentic loop 暂停生成并执行搜索
        ↓
服务端追加搜索结果，在引用位置展开命中的 schema
        ↓
同一个 Claude 继续当前 turn，生成普通 tool_use
        ↓
Anthropic 把 tool_use 返回给外层 Agent
        ↓
外层 Agent 执行业务工具，再发下一次请求返回 tool_result
```

因此，一次外层 API 请求内部可以完成“Claude 调用 Server Tool → Anthropic 执行 → Claude 继续生成”；只有遇到需要客户端执行的普通 `tool_use` 时，控制权才回到 Agent。

### 2.2 Agent 自定义 Tool Search：Agent 搜索本地目录

Agent 也可以不使用 Anthropic 的搜索器，而是把 `tool_search` 定义成一个普通 Client Tool。此时候选目录保存在 Agent 本地，搜索算法也由 Agent 执行：

```text
首次只把自定义 tool_search 发给 Claude
        ↓
Claude 调用 tool_search
        ↓
Agent 搜索本地 registry，找到 get_weather
        ↓
下一次请求发送 get_weather schema + tool_reference
        ↓
Anthropic 服务端在引用位置展开 schema
        ↓
Claude 调用 get_weather，Agent 执行
```

这条路径中，Anthropic 不参与“查找哪个工具”，只负责解释 `defer_loading` 和 `tool_reference`。出现 `tool_reference` 的那次请求，顶层 `tools[]` 仍必须带上被引用工具的完整 schema，否则服务端无法展开。也就是说，搜索目录可以留在 Agent 本地，但最终的加载位置仍由 Anthropic 协议表达。

---

## 3. OpenAI Responses API

OpenAI Responses API 把两种搜索控制方式都做成了原生 Tool Search 模式：

- **Hosted Tool Search**：OpenAI 服务端搜索本次请求中声明的 deferred tools。
- **Client-executed Tool Search**：模型提出搜索请求，由 Agent 搜索自己的工具目录并返回命中的 schema。

当前 Responses API 只有 `gpt-5.4` 及之后的模型支持 `tool_search`。启用时需要在 `tools[]` 中声明 `{"type": "tool_search"}`；Hosted 模式还要用 `defer_loading: true` 标出候选工具中暂不加载的部分。

### 3.1 Hosted Tool Search：OpenAI 服务端完成搜索

Hosted 模式适合请求发出前已经知道全部候选工具的场景。Agent 将 Tool Search 和候选 schema 一起放进 `tools[]`，OpenAI 在一次 Responses API 调用内部完成搜索和加载。

与 Anthropic 不同，OpenAI 会在初始上下文中保留可搜索对象的名称和描述，只延后更详细的定义：

| 延迟对象 | 模型初始看到什么 | 命中后加载什么 |
| --- | --- | --- |
| 单个 function | function 名称和描述 | 参数 schema |
| namespace | namespace 名称和总览描述 | 命中的内部 functions |
| MCP server | server 名称和总览描述 | 命中的 MCP tools |

所以延迟单个 function 主要节省参数 schema；如果希望隐藏一整批内部工具的名称、描述和参数，应当使用 namespace 或 MCP server。

例如，下面的请求把天气工具放在 `weather` namespace 中，并将 `get_weather` 标记为 deferred：

```json
{
  "model": "gpt-5.4",
  "input": "上海今天的天气怎么样？",
  "tools": [
    {
      "type": "namespace",
      "name": "weather",
      "description": "Weather-related tools",
      "tools": [
        {
          "type": "function",
          "name": "get_weather",
          "description": "Get weather for a location",
          "defer_loading": true,
          "parameters": {
            "type": "object",
            "properties": {
              "location": { "type": "string" }
            },
            "required": ["location"],
            "additionalProperties": false
          }
        }
      ]
    },
    { "type": "tool_search" }
  ]
}
```

OpenAI 服务端收到了 `get_weather` 的完整 schema，但模型的初始上下文只看到 `weather` namespace 的名称和总览描述，看不到里面的 function 明细。当模型判断需要天气能力时，才发起 Tool Search。

完整链路是：

```text
外层 Agent 发起一次 Responses API 请求
        ↓
OpenAI 组装初始上下文，只展示可搜索目录的概要
        ↓
模型生成 tool_search_call，请求查找天气工具
        ↓
OpenAI 在本次请求声明的 deferred tools 中搜索
        ↓
OpenAI 生成 server 模式的 tool_search_output
并把 get_weather 的完整 schema 追加到上下文末尾
        ↓
同一个模型在同一 response 中继续，生成 get_weather 的 function_call
        ↓
OpenAI 把 function_call 返回给外层 Agent
        ↓
外层 Agent 执行 get_weather，再返回 function_call_output
```

从概念上看，这里也存在一段服务端内部循环：模型请求搜索，OpenAI 暂停当前生成、执行搜索、加载 schema，再让模型继续生成。但它只负责“找到并加载工具”，不会替 Agent 执行 `get_weather` 这样的业务函数。

Responses 的输出中会记录 `tool_search_call` 和 `tool_search_output`。Hosted 模式下它们的 `execution` 是 `server`，搜索调用没有需要应用回传的 `call_id`；整个搜索阶段在同一个 response 内完成，不需要 Agent 中途接管。

### 3.2 Client-executed Tool Search：Agent 执行搜索

如果候选工具取决于当前项目、租户、权限或其他实时状态，Agent 往往无法在首次请求中把完整目录交给 OpenAI。此时可以把 Tool Search 配置为 `execution: "client"`，让模型只描述“想找什么工具”，再由 Agent 搜索自己的 registry。

首次请求只需要声明搜索工具及其搜索参数：

```json
{
  "model": "gpt-5.4",
  "input": "查询订单 order_42 的预计送达时间",
  "tools": [
    {
      "type": "tool_search",
      "execution": "client",
      "description": "Find project-specific tools needed for the task",
      "parameters": {
        "type": "object",
        "properties": {
          "goal": { "type": "string" }
        },
        "required": ["goal"],
        "additionalProperties": false
      }
    }
  ]
}
```

这一次模型不会自己完成搜索，而是返回一个 `tool_search_call` 并停止当前 response：

```json
{
  "type": "tool_search_call",
  "execution": "client",
  "call_id": "call_abc123",
  "arguments": {
    "goal": "Find a shipping ETA tool for order_42"
  }
}
```

Agent 收到后搜索本地工具目录，再在下一次请求中返回同一个 `call_id` 对应的 `tool_search_output`。完整工具定义直接放在 `tools` 中：

```json
{
  "type": "tool_search_output",
  "execution": "client",
  "call_id": "call_abc123",
  "status": "completed",
  "tools": [
    {
      "type": "function",
      "name": "get_shipping_eta",
      "description": "Look up shipping ETA for an order",
      "defer_loading": true,
      "parameters": {
        "type": "object",
        "properties": {
          "order_id": { "type": "string" }
        },
        "required": ["order_id"],
        "additionalProperties": false
      }
    }
  ]
}
```

完整链路变为：

```text
外层 Agent 只声明 client-executed Tool Search
        ↓
模型生成 tool_search_call，并结束当前 response
        ↓
Agent 根据 arguments 搜索自己的工具 registry
        ↓
Agent 在下一次请求中返回 tool_search_output + 完整 schema
        ↓
OpenAI 把命中的 schema 追加到模型上下文末尾
        ↓
模型生成普通 function_call
        ↓
Agent 执行业务函数并返回结果
```

这里没有 Hosted 模式中的服务端搜索循环：OpenAI 只生成搜索请求并解释搜索结果，真正的目录检索发生在 Agent 侧。Client 模式还允许 `tool_search_output` 返回首次请求中没有出现过的工具，因此可以接入动态 registry；相应地，Agent 必须校验返回的 schema，只暴露可信工具。

### 3.3 schema 的加载位置与 `additional_tools`

无论 Hosted 还是 Client-executed，新发现的工具都会被放到模型上下文末尾，而不是回头改写开头稳定的工具前缀。已经加载的工具在后续 turn 中仍可调用；如果手动重放历史，应保留相应搜索输出及其顺序。这样做的核心目的是尽量保持前缀缓存稳定。

`additional_tools` 是一个更底层的高级注入机制：它允许应用绕过常规 Tool Search 流程，在 `input[]` 的某个历史位置直接增加工具，也可以在手动重放历史时恢复原来的加载顺序。它不是 Hosted 和 Client-executed 之外的第三种搜索方式。

---

## 4. Anthropic 与 OpenAI 的格式对照

前两章的差异可以归结为下表。这里比较的是 Provider 原生协议，不涉及 Pi 等 Agent framework 的 adapter：

| 问题 | Anthropic 原生 Tool Search | OpenAI Hosted | OpenAI Client-executed |
| --- | --- | --- | --- |
| 候选目录在哪里 | 本次请求的 `tools[]` | 本次请求的 `tools[]` | Agent 自己的 registry |
| 首次请求是否发送候选 schema | 是 | 是 | 不要求 |
| 模型初始看到什么 | Tool Search 和非延迟工具；deferred schema 不进入初始工具区 | 可搜索对象的名称、描述；详细定义延后 | Client Tool Search 的名称、描述和搜索参数 |
| 搜索在哪里执行 | Anthropic 服务端 | OpenAI 服务端 | Agent 本地 |
| 搜索是否在一次 API 响应内完成 | 是 | 是 | 否，需要 Agent 回传搜索结果 |
| 搜索结果如何表达 | `tool_reference` | server `tool_search_output` | client `tool_search_output`，通过 `call_id` 关联 |
| schema 如何进入后续上下文 | 服务端在引用位置展开 | 服务端追加到上下文末尾 | 服务端把 Agent 返回的 schema 追加到上下文末尾 |
| 谁执行最终业务工具 | Agent | Agent | Agent |

Anthropic 的 Agent 自定义搜索与 OpenAI Client-executed 在控制面上相似：都是模型提出搜索需求、Agent 查询本地目录。区别在于 wire format：Anthropic 把自定义搜索器当作普通 Client Tool，并用 `tool_reference` 表达加载点；OpenAI 则直接提供 `execution: "client"`、`tool_search_call` 和 `tool_search_output`。

统一的只是语义：

```text
这个工具从某个历史节点开始可用
```

不应把 Agent 的内部状态直接统一成某一家 Provider 的 JSON。

到这里，Provider 层只解决了“怎样让 schema 在正确的位置进入模型上下文”。下一章再向上一层看：Pi 怎样记录工具激活事实，并为不同 Provider 生成这些格式。

---

## 5. Pi 如何支持工具延迟加载（配合 Extension）

Pi 对工具延迟加载的支持分布在 coding-agent、agent transcript 和 pi-ai adapter 三层。它内置的是“记录工具何时激活，并按 Provider 协议重新序列化”的机制，**不是一个内置的 `ToolSearch`、`search_tools` 或 loader 工具**。真正负责搜索本地工具目录的 `tool_search` 通常由 extension 作为普通工具实现。

三层职责如下：

| 层次 | 负责什么 | 不负责什么 |
| --- | --- | --- |
| coding-agent extension | 注册候选工具、实现搜索、决定激活哪些工具 | 不构造 Anthropic/OpenAI 私有 JSON |
| agent transcript | 保存消息，以及“哪些工具在这条结果后激活”的加载点 | 不把某一家 Provider 的私有 block 当作核心状态 |
| pi-ai adapter | 从当前工具和历史加载点恢复 immediate/deferred，再生成 Provider 请求 | 不决定业务上应该搜索或激活哪个工具 |

完整链路是：

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

### 5.1 注册：`pi.registerTool()`

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

会话开始时，只把 `tool_search` 和少量高频工具设为 active，其余工具继续留在 registry 中等待搜索：

```ts
pi.on("session_start", () => {
  pi.setActiveTools([
    "tool_search",
    "read_file",
    "run_command",
  ]);
});
```

因此，`get_weather` 可以已经注册，但暂时不在 active 集合里。`tool_search` 仍能在本地找到它，首次模型请求却不必携带它的完整 schema。

### 5.2 搜索与激活：extension 实现普通 `tool_search`

这个 `tool_search` 需要由 extension 自己使用关键词过滤、BM25 或 embedding 实现。它搜索的是 Pi 本地 registry，不是 Anthropic 或 OpenAI 服务端的目录。

搜索工具要完成两件事：返回少量相关结果，并把命中的工具追加到当前 active 集合。下面是省略检索实现的伪代码：

```ts
async function executeToolSearch(query: string) {
  const matches = searchRegistry(query);
  const current = pi.getActiveTools();
  const next = new Set([
    ...current,
    ...matches.map((tool) => tool.name),
  ]);

  pi.setActiveTools([...next]);

  return matches.map((tool) => ({
    name: tool.name,
    description: tool.description,
  }));
}
```

这里必须采用追加式激活，不要一边删除旧工具、一边加入新工具。只有前后 active 集合是纯追加关系，wrapper 才能把新增工具安全地记录成历史加载点。Extension 不需要、也不应该自己写 `addedToolNames`。

`setActiveToolsByName()` 会：

1. 从 registry 取出对应工具；
2. 更新 `agent.state.tools`；
3. 使用当前 active tool 名称重建 base system prompt；
4. 新工具从下一次 Agent 续跑开始生效。

因此首次请求里没有 `Calculator` 并不是问题。Pi 自己的 `tool_search` 查的是本地 registry，不需要 Provider 先拿到所有 deferred schema。这与 Anthropic 原生 Tool Search 的控制面不同：前者由 Pi extension 在客户端搜索，后者由 Anthropic 服务端搜索请求中已经提交的 deferred 目录。

### 5.3 wrapper 历史加载点：`ToolResultMessage.addedToolNames`

Pi 的 wrapper 是所有已注册工具（extension + builtin）执行时套的一层：跑完后对比 active 集合，**只有纯追加才把新名字写进这条 tool result 的 `addedToolNames`**：

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

**如果一次变化同时删除旧工具并增加新工具**，wrapper 不会把它误记成安全的纯追加加载点。此时 adapter 需要走退化路径，**整条延迟加载链自动塌掉**：

 1. `splitDeferredTools()` 只认历史里的 `addedToolNames`。没这个字段，新工具就不会进 `deferred`。
 2. 新工具留在 `immediate`，下一轮顶层 `tools[]` 直接带完整 schema，不加 `defer_loading`，也不在历史位置插入 `tool_reference` / `additional_tools`。
 3. 功能还在：模型下一轮就能调新工具。代价是 tool 前缀变了，prompt cache 这次大概率 miss。

### 5.4 重建 immediate/deferred：`splitDeferredTools()`

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

### 5.5 Anthropic adapter

Pi 的 Anthropic adapter：

1. 调用 `splitDeferredTools()`；
2. 把 immediate 和 deferred 都转换进原始顶层 `tools[]`；
3. 给 deferred 定义加 `defer_loading: true`；
4. 在对应 tool result 处把 `addedToolNames` 转成 `tool_reference`；
5. 由 Anthropic 服务端在引用处展开 schema。

Anthropic 不允许在同一个 `tool_result.content` 中混合普通内容与 `tool_reference`。Pi 因此把引用保留在 tool result 中，并把原普通结果内容拆成相邻 content block。

此外，如果分类后没有任何 immediate tool、却存在 deferred tool，Pi 会回退为全部立即加载，因为 Anthropic 拒绝“所有工具都 deferred”的请求。

### 5.6 OpenAI Responses / Codex adapter

Pi 的 OpenAI adapter 同样先使用 `splitDeferredTools()`，但序列化方式不同：

- 顶层 `tools` 只放 `immediate`；
- 遍历消息历史时，在拥有 `addedToolNames` 的结果后寻找相应 schema；
- 支持时插入 `additional_tools`；
- 否则插入已完成的 `tool_search_call` + `tool_search_output`；
- 再不支持则回退为普通完整工具列表。

这说明 Pi 不需要把 Anthropic 的 `tool_reference` 硬塞给 OpenAI，也不需要为了 OpenAI 改写 extension 的激活逻辑。

这里的已完成 `tool_search_call + tool_search_output` 只是 OpenAI adapter 表达历史加载点的一种 wire format，不表示搜索改由 OpenAI 服务端执行。工具搜索早已由 extension 的本地 `tool_search` 完成。

### 5.7 普通 Chat Completions adapter

缺少这种协议能力的普通 Chat Completions provider，则只能下一轮重发完整 active tools。

### 5.8 System prompt 边界：为什么延迟工具不应携带 active-only `promptSnippet`

Pi 的工具 schema 和 system prompt 不是同一条通道。工具定义除 name/description/schema 外，还可以通过 coding-agent 的 `promptSnippet`、`promptGuidelines` 参与 system prompt 组装。

当前 Pi 已经把 system prompt 拆成按名索引的 section：`preamble`、`tools`、`rules`、`docs`、`addendum`、`project_context`、`skills`、`cwd`，以及 extension 自定义的 XML 包裹 section。`setActiveTools()` 仍会调用 `_rebuildSystemPrompt(validToolNames)`，但重建的是 `_baseSystemPromptOptions`，不再把整段 prompt 当一个不可分割的字符串替换。下一轮请求前，Pi 用 `diffSystemPromptSections()` 对比 transcript 里模型当前持有的 section 和本次期望的 section，只追加一条 system message，补丁里只有变化过的部分。

因此，如果延迟工具携带只在激活时加入的 snippet / guidelines，受影响的是 `tools`（以及可能的 `rules`）这两个 section：

```text
激活前：tools section = 立即工具列表
激活后：tools section 被补丁改写成 立即工具 + 新工具 snippet
```

schema 仍然可以正确放在历史后缀，但 `tools` section 变了。支持对话中途 system message 的模型可以保住未改 section 的缓存前缀；不支持的模型会把重放后的完整 prompt 当作新的 leading system prompt，这次变化对应一次 cache miss。

因此缓存友好的延迟工具应遵守：

- 延迟工具自身不要带 active-only `promptSnippet`；
- 不要带会随激活集合变化的 `promptGuidelines`；
- 搜索入口可以有稳定 snippet，因为它从会话开始就处于 active；
- 延迟工具的名称或能力目录如需告诉模型，应写成自定义 section，并且每轮内容保持不变。不要把目录写进会随 active tool 集变化的 `tools` / `rules`。

模型虽然看不到延迟工具的完整 schema，但仍需要知道“有哪些能力可以搜索”。可以在 `before_agent_start` 中提供一个简短、稳定的能力目录：

```ts
pi.on("before_agent_start", (event) => {
  event.systemPromptOptions.sections.tool_catalog = [
    "Deferred tools (search before use):",
    "- get_weather: weather by location",
    "- Calculator: arithmetic expression",
  ].join("\n");
});
```

Pi 会把它渲染成 `<tool_catalog>...</tool_catalog>`。这里放的是能力索引，不是完整 JSON Schema；它只帮助模型判断何时调用 `tool_search`。

`before_agent_start` 声明的是“本轮期望的 section 状态”，不是每轮向 system prompt 追加一段新文本：

| 本轮如何处理 `tool_catalog` | Pi 的行为 |
| --- | --- |
| 写入与上一轮相同的内容 | diff 为空，不发送重复补丁 |
| 写入不同内容 | 只更新这个 section |
| 删除该 key，或者本轮不再声明它 | 发送 `null` 补丁，移除该 section |

所以 section 可以增加、修改，也可以删除。官方 `prompt-customizer.ts` 采用的也是“有内容就赋值，没有就 `delete`”的方式。不要使用 `return { systemPrompt: event.systemPrompt + extra }`，也不要设置 `forceSystemPrompt`；这会把 system prompt 当成整体替换，绕开 section diff。

这里不是说所有延迟工具在类型层面必须永久禁止 snippet，而是：

> 若目标包含“工具激活不改变已缓存的 system prompt 前缀”，就必须禁止或隔离所有随 active tool 集变化的 prompt 贡献。自定义 catalog section 与 `tools` section 要分开。

### 5.9 切换 Provider

同一份 Pi 会话切换 Provider 时，不能直接重放上一家 Provider 的私有 JSON。正确做法是继续保留 Pi 的统一消息和 `addedToolNames`，然后由新 adapter 重新构造：

- 切到 Anthropic：重新生成顶层 deferred 定义和历史 `tool_reference`；
- 切到 OpenAI：重新生成 immediate 顶层工具和历史 `additional_tools`/Tool Search item；
- 切到不支持的 Provider：退化为完整当前工具集。

这也是 `addedToolNames` 比直接把某一家 Provider block 存成核心状态更适合作为会话事实的原因。
