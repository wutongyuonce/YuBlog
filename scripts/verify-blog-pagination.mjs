import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const html = await readFile(
  new URL('../dist/index.html', import.meta.url),
  'utf8'
)

test('initial HTML offers page-one navigation, but no-JS readers see all posts without a false pager', () => {
  const pagination = html.match(
    /<nav\b[^>]*\bdata-pagination\b[^>]*>[\s\S]*?<\/nav>/
  )?.[0]
  assert.ok(pagination, 'the built home page must include pagination')
  assert.doesNotMatch(
    pagination.slice(0, pagination.indexOf('>')),
    /\bhidden(?:\s|=|$)/
  )
  assert.match(pagination, /href="[^"]*\?page=2"/)
  assert.match(pagination, /aria-current="page"/)

  const fallback = [...html.matchAll(/<noscript>[\s\S]*?<\/noscript>/g)]
    .map(([block]) => block)
    .find((block) => block.includes('当前显示全部文章'))
  assert.ok(fallback, 'the no-JS fallback must expose the full article list')
  assert.match(
    fallback,
    /\[data-blog-item\]\s*\{\s*display:\s*block\s*!important/
  )
  assert.match(
    fallback,
    /\[data-pagination\]\s*\{\s*display:\s*none\s*!important/
  )
})
