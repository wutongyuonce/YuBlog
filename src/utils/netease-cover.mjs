/**
 * 网易云封面回退的唯一属主：搜索、结果核对、图片地址与实例内缓存。
 *
 * 只在服务端运行。Last.fm 给不出可用封面时，按「名称 + 歌手」搜索网易云，只接受
 * 名称与歌手都对得上的结果，宁可没有封面也不配错图。这是尽力而为的补充：超时、
 * 网络错误或异常响应都只返回 null，不让听歌接口失败；失败只短暂缓存。
 */

const SEARCH_URL = 'https://music.163.com/api/cloudsearch/pc'
const TYPES = { song: '1', album: '10' }
const CANDIDATES = '5'
/** 每次搜索最多等 2.5 秒；回退只是锦上添花，不能拖慢整个接口。 */
const TIMEOUT = 2_500
/** 命中与确认没有结果都缓存半小时。 */
const TTL = 30 * 60_000
/** 失败只缓存一分钟：网易云不可用时不让每次回源都再等一遍超时。 */
const FAILURE_TTL = 60_000
const MAX_ENTRIES = 500

const isObject = (value) =>
  value !== null && typeof value === 'object' && !Array.isArray(value)

/** 统一大小写、全半角，去掉空白、标点与符号。 */
const fold = (value) =>
  value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, '')

/** 去掉括号注记（版本、译名、Live 等）后的名字。 */
const bareName = (value) =>
  value.replace(/[(（[【][^)）\]】]*[)）\]】]/g, '').trim()

/** 原名与去掉括号注记后的名字。 */
const forms = (value) => {
  if (typeof value !== 'string') return []
  return [...new Set([fold(value), fold(bareName(value))])].filter(Boolean)
}

/** Last.fm 常把合作歌手写成一串（「Rosalía, The Weeknd」），拆开后任一位对上即可。 */
const artistParts = (artist) => [
  artist,
  ...artist
    .split(/\s*(?:,|，|、|&|＆|\/|;|\b(?:feat|ft)\b\.?|\bx\b)\s*/i)
    .filter(Boolean),
]

/**
 * 两个名字的任一形式相等，或较短的一方被另一方包含且至少占其 60%（「陈小满」与
 * 「陈小满阿」算对上，「Lin」与「Linkin Park」不算；单个字符永远够不到 60%）。
 */
const similar = (left, right) =>
  forms(left).some((a) =>
    forms(right).some((b) => {
      if (a === b) return true
      const [short, long] = a.length < b.length ? [a, b] : [b, a]
      return short.length >= long.length * 0.6 && long.includes(short)
    })
  )

/** 歌手名与网易云给出的别名：单曲歌手有 alias／alia／tns，专辑歌手有 alias／trans。 */
const artistNames = (artists) =>
  (Array.isArray(artists) ? artists : []).flatMap((artist) =>
    isObject(artist)
      ? [
          artist.name,
          artist.alias,
          artist.alia,
          artist.tns,
          artist.trans,
        ].flat()
      : []
  )

/** 网易云图片域名的 https 地址，去掉原有参数；其它来源一律不接受。 */
const picture = (value) => {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    if (
      !['http:', 'https:'].includes(url.protocol) ||
      !/^p\d+\.music\.126\.net$/.test(url.hostname) ||
      url.username ||
      url.password
    )
      return null
    url.protocol = 'https:'
    url.search = ''
    url.hash = ''
    return url
  } catch {
    return null
  }
}

/** 网易云图片按 `param=NyN` 取指定边长的缩略图；边长由调用方决定。 */
export const neteaseSized = (url, size) => {
  const copy = new URL(url)
  copy.search = `param=${size}y${size}`
  return copy.href
}

const candidatesOf = (kind, result) => {
  if (kind === 'song')
    return (Array.isArray(result?.songs) ? result.songs : [])
      .filter(isObject)
      .map((song) => ({
        name: song.name,
        artists: song.ar,
        picUrl: song.al?.picUrl,
      }))
  return (Array.isArray(result?.albums) ? result.albums : [])
    .filter(isObject)
    .map((album) => ({
      name: album.name,
      artists: [album.artist].concat(album.artists),
      picUrl: album.picUrl,
    }))
}

/**
 * 建立一个带缓存的查找函数。返回的函数接收 `{ kind: 'song' | 'album', name, artist }`，
 * 解析为去掉参数的 https 图片地址（尺寸用 `neteaseSized` 另取）或 null，从不 reject。
 */
export function createNeteaseCoverFinder({
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  const cache = new Map()

  const search = async (kind, name, artist) => {
    const url = new URL(SEARCH_URL)
    url.search = new URLSearchParams({
      // 括号注记会把结果带偏（「0.5x (零点五倍速)」搜不到「0.5x」），搜索只用原名主干。
      s: `${bareName(name) || name} ${artist}`,
      type: TYPES[kind],
      limit: CANDIDATES,
    }).toString()
    let data
    try {
      const response = await fetchImpl(url, {
        headers: {
          'referer': 'https://music.163.com/',
          'user-agent': 'Mozilla/5.0 (compatible; YuBlog listening)',
        },
        signal: AbortSignal.timeout(TIMEOUT),
      })
      if (!response.ok) return { found: null, final: false }
      data = await response.json()
    } catch {
      return { found: null, final: false }
    }
    if (!isObject(data) || data.code !== 200)
      return { found: null, final: false }
    for (const candidate of candidatesOf(kind, data.result)) {
      const image = picture(candidate.picUrl)
      if (
        image &&
        similar(candidate.name, name) &&
        artistNames(candidate.artists).some((alias) =>
          artistParts(artist).some((part) => similar(alias, part))
        )
      )
        return {
          found: image.href,
          final: true,
        }
    }
    return { found: null, final: true }
  }

  return function findCover({ kind, name, artist }) {
    if (
      !Object.hasOwn(TYPES, kind) ||
      !forms(name).length ||
      !forms(artist).length
    )
      return Promise.resolve(null)
    const key = JSON.stringify([kind, fold(name), fold(artist)])
    const cached = cache.get(key)
    if (cached && cached.expires > now()) return cached.value
    cache.delete(key)
    const entry = { expires: Infinity, value: null }
    entry.value = search(kind, name, artist)
      .catch(() => ({ found: null, final: false }))
      .then(({ found, final }) => {
        entry.expires = now() + (final ? TTL : FAILURE_TTL)
        return found
      })
    // 进行中的查询也放进缓存，同一首歌的并发请求只查一次；有结果后才开始计时。
    cache.set(key, entry)
    while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value)
    return entry.value
  }
}

/** 函数实例内共享的查找器；冷启动时缓存为空。 */
export const findNeteaseCover = createNeteaseCoverFinder()
