---
title: Agent 权限控制与安全机制
description: Agent 安全要分开回答两件事：这次操作要不要做，做了能碰到什么。按「工具 → 规则 → 模式 → 审批 → 沙箱」拆解 Codex、Claude Code 与 pi 的实现，并给出 Prompt injection 的防御落点。
pubDate: 2026-10-19
lastModDate: 2026-11-05
category: 技术
tags: [Agent, 安全权限]
titleImage: ./_title-images/agent-permissions-and-security.png
titleImageAlt: Agent 安全、权限与沙箱示意图，展示核心风险、安全控制层和目标结果
draft: false
---

> **TL;DR：** Agent 安全回答两个问题：**这次操作要不要做**（授权），以及**做了能碰到什么**（隔离）。授权由宿主程序按「规则 → 模式 → 是否越界 → 审批」的链路决定，审批人可以是人，也可以是独立的审查模型；隔离由沙箱在执行时强制，不依赖模型是否听话。主流产品已经收敛到同一个思路：**沙箱内的日常操作自动放行，越过边界才审批，规则只做精确的例外。** 规则匹配的是命令文本，可以被绕过，所以真正的硬边界始终是沙箱和服务端权限。

## 一、核心模型：授权与隔离是两件事

模型只负责**提出**工具调用，执行由 Agent 宿主程序（Harness）完成。权限控制全部在宿主里：Claude Code 文档直接写明，权限规则由 Claude Code 执行，不由模型执行；提示词和 CLAUDE.md 只能影响模型想做什么，不能改变系统允许什么。[6]

宿主手里有两类控制，必须分开理解：

- **授权（Approval）：** 决定这次调用要不要执行、要不要先问。对应 Codex 的 `approval_policy`，以及 Claude Code 的权限模式和 allow / ask / deny 规则。
- **隔离（Sandbox）：** 决定命令真正运行时能读写哪些文件、能不能联网。对应 Codex 的 `sandbox_mode`，以及 Claude Code 的 Bash sandbox。

两者互相独立。「不弹窗」不等于「没有沙箱」，「有沙箱」也不等于「不需要审批」。Codex 文档的说法很准确：沙箱定义技术边界，审批策略决定越过边界前何时停下来问。[1]

**沙箱不只是兜底，也是减少弹窗的手段。** 正因为沙箱能兜住工作区内的操作，宿主才敢让这些操作自动执行，只在越界时打扰人。

## 二、一次工具调用的完整链路

主流实现可以归纳成下面这条链路。各家的模块划分不同，但判断顺序基本一致：

```text
模型提出 tool_call
  │
  ① 工具可见性   这个 Agent 有没有这个工具？（整工具 deny 时，模型根本看不到它）
  │
  ② 规则匹配     forbidden/deny > ask/prompt > allow，先拆复合命令再逐条匹配
  │              命中 deny → 拒绝；命中 ask → 进入 ④；命中 allow → 进入 ⑤
  │
  ③ 模式基线     没有规则命中时，由当前权限模式决定默认行为
  │              （沙箱内自动执行 / 仅读自动 / 全部询问 / 全部拒绝 / 全部放行）
  │
  ④ 审批         越界或规则要求时暂停，交给审批人：用户 / 审查 Agent / 分类器
  │              批准 → ⑤；拒绝 → 把理由返回给模型；超时 ≠ 批准
  │
  ⑤ 受限执行     在沙箱内运行，命令及其子进程都受文件和网络边界约束
  │              被沙箱拦住 → 申请提升权限 → 回到 ④
  │
  ⑥ 回传与审计   结果或拒绝理由回给模型；记录调用、批准范围和结果
```

另外，宿主通常在 ②③ 之间提供一个可编程拦截点，比如 Claude Code 的 `PreToolUse` hook、Codex 的 hooks、pi 的 `tool_call` 扩展事件，用自己的逻辑检查完整参数后返回 allow / deny / ask。[5][6]

下面按链路逐层展开。

## 三、第①步：先收窄工具

**按任务分配工具。** 阅读 Agent 只给读取和搜索，编码 Agent 再加编辑和测试，发布 Agent 才拿到发布工具。宿主为每个 Agent 保存可调用工具集合，既控制发给模型的工具说明，也在执行入口再检查一次。只在提示词里删掉工具说明不够，还要防止通过嵌套调用、子 Agent 或通用 Bash 拿到同样的能力。

**收窄工具本身的能力。** 常见做法有三种：

