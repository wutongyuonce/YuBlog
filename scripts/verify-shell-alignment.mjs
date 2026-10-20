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
  'interests/book/',
  'projects/',
  'about/',
  'friends/',
  'blogs/image-layout-demo/',
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
        const { left, right } = node.getBoundingClientRect()
        return { left, right, center: (left + right) / 2 }
      }
      const footer = document.querySelector('body > footer > div > div')
      return {
        viewport: innerWidth,
        rootWidth: document.documentElement.scrollWidth,
        nav: box('.nav-bar__inner'),
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
    for (const edge of ['left', 'right']) {
      assert.ok(
        Math.abs(state.nav[edge] - state.content[edge]) <= 1,
        `${label}: ${edge} nav/content edge: ${JSON.stringify(state)}`
      )
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
console.log(
  'PASS: nav/content edges and footer alignment across 10 pages and 4 widths'
)
