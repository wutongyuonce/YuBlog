import assert from 'node:assert/strict'
import path from 'node:path'
import test from 'node:test'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import remarkDirective from 'remark-directive'

import remarkExcalidraw from '../plugins/remark-excalidraw.ts'

const postPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../src/content/blogs/image-layout-demo.md'
)

const render = async (source) => {
  const processor = await createMarkdownProcessor({
    remarkPlugins: [remarkDirective, remarkExcalidraw],
  })
  return processor.render(source, { fileURL: pathToFileURL(postPath) })
}

test(':::excalidraw renders host, toolbar download and static source link', async () => {
  const { code } = await render(
    ':::excalidraw{src="./image-layout-demo-img/verify.excalidraw" preview="./image-layout-demo-img/verify.svg" alt="示意"}\n:::'
  )
  assert.match(code, /class="[^"]*excalidraw-embed/)
  assert.match(code, /data-excalidraw-viewer/)
  assert.match(code, /data-excalidraw-host/)
  assert.match(code, /excalidraw-embed__expand/)
  assert.match(code, /excalidraw-embed__zoom-out/)
  assert.match(code, /excalidraw-embed__reset/)
  assert.match(code, /href="\.\/image-layout-demo-img\/verify\.excalidraw"/)
  assert.match(code, /download="/)
  assert.doesNotMatch(code, /blob:/)
  assert.match(code, /excalidraw-embed__toolbar/)
  assert.match(code, /Excalidraw 源文件/)
  // Optional preview still emitted as fallback when present
  assert.match(code, /image-layout-demo-img\/verify\.svg/)
})

test(':::excalidraw works with src only when same-basename preview exists', async () => {
  const { code } = await render(
    ':::excalidraw{src="./image-layout-demo-img/verify.excalidraw"}\n:::'
  )
  assert.match(code, /data-excalidraw-host/)
  assert.match(code, /image-layout-demo-img\/verify\.svg/)
})

test(':::excalidraw allows src-only without any preview image', async () => {
  const dir = path.dirname(fileURLToPath(import.meta.url))
  const fixtureDir = path.join(dir, '../src/content/blogs/_excalidraw-fixture')
  const { mkdirSync, writeFileSync, rmSync } = await import('node:fs')
  mkdirSync(fixtureDir, { recursive: true })
  const scene = path.join(fixtureDir, 'solo.excalidraw')
  writeFileSync(
    scene,
    JSON.stringify({ type: 'excalidraw', version: 2, elements: [] })
  )
  const mdPath = path.join(fixtureDir, 'note.md')
  writeFileSync(mdPath, '')
  try {
    const processor = await createMarkdownProcessor({
      remarkPlugins: [remarkDirective, remarkExcalidraw],
    })
    const { code } = await processor.render(
      ':::excalidraw{src="./solo.excalidraw" alt="solo"}\n:::',
      { fileURL: pathToFileURL(mdPath) }
    )
    assert.match(code, /data-excalidraw-host/)
    assert.match(code, /href="\.\/solo\.excalidraw"/)
    assert.doesNotMatch(code, /excalidraw-embed__fallback/)
    assert.doesNotMatch(code, /blob:/)
  } finally {
    rmSync(fixtureDir, { recursive: true, force: true })
  }
})

test(':::excalidraw rejects blob src and missing files', async () => {
  await assert.rejects(
    render(':::excalidraw{src="blob:https://example/x"}\n:::'),
    /blob:/
  )
  await assert.rejects(
    render(
      ':::excalidraw{src="./image-layout-demo-img/missing.excalidraw"}\n:::'
    ),
    /missing|mirrorable|relative path/i
  )
})
