---
title: 从零写 CLI：Python 与 JavaScript / TypeScript 实战教程
description: 从命令设计、参数解析到测试与发布，系统梳理 Python 和 JavaScript / TypeScript CLI 的实战方法。
pubDate: 2026-08-06
tags: [CLI]
toc: true
search: true
---

> 本文讲的是可发布、可被脚本调用的命令行程序（CLI），而不是只给自己临时运行的一行脚本。示例命令叫 `helixent`，但结构可直接用于任何项目，包括 Trajex 这类「CLI 只是 Core 的薄入口」的项目。

## 1. 先建立正确的心智模型

CLI 的本质是一层稳定的输入输出协议：

```text
命令和参数
  -> 参数解析与校验
  -> 调用业务逻辑
  -> stdout 输出结果 / stderr 输出诊断
  -> 以退出码说明成功或失败
```

不要把所有逻辑都堆进 `cli.py` 或 `cli.ts`。CLI 入口负责「翻译用户输入」，业务代码负责「完成事情」。这样同一套业务逻辑才能被测试、Web API、桌面 App 或其他脚本复用。

```text
cli.py / cli.ts                  # 参数、帮助、格式化输出、exit code
service.py / service.ts          # 业务编排
db.py / db.ts                    # 数据库或文件读写
```

Trajex 的 `packages/cli/src/trajex.ts` 就是这个模式：它解析 `--build`、`--search`、`--query`，然后调用 Core；provider、SQLite 和索引逻辑不应该重新写在 CLI 里。

## 2. 好 CLI 的帮助应当渐进式披露

复杂工具最常见的失败不是「没有 help」，而是把所有子命令、全部参数和所有示例一次塞给用户。用户只想先知道下一步能做什么。

推荐把命令设计成树：

```text
helixent
└── config
    └── model
        └── add
```

对应帮助也逐层展开：

```bash
helixent --help                  # 产品概览：只列一级命令
helixent config --help           # config 下能配置什么
helixent config model --help     # model 的操作
helixent config model add --help # add 的参数、示例、失败条件
```

`--help` 是 Python 与 Node 库默认支持的行业约定。

### 2.1 每一层 help 应回答什么

| 层级 | 用户此刻的问题 | Help 应包含 |
| --- | --- | --- |
| 根命令 | 「这个工具能做什么？」 | 一句话定位、一级命令、全局选项、开始示例 |
| 命令组 | 「这个领域能做什么？」 | 直接子命令与简短动词说明 |
| 具体命令 | 「这件事怎样完成？」 | 必填参数、可选参数、默认值、示例、可能副作用 |
| 失败时 | 「为什么没成功？」 | 明确错误、修复建议、非零退出码 |

例如根 help 不应该完整展示 `config model add` 的 15 个选项；这些信息只在用户走到 `add help` 时显示。

### 2.2 设计命令树的规则

- 用「名词分组 + 动词操作」：`config model add`、`cache clear`、`session export`。
- 一个命令只完成一个动作。`config model add` 不顺便重建索引或修改其他配置。
- 位置参数放必需的核心对象：`model add <name>`。
- 选项放修饰条件：`--provider openai`、`--base-url URL`、`--json`。
- 破坏性操作提供 `--dry-run`、确认提示或 `--yes`。
- 为人类输出默认可读文本，为程序提供稳定的 `--json`。

## 3. 所有语言都通用的约定

### 3.1 stdout、stderr 和退出码

```text
stdout：成功结果；可被管道和其他程序读取
stderr：错误、警告、进度信息
exit code 0：成功
exit code 非 0：失败
```

例如：

```bash
helixent config model list --json > models.json
```

此时 stdout 必须只有 JSON。不要这样输出：

```text
正在读取配置...
[{"name":"gpt-5"}]
```

应当把诊断信息送往 stderr：

```text
stdout: [{"name":"gpt-5"}]
stderr: 正在读取配置...
```

常用退出码约定：

| 退出码 | 建议含义 |
| --- | --- |
| `0` | 成功 |
| `1` | 运行时错误，例如文件不可写、网络失败 |
| `2` | 命令用法错误，例如缺少必填参数（许多解析库默认采用） |
| `130` | 用户用 `Ctrl+C` 取消 |

### 3.2 参数校验要在入口完成

不要把非法值传到数据库、HTTP 请求或删除逻辑后才报错。

