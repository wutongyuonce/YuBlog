import { experimental_AstroContainer as AstroContainer } from 'astro/container'
import { render } from 'astro:content'

import { SITE } from '~/config'
import { getFilteredPosts, getSortedPosts } from '~/utils/data'
import { withBasePath } from '~/utils/path'
import { createRssXml, encodePathSegments } from '~/utils/rss-feed.js'
import { toRssHtml } from '~/utils/rss-content.js'

export async function GET() {
  const homeUrl = new URL(withBasePath('/'), SITE.website).href
  const feedUrl = new URL(withBasePath('/rss.xml'), SITE.website).href
  const posts = getSortedPosts(await getFilteredPosts('blogs'))
  const container = await AstroContainer.create()
  const items = []

  for (const post of posts) {
    const articlePath = encodePathSegments(`/blogs/${post.id}/`)
    const articleUrl = new URL(withBasePath(articlePath), SITE.website).href
    try {
      const { Content } = await render(post)
      const html = await container.renderToString(Content)
      items.push({
        title: post.data.title,
        description: post.data.description,
        pubDate: post.data.pubDate,
        link: post.data.redirect || articleUrl,
        guid: articleUrl,
        content: toRssHtml(html, articleUrl),
      })
    } catch (cause) {
      throw new Error(`RSS: failed to render article "${post.id}"`, { cause })
    }
  }

  const xml = await createRssXml({ site: SITE, homeUrl, feedUrl, items })
  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  })
}
