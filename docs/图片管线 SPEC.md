# 图片管线迁移 SPEC

把内容图片从 `public/` 搬进内容目录树，交给 Astro 图片管线统一生成 WebP 与响应式变体。

本文是**规划文档**：先定契约和边界，再动代码。实施完成后，本文描述的内容即为当前实现；被放弃的方案移出本文。

---

## 1. 为什么要做

字体子集化之后，文章页最大的资源已经变成封面图。实测数据（生产构建）：

| 指标 | 现值 |
| :--- | :--- |
| `public/` 下图片总数 / 体积 | 402 个 / 101.1 MiB |
| 单张 > 300 KiB 的数量 / 合计 | 71 个 / 65.8 MiB |
| `dist/` 体积 | 198 MiB |
| 文章页最大资源 | 封面 `doll-leaves.jpg` 2618 KiB（3840×2160） |
| 首页图片下载量 | 10 张 / 6.1 MiB，其中两张封面 4.9 MiB |

两张封面是 3840×2160 的 4K 原图，而它们在首页列表只显示 640×360，文章页封面最大约 706×448。

**目标**：访客只下载按显示尺寸生成的 WebP；窄屏拿到更小的变体；以后新增图片自动获得同样待遇，不需要人工处理。

**根因**：`titleImage` 被 schema 限制为 `/blog-title-images/` 开头的字符串，正文图写作 `/blogs/<名>-img/文件`，全部位于 `public/`，因此不经过任何处理，原图直出。`ListItem.astro` 里那段 `<Image>` 组件分支因为 schema 不允许非字符串，实际上是死代码。

---

## 2. 现状事实（本机 Astro 5.18.2 实测，非推测）

### 2.1 三条路径规则（用隔离探针项目实测）

| 位置 | 写法 | 结果 |
| :--- | :--- | :--- |
| frontmatter `image()` | `./x.png` 同目录 | ✅ 解析，转 WebP |
| frontmatter `image()` | `../_shared/x.png` 上一级 | ✅ 解析 |
| frontmatter `image()` | `../../assets/x.png` 集合 base 之外 | ✅ 解析 |
| 正文 Markdown | `![](./x.png)` | ✅ 优化，自动 width/height + lazy |
| 正文 Markdown | `![](./sub/x.png)` 子目录 | ✅ 优化 |
| 正文 Markdown | `![](./_shared/x.png)` 同级下划线目录 | ✅ 优化 |
| 正文 Markdown | `![](../_shared/x.png)` 向上一级 | ❌ `ImageNotFound`，构建失败 |
| 正文原始 HTML | `<img src="./x.png">` | ❌ 原样输出，不处理（浏览器里 404） |

**两条硬结论**：

1. **正文图片必须位于文章文件所在目录或其子目录内**，不能向上越级。
2. **原始 `<img>` 标签完全不进管线**，现在能用只是因为它们写的是 `public/` 绝对路径。

### 2.2 `image()` 的引入方式

Astro 5 不再从 `astro:content` 导入 `image`。必须写成 schema 工厂函数：

```ts
defineCollection({
  loader: glob({ base: './src/content/blogs', pattern: '**/*.{md,mdx}' }),
  schema: ({ image }) => z.object({ cover: image() }),
})
```

实测 `import { image } from 'astro:content'` 与 `from 'astro:schema'` 都报 `image is not a function`。

### 2.3 管线默认行为（读源码确认）

- `DEFAULT_OUTPUT_FORMAT = 'webp'`（`astro/dist/assets/consts.js:23`）→ 默认转 WebP。
- `loading ??= 'lazy'` / `'eager'`（`astro/dist/assets/internal.js`）→ 默认懒加载，priority 图片 eager。
- 项目已在 `astro.config.ts` 开启 `layout: 'constrained'` + `responsiveStyles: true` → 自动输出 `srcset`/`sizes`。
- `getImage` 从 `astro:assets` 导出；`<Image>` 支持 `priority` 属性。
- 动图（GIF）进管线后输出**动画 WebP 且保留帧**，HTML 宽高按单帧计算（实测见 D5）。

### 2.4 现有图片写法统计

