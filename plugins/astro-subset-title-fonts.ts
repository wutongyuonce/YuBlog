// 标题字体子集化：让访客只下载页面标题真正用到的字形，而不是完整的 CJK 字体
// （每个 7–8 MiB）。
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

/** 用标题字体渲染的字体文件，映射到各自子集的文件名。 */
const TARGETS = [
  ['LXGWWenKai-Regular.woff2', 'LXGWWenKai-title.woff2'],
  ['WoHuiBaNiJiaoZuoAiQing-2.woff2', 'WoHuiBaNiJiaoZuoAiQing-title.woff2'],
]

// 目前只有页面标题用这两个字体（StandardLayout 的 h1.page-title、PostHero 的
// .post-hero__title）。若将来别的元素也用上，要把它一并收集进来，否则那些字形
// 会回退到系统字体，渲染会静默变样。
const TITLE_TEXT_PATTERN = /<h1\b[^>]*>([\s\S]*?)<\/h1>/gi

// 可打印 ASCII 一律保留：标题里混着拉丁词、数字和标点，代价很小。
const BASE_CHARS = Array.from({ length: 95 }, (_, i) =>
  String.fromCharCode(32 + i)
).join('')

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

async function collectTitleChars(distDir: string) {
  const chars = new Set(BASE_CHARS)

  for await (const file of walkHtml(distDir, join(distDir, 'pagefind'))) {
    const html = await readFile(file, 'utf8')
    for (const [, inner] of html.matchAll(TITLE_TEXT_PATTERN)) {
      for (const char of stripTags(inner)) chars.add(char)
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
