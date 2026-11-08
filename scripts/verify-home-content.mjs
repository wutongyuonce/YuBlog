/* global taskSpace */
// sed -e 's/__TASK_SPACE_ID__/<id>/g' -e 's|__BASE_URL__|<Local URL>|g' scripts/verify-home-content.mjs | ego-browser nodejs
import assert from 'node:assert/strict'

const task = await taskSpace(Number('__TASK_SPACE_ID__'))
const page = task.page('p1')
const base = new URL('__BASE_URL__').href

for (const width of [1440, 390, 320]) {
  await page.goto(base)
  await page.cdp('Emulation.setDeviceMetricsOverride', {
    width,
    height: 800,
    deviceScaleFactor: 1,
    mobile: false,
  })
  assert.equal(await page.evaluate(() => innerWidth), width)
  // 封面懒加载且条目超出横滑栏：只要求滚到区块后栏内可见的封面都已加载。
  await page.evaluate(() =>
    document
      .querySelector('.recent-media')
      .scrollIntoView({ block: 'center', behavior: 'instant' })
  )
  await page.waitForFunction(() => {
    const rail = document
      .querySelector('.recent-media .media-cards--rail')
      .getBoundingClientRect()
    const visible = [
      ...document.querySelectorAll('.recent-media .media-card img'),
    ].filter((img) => {
      const box = img.getBoundingClientRect()
      return box.right > rail.left && box.left < rail.right
    })
    return (
      visible.length > 0 &&
      visible.every((img) => img.complete && img.naturalWidth > 0)
    )
  })
  for (const dark of [false, true]) {
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      dark
    )
    // 区块顺序、「全部拾趣」与不自动滚动由 built 首页检查负责；这里只看需要真实渲染的可读性与裁切。
    const { readable, bodiesFit } = await page.evaluate(() => {
      const body = document.querySelector('.recent-media__body')
      const ctx = document.createElement('canvas').getContext('2d')
      const surface = getComputedStyle(
        document.documentElement
      ).getPropertyValue('--c-bg')
      const luminance = (color) => {
        // Portrait cards are transparent: composite over the real page surface,
        // not the previous foreground pixel left in the canvas.
        ctx.fillStyle = surface
        ctx.fillRect(0, 0, 1, 1)
        ctx.fillStyle = color
        ctx.fillRect(0, 0, 1, 1)
        const [r, g, b] = [...ctx.getImageData(0, 0, 1, 1).data].map((byte) => {
          const c = byte / 255
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
        })
        return 0.2126 * r + 0.7152 * g + 0.0722 * b
      }
      const contrast = (fg, bg) => {
        const a = luminance(fg),
          b = luminance(bg)
        return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)
      }
      const titles = [
        ...body.querySelectorAll(
          '.media-card:not([data-marquee-clone]) .media-card__title'
        ),
      ]
      return {
        readable:
          titles.length > 0 &&
          titles.every((node) => {
            const style = getComputedStyle(node)
            const background = getComputedStyle(
              node.closest('.media-card')
            ).backgroundColor
            return contrast(style.color, background) >= 4.5
          }),
        // 窄卡里标题与短评不能横向溢出被裁掉。
        bodiesFit: [
          ...body.querySelectorAll(
            '.media-card:not([data-marquee-clone]) .media-card__body'
          ),
        ].every((card) => card.scrollWidth <= card.clientWidth + 1),
      }
    })
    assert.equal(
      readable,
      true,
      `${width}/${dark}: card titles reach 4.5:1 contrast`
    )
    assert.equal(
      bodiesFit,
      true,
      `${width}/${dark}: card text is not clipped by a narrow card`
    )
  }
}

