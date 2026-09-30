import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import { BLOG_PAGE_SIZE } from '../src/utils/blog-browser.js'

const html = await readFile(
  new URL('../dist/blogs/index.html', import.meta.url),
  'utf8'
)

test('initial HTML offers page-one navigation and an effective no-JS fallback', () => {
  const postCount = [...html.matchAll(/<div\b[^>]*\bdata-blog-item(?:\s|=|>)/g)]
    .length
  assert.ok(
    postCount > BLOG_PAGE_SIZE,
    'fallback must expose more than the first page'
  )

  const pagination = html.match(
    /<nav\b[^>]*\bdata-pagination\b[^>]*>[\s\S]*?<\/nav>/
  )?.[0]
  assert.ok(pagination, 'the built blogs page must include pagination')
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
  // A bare `[data-blog-item] { display: block }` check also matches rules
  // scoped under an unrelated selector, which would leave only page one visible.
  assert.match(
    fallback,
    /\[data-blog-browser\]:not\(\[data-paged\]\)\s+\[data-post-list\]\s*>\s*\[data-blog-item\]\s*\{\s*display:\s*block\s*!important/
  )
  assert.match(
    fallback,
    /\[data-blog-browser\]\s+\[data-pagination\]\s*\{\s*display:\s*none\s*!important/
  )
})
