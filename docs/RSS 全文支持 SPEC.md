# RSS 全文 SPEC 与实现职责

本文规定 `/rss.xml` 的正文表达、地址与身份规则、失败语义、资源边界和验收接口。页面行为见 [站点行为 SPEC](./站点行为%20SPEC.md)，发布变化见 [CHANGELOG](../CHANGELOG.md)。实现、测试与本文应同步维护。

## 1. 范围与设计取舍

下表规定当前对外行为与取舍；实现细节见权威表，不维护另一份页面专用 RSS 渲染。

| 层次 | 必须决定的问题 | 采用的决定与理由 |
| --- | --- | --- |
| 根问题 | 谁使用，怎样算成功？ | 已订阅和新订阅本站的读者，在阅读器中读到每篇文章的完整正文，不必为剩余文字跳回网站 |
| 范围 | 全文是否等于整个网页？ | 全文指文章正文；不包含导航、目录控件、页脚、封面布局和站点交互 |
| 范围 | 全部文章还是最近 N 篇？ | 覆盖已发布集合，不截断文章、不限制篇数、不新增分页源 |
| 兼容 | 是否换订阅地址或文章身份？ | 保留 `/rss.xml`、文章 GUID、发布日期、排序和 redirect 链接语义 |
| 正文 | 摘要是否取消？ | 保留 `description`；全文使用 `content:encoded`，两者共存 |
| 正文 | 用什么渲染文章？ | 复用 Astro 内容管线；不使用第二套 Markdown 解析器 |
| 正文 | 图片、代码和复杂内容怎样呈现？ | 图片保留单个可访问 `src`；代码保留实际行与空行；公式使用 LaTeX 文本；Mermaid 保留源码；不构建未使用的播放器适配 |
| 异常 | 某篇失败是否发布其余文章？ | 不允许部分成功或退回摘要；该次 feed 生成失败，生产构建失败 |
| 约束 | 是否加入缓存、队列或后台服务？ | 不加入；每次请求/构建独立生成，逐篇处理正文 |
| 约束 | 是否保证所有阅读器视觉一致？ | 不保证；保证基础 HTML 可读、不依赖本站 CSS/JS，接受阅读器自身排版 |
| 验收 | 何时能称完成？ | owner-level 测试、生产产物检查、仓库 CI 对应检查通过；实际阅读器抽查单独报告 |

## 2. 内容与数据来源

当前博客集合使用 Markdown，schema 仍支持 MDX；文章数量随内容变化，不作为规则常量。Astro 项目采用 7 系列。正文已经由 `astro.config.ts` 和 `plugins/index.ts` 统一处理本地图片、CJK 强调、代码、数学公式、提示框和指令。文章页通过 `render(post)` 获取 `Content`。

文章范围与顺序由集合工具定义：RSS 使用 `getPublishedBlogPosts()`，在开发和生产环境均排除草稿；网页预览仍使用 `getFilteredPosts()`，开发包含草稿、生产排除草稿；`getSortedPosts()` 按发布日期降序、同日期按 ID 排序；路径使用 `withBasePath()` 和逐段编码。日期排序不排除未来日期；本项目没有定时发布规则。

文稿分类入口由已发布文章的 `category` 原值生成，不合并别名；名称编码片段（如 `/blogs/#旅行`）和兼容的 `?category=` 按原值精确筛选，只影响网页，不影响 RSS 范围。旧 `#tech`、`#thought`、`#diary` 仅作 URL 兼容别名，分别定位原值“技术”“思考”“日记”，英文原值 `tech` 等用 `#category=tech` 逃逸。新分类的已发布文章进入同一个 `/rss.xml`；分类入口和基于原始名称稳定 hash 的颜色不修改 GUID、发布日期或正文。源不输出分类元数据，不提供按分类订阅的独立源。

目标是以原订阅地址提供完整、可解析、站外可读的文章内容，同时避免第二套文章渲染逻辑。源的篇数和体积由当前已发布集合决定，不采用历史构建值作为约束。