- **缩小接口：** 只提供「创建邮件草稿」，不提供「发送邮件」；只提供查询，不提供任意 SQL。
- **在代码里限制参数和目标：** 文件工具只接受工作区内的真实路径，并且先解析符号链接；发布工具只能发到测试环境。限制必须写在执行代码里，不能只写在工具描述里。
- **限制底层身份：** 只读数据库账号、只对某个仓库有效的 token。即使宿主漏判，服务端也会拒绝越权请求。

**工具白名单不等于能力边界。** 一个只有 `read` 的 Agent 仍可能读到私钥；一个保留任意 Bash 的「只读 Agent」仍然可以写文件。通用 Bash 很难在工具内部彻底限权，所以主流产品都不去改造 Bash，而是用规则、审批和沙箱共同约束它。

**工具最好声明自己的风险属性。** MCP 工具可以带 `readOnlyHint`、`destructiveHint`、`idempotentHint`、`openWorldHint` 等标注。Codex 就利用这些标注：声明了 destructive 的 MCP / App 工具调用一定要审批，声明为只读的优先放行。[2] 第三方工具的标注只能作为参考，未标注或来源不可信的工具应默认需要审批。

## 四、第②步：规则匹配

### 两家的规则形态

- **Codex：** 用 Starlark 编写 `.rules` 文件中的 `prefix_rule`，按命令参数前缀匹配，决策为 `allow / prompt / forbidden`；多条命中时取最严格的，顺序是 forbidden > prompt > allow。规则作用于「沙箱外运行」的命令，可以带 `match / not_match` 示例做加载时自检。[3]
- **Claude Code：** 规则写成 `Tool(specifier)`，比如 `Bash(npm run *)`、`Read(./.env)`、`WebFetch(domain:example.com)`、`mcp__github__*`；按 deny → ask → allow 的顺序取第一个命中，**规则写得更具体也不能越过这个顺序**，allow 不能在 deny 里开例外。整工具 deny（如 `Bash`）会把工具从模型上下文中直接移除。[6]

### 复合命令先拆再判

`git add . && rm -rf /` 如果整体匹配 `git add` 前缀就会被放行，这是规则引擎最典型的漏洞。两家都会先拆分：

- **Codex：** 只有由普通单词和 `&& || ; |` 组成的简单链，才会用 tree-sitter 拆成单条命令逐条判断，最严格的结果胜出。脚本里有变量、重定向、`$(...)`、通配符或控制流时不拆，按整条 `bash -lc "<script>"` 保守处理。[3]
- **Claude Code：** 识别 `&& || ; | |& &` 和换行；每个子命令都被允许，整条才能自动执行；deny / ask 规则只要命中任何一个子命令就生效，包括子 shell 和命令替换里的命令。匹配前还会剥掉 `timeout`、`nice`、`nohup` 等包装命令；但 `npx`、`docker exec` 这类会执行参数的环境运行器不剥，规则需要写全。[6]

### 规则的边界：它匹配的是文本，不是程序

Claude Code 文档明确说明，`Bash(rm *)` 拦得住 `rm -rf build/`，但拦不住 `/bin/rm -rf build/` 或 `bash -c 'rm -rf build/'`；`Bash(git push *)` 也拦不住 `git -C . push`。**命令规则不是围绕程序的安全边界**，要在文件和网络层面强制约束，必须靠沙箱。[6]

所以规则的正确用法是：

- **allow 写窄：** `["cargo","test"]`、`Bash(npm run lint)`，不要写 `["python"]`、`Bash(git *)`。`git -c` 可以让 git 执行任意程序，宽前缀等于拆掉边界。[4][6]
- **deny / ask 用来拦常见路径：** 拦截 force push、发布、删库这类常见写法，并在审批界面提示人；但不要把它当成唯一防线。

### 规则落在哪一层，决定它能管住什么

同一条策略（比如「禁止读私钥」）要在对应的执行位置分别落实，不能写一份配置就以为所有路径都受保护：

1. **宿主门禁**（调用前）：按工具名和参数决定 allow / deny / ask。局限是只能管经过这个入口的调用，看不透脚本内部的行为。
2. **工具内部校验**（具体操作前）：文件工具检查真实路径。局限是只约束这个工具；禁止 `read` 读私钥，并不能阻止 Bash 里的 `cat`。
3. **沙箱**（进程访问资源时）：由操作系统约束命令及其子进程。局限是只覆盖放进沙箱的进程；宿主上的其他工具、MCP 服务不一定受约束。
4. **服务端权限**（被调用系统检查）：用受限 token 和只读账号。局限是授权范围内的误操作仍可能发生。

