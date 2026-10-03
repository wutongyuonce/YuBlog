import assert from 'node:assert/strict'
import test from 'node:test'

import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import remarkCjkFriendly from 'remark-cjk-friendly'

// Typora 会加粗；CommonMark 把 `）` 当 punctuation，闭合 ** 失败。
const source =
  '**Codec（编解码器）**负责压缩与还原音频；**Neural Audio Codec（神经音频编解码器）**使用神经网络学习这种压缩。'

test('remark-cjk-friendly renders that same source as strong', async () => {
  const processor = await createMarkdownProcessor({
    remarkPlugins: [remarkCjkFriendly],
  })
  const { code } = await processor.render(source)

  assert.match(
    code,
    /<strong>Codec（编解码器）<\/strong>负责压缩与还原音频；<strong>Neural Audio Codec（神经音频编解码器）<\/strong>/
  )
})
