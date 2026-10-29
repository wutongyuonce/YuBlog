---
title: 新 Mac 配置：开发环境与终端
description: 面向 Apple Silicon Mac 的新机开发环境配置指南，涵盖 Homebrew、zsh、语言环境、Git、数据库与 Ghostty 终端。
pubDate: 2026-02-02
category: 教程
lastModDate: 2026-10-17
tags: [macOS, ghostty]
toc: true
search: true
draft: false
---

面向 Apple Silicon Mac 和 zsh，Homebrew 默认前缀为 `/opt/homebrew`；Intel Mac 按安装器提示调整路径。

按顺序完成：**Homebrew → 常用工具 → zsh 配置 → 所需语言环境 → Git 与数据库 → 终端外观 → 验证和备份**。只安装实际需要的工具；这里是可复用的新机步骤，不记录某台旧机器的安装状态或小版本号。

## 一、安装 Homebrew

使用 macOS 自带的“终端”完成初始安装即可，不必先安装其他终端。

```bash
xcode-select --install
```

等待命令行工具安装完成，再按 [Homebrew 官网](https://brew.sh/) 安装：

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

安装器完成后，将下面一行加入 `~/.zprofile`；已有相同配置时不重复添加：

```zsh
eval "$(/opt/homebrew/bin/brew shellenv)"
```

重新打开终端，确认 `brew --prefix` 输出 `/opt/homebrew`、`brew --version` 正常。后面不使用 `sudo brew install`。

## 二、选择要安装的工具

### 1. 编辑器、终端与图形开发工具

带界面的应用可通过 cask 或官网安装。应用选择与 AI/Agent 插件搭配统一见 [Mac 应用清单](/interests/software/#我的-mac-软件)；这里列出对应的开发应用安装入口：

| 工具 | 用途 | 安装命令或入口 |
| --- | --- | --- |
| Ghostty | 终端，配合 herdr 与 pi；下文提供基础配置 | `brew install --cask ghostty` |
| Zed | 代码编辑器 | `brew install --cask zed` |
| VS Code | 代码编辑器 | `brew install --cask visual-studio-code` |
| Navicat | 数据库客户端；按购买的产品版本选择安装包 | [官网下载](https://www.navicat.com/)；Premium 版也可用 `brew install --cask navicat-premium` |
| DBX | 数据库客户端 | [官网安装](https://dbxio.com/cn) |
| Bruno | API 调试 | `brew install --cask bruno` |
| Apifox | API 设计与调试 | `brew install --cask apifox` |
| Postman | 其他 API 调试选择 | `brew install --cask postman` |
| Docker Desktop | 本地容器环境 | `brew install --cask docker-desktop` |
| WhatThePort | 端口查看器 | [官网安装](https://whattheport.dev/) |

VS Code 若找不到 `code` 命令，在命令面板（`Cmd + Shift + P`）执行 `Shell Command: Install 'code' command in PATH`，重新打开终端。Docker Desktop 首次运行需在界面完成初始化；是否登录启动由自己选择。

### 2. Git、搜索与终端基础工具

以下是一组常用基础工具，可以一起安装：

```bash
brew install git gh lazygit fd ripgrep fzf starship zsh-autosuggestions
```

| 工具 | 用途 |
| --- | --- |
| `git` / `gh` | 版本管理 / GitHub 登录与仓库操作 |
| `lazygit` | Git 终端界面 |
| `fd` / `rg` | 按文件名 / 按文件内容搜索，`rg` 来自 ripgrep |
| `fzf` | 模糊搜索文件和命令历史 |
| `starship` | 提示符 |
| `zsh-autosuggestions` | 根据历史命令提供输入建议 |

### 3. 按需补充

| 工具 | 用途 | 安装命令 |
| --- | --- | --- |
| Yazi | 终端文件管理器 | `brew install yazi` |
| Glow | 终端阅读 Markdown | `brew install glow` |
| Fastfetch | 系统信息 | `brew install fastfetch` |
| tree | 目录树 | `brew install tree` |
| wget | 文件下载 | `brew install wget` |
| HTTPie | HTTP 客户端 | `brew install httpie` |
| Nmap | 网络与端口检测 | `brew install nmap` |
| Pandoc | 文档格式转换 | `brew install pandoc` |
| FFmpeg | 音视频处理 | `brew install ffmpeg` |
| SoX | 音频处理 | `brew install sox` |
| yt-dlp | 视频下载，常配合 FFmpeg | `brew install yt-dlp` |
| terminal-notifier | 命令行发送系统通知 | `brew install terminal-notifier` |
| Mole | 本机维护工具 | `brew install mole` |
| tokens | AI 编程工具 Token 用量统计，来自第三方 tap | `brew install owo-network/brew/tokens` |

编译库通常由依赖自动安装。项目明确要求时再安装 `pkgconf`、`protobuf`、`pango`、`openssl@3`、`xz` 等，例如 `brew install pkgconf protobuf`，不把旧机所有底层库照搬为必装项。

## 三、创建统一的 zsh 配置

### 1. 配置文件分工

| 文件 | 内容 |
| --- | --- |
| `~/.zprofile` | 登录 shell 的环境初始化，放 Homebrew 的 `shellenv` |
| `~/.zshrc` | 交互式终端环境、补全、别名与插件 |
| `~/.config/starship.toml` | 提示符外观 |
| `~/.config/ghostty/config` | 终端外观与快捷键 |

新机先创建 `~/.zshrc`，按下面的顺序整理。已有文件时合并内容，不反复追加完整配置。未安装的工具会跳过；后续安装语言管理器后，重新打开终端让初始化生效。

### 2. `.zshrc` 基础配置

```zsh
# PATH、补全目录去重
typeset -U path fpath
path=("$HOME/.local/bin" $path)

# keg-only 工具：让终端找到命令，不会启动任何服务
[[ -d /opt/homebrew/opt/rustup/bin ]] && path=(/opt/homebrew/opt/rustup/bin $path)
[[ -d /opt/homebrew/opt/postgresql@17/bin ]] && path=(/opt/homebrew/opt/postgresql@17/bin $path)

# Node.js 版本管理
export NVM_DIR="$HOME/.nvm"
[[ -s /opt/homebrew/opt/nvm/nvm.sh ]] && source /opt/homebrew/opt/nvm/nvm.sh

# Java 版本管理，由 export 插件维护 JAVA_HOME
if command -v jenv >/dev/null; then
  eval "$(jenv init -)"
fi

# Go 多版本管理；只安装 brew go 时不进入这里
if command -v goenv >/dev/null; then
  export GOENV_ROOT="$HOME/.goenv"
  export GOENV_AUTOMATICALLY_DETECT_VERSION=1
  eval "$(goenv init -)"
fi

# 补全目录必须先于 compinit 设置
[[ -d "$HOME/.docker/completions" ]] && fpath=("$HOME/.docker/completions" $fpath)
autoload -Uz compinit
compinit

# 把当前目录复制到 macOS 剪贴板
alias cpwd='pwd | pbcopy'

# fzf：Ctrl+T 搜文件，Ctrl+R 搜历史
if command -v fzf >/dev/null; then
  if command -v fd >/dev/null; then
    export FZF_DEFAULT_COMMAND='fd --type f --hidden --exclude .git'
    export FZF_CTRL_T_COMMAND="$FZF_DEFAULT_COMMAND"
  fi
  source <(fzf --zsh)
fi

# 历史输入建议
[[ -r /opt/homebrew/share/zsh-autosuggestions/zsh-autosuggestions.zsh ]] && \
  source /opt/homebrew/share/zsh-autosuggestions/zsh-autosuggestions.zsh

# 提示符放在末尾
if command -v starship >/dev/null; then
  eval "$(starship init zsh)"
fi
```

`path` 是 zsh 中与 `PATH` 对应的数组，前面的目录优先被搜索。上面保留 `compinit` 的默认安全检查；遇到目录权限提示时按提示修复，不直接跳过检查。

`pnpm setup` 可能另行生成 `PNPM_HOME` 配置，保留其生成结果一份即可，不手写另一套旧版本路径。GUI IDE 不一定读取 `.zshrc`，项目 SDK 或解释器仍需在 IDE 中确认。

### 3. 可选：Yazi 退出后切换目录

需要时将这个函数加入 `.zshrc` 的提示符初始化之前，以后用 `y` 打开 Yazi：

```zsh
y() {
  local tmp cwd exit_code
  tmp="$(mktemp -t yazi-cwd.XXXXXX)" || return
  command yazi "$@" --cwd-file="$tmp"
  exit_code=$?
  if (( exit_code == 0 )) && cwd="$(<"$tmp")" && [[ -n "$cwd" && "$cwd" != "$PWD" ]]; then
    builtin cd -- "$cwd"
  fi
  rm -f -- "$tmp"
  return "$exit_code"
}
```

### 4. 可选：命令行代理

部分 CLI 不读取 macOS 系统代理。需要时把下面函数加入 `.zshrc`，端口改成代理软件实际提供的 HTTP/mixed 端口：

```zsh
proxy_on() {
  export HTTP_PROXY=http://127.0.0.1:7890
  export HTTPS_PROXY="$HTTP_PROXY" ALL_PROXY="$HTTP_PROXY"
  export http_proxy="$HTTP_PROXY" https_proxy="$HTTPS_PROXY" all_proxy="$ALL_PROXY"
  export NO_PROXY=localhost,127.0.0.1,::1,.local
  export no_proxy="$NO_PROXY"
}

proxy_off() {
  unset HTTP_PROXY HTTPS_PROXY ALL_PROXY http_proxy https_proxy all_proxy NO_PROXY no_proxy
}
```

代理软件启动后按需执行 `proxy_on`，关闭前执行 `proxy_off`；只影响当前终端和之后启动的子进程。内网地址按需加入 `NO_PROXY`，不同 CLI 对匹配规则的支持可能不同。

## 四、按项目安装语言环境

### 1. Node.js 与 pnpm

通过 nvm 管理 Node.js，不另用 `brew install node` 配置一套主力版本：

```bash
brew install nvm
mkdir -p ~/.nvm
```

重新打开终端，上一章会加载 nvm，再安装当前 LTS：

```bash
nvm install --lts
nvm alias default 'lts/*'
```

已有项目优先按 `.nvmrc` 安装：在项目目录执行 `nvm install`、`nvm use`。新终端默认版本与项目版本可以不同。

需要 pnpm 时，在当前 Node.js 环境中安装：

```bash
npm install --global pnpm@latest
pnpm setup
```

完成后重新打开终端。通过 npm 安装的全局工具跟随当前 nvm Node.js 版本，切换另一套 Node.js 后先确认命令仍可用。项目已指定包管理器版本时按其声明安装，不混用 npm、pnpm、Yarn 的锁文件。

### 2. Java：jenv 与 JDK

按项目需要选 JDK。以下用 17 演示，不代表每台新机都要装所有历史版本：

```bash
brew install jenv openjdk@17
```

重新打开终端，注册 JDK 并设置默认版本：

```bash
jenv add /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home
jenv enable-plugin export
jenv global 17
```

再次打开终端后，`JAVA_HOME` 由 jenv 的 export 插件跟随版本维护，不再额外写死。项目需要 21 时，再安装 `openjdk@21`、注册对应路径，并用 `jenv local 21` 创建项目的 `.java-version`。

仅当某个图形应用需要通过系统目录发现 JDK 时，额外注册符号链接；已有同名项时先检查：

```bash
sudo mkdir -p /Library/Java/JavaVirtualMachines
sudo ln -s /opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk \
  /Library/Java/JavaVirtualMachines/openjdk-17.jdk
```

这一步写入系统目录，不负责切换 jenv；可用 `/usr/libexec/java_home -V` 查看系统识别的 JDK。IDE 的项目 JDK 在 IDE 内单独选择。

### 3. Maven：优先使用项目 Wrapper

项目有 `mvnw` 时优先使用 `./mvnw`，由项目声明 Maven 版本；需要全局命令时安装：

```bash
brew install maven
```

Homebrew 会处理命令路径，无需配置 `M2_HOME` 或指向某个旧版本目录的 `MAVEN_HOME`。用 `mvn -v` 确认 Maven 及实际使用的 JDK。

通常直接使用默认本地仓库 `~/.m2/repository`。确实需要镜像时，创建用户配置目录并编辑 `~/.m2/settings.xml`：

```bash
mkdir -p ~/.m2
```

```xml
<settings xmlns="http://maven.apache.org/SETTINGS/1.0.0"
          xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
          xsi:schemaLocation="http://maven.apache.org/SETTINGS/1.0.0 https://maven.apache.org/xsd/settings-1.0.0.xsd">
  <mirrors>
    <mirror>
      <id>aliyun-central</id>
      <mirrorOf>central</mirrorOf>
      <url>https://maven.aliyun.com/repository/public</url>
    </mirror>
  </mirrors>
</settings>
```

这只替换 Maven Central；公司私服、凭据等按项目要求合并，避免用 `mirrorOf=*` 把所有仓库都转走。`~/.m2/settings.xml` 是用户配置，不是 Maven 安装目录内的全局配置。

### 4. Python：uv，独立 CLI 按需使用 pipx

```bash
brew install uv
uv python install
```

uv 管理 Python 版本和项目环境，项目自身依赖放在虚拟环境中。上面的 zsh 基础配置已加入 `~/.local/bin`，Homebrew 安装 uv 后无需加载其他安装器遗留的 `~/.local/bin/env`。

新机的独立 Python CLI 可以用 `uv tool install 包名`。已有工作流使用 pipx 时，再选择安装：

```bash
brew install pipx
pipx ensurepath
```

重新打开终端，例如执行 `pipx install poetry` 安装 Poetry。同一个 CLI 选择 uv 或 pipx 一种管理即可。

### 5. Rust：rustup

```bash
brew install rustup
```

重新打开终端，让 zsh 基础配置加入 rustup 的命令路径，再安装工具链：

```bash
rustup default stable
```

这会准备 Rust 编译器和 Cargo。不另装 Homebrew 的 `rust` 作为另一套主力工具链；有 `rust-toolchain.toml` 的项目遵循项目要求。

### 6. Go：一套版本或按项目管理

只需要一套 Go 时执行 `brew install go`。需要多版本时选择 goenv：

```bash
brew install goenv
```

重新打开终端，基础配置会初始化 goenv。用 `goenv install -l` 列出可安装版本，再执行 `goenv install 版本号`、`goenv global 版本号`；项目中用 `goenv local 版本号` 固定版本。

这里的“版本号”需要替换为项目要求的实际值。使用 goenv 时不额外手动写死 `GOROOT`；现代项目使用 Go Modules，通常无需更改默认 `GOPATH`。

### 7. Bun：按需安装

```bash
brew install oven-sh/bun/bun
```

使用 Homebrew 安装就不再复制另一套 `~/.bun/bin` 配置。Bun 与 Node.js 是不同运行时，是否使用由项目决定。

## 五、配置 Git 与 GitHub

### 1. 提交身份与登录

把下面占位内容替换为自己的提交姓名和邮箱：

```bash
git config --global user.name "你的名字"
git config --global user.email "you@example.com"
git config --global init.defaultBranch main
```

需要访问 GitHub 时，使用浏览器登录并配置 HTTPS 凭据：

```bash
gh auth login --git-protocol https --web
gh auth setup-git
gh auth status
```

Git 的提交身份与 GitHub 登录是两件事。公司 Git 服务按其要求配置；如果使用 SSH 远程地址，还需单独配置 SSH 密钥和访问权限。

### 2. 忽略 `.DS_Store`

`.DS_Store` 只是 Finder 的目录显示信息，不需要提交。先检查是否已有自定义全局忽略文件：

```bash
git config --global --get core.excludesFile
```

有输出就编辑该文件；没有配置时，创建 Git 默认用户忽略文件的目录：

```bash
mkdir -p "${XDG_CONFIG_HOME:-$HOME/.config}/git"
```

编辑 `${XDG_CONFIG_HOME:-$HOME/.config}/git/ignore`，加入：

```text
.DS_Store
```

规则对未跟踪文件生效，也适用于已有仓库中的未跟踪文件；已提交的文件不会自动取消跟踪。

## 六、数据库：按需安装与启动

优先遵循项目要求的数据库版本和运行方式；项目已通过 Docker 启动数据库时，通常不必再装一份同端口的本地服务。

### 1. PostgreSQL

这里以 17 为例：

```bash
brew install postgresql@17
```

它是 keg-only 安装，命令没有自动链接到常用命令目录。前面的 zsh 基础配置会将 `/opt/homebrew/opt/postgresql@17/bin` 加入 PATH，重新打开终端即可使用 `psql`。**加入 PATH 只是让终端找到命令，不会启动数据库。**

需要数据库时再启动并连接：

```bash
brew services run postgresql@17
psql -d postgres
```

`psql` 是命令行客户端，用来连接 PostgreSQL、执行 SQL 和查看数据，类似 MySQL 的 `mysql` 命令。服务端负责存储和管理数据，客户端是操作入口。

| `psql` 中的命令 | 用途 |
| --- | --- |
| `\l` | 列出数据库 |
| `\c 数据库名` | 切换数据库 |
| `\dt` | 列出当前数据库中的表 |
| `\d 表名` | 查看表结构 |
| `SELECT version();` | 执行 SQL，查看服务端版本 |
| `\q` | 退出客户端，不停止数据库服务 |

`pg_dump` 用于备份，`pg_restore` 用于恢复相应格式的备份，`createdb` 用于建库。使用图形客户端时，也可以不直接使用 `psql`。

### 2. MySQL

```bash
brew install mysql
brew services run mysql
mysql_secure_installation
```

向导用于首次设置 root 密码、移除匿名账户、限制 root 远程访问等，不是每次启动都要执行。已有数据或从备份恢复时，按相应流程处理，不重新初始化数据目录。

### 3. 启动与自启的区别

安装数据库本身不等于已经启动，也不等于配置了自启。下面用 MySQL 举例，PostgreSQL 将服务名换成 `postgresql@17`：

| 命令 | 行为 |
| --- | --- |
| `brew services run mysql` | 立即在后台运行，不设置登录自启 |
| `brew services start mysql` | 立即运行，并设置当前用户登录后自启 |
| `brew services stop mysql` | 停止服务，并取消自启 |
| `brew services list` | 查看服务状态 |

关闭终端通常不会停止 `run` 启动的服务；重启电脑后需重新启动。如果之前已配置自启，单独执行 `run` 不会取消它，取消时用 `stop`。这些命令按普通用户执行。

## 七、终端外观：Ghostty 与 Starship

### 1. 安装字体并生成提示符主题

```bash
brew install --cask font-maple-mono-nf-cn
mkdir -p ~/.config
```

首次创建提示符配置时生成 Catppuccin Powerline 预设；已有配置时先保留原文件，再决定是否替换：

```bash
starship preset catppuccin-powerline -o ~/.config/starship.toml
```

在生成文件中修改已有的对应段，不重复追加同名段：

```toml
[time]
disabled = false
time_format = "%R"
style = "bg:lavender"
format = '[[  $time ](fg:crust bg:lavender)]($style)'

[cmd_duration]
show_milliseconds = true
show_notifications = true
min_time_to_notify = 45000
```

这保留 24 小时时间和长任务通知。通知还需要系统授权；Powerline 图标需要终端使用 Nerd Font。只想要纯文本提示符时，可选择 `plain-text-symbols` 预设。

### 2. Ghostty 配置

创建配置目录：

```bash
mkdir -p ~/.config/ghostty
```

编辑 `~/.config/ghostty/config`：

```ini
font-family = Maple Mono NF CN
font-size = 14
adjust-cell-height = 2
font-thicken = true

theme = Catppuccin Mocha
background-opacity = 0.85
background-blur = true
macos-titlebar-style = transparent
macos-option-as-alt = true
window-padding-x = 10
window-padding-y = 8
window-save-state = always

cursor-style = bar
cursor-style-blink = true
mouse-hide-while-typing = true
copy-on-select = clipboard
clipboard-paste-protection = true

shell-integration = zsh
quit-after-last-window-closed = true
scrollback-limit = 25000000

keybind = cmd+d=new_split:right
keybind = cmd+shift+enter=toggle_split_zoom
```

`Cmd + D` 向右分屏，`Cmd + Shift + Enter` 放大或恢复当前分屏；通常用 `Cmd + Shift + ,` 重载配置。部分设置需重开窗口。Option 被作为 Alt 用于终端组合键，按自己的输入习惯决定是否保留。

## 八、验证并保存这次配置

### 1. 重新打开终端检查

只检查实际安装的工具。示例：

```bash
command -v brew git node java mvn rustc cargo uv bun go
brew --prefix
node --version
jenv version
java -version
mvn -v
rustup show
uv --version
bun --version
go version
```

Node 应来自 nvm，Java 通过 jenv shims 选择，Rust 使用 rustup；选择 goenv 时 Go 也应通过其 shims。IDE 中另外确认 SDK，并实际运行一个常用项目，验证依赖安装、构建和数据库连接。

### 2. 保存可迁移的配置

- 保留 `.zprofile`、`.zshrc`、Starship、Ghostty 和 Git 配置；`settings.xml` 等按实际需要保存。
- 将密钥、令牌和数据库备份单独管理；分享配置前去掉其中的凭据。
- 需要记录这次 Homebrew 选择时，可在自己的配置目录执行 `brew bundle dump --file=Brewfile`；以后用 `brew bundle --file=Brewfile` 恢复包清单。Brewfile 是可选的安装快照，步骤仍以本文和 Mac 应用清单为准。
- 包清单不会恢复项目数据、数据库内容、应用登录状态或所有 shell 配置，换机时分别处理。

## 参考

- [Homebrew 安装](https://brew.sh/)
- [Homebrew services](https://docs.brew.sh/Manpage#services-subcommand)
- [Ghostty 配置](https://ghostty.org/docs/config/reference)
- [Starship 预设](https://starship.rs/presets/)
- [uv 安装](https://docs.astral.sh/uv/getting-started/installation/)
- [Bun 安装](https://bun.sh/docs/installation)
- [goenv 初始化](https://github.com/go-nv/goenv/blob/master/INSTALL.md)
- [Maven settings.xml](https://maven.apache.org/settings.html)
