---
title: 本机 Homebrew 工具笔记
description: 记录 Apple Silicon Mac 上主动安装的 Homebrew 工具、开发环境分层与常用命令。
pubDate: 2026-02-02
lastModDate: ''
tags: [macOS]
toc: true
search: true
draft: false
---

核对时间：2026-09-04。只记你**主动装过**的 formula，不记 openssl、sqlite 这类依赖。Apple Silicon，前缀是 `/opt/homebrew`。没有 cask。

---

## 1. 先把 Homebrew 本身用起来

Homebrew 是 macOS 上的包管理器。它装的东西分两种：

- **formula**：命令行程序和库，在终端里跑。你现在装的全是这个。
- **cask**：带图形界面的 App 或字体。这台机器上目前是空的。

`brew leaves` 列的是「你主动要的包」。`brew list` 会连依赖一起列，很长，日常看 leaves 就够。

```bash
brew --prefix          # /opt/homebrew
brew leaves -r         # 主动安装的包
brew list --versions   # 带版本
brew outdated          # 有新版本可升
brew upgrade git       # 只升某一个
brew uninstall 包名
brew info 包名         # 主页、依赖、是否过时
brew services list     # 后台服务（MySQL / Postgres）
```

升级前先看 `brew info`。数据库和 JDK 不要随手 `brew upgrade`，数据和项目编译级别会变。

**keg-only**：装了但不会链到 `/opt/homebrew/bin`。macOS 自己已经有一份同名库时（以前的 zlib），Homebrew 会故意不覆盖系统的，避免编译乱链。

**brew services**：给 MySQL、Postgres 这种守护进程用。`none` 表示没开机自启、现在也没在跑。

---

## 2. 这台机器上的分层

从上到下，日常开发实际碰到的是上面几层：

```
提示符 / 终端复用     starship, tmux, yazi, glow, fastfetch
语言与运行时          nvm → Node, jenv → JDK 11/17/21, rustup → rustc, pipx
包管理                pnpm, pipx, cargo（随 rustup）
代码与 Git            git, gh, lazygit
数据                  mysql, postgresql@17
搜、下、转            fd, ripgrep, wget, httpie, nmap, pandoc, sox
本机维护              mole, terminal-notifier
```

Node **不要**再用 Homebrew 的 `node`。这台机器走 nvm，当前是 `v22.22.2`。brew 那份已经卸掉，避免两个 `node` 抢 PATH。

Java 走 jenv。默认 **17**，11 和 21 都还在。11 的 brew formula 已标记过时，但 2032 年才从 brew 移除；没有 Java 11 项目就不必动。

---

## 3. 开发环境

### 3.1 git / gh / lazygit

> https://yuluyao.com/tools/lazygit

`git` 管仓库本身。`gh` 是 GitHub 的 CLI（issue、PR、CI）。`lazygit` 是全键盘的 Git 面板，比记一堆 `git` 子命令快。

```bash
git status
git switch -c feat/foo
git log --oneline -10

gh auth status
gh repo view --web
gh pr create --fill
gh run list --limit 5

lazygit
```

lazygit 里空格选文件，`c` 提交，`P` 推送，`q` 退出。第一次跑会用到 Git 配置和 GitHub 登录状态，没有的话先 `gh auth login`。

### 3.2 nvm 和 pnpm

nvm 在 `~/.nvm` 里并排放多个 Node，不污染系统。`~/.zshrc` 已经 `source` 了 nvm。pnpm 是 Node 包管理器，全局包在 `~/Library/pnpm`。

```bash
nvm ls                 # 已装版本，箭头是当前
nvm ls-remote 22       # 看 22 有哪些小版本
nvm install 22         # 没有才装
nvm use 22             # 当前终端切到 22
nvm alias default 22   # 新开终端默认 22

node -v                # 应该是 ~/.nvm/.../node，不是 /opt/homebrew/bin/node
which node

pnpm -v
pnpm init
pnpm add lodash
pnpm add -D typescript
pnpm run build
pnpm dlx cowsay hello  # 临时跑一个包，不装进项目
```

项目根放 `.nvmrc`，内容一行 `22`，进目录后 `nvm use` 就会对齐。

### 3.3 jenv 和三套 JDK

shim：名叫 `java` / `javac` 的小转发脚本。你敲 `java` 时，jenv 根据「这个目录 / 这个用户默认」决定转到 11、17 还是 21。

