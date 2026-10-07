import assert from 'node:assert/strict'
import test from 'node:test'
import { register } from 'node:module'

import { encodePathSegments, escapeXml } from '../src/utils/rss-feed.js'

let fixtureId = 0

async function mockEndpoint(content = '<p>Published content</p>') {
  const endpoint = new URL('../src/pages/rss.xml.js', import.meta.url)
  endpoint.searchParams.set('fixture', String(fixtureId++))
  const endpointUrl = endpoint.href
  const modules = {
    'astro/container': `export const experimental_AstroContainer = {
      create: async () => ({ renderToString: async (content) => content })
    }`,
    'astro:content': `export async function render(post) {
      if (post.data.draft) throw new Error('RSS must not render drafts')
      return { Content: ${JSON.stringify(content)} }
    }`,
    '~/config': `export const SITE = {
      website: 'https://example.com/', title: 'Blog', description: 'Feed', lang: 'zh-CN'
    }`,
    '~/utils/data': `const posts = [
      { id: 'published', data: { title: 'Published', pubDate: new Date('2026-09-01'), draft: false } },
      { id: 'draft', data: { title: 'Draft', pubDate: new Date('2026-09-02'), draft: true } }
    ];
    export const getFilteredPosts = async () => posts;
    export const getPublishedBlogPosts = async () => posts.filter(post => !post.data.draft);
    export const getSortedPosts = posts => [...posts].sort((a, b) => b.data.pubDate - a.data.pubDate);`,
    '~/utils/path': 'export const withBasePath = path => path',
  }
  // Scope Astro mocks to this endpoint; use the loader API supported by Node 22.12.
  const loader = `
    const modules = ${JSON.stringify(modules)};
    export function resolve(specifier, context, nextResolve) {
      if (context.parentURL === ${JSON.stringify(endpointUrl)}) {
        if (Object.hasOwn(modules, specifier))
          return { url: 'data:text/javascript,' + encodeURIComponent(modules[specifier]), shortCircuit: true };
        if (specifier.startsWith('~/utils/'))
          return nextResolve(new URL(specifier.slice(2), ${JSON.stringify(new URL('../src/', import.meta.url).href)}).href, context);
      }
      return nextResolve(specifier, context);
    }
  `
  register(
    `data:text/javascript,${encodeURIComponent(loader)}`,
    import.meta.url
  )
  return import(endpointUrl)
}

test('RSS excludes drafts even when page previews include them in development', async () => {
  const { GET } = await mockEndpoint()
  const response = await GET()
  const { XMLParser } = await import('fast-xml-parser')
  const channel = new XMLParser().parse(await response.text()).rss.channel
  assert.deepEqual(
    [].concat(channel.item || []).map((item) => item.title),
    ['Published'],
    'RSS publishes non-drafts without exposing preview content'
  )
})

test('RSS rejects empty rendering before returning a successful feed but accepts media-only HTML', async () => {
  const broken = await mockEndpoint('')
  await assert.rejects(broken.GET, (error) => {
    assert.match(error.message, /RSS: failed to render article "published"/)
    assert.match(error.cause.message, /empty.*glob-loader/)
    return true
  })

  const media = await mockEndpoint('<video src="/demo.mp4" controls></video>')
  const response = await media.GET()
  assert.equal(response.status, 200)
  const { XMLParser } = await import('fast-xml-parser')
  const item = new XMLParser().parse(await response.text()).rss.channel.item
  assert.equal(
    item['content:encoded'],
    '<p><a href="https://example.com/blogs/published/">阅读原文</a></p>',
    'a valid rendered embed may be stripped by the RSS sanitizer'
  )
})

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
