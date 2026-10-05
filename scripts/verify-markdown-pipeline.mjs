import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { fromHtml } from 'hast-util-from-html'
import { toHtml } from 'hast-util-to-html'
import { toRssHtml } from '../src/utils/rss-content.js'
import { visit } from 'unist-util-visit'
import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import remarkDirective from 'remark-directive'
import remarkMediaCard from '../plugins/remark-media-card.ts'
import { SITE } from '../src/config.ts'

const siteBase = new URL(
  SITE.base.endsWith('/') ? SITE.base : `${SITE.base}/`,
  SITE.website
)
const built = (path) => new URL(`../dist/${path}`, import.meta.url)
const html = (path) => readFile(built(path), 'utf8')
const localImage = (url) => {
  assert.equal(url.origin, siteBase.origin)
  assert.ok(url.pathname.startsWith(siteBase.pathname))
  return built(url.pathname.slice(siteBase.pathname.length))
}

test('static routes, feed, sitemap and search index exist', async () => {
  await Promise.all(
    [
      'index.html',
      'tags/index.html',
      'archives/index.html',
      'projects/index.html',
      'about/index.html',
      'rss.xml',
      'sitemap-index.xml',
      'pagefind/pagefind-entry.json',
    ].map((path) => access(built(path)))
  )
})

const elements = (tree, tag) => {
  const found = []
  visit(tree, 'element', (node) => {
    if (node.tagName === tag) found.push(node)
  })
  return found
}
const textOf = (node) =>
  node.type === 'text' ? node.value : (node.children || []).map(textOf).join('')

test('full RSS covers every built article and uses real, standalone content assets', async () => {
  const xml = await html('rss.xml')
  assert.equal(XMLValidator.validate(xml), true)
  const channel = new XMLParser({ ignoreAttributes: false }).parse(xml).rss
    .channel
  const items = [].concat(channel.item || [])
  const byUrl = new Map(items.map((item) => [item.guid['#text'], item]))
  assert.equal(byUrl.size, items.length, 'article identities must be unique')
  const files = (await readdir(built('blogs/'), { recursive: true })).filter(
    (path) => path.endsWith('/index.html')
  )
  assert.equal(
    items.length,
    files.length,
    'feed and published pages must have the same scope'
  )
  const assets = new Set()
  for (const file of files) {
    const page = fromHtml(await html(`blogs/${file}`))
    const canonical = elements(page, 'link').find((n) =>
      n.properties.rel?.includes('canonical')
    ).properties.href
    const item = byUrl.get(canonical)
    assert.ok(item, `missing RSS entry for ${canonical}`)
    assert.ok(Object.hasOwn(item, 'content:encoded'), canonical)
    const body = fromHtml(item['content:encoded'], { fragment: true })
    visit(body, 'element', (node) => {
      assert.ok(
        !['script', 'style', 'button'].includes(node.tagName),
        canonical
      )
      for (const prop of ['srcSet', 'className', 'style', 'loading']) {
        assert.equal(node.properties[prop], undefined, `${canonical}: ${prop}`)
      }
    })
    for (const a of elements(body, 'a')) {
      if (a.properties.href)
        assert.match(a.properties.href, /^(https?:|mailto:|tel:)/)
    }
    for (const img of elements(body, 'img')) {
      const url = new URL(img.properties.src)
      assert.match(url.protocol, /^https?:$/)
      if (url.origin === new URL(canonical).origin) {
        const base = new URL(channel.link).pathname
        assert.ok(
          url.pathname.startsWith(base),
          'same-site image should respect deployment base'
        )
        assets.add(decodeURIComponent(url.pathname.slice(base.length)))
      }
    }
    assert.equal(elements(body, 'a').at(-1).properties.href, canonical)
    // Copy payloads omit shell comments; their remaining lines must stay ordered.
    const originalCode = elements(page, 'button')
      .filter((n) => typeof n.properties.dataCode === 'string')
      .map((n) => n.properties.dataCode.replaceAll('\x7f', '\n'))
    const rssCode = elements(body, 'pre').map(textOf)
    for (const code of originalCode)
      assert.ok(
        rssCode.some((block) => {
          const lines = block.split('\n')
          let cursor = 0
          return code.split('\n').every((line) => {
            const index = lines.indexOf(line, cursor)
            cursor = index + 1
            return index !== -1
          })
        }),
        `code lines lost: ${canonical}: ${code.slice(0, 80)}`
      )

    const article = elements(page, 'article').find((node) =>
      node.properties.className?.includes('post-content')
    )
    assert.ok(article, `${canonical}: the published page has an article body`)
    const content = {
      type: 'root',
      children: article.children.filter(
        (node) =>
          node.type !== 'element' || node.tagName !== 'table-of-contents'
      ),
    }
    // The site compresses inter-element whitespace; compare prose without
    // locking its serialization. Code line order is checked separately above.
    const expected = fromHtml(toRssHtml(toHtml(content), canonical), {
      fragment: true,
    })
    assert.equal(
      textOf(body).replace(/\s+/g, ''),
      textOf(expected).replace(/\s+/g, ''),
      `${canonical}: RSS must retain the complete authored text`
    )
    assert.equal(
      elements(body, 'table').length,
      elements(article, 'table').length,
      `${canonical}: RSS preserves authored tables`
    )
    const annotations = elements(page, 'annotation').filter(
      (n) => n.properties.encoding === 'application/x-tex'
    )
    const rssInlineCode = elements(body, 'code').map(textOf)
    for (const annotation of annotations)
      assert.ok(
        rssInlineCode.includes(textOf(annotation)),
        'formula source must survive'
      )
  }
  for (const asset of assets) await access(built(asset))
  const dates = items.map((item) => Date.parse(item.pubDate))
  assert.deepEqual(
    dates,
    [...dates].sort((a, b) => b - a)
  )
  console.log(
    `RSS: ${items.length} articles, ${assets.size} local image assets, ${Buffer.byteLength(xml)} bytes`
  )
})

