// 标题字体子集化：让访客只下载页面标题／导航等思源宋体真正用到的字形，
// 而不是完整的 CJK 字体（约 6.2 MiB）。
//
// 作为 Astro 集成挂在 `astro:build:done` 上，而不是放在 npm 的 postbuild 里：
// `public/shell.css` 的第一顺位 `src` 就指向这些子集文件，所以任何构建都必须
// 产出它们。postbuild 可以被跳过（例如直接跑 `astro build`），那会让 CSS 引用
// 一个不存在的文件、浏览器静默回退到全量字体——正是这一项要消除的成本。
//
// 构建后还会断言：产物 CSS 里引用到的每个 `*-title.woff2` 都真的存在，缺了就让
// 构建失败，而不是留给访客去发现。

import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

import subsetFont from 'subset-font'

import type { AstroIntegration } from 'astro'

/** 用思源宋体渲染的字体文件，映射到子集文件名。 */
const TARGETS = [
  ['SourceHanSerifCN-Regular.woff2', 'SourceHanSerifCN-title.woff2'],
] as const

/**
 * 元素自身带这些 class、且可见文字走 `--font-heading`／思源族名。
 * 新增思源用途时同步这里，否则缺字会落到系统衬线回退。
 */
const SELF_CLASS_TAGS: readonly (readonly [tag: string, className: string])[] =
  [
    ['p', 'post-hero__title'],
    ['a', 'archive-post__title'],
    ['span', 'post-nav__title'],
    ['a', 'nav-bar__brand'],
    ['a', 'nav-dropdown__category-link'],
    ['a', 'nav-dropdown__all'],
    ['a', 'recent-writing__link'],
    ['time', 'recent-writing__date'],
    ['span', 'recent-writing__number'],
    ['p', 'blog-profile__motto'],
    ['div', 'post-meta'],
    ['p', 'writing-heatmap__single-year'],
    ['details', 'writing-heatmap__years'],
    ['p', 'screen-time__value'],
    ['dd', 'media-hub__stat-value'],
    ['button', 'interest-tabs__tab'],
    ['h2', 'media-hub__group-title'],
  ]

/**
 * 父级 class 内的子标签文字走思源（子标签自身未必有 class）。
 * 不要用裸 `h2`：正文 Markdown 标题是 Inter，收进去会无谓撑大子集。
 */
const NESTED_CLASS_TAGS: readonly (readonly [
  parentClass: string,
  childTag: string,
])[] = [
  ['post-preview', 'h2'],
  ['archive-year__head', 'h2'],
  ['home-section-header', 'h2'],
  ['friends-group__heading', 'h2'],
  ['friends-empty', 'h2'],
  ['blog-profile__heading', 'h2'],
  ['comments', 'h2'],
  ['playlists-panel__card', 'h2'],
  ['screen-time__detail', 'h3'],
  ['interests-page__index', 'span'],
  ['archive-post', 'time'],
  ['writing-heatmap__tip', 'p'],
  ['nav-dropdown__interests', 'strong'],
  ['nav-dropdown__interests', 'small'],
  ['nav-dropdown__preview', 'a'],
  ['nav-dropdown__preview', 'h2'],
  ['nav-dropdown__preview', 'time'],
]

// 可打印 ASCII 一律保留：标题里混着拉丁词、数字和标点，代价很小。
const BASE_CHARS = Array.from({ length: 95 }, (_, i) =>
  String.fromCharCode(32 + i)
).join('')

/**
 * 构建期 HTML 收不到、但运行时仍以 `--font-heading` 呈现的固定壳层用字。
 * 只放常量文案（屏幕时间数值、热力提示日期／空态），不收动态应用名。
 */
const EXTRA_TITLE_CHARS = [
  '暂无记录',
  '分钟',
  '不到',
  '小时',
  '没有文章',
  '年月日星期一二三四五六日',
  '影音书游',
].join('')

const ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&apos;': "'",
  '&nbsp;': ' ',
}

const decodeEntities = (text: string) =>
  text
    .replace(/&#(\d+);/g, (_, code: string) =>
      String.fromCodePoint(Number(code))
    )
    .replace(/&[a-z#0-9]+;/gi, (entity) => ENTITIES[entity] ?? entity)

const stripTags = (text: string) => decodeEntities(text.replace(/<[^>]*>/g, ''))

const addChars = (chars: Set<string>, text: string) => {
  for (const char of text) chars.add(char)
}

async function* walkHtml(dir: string, skip: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) {
      // Pagefind 的产物由同样的页面生成，里面没有标题。
      if (path === skip) continue
      yield* walkHtml(path, skip)
    } else if (entry.name.endsWith('.html')) {
      yield path
    }
  }
}

/** `<tag ... class="... token ...">...</tag>` */
function collectBySelfClass(
  html: string,
  tag: string,
  className: string,
  chars: Set<string>
) {
  const re = new RegExp(
    `<${tag}\\b[^>]*\\bclass=["'][^"']*\\b${className}\\b[^"']*["'][^>]*>([\\s\\S]*?)</${tag}>`,
    'gi'
  )
  for (const [, inner] of html.matchAll(re)) {
    addChars(chars, stripTags(inner))
  }
}