## 3. 主要场景

### S1：订阅全文源

读者订阅 `/rss.xml` 后，阅读器从同一地址获取每篇文章的摘要与完整正文。GUID、发布日期和链接语义由本规范维护；修改正文不会生成新的文章身份。阅读器何时刷新缓存由其自身决定，本站不强制刷新已缓存条目。

### S2：发布或修改文章

作者新增文章并成功构建后，源中出现对应条目及全部正文。修改现有文章只更新内容，不使用 `lastModDate` 替换 `pubDate`，也不改变 GUID。开发和生产环境的草稿均不进入源；空集合生成合法空 channel。正文转换接受空输入，不伪造摘要；但整站构建要求页面的正文容器有内容，源正文为空会由构建末尾检查拒绝。仅含视频等被 RSS 清洗掉的正文仍可生成只有原文入口的条目。

### S3：阅读技术文章

读者可以看到正文从开头到结尾的文字、段落、列表、引用、提示框文字、表格、代码和图片。链接可从阅读器访问；代码中的缩进、逻辑换行和空行保留。公式、图表和媒体采用第 4 节的静态表达，不需要加载本站主题或执行脚本。

### S4：文章具有 redirect 或部署使用子路径

`link` 仍指向 `post.data.redirect || articleUrl`；GUID、相对正文地址解析基准及文末原文链接仍指向本站 `articleUrl`。正文来自本地文章，不能抓取 redirect 目标作为正文。`SITE.base` 参与文章、首页及 feed 地址生成；已经包含 base 的渲染资源地址不得再重复添加 base。

### S5：生成失败或构建中断

某篇渲染、转换或序列化失败时，构建日志能够定位文章 ID 并保留原始错误。生成过程不跳过该篇、不返回半个 feed、不回退摘要。修复后可以重新构建；RSS 本身没有需恢复的持久状态。失败构建不得作为成功产物交付，但本功能不实现部署平台的原子发布或回滚。

## 4. 产品规则与正文契约

| ID | 规则 / 不变量 | 场景与违约表现 |
| --- | --- | --- |
| R1 | 文章范围与顺序沿用现有集合工具，开发和生产均不含草稿，不新增数量限制或日期过滤 | S1、S2；漏文、草稿泄露或重排 |
| R2 | `/rss.xml` 与现有 GUID 保持；保留 pubDate、可选摘要和 redirect 链接语义 | S1、S2、S4；去重被破坏、发布日期变化 |
| R3 | 每条提供正文 HTML，不截断；正文内容不能因剥离样式/控件丢失 | S2、S3；只剩摘要、代码拼行、提示内容丢失 |
| R4 | 图片指向 Astro 已解析资源，链接在站外可用；保持中文和嵌套路径编码 | S3、S4；图片占位符或相对资源残留 |
| R5 | 输出无需执行脚本；不输出事件属性、危险 URL、站点样式或客户端控件 | S3；阅读依赖本站运行环境 |
| R6 | RSS XML 可解析且字段不重复转义；空集合合法 | 全部；订阅器拒绝源或显示实体乱码 |
| R7 | 生成异常明确失败，无摘要降级、条目跳过或部分响应 | S5；失败被伪装成成功 |
| R8 | 生成不抓取远程正文，不自行下载/内嵌媒体，不引入跨请求缓存或全量并发渲染 | S2、S5；不必要的网络/内存放大 |

### 4.1 文字、代码与复杂内容