test('home and interest cards preserve authored content through the shared pipeline', async () => {
  const home = fromHtml(await html('index.html'))
  const recent = elements(home, 'div').find((node) =>
    node.properties.className?.includes('recent-media__body')
  )
  assert.ok(recent, 'home renders the standalone recent.md content')
  const processor = await createMarkdownProcessor({
    remarkPlugins: [remarkDirective, remarkMediaCard],
  })
  const cardContent = (tree) =>
    elements(tree, 'article')
      .filter((node) => node.properties.className?.includes('media-card'))
      .map((card) => ({
        title: elements(card, 'a')
          .concat(elements(card, 'p'))
          .filter((node) =>
            node.properties.className?.includes('media-card__title')
          )
          .map(textOf),
        rating: elements(card, 'p')
          .filter((node) =>
            node.properties.className?.includes('media-card__score')
          )
          .map(textOf),
      }))
  const files = (
    await readdir(new URL('../src/content/interests/', import.meta.url))
  ).filter((file) => /\.(md|mdx)$/.test(file) && file !== 'intro.md')
  for (const file of files) {
    const source = await readFile(
      new URL(`../src/content/interests/${file}`, import.meta.url),
      'utf8'
    )
    const { code } = await processor.render(source)
    const page =
      file === 'recent.md'
        ? recent
        : fromHtml(
            await html(
              `interests/${file.replace(/\.(md|mdx)$/, '')}/index.html`
            )
          )
    assert.deepEqual(
      cardContent(page),
      cardContent(fromHtml(code)),
      `${file}: card titles and optional ratings match the shared renderer`
    )
    for (const card of elements(page, 'article').filter((node) =>
      node.properties.className?.includes('media-card')
    )) {
      // The shared plugin owns rejection; this checks its rendered cover and resources.
      const covers = elements(card, 'img')
      assert.ok(covers.length <= 1, `${file}: cards have at most one cover`)
      for (const cover of covers) {
        assert.ok(cover.properties.className?.includes('media-card__cover'))
        const url = new URL(cover.properties.src, siteBase)
        if (url.origin !== siteBase.origin) continue // Remote covers are not fetched.
        assert.equal(cover.properties.dataAstroImage, 'constrained')
        await access(localImage(url))
      }
    }
  }
  for (const id of ['intro', 'recent']) {
    await assert.rejects(access(built(`interests/${id}/index.html`)), {
      code: 'ENOENT',
    })
  }
})

test('rendered Markdown headings and processed images remain usable', async () => {
  const files = (await readdir(built(''), { recursive: true })).filter(
    (file) => file === 'index.html' || file.endsWith('/index.html')
  )
  for (const file of files) {
    const page = fromHtml(await html(file))
    const bodies = elements(page, 'article')
      .concat(elements(page, 'div'))
      .filter((node) => node.properties.className?.includes('markdown-content'))
    for (const body of bodies) {
      for (const tag of ['h1', 'h2', 'h3', 'h4', 'h5', 'h6']) {
        for (const heading of elements(body, tag)) {
          assert.ok(
            heading.properties.id,
            `${file}: Markdown heading has an anchor target`
          )
          const anchors = elements(heading, 'a').filter((node) =>
            node.properties.className?.includes('header-anchor')
          )
          assert.equal(anchors.length, 1)
          assert.equal(anchors[0].properties.href, `#${heading.properties.id}`)
        }
      }
      for (const image of elements(body, 'img')) {
        assert.doesNotMatch(image.properties.alt || '', /\|w\d+$/)
        if (!image.properties.dataAstroImage) continue
        assert.ok(image.properties.width > 0 && image.properties.height > 0)
        await access(localImage(new URL(image.properties.src, siteBase)))
      }
    }
  }
})
