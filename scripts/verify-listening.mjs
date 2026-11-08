/* global taskSpace */
// Run in the current worktree's Ego TaskSpace against its actual server address.
// Replace __TASK_SPACE_ID__ and __BASE_URL__ (a dev server, e.g. http://127.0.0.1:4321/).
import assert from 'node:assert/strict'
const task = await taskSpace(Number('__TASK_SPACE_ID__'))
const page = task.page('p1')
const base = '__BASE_URL__'

// 听歌数据只在运行时取得：固定两份载荷替换接口，让布局、切换与状态都可复现。
const keys = ['7day', '1month', '12month', 'overall']
const album = (index) => ({
  name:
    index === 0
      ? 'A long album title spanning more than two lines'
      : `专辑 ${index + 1}`,
  artist: `歌手 ${index + 1}`,
  url: `https://www.last.fm/music/artist${index}/album${index}`,
  playcount: 20 - index,
  // 第三张缺封面，走文字格。
  cover:
    index === 2
      ? null
      : `https://lastfm-img.freetls.fastly.net/i/u/300x300/cover-${index}.jpg`,
  coverLarge: null,
})
const snapshot = {
  updatedAt: '2026-10-15T07:29:23.000Z',
  totalScrobbles: 8918,
  periods: keys.map((key) => ({
    key,
    albumTotal: key === '7day' ? 1 : 27,
    albums: Array.from({ length: key === '7day' ? 1 : 9 }, (_, i) => album(i)),
  })),
}
const now = {
  playing: true,
  tracks: Array.from({ length: 6 }, (_, index) => ({
    name: index ? `歌曲 ${index}` : '正在播放的歌',
    artist: 'YOASOBI',
    album: 'THE BOOK 3',
    cover: null,
    url: `https://www.last.fm/music/YOASOBI/_/song${index}`,
    playedAt: index
      ? new Date(Date.now() - index * 3_600_000).toISOString()
      : null,
  })),
}
await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
  const payloads = { '/api/lastfm': ${JSON.stringify(snapshot)}, '/api/lastfm-now': ${JSON.stringify(now)} }
  const real = window.fetch.bind(window)
  const mode = window.localStorage.getItem('listening-stub') || 'ready'
  window.__listeningRequests = 0
  window.fetch = (input, init) => {
    const path = new URL(typeof input === 'string' ? input : input.url, location.href).pathname
    if (!(path in payloads)) return real(input, init)
    if (path === '/api/lastfm') window.__listeningRequests++
    let body = payloads[path]
    if (mode === 'empty') body = path === '/api/lastfm'
      ? { ...body, totalScrobbles: 0, periods: body.periods.map((p) => ({ ...p, albumTotal: 0, albums: [] })) }
      : { playing: false, tracks: [] }
    const respond = () => new Response(mode === 'fail' ? '{}' : JSON.stringify(body), {
      status: mode === 'fail' ? 503 : 200,
      headers: { 'content-type': 'application/json' },
    })
    if (path === '/api/lastfm' && new URL(location.href).searchParams.has('hold'))
      return new Promise((resolve) => { window.__release = () => resolve(respond()) })
    return Promise.resolve(respond())
  }
})()`,
})

const settle = () =>
  page.waitForFunction(
    () =>
      document.querySelector('[data-listening]')?.dataset.state !== 'loading' &&
      document.querySelector('[data-now-playing]')?.dataset.state !== 'loading'
  )
const rect = (selector) =>
  page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect()
    return {
      top: r.top,
      left: r.left,
      right: r.right,
      bottom: r.bottom,
      width: r.width,
      height: r.height,
    }
  }, selector)

for (const width of [1440, 390, 320]) {
  await page.cdp('Emulation.setDeviceMetricsOverride', {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await page.goto(base)
  await settle()
  const section = await rect('.recent-listening')
  const card = await rect('.now-playing')
  const list = await rect('.recent-tracks')
  if (width === 1440) {
    assert.ok(
      list.left > card.right,
      'wide: recent list sits to the right of the card'
    )
    assert.ok(
      Math.abs(list.top - card.top) <= 1,
      'wide: both columns share a top edge'
    )
  } else {
    assert.ok(
      list.top >= card.bottom,
      `${width}: the list moves below the card`
    )
  }
  // 版心两条缘线：卡片贴左，时间、累计数与更新时间贴右。
  assert.ok(Math.abs(card.left - section.left) <= 1)
  for (const selector of [
    '.recent-tracks__time',
    '.collage__total',
    '.collage__updated',
  ])
    assert.ok(
      Math.abs((await rect(selector)).right - section.right) <= 1,
      `${width}: ${selector} ends at the content edge`
    )
  const tiles = await page.evaluate(() =>
    [...document.querySelectorAll('.collage__tile')].map((tile) => {
      const r = tile.getBoundingClientRect()
      return { w: r.width, h: r.height }
    })
  )
  assert.equal(tiles.length, 9)
  assert.ok(
    tiles.every((t) => Math.abs(t.w - t.h) <= 1),
    'every cell is square'
  )
  const gap = await page.evaluate(() =>
    parseFloat(
      getComputedStyle(document.querySelector('.collage__grid')).columnGap
    )
  )
  assert.ok(
    Math.abs(tiles[0].w - (2 * tiles[1].w + gap)) <= 1,
    '#1 spans two by two'
  )
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth
    ),
    true,
    `${width}: no horizontal page overflow`
  )
}

// 悬停小格浮出信息；缺封面的格子信息常驻；#1 常驻。
const opacity = (selector) =>
  page.evaluate(
    (s) => getComputedStyle(document.querySelector(s)).opacity,
    selector
  )
assert.equal(await opacity('.collage__tile:nth-child(2) .collage__info'), '0')
assert.equal(await opacity('.collage__tile:nth-child(3) .collage__info'), '1')
assert.equal(await opacity('.collage__tile--lead .collage__info'), '1')
await page.hover('.collage__tile:nth-child(2)', { label: 'hover second album' })
await page.waitForFunction(
  () =>
    getComputedStyle(
      document.querySelector('.collage__tile:nth-child(2) .collage__info')
    ).opacity === '1'
)

// 真实点击切换时段：只重绘同一份快照，不再请求接口；文案与少于九张的渲染由单测负责。
await page.click('[data-listening-period="7day"]', {
  label: 'switch to 7 days',
})
const sparse = await page.evaluate(() => ({
  tiles: document.querySelectorAll('.collage__tile').length,
  pressed: document
    .querySelector('[data-listening-period="7day"]')
    .getAttribute('aria-pressed'),
  requests: window.__listeningRequests,
}))
assert.deepEqual(sparse, {
  tiles: 1,
  pressed: 'true',
  requests: 1,
})

// 接口在页尾才返回时，替换骨架不改变滚动位置（同为九格）。
await page.cdp('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
})
await page.goto(new URL('?hold', base).href)
await page.waitForFunction(() => !!window.__release)
await page.waitForFunction(
  () =>
    document.querySelector('[data-now-playing]')?.dataset.state !== 'loading'
)
const before = await page.evaluate(async () => {
  await document.fonts.ready
  document.documentElement.style.scrollBehavior = 'auto'
  window.scrollTo(0, document.documentElement.scrollHeight)
  return { y: scrollY, h: document.documentElement.scrollHeight }
})
await page.evaluate(() => window.__release())
await settle()
const after = await page.evaluate(() => ({
  y: scrollY,
  h: document.documentElement.scrollHeight,
}))
assert.ok(
  Math.abs(after.h - before.h) <= 1,
  `page height stays (${before.h} → ${after.h})`
)
assert.ok(
  Math.abs(after.y - before.y) <= 1,
  'scroll position stays at the bottom'
)

// 脚本接线：失败与真实空数据都离开“加载中”，正在播放随之收起；各状态的文案与按钮由单测负责。
const stateAfter = async (mode) => {
  await page.evaluate(
    (value) => window.localStorage.setItem('listening-stub', value),
    mode
  )
  await page.goto(base)
  await settle()
  return page.evaluate(() => {
    const root = document.querySelector('[data-listening]')
    return {
      state: root.dataset.state,
      nowHidden: root.querySelector('[data-now-playing]').hidden,
    }
  })
}
assert.deepEqual(await stateAfter('fail'), { state: 'error', nowHidden: true })
assert.deepEqual(await stateAfter('empty'), { state: 'empty', nowHidden: true })
await page.evaluate(() => window.localStorage.removeItem('listening-stub'))

// 无脚本：noscript 里的样式要真的把正在播放藏起来；骨架、按钮与说明由 built 检查负责。
await page.cdp('Emulation.setScriptExecutionDisabled', { value: true })
await page.goto(base)
const nowDisplay = await page.evaluate(
  () => getComputedStyle(document.querySelector('[data-now-playing]')).display
)
await page.cdp('Emulation.setScriptExecutionDisabled', { value: false })
assert.equal(nowDisplay, 'none')
console.log(
  'Listening: two-column/stacked layout, content edges, 2×2 lead, hover, period switch, sparse periods, bottom anchor, failure/empty, no-JS passed'
)
