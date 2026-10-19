# 正文图片大图相册：SPEC 与设计

## 行为契约

普通正文图打开既有原生 `dialog` 大图后，**同一篇文章正文**（同一 `.markdown-content` 根）里、已经参与现有点击／键盘放大的全部图片组成一个相册：

| 义务 | 不变量 |
| --- | --- |
| G1 相册集合 | 与现有 lightbox 参与者一致：该正文根下的 `.image-view`（含 gallery／figure／`:::card` 配图），排除横滚陈列架副本与 Excalidraw 嵌入图；不另开一套图片发现路径 |
| G2 打开定位 | 从任一张打开时，该图即为当前张；索引展示为 `当前/总数`（如 `2/5`） |
| G3 翻页 | 控件行居中提供上一张／下一张；到首张时上一张不可用，到末张时下一张不可用；不循环 |
| G4 控件行 | 位于大图与说明文字之下，左索引、中箭头、右关闭（✕）；关闭、点大图、Esc、点遮罩仍可退出，行为与打开前一致 |
| G5 说明 | 若 dialog 已显示说明（alt），翻页时随当前张更新 |
| G6 键盘 | Esc 沿用原生 dialog；打开期间 ←／→ 翻页（边界 no-op） |
| G7 范围 | 沿用现有 `ImageInteractions` 挂载页（博客正文等已支持放大处）；不扩展到 `titleImage` 头图／文稿缩略图或站点头像 |

单张时仍显示 `1/1`、禁用两侧箭头与关闭按钮，不隐藏整行以免布局跳动。

## 架构与 authority

```text
点图／键盘打开
  → ImageInteractions 收集同正文根下可放大 .image-view
  → 写入 dialog 当前张（template 原尺寸 src + alt／说明）
  → 控件行同步索引与箭头 disabled
翻页／←→
  → 同一 dialog 内换 src／说明／trigger（焦点恢复目标）
关闭
  → 既有 restore（滚动锁、焦点、清 src）
```

| Rule/state | Authority | Seam | 不放哪里 |
| --- | --- | --- | --- |
| 相册集合筛选与索引夹取 | `src/utils/image-lightbox-gallery.js` | `lightboxViewsInArticle`、`clampSlideIndex` | 在组件或 CSS 再推断集合 |
| 当前索引、翻页、控件 DOM、键盘 ←→、dialog 生命周期 | `src/utils/image-interactions.ts` | 消费 remark／Astro 已生成的 `.image-view` + inert template；widget 只接线 | 第二套 lightbox、Astro 组件内交互、RSS |
| 控件行排版与按钮外观 | `src/styles/prose.css`（`.image-lightbox__*`） | 类名约定 | 横滚相册 `.image-gallery__*` 控件（正文内翻页，职责不同） |

取舍：不新增依赖或轮播库；翻页不预加载下一张以外的额外策略（仍仅在展示时赋 src）；不与横滚相册箭头／圆点共用状态。

## 验收

- 文档：本 SPEC；`docs/站点行为 SPEC.md` S9；`docs/项目解析.md` §4.9；`docs/Astro图片管线指南.md` 大图小节。
- 自动化：`pnpm` format／lint／check／test／build；浏览器行为仍由既有 `verify-image-layouts.mjs`／`verify-media-focus.mjs` 覆盖开关与焦点，相册翻页以本契约 + 手动抽检为准。
