import { SITE } from '~/config'
import { getFilteredPosts, getSortedPosts } from '~/utils/data'
import { withBasePath } from '~/utils/path'
import { encodePathSegments, escapeXml } from '~/utils/rss-feed.js'

export async function GET() {
  const homeUrl = new URL(withBasePath('/'), SITE.website).href
  const posts = getSortedPosts(await getFilteredPosts('blogs'))
  const items = posts
    .map((post) => {
      const articlePath = encodePathSegments(`/blogs/${post.id}/`)
      const articleUrl = new URL(withBasePath(articlePath), SITE.website).href
      const link = post.data.redirect || articleUrl
      const description = post.data.description
        ? `<description>${escapeXml(post.data.description)}</description>`
        : ''
      return `<item>
<title>${escapeXml(post.data.title)}</title>
<link>${escapeXml(link)}</link>
<guid>${escapeXml(articleUrl)}</guid>
<pubDate>${post.data.pubDate.toUTCString()}</pubDate>
${description}
</item>`
    })
    .join('')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>${escapeXml(SITE.title)}</title>
<link>${escapeXml(homeUrl)}</link>
<description>${escapeXml(SITE.description)}</description>
${items}
</channel>
</rss>`

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  })
}
