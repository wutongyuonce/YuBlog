import assert from 'node:assert/strict'
import test from 'node:test'

import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import remarkDirective from 'remark-directive'

import remarkBlogLink from '../plugins/remark-blog-link.ts'

const render = async (source) => {
  const processor = await createMarkdownProcessor({
    remarkPlugins: [remarkDirective, remarkBlogLink],
  })
  return processor.render(source)
}

test(':::blog-link resolves slug to title, description and href', async () => {
  const { code } = await render(':::blog-link{slug="astro"}\n:::')
  assert.match(code, /class="[^"]*blog-link-card/)
  assert.match(code, /href="\/blogs\/astro\/"/)
  assert.match(code, /Astro Notes/)
  assert.match(code, /Astro Grammer/)
  assert.match(code, /\/avatar\.webp/)
  assert.match(code, /blog-link-card__avatar/)
})

test(':::blog-link allows explicit href overrides', async () => {
  const { code } = await render(
    ':::blog-link{href="/blogs/astro/" title="自定义标题" description="自定义描述"}\n:::'
  )
  assert.match(code, /自定义标题/)
  assert.match(code, /自定义描述/)
  assert.match(code, /href="\/blogs\/astro\/"/)
})

test(':::blog-link rejects unknown slug and unsafe href', async () => {
  await assert.rejects(
    render(':::blog-link{slug="no-such-post-xyz"}\n:::'),
    /not found/
  )
  await assert.rejects(
    render(':::blog-link{href="javascript:alert(1)" title="x"}\n:::'),
    /safe href|requires slug/i
  )
})
