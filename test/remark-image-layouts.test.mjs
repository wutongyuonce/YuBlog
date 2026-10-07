import assert from 'node:assert/strict'
import test from 'node:test'
import { VFile } from 'vfile'
import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import remarkDirective from 'remark-directive'
import rehypeRaw from 'rehype-raw'
import { fromHtml } from 'hast-util-from-html'
import { visit, SKIP } from 'unist-util-visit'
import remarkImageWidth from '../plugins/remark-image-width.ts'
import remarkImageLayouts, {
  rehypeImageSources,
} from '../plugins/remark-image-layouts.ts'
import { toRssHtml } from '../src/utils/rss-content.js'

const processor = await createMarkdownProcessor({
  remarkPlugins: [remarkDirective, remarkImageWidth, remarkImageLayouts],
  syntaxHighlight: false,
})
const nodes = (code, predicate) => {
  const result = []
  visit(fromHtml(code, { fragment: true }), 'element', (node) => {
    if (node.tagName === 'template') return SKIP
    if (predicate(node)) result.push(node)
  })
  return result
}
const hasClass = (name) => (node) => node.properties.className?.includes(name)

test('gallery preserves explicit groups and image order, including same-paragraph images', async () => {
  const { code } = await processor.render(`:::gallery{columns="3"}
![一](https://example.com/1.jpg)
![二](https://example.com/2.jpg)

![三](https://example.com/3.jpg)
:::

普通正文。

:::gallery{layout="scroll"}
![四](https://example.com/4.jpg)

![五](https://example.com/5.jpg)
:::`)
  const defaults = await processor.render(
    ':::gallery\n![默认](https://example.com/default.jpg)\n:::'
  )
  assert.equal(
    nodes(defaults.code, hasClass('image-gallery--grid'))[0].properties
      .dataColumns,
    '2'
  )
  assert.equal(nodes(code, hasClass('image-gallery')).length, 2)
  assert.equal(
    nodes(code, hasClass('image-gallery--grid'))[0].properties.dataColumns,
    '3'
  )
  assert.equal(nodes(code, hasClass('image-gallery--scroll')).length, 1)
  assert.deepEqual(
    nodes(code, (n) => n.tagName === 'img').map((n) => n.properties.alt),
    ['一', '二', '三', '四', '五']
  )
})

test('grid widths control constrained tracks while preserving images and authored thumbnail widths', async () => {
  for (const [attrs, columns, style] of [
    [
      'columns="2" widths="1fr 2fr"',
      '2',
      '--image-gallery-columns: minmax(0, 1fr) minmax(0, 2fr)',
    ],
    [
      'columns="2" widths="240px 1fr"',
      '2',
      '--image-gallery-columns: minmax(0, 240px) minmax(0, 1fr)',
    ],
    [
      'widths=".5fr 1.25fr 2fr"',
      '3',
      '--image-gallery-columns: minmax(0, .5fr) minmax(0, 1.25fr) minmax(0, 2fr)',
    ],
    [
      'widths=" \t240.5px\t  .5fr  "',
      '2',
      '--image-gallery-columns: minmax(0, 240.5px) minmax(0, .5fr)',
    ],
  ]) {
    const { code } = await processor.render(`:::gallery{${attrs}}
![一|w220](https://example.com/1.jpg)

![二](https://example.com/2.jpg)
:::`)
    const grid = nodes(code, hasClass('image-gallery--grid'))[0]
    assert.equal(grid.properties.dataColumns, columns)
    assert.equal(grid.properties.style, style)
    const images = nodes(code, (node) => node.tagName === 'img')
    assert.deepEqual(
      images.map((image) => [image.properties.alt, image.properties.src]),
      [
        ['一', 'https://example.com/1.jpg'],
        ['二', 'https://example.com/2.jpg'],
      ]
    )
    assert.equal(images[0].properties.width, 220)
    const full = nodes(code, hasClass('image-view'))[0].children.find(
      (node) => node.tagName === 'template'
    ).content.children[0]
    assert.equal(full.properties.src, 'https://example.com/1.jpg')
    assert.equal(full.properties.width, undefined)
  }
})

test('figure scopes its first image and retains Markdown prose after it', async () => {
  for (const side of [undefined, 'left', 'right']) {
    const { code } =
      await processor.render(`:::figure${side ? `{side="${side}"}` : ''}
![配图](https://example.com/1.jpg)

**正文** [链接](https://example.com/)

后续段落。
:::

容器外文字。`)
    assert.equal(
      nodes(code, hasClass(`image-figure--${side ?? 'right'}`)).length,
      1
    )
    assert.match(code, /<strong>正文<\/strong>/)
    assert.match(code, /后续段落/)
    assert.match(code, /容器外文字/)
  }
})