| 项 | 数量 |
| :--- | :--- |
| 正文 Markdown `![]()` 引用 | 117 |
| 正文原始 `<img>` 标签 | 275（其中 199 张指向 `algo-img`） |
| 原始 `<img>` 带 `style="zoom:X%"` | 272 / 275 |
| 封面引用 / 文件 | 10 / 12（`night-lantern.webp`、`yae-miko.webp` 暂无文章引用，按作者决定保留为备用素材） |
| 关于页图片 | 2 处，同样是原始 `<img>` |
| 正文图片目录 | 19 个：17 个只被 1 篇文章引用，2 个共享（`algo-img` → 5 篇 / 58 MiB；`juc-img` → 2 篇） |
| 文章目录分组 | `算法笔记/`、`JUC并发编程/` 两个子目录 |

### 2.5 图片宽度是怎么控制的

`@unocss/reset` 给出 `img { max-width: 100%; height: auto }`；`src/styles/prose.css` 的 `.prose img` 只设圆角和外边距。图片“变小”靠的是每张图手写的 `style="zoom:X%"`。

zoom 取值分布：50% × 79、40% × 46、33% × 38、35% × 28、30% × 20、45% × 14、25% × 10、80% × 7、20% × 7，其余为个位数（10%–70% 之间零散取值）。

**这意味着：迁移到管线后没有任何机制能表达“这张图要小一点”**，如果直接把这些标签改成 Markdown 图片，图片会一律撑到正文宽度（约 706px），多篇文章的观感会变化。处理方式见第 5 节 D1。

---

### 2.6 P1 实测：schema 改动与旧路径不兼容

把 `titleImage` 换成 `image()` 后，旧的绝对路径（`/blog-title-images/x.webp`）会解析失败，构建直接报 `ImageNotFound`。所以**封面不能在单篇文章上灰度**：schema 一改，全部封面必须同批迁移。正文图不受影响（它们仍在 `public/`，绝对路径继续可用）。

### 2.7 P1 实测：正文图片的属性会被直接转发给 `getImage`

Markdown 正文图片不是用 `<Image>` 组件渲染的：Astro 会把图片节点的属性收集成 JSON，再执行
`getImage({ src: 导入的资源, ...属性 })`（`astro/dist/vite-plugin-markdown/images.js`）。

所以宽度标记要把标记转成其中的 `width` 属性，而不是只用 CSS 限制显示宽度：只有 `width` 会同时决定 `srcset` 和 `sizes`。实测对比：

| 做法 | 产物 |
| :--- | :--- |
| 标记 → `style="max-width: min(480px, 100%)"` | `width=1200`、`sizes="(min-width: 1200px) 1200px, 100vw"`，浏览器仍按 1200px 选图 |
| 标记 → `width=480` | `width=480`、`sizes="(min-width: 480px) 480px, 100vw"`、`srcset` 自 480w 起 |

因此插件只支持像素写法，不接受百分比：`|w353` 表示 353px。百分比需要知道正文列宽，而列宽的权威在 `main.css`，在插件里再写一份会多出一个真相源。

### 2.8 实现陷阱：内容缓存在 `node_modules/.astro/`

改 remark / rehype 插件后重新构建，Astro 不会失效内容缓存；被缓存的是已渲染 HTML，所以会看到旧输出。实测：删掉 `.astro/data-store.json` 无效，必须删 `node_modules/.astro/`（缓存实际在那里）。排查“插件改了但产物没变”时先清这个目录。

### 2.9 P1 实测：占位符泄露是一个静默失败模式

如果正文图片的路径不能解析（例如标记写进了 URL：`![](./x.webp|w480)`），构建不会报错，产物里会直接输出 `<img __ASTRO_IMAGE_="...">`，浏览器中不可见。验证时必须检查 HTML 里不残留 `__ASTRO_IMAGE_`。

### 2.10 P3/P4 实测：迁移结果

