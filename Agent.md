# Agent Working Guide

先读 `README.md` 了解项目，再按 `docs/README.md` 的任务索引进入对应文档；现行规则以源码、配置和属主测试核实。

## 入口

| 任务 | 必读入口 |
| --- | --- |
| 本地运行、个性化、部署与检查 | `docs/guides/development.md` |
| 改文案、文章、图片、拾趣、项目或友链数据 | `blog-content-publisher-skill/SKILL.md`；字段见 `src/content/schema.ts` |
| 页面、筛选、导航、上下篇、目录、主题、评论行为 | `docs/design/site.md` |
| 改代码、决定模块归属或共享样式边界 | `docs/design/architecture.md` 的模块属主与实现边界 |
| 图片、卡片日期、相册、HTML／音视频、Excalidraw、博文链接卡 | `docs/design/content.md` |
| canonical、sitemap、RSS 身份与全文表达 | `docs/design/distribution.md` |
| 首页听歌接口、缓存、凭据及页面状态 | `docs/design/listening.md` |
| Oneko 开关、皮肤与 ClientRouter 重建 | `docs/design/oneko.md` |

Astro 通用语法笔记在 `docs/reference/astro.md`，只作学习参考。导航、社交、开关的配置入口是 `src/config.ts`，正文管线注册在 `plugins/index.ts`。

新增拾趣分类属于内容维护：在 `src/content/interests/` 顶层新增 `.md`／`.mdx`，填写 `title`、`description`、`order`，构建后自动生成子页、入口和菜单。`recent.md` 排除出分类，图标只在 `INTEREST_ICONS` 配置，无图标保留纯文字。

## 文档与变更记录

- 同一规则完整维护在对应专题，其它文档引用；改变行为时同步代码、测试、专题与作者示例。
- README 提供总览，`docs/README.md` 提供入口；不为一次小改动另建 SPEC、阶段性报告或测试快照。
- 内容发布 skill 保持可独立分发，不能链接包外仓库文档。
- 网页结构、交互或代码的有效变化写入 `CHANGELOG.md` 的未发布区；每条说明关键变化，并保留必要的使用场景、影响范围与兼容性信息；简单改动一句话，复杂改动可用两三句。合并重复调整，省去代码参数、调试过程或测试快照。仅较大功能按需链接 `docs/` 中的设计，小改动直接讲清楚，不为凑链接新增文档。文章、关于、拾趣、项目、友链等内容数据不记入，实际发布时再填写版本与日期。
