import { fetchPlaylistsSnapshot } from '../src/utils/playlists.mjs'

const CACHE =
  'public, max-age=0, s-maxage=86400, stale-while-revalidate=3600, stale-if-error=604800'

const json = (body, status, cache) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cache,
    },
  })

/** 与首页听歌相同的缓存窗口：只有无查询参数的 GET 可触发上游。 */
export async function handlePlaylists(request, { fetchImpl, now } = {}) {
  if (request.method !== 'GET')
    return new Response(null, {
      status: 405,
      headers: { 'allow': 'GET', 'cache-control': 'no-store' },
    })
  if (new URL(request.url).search)
    return json({ error: 'unexpected_query' }, 400, 'no-store')
  try {
    const snapshot = await fetchPlaylistsSnapshot({ fetchImpl, now })
    return json(snapshot, 200, CACHE)
  } catch {
    return json({ error: 'upstream_unavailable' }, 502, 'no-store')
  }
}

export default { fetch: (request) => handlePlaylists(request) }