| 项 | 结果 |
| :--- | :--- |
| 迁移范围 | 117 处 Markdown 引用 + 265 处原始 `<img>`，18 个目录，23 篇文章 |
| 图片总数 | 迁移前后逐篇一致（391 处），无遗漏 |
| 引用完整性 | 全站 418 个本地资源逐个请求，真实 404 为 0（两个例外见下） |
| 占位符 | 全站 HTML `__ASTRO_IMAGE_` 零残留 |
| `public/` 图片 | 从 402 个 / 101.1 MiB 降到 9 个 / 0.7 MiB（favicon、avatar、PWA 图标、默认 OG 图） |
| `dist` | 222 MiB → 153 MiB |
| 文章图片下载量（按各图 `src` 产物求和） | 算法 3：16.54 MB → 0.64 MB；算法 2：18.49 MB → 0.80 MB；算法 1：11.93 MB → 1.14 MB；代码库搜索：2.01 MB → 0.14 MB；Transformer：5.12 MB → 0.20 MB |

两个例外（已核实，非缺陷）：

1. **远程图片保持原始 `<img>`**：4 张外链图（leetcode.cn、assets.leetcode.com、hello-algo.com）不受管线管辖，转换需要把它们加进 `image.domains` 并在构建时联网抓取，构建会因此依赖第三方可用性。保持现状。
2. **代码块内的 `<img>` 不迁移**：`Astro.md` 里 1 处是文档示例。

全站图片请求里还有两个「404」是误报：`/app.js` 与 `/_astro/button.xyz789.js` 均出现在文章的行内代码或代码块里，浏览器不会请求。

---

## 3. 目标约定（新契约）

### 3.1 目录布局

```text
src/content/blogs/
  代码库搜索.md
  代码库搜索-img/                    ← 这篇文章的正文图
  pi-extensions.md
  _title-images/                     ← 全部文章封面，跨文章共享
  算法笔记/
    算法 1（数组、链表）.md
    algo-img/                        ← 组内共享正文图（必须在文章目录内）
   JUC并发编程/
    JUC 并发编程 1—多线程基础.md
    juc-img/

src/content/about/
  about.md  use.md  hobby.md  soul.md
  use/                               ← 关于页各栏配图，与 md 同级
  hobby/
```

图片**不再放进 `public/`**。`public/` 只保留站点级固定资源：`favicon.*`、`icon-*.png`、`avatar.webp`、`og/default.png`、`fonts/`。

### 3.2 引用写法

| 场景 | 写法 |
| :--- | :--- |
| 顶层文章正文图 | `![说明](./代码库搜索-img/file.png)` |
| 组内文章正文图 | `![说明](./algo-img/file.png)` |
| 组内共享图 | `![说明](./_shared/file.png)`（放在该组目录内） |
| 需要限制宽度 | `![说明|w353](./图.png)`（像素，正文列宽约 706px） |
| 顶层文章封面 | `titleImage: ./_title-images/browser-agent.webp` |
| 组内文章封面 | `titleImage: ../_title-images/xxx.webp` |
| 关于页配图 | `![说明](./use/file.png)` |

**不再使用原始 `<img>` 标签**（它不会被处理）。需要控制尺寸时用 `|w` 标记（未标记即满宽）。

### 3.3 不变量

1. 正文图片路径必须以 `./` 开头，且解析结果位于该文章所在目录之内；不得向上越级。
2. 封面路径允许 `./` 或 `../`，实际文件统一放在 `src/content/blogs/_title-images/`。
3. 内容图片不得出现在 `public/` 下；`public/` 只放站点级固定资源。
4. 文章 URL 不因本次迁移改变（`src/content/blogs/**/*.md` 的路径保持原样）。
5. 管线产物地址带内容哈希，**不可手写**。以后引用图片只有两条路：走管线，或明确放进 `public/`。

---

## 4. 需要改动的模块

### 4.1 代码