/** 带 `parentClass` 的元素内，收集每个 `childTag` 的可见文字。 */
function collectNested(
  html: string,
  parentClass: string,
  childTag: string,
  chars: Set<string>
) {
  const parentRe = new RegExp(
    `<([a-zA-Z0-9-]+)\\b[^>]*\\bclass=["'][^"']*\\b${parentClass}\\b[^"']*["'][^>]*>([\\s\\S]*?)</\\1>`,
    'gi'
  )
  const childRe = new RegExp(
    `<${childTag}\\b[^>]*>([\\s\\S]*?)</${childTag}>`,
    'gi'
  )
  for (const match of html.matchAll(parentRe)) {
    const parentInner = match[2]
    for (const [, inner] of parentInner.matchAll(childRe)) {
      addChars(chars, stripTags(inner))
    }
  }
}

async function collectTitleChars(distDir: string) {
  const chars = new Set(BASE_CHARS)
  addChars(chars, EXTRA_TITLE_CHARS)

  for await (const file of walkHtml(distDir, join(distDir, 'pagefind'))) {
    const html = await readFile(file, 'utf8')

    for (const [, inner] of html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)) {
      addChars(chars, stripTags(inner))
    }

    for (const [, inner] of html.matchAll(
      /<a\b[^>]*\bdata-nav-link\b[^>]*>([\s\S]*?)<\/a>/gi
    )) {
      addChars(chars, stripTags(inner))
    }

    for (const [, inner] of html.matchAll(
      /<button\b[^>]*\bdata-palette\b[^>]*>([\s\S]*?)<\/button>/gi
    )) {
      addChars(chars, stripTags(inner))
    }

    for (const [tag, className] of SELF_CLASS_TAGS) {
      collectBySelfClass(html, tag, className, chars)
    }

    for (const [parentClass, childTag] of NESTED_CLASS_TAGS) {
      collectNested(html, parentClass, childTag, chars)
    }

    for (const [, inner] of html.matchAll(
      /<footer\b[^>]*>([\s\S]*?)<\/footer>/gi
    )) {
      addChars(chars, stripTags(inner))
    }
  }

  return [...chars].join('')
}

const toKiB = (bytes: number) => `${Math.round(bytes / 1024)} KiB`

async function subsetTitleFonts(distDir: string) {
  const fontDir = join(distDir, 'fonts')
  const text = await collectTitleChars(distDir)
  console.log(
    `[fonts] Subsetting title fonts for ${text.length} unique characters.`
  )

  for (const [sourceName, subsetName] of TARGETS) {
    const sourcePath = join(fontDir, sourceName)

    try {
      await stat(sourcePath)
    } catch {
      throw new Error(
        `[fonts] 源字体缺失：${relative(process.cwd(), sourcePath)}（标题字体的子集化依赖它）`
      )
    }

    const source = await readFile(sourcePath)
    const subset = await subsetFont(source, text, { targetFormat: 'woff2' })

    if (subset.byteLength >= source.byteLength) {
      throw new Error(
        `[fonts] ${sourceName} 的子集没有变小（${toKiB(subset.byteLength)} >= ${toKiB(source.byteLength)}），子集化规则需要检查`
      )
    }

    // 标题／导航级子集应远小于全量；过大说明收字范围失控。
    const maxSubsetBytes = 1.5 * 1024 * 1024
    if (subset.byteLength > maxSubsetBytes) {
      throw new Error(
        `[fonts] ${subsetName} 过大（${toKiB(subset.byteLength)}），收字范围需要收紧`
      )
    }

    await writeFile(join(fontDir, subsetName), subset)
    console.log(
      `[fonts] Wrote ${subsetName}: ${toKiB(source.byteLength)} -> ${toKiB(subset.byteLength)}`
    )
  }

  await assertSubsetFontsExist(distDir)
}

/** CSS 第一顺位引用的子集文件必须真的存在，否则访客会静默取到全量字体。 */
async function assertSubsetFontsExist(distDir: string) {
  const css = await readFile(join(distDir, 'shell.css'), 'utf8')
  const referenced = new Set(
    [...css.matchAll(/url\(['"]?\/fonts\/([^)'"]+-title\.woff2)['"]?\)/g)].map(
      ([, name]) => name
    )
  )

  for (const [, name] of TARGETS) {
    if (!referenced.has(name)) {
      throw new Error(`[fonts] shell.css 缺少标题子集字体引用：${name}`)
    }
  }

  for (const name of referenced) {
    const file = join(distDir, 'fonts', name)
    try {
      await stat(file)
    } catch {
      throw new Error(
        `[fonts] CSS 引用了不存在的子集字体：${relative(process.cwd(), file)}`
      )
    }
  }

  console.log(`[fonts] Verified ${referenced.size} referenced subset font(s).`)
}

export function subsetTitleFontsIntegration(): AstroIntegration {
  return {
    name: 'subset-title-fonts',
    hooks: {
      'astro:build:done': async ({ dir }) => {
        await subsetTitleFonts(fileURLToPath(dir))
      },
    },
  }
}
