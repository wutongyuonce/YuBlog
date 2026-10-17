# Oneko 像素猫

全站可选的跟鼠标像素猫，使用托管脚本 [oneko.dhrv.pw](https://oneko.dhrv.pw/)，不自托管引擎或皮肤资源。

## SPEC + 设计

### 背景

想在站点 chrome 上加一只轻量、可关掉的像素猫，作为装饰交互，而不是内容功能。托管脚本约 33 KB gzip，用 `data-*` 配置，适合 Astro + ClientRouter，无需把 React/shadcn 组件拷进仓库。

### 规则（已确认）

- **启用方式**：`FEATURES.oneko: FeatureConfig<OnekoConfig>`，默认 `[true, { skin: 'classic' }]`。
- **ON**：跟随光标、睡觉、气泡、记住位置、季节帽子、`reducedMotion="hide"`、访客隐藏开关、导航避让区。
- **OFF**：喵叫、激光笔、抓取、零食、跟随焦点、悬停栖息、打字时打盹。
- **挂载**：`BaseLayout` 在首次进入站点时注入一次托管 `type="module"` 脚本；猫挂在 `document.body`，不占版心。
- **隐藏**：页脚 `data-oneko-toggle` 按钮，文案「隐藏小猫」；引擎负责跨标签页记忆与 `aria-pressed` 同步。

### 非目标

- 不自托管 `oneko.js` 或皮肤表。
- 不开启声音（`meow`）或激光笔。
- 不做 rehype 给每个 `pre` 自动打避让区（过重）；作者可自行加 `data-oneko-zone="avoid"`。
- 不合并无关 WIP 分支，不自动合并本 PR。

### 权威表

| 事实 | 权威 | 不要 |
| :--- | :--- | :--- |
| 开／关与皮肤 | `src/config.ts` `FEATURES.oneko` | 在布局里写死开关 |
| 类型与配置形状 | `src/types.ts` `OnekoConfig` / `Features.oneko` | 另造 `boolean` 顶层开关 |
| 脚本挂载与 VT 防重 | `src/layouts/BaseLayout.astro` | 在各页面再插一份 script |
| 访客隐藏按钮 | `src/components/base/Footer.astro` 的 `data-oneko-toggle` | 自写 localStorage 逻辑 |
| 导航避让 | `NavBar.astro` `data-oneko-zone="avoid"` | 用 JS 每帧量矩形 |
| 动画引擎与皮肤 | CDN `https://oneko.dhrv.pw/oneko.js` | 拷贝进 `public/` |

## 如何开关

在 `src/config.ts`：

```ts
// 开（默认）
oneko: [true, { skin: 'classic' }],

// 关
oneko: false,
// 或
oneko: [false, { skin: 'classic' }],
```

可选 `skin` 见类型注释；省略时按 `classic`。完整皮肤列表与署名见 [oneko 文档 · Skins](https://oneko.dhrv.pw/docs#skins-pick-a-coat) 与皮肤 credits。

## 启用时的行为

| 能力 | 设置 |
| --- | --- |
| 皮肤 | `data-skin` ← config |
| 跟随光标 | `data-follow-cursor` |
| 睡觉 | `data-sleep-enabled` |
| 气泡 | `data-bubble-enabled` |
| 记住位置 | `data-persist-position` |
| 季节帽子 | `data-seasonal` |
| 减少动态 | `data-reduced-motion="hide"` |
| 喵叫／激光 | `data-meow="false"`、`data-laser-pointer="false"` |
| 隐藏开关 | 页脚按钮 `data-oneko-toggle` |
| 避让 | 顶栏 `data-oneko-zone="avoid"`（开关关闭时属性仍在，无害） |

## View Transitions

站点使用 Astro `ClientRouter`。布局里的脚本在站内跳转时可能再次出现在新文档里。做法：

1. `BaseLayout` 用 `is:inline` + `define:vars` 输出一小段引导脚本。
2. 引导脚本用 `window.__yublogOnekoBooted` 只在首次真正注入 CDN module。
3. 猫实例挂在 `document.body`，换页不销毁、不重建。

不要对 CDN script 加 `data-astro-rerun`，也不要在 `astro:page-load` 里再次 `createOneko`。

## 改动文件

| 文件 | 作用 |
| --- | --- |
| `src/types.ts` | `OnekoConfig`、`Features.oneko` |
| `src/config.ts` | 默认开启 classic |
| `src/layouts/BaseLayout.astro` | 条件挂载 + VT 防重 |
| `src/components/base/Footer.astro` | 隐藏按钮 |
| `src/components/nav/NavBar.astro` | 导航避让 |
| `docs/Oneko 像素猫.md` | 本说明 |
| `docs/项目解析.md` / `docs/站点行为 SPEC.md` / `CHANGELOG.md` | 索引与未发布条目 |

## 访客隐藏

页脚「隐藏小猫」按钮带 `data-oneko-toggle`。托管脚本会同步 `aria-pressed`，并在 `localStorage`（`oneko:hidden`）记住选择，跨标签页生效。无需本站自写状态机。

## 署名与许可

- 引擎代码 MIT，托管于 [oneko.dhrv.pw](https://oneko.dhrv.pw/)。
- 皮肤为像素画作品，再分发时请保留 [皮肤 credits](https://oneko.dhrv.pw/docs#sources-and-credits)／安装包内 `docs/oneko-skins.md` 的署名说明。
- 本站仅通过 CDN 引用，不复制皮肤文件进仓库。
