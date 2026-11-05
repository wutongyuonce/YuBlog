import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))

const read = (rel) => readFile(join(root, rel), 'utf8')

test('shell.css prefers Source Han title subset and drops handwriting faces', async () => {
  const css = await read('public/shell.css')
  const face = css.match(
    /@font-face\s*\{[^}]*font-family:\s*'SourceHanSerifCN-Regular'[^}]*\}/s
  )
  assert.ok(face, 'Source Han @font-face must exist')
  const src = face[0]
  const titleAt = src.indexOf("url('/fonts/SourceHanSerifCN-title.woff2')")
  const fullAt = src.indexOf("url('/fonts/SourceHanSerifCN-Regular.woff2')")
  assert.ok(titleAt >= 0, 'title subset src required')
  assert.ok(fullAt >= 0, 'full face fallback src required')
  assert.ok(titleAt < fullAt, 'title subset must be listed before full face')
  assert.doesNotMatch(css, /WoHuiBaNiJiaoZuoAiQing/)
  assert.doesNotMatch(css, /LXGWWenKai/)
})

test('--font-heading keeps Source Han with explicit CJK serif fallbacks', async () => {
  const css = await read('src/styles/main.css')
  const match = css.match(/--font-heading:\s*([^;]+);/)
  assert.ok(match, '--font-heading must be declared')
  const stack = match[1]
  assert.match(stack, /SourceHanSerifCN-Regular/)
  for (const name of [
    'Source Han Serif SC',
    'Noto Serif CJK SC',
    'Songti SC',
    'SimSun',
  ]) {
    assert.match(stack, new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
  }
})

test('Head preloads only the Source Han title subset', async () => {
  const head = await read('src/components/base/Head.astro')
  assert.match(
    head,
    /rel="preload"[\s\S]*SourceHanSerifCN-title\.woff2[\s\S]*as="font"[\s\S]*type="font\/woff2"[\s\S]*crossorigin/
  )
  assert.doesNotMatch(head, /SourceHanSerifCN-Regular\.woff2/)
  assert.doesNotMatch(head, /LXGWWenKai-title|WoHuiBa.*-title/)
})

test('vercel caches /fonts with weekly max-age and SWR, not immutable', async () => {
  const vercel = JSON.parse(await read('vercel.json'))
  const rule = (vercel.headers || []).find((h) => h.source === '/fonts/:path*')
  assert.ok(rule, '/fonts/:path* header rule required')
  const cache = rule.headers.find((h) => h.key === 'Cache-Control')
  assert.equal(
    cache?.value,
    'public, max-age=604800, stale-while-revalidate=86400'
  )
  assert.doesNotMatch(cache.value, /immutable/)
})

test('subset plugin targets Source Han title only', async () => {
  const plugin = await read('plugins/astro-subset-title-fonts.ts')
  assert.match(
    plugin,
    /\['SourceHanSerifCN-Regular\.woff2',\s*'SourceHanSerifCN-title\.woff2'\]/
  )
  assert.doesNotMatch(plugin, /LXGWWenKai-Regular\.woff2/)
  assert.doesNotMatch(plugin, /WoHuiBaNiJiaoZuoAiQing/)
})

test('subset plugin collects nav dropdown heading-font captions', async () => {
  const plugin = await read('plugins/astro-subset-title-fonts.ts')
  for (const needle of [
    "['a', 'nav-dropdown__category-link']",
    "['a', 'nav-dropdown__all']",
    "['nav-dropdown__interests', 'strong']",
    "['nav-dropdown__interests', 'small']",
    "['nav-dropdown__preview', 'a']",
    "['nav-dropdown__preview', 'h2']",
    "['nav-dropdown__preview', 'time']",
  ]) {
    assert.ok(plugin.includes(needle), `missing collector: ${needle}`)
  }
})

test('subset plugin collects accent palette and runtime heading chrome', async () => {
  const plugin = await read('plugins/astro-subset-title-fonts.ts')
  assert.ok(
    plugin.includes('data-palette'),
    'missing data-palette button collector'
  )
  for (const needle of [
    'EXTRA_TITLE_CHARS',
    '暂无记录',
    '没有文章',
    '年月日星期一二三四五六日',
  ]) {
    assert.ok(plugin.includes(needle), `missing: ${needle}`)
  }
})