| 文件 | 现状 | 目标 | 性质 |
| :--- | :--- | :--- | :--- |
| `src/content/schema.ts` | `postSchema` 是 `z.object`；`titleImage` 为字符串并校验 `/blog-title-images/` 前缀；superRefine 里判断 `data.titleImage && !data.titleImageAlt` | 改为 schema 工厂 `({ image }) => z.object({...})`；`titleImage: image().optional()`；移除前缀校验（存在性由 `image()` 保证）；superRefine 改为判断 `titleImage` 是否为真值 | 契约变更 |
| `src/content.config.ts` | `schema: postSchema` | `schema: postSchema`（工厂函数形式，仍是一处引用） | 小改 |
| `src/components/base/PostHero.astro` | `titleImage: string` + `withBasePath(titleImage)` 的原生 `<img>`，`fetchpriority="high"` | 接收 `ImageMetadata`，改用 `<Image>`（整幅封面建议 `layout="full-width"`）、`priority`、`sizes` 覆盖 | 重写渲染 |
| `src/components/views/ListItem.astro` | 有 string / Image 两个分支，string 分支实际在用 | 只保留 `<Image>` 分支，宽度档位按卡片图片列实际宽度（约 262–360px）确定 | 删减分支 |
| `src/components/views/RenderPost.astro` | `socialImage={titleImage}` 传字符串 | 生成宽约 1200 的 OG 变体（`getImage()`），把**绝对 URL** 传给 Head | 新增逻辑 |
| `src/components/base/Head.astro` | `new URL(withBasePath(socialImage \|\| SITE.socialImage), Astro.site)` | 接受已解析的绝对 URL；默认值 `SITE.socialImage`（`/og/default.png`）路径不变 | 小改 |
| `src/utils/data.ts` | 透传 `titleImage` 字符串 | 确认类型注解不假设 string（`BlogListItem` 等） | 待查 |
| `src/styles/markdown.css` / `prose.css` | `.prose img` 无宽度规则 | **不改**：尺寸由插件注入的 `width` 表达，不新增 CSS | 不改 |
| `plugins/remark-image-width.ts` | 不存在 | 新增：解析 alt 尾部像素标记，剥离标记并把 `width` 交给图片管线 | 已完成 |
| `test/remark-image-width.test.mjs` | 不存在 | 验证标记从 alt 剥离、转换成 `width`，同时保留原节点属性 | 已完成 |

### 4.2 文档

| 文件 | 需要改的内容 |
| :--- | :--- |
| `README.md` | 「内容」表格的图片路径三行、「个人二次开发」第 2 步的图片路径 |
| `README_ENG.md` | 同上（如含对应内容） |
| `docs/项目解析.md` | 权威表新增「图片路径 / 尺寸」一行；各页实现要点里的图片描述；seam 章节 |
| `blog-content-publisher-skill/SKILL.md` | 第 44–67 行与 105–111 行：新目录约定、新写法、示例、禁止 `<img>`；封面示例文件名 |
| `docs/Astro.md` | 如含图片写法说明则同步 |
| `docs/Canonical URL、Sitemap、RSS.md` | 「相对 `/blogs/foo/` 站内 `<a>`、图片」一句需要澄清：图片改为 hashed 绝对资源路径 |

### 4.3 明确不改

- `src/pages/rss.xml.js`：RSS 不含图片。
- `scripts/gen-og-cover.mjs`：生成的是站点默认分享图 `public/og/default.png`，与内容图无关。
- 其他现有 `test/*.mjs`：不承担图片路径迁移验证；宽度标记的单元测试单列在上表。
- `src/pages/app.webmanifest.js`、`favicon`、`avatar.webp`、`PostMeta.astro` / `BlogProfile.astro` 的头像：站点级资源，留在 `public/`。
- 友链头像：`friends/data.json` 里是远程 URL，不在本次范围。
- `astro.config.ts` 的 `image` 与 `vite` 配置：保持不变（`inlineStylesheets: 'never'`、`cssCodeSplit: false` 是壳层样式的既定约束，不要为图片优化改回去）。

---

## 5. 已定决策

### D1. 图片尺寸：alt 后缀标记 + remark 插件注入 `width`

正文图片用 alt 后缀声明像素宽度，插件把它转成图片管线的 `width`：

```md
![满宽的图](./代码库搜索-img/a.png)

![353px 宽的图|w353](./代码库搜索-img/b.png)
```

- 只支持像素写法（`|w353`）。正文列宽约 706px，所以「半宽」写 `|w353`。
- 插件把标记从 alt 里剥离，alt 保持干净（已实测）。
- 为什么用 `width` 而不是 CSS：管线按 `width` 同时生成 `srcset` 与 `sizes`，浏览器才会真的去下小图；只限制 CSS 显示宽度的话 `sizes` 仍按原图尺寸算，大屏小屏都会多下载（对比见 2.7）。

