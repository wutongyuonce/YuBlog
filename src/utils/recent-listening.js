/**
 * 首页听歌区块的唯一属主：接口响应的校验、统计文案与卡片渲染。
 *
 * 服务端输出加载态骨架卡和一张卡片模板，数据来自运行时接口，所以响应形状属于信任边界
 * 之外：先校验再写 DOM，并且不使用 `innerHTML`，避免把上游字段当标记插入页面。
 * `renderListening` 先插入真实卡片并提交布局，再移除骨架，避免页尾滚动位置被截断。
 */

/** 卡片区最多呈现十张，避免异常响应撑破布局；顺序由适配器决定。 */
const MAX_TRACKS = 10

const isRecord = (value) =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const nonEmptyText = (value) =>
  typeof value === 'string' && value.trim() ? value.trim() : null

const httpsUrl = (value) => {
  if (typeof value !== 'string') return null
  try {
    const url = new URL(value)
    return url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}

const safeCount = (value) =>
  Number.isSafeInteger(value) && value >= 0 ? value : null

/**
 * 把接口响应收成页面需要的最小形状。任何一个字段不合规都返回 null，由调用方按
 * 加载失败处理，而不是补默认值或只丢掉出问题的那一首。
 */
export function parseListeningPayload(value) {
  if (!isRecord(value)) return null
  const updatedAt = nonEmptyText(value.updatedAt)
  if (!updatedAt || Number.isNaN(Date.parse(updatedAt))) return null
  const weeklyScrobbles = safeCount(value.weeklyScrobbles)
  const totalScrobbles = safeCount(value.totalScrobbles)
  if (weeklyScrobbles === null || totalScrobbles === null) return null
  if (!Array.isArray(value.tracks)) return null
  const tracks = []
  for (const track of value.tracks.slice(0, MAX_TRACKS)) {
    if (!isRecord(track)) return null
    const name = nonEmptyText(track.name)
    const artist = nonEmptyText(track.artist)
    const url = httpsUrl(track.url)
    const playcount = safeCount(track.playcount)
    if (!name || !artist || !url || playcount === null) return null
    tracks.push({
      name,
      artist,
      album: nonEmptyText(track.album),
      cover: httpsUrl(track.cover),
      fullCover: httpsUrl(track.fullCover),
      url,
      playcount,
    })
  }
  return {
    updatedAt,
    weeklyScrobbles,
    totalScrobbles,
    topArtist: nonEmptyText(value.topArtist),
    tracks,
  }
}

/**
 * 正在播放接口的最小形状。歌名、歌手、链接不合规或非播放状态缺播放时间时返回 null；
 * 账户没有任何记录时 `track` 为 null。
 */
export function parseNowPlayingPayload(value) {
  if (!isRecord(value) || typeof value.playing !== 'boolean') return null
  if (value.track === null)
    return { playing: false, playedAt: null, track: null }
  if (!isRecord(value.track)) return null
  const name = nonEmptyText(value.track.name)
  const artist = nonEmptyText(value.track.artist)
  const url = httpsUrl(value.track.url)
  if (!name || !artist || !url) return null
  let playedAt = null
  if (!value.playing) {
    playedAt = nonEmptyText(value.playedAt)
    if (!playedAt || Number.isNaN(Date.parse(playedAt))) return null
  }
  return {
    playing: value.playing,
    playedAt,
    track: {
      name,
      artist,
      album: nonEmptyText(value.track.album),
      cover: httpsUrl(value.track.cover),
      url,
    },
  }
}

/** 「刚刚／N 分钟前／N 小时前／N 天前」，未来时间按刚刚。 */
export function playedAgoLabel(playedAt, now = new Date()) {
  const minutes = Math.floor((now.getTime() - Date.parse(playedAt)) / 60_000)
  if (minutes < 1) return '刚刚'
  if (minutes < 60) return `${minutes} 分钟前`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours} 小时前`
  return `${Math.floor(hours / 24)} 天前`
}

/**
 * 写入正在播放卡片；`data` 为 null 表示加载失败。首次失败或没有记录时整张收起，
 * 已有内容后的轮询失败保留上一次结果，避免卡片闪没、下方排行跳动。
 */
export function renderNowPlaying(card, data, now = new Date()) {
  if (!data && ['playing', 'recent'].includes(card.dataset.state)) return
  card.setAttribute('aria-busy', 'false')
  if (!data?.track) {
    card.dataset.state = data ? 'empty' : 'error'
    card.hidden = true
    return
  }
  const { track } = data
  card.hidden = false
  card.dataset.state = data.playing ? 'playing' : 'recent'
  const pick = (name) => card.querySelector(`[data-np-${name}]`)
  pick('status').textContent = data.playing
    ? '正在播放'
    : `最近播放 · ${playedAgoLabel(data.playedAt, now)}`
  const title = pick('title')
  title.textContent = track.name
  title.title = track.name
  title.href = track.url
  pick('artist').textContent = track.artist
  const album = pick('album')
  album.textContent = track.album ?? ''
  album.hidden = !track.album
  const cover = pick('cover')
  const ambient = pick('ambient')
  for (const img of [cover, ambient]) {
    if (track.cover) img.src = track.cover
    else img.removeAttribute('src')
  }
  cover.alt = track.album ? `${track.album} 专辑封面` : ''
  card.toggleAttribute('data-no-cover', !track.cover)
}

const numbers = new Intl.NumberFormat('zh-CN')
const dateTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** 统计行的三个值，顺序与骨架里的 `[data-listening-stat]` 一致。 */
export const listeningStats = (snapshot) => [
  numbers.format(snapshot.weeklyScrobbles),
  numbers.format(snapshot.totalScrobbles),
  snapshot.topArtist ?? '暂无',
]

/** 快照时间按北京时间呈现。 */
export const listeningUpdatedLabel = (updatedAt) =>
  dateTime.format(new Date(updatedAt))

const messageOf = (state) => {
  if (state === 'empty') return '过去 7 天还没有听歌记录。'
  if (state === 'error') return '暂时无法获取听歌数据。'
  return ''
}

function createCard(track, template) {
  const card = template.content.firstElementChild.cloneNode(true)
  const album = track.album ?? '专辑信息暂缺'
  const description = `${track.artist} - ${album}`
  const view = card.querySelector('.image-view')
  view.title = album
  const cover = card.querySelector('.media-card__cover')
  if (track.cover) {
    cover.src = track.cover
    cover.alt = `${description} 专辑封面`
  } else {
    const placeholder = card.ownerDocument.createElement('span')
    placeholder.className = 'recent-listening__placeholder'
    placeholder.setAttribute('aria-hidden', 'true')
    placeholder.textContent = '♪'
    cover.replaceWith(placeholder)
  }
  const source = card.querySelector('template')
  if (source) {
    if (track.fullCover)
      source.content.querySelector('img').src = track.fullCover
    else source.remove()
  }
  const title = card.querySelector('.media-card__title')
  title.textContent = track.name
  title.title = track.name
  title.href = track.url
  card.querySelector('.media-card__meta').textContent = description
  return card
}

/**
 * 把快照写进区块并结束加载状态；`snapshot` 为 null 表示这次加载失败。
 */
export function renderListening(root, snapshot) {
  const state = snapshot
    ? snapshot.tracks.length
      ? 'ready'
      : 'empty'
    : 'error'
  const values = snapshot ? listeningStats(snapshot) : null
  for (const [index, node] of [
    ...root.querySelectorAll('[data-listening-stat]'),
  ].entries()) {
    node.textContent = values ? values[index] : '—'
    node.title = node.textContent
  }

  const track = root.querySelector('[data-listening-track]')
  const template = root.querySelector('template[data-listening-card]')
  const cards =
    snapshot?.tracks.length && track && template
      ? snapshot.tracks.map((item) => createCard(item, template))
      : []
  // 先插入新卡片并提交布局，再移除骨架。WebKit 尚未布局新节点时就移除旧节点，
  // 会把滚到底部的位置向上截断，即使替换前后的轨道高度相同。
  if (cards.length && track) {
    const skeletons = [...track.children]
    track.append(...cards)
    void track.offsetHeight
    for (const node of skeletons) node.remove()
  } else track?.replaceChildren()

  const time = root.querySelector('[data-listening-time]')
  if (time) {
    if (snapshot) {
      time.dateTime = snapshot.updatedAt
      time.textContent = listeningUpdatedLabel(snapshot.updatedAt)
    } else {
      time.removeAttribute('datetime')
      time.textContent = '—'
    }
  }

  const message = root.querySelector('[data-listening-message]')
  if (message) {
    const text = messageOf(state)
    message.textContent = text
    message.toggleAttribute('hidden', !text)
  }
  root.dataset.state = state
  root.setAttribute('aria-busy', 'false')
}
