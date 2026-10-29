---
title: 本地模型下载与 LM Studio 适配
description: 从 aria2 多连接下载、镜像与 SHA256 校验，到 LM Studio 识别手工模型、量化档位选择、加载设置与内存行为。
pubDate: 2026-10-28
category: 技术
tags: [LM Studio]
titleImage: ./_title-images/lm-studio.png
titleImageAlt: LM Studio 应用图标与文字标识
---

## 一、下载器选择

LM Studio 内置下载器是**单连接顺序下载**。代理对单条 TCP 连接限速时，
速度会被压到极低，而总带宽实际远不止于此。

实测同一份 13 GB 的 GGUF：

| 方式 | 速度 | 耗时 |
|---|---|---|
| LM Studio 内置 | 0.73 MB/s | 5.1 小时 |
| aria2，8 连接 | ~5 MB/s | ~40 分钟 |

**结论：大文件不要用内置下载器。** 瓶颈通常在连接数，不在带宽。

---

## 二、镜像站

Hugging Face 官方源在部分网络环境下直连不通。可用国内镜像，**不需要安装任何东西**，
只改域名：

```
官方：  https://huggingface.co/<repo>/resolve/main/<file>
镜像：  https://hf-mirror.com/<repo>/resolve/main/<file>
```

路径、文件名、内容完全一致。备选：ModelScope（`modelscope.cn`）。

镜像有被篡改的理论风险，所以**下载后校验 SHA256**（见第四节）。

---

## 三、下载命令

```bash
brew install aria2   # 多连接下载器，支持断点续传

mkdir -p ~/.lmstudio/models/<vendor>/<model>
cd ~/.lmstudio/models/<vendor>/<model>

BASE="https://hf-mirror.com/<repo>/resolve/main"

# 主权重
aria2c -x 8 -s 8 -k 5M -c --file-allocation=none \
  -o "<model>.gguf" "$BASE/<model>.gguf"

# 视觉投影器（需要图片/视频输入时才下，约 1 GB）
aria2c -x 8 -s 8 -k 1M -c --file-allocation=none \
  -o "mmproj-F16.gguf" "$BASE/mmproj-F16.gguf"
```

参数：

- `-x 8 -s 8` 8 条连接、8 个分片
- `-k 5M` 每片 5 MB
- `-c` 断点续传，中断后重跑同一条命令即可
- `--file-allocation=none` 不预分配，省等待

**不要盲目加连接数。** 实测 16 连接比 8 连接慢（1.9 vs 5.3 MB/s），过度并发会被限速。

### 备选：huggingface_hub CLI

```bash
pip install -U huggingface_hub
export HF_ENDPOINT=https://hf-mirror.com
hf download <repo> --local-dir <dir> \
  --include "*<quant>*" --include "mmproj-*"
```

---

## 四、校验

```bash
shasum -a 256 <model>.gguf mmproj-F16.gguf
```

查期望值：

```bash
curl -s "https://huggingface.co/api/models/<repo>/tree/main?recursive=true" \
  | python3 -c "
import json,sys
for x in json.load(sys.stdin):
    if 'lfs' in x: print(x['lfs']['oid'], x['lfs']['size'], x['path'])
"
```

哈希一致即证明文件与官方逐字节相同，镜像无法替换内容。

---

## 五、LM Studio 识别手工下载的模型

三个硬性要求：

1. 放在 `~/.lmstudio/models/` 之下，可任意子目录
2. 标准 GGUF 格式，`.gguf` 后缀，未加密
3. `mmproj-*.gguf` 与主权重**同目录**，会自动配对成视觉投影器

```
~/.lmstudio/models/
└── <vendor>/
    └── <model>/
        ├── <model>.gguf
        └── mmproj-F16.gguf
```

让它识别：

```bash
osascript -e 'quit app "LM Studio"'   # 必须完整退出，关窗口无效
open -a "LM Studio"

~/.lmstudio/bin/lms ls                # 验证
```

排查：

```bash
realpath ~/.lmstudio/models/<vendor>/<model>/*.gguf
```

文件名带 `UD-` 前缀表示 Unsloth Dynamic 量化，与普通量化档位不同。

---

## 六、量化档位怎么选

### 先确认真实可用内存

macOS 不给 GPU 全部内存。`recommendedMaxWorkingSetSize` 才是实际约束，
通常约为物理内存的 70~75%：

```bash
cat > /tmp/mw.swift <<'EOF'
import Metal
if let d = MTLCreateSystemDefaultDevice() {
    print("\(Double(d.recommendedMaxWorkingSetSize)/1073741824) GB")
}
EOF
swiftc -O /tmp/mw.swift -o /tmp/mw && /tmp/mw
```

### 选档原则

