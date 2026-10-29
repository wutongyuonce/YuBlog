---
title: Collie 安装配置与卸载
description: 在 macOS 上安装 Tailscale、Herdr 和 Collie，把 Agent 终端显示到手机，并说明连接条件与卸载步骤。
pubDate: 2026-10-20
category: 教程
tags: [Collie, Tailscale]
titleImage: ./_title-images/collie-pwa.png
titleImageAlt: ColliePWA 官网首页截图，左侧是 Your terminal agents, on your phone，右侧是手机里的 Herdr 终端面板
toc: true
search: true
draft: false
---

[Collie](https://colliepwa.dev) 把 Mac 上 Herdr 里的 Agent 终端显示到手机。Mac 负责跑服务，手机用浏览器打开。手机可以看输出、回复、批准命令，也可以在这些终端里执行命令。它看不到 Mac 桌面，也不能点 Mac 上的窗口。

下面按 macOS 13+、Tailscale 独立版、Herdr 安装脚本、Collie 安装脚本来写。

## 安装

### 1. Mac 安装 [Tailscale](https://tailscale.com)

从 [tailscale.com/download](https://tailscale.com/download) 安装独立版，不要用 Mac App Store 版。打开后登录，允许添加 VPN 配置。再到 App 设置里安装命令行工具。

确认：

```bash
tailscale status
```

打开 [Tailscale DNS 设置](https://login.tailscale.com/admin/dns)，确认 MagicDNS 已开，并打开 HTTPS Certificates。不打开的话，后面发不出手机能用的 HTTPS 地址。

装到哪里：

- 程序：`/Applications/Tailscale.app`
- 命令：`/usr/local/bin/tailscale`

### 2. 手机安装 Tailscale

安装 Tailscale，用和 Mac 相同的账号登录，打开连接。手机和 Mac 不必在同一个 Wi-Fi。

Android 同时只能开一个 VPN。开 Tailscale 时，Clash、v2ray 这类代理会被关掉。再打开它们，Tailscale 就会断开。连 Collie 不需要那个代理。

手机可能额外需要做：

1. 设置里把 Tailscale 设为「始终开启的 VPN」。
2. Tailscale 的耗电管理选「不限制」。
3. 私人 DNS 设为「自动」或「关闭」。Tailscale App 里打开 Use Tailscale DNS。

### 3. Mac 安装 Herdr

```bash
curl -fsSL https://herdr.dev/install.sh | sh
herdr
```

`herdr` 会打开终端面板。在面板里进入项目目录，再启动已安装的 Agent，例如 `claude`、`codex` 或 `pi`。离开这个窗口也可以，不要退出 Herdr。

普通 Terminal 或 iTerm 里启动的 Agent，Herdr 看不到，手机上也没有。

装到哪里：

- 程序：`~/.local/bin/herdr`
- 配置和运行状态：`~/.config/herdr/`
- 另一份状态：`~/.local/state/herdr/`

shell 找不到 `herdr` 时，把下面这行写入 `~/.zshrc`，再开一个终端：

```bash
export PATH="$HOME/.local/bin:$PATH"
```

### 4. Mac 安装 Collie

另开一个终端：

```bash
curl -fsSL https://colliepwa.dev/install.sh | sh
COLLIE_MUX=herdr collie start
```

`COLLIE_MUX=herdr` 会写入配置，以后只运行 `collie start`。成功后 `collie status` 会打印两个地址，手机用下面那个 `tailnet` 地址。

装到哪里：

- 程序：`~/.local/share/collie/`
- 命令链接：`~/.local/bin/collie`
- 开机服务：`~/Library/LaunchAgents/herdr.collie.plist`
- 配置：`~/.config/herdr/plugins/config/herdr.collie/`
- 配对记录：`~/.local/state/collie/`
- 本机只监听：`127.0.0.1:8787`

本机已经装了 Herdr，所以配置不在 `~/.config/collie/`。

### 5. 手机打开并配对

Mac 上查看地址：

```bash
collie url
collie qr
```

手机用 Chrome 打开这个地址。必须是完整的 `https://机器名.tailnet.ts.net`。

不要打开这三种地址，它们都会被拒绝：

- `http://...`：走 80 端口，没有服务
- 地址后面加 `:8787`：这个端口只在 Mac 本机
- `127.0.0.1`：这是手机自己

页面里的 Install 在手机上可能没反应。用 Chrome 右上角菜单的「添加到主屏幕」或「安装应用」。菜单里没有时，先到系统设置给 Chrome 打开「创建桌面快捷方式」权限。

然后在 Mac 上生成配对码：

```bash
collie pair
```

码的有效期是 10 分钟。手机打开 Settings → System → Paired devices，输入码和设备名。从哪个入口使用，就在那个入口里配对。iPhone 的主屏幕图标和 Safari 不是同一份存储。

确认：

```bash
collie status
collie doctor
tailscale serve status
```

`collie status` 不应再提示没有配对设备。`tailscale serve status` 应显示 tailnet 域名转到 `http://127.0.0.1:8787`。手机上应能看到 Herdr 里的面板。

## 连接

手机能连上，需要同时满足：

1. Mac 已登录，并且没有睡眠。合盖通常会睡，远程访问会停。临时防止空闲睡眠可以运行 `caffeinate -i`，用完按 `Ctrl+C`。
2. Mac 上 Herdr 和 Collie 都在运行。检查用 `collie status`。
3. 手机和 Mac 的 Tailscale 都是 Connected。两边有网即可，不要求同一 Wi-Fi，用流量也可以。
4. 手机打开的是 `collie url` 打印的 `https://` 地址。
5. 这台手机已经配对。没配对时，页面打得开，但看不到面板。

距离没有限制。两边都联网、Tailscale 都连着，就可以连。

连上之后能做的事：看 Herdr 面板、给 Agent 发消息、批准或拒绝操作、在终端里输入命令。命令以当前登录 Mac 的用户执行。

连不上时先看这几项：

- 手机 Tailscale 被另一个 VPN 挤掉了。先关掉代理 VPN，再打开 Tailscale。
- 页面写着 No connection to the bridge。Mac 服务可能还在，是手机浏览器没有走 Tailscale。确认地址栏域名正确，Chrome 没有被排除在 Tailscale 之外，WLAN 代理设为「无」。
- 页面写着拒绝连接。几乎都是地址错了，回到上面的 `https://` 地址。

暂时不用时：

```bash
collie stop
```

这只停 Collie 服务和它发布的入口，不删程序和配对。恢复用 `collie start`。

撤销一台手机：

```bash
collie devices list
collie devices revoke "设备名"
```

## 卸载

只卸不用的那一层。下面的命令不删除项目目录，也不删除 `~/.claude`、`~/.codex`、`~/.pi` 里的会话记录。

### 只卸 Collie

Herdr 和 Tailscale 留下。

```bash
collie uninstall
collie unlink
rm -rf ~/.local/share/collie
rm -rf ~/.local/state/collie
rm -rf ~/.config/herdr/plugins/config/herdr.collie
```

各条分别做的事：

1. `collie uninstall`：停进程，删除 `~/Library/LaunchAgents/herdr.collie.plist`，撤掉 Collie 发布的 `tailscale serve`。程序和配对记录还在。
2. `collie unlink`：删除 `~/.local/bin/collie`。
3. 后三条：删除程序、配对记录、配置。想保留配对就不要删 `~/.local/state/collie`。

确认已经卸干净：

```bash
tailscale serve status
launchctl print "gui/$(id -u)/herdr.collie"
```

第一条不应再有 Collie 的映射。第二条应提示服务不存在。

### 继续卸 Herdr

先卸它写进 Agent 的集成。这台机器装过这三个：

```bash
herdr integration uninstall claude
herdr integration uninstall codex
herdr integration uninstall pi
```

这只删除对应的 hook 或扩展文件。然后停服务并删除程序：

```bash
herdr server stop
rm -f ~/.local/bin/herdr
rm -rf ~/.config/herdr ~/.local/state/herdr
```

`~/.config/herdr` 是配置、日志、控制 socket 和会话快照。`~/.local/state/herdr` 是另一份状态。两处都不是项目目录。

Herdr 没有官方卸载命令。如果当初是 `brew install herdr`，改用 `brew uninstall herdr`，不要再手动删 Homebrew 的文件。

### 最后卸 Tailscale

还要用 Tailscale 做别的事，就停在这里。

Mac 上这是独立版：

1. 退出 Tailscale。
2. 把 `/Applications/Tailscale.app` 拖进废纸篓，确认系统扩展一并删除。
3. 打开系统设置 → 网络 → VPN。如果还留着 Tailscale，删除这个配置。

要连本机登录状态一起清掉，再删除下面这些存在的路径。有的文件属 root，需要 `sudo`。

```bash
rm -rf ~/Library/Application\ Scripts/*.io.tailscale.ipn.macsys
rm -rf ~/Library/Application\ Scripts/io.tailscale.ipn.macsys
rm -rf ~/Library/Application\ Scripts/io.tailscale.ipn.macsys.login-item-helper
rm -rf ~/Library/Application\ Scripts/io.tailscale.ipn.macsys.share-extension
rm -rf ~/Library/Caches/io.tailscale.ipn.macsys
rm -rf ~/Library/Containers/io.tailscale.ipn.macsys
rm -rf ~/Library/Containers/io.tailscale.ipn.macsys.login-item-helper
rm -rf ~/Library/Containers/io.tailscale.ipn.macsys.share-extension
rm -rf ~/Library/Containers/Tailscale
rm -rf ~/Library/Group\ Containers/*.io.tailscale.ipn.macsys
rm -rf ~/Library/HTTPStorages/io.tailscale.ipn.macsys
rm -f  ~/Library/Preferences/io.tailscale.ipn.macsys.plist
sudo rm -rf /Library/Tailscale
```

打开钥匙串，搜索 `tailscale`，删除相关条目，包括 `tailscale-machinekey`、`tailscale-logdata`、`tailscale-preferences`。清掉之后重新安装，会得到新的 tailnet 地址。

手机：

1. 卸载 Tailscale。
2. 长按桌面上的 Collie 图标并删除。
3. 在 Chrome 里清除这个 `*.ts.net` 站点的数据。

最后到 [Tailscale 管理后台](https://login.tailscale.com/admin/machines) 删除已经不存在的设备。