**迁移映射规则**：现有 `zoom` 不能直接当宽度用。现在的实际显示宽度是 `min(源图像素宽 × zoom, 正文列宽)`，正文列宽实测 706px。所以 codemod 按 `目标宽度 = min(源图像素宽 × zoom, 706)` 算出像素值再写标记。

**标记的取舍**：只要目标宽度小于原图宽度就写标记，包括目标恰好等于列宽的 706px。原因是省略标记会让管线的 `sizes` 回落到原图宽度（例如 2000px），浏览器会去取大图；写上 `|w706` 反而把 `sizes` 钉在 706px，下载量更准。只有目标宽度等于原图宽度（图本身就比列宽窄）时才无需标记。

早先版本的本文写的是「≥696px 不写标记」，与实现不符，已按上述规则修正。

已否决：

- 放弃尺寸控制：272 张图会全部撑满列宽，多篇文章观感变化明显。
- MDX 逐张写 `<Image width>`：最精确，但要转文件、逐张改，成本最高。
- CSS `max-width` / 档位类：`sizes` 与 `srcset` 仍按原图尺寸生成，下载量降不下来（对比见 2.7）。

### D2. 封面目录

统一放 `src/content/blogs/_title-images/`。顶层文章写 `./_title-images/x.webp`，组内文章写 `../_title-images/x.webp`（已实测可用）。

### D3. 旧图片 URL

接受 404，不加重定向。理由：迁移后的地址是内容哈希，一个旧文件对应多份变体，无法一对一映射；已核实仓库里除文档外没有任何代码、CSS 或配置引用旧图片路径，站内引用会全部改写。

需要追加一条不变量：管线产物的 URL 不可手写，以后凡是要用图片的地方都必须走管线，或者明确放进 `public/`。

### D4. 源图不做降采样

保留原始分辨率。管线只影响访客下载量，仓库体积不作为本次目标。

### D5. GIF（实测后已不需要决策）

`algo-img` 里有数张 2–4 MiB 的动图。原以为 sharp 对动图处理保守，实测推翻了这一点：

| 项 | 实测结果 |
| :--- | :--- |
| 源 | 3 帧 GIF，60×60/帧 |
| 产物 | `_astro/anim.C7xQFwz6_1mYfIM.webp`，`format=webp` |
| 动画 | **帧数=3，动画保留** |
| HTML 宽高 | `width="60" height="60"`（按单帧计算，正确） |

结论：GIF 不需要单独排除，**继续放在各自文章的图片目录里，写法与普通图片相同**（`![](./algo-img/x.gif)`），会被转成动画 WebP。要注意的是构建成本：多档宽度会为动画 GIF 生成多份动画 WebP，解码成本高于静态图。

若实测发现某张动画图转换后观感明显变差，可对单张使用 `<Image format="gif">` 或放回 `public/` 作为例外，并在本文记录。

---

## 6. 分阶段计划与验收

| 阶段 | 内容 | 验收 | 状态 |
| :--- | :--- | :--- | :--- |
| P0 | 路径规则探针 | 三条规则可复现 | ✅ 完成 |
| P1 | schema 改为工厂形式；`PostHero` / `ListItem` 接 `ImageMetadata`；新增宽度插件；`RenderPost` 生成 1200px 分享图 | `pnpm check` 通过；封面与正文图渲染正确；卡片正常 | ✅ 完成 |
| P2 | 封面迁移（10 篇） | 10 篇封面显示正确；OG `meta` 指向可访问的绝对 URL | ✅ 随 P1 完成（原因见 2.6） |
| P3 | 正文 Markdown 图片迁移（117 处），按目录映射搬图 | 每篇文章图片数量与迁移前一致；无 404 | ✅ 完成 |
| P4 | 原始 `<img>` 迁移（265 处）：codemod 按 `min(基准宽 × zoom, 706)` 写入宽度标记，改写为 Markdown | 全站 HTML 中不再出现指向本地路径的原始 `<img>`；逐篇图片数与迁移前一致 | ✅ 完成 |
| P5 | 关于页图片（2 处） | 关于页三个标签内图片正常 | ✅ 完成 |
| P6 | 文档同步（第 4.2 节全部文件） | 文档描述的路径与代码、内容一致 | ✅ 完成 |
| P7 | 清理 | `public/blogs`、`public/blog-title-images`、`public/about` 移除；保留 2 张备用封面；核对 `dist` 体积与首页/文章页下载量 | ✅ 完成（备用素材按作者决定保留） |