test('figure accepts visible HTML prose and literal markup in code', async () => {
  for (const prose of ['<p>HTML <strong>正文</strong></p>', '`<img>`']) {
    const { code } = await processor.render(
      `:::figure\n![图](https://example.com/image.jpg)\n\n${prose}\n:::`
    )
    assert.equal(nodes(code, hasClass('image-figure')).length, 1)
  }
})

test('static MDX media fallback does not supply figure prose but ordinary MDX text does', () => {
  const figure = (type, name) => ({
    type: 'containerDirective',
    name: 'figure',
    attributes: {},
    children: [
      {
        type: 'paragraph',
        children: [{ type: 'image', url: './x.png', alt: '图' }],
      },
      {
        type,
        name,
        attributes: [],
        children: [{ type: 'text', value: '文字' }],
      },
    ],
  })
  for (const type of ['mdxJsxFlowElement', 'mdxJsxTextElement']) {
    assert.throws(
      () =>
        remarkImageLayouts()(
          { type: 'root', children: [figure(type, 'video')] },
          new VFile()
        ),
      /Figure requires.*prose/
    )
    assert.doesNotThrow(() =>
      remarkImageLayouts()(
        { type: 'root', children: [figure(type, 'p')] },
        new VFile()
      )
    )
  }
})

test('ordinary images keep authored thumbnail width and a separate full-size Astro source', async () => {
  const { code } = await processor.render(
    '![截图|w220](./photo.png)\n\n[![链接图片](./link.png)](https://example.com/)'
  )
  const views = nodes(code, hasClass('image-view'))
  assert.equal(views.length, 2)
  const visible = nodes(code, (node) => node.tagName === 'img')
  assert.equal(visible[0].properties.width, 220)
  assert.equal(visible[0].properties.alt, '截图')
  const full = views[0].children.find((node) => node.tagName === 'template')
    .content.children[0]
  assert.equal(full.properties.width, undefined)
  assert.equal(full.properties.src, './photo.png')
  assert.equal(
    views[1].children[0].tagName,
    'a',
    'authored links stay inside the view, not around zoom controls'
  )
})

test('RSS degrades both gallery modes and figures without duplicate sources or missing pictures', async () => {
  const { code } = await processor.render(`:::gallery{widths="240px 1fr"}
![定宽](https://example.com/fixed.jpg)

![自适应](https://example.com/flexible.jpg)
:::

:::gallery{layout="scroll"}
![一](https://example.com/1.jpg)

![二](https://example.com/2.jpg)
:::

:::figure
![三](https://example.com/3.jpg)

最后的正文。
:::`)
  const rss = toRssHtml(code, 'https://example.com/blogs/demo/')
  assert.deepEqual(
    nodes(rss, (n) => n.tagName === 'img').map((n) => [
      n.properties.alt,
      n.properties.src,
    ]),
    [
      ['定宽', 'https://example.com/fixed.jpg'],
      ['自适应', 'https://example.com/flexible.jpg'],
      ['一', 'https://example.com/1.jpg'],
      ['二', 'https://example.com/2.jpg'],
      ['三', 'https://example.com/3.jpg'],
    ]
  )
  assert.match(rss, /最后的正文/)
  assert.doesNotMatch(rss, /template|class=|style=|data-columns|layout=/)
})