## 五、第③步：权限模式，即「没有规则命中时怎么办」

模式是基线，规则在模式之上加例外。

**Codex：三个旋钮组合。**[1]

- `sandbox_mode`：`read-only` / `workspace-write` / `danger-full-access`。
- `approval_policy`：`on-request`（沙箱内自动，越界时询问）/ `never`（从不询问）。旧的 `untrusted` 已经停用，改为在项目上设置 `trust_level = "untrusted"`。[2]
- `approvals_reviewer`：`user`（人来批）/ `auto_review`（审查 Agent 来批）。

常见预设：Ask for approval = `workspace-write` + `on-request` + `user`；Approve for me = 同样的沙箱，但审批人换成 `auto_review`；Full access = `danger-full-access` + `never`。

Codex 另外提供 `approval_policy = { granular = {...} }`，把沙箱越界、execpolicy 规则、MCP、`request_permissions` 等不同类别分别设为交互或自动拒绝，作为「全问」和「全不问」之间的中间档。[2]

**Claude Code：按自动化程度分档。**[7]

- `default`（Manual）：只有读取自动执行，其余首次使用时询问。
- `acceptEdits`：工作目录内的文件编辑和 `mkdir / touch / mv / cp` 等常见文件命令自动执行。
- `plan`：只探索、不修改源码；可用 auto 模式时，分类器批准的命令仍会执行。
- `auto`：由后台分类器在 shell、网络等动作执行前审查，代替人工弹窗。v2.1.283 起，交互式终端和 VS Code 会话默认就是它。
- `dontAsk`：凡是需要询问的一律拒绝，只运行预先允许的工具，适合 CI。
- `bypassPermissions`：跳过提示，只建议在容器或 VM 里使用。

**有些东西任何模式都不放行。** Claude Code 中，显式 ask 规则、需要用户交互的工具、关键路径上的 `rm` 删除等，在 `bypassPermissions` 下也不会自动通过；deny 规则在所有模式下都生效，allow 规则在 `bypassPermissions` 下反而无效。[7] Codex 的 `--yolo` 则是同时跳过审批和沙箱。[8] 所以评估一个模式，要分别问三件事：**还检查哪些规则？还需要哪些审批？执行时还有什么隔离？** 不能只看模式名字。

**pi** 默认不内置这套权限策略和 OS 沙箱：工具以启动 pi 的系统账号权限运行，需要通过 `tool_call` 扩展事件自行实现调用前检查，或者把整个进程放进容器。[9][10]

**两种设计取向，最终收敛到同一点。** Codex 是「边界驱动」：先用沙箱圈出自动区，审批只发生在越界时。Claude Code 起步于「规则 + 模式驱动」，后来加入 Bash sandbox 的 auto-allow 和 auto 模式分类器，也走向「沙箱内自动、越界或高风险才审」。

## 六、第④步：审批

### 什么情况需要审批

判断标准不是「这个工具会不会写」，而是**出错后的代价能不能被兜住**。三个维度里只要有一个答案是“会”，就应该审批：

- **不可逆：** 删除、推送、发布、发消息、支付。
- **影响超出工作区：** 写工作区外的文件，改 `.git`、凭据、Agent 自身配置等受保护路径。
- **数据外发：** 联网、上传，把内容发给第三方。

Codex 实际触发审批的情况正好对应这三类：请求提升沙箱权限的命令、被沙箱拦下的网络请求、写可写目录以外的文件，以及按标注或配置需要审批的 MCP 调用。[2][4]

### 谁来批

**人工审批（HITL）**：执行前暂停，把决定权交给人，而不是执行后再发一条通知。实现时要注意：

- **审批界面显示真实参数和目标：** 批准「给 A 发这封邮件」不等于批准任意收件人；执行参数超出批准范围时要重新判断。
- **「始终允许」要窄且明确：** Codex 把它写成一条精确的前缀规则；Claude Code 把 Bash 和 WebFetch 的永久授权按仓库写入 `.claude/settings.local.json`，文件编辑授权只在本会话有效，并且只有在弹窗能完整展示授权范围时才提供“不再询问”选项。[3][6]
- **超时不是批准：** 没有人响应时，保持等待或拒绝。Codex 还会把超时和明确拒绝分开告知模型：超时本身不能证明操作不安全。[4]

**自动审批**：不是让主 Agent 自问“这样安全吗”，而是把待执行操作交给一个**职责更窄的独立模型**，由宿主根据结果决定是否继续。

