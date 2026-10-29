# YuBlog 图标审查笔记

- **日期**：2026-10-29（Asia/Shanghai）
- **审查基线**：只读审查时 `main` @ `2f2eb14`；落地前已 `git pull --ff-only` 至当时最新 `main`
- **状态**：工作区已实现；loop-review 中（提交／推送后回填 hash）
- **轴**：Standards（本仓约定／管线一致性）+ Opinionated（集合分裂、死代码、文档过时）；不扩成整站 UI redesign

---

## 落地摘要

| 项 | 处理 |
| --- | --- |
| P1 ToTopButton `aria-label` | 已修：与 `title` 对齐为 `Scroll to top`；装饰图标加 `aria-hidden` |
| P1 关于页死路径 | 已修：skill 去掉「关于页独有图标／`.about-social__icon`」；删 `public/shell.css` 死规则 |
| P1 搜索集合分裂 | 已修：`SearchSwitch` 全部改为 ri（search／corner-down-left／arrow-up/down／arrow-down-double／expand-diagonal）；无 Search 例外文档 |
| P1 外链示意三套 | 已修：`Link`／rehype carbon → `ri-arrow-right-up-line`（与名片 RSS 同源）；菜单／首页次级入口保留文本 `↗`，`site.md` 写明权威 |
| P1 ListItem 对齐 | 已修：去掉 flex 下无效 `vertical-align`；注释说明列表字更小／非粗体、几何居中已齐、不加 translateY |
| P2 死 safelist menu-2/3 | 已删 |
| P2 重复 simple-icons safelist | 已删（仍由 `AUTHOR_LINKS.map` 覆盖） |
| P2 PostMeta safelist | 保留 + 注释「防御性／扫描边界」 |
| P2 `projecstData` 拼写 | 已改为 `projectsData` |
| P2 Theme／Search／NavItem `aria-hidden` | 已做（Accent 原本已有） |
| P2 types／schema 示例 | 顺手对齐现役 ri + simple-icons + uil |

### 明确未做（按任务非目标）

- 不把 Excalidraw／lightbox／版权／歌单／favicon Iconify 化
- 不为 projects 硬加 icon 数据
- 不做整站图标组件抽象
- 不改 FAB／返回链／标签间距等无关逻辑
- 顶栏／名片 GitHub 仍用 `uil`（可选审美统一，未做）
- 菜单文本 `↗` 未改成 Iconify（观感不变、改动面小；权威已写文档）

---

## 1. 总览

**几乎是 Iconify，但不是全部。**

管线一句话：`@unocss/astro` + `unocss.config.ts` 的 `presetIcons`（依赖 `@iconify/json`），动态类靠 `safelist` 吃 `AUTHOR_LINKS` / `MORE_LINKS` / `INTEREST_ICONS` / `UI.socialLinks` / projects `icon`；静态 `i-*` / `u-i-*` 由 content 扫描抽出。

站内导航、社交、元信息、搜索/主题/配色、FAB/TOC 控件上的矢量符号，**默认走这套管线**。站点级 favicon/manifest、若干手写 SVG、外链 favicon URL、头像/友链图片、emoji／文本箭头 **不在 Iconify 内**。

落地后壳层 UI 默认 **ri**；品牌社交 **simple-icons**／**uil**；外链 Iconify 箭头统一 **`i-ri-arrow-right-up-line`**；紧凑菜单用文本 **↗**。

---

## 2. 清单：集合 × 表面（落地后）

### 2.1 UnoCSS / Iconify 管线

| 项 | 现状 |
| --- | --- |
| 集成 | `astro.config.ts` → `unocss({ injectReset: true })` |
| `presetIcons` | `extraProperties`: `display:inline-block`、`height/width:1.2em`、`vertical-align:text-bottom` |
| content 扫描 | `./src/{content,pages,layouts}/**/*.{md,mdx,astro}` |
| safelist 动态源 | `navIcons`、`socialIcons`、`projectIcons`、`INTEREST_ICONS`、`MORE_LINKS.icon`、`AUTHOR_LINKS.icon` |
| safelist 手工 | PostMeta 四枚（防御性注释）+ Rose 背景 utility；已删 menu-2/3 与重复 simple-icons |

### 2.2 现役 Iconify 类（按集合）

| 集合 | 用途 |
| --- | --- |
| **ri**（主） | PostMeta／ListItem；拾趣／更多；邮箱；主题／配色／回顶／MobileToc／Search；BlogProfile RSS 与外链新标签示意 |
| **simple-icons** | 首页社交品牌：X／Instagram／Bilibili／小红书 |
| **uil** | GitHub（名片 + 顶栏） |

已移除运行时依赖：**grommet-icons**、**material-symbols**、**carbon**（外链箭头）。

### 2.3 组件表面要点

| 表面 | 备注 |
| --- | --- |
| `ToTopButton` | `title` + `aria-label`；图标 `aria-hidden` |
| `SearchSwitch` | 全 ri；装饰图标 `aria-hidden` |
| `ListItem` | 无无效 `vertical-align`；不加 translateY（见注释） |
| `PostMeta` | 保留 `translateY(0.07em)` |
| `Link` + rehype | `showNewTabIcon` 开启时输出 `ri-arrow-right-up-line`（现配置仍为 `false`） |
| `NavDropdown` 等 | 外链紧凑处文本 `↗` |

---

## 3. 原问题对照（审查时 P1／P2）

### P0

**无**（审查与落地后均无）。

### P1 → 全部已修

见上表。

### P2 → 任务要求项已修；可选审美项未扩

---

## 4. 例外（非 Iconify，仍保留）

Favicon／PWA、Excalidraw 工具条、Lightbox、Warning SVG、歌单 SVG、版权卡、FAB 进度环、Markdown 外链 favicon img、友链／头像 img、文本／emoji（含菜单 `↗`）、热力 CSS chevron。

---

## 5. Standards / Opinionated（落地后）

**Standards**：动态图标 safelist、拾趣无占位、关于页文档与代码一致、ListItem／PostMeta 对齐策略有注释、外链示意权威写明。

**Opinionated**：手写 SVG 边界清楚；无整站图标组件抽象；菜单保留文本箭头是有意取舍。

---

## 6. 验证与 commit

- 门禁（本机已跑）：`pnpm format:write`、`pnpm lint`、`pnpm check`（0 errors）、`pnpm test`（293 pass）
- Round 1 自审 + Codex 补充：义务均满足；唯一确认问题为本笔记状态超前（本轮已改）
- commit／hash：提交后回填