**在装得下的前提下，永远选最高档位量化。**

装得下高量化就不用降档——省下来的内存没有用处，而质量损失是实打实的。

| 情况 | 选择 |
|---|---|
| 4-bit 装得下 | 用 4-bit |
| 4-bit 顶满上限，无上下文空间 | 降一档到 3-bit |
| 连 3-bit 都装不下 | 换更小的模型，或接受 2-bit |

**2-bit 只在“装不下”时才有意义**（大模型低量化 > 小模型高量化）。
装得下就别碰。

### 典型大小参考（4-bit）

约 **0.57 GB / 十亿参数 + 2 GB 开销**。

| 参数 | 4-bit 权重 |
|---|---|
| 9B | ~5.5 GB |
| 27B | ~16 GB |
| 35B | ~20 GB |
| 70B | ~40 GB |

MoE 模型（如 35B-A3B）内存按总参数算，但每 token 只读激活参数，所以速度按激活量走。

### 命名陷阱

**IQ1 实际是 2.00 bits/weight，IQ2_XXS 是 2.38。** 名字里的数字是营销，
下界就是 2 bit，再低模型会废。

| 前缀 | 含义 |
|---|---|
| `Q*_K_*` | 传统 k-quant |
| `IQ*` | imatrix 量化，用校准数据分配比特，同体积质量更好 |
| `UD-` | Unsloth Dynamic，混合精度 |
| XXS/XS/S/M/L | 同档位内的微调，越大越精细 |

### 同档位不同量化者大小差异

同一个 `IQ3_XXS`，不同来源可能差 2~3 GB。体积更大通常保留更多精度，
但要算进 mmproj 的开销后重新评估是否仍装得下。

**MoE 模型对低比特尤其敏感**——router 判断出错会导致输出逻辑跳跃、反复。
往低档降的时候优先考虑换小模型，而不是压到 2-bit。

---

## 七、加载设置

- **上下文压在 16K~32K**。默认可能拉满到 128K/262K，KV cache 会吃掉全部余量
- 一次只加载一个模型
- 不需要多模态就不下 `mmproj`，省 1 GB 左右

---

## 八、常驻服务的内存行为

服务器常驻 ≠ 一直占内存。

| 状态 | 内存 |
|---|---|
| App 启动，服务未启动 | ~0.8 GB（外壳，无模型） |
| 服务启动，尚无请求 | ~0.8 GB（权重在磁盘页缓存，可回收） |
| 首个请求进来（JIT 加载） | 突然 +模型全量 |
| 空闲超过 TTL | 自动卸载，回落 |

LM Studio 默认 `jitModelTTL` 为 60 分钟：模型加载后每收到请求重置计时，
彻底空闲 60 分钟后卸载。

TTL 只对 **JIT 加载**的模型生效。用 `lms load` 手动加载且没加 `--ttl`
的模型会被 pin 住，永不自动卸载。

```bash
lms load <model> --ttl 3600    # 1 小时空闲后卸载
lms unload --all
lms ps                          # 查看加载状态
```

监控：

```bash
memory_pressure | grep "free percentage"
```

低于 20% 且 pageout 持续增长，说明内存不足。

---

## 九、速度估算

生成速度基本由内存带宽决定：

```
tok/s ≈ 带宽(GB/s) ÷ 每 token 读取的权重(GB)
```

- **dense 模型**：每 token 读全部权重。带宽固定时，模型越大越慢
- **MoE 模型**：每 token 只读激活参数。同样体积下快数倍

以 170 GB/s 带宽为例：

| 模型 | 每 token 读取 | 估算速度 |
|---|---|---|
| 9B dense (4bit) | 5.5 GB | ~25 tok/s |
| 27B dense (4bit) | 16 GB | ~9 tok/s |
| 35B-A3B MoE (4bit) | ~1.7 GB | ~60 tok/s |

**在带宽受限的机器上，MoE 不只是“便宜的大模型”，而是更优解。**

这也解释了为什么小模型不一定快：一个 9B dense 可能比 35B MoE 慢，
因为后者每 token 只读 1.7 GB 而前者要读 5.5 GB。

查自己的带宽：

```bash
sysctl -n hw.memsize                      # 内存
system_profiler SPHardwareDataType | grep Chip
```

---

## 十、硬件与上限的关系

内存决定**装得下什么**，带宽决定**跑多快**。两者通常绑定，可选点离散。

容量翻倍速度不一定涨：

- 同样 27B dense，带宽 3.6 倍的芯片上快 3.6 倍——这是带宽的功劳
- 但在同一块芯片上硬塞更大的 dense 模型，反而更慢

**升级判断**：先问要跑多大的模型，再倒推需要的带宽。
纯粹的容量提升只解决“装不下”，不解决“跑得慢”。