| 内容 | RSS 表达 |
| --- | --- |
| 标题、段落、强调、删除线、列表、引用、分隔线 | 保留基础 HTML 语义与文字；移除自动追加的标题 `#` 控件，不移除作者正常链接 |
| 表格 | 保留行列、表头、单元格及必要的跨行/跨列属性；不保证窄屏视觉布局 |
| `:::card` | 横卡保留类别、标题链接、封面、可选数值评分与介绍；竖卡保留封面、标题链接与完整小字，栏按源顺序展开。评分文本由共享 Markdown 插件输出，不依赖 CSS 星星 |
| 提示框与指令 | 保留标题、正文、有效链接和图片，允许退化为普通块；不保留主题装饰 |
| 普通代码块 / Expressive Code | 转成基础 `pre > code`，保留代码文本、缩进、逻辑行与空行，保留已有文件名/标题文字；移除复制按钮、行号装饰及折叠摘要控件，隐藏源码完整保留 |
| 行内 / 块级公式 | 从 KaTeX 的 `annotation[encoding="application/x-tex"]` 读取源码，分别输出 `code` / `pre > code`；公式只出现一次，不输出重复的 MathML/视觉子树，不引入公式图片服务。识别为 KaTeX 但没有源码时明确失败 |
| Mermaid | 以代码块保留图表源码；本站当前就是此类代码块，不新增图表渲染器 |
| 任务列表 | 复选框转为 `[x]` / `[ ]` 文本，保留完成状态，不输出可交互表单 |
| 折叠内容 | 展开为普通内容，保留摘要标题和隐藏区文字；不能只保留折叠标题 |
| 嵌入媒体 | 清洗移除嵌入控件及其子树，不新增播放器或 URL 提取适配；保留控件外已有说明和普通链接，读者可通过文末原文入口访问 |
| 封面、导航、侧栏、页脚 | 不属于正文；不复制进 feed，不额外调用封面图片生成流程 |

每篇非空或空正文后统一附加简短的“阅读原文”链接，目标为本站永久 URL，供读者查看完整网页体验。它不替代任何原有正文。

Expressive Code 已有输出用 `.ec-line` 包裹每一行，部分换行仅由块级布局表达。不能只取整个 `pre` 的 `textContent`，否则相邻行会拼接。应在剥离样式前跳过代码块内的 `summary` 控件子树，再从每个源码 `.ec-line` 的 `.code` 取文本，用换行连接；普通正文 `details` 的摘要标题仍保留。表示空行的单个换行节点规范为一条空行，不对非空行 `trim()`。普通 `pre/code` 沿用其文本换行。

### 4.2 图片、地址与清洗

- 每张正文图片保留 `src`、`alt`、有效尺寸和可选 `title`；不追加封面。使用 Astro 渲染后的图片地址，不从源 Markdown 路径猜产物名称。
- `gallery`／`figure` 与普通正文图的放大包装沿用既有 sanitizer 去掉 inert `template`、样式及控件，剩余全部图片和文字按源顺序降级，不新增 RSS 图片布局解析器。
- 去掉 `srcset`、`sizes`、懒加载属性与样式，仅保留一个有效 `src`。有 `picture` 时保留其中的 `img`，不维护第二套响应式图片策略。
- HTTP(S) 绝对地址保持可用；`//host/path` 按站点协议解析；相对 `href` 和 `#fragment` 基于本站文章 URL 解析。渲染后的根路径资源基于站点 origin 解析，不重复追加 base。
- `a.href` 允许 HTTP(S)、`mailto:`、`tel:`；图片只允许 HTTP(S)。不允许 `javascript:`、`data:`、`file:` 等。非法链接移除地址并保留文字；无法获得合法 `src` 的正文图片明确失败，不能假装图片完整。
- `.md` 源文件链接不会被猜测成新的文章 slug；只做标准 URL 解析，不在 RSS 内实现第二套路由映射或全站断链检查。
- 删除 `script/style` 等非正文子树、嵌入控件和已识别交互按钮。移除事件属性、class、style、站点 data 属性及不需要的 id/name，保留普通未知包装元素内的文字。清洗用成熟的 HTML sanitizer，不手写安全过滤器。
- 清洗前完成需要 class/属性识别的代码、公式、提示及链接转换；清洗后只序列化，不再注入未清洗 HTML。文字和属性通过 AST/序列化器转义，禁止拼接未经处理的文章 HTML。

