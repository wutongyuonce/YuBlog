/* global taskSpace */
// Run inside an existing agent-controlled Ego TaskSpace:
// sed 's/__TASK_SPACE_ID__/<id>/' scripts/verify-nav-dropdown.mjs | ego-browser nodejs
import assert from 'node:assert/strict'

const spaceId = Number('__TASK_SPACE_ID__')
assert.ok(
  Number.isInteger(spaceId) && spaceId > 0,
  'Substitute the TaskSpace id'
)
const task = await taskSpace(spaceId)
const page = task.page('p1')
await page.goto('http://127.0.0.1:4322/')
await page.mouse.click(100, 120)
await page.hover('a[aria-label="文稿"]')

// Hover opens the menu without moving focus into it; Escape must still close it.
await page.keyboard.press('Escape')
assert.equal(
  await page.evaluate(
    () => getComputedStyle(document.querySelector('#nav-menu-blogs')).display
  ),
  'none',
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

const visibleCategory = () =>
  page.evaluate(() =>
    [...document.querySelectorAll('.nav-dropdown__preview')]
      .filter((node) => getComputedStyle(node).display !== 'none')
      .map((node) => node.dataset.previewCategory)
  )
const rows = await page.evaluate(() =>
  [...document.querySelectorAll('.nav-dropdown__category-link')].map((node) =>
    node.getBoundingClientRect().toJSON()
  )
)
assert.ok(
  rows.length >= 3,
  'Built-in groups remain ahead of discovered categories'
)
assert.ok(rows[2].top > rows[1].bottom, 'Exercise the actual gap between rows')
assert.ok(
  rows[1].top - rows[0].bottom < 16 && rows[2].top - rows[1].bottom < 16,
  'Category links stay packed from the top; preview height must not distribute them'
)
const x = rows[1].left + rows[1].width / 2
await page.hover('a[href="/blogs/#thought"]')
assert.deepEqual(await visibleCategory(), ['thought'])
await page.mouse.move(x, (rows[1].bottom + rows[2].top) / 2)
assert.deepEqual(
  await visibleCategory(),
  ['thought'],
  'Crossing the gap must not flash the default category'
)
await page.hover('a[href="/blogs/#diary"]')
assert.deepEqual(await visibleCategory(), ['diary'])
await page.mouse.move(x, (rows[1].bottom + rows[2].top) / 2)
assert.deepEqual(
  await visibleCategory(),
  ['diary'],
  'Reverse movement must keep the previous category'
)
await page.mouse.move(rows[2].right + 10, rows[2].top + 10)
assert.deepEqual(
  await visibleCategory(),
  ['diary'],
  'Entering the preview gutter must not reset the category'
)
await page.focus('a[href="/blogs/#thought"]')
assert.deepEqual(
  await visibleCategory(),
  ['thought'],
  'Keyboard focus must also select the preview'
)
await page.keyboard.press('Escape')
assert.equal(
  await page.evaluate(
    () => getComputedStyle(document.querySelector('#nav-menu-blogs')).display
  ),
  'none'
)
console.log(
  'Dropdown gap, reverse movement, preview gutter, keyboard focus and Escape: passed'
)
