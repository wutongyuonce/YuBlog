---
title: Claude Code 记忆系统笔记
description: 梳理 Claude Code 的 CLAUDE.md 与 Auto Memory 机制、生命周期、存储结构和排错方法。
pubDate: 2026-08-08
category: 技术向
tags: [Claude Code, Agent Memory]
toc: true
search: true
---

> 来源：官方文档 https://code.claude.com/docs/en/memory （2026 年版本）
> 一句话本质：自动记忆 = 给模型多配了几个指向 `~/.claude/projects/<项目>/memory/` 的文件读写工具。
> "提取记忆"是模型在每轮正常推理时自己完成的，**没有 daemon / 后台线程**。

---

## 一、两套记忆的对比

| | CLAUDE.md 文件 | 自动记忆（Auto Memory） |
|---|---|---|
| 谁写 | 你 | Claude 自己 |
| 内容 | 指令、规则 | 学习到的偏好、纠正、项目上下文 |
| 作用域 | project / user / org 分级 | 按 git 仓库，一个仓库一份（worktree/子目录共享） |
| 加载方式 | 每次会话开头全量注入 | 每次会话开头注入 MEMORY.md 前 200 行 或 25KB（先到先得） |
| 本质 | 上下文，不是强制配置 | 上下文，不是强制配置 |

CLAUDE.md 加载顺序（宽→窄，同一目录内 CLAUDE.local.md 追加在 CLAUDE.md 之后）：
1. Managed policy（机器级，IT 下发，不可排除）：macOS `/Library/Application Support/ClaudeCode/CLAUDE.md`
2. 用户级 `~/.claude/CLAUDE.md` + `~/.claude/rules/`
3. 项目级 `./CLAUDE.md` 或 `./.claude/CLAUDE.md`
4. 本地级 `./CLAUDE.local.md`（默认建议加 .gitignore）

---

## 二、自动记忆的完整生命周期（按时间顺序）

### 阶段 0：配置发现（进程启动）
CLI 按作用域合并设置（managed policy → user → project → local）：
`autoMemoryEnabled`、`autoMemoryDirectory`、`claudeMdExcludes` 等。

### 阶段 1：会话启动加载（launch）
1. CLI 定位 memory 目录：`~/.claude/projects/<项目>/memory/`
   - `<项目>` 由 git 仓库推导 → 同一仓库的所有 worktree / 子目录共享一份记忆；非 git 目录用目录根
   - 可用 `autoMemoryDirectory` 或 `CLAUDE_CODE_PROJECT_DIR_NAME` 改位置
2. 读 `MEMORY.md` 前 200 行 / 25KB（索引），随 CLAUDE.md 一起注入上下文
3. topic 文件（如 `user_role.md`、`feedback_testing.md`）**不预载**，按需读

### 阶段 2：对话主循环（每一轮）
用户输入 → 模型生成 →（可选）调用工具 → 回复。记忆读写就发生在模型自己的工具调用里：

- **写入**：模型判断"这条对未来会话有用"→ Write/Edit 写 topic 文件（YAML frontmatter 带 `type`），再在 MEMORY.md 索引加一行
  - 界面提示 "Saved X memories"
  - 用户明确说"记住 X"也走这条路；想写进 CLAUDE.md 必须明说
- **回忆**：模型需要细节时用 Read 按需读 topic 文件 → 界面提示 "Recalled X memories"
- **CLI 侧只做三件事**：
  1. 写带 frontmatter 的文件时盖 `modified` 时间戳（ISO 8601）
  2. 写入后测 MEMORY.md 长度：接近 200 行/25KB → 提醒精简（一行一条、细节挪 topic 文件、合并/删旧）；**超限 → 报错要求重写索引**（超限部分下次加载会被丢弃，但写入本身成功）
  3. 内容理解、文本挖掘：**零**。它不"看"对话，只是工具的执行方

### 阶段 3：会话结束
- 旧 transcript 按 `cleanupPeriodDays` 定期清理，**memory/ 目录豁免**，一直保留到被手动改/删
- 记忆没有自动过期机制，质量靠模型自己判断

### 阶段 4：下一次会话
回到阶段 1：MEMORY.md 索引注入 → 模型按需读 topic 文件 → 新信息写回。

---

## 三、记忆分类（写入时记在 frontmatter 的 `type` 字段）

| type | 含义 | 例子 |
|---|---|---|
| `user` | 你的角色、专长、工作偏好 | 用 pnpm 不用 npm |
| `feedback` | 你给出的纠正、确认过的做法 | "API 测试要本地 Redis" |
| `project` | 进行中的工作、截止时间、代码/git 推不出来的决策 | 下周三上线、某模块重构方向 |
| `reference` | 项目外信息去哪找 | issue 系统地址、看板链接 |

**不记**：能从代码库/架构/文件路径/调试修复推导出的东西；CLAUDE.md 里已经写过的。

---

## 四、存储结构

```
~/.claude/projects/<项目>/memory/
├── MEMORY.md           # 索引，一行一条，每次会话注入前 200 行/25KB
├── user_role.md        # 一条记忆一个文件
├── feedback_testing.md
└── ...
```

- 机器本地，不跨机器/云端同步
- 文件就是普通 markdown，随时可手动编辑/删除
- 每条记忆一个 topic 文件的原因：索引保持精简，细节按需加载，省上下文

---

## 五、子代理（subagent）

- 主对话的自动记忆**不会**加载进子代理
- 子代理可通过 `memory` 字段开启自己的独立记忆目录
- 例外：fork 当前对话会继承父会话上下文和 system prompt

---

## 六、常用命令与开关

| 操作 | 方式 |
|---|---|
| 查看/编辑记忆、开关自动记忆 | `/memory`（列出所有记忆文件位置，可开文件夹/用编辑器打开） |
| 查看实际加载了什么 | `/context` → Memory files 列表 |
| 生成初始 CLAUDE.md | `/init`（自动分析代码库） |
| 关闭自动记忆 | `CLAUDE_CODE_DISABLE_AUTO_MEMORY=1`，或 settings.json 设 `"autoMemoryEnabled": false`（可只对单项目） |
| 自定义记忆目录 | settings.json 设 `"autoMemoryDirectory": "~/my-memory"`（任何作用域都行） |
| 排查加载问题 | `/context` 确认文件确实加载；`InstructionsLoaded` hook 可打日志 |

---

## 七、排错速查

- **指令没生效**：先 `/context` 看有没有加载。没有 → 文件位置不对或没创建；有但没遵守 → 说得更具体、更简短，或指令互相冲突。
- **指令在 /compact 后丢了**：CLAUDE.md 只在项目根目录的会重载；会话里口头说的指令不持久，要写进 CLAUDE.md。
- **记忆不见了**：先查 /memory 的 auto memory 文件夹；MEMORY.md 超过 200 行/25KB 的部分下次会话不加载，重写索引或精简。
- **MEMORY.md 太长**：一行一条，细节挪 topic 文件，合并/删旧条目。
- **CLAUDE.md 太大**：目标 200 行内；超过 4MiB 直接不加载；用 `.claude/rules/` + paths 限定按需加载，`@import` 只是组织作用、不省 token。
