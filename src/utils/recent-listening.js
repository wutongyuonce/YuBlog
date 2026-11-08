/**
 * 首页听歌区块的唯一属主：接口响应的校验、时段文案与 DOM 渲染。
 *
 * 服务端只输出骨架和固定的壳层（时段按钮、统计位），数据来自运行时接口，所以响应
 * 形状属于信任边界之外：先校验再写 DOM，并且不使用 `innerHTML`，避免把上游字段当
 * 标记插入页面。
 */

/** 封面墙时段的唯一定义：键即 Last.fm period，顺序即请求、响应与按钮顺序；`span` 用于文案。 */
export const PERIODS = {
  '7day': { short: '7d', span: '7 天' },
  '1month': { short: '30d', span: '30 天' },
  '12month': { short: '1y', span: '1 年' },
  'overall': { short: 'all', span: '全部' },
}
export const DEFAULT_PERIOD = '1month'
/** 封面墙张数（#1 占 2×2，其余八张）；适配器按它请求，页面按它截断与画骨架。 */
export const COLLAGE_SIZE = 9
/** 正在播放一首加最近五首；同样由适配器请求、页面截断。 */
export const RECENT_SIZE = 6

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

const validTime = (value) => {
  const time = nonEmptyText(value)
  return time && !Number.isNaN(Date.parse(time)) ? time : null
}

/**
 * 封面墙快照的最小形状。必须恰好包含四个时段且顺序一致；名称、歌手、链接、计数或
 * 时间不合规都返回 null，由调用方按加载失败处理。封面不合规只当作缺图。
 */
export function parseListeningPayload(value) {
  if (!isRecord(value)) return null
  const updatedAt = validTime(value.updatedAt)
  const totalScrobbles = safeCount(value.totalScrobbles)
  const keys = Object.keys(PERIODS)
  if (
    !updatedAt ||
    totalScrobbles === null ||
    !Array.isArray(value.periods) ||
    value.periods.length !== keys.length
  )
    return null
  const periods = []
  for (const [index, period] of value.periods.entries()) {
    if (!isRecord(period) || period.key !== keys[index]) return null
    const albumTotal = safeCount(period.albumTotal)
    if (albumTotal === null || !Array.isArray(period.albums)) return null
    const albums = []
    for (const album of period.albums.slice(0, COLLAGE_SIZE)) {
      if (!isRecord(album)) return null
      const name = nonEmptyText(album.name)
      const artist = nonEmptyText(album.artist)
      const url = httpsUrl(album.url)
      const playcount = safeCount(album.playcount)
      if (!name || !artist || !url || playcount === null) return null
      const cover = httpsUrl(album.cover)
      albums.push({
        name,
        artist,
        url,
        playcount,
        cover,
        coverLarge: cover && (httpsUrl(album.coverLarge) ?? cover),
      })
    }
    periods.push({ key: period.key, albumTotal, albums })
  }
  return { updatedAt, totalScrobbles, periods }
}

/**
 * 正在播放与最近播放的最小形状。`playing` 为真时第一首没有播放时间，其余每首都必须
 * 有可解析的时间；任一首不合规整份按失败处理。账户没有记录时 `tracks` 为空数组。
 */