```ts
const limit = Number(rawLimit);
if (!Number.isSafeInteger(limit) || limit < 1) {
  throw new Error('--limit 必须是正整数');
}
```

库能表达的校验优先交给库：枚举用 choice，路径用 path 类型，必填项用 required。业务规则（例如「模型名称不能重复」）再放入 service 层。

### 3.3 先做非交互式，再增加交互式

这两条都应成立：

```bash
helixent config model add gpt-5 --provider openai
helixent config model add                 # 可选：交互式追问缺失信息
```

非交互式命令才适合 Shell、CI、Agent 与自动化。危险操作需要确认时，也要提供：

```bash
helixent model remove gpt-5 --yes
helixent model remove gpt-5 --dry-run
```

## 4. Python：Click（成熟、直接）

`argparse` 是 Python 标准库，简单的单层命令完全够用。但要做嵌套命令、漂亮帮助、类型校验和发布入口时，`click` 往往更省代码。

安装：

```bash
python -m venv .venv
source .venv/bin/activate
pip install click
```

目录：

```text
helixent/
├── pyproject.toml
└── src/
    └── helixent/
        ├── __init__.py
        ├── cli.py
        └── models.py
```

`src/helixent/models.py` 放业务逻辑：

```python
from dataclasses import asdict, dataclass
from pathlib import Path
import json

CONFIG_PATH = Path.home() / ".config" / "helixent" / "models.json"


@dataclass
class Model:
    name: str
    provider: str
    base_url: str | None = None


def load_models() -> list[Model]:
    if not CONFIG_PATH.exists():
        return []
    data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    return [Model(**item) for item in data]


def add_model(name: str, provider: str, base_url: str | None) -> Model:
    models = load_models()
    if any(item.name == name for item in models):
        raise ValueError(f"模型已存在：{name}")

    model = Model(name=name, provider=provider, base_url=base_url)
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    CONFIG_PATH.write_text(
        json.dumps([asdict(item) for item in [*models, model]], ensure_ascii=False, indent=2),
        encoding="utf-8",
    )
    return model
```

`src/helixent/cli.py` 只做命令层：

```python
import json
import sys
import click

from .models import add_model, load_models


@click.group(name="helixent", no_args_is_help=True)
def cli():
    """管理 Helixent 的本地配置。"""


@cli.group(no_args_is_help=True)
def config():
    """查看或修改配置。"""


@config.group(no_args_is_help=True)
def model():
    """管理模型配置。"""


@model.command("add")
@click.argument("name")
@click.option(
    "--provider",
    type=click.Choice(["openai", "anthropic", "local"], case_sensitive=False),
    required=True,
    help="模型提供商。",
)
@click.option("--base-url", metavar="URL", help="兼容 API 的基础地址。")
def add(name: str, provider: str, base_url: str | None):
    """新增一个模型配置。"""
    try:
        saved = add_model(name, provider, base_url)
    except ValueError as error:
        raise click.ClickException(str(error)) from error

    click.echo(f"已添加模型：{saved.name}（{saved.provider}）")


@model.command("list")
@click.option("--json", "as_json", is_flag=True, help="输出 JSON，便于脚本读取。")
def list_models(as_json: bool):
    """列出已配置的模型。"""
    models = load_models()
    if as_json:
        click.echo(json.dumps([item.__dict__ for item in models], ensure_ascii=False))
        return
    for item in models:
        click.echo(f"{item.name}\t{item.provider}\t{item.base_url or '-'}")


def main():
    # 将末尾 help 统一翻译成标准的 --help，支持任意命令层级。
    # 若某个命令真的需要把 help 作为普通位置参数，就不要启用此别名。
    if sys.argv[-1:] == ["help"]:
        sys.argv[-1] = "--help"
    cli()


if __name__ == "__main__":
    main()
```

运行效果：

```bash
python -m helixent.cli help
python -m helixent.cli config help
python -m helixent.cli config model add help
python -m helixent.cli config model add gpt-5 --provider openai
python -m helixent.cli config model list --json
```

其中 `@click.group(no_args_is_help=True)` 使用户输入到某层却没有继续输入时直接看到这一层帮助；每个函数的 docstring 会成为帮助描述。Click 默认已添加 `--help`，上面几行 `sys.argv` 只是对 `help` 别名的最小兼容。

发布为真正命令时，在 `pyproject.toml` 写：