```bash
jenv versions          # * 是当前默认
java -version          # 应和 jenv 的 * 一致

jenv global 17         # 用户默认
jenv local 21          # 只对当前目录，会写 .java-version
jenv shell 11          # 只对当前这个终端
```

Maven 不在 brew 里，在 `~/maven/apache-maven-3.9.9`，`M2_HOME` 已经写进 `~/.zshrc`。换 Maven 版本改那一处。

确认当前链路：

```bash
jenv version
mvn -v                 # 应看到 Java version: 17.x
```

卸 11 的步骤（确定没项目要用再做）：

```bash
jenv remove 11
brew uninstall openjdk@11
```

### 3.4 rustup

rustup 是 Rust 官方工具链管理器（像 nvm 一样可以并存多套编译器）。本机用 Homebrew 装 `rustup`（keg-only），**不再**装 `rust` formula。`~/.zshrc` 里已把 `/opt/homebrew/opt/rustup/bin` 加进 PATH；`rustc` / `cargo` 也是这里的转发脚本，真正工具链在 `~/.rustup`。

当前默认：**stable**，`rustc 1.98.1`。

```bash
which rustc cargo rustup     # 都应该在 /opt/homebrew/opt/rustup/bin
rustc --version
cargo --version
rustup show                  # 已装 toolchain 和当前活跃的那套

rustup toolchain install nightly
rustup default stable        # 用户默认
rustup override set nightly  # 只对当前目录，会写 rust-toolchain
rustup update                # 升编译器（rustup 本身仍用 brew upgrade rustup）

cargo new hello --bin
cd hello
cargo run
cargo add serde
```

`cargo run` 编译并执行 `src/main.rs`。不要再 `brew install rust`，会和 rustup 抢 `cargo`。

### 3.5 pipx

把 Python CLI 装进独立虚拟环境，避免 `pip install --user` 把包搅在一起。和 brew 的 `httpie` 不冲突：brew 装的是系统级公式，pipx 装的是 Python 包。

```bash
pipx list
pipx install poetry
pipx upgrade-all
pipx uninstall poetry
```

只是「我要用某个 Python 命令行工具」，优先 pipx，不要为了它去污染当前项目的 venv。

---

## 4. 数据库

两个库的 **brew services 都是 none**：没在跑、也没开机自启。数据目录还在，启动才会占用端口。

### 4.1 mysql 9.6.0

数据在 `/opt/homebrew/var/mysql`。里面已经有库：`band_management`、`fire_detection`。不要 `brew uninstall mysql`，那会动数据。

```bash
brew services start mysql      # 启动并设为开机自启
brew services run mysql        # 只启动，不开机自启
brew services stop mysql

mysql -u root                  # 本机默认常见是无密码 root，不行再试 -p
mysql -u root -e "SHOW DATABASES;"
```

进库之后：

```sql
SHOW DATABASES;
USE band_management;
SHOW TABLES;
```

连不上先看服务是不是 `started`：`brew services list`。端口默认 3306。

### 4.2 postgresql@17 17.11

已从 `@14` 迁过来。旧集群里只有默认库，没有业务数据。现在数据在 `/opt/homebrew/var/postgresql@17`，`psql` 已 link 到 17。服务默认关着。

```bash
brew services start postgresql@17   # 启动并设为开机自启
brew services run postgresql@17     # 只启动
psql postgres                       # 连默认库
psql postgres -c '\l'               # 列数据库
brew services stop postgresql@17
```

连不上先看 `brew services list`。端口默认 5432。不要再 `brew install postgresql@14`。Homebrew 还有 `@18`（当前最新），没必要再跳。

---

## 5. 终端

### 5.1 starship 1.26.0

跨 shell 的提示符，已经写在 `~/.zshrc` 末尾：

```bash
eval "$(starship init zsh)"
```

新开终端生效。配置文件是 `~/.config/starship.toml`，没有就用默认。生成一份默认配置：

```bash
starship preset nerd-font-symbols -o ~/.config/starship.toml
```

这台机器上的 Hack Nerd Font 已经卸了。提示符里的图标若是方框，要么换一套 Nerd Font，要么用纯 ASCII 的 preset：

```bash
starship preset plain-text-symbols -o ~/.config/starship.toml
```

### 5.2 yazi 26.9.1

> https://imwnk.cn/archives/yazi-file-manager-guide/

终端文件管理器。比 `cd` + `ls` 快在：预览、批量改名、把路径喂给下一个命令。

