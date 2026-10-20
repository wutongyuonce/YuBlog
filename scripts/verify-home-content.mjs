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
  await page.waitForFunction(() =>
    [
      ...document.querySelectorAll(
        '.recent-media .media-card:not([data-marquee-clone]) img'
      ),
    ].every((img) => img.complete && img.naturalWidth > 0)
  )
  for (const dark of [false, true]) {
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      dark
    )
    const layout = await page.evaluate(() => {
      const body = document.querySelector('.recent-media__body')
      const section = body.closest('.recent-media')
      const listening = document.querySelector('.recent-listening')
      const writing = document.querySelector('.recent-writing')
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
      return {
        aboveListening:
          section.getBoundingClientRect().bottom <=
          listening.getBoundingClientRect().top,
        belowWriting:
          writing.getBoundingClientRect().bottom <=
          section.getBoundingClientRect().top,
        hasIndexLink: [...section.querySelectorAll('a')].some(
          (link) => link.textContent.trim() === '全部拾趣'
        ),
        noAutoScroll: !section.querySelector('.media-cards--auto'),
        coversLoaded: [
          ...body.querySelectorAll('.media-card:not([data-marquee-clone]) img'),
        ].every((img) => img.complete && img.naturalWidth > 0),
        readable: [
          ...body.querySelectorAll('.media-card__title, .media-card__label'),
        ].every((node) => {
          const style = getComputedStyle(node)
          const background = node.classList.contains('media-card__label')
            ? style.backgroundColor
            : getComputedStyle(node.closest('.media-card')).backgroundColor
          return contrast(style.color, background) >= 4.5
        }),
        headings: [...body.querySelectorAll('h1,h2,h3,h4,h5,h6')].every(
          (heading) =>
            heading.querySelector('.header-anchor')?.getAttribute('href') ===
            `#${heading.id}`
        ),
        scoresFit: [...body.querySelectorAll('.media-card__body')].every(
          (card) => card.scrollWidth <= card.clientWidth + 1
        ),
      }
    })
    for (const name of [
      'aboveListening',
      'belowWriting',
      'hasIndexLink',
      'noAutoScroll',
      'coversLoaded',
    ])
      assert.equal(layout[name], true, `${width}/${dark}: ${name}`)
    assert.equal(
      layout.readable,
      true,
      'card labels and titles reach 4.5:1 contrast'
    )
    assert.equal(
      layout.headings,
      true,
      'home retains ordinary Markdown anchors'
    )
    assert.equal(
      layout.scoresFit,
      true,
      'scores must not be cropped by a narrow card'
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