每阶段结束跑：`pnpm check`、`pnpm lint`、`pnpm format`、`pnpm test`。

---

## 7. 验证清单

1. **构建**：`pnpm build` 通过，无 `ImageNotFound`。
2. **引用完整性**：迁移前后逐篇文章统计图片引用数（Markdown 图片 + 原始 img），数量必须一致且原始 `<img>` 归零。
3. **全站爬取**：遍历所有页面，确认没有 `<img src>` 指向已删除的 `/blogs/`、`/blog-title-images/`、`/about/` 路径，所有图片请求 200，且 HTML 里 `__ASTRO_IMAGE_` 零残留（静默失败模式见 2.9）。
4. **传输量**：对比首页与几篇典型文章的资源总量，确认封面由 2618 KiB 降到百 KiB 级。
5. **响应式**：确认文章页图片输出 `srcset`/`sizes`，窄屏取得更小变体。
6. **OG/社交图**：文章页 `og:image`、`twitter:image` 是绝对 URL 且可访问。
7. **视觉抽查**：桌面 + 390px 手机，抽查首页、迁移过 zoom 的文章、关于页、404。
8. **回归**：`pnpm test` 全绿；分页、右栏锁定、TOC、搜索索引（Pagefind）不受影响。

---

## 8. 非目标

- 不改变文章 URL 或 slug 生成方式。
- 不引入图床、CDN 或远程图片托管。
- 不动站点级资源（favicon、avatar、PWA 图标、默认 OG 图）。
- 不为图片优化改动 `astro.config.ts` 的 `cssCodeSplit` / `inlineStylesheets`（壳层样式约束优先）。
- 不处理远程图片（友链头像）与动图压缩。

---

## 9. 风险

| 风险 | 说明 | 缓解 |
| :--- | :--- | :--- |
| zoom 语义丢失 | 272 张图尺寸靠 `zoom`，迁移后若处理不当会整体变大 | codemod 按 `min(源宽 × zoom, 706)` 逐张计算宽度；P4 验收比对显示宽度；截图抽查 |
| 漏改导致静默 404 | 原始 `<img>` 若漏改，浏览器直接 404，构建不报错 | 第 7 节第 3 项全站爬取作为强制关卡 |
| 路径越级 | 正文图用 `../` 会构建失败 | 约定写入 SKILL 文档，禁止 `../` 正文图 |
| 构建变慢、`dist` 变体增多 | 管线要为每张图生成多档变体 | 可接受；P7 核对实际体积 |
| 契约文档滞后 | README / 项目解析 / SKILL 三处都描述旧路径 | P6 与代码同批提交 |

---

## 10. 实现细节备忘

1. ~~`titleImage: image().optional()` 是否可用~~ **已实测确认**：正常，缺省条目解析为 `undefined`，`hasHeroImage={!!titleImage}` 判定成立。
2. ~~插件注入的自定义属性能否穿过管线~~ **已实测确认**：`style`、`class`、`data-*` 均保留，同张图仍被优化。
3. ~~`PostHero` 的宽度传递~~ **已定**：不传 `layout`，改用 `width={ARTICLE_COLUMN_WIDTH}`（`src/utils/misc.ts` 的常量，镜像 `main.css` 的 `--blog-article-width: 70ch`，实测 706px）。`layout="full-width"` 会让 `sizes` 变成 `100vw`，宽屏上过度下载。
4. OG 变体：由 `RenderPost.astro` 用 `getImage()` 直接生成 1200px JPEG，不复用封面的响应式变体。
5. ~~`ListItem` 的卡片图片档位~~ **已定**：传 `widths={[274, 548, 822]}`（列宽约 274px 的 1×/2×/3×）与显式 `sizes`，不再用固定的 `width={640}`。
6. `src/utils/data.ts` 透传 `titleImage`，不假设它是字符串（类型由 schema 推导）。