```toml
[project]
name = "helixent"
version = "0.1.0"
dependencies = ["click"]

[project.scripts]
helixent = "helixent.cli:main"
```

安装后即可直接使用 `helixent ...`，而不用 `python -m`。

## 5. Python：Typer（类型标注优先）

Typer 建在 Click 之上，更适合已经习惯 Python 类型标注的人。它能从函数签名推导大部分参数帮助。

安装：

```bash
pip install typer
```

最小分组版本：

```python
import sys
from typing import Annotated
import typer

app = typer.Typer(no_args_is_help=True)
config_app = typer.Typer(no_args_is_help=True)
model_app = typer.Typer(no_args_is_help=True)

app.add_typer(config_app, name="config", help="查看或修改配置。")
config_app.add_typer(model_app, name="model", help="管理模型配置。")


@model_app.command("add")
def add_model(
    name: Annotated[str, typer.Argument(help="模型唯一名称")],
    provider: Annotated[str, typer.Option(help="模型提供商")],
    base_url: Annotated[str | None, typer.Option(help="兼容 API 的基础地址")] = None,
):
    """新增一个模型配置。"""
    print(f"add {name} from {provider}; base_url={base_url}")


def main():
    if sys.argv[-1:] == ["help"]:
        sys.argv[-1] = "--help"
    app()


if __name__ == "__main__":
    main()
```

Typer 的适用边界很简单：想要函数签名即文档、类型即参数校验时用它；如果要直接控制 Click 的上下文、回调和复杂命令行为，直接用 Click 也完全合理。两者不需要同时引入。

## 6. Node.js / TypeScript：Commander

原生 `process.argv` 适合一个小脚本；有嵌套子命令、默认 help、选项验证时，使用 `commander` 更省心。其 TypeScript 类型内置，不需要额外装 `@types`。

安装：

```bash
npm install commander
npm install -D typescript tsx @types/node
```

目录：

```text
helixent/
├── package.json
├── tsconfig.json
└── src/
    ├── cli.ts
    └── models.ts
```

`src/models.ts`：

```ts
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export interface Model {
  name: string;
  provider: 'openai' | 'anthropic' | 'local';
  baseUrl?: string;
}

const configPath = path.join(os.homedir(), '.config', 'helixent', 'models.json');

function loadModels(): Model[] {
  if (!fs.existsSync(configPath)) return [];
  return JSON.parse(fs.readFileSync(configPath, 'utf8')) as Model[];
}

function saveModels(models: Model[]): void {
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(models, null, 2));
}

export function addModel(model: Model): Model {
  const models = loadModels();
  if (models.some(item => item.name === model.name)) {
    throw new Error(`模型已存在：${model.name}`);
  }
  models.push(model);
  saveModels(models);
  return model;
}

export function listModels(): readonly Model[] {
  return loadModels();
}
```

`src/cli.ts`：

```ts
#!/usr/bin/env node
import { Command, Option } from 'commander';
import { addModel, listModels, type Model } from './models.js';

function normalizeHelpAlias(argv: string[]): string[] {
  const normalized = [...argv];
  if (normalized.at(-1) === 'help') normalized[normalized.length - 1] = '--help';
  return normalized;
}

const program = new Command();
program
  .name('helixent')
  .description('管理 Helixent 的本地配置。')
  .version('0.1.0');

const config = program
  .command('config')
  .description('查看或修改配置。');

const model = config
  .command('model')
  .description('管理模型配置。');

model
  .command('add <name>')
  .description('新增一个模型配置。')
  .addOption(
    new Option('--provider <provider>', '模型提供商')
      .choices(['openai', 'anthropic', 'local'])
      .makeOptionMandatory(),
  )
  .option('--base-url <url>', '兼容 API 的基础地址')
  .action((name: string, options: { provider: Model['provider']; baseUrl?: string }) => {
    try {
      const saved = addModel({ name, provider: options.provider, baseUrl: options.baseUrl });
      console.log(`已添加模型：${saved.name}（${saved.provider}）`);
    } catch (error) {
      console.error(`错误：${error instanceof Error ? error.message : String(error)}`);
      process.exitCode = 1;
    }
  });

model
  .command('list')
  .description('列出已配置的模型。')
  .option('--json', '输出 JSON，便于脚本读取。')
  .action((options: { json?: boolean }) => {
    const models = listModels();
    if (options.json) console.log(JSON.stringify(models));
    else models.forEach(item => console.log(`${item.name}\t${item.provider}`));
  });

program.parse(normalizeHelpAlias(process.argv));
```

