/**
 * 旅行页的页面脚本：地址片段与选中、年份筛选、详情滚动联动地图、回放卡片、
 * 照片对话框、地图设置和页面生命周期。地图在 `trip-map.ts`，回放在 `trip-replay.ts`，
 * 展示规则在 `trips.js`；这里只调度 DOM 与它们之间的状态。
 */
import type { PaddingOptions } from 'maplibre-gl'

import { entryHash } from './calendar.js'
import { bindPhotoViewer } from './photo-viewer'
import { observeTheme } from './theme-observer.js'
import { createTripMap, type MapData, type TripMap } from './trip-map'
import {
  DEFAULT_MAP_SETTINGS,
  MAP_SETTINGS_KEY,
  parseMapSettings,
} from './trip-map-settings.js'
import { createReplay, PHOTO_MS, SPEEDS, type Replay } from './trip-replay'
import {
  STATUS_LABELS,
  findBetweenMarks,
  getReadingOffset,
  todayInTripZone,
  tripStatus,
} from './trips.js'

const NARROW = '(max-width: 48rem)'
/** 竖屏时回放卡片最多直接排开的照片数；横屏是九宫格。 */
const PORTRAIT = '(orientation: portrait)'
const SPEED_KEY = 'trips-replay-speed'
const READING_LINE_SHARE = 0.38

// 详情里的文字带模板缩进，合并成单个空格。
const text = (node: Node | null | undefined) =>
  node?.textContent?.replace(/\s+/g, ' ').trim() ?? ''

