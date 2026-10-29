---
title: 《塞尔达传说：王国之泪》Mac 原生运行 — 小白完整移植教程
description: 用 MacNativeGames 把自有的《王国之泪》游戏文件打包成原生 Mac App：环境准备、构建、快捷键、存档与缓存位置、卸载与常见问题。
pubDate: 2026-10-29
category: 教程
tags: [王国之泪]
titleImage: ./_title-images/totk-key-art.png
titleImageAlt: 《塞尔达传说：王国之泪》官方主视觉：林克站在空岛边缘，眺望浮空群岛与夕阳
toc: true
search: true
draft: false
---

> 本教程基于开源项目 [MacNativeGames](https://github.com/ly05010419/MacNativeGames)。

---

## 先看这里：了解我们做了什么

- **这不是模拟器。** 游戏的 ARM64 代码直接跑在苹果芯片上，Switch 系统服务由一个小型宿主程序应答，Switch 的 NVN 图形接口被重建在 Metal 上。所以性能远好于模拟器：实测约 **90 FPS**（菜单 120 FPS），支持 MetalFX 2K 画质。
- 本教程会教你把**你自己的**游戏文件打包成一个原生 Mac App（`塞尔达传说：王国之泪.app`），双击即玩。

### 你需要准备

| 项目 | 要求 |
|---|---|
| 电脑 | Apple 芯片 Mac（M1 及之后的所有型号） |
| 系统 | macOS 26 或更高（图形需要 Metal 4）。macOS 15 用户可用社区 fork（见文末） |
| 内存 | 建议 16 GB 及以上 |
| 硬盘 | 建议预留 45–55 GB：原始 NSP 约 17 GB、成品 App 约 18 GB，构建时还会临时产生中间文件；当前构建结束后的 `TOTK_build` 约 289 MB |
| 网络 | 需要联网下载构建工具（约几百 MB） |
| 游戏 | 你拥有的《王国之泪》正版：本体 1.0.0 的 XCI 或 NSP 文件 |

---

## 一、准备三样文件

整个移植只需要**三样东西**，都来自你自己的 Switch（法律要求：必须拥有正版游戏，密钥和系统文件必须从自己的机器导出）：

### 1. 游戏本体 1.0.0（NSP 或 XCI）

- 文件名通常长这样：`[APP][The Legend of Zelda Tears of the Kingdom][1.0.0][0100F2C0115B6000].nsp`
- 关键是**本体必须是 1.0.0 版本**（标题 ID `0100F2C0115B6000`）。之后的版本靠第 2 项"更新包"升上去。
- ⚠️ 不支持：DLC 合并包、压缩格式的本体（NSZ/XCZ）、个性化票据的 NSP。

### 2.（可选但推荐）累计更新包

- 想玩 1.1.2 / 1.2.1 / 1.4.3 版本，需要对应的独立更新 NSP/NSZ，例如：
  `[UPD][The Legend of Zelda Tears of the Kingdom][1.2.1][0100F2C0115B6800].nsp`
- 1.2.1 是玩家最多的版本。直接从 1.0.0 本体 + 1.2.1 更新包构建即可，**不需要**中间版本。

### 3. 密钥文件 `prod.keys`

- 从你自己的 Switch 导出（常用工具：Lockpick_RCM，需要可注入的自制固件环境）。导出后通常是 `sd卡根目录/switch/prod.keys`。
- 只需要 `prod.keys` 这一个文件（`title.keys` 不需要）。

### 4. 固件包（仅 NSP 本体需要）

- NSP 文件里不含系统共享字体，需要一份 Switch 固件包（如 `Firmware.22.1.0.zip`，解压后是一堆 `.nca` 文件）。
- XCI 本体自带系统更新分区，通常可以不用固件。

> 💡 固件和密钥都只在你自己的电脑上使用，构建工具不会下载、也不会上传它们。

---

## 二、安装构建环境（只需一次）

打开"终端"（启动台 → 其他 → 终端），逐条粘贴运行：

### 1. 安装 Xcode 命令行工具

```sh
xcode-select --install
```

弹出窗口点"安装"，等待完成（已有 Xcode 的可跳过）。

### 2. 安装 Homebrew（Mac 的包管理器）

```sh
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

装完后按提示把 brew 加入 PATH（国内网络可搜索"Homebrew 国内镜像"换源加速）。

### 3. 安装三个依赖库

```sh
brew install opus libvpx python@3.14
```

### 4.（推荐）安装 Metal 工具链

如果你装了完整版 Xcode，运行：

```sh
xcodebuild -downloadComponent MetalToolchain
```

有它的话，构建会把启动着色器直接编译进 App，之后**把 App 移动到任何位置（比如"应用程序"文件夹）都不用重新编译着色器**。没有它也能玩，只是移动 App 后首次启动要重新编译几分钟。

---

## 三、获取项目代码

```sh
cd ~/Downloads
git clone https://github.com/ly05010419/MacNativeGames.git
```

（没有 git 会自动提示安装，装完重试即可。）

---

## 四、解压固件

把固件 zip 解压成一个文件夹，里面应该直接是几百个 `.nca` 文件：

```sh
cd ~/Downloads
unzip Firmware.22.1.0.zip -d Firmware.22.1.0
```

---

## 五、构建 App（核心步骤，就一条命令）

假设文件这样摆放（可自行调整路径）：

```
~/Downloads/塞尔达传说：王国之泪/
  ├─ [APP][The Legend of Zelda Tears of the Kingdom][1.0.0][0100F2C0115B6000].nsp
  └─ [UPD][The Legend of Zelda Tears of the Kingdom][1.2.1][0100F2C0115B6800].nsp
~/Downloads/Keys-22.1.0/prod.keys
~/Downloads/Firmware.22.1.0/   ← 解压后的 .nca 文件夹
~/Downloads/MacNativeGames/
```

进入项目目录，运行构建脚本：

```sh
cd ~/Downloads/MacNativeGames

python3.14 build_app.py \
  "~/Downloads/塞尔达传说：王国之泪/[APP][The Legend of Zelda Tears of the Kingdom][1.0.0][0100F2C0115B6000].nsp" \
  -k "~/Downloads/Keys-22.1.0/prod.keys" \
  --update "~/Downloads/塞尔达传说：王国之泪/[UPD][The Legend of Zelda Tears of the Kingdom][1.2.1][0100F2C0115B6800].nsp" \
  --firmware "~/Downloads/Firmware.22.1.0" \
  -o "~/Downloads/塞尔达传说：王国之泪.app"
```

**命令解读（不用背，看得懂就行）：**

| 参数 | 含义 |
|---|---|
| 第 1 个路径 | 游戏本体 1.0.0 |
| `-k` | 你的 prod.keys 密钥文件 |
| `--update` | 更新包（想要哪个版本就给哪个包：1.1.2 / 1.2.1 / 1.4.3） |
| `--firmware` | 固件解压目录（NSP 本体必填；XCI 可省略） |
| `-o` | 输出的 App 位置和名字。想装进"应用程序"，直接写 `-o /Applications/塞尔达传说：王国之泪.app` |

**构建过程**（脚本会自动完成，日志实时显示进度）：

1. 校验更新包哈希（日志出现 `update identified ... 1.2.1` 即成功识别）
2. 提取并改写游戏代码模块适配 Apple 芯片（`1/4 code`，约 5 分钟）
3. 解密并重新打包 17 GB 游戏数据（`2/4 data`，含本体+更新合并与完整性校验，约 8 分钟）
4. 准备启动着色器并为本机 GPU 预编译（`3/4 shaders`，最耗时的一步；当前构建约 30,160 个，实际数量会随游戏版本和工具链变化）
5. 组装 App、签名并等待 macOS 安全检查（`4/4 app`，约 6 分钟）

> **实测参考**（Apple M5，24 GB，构建 1.0.0 + 1.2.1）：成品 App 约 **18 GB**。本轮在已有 18 GB 游戏数据的基础上重新组装，耗时约 **5 分 15 秒**；全新首次构建仍会明显更久，具体取决于 Metal 工具链、磁盘和是否已有可用缓存。
>
> 如果中途报错停止，先看日志最后一行：常见原因是密钥不对、更新包版本不支持、或磁盘空间不足。修正后**直接重跑同一条命令**即可，已完成的步骤会复用，不会从头再来。
>
> 这台机器的构建目录是 `/Users/a/Desktop/WorkSpace/王国之泪-Mac/游戏1.2.1/TOTK_build`，构建结束后当前只有约 **289 MB**，保存的是提取、改写、打包和着色器种子等中间文件。确认成品 App 可以正常启动和游玩后，即可删除 `TOTK_build`；删除**不会**影响已安装的 App、`profile` 存档或本机管线缓存。保留它的意义是以后重打包、升级或排错时少做重复工作。

---

## 六、首次启动

1. 在访达（Finder）中找到 `塞尔达传说：王国之泪.app`。
2. **第一次打开**：因为 App 未经苹果公证，直接双击若提示"无法打开/已损坏"，请**右键点击 App → 打开 → 再点"打开"**。仍不行时到"系统设置 → 隐私与安全性"页面底部点"仍要打开"。
3. 启动时先做游戏资源校验和初始化。本次构建已把约 30,160 个**启动着色器**预编译进 App，不需要再做一次 30–50 分钟的整库预热；进度条若显示“预热着色器与管线”，处理的是当前 Mac 需要创建的**管线缓存**，首次通常更慢，缓存完成后会明显加快。新场景遇到尚未缓存的管线时可能现场编译一次，请耐心等待，不要强退。
4. 看到标题画面，就可以开玩了！🎉

> 💡 建议把 App 拖到“应用程序”文件夹统一管理。有 Metal 工具链时，启动着色器已随 App 打包（当前约 440 MB），移动位置后不需要重新构建这部分内容；若构建时未装 Metal 工具链，移动后的第一次启动会在后台编译着色器（几分钟），属正常现象。启动着色器、本机管线缓存和存档是三类不同的数据，位置见第八节。

---

## 七、操作说明

### Mac 快捷键（游戏中按数字键）

| 按键 | 功能 |
|---|---|
| **1** | 循环切换右上角信息框：全部显示（FPS/分辨率/着色器数）→ 只显示 FPS → 隐藏 |
| **2** | 补帧切换：关 → 30+30 → 刷新率一半 → 不限帧 |
| **3** | 画质切换：MetalFX 2K → 原生 2K → 关闭（选择会记住） |
| **4** | 画面比例：16:9 → 适配窗口 → 21:9 超宽 → 16:9 |
| **5** | 边缘平滑（抗锯齿）开/关 |
| **6** | 手柄类型：自动 → Xbox → PlayStation → Switch |
| **7** | 鼠标模式开/关（鼠标转视角；左键攻击、右键拉弓、中键锁定） |

### 键盘键位

| 按键 | Switch 对应 | | 按键 | Switch 对应 |
|---|---|---|---|---|
| W A S D | 左摇杆（移动） | | 方向键 | 右摇杆（视角） |
| J | A（确认/对话） | | K、空格 | B（取消/冲刺） |
| I | X（跳跃） | | U | Y（攻击） |
| Q / E | L / R | | Option / Shift | ZL / ZR（盾牌/拉弓） |
| F T H G | 十字键 左/上/右/下 | | Z / C | 左/右摇杆按下 |
| Return（回车） | +（菜单） | | Tab、Esc | −（地图） |

### 手柄

macOS 能识别的手柄（DualSense / Xbox / Switch Pro 等）即插即用，自动映射为 Switch Pro 手柄，支持震动和体感瞄准（陀螺仪，游戏内开启"体感操作"后生效）。想自定义改键，编辑：
`~/Library/Application Support/MacNativeGames/TOTK/controls.txt`（格式：`实体按钮 = Switch按钮`，写错会弹窗提示，删掉文件即恢复默认）。

默认映射按手柄按钮的**物理位置**对应 Switch 布局，所以 Xbox 手柄会出现“A/B 感觉反了”：

- 手柄下方的实体 A 键默认对应 Switch 的 **B**；
- 手柄右方的实体 B 键默认对应 Switch 的 **A**；
- 结果就是实体 B 在游戏里确认，实体 A 在游戏里返回。

如果希望按键名称与 Xbox 手柄一致，在 `controls.txt` 写入：

```text
south = a
east = b
```

保存后完全退出并重新启动游戏。这里必须修改 `controls.txt`；仅在游戏里按 **6** 选择 “Xbox” 不会改变上述物理位置映射。

---

## 八、存档、缓存与文件位置

当前安装的实测占用如下。它会随游戏版本、截图数量、模组和游玩场景变化；下面的数字用于判断哪些目录值得清理。

| 内容 | 位置 | 当前大小与说明 |
|---|---|---|
| **游戏 App** | `/Applications/塞尔达传说：王国之泪.app` | 约 18 GB；自带游戏资源和启动着色器库，其中 `shader-libs` 约 440 MB |
| **游戏存档** | `~/Library/Application Support/MacNativeGames/TOTK/profile` | 当前约 17 MB；最重要，升级或卸载前务必备份 |
| **着色器/管线缓存** | `~/Library/Application Support/MacNativeGames/TOTK/shader-cache` | 当前约 1.3 GB，会随新场景增加；可重建 |
| 管线缓存细分 | `~/Library/Application Support/MacNativeGames/TOTK/shader-cache/rt-totk-native-v8-unverified/pipelines` | 当前约 1.3 GB；缓存绑定 GPU、macOS 和翻译链 |
| **全部 TOTK 用户数据** | `~/Library/Application Support/MacNativeGames/TOTK` | 当前约 1.3 GB；包含存档、缓存、控制设置和可能安装的模组 |
| 模组文件夹 | `~/Library/Application Support/MacNativeGames/TOTK/mods/` | 仅安装模组后存在 |
| 控制设置 | `~/Library/Application Support/MacNativeGames/TOTK/controls.txt` | 修改过按键后存在 |
| 构建目录 | `/Users/a/Desktop/WorkSpace/王国之泪-Mac/游戏1.2.1/TOTK_build` | 当前约 289 MB；确认 App 正常后可删 |
| 构建日志 | `~/Library/Logs/MacNativeGames-build.log` | 用于排错，可删 |
| 游戏运行日志（默认关闭） | `~/Library/Logs/MacNativeGames/` | 开启调试日志后才会有内容，可删 |

### 运行时占用大概多少？

本项目在 Apple M5、24 GB 统一内存、1920×1080 输出（内部 1600×900）的当前场景中实测：

| 资源 | 实测参考 |
|---|---|
| 内存 | 进程物理 footprint 约 **5.0–5.3 GiB**，峰值约 5.3 GiB；系统压缩内存和显存还会占用一部分统一内存 |
| CPU | 约 **2–3 个逻辑核心**，不同场景会波动 |
| GPU | 系统 GPU 利用率约 **50%–97%**；界面右上角的括号数值表示其中游戏本身的 GPU 工作 |

这是统一内存架构，不能把进程内存和显存数值简单相加。16 GB Mac 能运行，但建议关闭浏览器等大内存程序；24 GB 及以上更从容。机器、分辨率、画质和场景不同，占用会变化。

### 缓存是每次启动都要做吗？

- **启动着色器**：构建时已编译进 App，启动时不需要每次重新编译。
- **本机管线缓存**：第一次遇到某条图形管线时按当前 Mac 的 GPU、macOS 和翻译链生成，之后复用。它不是每次启动都从零开始。
- **新场景管线**：初次进入新场景仍可能临时编译并加入缓存，因此游玩过程是增量生成缓存，而不是每次全量重做。
- **缓存失效**：删除 `shader-cache`、更换 GPU、升级 macOS 或切换翻译链后，系统可能需要重新生成部分缓存。

本次启动日志显示：App 内有约 30,160 个启动着色器；首次帧约 13.3 秒后，后台预热了 14,680 个着色器库、19,348 条渲染管线和 238 条计算管线，约 8.4 秒完成。再次启动会复用已存在的缓存，通常不再全量重复。

开启游戏运行日志：

```sh
defaults write org.macnativegames.totk TOTK_DEBUG_LOG -bool YES
```

**换机/备份存档**：把下面的 `profile` 文件夹拷走即可带走当前存档。若还想保留旧版本自动备份、控制设置或模组，也应另外复制同目录下对应文件和文件夹。

日常自动存档和手动存档会写回 `profile` 内的存档槽，不会每存一次就新建一份完整的 `profile`。构建升级时可能额外生成一次 `profile-before-<版本>` 安全备份；这是升级保护，不是每次保存都复制整个目录。

---

## 九、缓存清理与完整卸载

### 1. 只删除可重建的管线缓存

想腾出约 1.3 GB，同时保留存档、控制设置和模组，只删这个目录：

```sh
rm -rf "$HOME/Library/Application Support/MacNativeGames/TOTK/shader-cache"
```

下次运行时会重新生成缺少的管线缓存。首次游玩可能变慢，但不会删除存档。

### 2. 卸载前备份存档

先完全退出游戏，再备份当前存档：

```sh
mkdir -p "$HOME/Desktop/TOTK-profile-backup"
cp -R "$HOME/Library/Application Support/MacNativeGames/TOTK/profile/." \
  "$HOME/Desktop/TOTK-profile-backup/"
```

执行后，`TOTK-profile-backup` 中应直接包含 `profile` 文件夹里的文件。建议先在访达中确认备份内容，再继续卸载。

### 3. 删除 App 和全部 TOTK 用户数据

以下命令会彻底删除游戏 App、存档、缓存、控制设置和模组：

```sh
rm -rf "/Applications/塞尔达传说：王国之泪.app"
rm -rf "$HOME/Library/Application Support/MacNativeGames/TOTK"
rm -rf "$HOME/Library/Logs/MacNativeGames"
defaults delete org.macnativegames.totk 2>/dev/null || true
```

> ⚠️ 第二条 `rm -rf` 会连同 `profile` 存档一起删除。没有备份时不要执行。
>
> ⚠️ 不要为了卸载本游戏直接删除整个 `~/Library/Application Support/MacNativeGames`，其中可能还有本项目构建的其他游戏数据。

### 4. 可选：清理构建文件与日志

如果以后不准备重新打包、升级或排错，可以再删除构建目录和构建日志：

```sh
rm -rf "/Users/a/Desktop/WorkSpace/王国之泪-Mac/游戏1.2.1/TOTK_build"
rm -f "$HOME/Library/Logs/MacNativeGames-build.log"
```

### 5. 哪些东西不算 App 的运行依赖？

- **原始游戏和密钥文件**：本体 NSP（当前约 16 GB）、更新 NSP（当前约 339 MB）、固件目录和 `prod.keys` 都属于构建源文件。安装好的 App 不依赖它们运行，但卸载 App 时不应自动连同用户资料删除；确认以后不再重打包时再自行清理。
- **MacNativeGames 源码仓库**：只用于构建。若没有其他游戏要继续构建，可以另外删除。
- **Apple Metal Toolchain**：属于系统开发组件，不是《王国之泪》的数据，无需为了卸载游戏删除。
- **当前安装额外位置**：本次检查未在系统 Keychain、`~/Library/Caches/org.macnativegames.totk`、Saved Application State 或 Sandbox Container 中发现额外的 TOTK 安装数据。

---

## 十、常见问题（FAQ）

**Q1：新场景/刚进游戏会卡一下？**
正常。首次遇到新着色器需要现场编译，缓存热了之后就流畅了。玩的场景越多越顺。

**Q2：长时间游玩后被强制退出，日志提到 `TOTK_GPU_BUDGET_MB`？**
长会话中显卡内存占用会增长，超过预算时 App 会主动停止游戏以保护系统。可以这样提高预算后启动（你的内存的 30% 是默认值，可适当上调）：

```sh
open --env TOTK_GPU_BUDGET_MB=10000 "塞尔达传说：王国之泪.app"
```

**Q3：macOS 27 上随机闪退，尤其是选取武器时？**

这是已经定位到的一个 macOS 27 回归问题：[MacNativeGames Issue #1192](https://github.com/ly05010419/MacNativeGames/issues/1192) 记录了标题界面约 1–2 分钟后出现随机 `SIGSEGV`/`SIGBUS`，崩溃地址和 `main` 偏移每次不同。选取武器时也复现过同一类内存破坏；`GDB` 观测到的写入本身是合法写入，不能据此认定是某个武器对象或一次普通按键导致。

当前安装在“应用程序”中的正式 App 已包含本地启动器修复：macOS 27 及更高版本默认关闭会触发问题的非限帧出图路径，即设置 `TOTK_UNCAPPED=0`，改为跟随显示器刷新率。该修复不会改动存档、缓存或上游仓库；`codesign --verify --deep --strict` 已通过。

### 修复代码与写入 App 的步骤

修复改的是启动器源码，不是直接编辑 `.app` 里的二进制。源码文件是：

```text
/Users/a/Desktop/WorkSpace/我的Github项目/开源项目/MacNativeGames/games/totk/app/launcher.m
```

在 `main` 启动配置中，找到设置 `TOTK_GPU_BUDGET_MB` 的代码块；紧接在该代码块后、`TOTK_SLOT_OWNER` 设置前插入：

```objective-c
/* macOS 27: the uncapped present path corrupts memory randomly. An explicit environment value still wins. */
if (NSProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 27)
    setenv("TOTK_UNCAPPED", "0", 0);
```

最后一个参数 `0` 表示只设置默认值：如果启动时已经显式设置了 `TOTK_UNCAPPED`，就保留原值。这样 macOS 27 及更新版本默认跟随显示器刷新率，其他 macOS 版本不受影响。

保存源码后，先退出游戏，再用仓库的 `update_runtime.py` 重编启动器并更新已安装 App。它会从现有 App 保留游戏数据，构建临时副本，检查并签名后替换原 App；这个启动器修复不需要重新提取游戏，也不需要密钥。下面的命令会把临时工作文件留在桌面的 `TOTK_build` 目录：

```sh
cd "/Users/a/Desktop/WorkSpace/我的Github项目/开源项目/MacNativeGames"
APP=$(/usr/bin/find /Applications -maxdepth 1 -type d -name '*王国之泪.app' -print -quit)
test -n "$APP" || { echo "没有在 /Applications 找到王国之泪 App"; exit 1; }
python3.14 update_runtime.py "$APP" \
  --work "/Users/a/Desktop/WorkSpace/王国之泪-Mac/游戏1.2.1/TOTK_build"
```

成功时，命令最后会显示 `done in ...: <App 路径> has the runtime of this repository`。要确认修复代码进入了启动器，可以检查编译产物是否包含对应环境变量名：

```sh
strings "$APP/Contents/MacOS/TOTK" | grep TOTK_UNCAPPED
```

若修复涉及 `patch_nso.py` 对游戏代码模块的改写，则运行时更新不够，需要用自己的游戏文件重新运行完整 `build_app.py`；本节的 `TOTK_UNCAPPED` 修复只改启动器，用 `update_runtime.py` 即可。

验证结果：在正式 App 中实际进入武器菜单后，用右摇杆在两个装备位置间来回切换，并确认装备、返回世界；共完成约 40 次菜单打开、切换和选择操作，其中各种装备确认至少 20 次。测试实例连续运行 **20 分钟以上**；期间游戏进程 PID 始终未变，系统没有生成修复启动之后的新 TOTK 崩溃报告，`totk.log` 也未出现新的 `SIGBUS`、`SIGSEGV`、`fault=`。之前那条 `SIGBUS` 日志来自修复前的旧启动；安装当前 App 后启动的实例没有再产生同类日志。这证明当前正式 App 的 macOS 27 规避路径已覆盖此前会闪退的武器菜单操作，但还没有证明上游根因已被彻底修复；它仍可能在其他长时间或高负载场景暴露。若以后又出现 `signal=0xb`、`signal=0xa` 或 `fault=`，请保留 `~/Library/Logs/MacNativeGames/totk.log`，并记录当时正在进行的操作。

**Q4：游戏是英文/日文，想玩中文？**
游戏语言默认跟随系统语言。中文系统直接就是中文。想单独给这个 App 指定语言：

```sh
open --env TOTK_LANG=zh-Hans "塞尔达传说：王国之泪.app"
```

**Q5：想升级到 1.4.3？**
同一本体 + 对应更新包重跑一遍构建命令即可（把 `--update` 指向 1.4.3 的 NSP/NSZ，`-o` 换个名字或先删旧 App）。⚠️ 项目会在升级前自动备份存档（`profile-before-1.x.x`），但**不保证新版本存档向下兼容旧 App**。

**Q6：帧率怎么看？**
游戏运行时 macOS 菜单栏左侧会实时显示 FPS（全屏时隐藏）；按 **1** 在窗口右上角看详细信息。

**Q7：支持联网、amiibo 吗？**
不支持。这是纯单机本地移植，无任何联网功能。

**Q8：卡在启动画面很久？**
本次构建已把启动着色器预编译进 App，不会每次启动都重新做 30–50 分钟的全库预热。首次创建本机管线缓存或进入新场景时仍可能变慢；缓存生成后会复用。启动时间取决于资源校验、首次管线数量和硬件，不能保证固定为 10 秒。若进度长时间没有变化，开启日志（见第八节）查看 `~/Library/Logs/MacNativeGames/`，或到项目 Issues 搜索。

**Q9：还能玩别的游戏吗？**
本项目还支持《旷野之息》1.6.0 / 1.9.0（README 有专门章节）和社区版《超级马力欧：奥德赛》。

**Q10：想给游戏装模组（Mod）？**
见项目文档 `docs/mods.md`，支持代码补丁（IPS/pchtxt）和 RomFS 数据模组。

---

## 十一、法律与致谢

- 本项目（MIT 许可）与任天堂无任何关联。《塞尔达传说》和 Nintendo Switch 是任天堂的商标。
- **必须拥有正版游戏**，密钥与系统文件必须从自己的 Switch 导出。打包出的 App 含游戏内容，仅限自用，**请勿分享**。
- 感谢 MacNativeGames 的开发者与社区。如果你玩得顺畅，欢迎按启动时的提示把新着色器通过 GitHub Issue 贡献回公共清单，让所有人都不卡顿。

*教程完 · 祝海拉鲁大陆之旅愉快！*
