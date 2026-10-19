# 正文图片大图相册：SPEC 与设计

## 行为契约

普通正文图打开既有原生 `dialog` 大图后，**同一 Markdown 正文根**（同一 `.markdown-content`，含博客正文、拾趣 MD、首页「近期书影游」等凡 MD 渲染进该根的内容）里、已经参与现有点击／键盘放大的图片组成一个相册：

| 义务 | 不变量 |
| --- | --- |
| G1 相册集合 | 与现有 lightbox 参与者一致：该根下的 `.image-view`（普通图、gallery／figure、`:::card` 竖／方封面——含带外链的影游卡与首页 MD 陈列架的**源**卡片）。**不另开**图片发现路径。过滤的是陈列架 **`data-marquee-clone` DOM 副本**（无缝横滑复制，避免同一封面进相册两次），**不是**排除陈列架本身。从副本点开时按原尺寸／可见 `src` 对齐回源张。 |
| G1b 不进入相册 | **Excalidraw**（`.excalidraw-embed`）：画布不是照片，有独立展开查看器；remark 也不为其包 `.image-view`。**`:::blog-link` 头像**：站点导航缩略图，remark 故意不包 `.image-view`，不进照片 lightbox。`titleImage` 头图／文稿列表缩略图／顶栏站点头像仍不在放大范围。 |
| G2 打开定位 | 从任一张（含陈列架源卡或点到的副本对齐后的源张）打开时，该图即为当前张；索引为 `当前/总数`（如 `2/5`） |
| G3 翻页 | 控件行居中上一张／下一张；首张／末张禁用对应箭头；不循环 |
| G4 控件行 | 位于大图与说明之下：左索引、中箭头、右关闭（✕）；点大图／Esc／遮罩／关闭仍退出 |
| G5 说明 | dialog 已有说明（alt）时随当前张更新 |
| G6 键盘 | Esc 沿用 dialog；打开期间 ←／→ 翻页（边界 no-op） |
| G7 范围 | 凡挂载 `ImageInteractions` 且 MD 根内已有 `.image-view` 放大处（博客、拾趣、首页书影游等） |

单张时仍显示 `1/1`、禁用两侧箭头，不隐藏整行。

## 「陈列架副本」说明

自动横滑（`scroll="auto"`）会在轨道里 **再复制一组** `.media-card`，并打上 `data-marquee-clone`。副本只为无缝循环，读屏忽略、不进 Tab。相册若把副本也算进去，同一封面会出现两次。因此：

- **纳入**：作者写的源卡片封面（`.image-view`）
- **排除**：带 `data-marquee-clone` 的复制节点
- **点副本仍可打开**：委托点击已支持；索引用 `src` 映射到源张

## 架构与 authority

```text
点图／键盘打开（含点到陈列架副本）
  → lightboxViewsInArticle：同 .markdown-content 下 .image-view，去掉 clone／excalidraw
  → resolveLightboxSlideIndex：副本 → 同源源张
  → dialog 展示 template 原尺寸 + 控件行
```

| Rule/state | Authority | Seam | 不放哪里 |
| --- | --- | --- | --- |
| 集合筛选、src 键、副本对齐、索引夹取 | `src/utils/image-lightbox-gallery.js` | `lightboxViewsInArticle`、`resolveLightboxSlideIndex`、`clampSlideIndex` | 在组件里再扫一套 DOM |
| 翻页状态、控件、键盘、dialog 生命周期 | `src/utils/image-interactions.ts` | 既有 `.image-view` + inert template；widget 只接线 | 第二套 lightbox；把 Excalidraw／blog-link 头像硬塞进照片相册 |
| 控件行样式 | `src/styles/prose.css` | `.image-lightbox__*` | 与正文横滚 `.image-gallery__*` 混用状态 |

## 验收

- 文档：本 SPEC；`docs/站点行为 SPEC.md` S9；`docs/项目解析.md`；`docs/Astro图片管线指南.md`
- `pnpm` format／lint／check／test；相册筛选／副本对齐单测见 `test/image-lightbox-gallery.test.mjs`
