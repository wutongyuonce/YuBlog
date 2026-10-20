/* global taskSpace */
// sed -e 's/__TASK_SPACE_ID__/<id>/g' -e 's|__ARTICLE_URL__|<Article URL>|g' scripts/verify-media-focus.mjs | ego-browser nodejs
// Use an article containing an interactive image and an Excalidraw card.
import assert from 'node:assert/strict'

const task = await taskSpace(Number('__TASK_SPACE_ID__'))
const page = task.page('p1')
await page.goto('__ARTICLE_URL__')
const image = 'img[data-focus-check]'
await page.waitForSelector('.image-view--interactive > img')
await page.evaluate(async () => {
  document.documentElement.style.scrollBehavior = 'auto'
  await document.fonts.ready
  const target = document.querySelector('.image-view--interactive > img')
  target.dataset.focusCheck = ''
  target.scrollIntoView({ behavior: 'instant', block: 'center' })
  await new Promise(requestAnimationFrame)
})

const focusState = () =>
  page.evaluate(() => {
    const active = document.activeElement
    const style = getComputedStyle(active)
    const shadow = document.createElement('span')
    shadow.style.boxShadow = style.getPropertyValue('--un-ring-shadow')
    document.body.append(shadow)
    const ring = getComputedStyle(shadow).boxShadow
    shadow.style.boxShadow = '0 0 transparent'
    const transparentRing = ring === getComputedStyle(shadow).boxShadow
    shadow.remove()
    return {
      method: document.documentElement.dataset.inputMethod,
      tag: active.tagName,
      outline: style.outlineStyle,
      transparentRing,
      parentOutline: getComputedStyle(active.parentElement).outlineStyle,
    }
  })

await page.click(image)
await page.waitForSelector('.image-lightbox[open]')
await page.click('.image-lightbox__close')
let state = await focusState()
assert.equal(state.tag, 'IMG', 'closing returns focus to the original image')
assert.equal(state.method, 'pointer')
assert.equal(state.outline, 'none')
assert.equal(state.parentOutline, 'none', 'pointer restore has no image frame')
assert.equal(state.transparentRing, true, 'pointer restore has no utility ring')

await page.keyboard.press('Tab')
await page.keyboard.press('Shift+Tab')
state = await focusState()
assert.equal(state.tag, 'IMG')
assert.equal(state.method, undefined)
assert.equal(state.parentOutline, 'solid', 'keyboard image focus stays visible')
await page.keyboard.press('Enter')
await page.waitForSelector('.image-lightbox[open]')
assert.equal(
  (await focusState()).outline,
  'solid',
  'modal close is keyboard visible'
)
await page.keyboard.press('Escape')
assert.equal((await focusState()).parentOutline, 'solid')

await page.evaluate(() =>
  document
    .querySelector('.excalidraw-embed')
    .scrollIntoView({ behavior: 'instant', block: 'center' })
)
await page.waitForSelector('.excalidraw-embed--canvas-ready')
await page.click('button[aria-label="展开画布"]')
await page.waitForSelector('.excalidraw-expand[open]')
await page.waitForFunction(
  () =>
    document.querySelector('.excalidraw-expand .excalidraw-view__image')?.style
      .visibility === 'visible'
)
const close = await page.evaluate(() => {
  const button = document.querySelector('.excalidraw-expand__close')
  const rect = button.getBoundingClientRect()
  const icon = button.querySelector('svg').getBoundingClientRect()
  const dialog = document.querySelector('.excalidraw-expand')
  return {
    centered:
      Math.abs(rect.x + rect.width / 2 - icon.x - icon.width / 2) < 0.1 &&
      Math.abs(rect.y + rect.height / 2 - icon.y - icon.height / 2) < 0.1,
    background: getComputedStyle(button).backgroundColor,
    border: getComputedStyle(button).borderTopWidth,
    dialogOutline: getComputedStyle(dialog).outlineStyle,
  }
})
assert.equal(close.centered, true)
assert.equal(close.background, 'rgba(0, 0, 0, 0)')
assert.equal(close.border, '0px')
assert.equal(close.dialogOutline, 'none')
await page.click('.excalidraw-expand__close')
await page.waitForSelector('.excalidraw-expand', { state: 'detached' })
state = await focusState()
assert.equal(state.method, 'pointer')
assert.equal(state.outline, 'none')
console.log(
  'PASS: pointer focus has no extra rings; keyboard focus and modal restore work; close icon is centered.'
)
