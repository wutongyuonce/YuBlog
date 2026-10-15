# Excalidraw 正文画布：参考依据与实现设计

本功能参考 [Innei 的正文画布](https://innei.in/posts/tech/ai-native-ios-e2e-verification)，适用于博客、拾趣和关于页共用的 Markdown 管线。参考实现的源码位于 [Yohaku 的 Excalidraw 目录](https://github.com/Innei/Yohaku/tree/main/packages/rich-content/src/lexical/portable/excalidraw)；这些 `main` 链接可能随上游更新。本站锁定官方 `@excalidraw/excalidraw@0.18.1`。

## 调研结论与取舍

参考页当前使用自行绘制的 SVG。页面 DOM 是 `div > svg > g[transform]`，并非官方编辑器 Canvas；Yohaku 的 `Scene.tsx` 按元素类型绘制文字、线条和图形，`InteractiveScene.tsx` 单独管理视口。旧版 Shiro 的 React Excalidraw viewer 不能代表当前参考页。

[InteractiveScene.tsx](https://github.com/Innei/Yohaku/blob/main/packages/rich-content/src/lexical/portable/excalidraw/InteractiveScene.tsx) 的按钮以当前窗口中心按 `1.2` / `1÷1.2` 缩放，拖动改变平移量；fit 使用内容边界和容器尺寸。普通滚轮滚动文章，Ctrl/Cmd + 滚轮缩放；上游滚轮以鼠标位置为锚、双指以手势中点为锚。参考页正文容器为 16∶9，工具栏固定在右下，展开打开独立 SVG。本项目按用户要求改为当页 dialog，并让所有缩放入口围绕当前视口中心，避免切换输入方式造成中心跳动。

采用 **官方 SVG exporter + 独立只读视口**。官方负责 `.excalidraw` 的恢复、rough 线条、箭头、文字、旋转、frame 与内嵌图片；本站负责卡片、视口、胶囊和 dialog，不再复制完整元素渲染器，也不挂载 React 编辑器。完整官方包仍需按需下载，SVG 导出并不意味着依赖体积消失。

| 方案 | 收益 | 代价／选择 |
| --- | --- | --- |
| 官方 React viewer | 官方手势与编辑器功能齐全 | 与本站视口规则重叠，需维护隐藏 UI 和宿主桥接；不采用 |
| 自制完整 SVG renderer | 可精确复制参考源码的输出 | 需持续跟进字体、图形、绑定和图片格式；不采用 |
| 官方 `exportToSvg` + 自控视口 | 渲染格式交给官方，交互规则由本站唯一负责 | 自行处理加载、手势和资源清理；采用 |

`0.18.1` 提供 ESM 条件导出，React peer 包含 19；本站仅保留它要求的 React/React DOM 运行依赖，不使用 `@astrojs/react` 集成。指令只接受 `.excalidraw` 场景；`.excalidrawlib` 是素材库格式，需先导入画布并导出场景，直接嵌入会在构建时报错。

## 行为契约

- 默认正文卡片始终为 16∶9；作者原有 `height` 可覆盖高度，窗口本身不能拖拽改大小。初始按内容与窗口等比适配，留出 10% 空间，比例受 5%–1600% 边界限制；极大的场景在 5% 时可能仍无法完整放入窗口。
- 相机记录 SVG 坐标中的中心 `(x, y)` 和相对于 fit 的倍率 `zoom`。缩放只改倍率；拖动才移动中心；复位回内容中心和 fit。按钮步进为 1.2 倍，实际场景比例固定限制为 5%–1600%，不随内容或窗口尺寸改变，胶囊显示实际场景缩放百分比。
- 鼠标／单指拖动平移；双指和 Ctrl/Cmd + 滚轮围绕窗口中心缩放。普通滚轮仍滚动文章。聚焦画布后，方向键平移，`+` / `-` 缩放，`0` 适配。
- 右下胶囊始终可见，包含缩小、比例、放大、适配、展开、下载。正文和 dialog 共用同一套视口实现，控件不参与内容变换。
- 当页 dialog 保留打开时的中心与相对倍率，适配更大窗口；窗口尺寸固定，内容可向四个方向拖动及缩放。关闭／Esc／遮罩恢复正文原视口、页面滚动和触发按钮焦点。窗口 resize 保持中心与相对倍率，超出绝对边界时将比例限制在 5%–1600%。
- 保留源场景的背景和绘图颜色；页面主题只改变卡片边框、胶囊和 dialog 外壳，不重新导出或重置视口。这与上游对整个 SVG 反色的主题处理不同，避免改动作者原配色。
- 下载指向同站静态 `/_media/...excalidraw`，直接保留源文件字节，不重新序列化。SVG 仅为显示产物，无持久下载 Blob 链接。
- 没有 JS、加载失败、无可显示元素或源格式错误时，保留可选预览和源下载入口。加载失败给出可见提示，不挂载半成品控件。

## 模块与数据流

| 义务 | 唯一属主 | 调用边界 |
| --- | --- | --- |
| 指令属性、预览、源链接与带位置构建失败 | `plugins/remark-excalidraw.ts` | Markdown → figure／host／源链接 |
| 源路径与静态镜像 | `plugins/media-paths.ts`，`astro-media-sync.ts` | 原文件 → `/_media/`；仅 exporter 字体复制到 `excalidraw-assets/fonts/` |
| 场景恢复、SVG 生成和画布 UI／输入 | `src/utils/excalidraw-canvas.ts` | `loadDrawing` 返回共享绘图资源，`createDrawingView` 返回销毁函数 |
| 中心、平移、缩放上下限与投影数学 | `src/utils/excalidraw-viewport.js` | 画布调用纯函数，正文与展开不重复实现 |
| 延迟加载、错误回退、dialog、页面生命周期 | `src/utils/excalidraw-viewer.ts` | 只在距视口 300px 内加载；页面离开时中止 fetch、销毁 view、释放 SVG URL |
| 外观与尺寸 | `src/styles/prose.css` | 稳定的本站 class，不依赖官方编辑器内部 DOM |

显示链路：源链接 → 延迟加载 exporter 和源文件 → 官方 `restore` → 过滤删除元素 → `exportToSvg({ elements, appState, files })` → 图片解码成功 → 胶囊和视口就绪 → 隐藏预览。场景读取完整 `files`，不把它当作只有元素的 JSON。

SVG 以 Blob 图片隔离显示，内部链接和样式不会进入正文 DOM。导出固定 `exportScale: 1`，读取官方输出宽高作为相机坐标基准。字体从本地 `dist/prod/fonts` 镜像目录读取，由 exporter 默认内联子集；`window.EXCALIDRAW_ASSET_PATH` 随 Astro base 设置。正文与 dialog 共享同一份 SVG，不重复 fetch 或导出。关闭 dialog 只销毁其视图；页面离开后撤销图片 URL，不保留跨页缓存。渲染成本随源场景复杂度增长；不引入队列、场景大小限额或后台 worker 协议。

## 验证界面

`test/excalidraw-viewport.test.mjs` 直接验证完整适配、中心缩放、拖动后更新中心、窗口变化及倍率边界。`test/remark-excalidraw.test.mjs` 验证作者入口、源链接、可选预览和路径失败。浏览器验收覆盖正文／展开、真实拖动／双指输入、下载字节、焦点和滚动恢复、主题与站内导航；项目 CI 负责类型、格式、lint、全部单测和构建产物。源码/API 声明不能替代浏览器集成验证。

## 一手来源

- [参考文章](https://innei.in/posts/tech/ai-native-ios-e2e-verification)
- [Yohaku Scene.tsx](https://github.com/Innei/Yohaku/blob/main/packages/rich-content/src/lexical/portable/excalidraw/Scene.tsx)、[InteractiveScene.tsx](https://github.com/Innei/Yohaku/blob/main/packages/rich-content/src/lexical/portable/excalidraw/InteractiveScene.tsx)、[open-in-new-window.ts](https://github.com/Innei/Yohaku/blob/main/packages/rich-content/src/lexical/portable/excalidraw/open-in-new-window.ts)
- [Excalidraw 官方导出 API](https://docs.excalidraw.com/docs/@excalidraw/excalidraw/api/utils/export)、[0.18.1 导出类型](https://cdn.jsdelivr.net/npm/@excalidraw/excalidraw@0.18.1/dist/types/utils/export.d.ts)
- [0.18.1 包元数据](https://cdn.jsdelivr.net/npm/@excalidraw/excalidraw@0.18.1/package.json)、[0.18.1 README（自托管字体）](https://www.npmjs.com/package/@excalidraw/excalidraw/v/0.18.1)
