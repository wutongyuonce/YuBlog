# Agent Working Guide

先读 `README.md`，再按任务补读。源代码为准。

## 入口

1. `README.md`：定位、路由、命令
2. `docs/项目解析.md`：权威表、seam、各页实现、加功能该动哪
3. 改文案/数据：`blog-content-publisher-skill/SKILL.md`（按页面）
4. 页面行为：`docs/站点行为 SPEC.md`；变更记录：`CHANGELOG.md`

## 按需

- Astro 语法：`docs/Astro.md`
- Canonical / Sitemap / RSS：`docs/Canonical URL、Sitemap、RSS.md`
- 字段契约：`src/content/schema.ts`
- 导航 / 社交：`src/config.ts`
- 壳层样式：`public/shell.css`

## 文档与变更记录

- 网页结构、交互或代码发生有效变化时，在同一修改中更新 `CHANGELOG.md` 的「未发布」条目；只描述最终结果，相关调整合并为一条。文章、关于、拾趣、项目、友链等内容数据不记入。
- README、SPEC、架构和操作指南只描述当前状态，随实现同步更新；不要新增阶段性报告、调试流水或测试结果快照。
- 发布时将「未发布」条目归入实际版本与发布日期；未经发布不标记为已发布，不补写未经确认的历史版本。
