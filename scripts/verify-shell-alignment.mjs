/* global taskSpace */
// sed -e 's/__TASK_SPACE_ID__/<id>/g' -e 's|__BASE_URL__|http://127.0.0.1:4321/|g' scripts/verify-shell-alignment.mjs | ego-browser nodejs
import assert from 'node:assert/strict'

const task = await taskSpace(Number('__TASK_SPACE_ID__'))
const page = task.page('p1')
const base = '__BASE_URL__'
const paths = [
  '',
  'blogs/',
  'tags/',
  'archives/',
  'interests/',
  'interests/media/',
  'projects/',
  'about/',
  'friends/',
  'blogs/content-style-guide/',
]

for (const width of [1440, 768, 390, 320]) {
  for (const path of paths) {
    await page.goto(new URL(path, base).href)
    await page.waitForSelector('#main > *')
    await page.evaluate(() => document.fonts.ready.then(() => undefined))
    // Apply after navigation: Ego's host window can resize the viewport on load.
    await page.cdp('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await page.evaluate(
      () => new Promise((resolve) => requestAnimationFrame(resolve))
    )
    const state = await page.evaluate(() => {
      const box = (selector) => {
        const node = document.querySelector(selector)
        if (!node.getClientRects().length) return null
        const { left, right } = node.getBoundingClientRect()
        return { left, right, center: (left + right) / 2 }
      }
      const footer = document.querySelector('body > footer > div > div')
      return {
        viewport: innerWidth,
        rootWidth: document.documentElement.scrollWidth,
        nav: box('.nav-bar__inner'),
        article: Boolean(document.querySelector('.post-header')),
        paddingTop: parseFloat(
          getComputedStyle(document.querySelector('#main')).paddingTop
        ),
        returnHref: document
          .querySelector('.post-back-link')
          ?.getAttribute('href'),
        content: box('#main > :is(.home-page, .blog-index-layout, .prose)'),
        footer: box('body > footer > div'),
        footerRows: [...footer.children]
          .filter((node) => getComputedStyle(node).display !== 'none')
          .map((node) => {
            const { left, right, top } = node.getBoundingClientRect()
            return { center: (left + right) / 2, top }
          }),
      }
    })
    const label = `${path || '/'} @ ${width}px`
    assert.equal(state.viewport, width, `${label}: requested viewport`)
    assert.ok(state.rootWidth <= width, `${label}: no document overflow`)
    assert.equal(
      Boolean(state.nav),
      !state.article,
      `${label}: article hides global nav`
    )
    if (state.article) {
      assert.equal(
        state.paddingTop,
        width < 800 ? 24 : 40,
        `${label}: reading clearance`
      )
      assert.equal(
        state.returnHref,
        new URL('blogs/', base).pathname,
        `${label}: return to all posts`
      )
      for (const top of [600, 400]) {
        await page.evaluate(async (top) => {
          scrollTo({ top, behavior: 'instant' })
          await new Promise(requestAnimationFrame)
          await new Promise(requestAnimationFrame)
        }, top)
        const pinned = await page.evaluate(() => ({
          navVisible:
            document.querySelector('[data-site-header]').getClientRects()
              .length > 0,
          top: document.querySelector('.post-back-link').getBoundingClientRect()
            .top,
        }))
        assert.equal(
          pinned.navVisible,
          false,
          `${label}: nav stays hidden in both directions`
        )
        assert.equal(
          pinned.top,
          12,
          `${label}: return stays at the reading edge`
        )
      }
    } else {
      for (const edge of ['left', 'right']) {
        assert.ok(
          Math.abs(state.nav[edge] - state.content[edge]) <= 1,
          `${label}: ${edge} nav/content edge: ${JSON.stringify(state)}`
        )
      }
    }
    assert.ok(
      Math.abs(state.footer.center - state.content.center) <= 1,
      `${label}: footer and content share a center`
    )
    assert.ok(
      Math.abs(state.footer.left - state.content.left) <= 1 &&
        Math.abs(state.footer.right - state.content.right) <= 1,
      `${label}: footer shares the content gutter`
    )
    if (width < 640) {
      assert.equal(state.footerRows.length, 4, `${label}: four footer rows`)
      assert.equal(
        new Set(state.footerRows.map((row) => Math.round(row.top))).size,
        4,
        `${label}: footer rows stack vertically`
      )
      assert.ok(
        state.footerRows.every(
          (row) => Math.abs(row.center - state.content.center) <= 1
        ),
        `${label}: every footer row stays centered`
      )
    }
  }
}
// Exercise ClientRouter swaps as well as the hard navigations above.
await page.goto(new URL('blogs/#技术', base).href)
await page.waitForSelector('[data-blog-item] h2 a')
const dark = await page.evaluate(() => {
  window.__readingStyles = document.getElementById('site-styles')
  return document.documentElement.classList.contains('dark')
})
await page.click('[data-blog-item] h2 a >> nth=0')
await page.waitForSelector('.post-header')
for (let index = 0; index < 4; index++) {
  await page.keyboard.press('Tab')
  assert.equal(
    await page.evaluate(() =>
      document
        .querySelector('[data-site-header]')
        .contains(document.activeElement)
    ),
    false,
    'keyboard focus skips the hidden navigation'
  )
}
assert.equal(
  await page.evaluate(
    () => document.querySelector('[data-site-header]').getClientRects().length
  ),
  0,
  'ClientRouter entry hides the article navigation'
)
await page.click('.post-back-link')
await page.waitForURL(new URL('blogs/', base).href)
await page.waitForSelector('[data-blog-item] h2 a')
assert.deepEqual(
  await page.evaluate(() => ({
    navVisible:
      document.querySelector('[data-site-header]').getClientRects().length > 0,
    dark: document.documentElement.classList.contains('dark'),
    sharedStyles:
      document.getElementById('site-styles') === window.__readingStyles,
    article: Boolean(document.querySelector('.post-header')),
  })),
  { navVisible: true, dark, sharedStyles: true, article: false },
  'return restores the global navigation and preserves theme and shared CSS'
)
await page.evaluate(() => {
  delete window.__readingStyles
})
await page.goto(new URL('blogs/rex-architecture/?search=Rex', base).href)
await page.waitForSelector('mark.pagefind-highlight')
console.log(
  'PASS: reading navigation, nav/content edges and footer alignment across 10 pages and 4 widths; ClientRouter return, keyboard, theme and search highlighting'
)
