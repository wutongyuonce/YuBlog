import assert from 'node:assert/strict'
import test from 'node:test'

import { encodePathSegments, escapeXml } from '../src/utils/rss-feed.js'

test('RSS path encoding preserves nested routes and escapes reserved slug characters', () => {
  assert.equal(
    encodePathSegments('/blogs/JUC 并发编程/Prompt Caching & Agent/'),
    '/blogs/JUC%20%E5%B9%B6%E5%8F%91%E7%BC%96%E7%A8%8B/Prompt%20Caching%20%26%20Agent/'
  )
})

test('RSS XML text escapes ampersands and markup characters', () => {
  assert.equal(
    escapeXml('A & B <title> "quoted"'),
    'A &amp; B &lt;title&gt; &quot;quoted&quot;'
  )
})

test('official serialization preserves identity separately from redirect and round-trips full HTML', async () => {
  const { createRssXml } = await import('../src/utils/rss-feed.js')
  const { XMLParser, XMLValidator } = await import('fast-xml-parser')
  const options = {
    site: { title: 'A & B', description: '<介绍>', lang: 'zh-CN' },
    homeUrl: 'https://example.com/notes/',
    feedUrl: 'https://example.com/notes/rss.xml',
    items: [
      {
        title: '标题 <&> "]]>',
        description: '摘要 & <简介>',
        pubDate: new Date('2026-09-01T00:00:00Z'),
        link: 'https://external.example/post?x=1&y=2',
        guid: 'https://example.com/notes/blogs/canonical/',
        content: '<p>开始 &amp; &lt; &gt; ]]> 结束</p>',
      },
    ],
  }
  const xml = await createRssXml(options)
  assert.equal(XMLValidator.validate(xml), true)
  const { rss } = new XMLParser({ ignoreAttributes: false }).parse(xml)
  assert.equal(
    rss['@_xmlns:content'],
    'http://purl.org/rss/1.0/modules/content/'
  )
  assert.equal(rss.channel.title, options.site.title)
  assert.equal(rss.channel.link, options.homeUrl)
  assert.equal(rss.channel.language, 'zh-CN')
  assert.equal(rss.channel['atom:link']['@_href'], options.feedUrl)
  const item = rss.channel.item
  assert.equal(item.guid['#text'], options.items[0].guid)
  assert.equal(item.guid['@_isPermaLink'], 'true')
  for (const field of ['title', 'description', 'link'])
    assert.equal(item[field], options.items[0][field])
  assert.equal(item.pubDate, options.items[0].pubDate.toUTCString())
  assert.equal(item['content:encoded'], options.items[0].content)

  const empty = await createRssXml({ ...options, items: [] })
  assert.equal(XMLValidator.validate(empty), true)
  assert.equal(new XMLParser().parse(empty).rss.channel.item, undefined)
})
