# Oneko 像素猫

全站可选的跟鼠标像素猫，使用托管脚本 [oneko.dhrv.pw](https://oneko.dhrv.pw/)，不自托管引擎或皮肤资源。

## SPEC + 设计

### 背景

想在站点 chrome 上加一只轻量、可关掉的像素猫，作为装饰交互，而不是内容功能。托管脚本约 33 KB gzip，用 `data-*` 配置，适合 Astro + ClientRouter，无需把 React/shadcn 组件拷进仓库。

### 规则（已确认）

- **启用方式**：`FEATURES.oneko: FeatureConfig<OnekoConfig>`，默认 `[true, { skin: 'classic' }]`。
- **ON**：跟随光标、睡觉、气泡、记住位置、季节帽子、`reducedMotion="hide"`、访客隐藏开关、导航避让区。
- **OFF**：喵叫、激光笔、抓取、零食、跟随焦点、悬停栖息、打字时打盹。
- **挂载**：`BaseLayout` 用 `createOneko` 挂载托管引擎；猫挂在 `document.body`，不占版心。站内 View Transitions 换页后若猫被移除，则在 `astro:page-load` 上重建。
- **隐藏**：页脚 `data-oneko-toggle` 按钮，可见文案前有装饰性 `🐾`（`aria-hidden`），读屏仍为「隐藏小猫」；引擎负责跨标签页记忆与 `aria-pressed` 同步。

### 非目标

- 不自托管 `oneko.js` 或皮肤表。
- 不开启声音（`meow`）或激光笔。
- 不做 rehype 给每个 `pre` 自动打避让区（过重）；作者可自行加 `data-oneko-zone="avoid"`。

### 权威表

| 事实 | 权威 | 不要 |
| :--- | :--- | :--- |
| 开／关与皮肤 | `src/config.ts` `FEATURES.oneko` | 在布局里写死开关 |
| 类型与配置形状 | `src/types.ts` `OnekoConfig` / `Features.oneko` | 另造 `boolean` 顶层开关 |
| 脚本挂载与 VT 重建 | `src/layouts/BaseLayout.astro` | 在各页面再插一份 script |
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
| 皮肤 | `createOneko({ skin })` ← config |
| 跟随光标 | `followCursor: true` |
| 睡觉 | `sleepEnabled: true` |
| 气泡 | `bubbleEnabled: true` |
| 记住位置 | `persistPosition: true` |
| 季节帽子 | `seasonal: true` |
| 减少动态 | `reducedMotion: 'hide'` |
| 喵叫／激光 | `meow: false`、`laserPointer: false` |
| 隐藏开关 | 页脚按钮 `data-oneko-toggle`（引擎同步，重建后仍有效） |
| 避让 | 顶栏 `data-oneko-zone="avoid"`（开关关闭时属性仍在，无害） |

## View Transitions

站点使用 Astro `ClientRouter`。`ClientRouter` 换页时会替换页面 DOM，挂在 `document.body`、且未标 `transition:persist` 的猫节点会被一并移除。做法：

1. `BaseLayout` 用 `is:inline` + `define:vars` 输出一小段引导脚本。
2. 引导脚本通过 CDN 模块的 `createOneko` 创建实例，并记在 `window.__yublogOneko`。
3. 每次 `astro:page-load` 检查 `[data-oneko-cat], #oneko-react`；若猫已不在 DOM，先 `destroy` 旧句柄（若有），再 `createOneko` 重建。页脚 `data-oneko-toggle` 由引擎同步，重建后仍可用。

不要对 CDN script 加 `data-astro-rerun`，也不要用「只注入一次」的全局 flag 阻止重建——换页后猫节点已不在，flag 仍为真会导致猫消失直到整页刷新。

## 集成位置

模块职责见上方权威表；站点其它配置和部署见 [开发与部署指南](../guides/development.md#personalization)。

## 访客隐藏

页脚「隐藏小猫」按钮带 `data-oneko-toggle`。托管脚本会同步 `aria-pressed`，并在 `localStorage`（`oneko:hidden`）记住选择，跨标签页生效。无需本站自写状态机。

## 署名与许可

- 引擎代码 MIT，托管于 [oneko.dhrv.pw](https://oneko.dhrv.pw/)。
- 皮肤为像素画作品，再分发时请保留 [皮肤 credits](https://oneko.dhrv.pw/docs#sources-and-credits)／安装包内 `docs/oneko-skins.md` 的署名说明。
- 本站仅通过 CDN 引用，不复制皮肤文件进仓库。
