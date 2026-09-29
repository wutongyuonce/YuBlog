# Astro 7 迁移方案

## 目标与边界

从当前 Astro 5 升到 Astro 7，保持博客为静态站。读者看到的文章列表、Markdown/MDX 正文、图片宽度与优化、字数和阅读时间、目录锚点、代码块、公式、提示框、搜索、RSS、分页和导航行为不因升级丢失。开发与 CI 使用受支持的 Node 版本；构建或内容校验失败必须明确报错，不能用关闭插件或跳过检查换取绿色结果。

**非目标**：不迁移到 SSR/adapter、不引入路由缓存或新路由、不将现有 remark/rehype 插件改写为 Sätteri 插件、不改文章内容/URL/视觉设计、不进行无关重构、不合并 PR。统一 Markdown 管线先保留；只有实际构建验证证实需求时再调整实现细节。

## 当前架构与做法

| 义务 | 唯一属主 / 接口 | 迁移做法 |
| :--- | :--- | :--- |
| 框架及依赖兼容 | `package.json`、`pnpm-lock.yaml`、CI | 更新 Astro、MDX、unified Markdown 处理器及必须的依赖；本地和 CI 均使用 Node >=22.12；锁文件保持可冻结安装 |
| Markdown/MDX 行为 | `astro.config.ts` → `plugins/index.ts` | 明确使用 `@astrojs/markdown-remark` 的 `unified()`；保留现有 remark/rehype 顺序，含图片宽度、阅读时间、CJK 强调、公式、提示框、标题 ID/锚点、表格包装；不因 Sätteri 默认管线绕过插件 |
| 内容字段及错误 | `src/content/schema.ts` | 迁移到 `astro/zod` 和 Zod 4 类型/API；保持 URL、非空分类、标题配图 alt 的失败语义，以及日期、默认值、修剪后的输出 |
| HTML 行为 | `astro.config.ts` | 去掉已稳定/删除的实验开关，保留仍支持的开关；保留原先 HTML 空白压缩行为，避免相邻内联元素意外粘连；保留预渲染冲突失败配置 |
| 构建集成 | `plugins/astro-subset-title-fonts.ts`、`plugins/postcss-katex-woff2-only.ts` | 仅在 v7 类型/实际构建要求时调整；保留缺失字体产物直接失败、KaTeX 只留 woff2 的行为 |
| 可运行回归 | `test/`、`scripts/` | 增加一项产物级 Markdown 检查，证明插件确实进入真实构建（不是仅单测插件）；覆盖宽度标记不泄漏、优化图片宽度、字数/阅读时间、标题锚点、代码块以及现有关键渲染特性 |
| 文档 | `README.md`、`README_ENG.md`、`docs/项目解析.md`、本报告 | 更新当前框架版本及 Markdown 管线说明；本报告最终只保留有效实现与验收事实 |

## 验收标准

1. `pnpm install --frozen-lockfile` 在 Node >=22.12 可用；`pnpm check`、`pnpm lint`、`pnpm format`、`pnpm test`、`pnpm build` 和 `pnpm test:built-pagination` 全通过（不跳过）。
2. 构建后的首页、文章页、标签、归档、项目、关于、RSS 和 sitemap 存在；文章 URL 不变，搜索索引存在；标题字体子集和 KaTeX 字体校验仍生效。
3. 产物测试读取实际文章 HTML，验证 `|w480` 等图片 alt 标记不泄漏、输出对应 width 和优化 URL；有字数/非零阅读时间、有效标题 ID/锚点、可识别的代码块/公式/提示框（选用仓库真实文章作为夹具）。插件接线断掉时此测试必须失败。
4. 现有内容的缺失必填字段、非法 URL、带图片但缺 alt 等错误不会被迁移吞掉；若构建失败，先在 schema/配置属主处修复，不绕过校验。MDX、图片和公式等实物抽样核对。
5. 不引入 SSR、改版或无关代码修改；PR 仅覆盖此迁移。

## 已接受的取舍和失败路径

使用 unified 而非 Astro 7 默认的 Sätteri：当前图片宽度、阅读时间、标题、CJK、公式、提示框等插件都已由 `plugins/index.ts` 统一拥有；为节约少量构建时间改写整条管线不在本次范围内。配置保留旧版 HTML 压缩行为、将预渲染冲突设为 `error`。非法 URL、空分类、标题图片无 alt 在 `src/content/schema.ts` 处拒绝；图片/字体缺失和模板非法标记在构建时失败，不做静默降级。Node 最低版本与 Astro 7 一致为 22.12；CI 使用 Node 24。

## 当前实现与验证

- `astro@7.3.5`、`@astrojs/mdx@8.0.2`、`@astrojs/markdown-remark@7.3.1`；Zod 由 `astro/zod` 导入；图片助手使用 Astro 公共 `SchemaContext` 类型。
- `pnpm install --frozen-lockfile` 通过；`pnpm check`：98 个文件，0 错误/警告/提示；`pnpm lint`、`pnpm format` 通过；`pnpm test`：65/65 通过。
- `pnpm build`：49 个静态页面，Pagefind 索引 42 页，2 个被 CSS 引用的标题字体子集校验通过；`pnpm test:built-pagination` 1/1、`pnpm test:built-markdown` 3/3 通过。
- 真浏览器抽检：首页图片加载、文章标题与阅读时间、`|w480` 图片属性、目录锚点，以及从文章页通过 ClientRouter 到标签页正常；未发现水平溢出。未在本地运行 CI 的 Node 24 环境（本地为 Node 22.22.2）；PR 的 CI 将复验。
