# Agent Working Guide

本文件用于约束任何 Agent 在本 Astro 博客项目中的工作方式：先建立全局认知，再按任务补充专题上下文，避免无效扫描与误判。

## 1. 核心规则

1. 进入项目后，必须先读取 `README.md`
2. 先用 `README.md` 理解项目定位、技术栈、路由、内容结构、配置入口和目录分层
3. 任务明确后，再按需读取 `docs` 下的相关文档
4. 不要默认通读整个 `docs/`，除非任务本身就是全局梳理、架构审查或文档盘点
5. 一切以项目当前源代码为准，文档只作为辅助上下文，内容可能过时

## 2. 工作原则

- `README.md` 是总入口，优先用于建立项目全局认知
- `docs/` 是专题补充材料，只读取与当前任务直接相关的部分
- 修改前先判断需求归属：页面、内容链路、样式、SEO、导航、TOC、字体或历史调整
- 如果需求跨越多个模块，可以组合读取多份文档，但仍以任务相关性优先
- 如果文档描述与当前代码不一致，以当前源代码行为为准，并在必要时顺手更新文档

## 3. 最小阅读路径

必读文件：

- `README.md`

按需补读：

- 架构理解、调用链路、目录职责：`docs/项目解析.md`
- Astro 语法、`.astro` 组件机制、编译过程：`docs/Astro.md`
- SEO、canonical、sitemap、RSS：`docs/Canonical URL、Sitemap、RSS.md`
- Insights 页面或内容链路：`docs/feature/Insights模块更新说明.md`
- Friends 页面或友链数据：`docs/feature/友链模块说明.md`
- 博客目录、桌面端 TOC、移动端 TOC：`docs/feature/文章TOC与响应式导航说明.md`
- 博客内容、frontmatter 与标题图：`blog-content-publisher-skill/SKILL.md`