- **Codex Auto-review：** 只处理原本要问人的越界请求，已经在沙箱内允许的操作不审。审查 Agent 看到压缩后的对话记录、工具证据和这次请求的确切内容，看不到主 Agent 的隐藏推理。被拒绝后，主 Agent 不能换个方式绕过去，只能找明显更安全的方案或停下来问人。同一轮连续被拒 3 次，或者最近 50 次审查中被拒 10 次，就中断这一轮。**它只替换审批人，不扩大任何权限**——不会扩大 `writable_roots`、不会开网络、不会放松受保护路径。[4]
- **Claude Code auto 模式：** 后台分类器在 shell 命令、网络请求等动作执行前检查它们是否符合用户意图；连续 3 次或累计 20 次被拦时，auto 模式暂停并退回人工审批。分类器给不出结论时按拦截处理，而不是放行。[7]

自动审查仍可能误判，也可能受注入内容影响。它适合减少人工确认，但不能替代沙箱和服务端权限。

### 审批太多怎么办

先修边界，不要训练人或审查模型无脑批准。Codex 文档给出的高杠杆做法是：为确实要用的目录加窄范围的 `writable_roots`，为常用命令加精确的前缀规则。[4] 审批疲劳本身就是安全风险，因为人会开始无脑点同意。

## 七、第⑤步：执行隔离，先确认隔离的是什么

「代码在沙箱里运行」还不够准确。QuickJS 隔离一段脚本，OS 沙箱限制进程，VM 提供独立的操作系统，三者可以组合使用。

### QuickJS：脚本只能通过宿主提供的接口做事

pi 的 codemode 把模型生成的 JavaScript 放进 QuickJS 运行，不提供 Node.js 的文件、网络和子进程 API。脚本负责循环、判断、并行调用和整理结果，只能通过宿主暴露的 `tools` 接口访问外部能力，还可以配合内存和执行时间限制。[11]

关键不在于「用了 QuickJS 所以安全」，而在于**脚本没有直接访问宿主系统的能力**。脚本调用 `tools.bash` 后，真正的 Bash 由宿主执行，不在 QuickJS 的隔离范围里。所以这些嵌套调用必须同样经过第②到④步的权限检查。另外，脚本失败不等于回滚，前面已经写入的文件不会自动恢复。

### OS 沙箱：约束命令及其所有子进程

沙箱作用于宿主启动的所有命令，包括 git、包管理器、测试脚本，以及它们再启动的子进程。macOS 用 Seatbelt，Linux 和 WSL2 用 bubblewrap，Windows 有原生实现。[1][12] 典型限制包括：只允许写工作区、禁止读密钥目录、禁止直连网络，或者只能经过受控代理访问允许的域名。

Claude Code 的 Bash sandbox 还暴露了两处容易忽略的边界：它**只包住 shell 命令**，内置 Read / Edit / Write / WebFetch 等工具、MCP 服务、hooks 都跑在沙箱之外；网络默认不是「拦掉」，而是「全部走本机代理，代理按域名白名单放行」，白名单初始为空。[12] Codex 的 `network_proxy` 同理：它只过滤命令沙箱内的进程，不过滤 web 搜索、App 连接器、MCP 连接和浏览器；域名规则 deny 优先，DNS 解析到内网地址的主机名即使命中白名单也会被挡。[2]

两个常见误区：

- **只读不等于保密：** 禁止写工作区外的文件，不代表也禁止读；Claude Code 的沙箱默认能读「本机大部分路径，包括 `~/.ssh`、`~/.aws/credentials`」，要保护私钥必须显式加 `filesystem.denyRead`。[12]
- **允许访问某个域名，不等于允许向这个域名上的任意账号上传数据。**

### 容器、VM 与云电脑

容器隔离文件和进程，但通常共享宿主内核；VM / MicroVM 有独立内核，可以承载完整系统和浏览器。接入方式有两种：**把整个 Agent 放进去运行**，或者 **Agent 留在外面，只把命令和文件操作交给隔离环境**（sandbox as a tool）。只隔离部分工具时，宿主上的扩展、浏览器和其他 MCP 工具不一定受同一个沙箱约束。[10]

**隔离本机不等于隔离你的账号。** 给云 VM 生产 token、登录态或可写挂载，它仍然能破坏这些资源；销毁环境也撤销不了已经发出的邮件、支付或代码推送。

## 八、Prompt injection：假设模型会被骗