// Build a multi-post fixture from any calendar day, even if real days are all single-post.
// Exercise the real handlers and fire their captured timers deterministically.
const state = await page.evaluate(() => {
  const root = document.querySelector('[data-writing-heatmap]')
  if (!root) {
    if (document.querySelector('.recent-writing__item'))
      throw new Error('Published posts require a writing heatmap')
    return { emptyState: true }
  }
  const cell = root.querySelector('[data-date]')
  const button = document.createElement('button')
  for (const { name, value } of cell.attributes)
    button.setAttribute(name, value)
  button.removeAttribute('href')
  button.removeAttribute('aria-hidden')
  button.type = 'button'
  button.dataset.level = '4'
  button.setAttribute('aria-label', 'Test fixture: 30 posts')
  cell.replaceWith(button)
  const panel = button.closest('[data-year-panel]')
  const yearInput = root.querySelector(
    `input[name="writing-heatmap-year"][value="${panel.dataset.yearPanel}"]`
  )
  if (yearInput) yearInput.checked = true
  const date = button.dataset.date
  const posts = Array.from({ length: 30 }, (_, index) => ({
    title: `LongTitle${index}${'x'.repeat(60)}`,
    href: `/blogs/post-${index}/`,
  }))
  root.dataset.heatmapIndex = JSON.stringify({ [date]: posts })
  document.dispatchEvent(new Event('astro:before-swap'))
  const replacement = root.cloneNode(true)
  delete replacement.dataset.bound
  delete replacement.dataset.yearPickerBound
  root.replaceWith(replacement)
  document.dispatchEvent(new Event('astro:page-load'))
  const nextButton = replacement.querySelector(`button[data-date="${date}"]`)
  const tip = replacement.querySelector('[data-heatmap-tip]')
  const timers = []
  const originalTimeout = window.setTimeout
  const originalClear = window.clearTimeout
  window.setTimeout = (callback) => {
    timers.push(callback)
    return -timers.length
  }
  window.clearTimeout = (id) => {
    if (id >= 0) originalClear(id)
  }
  nextButton.click()
  tip.dispatchEvent(new Event('pointerleave'))
  timers.splice(0).forEach((callback) => callback())
  const focusedSurvives = !tip.hidden && tip.contains(document.activeElement)
  const box = tip.getBoundingClientRect()
  const link = tip.querySelector('a')
  const readable = link.scrollWidth <= link.clientWidth + 1
  const bounded =
    box.top >= 0 &&
    box.bottom <= innerHeight + 1 &&
    tip.scrollHeight > tip.clientHeight
  document.activeElement.blur()
  tip.dispatchEvent(new Event('pointerenter'))
  tip.scrollTop = 100
  tip.dispatchEvent(new Event('scroll'))
  const pointerScrollSurvives = !tip.hidden && tip.scrollTop > 0
  tip.querySelector('a').focus()
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  const restoredFocus = document.activeElement === nextButton && tip.hidden
  nextButton.dispatchEvent(new Event('pointerout', { bubbles: true }))
  const oldTimers = timers.splice(0)
  document.dispatchEvent(new Event('astro:before-swap'))
  const fresh = replacement.cloneNode(true)
  delete fresh.dataset.bound
  delete fresh.dataset.yearPickerBound
  replacement.replaceWith(fresh)
  document.dispatchEvent(new Event('astro:page-load'))
  fresh.querySelector(`button[data-date="${date}"]`).click()
  oldTimers.forEach((callback) => callback())
  const newTipSurvives = !fresh.querySelector('[data-heatmap-tip]').hidden
  window.setTimeout = originalTimeout
  window.clearTimeout = originalClear
  return {
    focusedSurvives,
    readable,
    bounded,
    pointerScrollSurvives,
    restoredFocus,
    newTipSurvives,
  }
})
for (const [name, passed] of Object.entries(state))
  assert.equal(passed, true, name)
if (state.emptyState)
  console.log(
    'No published posts: heatmap absent; tooltip checks not applicable'
  )

await page.cdp('Emulation.setScriptExecutionDisabled', { value: true })
try {
  await page.goto('about:blank')
  await page.goto(base)
  const noJs = await page.evaluate(() => {
    const radios = [
      ...document.querySelectorAll('input[name="writing-heatmap-year"]'),
    ]
    if (radios.length < 2) return null // Single-year calendar has no switch.
    const option = radios.find((item) => !item.checked)
    if (!option) return null
    option.checked = true
    return { year: option.value }
  })
  if (noJs) {
    assert.equal(
      await page.evaluate(
        (year) =>
          document
            .querySelector(`[data-year-panel="${year}"]`)
            .getBoundingClientRect().height > 0,
        noJs.year
      ),
      true,
      'the selected year is visible without scripts'
    )
  }
} finally {
  await page.cdp('Emulation.setScriptExecutionDisabled', { value: false })
}
console.log(
  'Home cards, heatmap state/fixture interaction and no-JS years: passed'
)
