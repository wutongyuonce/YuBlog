import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import test from 'node:test'
import { XMLParser, XMLValidator } from 'fast-xml-parser'
import { fromHtml } from 'hast-util-from-html'
import { visit } from 'unist-util-visit'

const built = (path) => new URL(`../dist/${path}`, import.meta.url)
const html = (path) => readFile(built(path), 'utf8')

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

test('Markdown width, reading metadata and heading links reach the built site', async () => {
  const [home, post] = await Promise.all([
    html('index.html'),
    html('blogs/多模态agent/index.html'),
  ])

  // This article has no explicit minutesRead: losing remarkReadingTime would
  // remove the automatic reading time and zero out the heatmap word counts.
  assert.match(post, /\b[1-9]\d* min(?: read)?\b/)
  assert.doesNotMatch(home, /blog-profile__stats/)
  const summaries = elements(fromHtml(home), 'p').filter((node) =>
    node.properties.className?.includes('writing-heatmap__summary')
  )
  assert.ok(summaries.length > 0, 'each heatmap year should show a word count')
  const wordCounts = summaries.map(
    (node) => textOf(node).match(/([\d,.]+)(?:万)?\s*字/)?.[1]
  )
  assert.ok(
    wordCounts.every(Boolean),
    'annual summaries include readable word counts'
  )
  assert.ok(
    wordCounts.some((count) => Number(count.replaceAll(',', '')) > 0),
    'word count must not silently become zero'
  )

  const image = post.match(
    /<img\b[^>]*alt="Cascaded 级联架构：VAD、ASR、LLM、TTS 流水线"[^>]*>/
  )?.[0]
  assert.ok(image, 'the |w586 image must not leak its marker into alt text')
  assert.match(image, /\bwidth="586"/)
  assert.match(image, /\bdata-astro-image="constrained"/)
  assert.match(image, /\bsrcset="[^"]+\.webp/)
  assert.match(
    post,
    /class="header-anchor"[^>]*href="#voice-agent-语音助手三种架构范式"/
  )
})

test('rehype tables, code, math and callouts remain active', async () => {
  const [tablePost, mathPost, calloutPost] = await Promise.all([
    html('blogs/fastapi/index.html'),
    html('blogs/算法笔记/算法-2哈希表字符串双指针总结栈与队列/index.html'),
    html('blogs/juc并发编程/juc-并发编程-1多线程基础/index.html'),
  ])
  assert.match(tablePost, /<div>\s*<table>/)
  assert.match(tablePost, /<div class="expressive-code">/)
  assert.match(mathPost, /<span class="katex">/)
  assert.match(
    calloutPost,
    /<div class="callout" data-callout="caution"[^>]*>[\s\S]*?<div class="callout-content"><p><strong>临界区/
  )
  assert.doesNotMatch(calloutPost, /\[!CAUTION\]/)
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

    if (file.startsWith('多模态agent/')) {
      const article = elements(page, 'article')[0]
      const paragraphs = elements(article, 'p').map(textOf).filter(Boolean)
      const feedText = textOf(body)
      assert.ok(feedText.includes(paragraphs[0]), 'opening prose must survive')
      assert.ok(
        feedText.includes(paragraphs.at(-1)),
        'closing prose must survive'
      )
      const image = elements(body, 'img').find(
        (n) =>
          n.properties.alt === 'Cascaded 级联架构：VAD、ASR、LLM、TTS 流水线'
      )
      assert.equal(image.properties.width, 586)
    }
    const annotations = elements(page, 'annotation').filter(
      (n) => n.properties.encoding === 'application/x-tex'
    )
    const rssInlineCode = elements(body, 'code').map(textOf)
    for (const annotation of annotations)
      assert.ok(
        rssInlineCode.includes(textOf(annotation)),
        'formula source must survive'
      )
    if (file === 'fastapi/index.html')
      assert.ok(elements(body, 'table').length > 0)
    if (file.includes('juc-并发编程-1多线程基础/'))
      assert.ok(textOf(body).includes('临界区'))
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

test('home and interests share card markup, image processing and heading groups', async () => {
  const home = fromHtml(await html('index.html'))
  const recent = elements(home, 'div').find((node) =>
    node.properties.className?.includes('recent-media__body')
  )
  assert.ok(recent, 'home renders the standalone recent.md content')
  const cards = elements(recent, 'article').filter((node) =>
    node.properties.className?.includes('media-card')
  )
  assert.ok(cards.length > 0)
  for (const image of elements(recent, 'img')) {
    assert.ok(image.properties.className?.includes('media-card__cover'))
    assert.equal(image.properties.dataAstroImage, 'constrained')
    assert.match(image.properties.src, /^\/_astro\/.*\.webp$/)
    await access(built(image.properties.src.slice(1)))
  }
  for (const heading of recent.children.filter((node) =>
    /^h[1-6]$/.test(node.tagName)
  )) {
    assert.ok(
      heading.properties.id,
      'Markdown heading depth and anchors survive'
    )
    assert.equal(
      elements(heading, 'a').filter((node) =>
        node.properties.className?.includes('header-anchor')
      ).length,
      1
    )
  }
  const anime = fromHtml(await html('interests/anime/index.html'))
  const firstCard = elements(anime, 'article').find((node) =>
    node.properties.className?.includes('media-card')
  )
  assert.ok(firstCard, 'watching entries are cards rather than plain links')
  assert.ok(elements(firstCard, 'img').length > 0)
  assert.ok(
    elements(firstCard, 'a').some((node) =>
      node.properties.className?.includes('media-card__title')
    )
  )
  assert.ok(
    !elements(firstCard, 'p').some((node) =>
      node.properties.className?.includes('media-card__score')
    ),
    'watching entries have no invented score'
  )
  for (const id of ['intro', 'recent']) {
    await assert.rejects(access(built(`interests/${id}/index.html`)), {
      code: 'ENOENT',
    })
  }
})

test('shared rating labels reach every Markdown card consumer without stale cached text', async () => {
  let checked = 0
  for (const path of [
    'index.html',
    ...['movie', 'tv', 'anime', 'game', 'book'].map(
      (id) => `interests/${id}/index.html`
    ),
  ]) {
    const page = fromHtml(await html(path))
    const scores = elements(page, 'p').filter((node) =>
      node.properties.className?.includes('media-card__score')
    )
    for (const score of scores)
      assert.ok(
        textOf(score).startsWith('评分：'),
        `${path}: the shared card renderer must replace old cached rating labels`
      )
    checked += scores.length
  }
  assert.ok(checked > 0, 'authored ratings must survive the shared pipeline')
})