### 4.3 RSS 外层

channel 的标题、介绍、语言来自 `SITE.title`、`SITE.description`、`SITE.lang`；首页和 `atom:link rel="self"` 为带 base 的绝对 URL。保留 `Content-Type: application/rss+xml; charset=utf-8`。不新增 stylesheet、作者邮箱、分类协议、Atom/JSON Feed 或依赖当前时间的 `lastBuildDate`。

使用官方包默认的 content 命名空间。对已有文章显式提供原 GUID，不能直接接受官方包“GUID 等于 link”的默认值。插入 `customData` 的站点值和 GUID 必须走 XML 转义；全文 HTML 交给官方包序列化，不预先做整段 XML 转义。

## 5. 失败、并发与资源语义

一次 endpoint 调用创建一个 Container，复用它逐篇完成渲染和转换；保持排序后的次序，不使用对所有文章的 `Promise.all()`。完成所有条目并成功序列化后才返回 Response。该调用内存仍需保存所有条目及最终 XML，空间随全文总量增长；串行处理只限制同时进行的正文渲染为一篇，不承诺常量内存。

没有持久缓存、锁、重试队列、断点续传、可配置并发或后台抓取。不同开发请求独立工作；构建期间并行修改源文件、并发构建到同一输出目录不提供额外快照/隔离保证。取消遵循 Astro/构建进程行为，不自行恢复。

依赖 Astro 本身的图片处理照常执行；RSS 适配层不新增 HTTP 请求，也不做远程 URL 存活探测。同站本地产物存在性在构建验收中验证，远程资源未来可用性不属于本功能保证。

不设任意正文大小或篇数上限，也不以固定构建耗时作为功能保证。若出现实际构建限制，应重新评估设计，不能自动截断。

异常在产生它的模块抛出；endpoint 消费渲染结果时拒绝空 HTML，防止 Astro 内容加载器吞错后返回空 `Content`，开发请求也不会成功发布丢失正文的条目。此检查发生在 RSS 清洗之前，仅含媒体但已成功渲染的 HTML 仍可清洗为原文入口；正文转换工具继续接受空输入。endpoint 为单篇异常补充文章 ID 并保留 `cause`，无需新的错误码层次。XML 序列化等全局异常直接保留原错误。失败生成可能留下 Astro 的未完成本地构建目录，本功能不承诺清理或回滚整个 `dist`。

## 6. 非目标与接受的取舍

- 不复刻主题、语法高亮颜色、KaTeX 数学排版、复制按钮或图表交互；公式源码表达是明确采用的产品取舍。
- 不新增摘要/全文切换配置、文章 RSS 专属 frontmatter、分页源、最近 N 篇限制、统计或跟踪功能。
- 不修改现有文章、全站路由、草稿语义或 Markdown 插件；不实现外部 redirect 内容抓取和源文件链接重写。
- 当前验收覆盖仓库实际 Markdown 内容；不为尚未使用的 React/Vue/客户端 MDX 组件建立兼容层。将来新增不受支持内容时必须暴露渲染错误，不能静默降回摘要。是否扩大支持范围需更新 SPEC。
- GUID 稳定以文章 ID、域名和 base 不变为前提；本项目不提供文章改名或换域名后的永久 ID 系统。
- 接受 Container 的实验 API 风险，通过锁文件和产物测试约束升级；不直接调用 Astro 私有图片替换函数。

## 7. 设计：模块职责与接口

```text
GET /rss.xml
  → getPublishedBlogPosts + getSortedPosts
  → 路径工具生成 articleUrl
  → 逐篇 render(post) → Container.renderToString(Content)
  → toRssHtml(html, articleUrl)
  → createRssXml(站点信息, 已准备条目)
  → @astrojs/rss 序列化 → Response
```

各模块通过以下接口协作。

