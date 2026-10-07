/* global taskSpace */
// Run inside an existing agent-controlled Ego TaskSpace:
// sed -e 's/__TASK_SPACE_ID__/<id>/g' -e 's|__BASE_URL__|<Local URL>|g' scripts/verify-nav-dropdown.mjs | ego-browser nodejs
import assert from 'node:assert/strict'

const spaceId = Number('__TASK_SPACE_ID__')
assert.ok(
  Number.isInteger(spaceId) && spaceId > 0,
  'Substitute the TaskSpace id'
)
const task = await taskSpace(spaceId)
const page = task.page('p1')
const base = new URL('__BASE_URL__').href
await page.cdp('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
})
await page.goto(base)
await page.waitForFunction(
  () => !!document.querySelector('#nav-menu-blogs')?.closest('[data-bound]')
)
await page.mouse.click(100, 120)
await page.hover('a[aria-label="文稿"]')

// Hover opens the menu without moving focus into it; Escape must still close it.
await page.keyboard.press('Escape')
assert.equal(
  await page.evaluate(() =>
    document.querySelector('#nav-menu-blogs').checkVisibility()
  ),
  false,
  'Escape also dismisses a pointer-only menu'
)
assert.equal(
  await page.evaluate(() =>
    document.querySelector('a[aria-label="文稿"]').getAttribute('aria-expanded')
  ),
  'false'
)
await page.mouse.move(100, 120)
await page.hover('a[aria-label="文稿"]')
await page.waitForFunction(() =>
  document.querySelector('#nav-menu-blogs').checkVisibility()
)
await page.evaluate(() => document.fonts.ready.then(() => true))

const visibleCategory = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.nav-dropdown__preview')]
      .filter((node) => node.checkVisibility())
      .map((node) => node.dataset.previewCategory)
  )
const rows = await page.evaluate(() =>
  [...document.querySelectorAll('.nav-dropdown__category-link')].map(
    (node) => ({
      ...node.getBoundingClientRect().toJSON(),
      href: node.getAttribute('href'),
      id: node.closest('[data-preview-category]').dataset.previewCategory,
    })
  )
)
if (rows.length >= 2) {
  const [first, second] = rows
  const selector = (row) =>
    `#nav-menu-blogs a[href=${JSON.stringify(row.href)}]`
  assert.ok(second.top > first.bottom, 'Exercise the actual gap between rows')
  const x = first.left + first.width / 2
  const gap = (first.bottom + second.top) / 2
  const hoverCategory = async (row) => {
    await page.hover(selector(row))
    await page.waitForFunction(
      (id) =>
        [...document.querySelectorAll('.nav-dropdown__preview')].some(
          (node) =>
            node.dataset.previewCategory === id && node.checkVisibility()
        ),
      row.id
    )
  }
  await hoverCategory(second)
  assert.deepEqual(await visibleCategory(), [second.id])
  await page.mouse.move(x, gap)
  assert.deepEqual(
    await visibleCategory(),
    [second.id],
    'Crossing the gap must not flash the default category'
  )
  await hoverCategory(first)
  assert.deepEqual(await visibleCategory(), [first.id])
  await page.mouse.move(x, gap)
  assert.deepEqual(
    await visibleCategory(),
    [first.id],
    'Reverse movement must keep the previous category'
  )
  await page.mouse.move(first.right + 10, first.top + 10)
  assert.deepEqual(
    await visibleCategory(),
    [first.id],
    'Entering the preview gutter must not reset the category'
  )
  await page.focus(selector(second))
  assert.deepEqual(
    await visibleCategory(),
    [second.id],
    'Keyboard focus must also select the preview'
  )
} else {
  console.log(
    'Gap and cross-category switching checks skipped: fewer than two published categories'
  )
}
await page.keyboard.press('Escape')
assert.equal(
  await page.evaluate(() =>
    document.querySelector('#nav-menu-blogs').checkVisibility()
  ),
  false
)
await page.cdp('Emulation.setDeviceMetricsOverride', {
  width: 320,
  height: 800,
  deviceScaleFactor: 1,
  mobile: false,
})
await page.goto(base)
await page.hover('a[aria-label="文稿"]')
const mobile = await page.evaluate(() => {
  const panel = document.querySelector('#nav-menu-blogs')
  const rect = panel.getBoundingClientRect()
  return {
    bounded:
      rect.left >= 0 &&
      rect.right <= innerWidth + 1 &&
      rect.bottom <= innerHeight + 1,
  }
})
assert.equal(
  mobile.bounded,
  true,
  'mobile menu is scrollable within the viewport'
)
console.log(
  'Dropdown Escape and viewport bounds: passed; cross-category checks require at least two published categories'
)
