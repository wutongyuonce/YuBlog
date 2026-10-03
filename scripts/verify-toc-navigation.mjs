/* global taskSpace */
// sed 's/__TASK_SPACE_ID__/<id>/' scripts/verify-toc-navigation.mjs | ego-browser nodejs
import assert from 'node:assert/strict'

const task = await taskSpace(Number('__TASK_SPACE_ID__'))
const page = task.page('p1')
const origin = 'http://127.0.0.1:4322'
await page.goto(`${origin}/blogs/`)
const candidates = await page.evaluate(() => [
  ...new Set(
    [...document.querySelectorAll('[data-blog-item] a[href]')]
      .map((link) => link.href)
      .filter((href) => {
        const url = new URL(href)
        return (
          url.origin === location.origin && url.pathname.startsWith('/blogs/')
        )
      })
  ),
])
let base, firstHash
for (const url of candidates) {
  await page.goto(url)
  const hashes = await page.evaluate(() =>
    [...document.querySelectorAll('#toc-sidebar [data-toc-link]')].map((link) =>
      link.getAttribute('href')
    )
  )
  if (hashes.length < 4) continue
  base = url
  firstHash = hashes[0]
  break
}
assert.ok(
  base,
  'TOC regression needs a published article with at least four headings'
)
const results = []
const settle = async () => {
  await page.evaluate(
    () =>
      new Promise((resolve) => {
        let last = -1,
          stable = 0
        const start = performance.now()
        const sample = () => {
          stable = Math.abs(scrollY - last) < 0.5 ? stable + 1 : 0
          last = scrollY
          if (stable > 12 || performance.now() - start > 4000) resolve()
          else requestAnimationFrame(sample)
        }
        requestAnimationFrame(sample)
      })
  )
}
const verify = async (hash, label, landing = true) => {
  await settle()
  const state = await page.evaluate((hash) => {
    const target = document.getElementById(decodeURIComponent(hash.slice(1)))
    const header = document.querySelector('[data-site-header]')
    const hidden = header.hasAttribute('data-scroll-hidden')
    const expected = hidden
      ? 20
      : parseFloat(
          getComputedStyle(header).getPropertyValue('--nav-visible-top')
        ) +
        header.getBoundingClientRect().height +
        12
    const bottom =
      scrollY >= document.documentElement.scrollHeight - innerHeight - 2
    const links = [...document.querySelectorAll('#toc-sidebar [data-toc-link]')]
    const passed = links.filter(
      (a) =>
        document
          .getElementById(decodeURIComponent(a.hash.slice(1)))
          ?.getBoundingClientRect().top <=
        expected + 1
    )
    const expectedActive = (
      bottom ? links.at(-1) : passed.at(-1) || links[0]
    ).getAttribute('href')
    return {
      top: target.getBoundingClientRect().top,
      margin: parseFloat(getComputedStyle(target).scrollMarginTop),
      expected,
      hidden,
      bottom,
      expectedActive,
      active: document
        .querySelector('#toc-sidebar [aria-current]')
        ?.getAttribute('href'),
      overflow: document.documentElement.scrollWidth > innerWidth,
    }
  }, hash)
  assert.ok(!state.overflow, label)
  assert.ok(
    Math.abs(state.margin - state.expected) < 0.1,
    `${label}: click and highlight share the reading edge`
  )
  if (landing && !state.bottom)
    assert.ok(
      Math.abs(state.top - state.expected) < 2,
      `${label}: ${JSON.stringify(state)}`
    )
  assert.equal(
    state.active,
    landing ? hash : state.expectedActive,
    `${label}: active heading must be the landed heading`
  )
  results.push({ label, ...state })
}

