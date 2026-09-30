/* global taskSpace */
// sed 's/__TASK_SPACE_ID__/<id>/' scripts/verify-toc-navigation.mjs | ego-browser nodejs
import assert from 'node:assert/strict'

const task = await taskSpace(Number('__TASK_SPACE_ID__'))
const page = task.page('p1')
const base = 'http://127.0.0.1:4322/blogs/browser-use/'
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
  for (const dark of [false, true]) {
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
    await page.click(`${earlyContainer} a[href="#1-从-html-到页面"]`)
    await verify('#1-从-html-到页面', `${width}/early-click`)
    if (
      (await page.evaluate(() =>
        document.documentElement.classList.contains('dark')
      )) !== dark
    )
      await page.click('button[aria-label="Dark mode"]')
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
    assert.ok(hashes.length > 4)
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
    const prefix = `${width}/${dark ? 'dark' : 'light'}`
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
}
await page.cdp('Emulation.clearDeviceMetricsOverride')
console.log(
  'TOC click, highlight, repeated target, history and direct hash passed:',
  results.length,
  'cases'
)
console.log(results)