```bash
yazi
yazi ~/Desktop
```

进了之后：`hjkl` 或方向键移动，`Enter` 打开，`q` 退出。想让退出后 shell 停在当前目录，用官方包装函数（可之后再加进 zshrc）：

```bash
function y() {
  local tmp="$(mktemp -t "yazi-cwd.XXXXXX")"
  yazi "$@" --cwd-file="$tmp"
  if [ -f "$tmp" ]; then
    local cwd="$(cat -- "$tmp")"
    [ -n "$cwd" ] && [ "$cwd" != "$PWD" ] && cd -- "$cwd"
    rm -f -- "$tmp"
  fi
}
```

### 5.3 glow 3.0.0

在终端里渲染 Markdown，比 `cat README.md` 可读。

```bash
glow README.md
glow -p README.md          # 分页，长文用这个
glow .                     # 当前目录挑一个 md
```

### 5.4 fastfetch 2.57.0

打出本机摘要：系统、CPU、内存、Shell。比 neofetch 快。

```bash
fastfetch
fastfetch -l none          # 不要左边的 logo
```

### 5.5 mole 1.41.0

Mac 清理工具（缓存、卸载残留）。交互式入口：

```bash
mole
mole clean
```

清理前看它列了什么再确认。不要在它扫的时候手动删同一批目录。

### 5.6 terminal-notifier 3.1.0

命令跑完弹一条 macOS 通知。适合长时间任务。

```bash
terminal-notifier -title "构建" -message "mvn package 完成"
sleep 2 && terminal-notifier -message "两秒到了"
```

配合 `&&`：

```bash
mvn -q test && terminal-notifier -message "测试通过" || terminal-notifier -message "测试失败"
```

---

## 6. 搜、下、请求、扫描

### 6.1 fd 10.3.0

按文件名找。默认忽略 `.gitignore` 和隐藏文件，比 `find` 少噪音。

```bash
fd Cargo.toml
fd -e rs src               # 只看 rs
fd -H .env                 # 连隐藏文件
fd '^pom\.xml$'            # 正则
```

结果是一条路径一行，可以接 `xargs` 或 `fzf`。

### 6.2 ripgrep 15.1.0（命令是 `rg`）

按文件内容搜。同样尊重 `.gitignore`。

```bash
rg "TODO"
rg -n "jenv init" ~/.zshrc
rg -t java "public class"   # 只搜 Java
rg -i "band_management"     # 忽略大小写
rg --files | rg "Test"      # 先列文件再过滤名字
```

`-n` 出行号。大仓库里这是默认搜索器。

### 6.3 tree 2.3.2

| tree命令  | 用途                                  |
| --------- | ------------------------------------- |
| `tree -d` | **仅显示目录**，不显示文件            |
| `tree -a` | **显示隐藏文件**（以 `.` 开头的文件） |

```bash
tree -L 2                  # 只两层
tree -L 2 -I node_modules
tree -d -L 3               # 只目录
```

### 6.4 wget 1.25.0

```bash
wget https://example.com/file.tar.gz
wget -O out.zip URL        # 指定文件名
wget -c URL                # 断点续传
```

### 6.5 httpie 3.2.4

比 curl 好读的 HTTP 客户端。方法、URL、头、JSON 体都用空格拼。

```bash
https get https://httpbingo.org/get
https get https://httpbingo.org/get name==Ada
https post https://httpbingo.org/post X-Token:abc name=Ada
```

`https` 是 https 协议的入口；纯 http 用 `http`。JSON 对象用 `:=`：

```bash
https post https://httpbingo.org/post count:=3 ok:=true
```

### 6.6 nmap 7.98

端口和主机发现。只扫你有权限的网段。本机自检：

```bash
nmap localhost
nmap -p 3306,5432 localhost    # 看数据库端口开没开
```

`-sn` 是 ping 扫描（只看谁在线，不探端口）。对非自己的网络不要扫。

---

## 7. 文档和音频

### 7.1 pandoc 3.8.3

标记格式互转。Markdown 出 HTML / docx 最常用。

```bash
pandoc README.md -o README.html
pandoc notes.md -o notes.docx
pandoc notes.docx -o notes.md
pandoc notes.md -o notes.pdf   # 需要本机有 LaTeX 或其它 PDF 引擎，没有会报错
```

`-s` 表示独立文件（带 html 头），默认片段没有。

```bash
pandoc -s notes.md -o notes.html
```