for (const width of [1440, 390, 320]) {
  await page.cdp('Emulation.setDeviceMetricsOverride', {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await page.goto(base)
  await page.waitForSelector('table-of-contents')
  // Exercise a real click before content entrance animations have finished.
  if (width < 1200) await page.click('.mobile-toc-control__toggle')
  const earlyContainer = width < 1200 ? '#mobile-toc-panel' : '#toc-sidebar'
  await page.click(`${earlyContainer} a[href="${firstHash}"]`)
  await verify(firstHash, `${width}/early-click`)
  await page.waitForFunction(
    () =>
      document.fonts.status === 'loaded' &&
      !document
        .getAnimations()
        .some(
          (a) =>
            a.playState === 'running' &&
            a.effect?.getTiming().iterations !== Infinity
        )
  )
  const hashes = await page.evaluate(() =>
    [...document.querySelectorAll('#toc-sidebar [data-toc-link]')].map((a) =>
      a.getAttribute('href')
    )
  )
  assert.ok(hashes.length >= 4)
  if (width === 1440) {
    assert.equal(
      await page.evaluate(
        () => document.querySelectorAll('.desktop-aside__trigger').length
      ),
      0
    )
    assert.equal(
      await page.evaluate(
        () =>
          getComputedStyle(document.querySelector('#toc-sidebar')).visibility
      ),
      'visible'
    )
  }
  const prefix = `${width}`
  // Downward child, same target again, upward parent, downward sibling, final section.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }))
  await settle()
  for (const [index, label] of [
    [2, 'child'],
    [2, 'repeat'],
    [1, 'parent'],
    [3, 'sibling'],
    [hashes.length - 1, 'bottom'],
  ]) {
    if (width < 1200) await page.click('.mobile-toc-control__toggle')
    const container = width < 1200 ? '#mobile-toc-panel' : '#toc-sidebar'
    await page.click(`${container} a[href="${hashes[index]}"]`)
    await verify(hashes[index], `${prefix}/${label}`)
  }
  await page.evaluate(() => history.back())
  await page.waitForURL(new URL(base + hashes[3]).href)
  // History restores the reading position, rather than forcibly re-aligning
  // its fragment after the reader has manually scrolled.
  await verify(hashes[3], `${prefix}/history-back`, false)
  await page.goto(base + hashes[2])
  await page.waitForSelector('table-of-contents')
  await page.waitForFunction(
    () =>
      document.fonts.status === 'loaded' &&
      !document
        .getAnimations()
        .some(
          (a) =>
            a.playState === 'running' &&
            a.effect?.getTiming().iterations !== Infinity
        )
  )
  await verify(hashes[2], `${prefix}/direct-hash`)
}
// A nearby fragment must include travel accumulated before the click, in both
// directions. Resetting a fresh prediction state would fail these landings.
await page.cdp('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
})
await page.goto(base)
await page.waitForLoadState()
await page.waitForFunction(() => document.fonts.status === 'loaded')
const nearbyHash = firstHash
const headingY = await page.evaluate((hash) => {
  const heading = document.getElementById(decodeURIComponent(hash.slice(1)))
  return heading.getBoundingClientRect().top + scrollY
}, nearbyHash)
await page.focus('.nav-bar__brand')
await page.evaluate(
  (top) => scrollTo({ top, behavior: 'instant' }),
  headingY - 96
)
await settle()
await page.mouse.click(100, 100)
await page.evaluate(() => scrollBy({ top: 14, behavior: 'instant' }))
await settle()
assert.equal(
  await page.evaluate(() =>
    document
      .querySelector('[data-site-header]')
      .hasAttribute('data-scroll-hidden')
  ),
  false
)
await page.click(`#toc-sidebar a[href="${nearbyHash}"]`)
await verify(nearbyHash, 'nearby/downward-accumulated-travel')
await page.evaluate((top) => scrollTo({ top, behavior: 'instant' }), headingY)
await settle()
await page.evaluate(() => scrollBy({ top: -14, behavior: 'instant' }))
await settle()
assert.equal(
  await page.evaluate(() =>
    document
      .querySelector('[data-site-header]')
      .hasAttribute('data-scroll-hidden')
  ),
  true
)
await page.click(`#toc-sidebar a[href="${nearbyHash}"]`)
await verify(nearbyHash, 'nearby/upward-accumulated-travel')

// Without JS, the static margin must cover the same two-row navigation range.
await page.cdp('Emulation.setScriptExecutionDisabled', { value: true })
try {
  for (const width of [780, 799, 800]) {
    await page.cdp('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    // A hash-only goto keeps the already initialized document and its scripts.
    await page.goto('about:blank')
    await page.goto(base + nearbyHash)
    await page.waitForLoadState()
    const state = await page.evaluate((hash) => {
      const heading = document.getElementById(decodeURIComponent(hash.slice(1)))
      return {
        top: heading.getBoundingClientRect().top,
        bottom: document
          .querySelector('[data-site-header]')
          .getBoundingClientRect().bottom,
        script: Boolean(customElements.get('table-of-contents')),
      }
    }, nearbyHash)
    assert.equal(state.script, false)
    assert.ok(
      state.top >= state.bottom + 10,
      `${width}: ${JSON.stringify(state)}`
    )
  }
} finally {
  await page.cdp('Emulation.setScriptExecutionDisabled', { value: false })
}
await page.cdp('Emulation.clearDeviceMetricsOverride')
console.log(
  'TOC click, highlight, repeated target, history and direct hash passed:',
  results.length,
  'cases'
)
console.log('No-JS anchor navigation at 780, 799 and 800px: passed')