export function parseNowPlayingPayload(value) {
  if (
    !isRecord(value) ||
    typeof value.playing !== 'boolean' ||
    !Array.isArray(value.tracks) ||
    (value.playing && !value.tracks.length)
  )
    return null
  const tracks = []
  for (const [index, track] of value.tracks.slice(0, RECENT_SIZE).entries()) {
    if (!isRecord(track)) return null
    const name = nonEmptyText(track.name)
    const artist = nonEmptyText(track.artist)
    const url = httpsUrl(track.url)
    const live = value.playing && index === 0
    const playedAt = live ? null : validTime(track.playedAt)
    if (!name || !artist || !url || (live ? track.playedAt != null : !playedAt))
      return null
    tracks.push({
      name,
      artist,
      album: nonEmptyText(track.album),
      cover: httpsUrl(track.cover),
      url,
      playedAt,
    })
  }
  return { playing: value.playing, tracks }
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

const numbers = new Intl.NumberFormat('zh-CN')
const dateTime = new Intl.DateTimeFormat('zh-CN', {
  timeZone: 'Asia/Shanghai',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hour12: false,
})

/** 快照时间按北京时间呈现。 */
export const listeningUpdatedLabel = (updatedAt) =>
  dateTime.format(new Date(updatedAt))

/** 小元素工厂：只写文本与属性，不解析标记。 */
const element = (doc, tag, className, text) => {
  const node = doc.createElement(tag)
  if (className) node.className = className
  if (text != null) node.textContent = text
  return node
}

const coverImage = (doc, src, size) => {
  const img = element(doc, 'img')
  img.src = src
  img.alt = ''
  img.setAttribute('width', String(size))
  img.setAttribute('height', String(size))
  img.setAttribute('loading', 'lazy')
  img.setAttribute('decoding', 'async')
  return img
}

const externalLink = (doc, className, href) => {
  const link = element(doc, 'a', className)
  link.href = href
  link.setAttribute('target', '_blank')
  link.setAttribute('rel', 'noopener noreferrer')
  return link
}

/**
 * 先插入新节点并提交布局，再移除旧节点。WebKit 尚未布局新节点时就移除旧节点，会把
 * 滚到底部的位置向上截断，即使替换前后的容器高度相同。
 */
function swapChildren(container, nodes) {
  if (!nodes.length) return container.replaceChildren()
  const old = [...container.childNodes]
  container.append(...nodes)
  void container.offsetHeight
  for (const node of old) node.remove()
}

function createRecentRow(doc, track, now) {
  const row = element(doc, 'li', 'recent-tracks__item')
  const cover = element(doc, 'span', 'recent-tracks__cover')
  if (track.cover) cover.append(coverImage(doc, track.cover, 56))
  else {
    cover.setAttribute('aria-hidden', 'true')
    cover.textContent = '♪'
  }
  const copy = element(doc, 'span', 'recent-tracks__text')
  const title = externalLink(doc, 'recent-tracks__title', track.url)
  title.textContent = track.name
  copy.append(
    title,
    element(doc, 'span', 'recent-tracks__artist', track.artist)
  )
  copy.title = `${track.name} — ${track.artist}`
  const leader = element(doc, 'span', 'recent-tracks__leader')
  leader.setAttribute('aria-hidden', 'true')
  const time = element(
    doc,
    'time',
    'recent-tracks__time',
    playedAgoLabel(track.playedAt, now)
  )
  time.dateTime = track.playedAt
  row.append(cover, copy, leader, time)
  return row
}

/**
 * 写入正在播放卡片与最近播放列表；`data` 为 null 表示加载失败。首次失败或没有记录时
 * 整块收起，已有内容后的轮询失败保留上一次结果，避免卡片闪没、下方封面墙跳动。
 */
export function renderNowPlaying(block, data, now = new Date()) {
  if (!data && ['playing', 'recent'].includes(block.dataset.state)) return
  block.setAttribute('aria-busy', 'false')
  if (!data?.tracks.length) {
    block.dataset.state = data ? 'empty' : 'error'
    block.hidden = true
    return
  }
  const [track, ...rest] = data.tracks
  block.hidden = false
  block.dataset.state = data.playing ? 'playing' : 'recent'
  const pick = (name) => block.querySelector(`[data-np-${name}]`)
  pick('status').textContent = data.playing
    ? '正在播放'
    : `最近播放 · ${playedAgoLabel(track.playedAt, now)}`
  const title = pick('title')
  title.textContent = track.name
  title.title = track.name
  title.href = track.url
  pick('artist').textContent = track.artist
  const album = pick('album')
  album.textContent = track.album ?? ''
  album.hidden = !track.album
  for (const img of [pick('cover'), pick('ambient')]) {
    if (track.cover) img.src = track.cover
    else img.removeAttribute('src')
  }
  pick('cover').alt = track.album ? `${track.album} 专辑封面` : ''
  block.toggleAttribute('data-no-cover', !track.cover)

  const list = pick('list')
  const doc = block.ownerDocument
  swapChildren(
    list,
    rest.map((item) => createRecentRow(doc, item, now))
  )
  list.hidden = !rest.length
  block.toggleAttribute('data-solo', !rest.length)
}

function createTile(doc, album, rank, period) {
  const lead = rank === 1
  const tile = externalLink(
    doc,
    lead ? 'collage__tile collage__tile--lead' : 'collage__tile',
    album.url
  )
  tile.setAttribute(
    'aria-label',
    `第 ${rank}：${album.name} — ${album.artist}，${album.playcount} 次播放`
  )
  tile.toggleAttribute('data-no-cover', !album.cover)
  if (album.cover)
    tile.append(
      coverImage(doc, lead ? album.coverLarge : album.cover, lead ? 600 : 300)
    )
  const info = element(doc, 'span', 'collage__info')
  info.setAttribute('aria-hidden', 'true')
  info.append(
    element(
      doc,
      'span',
      'collage__kicker',
      lead
        ? `#1 · ${PERIODS[period].span}`
        : `#${rank} · ${numbers.format(album.playcount)} 次`
    ),
    element(doc, 'span', 'collage__name', album.name),
    element(doc, 'span', 'collage__artist', album.artist)
  )
  tile.append(info)
  if (lead) {
    const plays = element(doc, 'span', 'collage__count')
    plays.setAttribute('aria-hidden', 'true')
    plays.append(
      element(doc, 'strong', '', numbers.format(album.playcount)),
      element(doc, 'span', '', '次播放')
    )
    tile.append(plays)
  } else {
    for (const [className, text] of [
      ['collage__rank', String(rank)],
      ['collage__plays', numbers.format(album.playcount)],
    ]) {
      const badge = element(doc, 'span', className, text)
      badge.setAttribute('aria-hidden', 'true')
      tile.append(badge)
    }
  }
  return tile
}

/** 「30 天里听了 27 张专辑 · 这 9 张共 56 次」。 */
function summaryNodes(doc, period, albums, albumTotal) {
  const plays = albums.reduce((sum, album) => sum + album.playcount, 0)
  const lead = period === 'overall' ? '一共' : `${PERIODS[period].span}里`
  return [
    `${lead}听了 `,
    element(doc, 'strong', '', numbers.format(albumTotal)),
    ' 张专辑',
    element(doc, 'span', 'collage__dot', ' · '),
    `这 ${albums.length} 张共 `,
    element(doc, 'strong', '', numbers.format(plays)),
    ' 次',
  ]
}

const messageOf = (state, period) => {
  if (state === 'empty') return '还没有听歌记录。'
  if (state === 'error') return '暂时无法获取听歌数据。'
  if (state === 'period-empty')
    return `${PERIODS[period].span}里还没有听歌记录。`
  return ''
}

/**
 * 把快照的某个时段写进封面墙并结束加载状态；`snapshot` 为 null 表示这次加载失败。
 * 切换时段时以同一份快照再调用一次。
 */
export function renderListening(root, snapshot, period = DEFAULT_PERIOD) {
  const doc = root.ownerDocument
  const current = snapshot?.periods.find((item) => item.key === period)
  let state = 'error'
  if (snapshot)
    state = snapshot.periods.every((item) => !item.albums.length)
      ? 'empty'
      : current.albums.length
        ? 'ready'
        : 'period-empty'

  // 时段按钮在骨架里是禁用的；只有拿到快照后才能切换。
  for (const button of root.querySelectorAll('[data-listening-period]')) {
    button.disabled = !snapshot
    button.setAttribute(
      'aria-pressed',
      String(button.dataset.listeningPeriod === period)
    )
  }
  const total = root.querySelector('[data-listening-total]')
  if (total)
    total.textContent = snapshot ? numbers.format(snapshot.totalScrobbles) : '—'

  const grid = root.querySelector('[data-listening-grid]')
  if (grid) {
    const tiles =
      state === 'ready'
        ? current.albums.map((album, index) =>
            createTile(doc, album, index + 1, period)
          )
        : []
    swapChildren(grid, tiles)
  }

  const summary = root.querySelector('[data-listening-summary]')
  if (summary)
    summary.replaceChildren(
      ...(state === 'ready'
        ? summaryNodes(doc, period, current.albums, current.albumTotal)
        : [])
    )
  const time = root.querySelector('[data-listening-time]')
  if (time) {
    if (snapshot) {
      time.dateTime = snapshot.updatedAt
      time.textContent = `更新于 ${listeningUpdatedLabel(snapshot.updatedAt)}`
    } else {
      time.removeAttribute('datetime')
      time.textContent = ''
    }
  }
  const message = root.querySelector('[data-listening-message]')
  if (message) {
    const text = messageOf(state, period)
    message.textContent = text
    message.hidden = !text
  }
  root.dataset.state = state
  root.dataset.period = period
  root.setAttribute('aria-busy', 'false')
}
