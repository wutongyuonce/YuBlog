# RSS 全文支持调研

调研日期：2026-09-30。仓库基线：`f423c06`，本地安装 Astro `7.3.5`。本文是选型建议，尚未实现全文 RSS。

后续开发以 [RSS 全文支持 SPEC 与实现设计](./RSS%20全文支持%20SPEC.md) 为准；本文保留选型背景，不作为另一份实现契约。

## 结论

建议使用 **`@astrojs/rss` 生成 RSS XML，复用本站 Astro 管线生成正文，再做少量阅读器适配**。

官方包解决的是订阅源序列化，不会自动渲染文章。无论手写还是使用官方包，正文、图片和阅读器兼容都需要处理。升级到全文后，继续维护自己的 XML 生成逻辑收益不大；也没有必要单独建立一套 Markdown 渲染规则。

原有《Canonical URL、Sitemap、RSS》的“不必换”结论针对摘要订阅已经够用的需求。此次要求阅读器内读完文章，选型前提已经变化。

## 本站现状与真正的难点

- `src/pages/rss.xml.js` 手工生成 RSS 2.0，仅提供标题、链接、GUID、发布日期和摘要，没有 `content:encoded`。
- 复用 `src/utils/data.ts` 筛选及排序；生产环境排除草稿。文章路径经过逐段编码，并支持站点 base。
- `link` 允许使用文章的 `redirect`；`guid` 始终使用本站文章 URL。迁移时必须保留这个区别。
- 当前 `src/content/blogs` 有 42 篇 `.md`，没有 `.mdx`；集合配置允许未来使用 MDX。Markdown 源文件合计约 1.93 MB，不能把全文后的体积视为当前摘要源的体积。
- `astro.config.ts`、`plugins/index.ts` 已配置 CJK 强调、图片宽度标记、公式、提示框、指令、标题锚点和代码块处理。
- 正文大量使用 `./xxx-img/xxx.png` 之类本地图片。直接将源路径拼成站点绝对 URL，不能得到 Astro 构建后的图片资源。

检查本地已有 `dist/rss.xml`：42 条、19,607 字节、不含全文。这是已有构建产物的观察，本轮没有重新构建。

本地 Astro 的 `node_modules/astro/dist/content/runtime.js` 中，`render(entry)` 会处理正文图片引用，再返回 `Content` 组件。因此不建议直接拿 `entry.rendered.html` 当成最终可发布 HTML；也不能把 `render()` 的返回值直接当字符串使用。

## 方案比较

| 方案 | 维护成本与限制 | 建议 |
| --- | --- | --- |
| 继续手写 XML，再添加全文 | 不增加 RSS 依赖，但命名空间、转义、正文封装及扩展字段继续由本站维护；正文难题仍存在 | 能做，但不是首选 |
| 官方 RSS 包 + `markdown-it` | XML 简单；正文另起一条管线，需重新适配本站插件语法及本地图片 | 不适合直接照搬 |
| 官方 RSS 包 + Astro 原有渲染 | XML 交给官方；保留现有内容处理，只添加面向阅读器的转换 | **优先方案** |
| 构建后解析文章页面，再生成 RSS | 能取到最终 HTML，但绑定页面结构、构建目录和执行阶段，开发时也需另作安排 | 备用方案 |

