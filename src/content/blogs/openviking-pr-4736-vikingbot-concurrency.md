---
title: "OpenViking PR #4736：VikingBot 跨会话有界并发实现报告"
description: 从事件循环、消息队列、Task 调度、会话锁与全局 semaphore，拆解 VikingBot 的跨会话并发实现。
pubDate: 2026-09-06
category: 技术向
tags: [OpenViking, Memory, PR]
toc: true
search: true
draft: false
---


> 对应 PR：[feat(bot): process independent sessions concurrently #4736](https://github.com/volcengine/OpenViking/pull/4736)  
> 关联 Issue：[[Feature]: Process independent VikingBot sessions concurrently #4735](https://github.com/volcengine/OpenViking/issues/4735)  

## 1. 本质总结

VikingBot 通常在一个进程中创建一个 `asyncio` 事件循环，并在这个事件循环里运行一个共享的 `AgentLoop` 实例。所有已启用 channel——例如飞书、Telegram、Slack、Discord 和 OpenAPI——共用一个 `MessageBus`；它们收到的消息都进入同一个 inbound 队列，再由同一个 `AgentLoop.run()` 消费。

PR 修改前，`AgentLoop.run()` 从队列取出一条消息后，会直接 `await _process_message(msg)`。`await` 不会阻塞整个事件循环，但会暂停唯一负责消费 inbound 队列的 `AgentLoop.run()` Task。因此当前消息没有完整处理结束以前，`run()` 不会再取下一条消息。即使下一条消息来自另一个 app、另一个 channel 或另一个会话，也只能继续留在同一个队列里。系统在消息处理层面是全局串行的。

PR 修改后，队列结构没有变化：仍是单 inbound 队列、单消费循环和单一 `AgentLoop` 实例。改变的是消费循环不再负责把每条消息处理到底，而是通过 `asyncio.create_task()` 把每条消息注册成独立 Task，然后立即回到队列继续取消息。不同 Task 在同一个事件循环中运行；当一个 Task 等待模型、网络、工具或存储时，事件循环可以继续执行其他消息 Task。

单纯使用 `create_task()` 会让所有消息无约束地并发，也会让同一会话的两条消息同时读写历史。因此 PR 又增加两层约束：每个 `SessionKey` 使用一把 `asyncio.Lock`，保证同一会话一次只处理一条消息；所有会话共享一个 `asyncio.Semaphore`，限制全局最多同时处理 `message_max_concurrency` 条消息，当前默认值为 4。

最终运行规则是：

```text
inbound 消息队列：1（outbound 回复仍使用另一条独立队列）
AgentLoop 实例：1
消费循环：1
消息处理 Task：多个

同一个 SessionKey：最多运行 1 条消息
全部 SessionKey 合计：默认最多运行 4 条消息
```

这不是多线程并行，也不是为每个 app 新建一个 Agent。它是在同一个 `asyncio` 事件循环中，把原来绑定在消费循环里的消息处理拆成多个可独立调度的异步 Task，再分别约束会话顺序和全局并发量。

## 2. PR 的结果与边界

PR 最终修改 3 个文件，新增 150 行、删除 22 行：

| 文件 | 职责 |
| --- | --- |
| `bot/vikingbot/agent/loop.py` | 把逐条等待改成 Task 调度；增加会话锁、全局 semaphore、任务追踪和停机 drain |
| `bot/vikingbot/config/schema.py` | 增加 `bot.agents.message_max_concurrency`，默认 4，最小值 1 |
| `bot/vikingbot/tests/unit/test_agent_message_concurrency.py` | 验证配置、跨会话并发、同会话顺序和停机等待 |

以下结构没有改变：

- 没有为不同 app 创建不同 `AgentLoop`；
- 没有把全局 inbound 队列拆成每 app 或每 session 一个队列；
- 没有改 channel 如何接收和发送消息；
- 没有改 `_process_message()` 内部的模型调用、工具调用和会话持久化流程；
- 没有修改 per-channel 的 `max_concurrent_requests`；
- 没有把消息并发与 subagent 并发合并成同一个配置。

这个 PR 修改的 seam 很窄：只改变“`AgentLoop` 从队列拿到消息以后，怎样安排它执行”。

## 3. 修改前的运行形态

### 3.1 一个进程只创建一个事件循环

Gateway 入口最终执行：

```python
asyncio.run(run())
```

`asyncio.run()` 为这次运行创建事件循环。`run()` 再把 Cron、Heartbeat、CompileService、ChannelManager、`AgentLoop` 和 Uvicorn 一起交给 `asyncio.gather()`：

```python
tasks = [
    cron.start(),
    heartbeat.start(),
    compile_service.start(),
    channels.start_all(),
    agent_loop.run(),
    server.serve(),
]
await asyncio.gather(*tasks)
```

因此更准确的层级关系是：

```text
一个 VikingBot Gateway 进程
└── 一个 asyncio 事件循环
    ├── CronService Task
    ├── Heartbeat Task
    ├── CompileService Task
    ├── ChannelManager Task
    ├── AgentLoop.run() Task
    └── Uvicorn Server Task
```

`AgentLoop` 不是事件循环。`AgentLoop.run()` 是事件循环中的一个长期运行 Task。

### 3.2 多个 channel 共用一个 MessageBus

Gateway 先创建一次 `MessageBus`：

```python
bus = MessageBus()
```

然后把同一个 `bus` 同时传给 `AgentLoop` 和 `ChannelManager`。`ChannelManager` 再把它传给每个具体 channel：

```text
Telegram ─┐
Feishu ───┤
Slack ────┤
Discord ──┼──→ MessageBus.inbound ──→ AgentLoop.run()
OpenAPI ──┤
Bot API ──┘
```

`MessageBus` 内部的 inbound 仍然只是一个标准 `asyncio.Queue`：

```python
self.inbound: asyncio.Queue[InboundMessage] = asyncio.Queue()

async def publish_inbound(self, msg):
    await self.inbound.put(msg)

async def consume_inbound(self):
    return await self.inbound.get()
```

所以“多个 app 接入 VikingBot”不代表每个 app 有自己的 Agent 队列。它们共享同一个消息入口。

### 3.3 单一 AgentLoop 实例

Gateway 只调用一次 `prepare_agent_loop(...)`：

```python
agent_loop = prepare_agent_loop(config, bus, session_manager, cron)
```

`prepare_agent_loop()` 内部只构造一个 `AgentLoop`：

```python
agent = AgentLoop(
    bus=bus,
    provider=provider,
    session_manager=session_manager,
    config=config,
    ...,
)
```

这个实例负责所有 channel、app 和 session 的 Agent 执行。并发能力不是通过增加 AgentLoop 实例获得的。

## 4. 修改前为什么是全局串行

修改前的核心逻辑可以缩减为：

```python
while self._running:
    msg = await self.bus.consume_inbound()
    response = await self._process_message(msg)
    await self.bus.publish_outbound(response)
```

假设队列中依次进入三条消息：

```text
A1：飞书 App A，群聊 1
B1：Slack App B，私聊 7
A2：飞书 App A，群聊 1
```

实际执行顺序是：

```text
run() 取出 A1
run() 等待 A1 的模型调用、工具调用、保存和回复全部结束
run() 取出 B1
run() 等待 B1 全部结束
run() 取出 A2
```

这里最容易误解的是 `await`。

`await _process_message(A1)` 不会把整个 asyncio 事件循环卡死。A1 等模型时，Cron、Heartbeat、Uvicorn 等其他 Task 仍可运行。但是负责继续读取 inbound 队列的唯一 Task 就是 `AgentLoop.run()`，而它正在等待 A1 完成。因此 B1 无法进入消息处理阶段。

问题的本质不是“asyncio 不能并发”，而是代码把“消费下一条消息”放在了“当前消息完整结束”之后。

## 5. `create_task()` 怎样解除全局串行

PR 把消费循环改为：

```python
msg = await self.bus.consume_inbound()

task = asyncio.create_task(
    self._process_queued_message(msg, session_lock)
)
self._message_tasks.add(task)
```

`asyncio.create_task(coroutine)` 做两件事：

1. 把 coroutine 包装成一个可由事件循环独立调度的 Task；
2. 立即返回 Task 对象，不等待 coroutine 完整结束。

所以 `AgentLoop.run()` 可以继续执行下一轮 `consume_inbound()`：

```text
run() 取出 A1，创建 Task A1
run() 取出 B1，创建 Task B1
run() 取出 A2，创建 Task A2
```

这些 Task 不一定在 `create_task()` 返回的瞬间立即执行。事件循环会在当前 Task 遇到 `await`、完成或主动让出执行权时选择其他可运行 Task。一个常见时序是：

```text
run() 创建 Task A1
run() 在下一次 consume_inbound() 处等待
Task A1 开始执行
Task A1 在模型请求处 await
run() 取出 B1 并创建 Task B1
Task B1 开始执行
Task B1 在工具或网络请求处 await
模型 A1 返回，Task A1 继续
```

因此 `create_task()` 带来的不是 CPU 并行，而是让多个消息 Task 可以在等待异步 I/O 时交错推进。

如果 `_process_message()` 内部执行长时间纯 CPU 代码且不出现 `await`，它仍会占用事件循环，其他消息 Task 也无法运行。这个 PR 解决的是 VikingBot 的主要等待路径：模型请求、网络、异步工具和异步存储。

## 6. 什么决定“不同会话”

并发和串行的身份边界不是 app 名称，也不是 `sender_id`，而是 `SessionKey`：

```python
class SessionKey(BaseModel):
    model_config = ConfigDict(frozen=True)
    type: str
    channel_id: str
    chat_id: str

    def __hash__(self):
        return hash((self.type, self.channel_id, self.chat_id))
```

三个字段共同决定一段会话：

| 字段 | 含义 |
| --- | --- |
| `type` | channel 类型，例如 `feishu`、`slack`、`telegram`、`openapi` |
| `channel_id` | 具体 app、bot 或 channel 配置实例 |
| `chat_id` | 该 app 内的具体群聊、私聊或 API 会话 |

例如：

```text
Session A1 = (feishu, app-a, group-1)
Session A2 = (feishu, app-a, group-2)
Session B1 = (feishu, app-b, group-1)
Session C1 = (slack, bot-c, dm-7)
```

这四个 `SessionKey` 都不同，因此可以并发。

同一个 app 的不同 `chat_id` 也属于不同 session，可以并发。只有 `type + channel_id + chat_id` 完全相同的消息才共享顺序约束。

`SessionKey` 被声明为 frozen，并显式实现了 `__hash__()`，所以它可以安全地作为字典 key，用于查找对应的 session lock 和引用计数。

## 7. 第一层控制：同一会话严格串行

### 7.1 为每个 SessionKey 取得同一把锁

消费循环在创建 Task 前先取得该会话对应的 `asyncio.Lock`：

```python
session_lock = self._session_locks.setdefault(
    msg.session_key,
    asyncio.Lock(),
)
```

对于相同 `SessionKey`：

- 第一条消息创建锁并保存；
- 后续消息从字典取得同一个锁；
- 不同 `SessionKey` 使用不同锁。

消息 Task 真正执行时先进入：

```python
async with session_lock:
    ...
```

如果锁已被同会话的上一条消息持有，当前 Task 会暂停，直到上一条释放锁。

### 7.2 为什么同一会话不能并发

`_process_message()` 会读取当前 session 历史、追加用户消息和助手回复，并保存 session。如果同一会话的 A1、A2 同时运行，可能出现：

```text
A1 读取历史 H
A2 也读取历史 H
A2 先写入或保存
A1 后写入或保存
```

最终上下文顺序、回复顺序和持久化结果都可能与消息到达顺序不一致。

因此同一会话的目标不是提高并发，而是维持以下执行顺序：

```text
A1 获得 lock
A2 等待 lock
A1 完成模型、工具、保存和回复
A1 释放 lock
A2 获得 lock
A2 开始读取包含 A1 结果的最新历史
```

锁覆盖的是整次 `_process_message()` 和最终 outbound 发布，不只是 session 保存那一小段。这样 A2 不会在 A1 的回复尚未完成时提前开始。

## 8. 第二层控制：全局最大并发数

### 8.1 配置和初始化

PR 在 `AgentsConfig` 中增加：

```python
message_max_concurrency: int = Field(
    default=4,
    ge=1,
    description="Maximum number of inbound messages processed at once.",
)
```

`AgentLoop` 初始化时用它创建 semaphore：

```python
self._message_semaphore = asyncio.Semaphore(
    message_max_concurrency
)
```

semaphore 内部维护可用名额。默认有 4 个名额：

- Task 进入 `async with semaphore` 时占用一个；
- Task 离开时归还一个；
- 4 个名额全部占用后，其他 Task 等待；
- 任一正在运行的消息结束后，下一个等待 Task 获得名额。

所以 Task 数量可以多于 4，但同时进入 `_process_message()` 的消息最多 4 条。

这里限制的是“正在执行的消息数”，不是“已创建 Task 总数”或“队列长度”。消费循环仍会继续从 inbound 取消息并创建等待中的 Task，因此短时间积压时，`_message_tasks` 可以超过 4。这个 PR 没有增加队列背压或待处理 Task 数量上限；如果后续需要限制内存中的等待任务，应单独设计接收背压，不能把 semaphore 的执行上限误当成队列容量。

### 8.2 两层约束组合后的规则

完整处理入口是：

```python
async with session_lock:
    async with self._message_semaphore:
        response = await self._process_message(msg)
```

它表达两个同时成立的条件：

```text
条件 1：当前 SessionKey 没有其他消息正在处理
条件 2：全局还有消息并发名额
```

只有两个条件都满足，消息才会进入 `_process_message()`。

### 8.3 为什么先取得 session lock，再取得 semaphore

锁顺序是：

```text
session lock → global semaphore
```

这个顺序很重要。假设全局上限为 2，队列里依次有：

```text
A1：Session A
A2：Session A
B1：Session B
```

当前实现的结果是：

```text
A1：取得 Session A lock，占用 semaphore 名额 1，开始
A2：等待 Session A lock，不占用 semaphore
B1：取得 Session B lock，占用 semaphore 名额 2，开始
```

所以实际并发运行的是 A1 和 B1，A2 保持同会话顺序。

如果反过来先取得 semaphore：

```text
global semaphore → session lock
```

就可能出现：

```text
A1：占用名额 1并运行
A2：占用名额 2，但等待 Session A lock
B1：没有名额，只能等待
```

此时 A2 虽然不能执行，却占用了全局名额，导致独立的 Session B 也无法运行。PR 选择先锁 session，是为了让同会话排队消息不消耗全局执行名额。

## 9. 完整消息调度链

### 9.1 消息进入系统

```text
外部 app/channel 收到消息
→ 构造 InboundMessage(session_key=...)
→ MessageBus.publish_inbound()
→ 放入唯一 inbound asyncio.Queue
```

### 9.2 AgentLoop 只负责接收并派发

```text
AgentLoop.run()
→ consume_inbound() 取出一条消息
→ 根据 SessionKey 取得 session lock
→ 增加该锁的用户计数
→ create_task(_process_queued_message(...))
→ 把 Task 放进 _message_tasks
→ 立即回到 consume_inbound()
```

### 9.3 独立 Task 执行两层准入

```text
_process_queued_message(msg, session_lock)
→ 等待 session lock
→ 等待 global semaphore
→ _process_message(msg)
   ├─ 读取或创建 session
   ├─ 构建上下文
   ├─ 调用模型
   ├─ 执行工具
   ├─ 更新并保存 session
   └─ 生成 OutboundMessage
→ publish_outbound(response)
→ 释放 semaphore
→ 释放 session lock
```

### 9.4 回复回到对应 channel

```text
MessageBus.outbound
→ ChannelManager 根据 session_key.channel_key() 路由
→ 对应 app/channel 发送回复
```

出站路由仍使用原有 `type + channel_id`。PR 没有修改回复路由。

## 10. Task 和 session lock 的生命周期

### 10.1 为什么要保存 Task 引用

创建 Task 后，PR 把它加入集合：

```python
self._message_tasks.add(task)
task.add_done_callback(self._message_tasks.discard)
```

`_message_tasks` 有两个作用：

1. 在消息处理期间保留明确的 Task 引用；
2. 停机时知道还有哪些已接收消息尚未完成。

Task 完成后，done callback 会把它从集合移除，避免已结束 Task 持续积累。

### 10.2 为什么还需要 `_session_lock_users`

如果只维护 `_session_locks`，服务见过的每一个 SessionKey 都会永久留下一把锁。长时间运行后，字典会持续增长。

PR 在创建 Task 前增加使用计数：

```python
self._session_lock_users[msg.session_key] = (
    self._session_lock_users.get(msg.session_key, 0) + 1
)
```

每个 Task 无论成功、失败还是被取消，最终都会在 `finally` 中减一：

```python
users = self._session_lock_users[msg.session_key] - 1
if users:
    self._session_lock_users[msg.session_key] = users
else:
    self._session_lock_users.pop(msg.session_key)
    self._session_locks.pop(msg.session_key)
```

计数包含正在持锁的 Task 和等待同一把锁的 Task。只有计数归零，锁才会被删除。因此不会在仍有持有者或等待者时创建第二把锁，破坏同会话串行。

计数增加发生在 `create_task()` 之前，增加和后续 Task 的减一都运行在同一个事件循环线程中，中间没有 `await`，所以这两段字典更新不会彼此交错到一半。

## 11. 停机语义

PR 采用的初始策略是：停止接收新消息，等待已经被 `AgentLoop` 接收并创建 Task 的消息完成。

### 11.1 停止期间刚好取到消息

`stop()` 会把 `_running` 设为 `False`。消费循环从队列返回后会再次检查：

```python
if not self._running:
    await self.bus.publish_inbound(msg)
    break
```

这处理了一个竞态：`run()` 已经在等待队列时，另一个 Task 调用了 `stop()`，随后队列又到达一条消息。该消息会被放回 inbound 队列，不会被当成已接受任务继续处理。

### 11.2 等待已经接受的 Task

`run()` 退出消费循环时执行：

```python
finally:
    self._running = False
    if self._message_tasks:
        await asyncio.gather(*self._message_tasks)
```

这里的边界是：

```text
已经 create_task 的消息：等待完成
仍在 inbound 队列里的消息：不再消费
```

这样可以避免一条消息已经开始调用模型或写 session，却在服务关闭时只完成一半。

Issue 和 PR 都明确把该行为标记为提案语义，而不是维护者已经确认的固定契约。维护者仍可选择立即取消正在运行的消息，或给 graceful drain 增加超时。

reviewer 还指出一个非阻塞改进：当前 `gather()` 没有设置 `return_exceptions=True`。现有 worker 的普通处理和错误回复都已经捕获异常，剩余可抛异常路径很窄；如果未来 worker 增加新的异常出口，可以考虑让一个失败 Task 不影响等待其他 Task 完成。

## 12. 三种容易混淆的并发限制

PR 新增的是消息执行并发，不应与另外两种配置混淆：

| 配置 | 控制对象 | 作用范围 |
| --- | --- | --- |
| channel `max_concurrent_requests` | HTTP/API 请求接入 | 单个 OpenAPI 或 Bot API channel |
| `agents.message_max_concurrency` | `_process_message()` | 单个 AgentLoop 下的所有 channel 和 session |
| `agents.subagent_max_concurrency` | 后台 subagent | Agent 内部派生任务 |

一次 HTTP 请求通过 channel 的接入限制后，消息仍要进入全局 inbound 队列，再等待消息层的 session lock 和 semaphore。

所以 `max_concurrent_requests=100` 不代表可以同时执行 100 个 Agent turn。当前默认最多只有 4 条不同会话消息进入 `_process_message()`。

## 13. 回归测试怎样证明三个行为

新测试先构造上限为 2 的 AgentLoop，并向同一个 inbound 队列依次放入：

```text
a1：Session A
a2：Session A
b1：Session B
```

测试中的 `_process_message()` 会记录开始和结束事件，并停在一个 `asyncio.Event` 上，直到测试主动放行。

### 13.1 证明不同会话可以并发

测试等待两个消息开始后断言：

```python
assert set(events) == {"start:a1", "start:b1"}
```

这证明在全局上限 2 下，Session A 的 a1 和 Session B 的 b1 已同时进入处理函数。

### 13.2 证明同一会话严格串行

a2 与 a1 使用相同 `SessionKey`。如果 session lock 不存在，a2 会抢到第二个 semaphore 名额，开始集合将变成：

```text
start:a1, start:a2
```

实际断言要求第二个开始的是 b1，因此它同时证明：

- a2 被 Session A 的锁挡住；
- a2 没有占用全局 semaphore 名额；
- 独立的 b1 可以使用第二个名额。

最终测试还断言：

```python
assert events.index("end:a1") < events.index("start:a2")
```

这直接验证同一会话的 a2 只有在 a1 完成后才能开始。

### 13.3 证明停机会等待已接受消息

三条消息都已被创建为 Task 后，测试取消 `AgentLoop.run()`：

```python
run_task.cancel()
await asyncio.sleep(0)
assert not run_task.done()
```

如果 `run()` 立即退出，`run_task.done()` 会变成 `True`。实际它仍未结束，因为 `finally` 正在等待消息 Task。

测试随后释放处理事件，确认 a1、a2、b1 都结束，`run()` 才完成取消流程。

### 13.4 配置测试

另一条测试验证：

```python
assert AgentsConfig().message_max_concurrency == 4

with pytest.raises(ValidationError):
    AgentsConfig(message_max_concurrency=0)
```

因此默认值被固定为 4，0 和负数不能进入运行时创建无效 semaphore。

## 14. 最终结论

这次修改没有把 VikingBot 改成多 Agent、多线程或多队列架构。它保留了原有的单进程、单 asyncio 事件循环、单 MessageBus inbound 队列、单消费循环和单一 AgentLoop 实例。

真正的变化只有调度职责拆分：

```text
修改前
AgentLoop.run() = 消费一条消息 + 等待它完整处理 + 再消费下一条

修改后
AgentLoop.run() = 消费消息 + 创建独立 Task + 继续消费
消息 Task = 等 session lock + 等全局名额 + 完整处理消息
```

`create_task()` 解除的是消费循环对单条消息完整生命周期的同步等待；per-session lock 恢复同一会话必须具备的顺序；global semaphore 给跨会话并发设置统一上限。

因此最终行为可以准确表述为：

> VikingBot 仍由一个 AgentLoop 从一个全局队列接收所有 channel 的消息，但消息进入 AgentLoop 后不再全局逐条处理。每条消息被注册为独立 asyncio Task；不同 SessionKey 的 Task 可以在同一事件循环中异步并发，同一 SessionKey 的 Task 通过专属锁按到达顺序执行，所有 SessionKey 再共同受全局 semaphore 限制，默认最多同时执行 4 条消息。
