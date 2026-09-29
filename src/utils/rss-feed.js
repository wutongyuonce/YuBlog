import { getRssString } from '@astrojs/rss'

/** Encode each URL path segment while preserving nested content paths. */
export function encodePathSegments(path) {
  return path
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

/** Escape text inserted into an XML element. */
export function escapeXml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/** Serialize prepared entries without changing their permanent identities. */
export function createRssXml({ site, homeUrl, feedUrl, items }) {
  return getRssString({
    title: site.title,
    description: site.description,
    site: homeUrl,
    trailingSlash: false,
    xmlns: { atom: 'http://www.w3.org/2005/Atom' },
    customData: `<link>${escapeXml(homeUrl)}</link><language>${escapeXml(site.lang)}</language><atom:link href="${escapeXml(feedUrl)}" rel="self" type="application/rss+xml"/>`,
    items: items.map(({ guid, ...item }) => ({
      ...item,
      customData: `<guid isPermaLink="true">${escapeXml(guid)}</guid>`,
    })),
  })
}