export function mountTripsPage(page: HTMLElement, signal: AbortSignal) {
  const $ = <T extends Element>(selector: string) =>
    page.querySelector<T>(selector)!
  const panel = $<HTMLElement>('[data-trips-panel]')
  const scroller = $<HTMLElement>('[data-trips-scroll]')
  const message = $<HTMLElement>('[data-trips-message]')
  const fitButton = $<HTMLButtonElement>('[data-trips-fit]')
  const toggle = $<HTMLButtonElement>('[data-trips-panel-toggle]')
  const replayCard = $<HTMLElement>('[data-trips-replay]')
  const progressBox = page.querySelector<HTMLElement>('[data-replay-progress]')
  const mediaBox = $<HTMLElement>('[data-replay-media]')
  const speedButton = $<HTMLButtonElement>('[data-replay-speed]')
  const settingsToggle = $<HTMLButtonElement>('[data-trips-settings-toggle]')
  const settingsPanel = $<HTMLElement>('[data-trips-settings]')
  const yearButtons = [
    ...page.querySelectorAll<HTMLButtonElement>('[data-trips-year]'),
  ]
  const narrow = matchMedia(NARROW)
  const portrait = matchMedia(PORTRAIT)
  const viewer = bindPhotoViewer(page, signal)
  let tripMap: TripMap | undefined
  let replay: Replay | undefined
  /** 每次开始或停止回放都会递增，用来作废还在创建中的旧回放。 */
  let replayRun = 0
  /** 当前地址片段对应的详情：旅程 id 或 `calendar/<id>`。 */
  let current: string | undefined
  let selected: string | undefined
  let selectedEntry: string | undefined
  let activeStop: number | undefined
  let focusedDay: number | undefined
  let year: number | undefined

  // 状态按访问当天重算，构建日期只是无 JS 时的初值。
  const today = todayInTripZone()
  for (const badge of page.querySelectorAll<HTMLElement>(
    '[data-trip-status]'
  )) {
    const status = tripStatus(badge.dataset.tripEnd!, today)
    badge.dataset.tripStatus = status
    badge.textContent = STATUS_LABELS[status]
  }

  function showMessage(value: string) {
    message.textContent = value
    message.hidden = false
    page.dataset.tripsMapFailed = ''
    for (const button of page.querySelectorAll<HTMLButtonElement>(
      '[data-trip-replay]'
    ))
      button.disabled = true
  }

  const collapsed = () => page.hasAttribute('data-trips-collapsed')
  const replaying = () => page.hasAttribute('data-trips-replaying')

  function getPadding(): PaddingOptions {
    // 留出比标记更宽的边距，边缘上的点不会被切掉一半；对卡片和面板尺寸做上限保护。
    const gap = 56
    const base = { top: 88, right: gap, bottom: 80, left: gap }
    if (replaying()) {
      const rect = replayCard.getBoundingClientRect()
      return narrow.matches
        ? {
            ...base,
            bottom: Math.min(
              Math.round(innerHeight * 0.45),
              Math.round(rect.height + 36)
            ),
          }
        : {
            ...base,
            left: Math.min(
              Math.round(innerWidth * 0.42),
              Math.round(rect.right + 36)
            ),
          }
    }
    if (collapsed()) return base
    const rect = panel.getBoundingClientRect()
    return narrow.matches
      ? {
          ...base,
          bottom: Math.min(
            Math.round(innerHeight * 0.48),
            Math.max(base.bottom, Math.round(innerHeight - rect.top + gap))
          ),
        }
      : {
          ...base,
          right: Math.min(
            Math.round(innerWidth * 0.45),
            Math.max(base.right, Math.round(innerWidth - rect.left + gap))
          ),
        }
  }

  function setCollapsed(next: boolean) {
    page.toggleAttribute('data-trips-collapsed', next)
    toggle.setAttribute('aria-expanded', String(!next))
    const label = next ? '展开旅程面板' : '收起旅程面板'
    toggle.setAttribute('aria-label', label)
    toggle.title = label
  }

  function detail(id: string | undefined) {
    return id
      ? page.querySelector<HTMLElement>(
          `[data-trip-detail="${CSS.escape(id)}"]`
        )
      : null
  }

  /** 片段对应的详情区块：旅程或日历记录。 */
  function sectionFor(hash: string) {
    const element = hash ? document.getElementById(hash) : null
    return element &&
      page.contains(element) &&
      element.matches('[data-trip-detail], [data-entry-detail]')
      ? element
      : null
  }

  /** 地址片段是选中状态的唯一来源。 */
  function syncFromHash() {
    let hash = ''
    try {
      hash = decodeURIComponent(location.hash.slice(1))
    } catch {
      // 编码损坏的片段按总览处理。
    }
    const section = sectionFor(hash)
    const next = section ? hash : undefined
    if (next === current) return
    stopReplay()
    for (const item of page.querySelectorAll('.trip-stop[data-active]'))
      delete (item as HTMLElement).dataset.active
    for (const node of page.querySelectorAll<HTMLElement>(
      '[data-trip-detail], [data-entry-detail]'
    ))
      node.toggleAttribute('data-active', node === section)
    current = next
    selected = section?.dataset.tripDetail
    selectedEntry = section?.dataset.entryDetail
    activeStop = undefined
    focusedDay = undefined
    if (next && collapsed()) setCollapsed(false)
    scroller.scrollTop = 0
    if (selectedEntry) tripMap?.selectEntry(selectedEntry)
    else tripMap?.select(selected)
  }

  /**
   * 强调某站。`move` 决定镜头：`fly` 移到中央，`reveal` 出了视野才平移；
   * `scrollList` 时把列表里的条目滚进视野（滚动联动时不滚，免得和读者抢）。
   */
  function activateStop(
    index: number | undefined,
    move: 'fly' | 'reveal' | 'none',
    scrollList = false
  ) {
    activeStop = index
    for (const item of detail(selected)?.querySelectorAll<HTMLElement>(
      '.trip-stop'
    ) ?? []) {
      const active = Number(item.dataset.tripStop) === index
      item.toggleAttribute('data-active', active)
      if (active && scrollList)
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
    tripMap?.activateStop(index, move)
  }

  // —— 年份筛选：只看某一年，再点一次回到全部；写进 `?year=` ——
  function setYear(next: number | undefined) {
    year = next
    for (const button of yearButtons)
      button.setAttribute(
        'aria-pressed',
        String(Number(button.dataset.tripsYear) === year)
      )
    for (const group of page.querySelectorAll<HTMLElement>(
      '[data-trips-year-group]'
    ))
      group.hidden =
        year !== undefined && Number(group.dataset.tripsYearGroup) !== year
    const url = new URL(location.href)
    if (year === undefined) url.searchParams.delete('year')
    else url.searchParams.set('year', String(year))
    history.replaceState(history.state, '', url)
    tripMap?.setYear(year)
  }

  // —— 详情滚动联动地图（参考 hyoban.cc 的 trip-scroll）：最后一屏自动追平到底，确保最后一天与最后一站完整展示 ——
  let scrollFrame = 0
  function syncScroll() {
    const root = detail(selected)
    if (!root || replaying()) return
    const scrollerOrigin =
      scroller.getBoundingClientRect().top - scroller.scrollTop
    const stopNodes = [
      ...root.querySelectorAll<HTMLElement>('.trip-stop[data-trip-stop]'),
    ]
    const lastNode = stopNodes.at(-1)
    if (!lastNode) return

    const entries = stopNodes.map((node) => {
      const rect = node.getBoundingClientRect()
      const dayNode = node.closest<HTMLElement>('[data-trip-day]')
      return {
        stopIndex: Number(node.dataset.tripStop),
        day: Number(dayNode?.dataset.tripDay ?? 0),
        top: rect.top - scrollerOrigin,
        bottom: rect.bottom - scrollerOrigin,
      }
    })
    const firstDayNode = root.querySelector<HTMLElement>('[data-trip-day]')
    const firstDayTop = firstDayNode
      ? firstDayNode.getBoundingClientRect().top - scrollerOrigin
      : entries[0].top

    const readingLine = scroller.clientHeight * READING_LINE_SHARE
    const maxScroll = Math.max(0, scroller.scrollHeight - scroller.clientHeight)
    const offset = getReadingOffset({
      end: entries.at(-1)!.bottom,
      maxScroll,
      readingLine,
      scrollTop: scroller.scrollTop,
      viewport: scroller.clientHeight,
    })

    // 停在顶部封面和统计区时，看整段旅程。
    if (scroller.scrollTop <= 12 || offset < firstDayTop) {
      if (focusedDay !== undefined) {
        focusedDay = undefined
        tripMap?.focusDay(undefined)
      }
      if (activeStop !== undefined) activateStop(undefined, 'none')
      tripMap?.setScrollProgress(undefined)
      return
    }

    const last = entries.at(-1)!
    const marks = [...entries, { ...last, top: last.bottom }]
    let prevTop = -Infinity
    const offsets = marks.map((mark) => (prevTop = Math.max(prevTop, mark.top)))
    const { index, fraction } = findBetweenMarks(offsets, offset)
    if (index < 0) return

    const currentMark = entries[Math.min(index, entries.length - 1)]
    const day = currentMark.day
    const dayChanged = day !== focusedDay
    if (dayChanged) {
      focusedDay = day
      tripMap?.focusDay(day)
    }
    if (currentMark.stopIndex !== activeStop) {
      activateStop(currentMark.stopIndex, dayChanged ? 'none' : 'reveal')
    }
    tripMap?.setScrollProgress({
      stopIndex: currentMark.stopIndex,
      fraction,
    })
  }
  scroller.addEventListener(
    'scroll',
    () => {
      if (!selected) return
      cancelAnimationFrame(scrollFrame)
      scrollFrame = requestAnimationFrame(syncScroll)
    },
    { signal, passive: true }
  )

  // —— 回放卡片 ——
  const stopItem = (index: number) =>
    detail(selected)?.querySelector<HTMLElement>(`[data-trip-stop="${index}"]`)
  const photoLinks = (index: number) => [
    ...(stopItem(index)?.querySelectorAll<HTMLAnchorElement>('a[data-photo]') ??
      []),
  ]

  function setCard(fields: Record<string, string>) {
    for (const [name, value] of Object.entries(fields)) {
      const node = replayCard.querySelector<HTMLElement>(
        `[data-replay-${name}]`
      )!
      node.textContent = value
      node.hidden = !value
    }
  }

  function buildProgress(id: string) {
    if (!progressBox) return
    const trip = tripMap?.trip(id)
    if (!trip) return
    progressBox.replaceChildren(
      ...trip.stops.map((stop) => {
        const li = document.createElement('li')
        li.className = 'trips-replay__progress-item'
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'trips-replay__progress-btn'
        button.title = `第 ${stop.day + 1} 天 · ${stop.name}`
        button.setAttribute('aria-label', button.title)
        const bar = document.createElement('span')
        bar.className = 'trips-replay__progress-bar'
        const fill = document.createElement('span')
        fill.className = 'trips-replay__progress-fill'
        fill.dataset.progressFill = ''
        bar.append(fill)
        button.append(bar)
        button.addEventListener('click', () => replay?.seek(stop.index))
        li.append(button)
        return li
      })
    )
  }

  function renderProgress(activeIndex: number, ratio: number) {
    if (!progressBox) return
    for (const [i, item] of [...progressBox.children].entries()) {
      const fill = item.querySelector<HTMLElement>('[data-progress-fill]')
      if (!fill) continue
      const amount = i < activeIndex ? 1 : i > activeIndex ? 0 : ratio
      fill.style.transform = `scaleX(${amount})`
    }
  }

  let speed: number = SPEEDS[0]
  try {
    const saved = Number(localStorage.getItem(SPEED_KEY))
    if ((SPEEDS as readonly number[]).includes(saved)) speed = saved
  } catch {
    // 禁止本地存储时用 1x。
  }
  function renderSpeed() {
    speedButton.textContent = `${speed}x`
    speedButton.setAttribute('aria-label', `倍速 ${speed}x，点击切换`)
  }
  renderSpeed()

  /** 照片轮播：单张模式（横屏>9张、竖屏>3张）下每张停 `PHOTO_MS`（按倍速缩短），路上也继续。 */
  let media: { links: HTMLAnchorElement[]; index: number } = {
    links: [],
    index: 0,
  }
  let carousel = 0
  let playing = false
  function restartCarousel() {
    clearInterval(carousel)
    if (!playing || !mediaBox.classList.contains('is-single')) return
    carousel = window.setInterval(
      () => showPhoto((media.index + 1) % media.links.length),
      PHOTO_MS / speed
    )
  }

  function thumbnail(link: HTMLAnchorElement, sizes: string) {
    const source = link.querySelector('img')
    const image = document.createElement('img')
    image.alt = source?.alt ?? ''
    image.src = source?.currentSrc || source?.src || link.href
    if (source?.srcset) image.srcset = source.srcset
    image.sizes = sizes
    image.decoding = 'async'
    return image
  }

  function showPhoto(index: number) {
    media.index = index
    const main = mediaBox.querySelector<HTMLImageElement>(
      '.trips-replay__main img'
    )
    if (main) {
      const link = media.links[index]
      main.src = link.href
      main.alt = link.querySelector('img')?.alt ?? ''
      const stripButtons = mediaBox.querySelectorAll<HTMLElement>(
        '.trips-replay__strip button'
      )
      stripButtons.forEach((button, i) => {
        const current = i === index
        button.toggleAttribute('aria-current', current)
        if (current)
          button.scrollIntoView({ block: 'nearest', inline: 'nearest' })
      })
      return
    }
    const gridButtons = mediaBox.querySelectorAll<HTMLElement>(
      '.trips-replay__grid-btn'
    )
    gridButtons.forEach((button, i) =>
      button.toggleAttribute(
        'aria-current',
        media.links.length > 1 && i === index
      )
    )
  }

  /**
   * 竖屏三张以内、横屏九张以内直接网格排开；更多时显示一张大图，下面是缩略图条。
   * 点大图或排开的照片打开照片对话框。
   */
  function renderMedia(links: HTMLAnchorElement[]) {
    media = { links, index: 0 }
    mediaBox.replaceChildren()
    mediaBox.hidden = links.length === 0
    const isPortrait = narrow.matches || portrait.matches
    const single = links.length > (isPortrait ? 3 : 9)
    mediaBox.className = `trips-replay__media ${
      links.length === 0 ? '' : single ? 'is-single' : 'is-grid'
    }`
    // 1 张单列，2 或 4 张两列，其余三列。
    const cols =
      links.length <= 1 ? 1 : links.length === 2 || links.length === 4 ? 2 : 3
    mediaBox.style.setProperty('--cols', String(cols))
    if (!single) {
      links.forEach((link, index) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.className = 'trips-replay__grid-btn'
        button.setAttribute('aria-label', `查看大图：${link.dataset.caption}`)
        button.append(thumbnail(link, cols === 1 ? '22rem' : '8rem'))
        button.addEventListener('click', () => {
          showPhoto(index)
          viewer.open(link)
        })
        mediaBox.append(button)
      })
      showPhoto(0)
    } else if (links.length > 0) {
      const main = document.createElement('button')
      main.type = 'button'
      main.className = 'trips-replay__main'
      main.setAttribute('aria-label', '查看大图')
      main.append(document.createElement('img'))
      main.addEventListener('click', () =>
        viewer.open(media.links[media.index])
      )
      const strip = document.createElement('div')
      strip.className = 'trips-replay__strip'
      links.forEach((link, index) => {
        const button = document.createElement('button')
        button.type = 'button'
        button.setAttribute('aria-label', `第 ${index + 1} 张`)
        button.append(thumbnail(link, '3rem'))
        button.addEventListener('click', () => {
          showPhoto(index)
          restartCarousel()
        })
        strip.append(button)
      })
      mediaBox.append(main, strip)
      showPhoto(0)
    }
    restartCarousel()
  }

  function showReplayDay(day: number) {
    const item = detail(selected)?.querySelector<HTMLElement>(
      `[data-trip-day="${day}"]`
    )
    const distance = text(item?.querySelector('[data-trip-day-distance]'))
    setCard({
      day: '',
      number: '',
      name: text(item?.querySelector('[data-trip-day-label]')),
      meta: distance ? `当天约 ${distance}` : '',
      note: text(item?.querySelector('h3 small')),
    })
    replayCard.dataset.replayKind = 'day'
    renderMedia([])
    activateStop(undefined, 'none')
  }

  function showReplayStop(index: number) {
    const item = stopItem(index)
    const day = item?.closest('.trip-day')
    setCard({
      day: text(day?.querySelector('[data-trip-day-label]')),
      number: text(item?.querySelector('.trip-stop__number')),
      name: text(item?.querySelector('.trip-stop__name')),
      meta: text(item?.querySelector('.trip-stop__meta')),
      note: text(item?.querySelector('.trip-stop__note')),
    })
    replayCard.dataset.replayKind = 'stop'
    renderMedia(photoLinks(index))
    activateStop(index, 'none', true)
  }

  function setReplayPlaying(next: boolean) {
    playing = next
    const button = replayCard.querySelector<HTMLButtonElement>(
      '[data-replay-toggle]'
    )!
    button.setAttribute('aria-label', next ? '暂停' : '继续')
    button.firstElementChild!.className = next
      ? 'i-ri-pause-fill'
      : 'i-ri-play-fill'
    restartCarousel()
  }

  function stopReplay() {
    replayRun++
    if (!replaying()) return
    replay?.destroy()
    replay = undefined
    playing = false
    clearInterval(carousel)
    replayCard.hidden = true
    page.removeAttribute('data-trips-replaying')
    activateStop(undefined, 'none')
    if (selected) tripMap?.select(selected)
  }

  async function startReplay(id: string) {
    const trip = tripMap?.trip(id)
    if (
      !tripMap ||
      !trip ||
      trip.stops.length < 2 ||
      replaying() ||
      // 地图失败，或换主题后新底图还在加载时不能加图层。
      !tripMap.ready()
    )
      return
    const run = ++replayRun
    page.toggleAttribute('data-trips-replaying', true)
    replayCard.hidden = false
    buildProgress(id)
    try {
      const created = await createReplay({
        tripMap,
        trip,
        getPadding,
        photosOf: (index) => photoLinks(index).length,
        onDay: showReplayDay,
        onStop: showReplayStop,
        onProgress: renderProgress,
        onPlayingChange: setReplayPlaying,
        onEnd: () => setReplayPlaying(false),
      })
      // 创建期间换了旅程、换了主题或离开了本页：丢弃这次回放。
      if (run !== replayRun) {
        if (!signal.aborted) created.destroy()
        return
      }
      replay = created
      replay.setSpeed(speed)
      replay.play()
    } catch (error) {
      console.error(error)
      if (run === replayRun) stopReplay()
    }
  }

  // —— 事件 ——
  page.addEventListener(
    'click',
    (event) => {
      const target = event.target as Element
      // 同页片段链接由这里接管：ClientRouter 用 pushState 改地址，不会触发 hashchange。
      const fragment = target.closest<HTMLAnchorElement>('a[href^="#"]')
      if (
        fragment &&
        event.button === 0 &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.shiftKey &&
        !event.altKey
      ) {
        event.preventDefault()
        location.hash = fragment.hash
        return
      }
      const stop = target.closest<HTMLElement>('[data-trip-stop-focus]')
      if (stop) {
        const stopNode = stop.closest<HTMLElement>('[data-trip-stop]')!
        const dayNode = stopNode.closest<HTMLElement>('[data-trip-day]')
        const day = dayNode ? Number(dayNode.dataset.tripDay) : undefined
        if (day !== undefined && day !== focusedDay) {
          focusedDay = day
          tripMap?.focusDay(day)
        }
        activateStop(Number(stopNode.dataset.tripStop), 'fly')
        return
      }
      const yearButton = target.closest<HTMLButtonElement>('[data-trips-year]')
      if (yearButton) {
        const value = Number(yearButton.dataset.tripsYear)
        setYear(year === value ? undefined : value)
        return
      }
      const replayButton = target.closest<HTMLElement>('[data-trip-replay]')
      if (replayButton) void startReplay(replayButton.dataset.tripReplay!)
    },
    { signal }
  )
  page.addEventListener(
    'pointerover',
    (event) => {
      const card = (event.target as Element).closest<HTMLElement>(
        '[data-trip-link]'
      )
      if (!current) tripMap?.lift(card?.dataset.tripLink)
      const stop = (event.target as Element).closest<HTMLElement>(
        '[data-trip-stop]'
      )
      if (selected && !replay && stop)
        tripMap?.activateStop(Number(stop.dataset.tripStop))
    },
    { signal }
  )
  page.addEventListener(
    'pointerout',
    (event) => {
      const from = (event.target as Element).closest('[data-trip-stop]')
      const to = (event.relatedTarget as Element | null)?.closest?.(
        '[data-trip-stop]'
      )
      // 离开停靠点条目时恢复到当前选中的站。
      if (selected && !replay && from && from !== to)
        tripMap?.activateStop(activeStop)
    },
    { signal }
  )
  panel.addEventListener('pointerleave', () => tripMap?.lift(undefined), {
    signal,
  })
  const onCard = (name: string, handler: () => void) =>
    replayCard
      .querySelector(`[data-replay-${name}]`)!
      .addEventListener('click', handler, { signal })
  onCard('toggle', () => replay?.toggle())
  onCard('previous', () => replay?.previous())
  onCard('next', () => replay?.next())
  onCard('exit', stopReplay)
  onCard('speed', () => {
    speed = SPEEDS[(SPEEDS.indexOf(speed as never) + 1) % SPEEDS.length]
    renderSpeed()
    replay?.setSpeed(speed)
    restartCarousel()
    try {
      localStorage.setItem(SPEED_KEY, String(speed))
    } catch {
      // 保存失败只影响下次打开。
    }
  })
  fitButton.addEventListener(
    'click',
    () => {
      if (current) location.hash = 'trips'
      else tripMap?.select(undefined)
    },
    { signal }
  )
  toggle.addEventListener(
    'click',
    () => {
      setCollapsed(!collapsed())
      tripMap?.resize()
    },
    { signal }
  )

  // —— 地图设置：风格与 3D 视角，保存在本机 ——
  let settings = DEFAULT_MAP_SETTINGS
  try {
    settings = parseMapSettings(localStorage.getItem(MAP_SETTINGS_KEY))
  } catch {
    // 禁止本地存储时用默认值。
  }
  const isDark = () => document.documentElement.classList.contains('dark')

  function renderSettings() {
    for (const input of settingsPanel.querySelectorAll<HTMLInputElement>(
      'input[name="trips-style"]'
    ))
      input.checked = input.value === settings.style
    settingsPanel.querySelector<HTMLInputElement>(
      '[data-trips-tilt]'
    )!.checked = settings.tilt
  }

  function applySettings(next: typeof settings) {
    if (next.style !== settings.style) stopReplay()
    settings = next
    renderSettings()
    try {
      localStorage.setItem(MAP_SETTINGS_KEY, JSON.stringify(settings))
    } catch {
      // 保存失败只影响下次打开。
    }
    tripMap?.setAppearance(isDark(), settings)
  }

  function setSettingsOpen(open: boolean, restoreFocus = false) {
    settingsPanel.hidden = !open
    settingsToggle.setAttribute('aria-expanded', String(open))
    if (!open && restoreFocus) settingsToggle.focus()
  }

  renderSettings()
  settingsToggle.addEventListener(
    'click',
    () => setSettingsOpen(settingsPanel.hidden),
    { signal }
  )
  settingsPanel.addEventListener(
    'change',
    (event) => {
      const target = event.target as HTMLInputElement
      if (target.name === 'trips-style')
        applySettings({ ...settings, style: target.value })
      else if (target.matches('[data-trips-tilt]'))
        applySettings({ ...settings, tilt: target.checked })
    },
    { signal }
  )
  settingsPanel.addEventListener(
    'click',
    (event) => {
      const target = event.target as Element
      if (target.closest('[data-trips-settings-close]'))
        setSettingsOpen(false, true)
      else if (target.closest('[data-trips-settings-reset]'))
        applySettings(DEFAULT_MAP_SETTINGS)
    },
    { signal }
  )
  // 点面板外关闭。
  document.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target as Node
      if (
        !settingsPanel.hidden &&
        !settingsPanel.contains(target) &&
        !settingsToggle.contains(target)
      )
        setSettingsOpen(false)
    },
    { signal }
  )

  addEventListener('hashchange', syncFromHash, { signal })
  addEventListener(
    'keydown',
    (event) => {
      if (viewer.isOpen()) return
      if (event.key === 'Escape') {
        if (!settingsPanel.hidden) setSettingsOpen(false, true)
        else if (replay) stopReplay()
      } else if (replay && event.key === 'ArrowLeft') replay.previous()
      else if (replay && event.key === 'ArrowRight') replay.next()
    },
    { signal }
  )

  for (const button of yearButtons) button.disabled = false
  const initialYear = Number(new URL(location.href).searchParams.get('year'))
  setYear(
    yearButtons.some(
      (button) => Number(button.dataset.tripsYear) === initialYear
    )
      ? initialYear
      : undefined
  )
  syncFromHash()

  // —— 地图 ——
  fetch(page.dataset.mapUrl!, { signal })
    .then((response) => {
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json() as Promise<MapData>
    })
    .then(async (data) => {
      if (signal.aborted) return
      const instance = await createTripMap({
        container: $<HTMLElement>('[data-trips-canvas]'),
        data,
        dark: isDark(),
        settings,
        getPadding,
        onSelectTrip: (id) => (location.hash = id),
        onSelectEntry: (id) => (location.hash = entryHash(id)),
        onSelectStop: (index) => activateStop(index, 'none', true),
        onError: (value) => {
          showMessage(value)
          stopReplay()
        },
      })
      if (signal.aborted) {
        instance.destroy()
        return
      }
      tripMap = instance
      const enableMapControls = () => {
        fitButton.disabled = false
        settingsToggle.disabled = page.hasAttribute('data-trips-map-failed')
        for (const button of page.querySelectorAll<HTMLButtonElement>(
          '[data-trip-replay]'
        ))
          button.disabled =
            page.hasAttribute('data-trips-map-failed') ||
            (tripMap?.trip(button.dataset.tripReplay!)?.stops.length ?? 0) < 2
        tripMap?.setYear(year)
        if (selectedEntry) tripMap?.selectEntry(selectedEntry)
        else if (selected) tripMap?.select(selected)
      }
      if (tripMap.ready()) enableMapControls()
      else tripMap.map.once('style.load', enableMapControls)
      const unobserve = observeTheme(() => {
        // 「跟随主题」时会换底图，回放图层随之消失。
        if (settings.style === 'auto') stopReplay()
        tripMap?.setAppearance(isDark(), settings)
      })
      signal.addEventListener('abort', () => {
        unobserve()
        stopReplay()
        clearInterval(carousel)
        tripMap?.destroy()
      })
    })
    .catch((error) => {
      if (signal.aborted) return
      console.error(error)
      showMessage('地图暂时无法加载，旅程仍可在面板里浏览。')
    })
}