注入可能来自用户输入，也可能藏在网页、issue、文件和工具结果里，诱导 Agent 把数据当成指令执行。[13] 一个实用的风险判断是 **lethal trifecta**：同时具备「接触私密数据」「读取不可信内容」「能对外通信」三种能力时，注入就可能演变成数据外泄。[14] 设计时至少要切断其中一项。

防御分两类：

- **减少注入成功：** 把外部内容标记为数据，不和可信指令混在一起；在内容进入模型前做检测（规则或检测模型），覆盖检索内容和工具结果，而不只检查用户最初的 prompt。检测会漏，也会误判，只能降低概率。
- **注入成功后仍然安全：** 这一类才是重点，也就是第①到⑤步本身：少给工具和凭据（短期、受限的 token，不把原始密钥放进上下文）；高风险操作审批时检查真实参数，而不是相信主 Agent 写的理由；由读取限制和外发限制阻止「读私钥再上传」，而不是依赖模型拒绝；敏感信息检查要覆盖外发工具的参数，不只是最终回复；保留脱敏日志和快照，便于追查和恢复。

**Guardrails 是这些防护措施的统称，不是一个万能模块。** 设计时要说清楚：由谁检查、在哪一步阻断、漏判之后还剩什么限制。

## 九、落到自己的 Harness：最小实现

1. **工具声明风险属性：** read-only / destructive / open-world，MCP 工具读取标注，未标注的默认按高风险处理。
2. **在 `before_tool_call` 实现 Permission Gate：** 按「deny → ask → allow → 模式基线 → 是否越界」的顺序决策，嵌套调用（codemode、子 Agent）走同一个入口。
3. **Bash 先解析再判断：** 用 tree-sitter-bash 拆分简单命令链；遇到复杂语法时保守处理，整体询问。
4. **每条命令进 OS 沙箱：** 默认可写工作区、不联网、不可读敏感目录；越界时申请提升权限，而不是关掉沙箱。注意内置文件工具、MCP 和 hooks 若在沙箱之外，需要各自的路径与域名规则。
5. **审批可替换、授权要窄：** 审批人可以是 UI 或审查模型；「始终允许」只保存精确前缀，并且有作用域；超时即拒绝；连续被拒时熔断。
6. **审计：** 记录调用、决策来源（哪条规则、哪个模式、谁批准）和结果。

## 十、面试速答

- **怎么判断什么需要人审批？** 看出错后的代价能否被兜住：不可逆、超出工作区、数据外发，三者中任何一个成立就审批；沙箱内能兜住的直接执行。
- **为什么不用危险命令正则？** 规则匹配的是文本，换个写法（`/bin/rm`、`bash -c`）就能绕过，规则越写越宽又会导致审批疲劳。正则只用来提示，硬边界靠沙箱。
- **自动审批安全吗？** 它只替换审批人，不扩大权限；被拒后禁止绕行，并有熔断。但它会误判，只能和沙箱、服务端权限一起用。
- **YOLO 和 auto 模式有什么区别？** YOLO（Codex `--yolo`、Claude Code bypass）跳过审批，Codex 还同时去掉沙箱；auto 模式保留审批，只是审批人换成了模型。

## Sources

产品行为会随版本变化，以下链接于 2026-11-05 核对；不把某一家的模式名称当作通用标准。pi 部分按本机 1.5.0 文档核对。

1. [Codex：Sandbox](https://developers.openai.com/codex/sandboxing)
2. [Codex：Agent approvals & security](https://developers.openai.com/codex/agent-approvals-security)
3. [Codex：Rules](https://developers.openai.com/codex/rules)
4. [Codex：Auto-review](https://developers.openai.com/codex/auto-review)
5. [pi：Extensions](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/extensions.md)
6. [Claude Code：Configure permissions](https://code.claude.com/docs/en/permissions)
7. [Claude Code：Permission modes](https://code.claude.com/docs/en/permission-modes)
8. [Codex：CLI reference](https://developers.openai.com/codex/cli/reference)
9. [pi：Security](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/security.md)
10. [pi：Containerization](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/containerization.md)
11. [pi：Codemode](https://github.com/earendil-works/pi/blob/main/packages/coding-agent/docs/codemode.md)
12. [Claude Code：Sandboxing](https://code.claude.com/docs/en/sandboxing)
13. [OWASP：Prompt Injection Prevention](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
14. [Simon Willison：The lethal trifecta for AI agents](https://simonwillison.net/2025/Jun/16/the-lethal-trifecta/)
