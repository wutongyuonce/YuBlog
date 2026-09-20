---
title: 看懂 OpenViking：从服务运行到上下文写入、检索与记忆提取
description: 从运行形态、整体架构和三条核心链路，梳理 OpenViking 如何组织资源、检索上下文并提取长期记忆。
pubDate: 2026-09-13
category: 技术向
tags: [OpenViking, Agent Memory, RAG]
titleImage: /blog-title-images/cold-anime.webp
titleImageAlt: 冷艳风格二次元人物壁纸
toc: true
search: true
---

> 本文面向第一次接触 OpenViking、但已经了解 Agent 和 RAG 基本概念的读者。重点不是罗列 API，而是解释它在 Agent 系统中负责什么、实际怎样运行，以及资源、检索和会话记忆三条主链路怎样贯通。
>
> 源码基线：本地仓库提交 `f494fc9d`（2026-08-21）。OpenViking 仍处于 Alpha 阶段，命令和内部模块可能继续变化；稳定认知应放在职责边界和数据流上。
>
> 参考资料：
>
> * [README_CN](https://github.com/volcengine/OpenViking/blob/main/README_CN.md)
> 
> * https://docs.openviking.ai/zh/concepts
> 
> * https://blog.openviking.ai/post

## 1. TLDR：OpenViking 到底是什么

OpenViking 是给 Agent 使用的上下文数据库。它把三类上下文统一放进 `viking://` 虚拟文件系统：

- Resource：文档、代码仓库、网页等外部资料；
- Memory：从交互中沉淀出的用户事实、偏好、事件和 Agent 经验；
- Skill：Agent 可以复用的操作方法和能力说明。

它解决的不只是“按语义搜索文本”。完整链路是：

```text
写入资源：
文件 / URL / Git 仓库
→ 获取并解析原始内容
→ 建立 viking:// 目录树
→ 异步生成 L0 摘要和 L1 概览
→ 建立向量索引

检索上下文：
用户问题 + 可选会话上下文
→ 生成检索意图或直接使用原查询
→ 从相关目录开始逐层检索
→ 精排、读取正文、控制 token 预算
→ 返回可注入 Agent 的上下文

沉淀记忆：
Agent 会话消息 + 实际使用过的上下文
→ 同步归档当前消息
→ 异步生成会话摘要
→ 提取、去重并更新长期记忆
→ 新记忆进入相同的文件与索引体系
```

因此，OpenViking 不是：

- 只保存 embedding 的向量数据库；
- 一个替 Agent 自动完成任务的通用 Agent；
- 把全部历史对话原样塞回 prompt 的聊天记录仓库；
- 只能服务某一个 Agent 客户端的专用插件。

更准确地说，它是独立运行的上下文基础设施。Agent 或插件负责在正确时机上传消息、发起召回并把结果注入模型；OpenViking 负责上下文的组织、处理、检索、记忆更新和持久化。

## 2. 为什么不能只用普通向量库

普通 RAG 往往把文档切成互相独立的 chunk，再根据向量相似度返回若干片段。这个做法能召回局部文字，但它没有直接表达：

- 片段属于哪个项目、目录或用户；
- 当前结果与父目录、相邻文件有什么关系；
- Agent 应先看一句摘要、结构概览，还是完整正文；
- 这段内容是外部资源、用户记忆还是可执行 Skill；
- 一次召回为什么沿着某条目录路径得到这些结果。

OpenViking 在向量索引之外保留一棵真实的上下文目录树。向量库负责“哪些节点语义相关”，文件系统负责“内容是什么、位于哪里、与谁相邻”。检索层再把两者组合起来。

这也是 `viking://` 和 L0/L1/L2 的作用：它们不是展示层包装，而是写入、浏览、检索和按需加载共同遵守的数据模型。

## 3. 先看运行形态：Server 是核心运行时

OpenViking 的常见生产形态是一个独立 HTTP 服务：

```text
Agent / 插件 / ov CLI / Python SDK / MCP 客户端
                         │
                         ▼
              openviking-server :1933
                         │
              FastAPI Router / MCP Endpoint
                         │
                 OpenVikingService
                         │
        ┌────────────────┼────────────────┐
        ▼                ▼                ▼
   业务 Service      异步任务队列      存储与模型
```

安装包暴露三个主要入口：

| 命令 | 实际职责 |
| --- | --- |
| `openviking-server` | 初始化、诊断并启动 OpenViking HTTP 服务 |
| `ov` / `openviking` | Rust CLI；作为客户端调用服务端 |
| `vikingbot` | 启动或操作构建在 OpenViking 之上的 Agent 框架 |

不要把 `ov` CLI 和 Server 混在一起理解。执行 `ov find` 时，真正完成检索的是正在运行的 Server；CLI 负责读取客户端配置、发送请求并打印结果。

Agent 插件也不是数据库本体。Claude Code、Codex、pi、OpenCode 等集成负责监听各自宿主的生命周期，再调用同一个 OpenViking 服务。

### 3.1 Agent 平台还有一层运行时：每个 CLI Agent 的伴生 daemon

官方 Agent Runtime 文章讨论的是怎样把原本面向“一个人、一个终端”的 CLI Agent 变成可被平台管理的长期运行单元。它建议为每个命名 Agent 配一个伴生 daemon：

```text
                         Agent Platform Server
                    用户、路由、频道、任务、权限
                         │              ▲
           agent:deliver │ WebSocket    │ 平台 API / MCP 工具
                         ▼              │
              ┌──────────────────────┐
              │ Agent A 的 daemon    │
              │ 启停 CLI、保存 session │
              └──────────┬───────────┘
                         │ stdin / stdout
                         ▼
                   Claude/Codex/... CLI

              ┌──────────────────────┐
              │ Agent B 的 daemon    │
              └──────────┬───────────┘
                         ▼
                     另一个 CLI
```

这里各部分的职责不能混：

| 部分 | 负责什么 |
| --- | --- |
| Platform Server | 接收用户或 Agent 消息，选择目标 Agent，管理任务和权限 |
| 每 Agent 一个 daemon | 启动对应 CLI、翻译输入输出协议、保存 session ID、处理空闲退出和恢复 |
| CLI Agent | 实际执行模型回合和工具调用 |
| OpenViking Server | 给所有 Agent 提供共享、可检索、可审计的持久上下文 |

所以“伴生”不是 OpenViking 为每个 Agent 启动一个数据库进程。通常仍然只有共享的 OpenViking Server；每个 Agent 的 daemon 或插件带着自己的身份和凭据访问它。

### 3.2 daemon 怎样接不同 CLI

daemon 通过很薄的 runtime driver 吸收不同 CLI 的协议差异。driver 至少需要知道：

```text
怎样启动 CLI
→ 怎样把 prompt 编码到 stdin
→ 怎样解析 stdout 事件
→ 怎样保存和恢复 session
→ Agent 忙碌时新消息能否直接投递
```

官方文章归纳了三类协议：

| 协议族 | 示例 | 忙碌时的典型投递方式 |
| --- | --- | --- |
| stream-json | Claude、Cursor | 先保存为通知，由 Agent 通过工具检查 |
| ACP / JSON-RPC | Codex、Hermes、OpenCode、Coco | 由 driver 决定；文中 Codex、Hermes 支持直接写入当前回合 |
| 自定义 JSON 事件 | Copilot、Gemini | 当前回合结束后再用排队消息重启 |

Platform Server 无须知道这些细节。它统一发出 `agent:deliver`；对应 daemon 的 driver 决定消息进入当前进程、进入 inbox，还是触发 session resume。

### 3.3 OpenViking 接在 daemon 的哪一侧

OpenViking 有两个接入面：

1. Agent/runtime 侧：在启动或提交 prompt 前召回相关上下文，在运行中捕获消息和工具结果，在 compaction、reset 或 sleep 前提交可持久化内容；
2. Platform/server 侧：绑定 account/user/agent/workspace 身份，签发受限凭据，管理权限、审计、删除和跨 Agent 共享边界。

完整回路是：

```text
Platform 把消息路由到 Agent daemon
→ daemon 驱动 CLI Agent 执行
→ 插件或 MCP 从 OpenViking 召回上下文
→ Agent 产生回答、工具结果和新的稳定事实
→ runtime 将值得保留的交互提交到 OpenViking
→ 后续同一 Agent 或其他获权 Agent 再次召回
```

Agent Runtime 博文给出的是一种平台构建方案，不是运行 OpenViking 的强制前置条件。只想给现有 Claude Code、Codex 或 pi 增加记忆时，安装对应插件并连接 OpenViking Server 即可，不必先实现整套 daemon 平台。

## 4. 整体架构：从接入层到底层存储

按一次请求实际经过的职责，OpenViking 可以分成六层：

```text
┌─────────────────────────────────────────────┐
│ Agent 接入层                                 │
│ hooks / 扩展 / MCP / LangChain / VikingBot  │
└──────────────────────┬──────────────────────┘
                       │ HTTP / MCP
┌──────────────────────▼──────────────────────┐
│ 传输层：FastAPI routers、鉴权、用户上下文      │
└──────────────────────┬──────────────────────┘
                       │ RequestContext
┌──────────────────────▼──────────────────────┐
│ Service 层                                  │
│ Resource / Search / Session / FS / Relation │
└──────────────┬───────────────┬──────────────┘
               │               │
┌──────────────▼─────┐ ┌───────▼──────────────┐
│ 处理与检索层         │ │ 队列与后台任务层        │
│ parse / retrieve    │ │ resource / semantic  │
│ memory extraction  │ │ session commit       │
└──────────────┬─────┘ └───────┬──────────────┘
               └────────┬──────┘
┌───────────────────────▼─────────────────────┐
│ VikingFS：统一文件操作与索引同步              │
└──────────────────┬──────────────┬───────────┘
                   ▼              ▼
             AGFS 内容存储      向量索引
```

各层的边界如下：

| 层 | 收到什么 | 负责什么 | 产出什么 |
| --- | --- | --- | --- |
| Agent 接入层 | 宿主事件、prompt、回答和工具调用 | 决定何时 recall、capture、commit | HTTP/MCP 请求与注入上下文 |
| 传输层 | 网络请求和凭据 | 路由、鉴权、错误映射、构造 `RequestContext` | 带 account/user 身份的业务调用 |
| Service 层 | 已校验业务参数 | 编排资源、搜索、会话、文件和关系操作 | 立即结果或异步 `task_id` |
| 处理与检索层 | 原始资料、查询或归档会话 | 解析、语义生成、层级召回、记忆提取 | 文件树、候选上下文、记忆变更 |
| 队列层 | 可持久化的处理消息 | 把慢任务移出 HTTP 热路径，并跟踪状态 | 完成、失败或可查询的任务状态 |
| 存储层 | 正文、元数据和向量 | 保存权威内容并维护检索索引 | 可读文件和可搜索节点 |

`OpenVikingService` 是组合根。它初始化 VikingFS、向量库、模型、队列和处理器，再把这些依赖注入各个子 Service。它不是一个包办全部业务的大函数；HTTP Router 也不会直接操作底层文件。

## 5. 三个核心概念

### 5.1 Viking URI：稳定定位上下文

典型目录如下：

```text
viking://
├── resources/                       # 共享资源
└── user/{user_id}/
    ├── resources/                   # 用户私有资源
    ├── memories/                    # 长期记忆
    ├── skills/                      # 用户技能
    ├── sessions/{session_id}/       # 会话与归档
    └── peers/{peer_id}/             # 与特定对象相关的上下文
```

URI 同时承担定位和隔离职责。客户端看到的 `viking://user/...` 会结合当前请求用户规范化；它不是让调用方随意指定另一个用户的本地路径。

### 5.2 Resource、Memory、Skill：来源不同，检索体系相同

| 类型 | 来源 | 典型内容 | 主要写入入口 |
| --- | --- | --- | --- |
| Resource | 外部资料 | 文档、源码、网页、图片 | `add-resource` / Resource API |
| Memory | 会话沉淀或显式记录 | 偏好、实体、事件、案例、经验 | `session.commit()` / memory API |
| Skill | 导入或演化得到 | `SKILL.md`、操作说明 | skill API / Agent Evolution |

三者不是三套互不相干的数据库。它们进入不同的 URI 根目录，但都可以生成语义信息、建立索引并被检索。

### 5.3 L0、L1、L2：同一内容的三个读取深度

每个上下文目录可以提供两个语义 sidecar，目录中的普通文件作为 L2 内容：

- L0：`.abstract.md`，一句摘要，用于快速判断相关性；
- L1：`.overview.md`，结构和核心信息，用于决定是否继续深入；
- L2：目录内的原始文件或完整内容，用于真正完成任务。

目录也有 L0/L1，所以 Agent 不必先读取整个目录下的全部文件，才能知道这里是否相关。

这里容易误解的一点是：L0/L1 不是为每个普通文件创建的同名伴生文件，也不是每次查询临时生成。资源写入后的异步语义处理会汇总文件摘要，生成目录级摘要和概览；检索时按需要读取已有产物。

## 6. 最小可运行实践

需要 Python 3.10 或更高版本：

```bash
pip install --upgrade openviking
openviking-server init
openviking-server doctor
openviking-server
```

另开终端验证：

```bash
ov status
ov add-resource https://github.com/volcengine/OpenViking --wait
ov tree viking://resources/ -L 2
ov find "OpenViking 怎样组织上下文"
```

`--wait` 的意义不是让上传本身同步，而是让 CLI 等待后台解析、语义生成和索引处理完成。省略它时，请求通常先返回 `task_id`，资源可能暂时还不能被完整检索。

最小排错顺序：

```text
ov status
→ Server 是否可达
→ add-resource 返回的 task 是否完成
→ tree/ls 是否已有文件树
→ find 是否能命中
```

不要只看 `add-resource` 请求返回成功就认定索引已经可用。

## 7. 第一条纵向链路：资源怎样进入上下文库

### 7.1 入口：Router 只做协议适配

CLI、SDK 或 MCP 请求进入 FastAPI/MCP 端点后，传输层解析参数和身份，再调用 `ResourceService.add_resource()`。业务入口收到的关键输入包括：

- 来源 `path`：本地文件、URL、Git 仓库等；
- 目标 `to` 或父目录 `parent`；
- 是否等待 `wait`；
- 是否建立索引、生成摘要；
- 解析模式、标签、监控刷新周期等。

`RequestContext` 中的 account/user 会参与默认目标目录和权限判断。多租户隔离不是 CLI 拼 URI 后才补的一层过滤。

### 7.2 路由：不同来源先走不同获取方式

`ResourceService` 会验证参数并选择处理路线：

```text
显式 Connector 类型 → 委托 Connector
Git URL            → Git 获取/持久队列路线
普通文件或 URL      → 标准资源处理路线
```

带临时凭据的 Git 请求不会把凭据直接放进持久队列；源码会先在当前请求内消费凭据并准备无凭据的后处理载荷。这是“异步任务可持久化”和“敏感凭据不落队列”之间的边界。

### 7.3 获取与解析：先还原内容结构，不调用 LLM 做理解

Accessor 负责拿到原始数据，Parser 负责按格式转换。不同格式会进入 Markdown、文本、PDF、HTML、代码仓库和媒体等解析器。

解析阶段的目标是得到结构化文件树和临时产物，不是生成最终摘要。代码仓库还会遵循忽略规则，并从支持的语言中提取代码骨架。

```text
来源
→ Accessor 获取内容
→ Parser 识别格式并拆分
→ 临时 VikingFS 目录
→ TreeBuilder 确定最终 URI 元数据
```

### 7.4 提交：内容进入 AGFS，慢处理进入队列

TreeBuilder 确定最终位置后，资源内容提交到文件存储；随后创建后台消息，交给语义处理器继续生成 L0/L1 和向量。

当前源码中的重要边界是：TreeBuilder 负责建立最终 URI 元数据，不负责把所有后续工作都做完；语义生成和向量写入由后台处理器承担。

### 7.5 语义处理：自底向上生成目录认知

系统先总结叶子文件内容，父目录再根据文件摘要和子目录信息生成自己的概览与摘要：

```text
叶子文件内容摘要（作为聚合输入）
→ 当前目录 overview
→ 当前目录 abstract
→ 父目录重复同一过程
→ 节点向量写入索引
```

自底向上的原因很直接：父目录的概览必须建立在已经处理过的子内容上。

### 7.6 完成状态：内容写入和“可完整检索”不是同一时刻

不带 `wait` 时，调用方拿到的是已接受的任务，而不是所有处理已经完成。带 `wait` 时，`ResourceService` 通过 `TaskTracker` 等待任务进入 completed、failed 或 cancelled。

因此资源链路需要分别观察：

1. 请求是否被接受；
2. 原始内容是否已经写入；
3. 语义产物是否生成；
4. 向量索引是否完成；
5. 任务最终状态是否成功。

## 8. 第二条纵向链路：新问题怎样取回上下文

OpenViking 有两个容易混淆的入口：

| 入口 | 是否使用会话上下文 | 是否做意图分析 | 适合场景 |
| --- | --- | --- | --- |
| `find()` | 否 | 否 | 已经明确的单一语义查询 |
| `search()` | 可选 | 默认会 | 需要结合近期对话理解的复杂任务 |

### 8.1 find：直接检索

`SearchService.find()` 验证查询和目标 URI 后，直接把查询交给 VikingFS。它延迟较低，适合“查 OAuth 配置”这类意图明确的问题。

### 8.2 search：先结合会话理解需要什么

`SearchService.search()` 在启用 intent 且提供 Session 时，会先读取会话搜索上下文，再生成若干 `TypedQuery`。每个查询携带目标类型、意图和优先级，因此一个任务可以同时寻找 Skill、Resource 和 Memory。

意图分析是可关闭的。关闭后，系统直接使用原查询，也会跳过不再需要的 Session 扫描。它不是语义检索必须经过的固定 LLM 调用。

### 8.3 层级检索：先定位入口，再向目录内部推进

检索的主过程是：

```text
TypedQuery 或原查询
→ 根据类型/target_uri 确定搜索范围
→ 全局向量搜索得到起始节点
→ Rerank 评估候选
→ 优先队列递归搜索高分目录的子节点
→ 收敛或达到限制
→ 形成 MatchedContext
```

关键点不是“先固定搜 L0，再固定读 L1，最后固定读 L2”这么简单。L0/L1 为节点提供渐进信息；真正的搜索控制由向量候选、目录结构、分数、精排和停止条件共同决定。

### 8.4 向量库返回位置，AGFS 返回权威内容

向量索引保存 URI、父 URI、摘要、类型、层级和向量等检索字段。完整正文仍从 AGFS 读取。

所以一次正确召回可以概括为：

```text
向量索引回答“去哪里找”
→ VikingFS/AGFS 回答“那里实际保存了什么”
→ 上下文组装器决定“本次带回多少”
```

### 8.5 上下文组装：召回结果不等于最终 prompt

Agent 集成使用的 context/recall 路线还会做正文收集、层级降级、token 预算和跨轮去重。可选的查询扩展和 digest 压缩是两个独立阶段。

因此关闭额外 LLM 阶段后，语义检索和预算控制仍然存在；只是少了查询扩展或结果重写，不能把它理解成“关闭了 OpenViking 检索”。

## 9. 第三条纵向链路：一段 Session 怎样变成长期记忆

### 9.1 Agent 必须先把真实交互交给 OpenViking

OpenViking 不会自动知道任意 Agent 内部发生了什么。接入插件需要上传：

- user/assistant 消息；
- 图片、上下文引用等结构化 part；
- 工具调用和结果；
- 本轮实际使用过的上下文或 Skill；
- 何时应该 commit。

这解释了为什么 Server 正常、手动 `find` 正常，仍不能证明某个 Agent 已具备长期记忆：宿主侧 capture 和 commit 也必须正常。

### 9.2 commit 分同步归档和异步提取两阶段

`session.commit()` 先完成不可丢的状态切换，再把慢工作交给后台：

```text
同步阶段：
当前消息
→ 写入新的 history/archive_NNN/messages.jsonl
→ 清空当前消息区
→ 返回 archive_uri + task_id

异步阶段：
归档消息
→ 生成 archive 的 abstract/overview
→ 按记忆策略提取候选
→ 查找相似旧记忆
→ skip / create / merge / delete
→ 写入记忆并建立索引
→ 写 memory_diff.json 和 .done
```

“commit 已接受”只证明同步归档完成并创建了后台任务；长期记忆是否已经更新，要继续查询 task 状态。

### 9.3 记忆不是对话摘要的另一个名字

会话归档摘要描述“这次对话发生了什么”；长期记忆保存“后续交互仍有价值的内容”。两者生命周期和用途不同。

OpenViking 可以管理 profile、preferences、entities、events、identity、soul、cases、trajectories、experiences 等类型。记忆策略决定启用哪些类型，提取器再基于 schema 生成候选。

### 9.4 更新旧记忆前需要去重和冲突决策

候选记忆不会无条件新建文件。系统先用向量召回相似项，再让模型判断：

- `skip`：候选重复，不写入；
- `create`：创建新记忆；
- `merge`：更新已有项；
- `delete`：删除已经冲突或失效的项；
- `none`：不创建候选，只处理已有项。

这一步决定长期记忆会不会不断堆积近义内容。

### 9.5 memory_diff 是审计结果

每次提交的新增、更新和删除会写入归档目录的 `memory_diff.json`。它让“模型到底改了哪些长期记忆”成为可检查的数据，而不是只保留最后状态。

## 10. Agent 集成真正负责什么

所有集成都连接同一个 Server，但宿主能力不同：

| 接入方式 | 适合对象 | 主要职责 |
| --- | --- | --- |
| 生命周期插件/扩展 | Claude Code、Codex、pi、OpenCode 等 | 自动召回、逐轮捕获、阈值或结束时 commit |
| MCP | 支持 MCP 的通用客户端 | 暴露浏览、检索、写入工具；自动生命周期能力取决于客户端 |
| LangChain/LangGraph | 自己开发 Agent 应用 | 以 retriever、store、middleware 等组件接入 |
| VikingBot | 使用 OpenViking 自带 Agent 框架 | 在同一部署中直接消费上下文能力 |

### 10.1 一次典型 Agent 回合

```text
用户发出 prompt
→ 插件根据 prompt 和会话状态请求 recall
→ OpenViking 返回预算内上下文
→ 插件把结果注入模型输入
→ Agent 调用模型和工具
→ 插件捕获 user/assistant/tool parts
→ 达到策略条件后 commit
→ Server 异步更新长期记忆
```

### 10.2 pi 集成的特殊边界

pi 不使用 MCP，而是通过原生扩展 API 接入。扩展在每个 prompt 前召回、每个 turn 后捕获，并提供 `viking_search`、`viking_read`、`viking_remember` 等原生工具。

它还支持 context takeover：已 commit 的旧历史可以由 OpenViking archive overview 替换，只保留近期 live tail。takeover 失败时采用 fail-open 行为——保留完整本地历史或回退到 pi 默认 compaction，避免上下文丢失。

## 11. 存储层：为什么是 AGFS + 向量索引

OpenViking 把内容与索引分开：

| 存储 | 保存什么 | 是否是正文权威来源 |
| --- | --- | --- |
| AGFS | L0/L1/L2、消息、关系、归档和审计文件 | 是 |
| 向量库 | URI、父 URI、类型、摘要、向量和过滤字段 | 否 |

`VikingFS` 位于两者之上，统一实现 `ls/read/mv/rm/search` 等操作，并负责在移动或删除文件时同步索引。

这条边界很重要：向量记录损坏时可以从内容重建；如果把向量库当作正文唯一来源，文件系统浏览、恢复和一致性检查都会失去可靠依据。

本地部署可使用本地文件与本地向量后端；生产部署也可以换成 S3 兼容内容存储、HTTP 向量服务或 VikingDB。后端变化不改变上层的 Viking URI 和 Service 接口。

## 12. 失败边界与排错方法

### 12.1 资源能浏览，但语义搜索不到

说明内容可能已写入 AGFS，但语义任务或向量写入尚未完成。检查 `task_id`、后台队列和模型配置，不要先怀疑 Parser。

### 12.2 find 正常，search 慢或失败

优先区分直接向量检索与额外的意图分析/Rerank。`find` 正常至少说明基本索引路线可用；`search` 还可能依赖 query planner、Session 上下文和 rerank 模型。

### 12.3 Agent 能手动搜索，但没有自动记忆

依次确认插件是否加载、每轮是否 capture、是否触发 commit、commit task 是否完成。服务端已有资源和自动记录会话是两条独立能力。

### 12.4 commit 返回成功，但新记忆立刻查不到

检查返回状态是否只是 `accepted`。归档同步完成后，摘要、提取、去重和索引仍在后台执行。

### 12.5 删除或移动后出现旧结果

AGFS 是权威内容，向量库是派生索引。检查 VikingFS 的同步操作与索引一致性；不要只手工修改某一个后端。

## 13. 阅读源码的最短路线

先沿三条调用链读，不要从所有 parser 或 memory 类型开始：

### 13.1 服务启动

```text
pyproject.toml
→ openviking_cli/server_bootstrap.py
→ openviking/server/app.py
→ openviking/service/core.py
```

看清 Server 怎样创建 `OpenVikingService`、初始化基础设施并注册 Router。

### 13.2 资源写入

```text
openviking/server/routers/resources.py
→ openviking/service/resource_service.py
→ openviking/parse/
→ openviking/parse/tree_builder.py
→ openviking/storage/queuefs/add_resource_processor.py
```

重点区分来源获取、结构解析、内容提交、语义生成和索引写入。

### 13.3 检索

```text
openviking/server/routers/search.py
→ openviking/service/search_service.py
→ openviking/storage/viking_fs/_semantic.py
→ openviking/retrieve/intent_analyzer.py
→ openviking/retrieve/hierarchical_retriever.py
→ openviking/retrieve/context_assembler/
```

重点看 `find` 与 `search` 的差异，以及 MatchedContext 怎样变成预算内上下文。

### 13.4 会话与记忆

```text
openviking/server/routers/sessions.py
→ openviking/service/session_service.py
→ openviking/session/session.py
→ openviking/storage/queuefs/session_commit_processor.py
→ openviking/session/compressor_v3.py
→ openviking/session/memory/
```

重点区分同步归档、异步摘要、记忆候选提取和最终更新。

## 14. 总结

理解 OpenViking，只需要抓住四个稳定事实：

1. 它是独立的上下文服务，Agent 插件负责接入时机，Server 负责数据与处理链路；
2. `viking://` 文件树是上下文的权威组织方式，向量库只是帮助定位节点的派生索引；
3. Resource、Memory、Skill 来源不同，但共享 L0/L1/L2、目录浏览和语义检索体系；
4. 写入资源、检索上下文、提交会话是三条可独立成功或失败的链路，排错时必须分开验证。

如果只记一条完整主线，可以记成：

```text
外部资料和 Agent 会话
→ 进入 viking:// 文件树
→ 生成分层语义与向量索引
→ 在新任务中按目录和预算召回
→ Agent 使用结果继续工作
→ 新交互再次提交并更新长期记忆
```