| 规则 / 状态 / 资源 | 唯一属主 | Interface / seam | 调用方与证据 |
| --- | --- | --- | --- |
| R1：文章筛选与排序 | `src/utils/data.ts` | `getPublishedBlogPosts()`、`getSortedPosts()` | endpoint 直接复用，不再写过滤/排序 |
| R2、R4：base、逐段编码 | `src/utils/path.ts`、`src/utils/rss-feed.js` 各管自己的路径操作 | `withBasePath()`、`encodePathSegments()` | endpoint 沿用原表达式生成一次 articleUrl |
| Markdown 插件和源图片解析 | Astro 配置及内容 API | `render(post)` 的 `Content` | endpoint 用公共 Container 转字符串，不接管图片内部实现 |
| R3–R5：RSS 正文表达、清洗与 URL 策略 | `src/utils/rss-content.js` | `toRssHtml(html, articleUrl): string`，同步纯转换；错误抛出 | endpoint 唯一生产 caller；小型 HTML fixture 测试 |
| R2、R6：字段映射、GUID、self、语言 | `src/utils/rss-feed.js` | `createRssXml({ site, homeUrl, feedUrl, items }): Promise<string>` | endpoint 提供已准备数据；真实 XML 序列化测试 |
| XML 格式及 content 编码 | 官方 `@astrojs/rss` | `getRssString()` | `createRssXml()` 只装配官方参数和必要 customData |
| R7、R8：处理顺序、空渲染拒绝、错误上下文、调用内 Container 生命周期 | `src/pages/rss.xml.js` | `GET()` | Astro 静态生成/开发请求；生产构建及失败验证 |

条目输入仅包含现有 `title`、`pubDate`、可选 `description`，以及已确定的 `link`、`guid`、`content`。`guid` 是本站 wrapper 的输入字段，由 wrapper 转为官方支持的 `customData`，不是向官方包传一个它不识别的参数。endpoint 不拼接 XML；正文转换不读取集合、SITE、磁盘或网络。

### 7.1 渲染与序列化机制

1. `@astrojs/rss` 序列化 feed；`hast-util-from-html` 解析正文 fragment，局部遍历转换，`hast-util-sanitize` 清洗，`hast-util-to-html` 输出。依赖声明见 `package.json`，实际依赖图由 `pnpm-lock.yaml` 固定。
2. sanitizer 只允许第 4 节所需的基础内容元素、属性和协议。代码、公式和地址的转换在同一个正文工具中完成；它不读取集合、站点配置、磁盘或网络。
3. `rss-feed.js` 负责字段装配、路径编码与 customData 的 XML 转义，调用官方 `getRssString()`。关闭官方自动追加尾斜杠，使用调用方准备的 URL，保留外部 redirect 的地址。
4. endpoint 负责集合、URL、Container 生命周期和顺序编排。只渲染 `Content`，不调用 `RenderPost.astro`、不读取生成后的文章页，也不使用 postbuild 覆写 feed。

## 8. 验收与测试映射

不通过测试数量证明完整；每条义务在最直接的接口验证。测试使用 `node:test` 和小 fixture，不引入测试框架。XML 验证使用已声明的 `fast-xml-parser`，不从包的内部路径导入。

