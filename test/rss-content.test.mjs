import assert from 'node:assert/strict'
import test from 'node:test'
import { fromHtml } from 'hast-util-from-html'
import { visit } from 'unist-util-visit'

import { toRssHtml } from '../src/utils/rss-content.js'

const articleUrl = 'https://example.com/notes/blogs/中文/nested/'
const elements = (html, tag) => {
  const found = []
  visit(fromHtml(html, { fragment: true }), 'element', (node) => {
    if (node.tagName === tag) found.push(node)
  })
  return found
}
const textOf = (node) =>
  node.type === 'text' ? node.value : (node.children || []).map(textOf).join('')

test('reader HTML preserves complete prose, structure and code lines without site controls', () => {
  const html = toRssHtml(
    `<h2>开头<a class="header-anchor" href="#title">#</a></h2>
<div class="callout"><svg><text>icon</text></svg><div>CAUTION</div><p>提示正文</p></div>
<table><tr><th colspan="2">表头</th></tr><tr><td>单元格</td></tr></table>
<details><summary>展开标题</summary><p>隐藏正文</p></details>
<ul><li><input type="checkbox" checked>任务</li></ul>
<figure class="frame"><figcaption>demo.py</figcaption><pre data-language="python"><code><div class="ec-line"><div class="gutter">1</div><div class="code"><span>if x &lt; 2:</span></div></div><div class="ec-section"><details><summary><div class="ec-line"><div class="code">1 collapsed line</div></div></summary></details><div class="content-lines"><div class="ec-line"><div class="code"><span>    print(&quot;&amp;&quot;)</span></div></div></div></div><div class="ec-line"><div class="code">\n</div></div><div class="ec-line"><div class="code">done()</div></div></code></pre><button>Copy</button></figure>
<pre><code>plain\n  indented\n\nend</code></pre><p>结尾</p>`,
    articleUrl
  )
  const code = elements(html, 'pre').map(textOf)
  assert.deepEqual(code, [
    'if x < 2:\n    print("&")\n\ndone()',
    'plain\n  indented\n\nend',
  ])
  for (const content of [
    '开头',
    'CAUTION',
    '提示正文',
    '表头',
    '单元格',
    '展开标题',
    '隐藏正文',
    '[x] 任务',
    'demo.py',
    '结尾',
    '阅读原文',
  ]) {
    assert.ok(html.includes(content), content)
  }
  assert.equal(elements(html, 'th')[0].properties.colSpan, 2)
  assert.doesNotMatch(html, /<(?:button|svg|details)|class=|Copy|>icon</)
})

test('math is represented once as TeX, with inline and block semantics', () => {
  const formula =
    '<span class="katex"><span>duplicate presentation</span><math><semantics><annotation encoding="application/x-tex">x &lt; y</annotation></semantics></math></span>'
  const html = toRssHtml(
    `<p>${formula}</p><span class="katex-display">${formula}</span>`,
    articleUrl
  )
  assert.deepEqual(elements(html, 'code').map(textOf), ['x < y', 'x < y'])
  assert.equal(elements(html, 'pre').length, 1)
  assert.doesNotMatch(html, /duplicate|katex|<math/)
  assert.throws(
    () => toRssHtml('<span class="katex">broken</span>', articleUrl),
    /TeX annotation/
  )
})

test('images and links work outside the site, including base paths and fragments', () => {
  const html = toRssHtml(
    `<picture><source srcset="bad"><img src="/notes/_astro/photo.webp" alt="图片" width="480" srcset="bad" sizes="bad" loading="lazy"></picture>
<a href="../other/?x=1&amp;y=2">relative</a><a href="#中文">anchor</a><a href="//cdn.example/a">protocol-relative</a><a href="mailto:hi@example.com">email</a><a href="tel:+123">phone</a>`,
    articleUrl
  )
  assert.deepEqual(elements(html, 'img')[0].properties, {
    src: 'https://example.com/notes/_astro/photo.webp',
    alt: '图片',
    width: 480,
  })
  assert.deepEqual(
    elements(html, 'a').map((n) => n.properties.href),
    [
      'https://example.com/notes/blogs/%E4%B8%AD%E6%96%87/other/?x=1&y=2',
      'https://example.com/notes/blogs/%E4%B8%AD%E6%96%87/nested/#%E4%B8%AD%E6%96%87',
      'https://cdn.example/a',
      'mailto:hi@example.com',
      'tel:+123',
      articleUrl,
    ]
  )
  assert.doesNotMatch(html, /srcset|sizes=|loading=|<source/)
})

test('sanitization removes execution and styling without discarding normal content', () => {
  const html = toRssHtml(
    `<script>alert(1)</script><style>body{}</style><iframe src="https://video.example"></iframe>
<p id="x" class="x" style="display:none" onclick="evil()">safe
<a href="jav&#x61;script:alert(1)" onmouseover="evil()">bad URL</a>
<a href="data:text/html,bad">data URL</a><img src="https://img.example/a.png" onerror="evil()"></p>`,
    articleUrl
  )
  assert.doesNotMatch(
    html,
    /script|style|iframe|onclick|onmouseover|onerror|class=|id=|alert\(|data:/
  )
  assert.ok(html.includes('bad URL'))
  assert.equal(elements(html, 'a')[0].properties.href, undefined)
  assert.equal(
    elements(html, 'img')[0].properties.src,
    'https://img.example/a.png'
  )
  for (const src of [
    '',
    'data:image/png;base64,x',
    'javascript:alert(1)',
    'http://[',
  ]) {
    assert.throws(
      () => toRssHtml(`<img src="${src}">`, articleUrl),
      /usable HTTP/
    )
  }
})

test('empty content still has a canonical original-article link', () => {
  assert.equal(
    toRssHtml('', 'https://example.com/blogs/empty/'),
    '<p><a href="https://example.com/blogs/empty/">阅读原文</a></p>'
  )
})