开发运行：

```bash
npx tsx src/cli.ts config model add help
npx tsx src/cli.ts config model add gpt-5 --provider openai
npx tsx src/cli.ts config model list --json
```

`Commander` 默认提供每层的 `--help`。`normalizeHelpAlias()` 只做一件事：把最后一个 `help` 转成 `--help`，因此 `helixent config model add help` 能沿用 Commander 原生帮助，而不必为每个命令手写一个 `help` 子命令。

生产发布的 `package.json` 最小配置：

```json
{
  "name": "helixent",
  "type": "module",
  "bin": {
    "helixent": "./dist/cli.js"
  },
  "scripts": {
    "build": "tsc -p tsconfig.json"
  }
}
```

依赖版本由前面的 `npm install commander` 写入 `package.json`，不必手填或复制某个可能过期的版本号。

本地验证可执行命令：

```bash
npm run build
npm link
helixent config model --help
```

## 7. 不用库时：原生参数解析的边界

Python 的 `argparse` 与 Node 的 `process.argv` 都值得会，但适合较平的命令。

Python：

```python
import argparse

parser = argparse.ArgumentParser(prog="helixent")
subparsers = parser.add_subparsers(dest="command", required=True)
add = subparsers.add_parser("add", help="新增模型")
add.add_argument("name")
add.add_argument("--provider", required=True)
args = parser.parse_args()
```

Node：

```js
const [command, ...args] = process.argv.slice(2);
if (command === 'add') {
  // 自己校验 args，自己打印 help
}
```

一旦出现两层以上子命令、互斥选项、类型选择、自动 help 或发布需求，继续手写解析器通常比引入 Click / Typer / Commander 更费代码，也更容易让帮助文档漂移。

## 8. 配置、文件和危险操作

配置读取优先级建议固定为：

```text
命令选项 > 环境变量 > 配置文件 > 默认值
```

例如：

```bash
helixent config model list --config ./demo.json
HELIXENT_CONFIG=./demo.json helixent config model list
```

涉及写文件、删除、覆盖、执行子进程时：

- 显示实际目标路径或资源名。
- 校验路径范围；不要把用户输入直接拼成 shell 命令。
- 提供 `--dry-run` 预览。
- 破坏性操作默认询问确认，自动化时要求显式 `--yes`。
- 文件写入使用临时文件后 rename，避免中途异常留下半个 JSON。

## 9. 测试：测业务逻辑，也测命令契约

业务函数不依赖终端时最好测：

Python：

```python
from helixent.models import add_model

def test_duplicate_model_is_rejected():
    add_model("gpt-5", "openai", None)
    try:
        add_model("gpt-5", "openai", None)
        assert False, "应当拒绝重复模型"
    except ValueError:
        pass
```

CLI 至少有这些 smoke check：

```bash
helixent --help
helixent config model add --help
helixent config model add gpt-5 --provider openai
helixent config model list --json | jq .
helixent unknown-command; echo $?
```

测试 CLI 时优先断言三件事：退出码、stdout 内容、stderr 内容；不要依赖无关的空格、颜色或终端宽度。

## 10. 一份上线前清单

```text
[ ] 根 help 只列一级命令，子命令 help 再逐层展开
[ ] 每个命令都支持 --help；需要时兼容末尾 help
[ ] 参数、默认值、示例和副作用都在对应层级的 help 中
[ ] 成功结果走 stdout，错误/进度走 stderr
[ ] --json 时 stdout 不混入日志
[ ] 参数校验靠近入口，业务规则留在 service
[ ] 退出码稳定，错误能告诉用户怎样修复
[ ] 危险操作提供确认、--yes 或 --dry-run
[ ] CLI 入口足够薄，核心业务可被独立测试和复用
[ ] 发布后可直接运行命令，而非要求用户手动执行脚本
```

## 11. 最小原则

先做一条能完成真实工作的命令，例如：

```bash
helixent config model add gpt-5 --provider openai
```

再按真实需求加 `list`、`--json`、配置文件、交互式输入。不要一开始造插件系统、交互式 TUI 或自定义命令框架。CLI 的高级感来自命令树清晰、帮助递进、输出稳定，而不是参数数量多。
