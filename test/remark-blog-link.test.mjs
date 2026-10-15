import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import test, { after } from 'node:test'
import { fileURLToPath } from 'node:url'

import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import remarkDirective from 'remark-directive'

import { resolveBlogEntry } from '../plugins/blog-entry.ts'
import remarkBlogLink from '../plugins/remark-blog-link.ts'

const directory = mkdtempSync(
  fileURLToPath(
    new URL('../src/content/blogs/blog-link-check-', import.meta.url)
  )
)
after(() => rmSync(directory, { recursive: true, force: true }))
const group = path.basename(directory).toLowerCase()
mkdirSync(path.join(directory, 'Deep Notes'))
for (const [name, metadata] of [
  ['index.md', 'title: 卡片目标\ndescription: 独立测试摘要'],
  ['Deep Notes/Hello World.mdx', 'title: 子目录目标'],
  ['Deep Notes/index.md', 'title: 目录首页'],
  ['alias.md', `title: 自定义地址\nslug: ${group}/custom-route`],
  ['draft.md', 'title: 草稿\ndraft: true'],
]) {
  writeFileSync(path.join(directory, name), `---\n${metadata}\n---\n正文。`)
}

const render = async (source) => {
  const processor = await createMarkdownProcessor({
    remarkPlugins: [remarkDirective, remarkBlogLink],
  })
  return processor.render(source)
}

test(':::blog-link resolves collection metadata without depending on real article copy', async () => {
  const { code } = await render(`:::blog-link{slug="${group}"}\n:::`)
  assert.match(code, /class="[^"]*blog-link-card/)
  assert.ok(code.includes(`href="/blogs/${group}/"`))
  assert.match(code, /卡片目标/)
  assert.match(code, /独立测试摘要/)
  assert.match(code, /\/avatar\.webp/)
  assert.match(code, /blog-link-card__avatar/)
})

test('nested filenames, collection IDs, directory indexes and explicit slugs resolve to their actual routes', async () => {
  for (const [slug, id, title] of [
    [
      `${group}/Deep Notes/Hello World`,
      `${group}/deep-notes/hello-world`,
      '子目录目标',
    ],
    [
      `${group}/deep-notes/hello-world`,
      `${group}/deep-notes/hello-world`,
      '子目录目标',
    ],
    [`${group}/deep-notes`, `${group}/deep-notes`, '目录首页'],
    [`${group}/custom-route`, `${group}/custom-route`, '自定义地址'],
  ]) {
    const entry = resolveBlogEntry(slug)
    assert.equal(entry?.id, id)
    assert.equal(entry.title, title)
    const { code } = await render(`:::blog-link{slug="${slug}"}\n:::`)
    assert.ok(code.includes(`href="/blogs/${id}/"`))
    assert.ok(code.includes(title))
  }
  for (const slug of ['../outside', `${group}/../alias`, '/absolute', 'a\\b'])
    assert.equal(resolveBlogEntry(slug), null)
})

test(':::blog-link allows explicit href overrides', async () => {
  const { code } = await render(
    ':::blog-link{href="/blogs/example/" title="自定义标题" description="自定义描述"}\n:::'
  )
  assert.match(code, /自定义标题/)
  assert.match(code, /自定义描述/)
  assert.match(code, /href="\/blogs\/example\/"/)
})

test(':::blog-link rejects unknown or draft posts and unsafe href', async () => {
  await assert.rejects(
    render(':::blog-link{slug="no-such-post-xyz"}\n:::'),
    /not found/
  )
  await assert.rejects(
    render(`:::blog-link{slug="${group}/draft"}\n:::`),
    /draft/
  )
  await assert.rejects(
    render(':::blog-link{href="javascript:alert(1)" title="x"}\n:::'),
    /safe href|requires slug/i
  )
})