官方 RSS 文档示例使用 `items.content` 接收 HTML，也明确提醒相对链接、图片、样式和脚本需要额外处理；示例中的 Markdown 解析器不处理 MDX JSX/组件。[官方全文 RSS 文档](https://docs.astro.build/en/recipes/rss/#including-full-post-content)

源码确认，`@astrojs/rss` 将 `content` 输出为 `content:encoded`，并添加相应命名空间；`description` 可以继续保留摘要。它是从 endpoint 调用的 helper，不是加入 `integrations` 后自动完成全文输出的开关。[官方包源码](https://github.com/withastro/astro/blob/main/packages/astro-rss/src/index.ts)

构建后方案可以使用官方 `astro:build:done` hook，但正文提取与 feed 生成仍需自己实现。上表对复杂度的判断来自本站现有静态构建结构。[Integration API](https://docs.astro.build/en/reference/integrations-reference/#astrobuilddone)

## 推荐实现路径

```text
现有文章集合 → 筛选、排序
                    ↓
              render(post).Content
                    ↓
       Astro Container 渲染正文 HTML
                    ↓
       清理交互元素、转换地址、保留内容
                    ↓
         @astrojs/rss 的 items.content
                    ↓
                 /rss.xml
```

候选方法是 `render(post)` 配合 `AstroContainer.renderToString(Content)`。只渲染正文组件，不渲染整页布局，避免把导航、侧栏、目录按钮和页脚塞进 RSS。官方 RSS 文档链接了采用此方式的社区示例，但它不是自动保证本站兼容的官方实现。

**Container API 目前仍标为 experimental**，官方提示 minor/patch 升级也可能发生破坏性变化。它提供将组件输出为 HTML 字符串的能力；MDX 或其他框架组件还需对应 renderer。本站当前仅有 Markdown，先验证这个实际范围，不提前构建通用多框架适配层。[Container API](https://docs.astro.build/en/reference/container-reference/)

这条路径需要先做生产构建验证，尤其确认图片资源最终被输出。如果出现 Container 与当前图片管线不兼容，应比较构建后提取方案，不依赖 Astro 私有内部函数强行绕过。

正文适配应集中在一个小工具中：

1. 基于渲染后的资源地址转换 `img.src` 和链接 `href`；保留 `srcset` 时同步转换每个候选地址，或删除它并保留可用的 `src`。源文件相对图片不能直接按文章 URL 拼接。
2. 普通相对链接和 `#锚点` 以文章永久 URL 为基准解析，同时保留合法的 `mailto:` 等协议。
3. 清理脚本、交互按钮等阅读器不需要的元素。采用 HTML 解析/清洗工具，避免用正则承担整个 HTML 转换。
4. 保留段落、列表、引用、代码、表格、图片和提示框文字。清洗白名单需按实际内容配置，不能使用默认值后就认定全文完整。
5. 公式需验证清洗后仍可读；不能假设阅读器加载本站 KaTeX CSS。必要时保留可读公式源码作为降级。Mermaid、视频或客户端组件同样需要静态内容或原文链接。

“完整”建议定义为正文内容完整且可读，不要求复制博客主题、复制按钮和浏览器交互。公式及图表的具体降级效果应在选定阅读器中验证。

## 迁移时必须保持的行为

- 继续使用 `/rss.xml`，沿用当前文章范围、排序、日期、摘要、base 路径和中文/嵌套路径编码。
- 保留每篇文章现有 GUID，避免破坏订阅去重。官方包默认以 `link` 生成 GUID，而本站允许 link redirect；需通过条目 `customData` 显式保留原 GUID，并测试最终 XML。不要传入一个源码没有支持的独立 `guid` 参数。
- 官方包不自动输出 Atom self。需要时通过 `xmlns` 和 channel `customData` 添加 self 链接与 `language`；自行插入的 XML 仍需转义。
- 全文放入 `content:encoded`，摘要继续放在 `description`。HTML 清洗和 XML 序列化各由对应工具负责，防止重复转义。
- 不因体积增大擅自只保留最近 N 篇。先保持现有 42 篇的范围，测量全文 XML 大小和构建开销，再决定是否需要另设订阅范围。
- 渲染失败应使构建明确失败，不能悄悄把某篇降回摘要而宣称全文完成。

字段覆盖、默认 GUID、尾斜杠行为和自定义 XML 接口均需按实际安装版本回归。[官方 README](https://github.com/withastro/astro/blob/main/packages/astro-rss/README.md)、[官方源码](https://github.com/withastro/astro/blob/main/packages/astro-rss/src/index.ts)

## 落地验收与本轮边界

实现时至少覆盖：正文首尾内容、代码/表格/提示框、公式可读性、本地图片最终资源存在、无 Astro 图片占位符、HTML 地址可在站外使用、中文与嵌套 URL、稳定 GUID、生产草稿排除，以及包含 `&`、`<`、`]]>` 时 XML 仍可解析。

验证应包含生产构建及最终 `dist/rss.xml`，不能只测试字符串工具；然后在实际阅读器抽查图片和公式。记录生成大小和构建耗时即可，暂不增加缓存、分页源或定时抓取服务。

本轮已完成仓库与本地 Astro 源码检查、官方文档及 RSS 源码核对；现有 `node --test test/rss-feed.test.mjs` 两项测试通过，无跳过。这两项只证明现有路径编码和 XML 转义，不证明全文方案成立。本轮仅新增此调研文档，未安装依赖、未修改 RSS 实现、未执行新方案构建或阅读器兼容验证。