| 验收项 | 义务与属主 | 最直接的证据 |
| --- | --- | --- |
| A1：全文存在且无截断 | R3；正文工具 + 构建入口 | 小 fixture 断言首尾文字；真实构建每条正文文字与清洗结果一致，图片数量、顺序、地址与 alt 全部保留 |
| A2：代码、公式、表格、提示完整 | R3；正文工具 | 一份精简 Expressive Code fixture 验证源码行、缩进、空行和实体，折叠摘要不进入源码；真实非终端代码与复制载荷精确相等；公式行内/块级只出现一次，缺 annotation 失败；表格/提示/折叠文字保留 |
| A3：站外资源与链接可用 | R4；正文工具 | 中文、嵌套路径、base、`../`、`#`、协议相对地址、mailto；img 无 srcset/懒加载；产物内同站图片可映射到真实 dist 文件，无 Astro 图片占位符 |
| A4：去掉执行及样式依赖 | R5；正文工具 | 事件属性、脚本、style、危险协议被移除；正常图片/链接和原文入口仍在 |
| A5：身份兼容和 XML 完整性 | R2、R6；feed wrapper | 调用真实官方包，解析 XML：redirect link 与原 GUID 独立；日期、摘要、语言、self、base 正确；`&`、`<`、`]]>` 不破坏 XML、不重复转义；空集合合法 |
| A6：集合接线正确 | R1；endpoint + 既有工具 | 入口回归测试模拟开发页面可见草稿，断言 RSS 不渲染草稿且保留已发布条目；从实际构建文章页 canonical 集合核对 feed 条目集合，核对日期顺序；临时草稿 fixture 在生产 feed 不存在，不硬编码文章数量 |
| A7：失败没有隐藏 | R7；正文工具 + endpoint | 工具对缺公式源码/非法图片抛错；临时引入一个坏文章的构建验证非零退出并包含文章上下文，恢复后成功；不得把失败 dist 当成功产物 |
| A8：构建资源接线和成本 | R8；endpoint | 检查实现为调用内单 Container、顺序处理、无抓取/缓存；不用时间阈值测试猜测并发 |

真实样本优先用 `多模态agent` 验证图片宽度和 alt、`fastapi` 验证代码/表格/Mermaid、现有算法文章验证公式、JUC 文章验证提示框。只检查 HTML 格式的单测不能替代真实 Astro 渲染检查。

临时草稿与坏文章只用于受控构建验证，不提交到正式内容库；恢复文件后再执行最终成功构建。不要为触发失败增加生产环境专用测试开关。

消融要求：临时去掉 `content`、去掉地址绝对化、把代码行改成整体文本、让 GUID 回退 link 时，对应测试应失败。保留能表达这些义务的测试，不为每个修补位置新增一套重复 fixture。

## 9. 验证门禁

项目检查沿用 `.github/workflows/ci.yml`：`pnpm install --frozen-lockfile`、`pnpm format`、`pnpm lint`、`pnpm test`、`pnpm check`、`pnpm build`、`pnpm test:built-pagination`、`pnpm test:built-restructure`、`pnpm test:built-markdown`。Astro、Expressive Code、RSS 或清洗依赖升级时，必须重新验证真实构建与正文转换，不能仅运行工具单测。

阅读器抽查至少看一篇带图片/代码的文章和一篇带公式的文章。若没有可用的阅读器访问条件，必须写明“未进行真实阅读器验证”，不能用浏览器显示 XML 代替兼容性结论，也不能声称所有阅读器兼容。

## 10. 页面与订阅的边界

只有已发布博客集合进入 RSS，开发和生产均不含草稿；开发网页列表／正文仍可预览草稿。网站分类使用 `category` 原值而非固定浏览映射；RSS 条目读取文章本身的标题、摘要、日期、redirect 和 GUID。`search: false` 只影响搜索，非草稿文章仍进入源。

RSS 中的图片是正文资源，不是封面卡片。endpoint 不调用 `RenderPost` 或抓取网页，封面布局、作者头像行、目录、主题 CSS 和脚本不属于 RSS 正文。阅读器使用自己的字体与排版。

生产产物检查验证 XML、正文首尾、代码／公式表达、资源存在与集合范围；实际阅读器抽查验证显示效果。条目数量、资源数量和构建耗时随内容变化，不作为功能常量或兼容性保证。

一手参考：[Astro 全文 RSS](https://docs.astro.build/en/recipes/rss/#including-full-post-content)、[Container API（实验）](https://docs.astro.build/en/reference/container-reference/)、[官方 RSS 源码](https://github.com/withastro/astro/blob/main/packages/astro-rss/src/index.ts)、[HAST sanitizer](https://github.com/syntax-tree/hast-util-sanitize)。正文与代码／公式结构的依赖升级兼容由产物回归检查验证。
