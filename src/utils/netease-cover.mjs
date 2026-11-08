/**
 * 网易云封面回退的唯一属主：搜索、结果核对、图片地址与实例内缓存。
 *
 * 只在服务端运行。Last.fm 给不出可用封面时，按「名称 + 歌手」搜索网易云，只接受
 * 名称与歌手都对得上的结果，宁可没有封面也不配错图。这是尽力而为的补充：超时、
 * 网络错误或异常响应都只返回 null，不让听歌接口失败；失败只短暂缓存。
 */

import { Converter } from 'opencc-js/t2cn'

const SEARCH_URL = 'https://music.163.com/api/cloudsearch/pc'
const TYPES = { song: '1', album: '10', artist: '100' }
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

/** 繁体统一转成简体：Last.fm 记录常是繁体（「少一點天份」），网易云多是简体。 */
const simplified = Converter({ from: 't', to: 'cn' })

/** 统一繁简、大小写、全半角，去掉空白、标点与符号。 */
const fold = (value) =>
  simplified(value.normalize('NFKC'))
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
  artists.flatMap((artist) =>
    [artist.name, artist.alias, artist.alia, artist.tns, artist.trans].flat()
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
    return url.href
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

/** 把三种搜索结果收成同一形状：名称、歌手列表（含 id 与别名）和封面；没有名称的记录不要。 */
const candidatesOf = (kind, result) => {
  const records =
    kind === 'song'
      ? result?.songs
      : kind === 'album'
        ? result?.albums
        : result?.artists
  return (Array.isArray(records) ? records : [])
    .filter((record) => isObject(record) && typeof record.name === 'string')
    .map((record) => {
      const artists =
        kind === 'song'
          ? record.ar
          : kind === 'album'
            ? [record.artist].concat(record.artists)
            : [record]
      return {
        name: record.name,
        artists: (Array.isArray(artists) ? artists : []).filter(isObject),
        image: picture(kind === 'song' ? record.al?.picUrl : record.picUrl),
      }
    })
}

/**
 * 建立一个带缓存的查找函数。返回的函数接收 `{ kind: 'song' | 'album', name, artist }`，
 * 解析为去掉参数的 https 图片地址（尺寸用 `neteaseSized` 另取）或 null，从不 reject。
 *
 * 先搜「名称 + 歌手」，名称与歌手都相近才采用。没有对上时只按名称再搜一次，这一轮
 * 要求名称完全相等；歌手仍按名称与别名比对，比不上时再看网易云搜这个歌手名排第一
 * 的是不是同一位（「Shi Shi」→「孙盛希」这类没有别名的情况）。
 */
export function createNeteaseCoverFinder({
  fetchImpl = fetch,
  now = Date.now,
} = {}) {
  const cache = new Map()

  /** 同一个键在有效期内只查一次；进行中的查询也共享，有结果后才开始计时。 */
  const cached = (key, load) => {
    const hit = cache.get(key)
    if (hit && hit.expires > now()) return hit.value
    cache.delete(key)
    const entry = { expires: Infinity, value: null }
    entry.value = load()
      .catch(() => ({ value: null, final: false }))
      .then(({ value, final }) => {
        entry.expires = now() + (final ? TTL : FAILURE_TTL)
        return value
      })
    cache.set(key, entry)
    while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value)
    return entry.value
  }

  /** 一次搜索；超时、网络错误或异常响应返回 null。 */
  const search = async (kind, query) => {
    const url = new URL(SEARCH_URL)
    url.search = new URLSearchParams({
      s: query,
      type: TYPES[kind],
      limit: CANDIDATES,
    }).toString()
    try {
      const response = await fetchImpl(url, {
        headers: {
          'referer': 'https://music.163.com/',
          'user-agent': 'Mozilla/5.0 (compatible; YuBlog listening)',
        },
        signal: AbortSignal.timeout(TIMEOUT),
      })
      if (!response.ok) return null
      const data = await response.json()
      return isObject(data) && data.code === 200
        ? candidatesOf(kind, data.result)
        : null
    } catch {
      return null
    }
  }

  /** 网易云搜这个歌手名时排第一的歌手 id；搜不到为 null，搜索失败为 undefined。 */
  const topArtist = (artist) =>
    cached(JSON.stringify(['artist', fold(artist)]), async () => {
      const found = await search('artist', artist)
      return found
        ? { value: found[0]?.artists[0]?.id ?? null, final: true }
        : { value: undefined, final: false }
    })

  const lookup = async (kind, name, artist) => {
    // 括号注记会把结果带偏（「0.5x (零点五倍速)」搜不到「0.5x」），搜索只用原名主干。
    const title = bareName(name) || name
    const artistMatches = (candidate) =>
      artistNames(candidate.artists).some((alias) =>
        artistParts(artist).some((part) => similar(alias, part))
      )
    const first = await search(kind, `${title} ${artist}`)
    if (!first) return { value: null, final: false }
    const hit = first.find(
      (candidate) =>
        candidate.image &&
        similar(candidate.name, name) &&
        artistMatches(candidate)
    )
    if (hit) return { value: hit.image, final: true }

    // 带歌手搜不到时（歌手在网易云上换了写法），只按名称再搜一次；候选的完整名称
    // 必须等于原名或其主干，「X (Remix)」不算「X」。
    const second = await search(kind, title)
    if (!second) return { value: null, final: false }
    const exact = second.filter(
      (candidate) =>
        candidate.image && forms(name).includes(fold(candidate.name))
    )
    const named = exact.find(artistMatches)
    if (named) return { value: named.image, final: true }
    if (!exact.length) return { value: null, final: true }
    const id = await topArtist(artist)
    if (id === undefined) return { value: null, final: false }
    const identified =
      id == null
        ? null
        : exact.find((candidate) =>
            candidate.artists.some((entry) => entry.id === id)
          )
    return { value: identified?.image ?? null, final: true }
  }

  return function findCover({ kind, name, artist }) {
    if (
      !['song', 'album'].includes(kind) ||
      !forms(name).length ||
      !forms(artist).length
    )
      return Promise.resolve(null)
    return cached(JSON.stringify([kind, fold(name), fold(artist)]), () =>
      lookup(kind, name, artist)
    )
  }
}

/** 函数实例内共享的查找器；冷启动时缓存为空。 */
export const findNeteaseCover = createNeteaseCoverFinder()