### 7.2 sox 14.4.2

音频转换和处理。`sox 输入 输出` 按扩展名决定格式。

```bash
sox in.wav out.mp3
sox in.wav out.wav trim 0 10     # 前 10 秒
sox in.wav out.wav rate 16000    # 改采样率
sox --i in.wav                   # 看格式信息
```

没有对应编码器时会报错（比如缺 mp3 支持），那是格式问题，不是 sox 没装好。

---

## 8. 日常会踩的坑

1. **两个 Node**
   PATH 里 nvm 必须排在 `/opt/homebrew/bin` 前面。`which node` 应指向 `~/.nvm/versions/node/...`。不要再 `brew install node`。

   同理 Rust：`which rustc` 应指向 `/opt/homebrew/opt/rustup/bin/rustc`。不要再 `brew install rust`。

2. **Java 版本对不上 Maven**
   `java -version` 和 `mvn -v` 里的 Java version 都要看。目录里有 `.java-version` 时 jenv 会覆盖 global。

3. **数据库「突然连不上」**
   先 `brew services list`。这台机器默认是关着的，不是坏了。

4. **Postgres 大版本**
   已是 17。别再装 `@14`。升到 `@18` 要做数据目录迁移，不要和日常 `brew upgrade` 混在一起。

5. **starship 图标是方块**
   终端字体不是 Nerd Font。改 preset 或换字体，不要以为 starship 坏了。

6. **`brew cleanup` 和 `brew upgrade` 不是一回事**
   cleanup 只删缓存和旧 keg；upgrade 才动正在用的版本。JDK、MySQL 不要和 CLI 小工具一起无脑 upgrade。

---

## 9. 本机清单（主动安装）

| 包 | 版本 | 命令 | 一句话 |
|---|---|---|---|
| git | 2.52.0 | `git` | 版本管理 |
| gh | 2.98.0 | `gh` | GitHub CLI |
| lazygit | 0.64.1 | `lazygit` | Git 终端 UI |
| nvm | 0.40.3 | `nvm` | 多版本 Node |
| pnpm | 11.1.1 | `pnpm` | Node 包管理 |
| jenv | 0.6.0 | `jenv` | 多版本 Java |
| openjdk@11 | 11.0.29 | `java`（经 jenv） | 过时，可留可卸 |
| openjdk@17 | 17.0.17 | 同上 | **当前默认** |
| openjdk@21 | 21.0.11 | 同上 | 新项目可选 |
| rustup | 1.29.1 | `rustup` / `cargo` / `rustc` | Rust 工具链管理器（默认 stable 1.98.1） |
| pipx | 1.16.2 | `pipx` | 隔离的 Python CLI |
| mysql | 9.6.0 | `mysql` | 有数据，服务默认关 |
| postgresql@17 | 17.11 | `psql` | 服务默认关 |
| starship | 1.26.0 | （zsh 启动时加载） | 提示符 |
| tmux | 3.7b | `tmux` | 终端复用 |
| yazi | 26.9.1 | `yazi` | 终端文件管理 |
| glow | 3.0.0 | `glow` | 终端 Markdown |
| fastfetch | 2.57.0 | `fastfetch` | 系统信息 |
| mole | 1.41.0 | `mole` | Mac 清理 |
| terminal-notifier | 3.1.0 | `terminal-notifier` | 系统通知 |
| fd | 10.3.0 | `fd` | 按文件名搜 |
| ripgrep | 15.1.0 | `rg` | 按内容搜 |
| tree | 2.3.2 | `tree` | 目录树 |
| wget | 1.25.0 | `wget` | 下载 |
| httpie | 3.2.4 | `http` / `https` | HTTP 客户端 |
| nmap | 7.98 | `nmap` | 端口扫描 |
| pandoc | 3.8.3 | `pandoc` | 文档格式转换 |
| sox | 14.4.2 | `sox` | 音频处理 |

已从本机移除、不必再找的：Homebrew `node`（改用 nvm）、Homebrew `rust`（改用 rustup）、`postgresql@14`（改用 `@17`）、`tldr`、`zlib`、oh-my-zsh 相关的 `zsh-completions`。

---

## 10. 下一步

- `which node`、`jenv version`、`mvn -v` 对一下，确认 Node / Java 链路。
- 要用 MySQL 时再 `brew services start mysql`，用完可以停。
- 要用 Postgres 时再 `brew services start postgresql@17`，用完可以停。