test('invalid layout intent fails explicitly rather than dropping or guessing authored content', async () => {
  for (const source of [
    ':::gallery{layout}\n![图](./x.png)\n:::',
    ':::gallery{columns}\n![图](./x.png)\n:::',
    ':::gallery{widths}\n![图](./x.png)\n:::',
    ':::gallery{widths=""}\n![图](./x.png)\n:::',
    ':::gallery{widths=" \t "}\n![图](./x.png)\n:::',
    ':::gallery{widths="1fr"}\n![图](./x.png)\n:::',
    ':::gallery{widths="1fr 1fr 1fr 1fr"}\n![图](./x.png)\n:::',
    ':::gallery{columns="2" widths="1fr 1fr 1fr"}\n![图](./x.png)\n:::',
    ':::gallery{columns="3" widths="1fr 1fr"}\n![图](./x.png)\n:::',
    ':::gallery{columns="4" widths="1fr 1fr"}\n![图](./x.png)\n:::',
    ':::gallery{columns widths="1fr 1fr"}\n![图](./x.png)\n:::',
    ':::gallery{widths="1fr; color:red"}\n![图](./x.png)\n:::',
    ':::gallery{widths="1fr calc(2fr)"}\n![图](./x.png)\n:::',
    ':::gallery{widths="1fr var(--track)"}\n![图](./x.png)\n:::',
    ':::gallery{widths="0fr 1fr"}\n![图](./x.png)\n:::',
    ':::gallery{widths="1fr 0.0px"}\n![图](./x.png)\n:::',
    ':::gallery{widths="-1px 1fr"}\n![图](./x.png)\n:::',
    ':::gallery{widths="1fr -.5fr"}\n![图](./x.png)\n:::',
    ':::gallery{widths="Infinitypx 1fr"}\n![图](./x.png)\n:::',
    ':::gallery{widths="NaNfr 1fr"}\n![图](./x.png)\n:::',
    `:::gallery{widths="${'9'.repeat(309)}px 1fr"}\n![图](./x.png)\n:::`,
    ':::gallery{widths="1e3px 1fr"}\n![图](./x.png)\n:::',
    ':::gallery{widths="50% 1fr"}\n![图](./x.png)\n:::',
    ':::gallery{widths="20em 1fr"}\n![图](./x.png)\n:::',
    ':::gallery{widths="240 1fr"}\n![图](./x.png)\n:::',
    ':::gallery{layout="scroll" widths="1fr 2fr"}\n![图](./x.png)\n:::',
    ':::gallery{layout="scroll" widths}\n![图](./x.png)\n:::',
    ':::figure{side}\n![图](./x.png)\n\n正文\n:::',
    ':::gallery{layout="carousel"}\n![图](./x.png)\n:::',
    ':::gallery{columns="4"}\n![图](./x.png)\n:::',
    ':::gallery{layout="scroll" columns="2"}\n![图](./x.png)\n:::',
    ':::gallery{style="color:red"}\n![图](./x.png)\n:::',
    ':::gallery\n正文不能变成图片。\n:::',
    ':::gallery\n:::',
    ':::figure{side="top"}\n![图](./x.png)\n\n正文\n:::',
    ':::figure\n![图](./x.png)\n:::',
    ':::figure\n![图](./x.png)\n\n![另一图](./y.png)\n:::',
    ':::figure\n![图](./x.png)\n\n[link]: https://example.com/\n:::',
    ':::figure\n![图](./x.png)\n\n[^unused]: 这段文字没有在页面显示\n:::',
    ...[
      '<!-- 编辑备注 -->',
      '<br>',
      '<div></div>',
      '<img src="https://example.com/only.jpg">',
      '<script>不是正文</script>',
      '<template>不是正文</template>',
    ].map((html) => `:::figure\n![图](./x.png)\n\n${html}\n:::`),
    ':::figure\n正文\n\n![图](./x.png)\n:::',
    '::::figure\n![图](./x.png)\n\n:::gallery\n![图](./y.png)\n:::\n::::',
  ]) {
    await assert.rejects(
      processor.render(source),
      (error) =>
        /Gallery|Grid gallery|Scroll galleries|Figure|Unknown gallery|Image layouts/.test(
          error.message
        ) &&
        error.line > 0 &&
        error.column > 0
    )
  }
})

test('raw HTML parsing does not hide full-size Markdown sources from Astro image processing', async () => {
  const pipeline = await createMarkdownProcessor({
    remarkPlugins: [remarkDirective, remarkImageWidth, remarkImageLayouts],
    rehypePlugins: [rehypeRaw, rehypeImageSources],
  })
  const { code } = await pipeline.render(
    '![图|w220](./photo.png)\n\n![远程](https://example.com/photo.jpg)',
    {
      fileURL: new URL('../src/content/blogs/check.md', import.meta.url),
    }
  )
  const images = []
  const tree = fromHtml(code, { fragment: true })
  visit(tree, 'element', (node) => {
    if (node.tagName === 'template') {
      images.push(node.content.children[0])
    } else if (node.tagName === 'img') images.unshift(node)
  })
  assert.equal(images.length, 4)
  const remote = images.filter((image) => image.properties.src)
  assert.equal(remote.length, 2)
  for (const image of remote) {
    assert.equal(image.properties.layout, undefined)
    assert.equal(image.properties.widths, undefined)
  }
  const references = images
    .filter((image) => image.properties.__astro_image_)
    .map((image) => JSON.parse(image.properties.__astro_image_))
  assert.equal(references[0].width, 220)
  assert.equal(references[1].width, undefined)
  assert.equal(references[1].layout, 'none')
  assert.deepEqual(references[1].widths, [])
  assert.deepEqual(
    references.map((ref) => ref.src),
    ['./photo.png', './photo.png']
  )
})
