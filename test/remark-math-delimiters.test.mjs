import assert from 'node:assert/strict'
import test from 'node:test'

import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import remarkMath from 'remark-math'
import rehypeKatex from 'rehype-katex'

// 只验证作者分隔符契约，不绑定整页 HTML 或 CSS。
const processor = await createMarkdownProcessor({
  remarkPlugins: [remarkMath],
  rehypePlugins: [rehypeKatex],
})

test('行内美元分隔符生成 KaTeX', async () => {
  const { code } = await processor.render('$a+b$')
  assert.match(code, /class="katex"/)
})

test('独立行双美元分隔符生成块级公式', async () => {
  const { code } = await processor.render('$$\na+b\n$$')
  assert.match(code, /class="katex-display"/)
})

test('反斜杠括号不是数学分隔符', async () => {
  const { code } = await processor.render(String.raw`\(a+b\)

\[a+b\]`)
  assert.doesNotMatch(code, /class="katex(?:[\s"-])/)
})
