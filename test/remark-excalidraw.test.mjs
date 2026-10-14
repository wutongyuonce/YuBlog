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

test(':::excalidraw renders preview image, toolbar and static source link', async () => {
  const { code } = await render(
    ':::excalidraw{src="./image-layout-demo-img/verify.excalidraw" preview="./image-layout-demo-img/verify.svg" alt="示意"}\n:::'
  )
  assert.match(code, /class="[^"]*excalidraw-embed/)
  assert.match(code, /data-excalidraw-viewer/)
  assert.match(code, /image-layout-demo-img\/verify\.svg/)
  assert.match(code, /href="\.\/image-layout-demo-img\/verify\.excalidraw"/)
  assert.match(code, /download="/)
  assert.doesNotMatch(code, /blob:/)
  assert.match(code, /excalidraw-embed__toolbar/)
  assert.match(code, /Excalidraw 源文件/)
})

test(':::excalidraw infers same-basename svg preview', async () => {
  const { code } = await render(
    ':::excalidraw{src="./image-layout-demo-img/verify.excalidraw"}\n:::'
  )
  assert.match(code, /image-layout-demo-img\/verify\.svg/)
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
    /missing|mirrorable|relative path|preview/i
  )
})
