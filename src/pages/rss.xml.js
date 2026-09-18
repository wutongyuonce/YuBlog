import { SITE } from '~/config'
import { getFilteredPosts, getSortedPosts } from '~/utils/data'
import { withBasePath } from '~/utils/path'

function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

export async function GET() {
  const site = SITE.website.replace(/\/$/, '')
  const posts = getSortedPosts(await getFilteredPosts('blogs'))
  const items = posts
    .map((post) => {
      const link = `${site}${withBasePath(`/blogs/${post.id}/`)}`
      const description = post.data.description
        ? `<description>${escapeXml(post.data.description)}</description>`
        : ''
      return `<item>
<title>${escapeXml(post.data.title)}</title>
<link>${link}</link>
<guid>${link}</guid>
<pubDate>${post.data.pubDate.toUTCString()}</pubDate>
${description}
</item>`
    })
    .join('')

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>${escapeXml(SITE.title)}</title>
<link>${site}/</link>
<description>${escapeXml(SITE.description)}</description>
${items}
</channel>
</rss>`

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  })
}
