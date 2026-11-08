/* global taskSpace */
// Run in the current worktree's Ego TaskSpace against its actual server address.
import assert from 'node:assert/strict'
const task = await taskSpace(Number('__TASK_SPACE_ID__'))
const page = task.page('p1')
const base = '__BASE_URL__'

// 样式指南里的竖卡栏与方卡栏：每组一条轨道、同排、按布局裁切、不撑宽页面。
await page.goto(new URL('blogs/content-style-guide/', base).href)
await page.waitForSelector('.media-cards--rail')
for (const width of [1440, 390, 320]) {
  await page.cdp('Emulation.setDeviceMetricsOverride', {
    width,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  const groups = await page.evaluate(() =>
    [...document.querySelectorAll('.media-cards--rail')].map((rail) => {
      const cards = [
        ...rail.querySelectorAll('.media-card:not([data-marquee-clone])'),
      ]
      const layout = cards[0].classList.contains('media-card--portrait')
        ? 'portrait'
        : 'square'
      const ratio = layout === 'portrait' ? 2 / 3 : 1
      const frames = cards.map((card) =>
        card.querySelector('.image-view').getBoundingClientRect()
      )
      return {
        layout,
        hasTrack: !!rail.querySelector(':scope > .media-cards__track'),
        sameLayout: cards.every((card) =>
          card.classList.contains(`media-card--${layout}`)
        ),
        sameRow: frames.every(
          (frame) => Math.abs(frame.top - frames[0].top) < 1
        ),
        cropped: frames.every(
          (frame) => Math.abs(frame.width / frame.height - ratio) < 0.01
        ),
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
      }
    })
  )
  assert.deepEqual(groups.map((group) => group.layout).sort(), [
    'portrait',
    'square',
  ])
  for (const { layout, ...group } of groups)
    assert.deepEqual(
      group,
      {
        hasTrack: true,
        sameLayout: true,
        sameRow: true,
        cropped: true,
        pageOverflow: false,
      },
      `${width}: the ${layout} rail keeps one row of cropped covers`
    )
}

// 方卡自动滚动栏：循环副本、暂停、副本点开大图与焦点回退、减少动态。
await page.cdp('Emulation.setDeviceMetricsOverride', {
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  mobile: false,
})
await page.cdp('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
})
await page.goto(new URL('blogs/content-style-guide/', base).href)
const rail = '.media-cards--auto'
await page.waitForFunction(
  (selector) => document.querySelector(selector)?.dataset.marquee === 'on',
  rail
)
const markup = await page.evaluate((selector) => {
  const root = document.querySelector(selector)
  const originals = [
    ...root.querySelectorAll('.media-card:not([data-marquee-clone])'),
  ]
  const clones = [...root.querySelectorAll('[data-marquee-clone]')]
  return {
    originalCount: originals.length,
    cloneCount: clones.length,
    clonesMuted: clones.every(
      (clone) =>
        clone.getAttribute('aria-hidden') === 'true' &&
        [...clone.querySelectorAll('[tabindex]')].every(
          (node) => node.tabIndex === -1
        )
    ),
  }
}, rail)
assert.ok(markup.originalCount > 0)
assert.equal(markup.cloneCount, markup.originalCount)
assert.equal(markup.clonesMuted, true)

await page.focus(rail)
assert.equal(
  await page.evaluate(
    (selector) =>
      getComputedStyle(
        document.querySelector(`${selector} .media-cards__track`)
      ).animationPlayState,
    rail
  ),
  'paused'
)
// Put the first clone in view to exercise document delegation, not copied listeners.
const source = await page.evaluate((selector) => {
  const root = document.querySelector(selector)
  const bounds = root.getBoundingClientRect()
  const animation = root.querySelector('.media-cards__track').getAnimations()[0]
  animation.currentTime = Number(animation.effect.getTiming().duration) * 0.98
  const image = [
    ...root.querySelectorAll('[data-marquee-clone] .image-view img'),
  ].find((image) => {
    const rect = image.getBoundingClientRect()
    return rect.left > bounds.left + 24 && rect.right < bounds.right - 24
  })
  if (!image) throw new Error('A complete clone cover must be visible')
  image.id = 'card-rails-cover'
  const view = image.closest('.image-view')
  const original = view
    .querySelector('template')
    ?.content.querySelector('img')
    ?.getAttribute('src')
  return new URL(original ?? image.currentSrc, location.href).href
}, rail)
// 在页内派发点击：ego 合成的鼠标点击在正文图片上也不会触发查看器，这里验证的是副本委托。
await page.evaluate(() => document.querySelector('#card-rails-cover').click())
await page.waitForSelector('dialog.image-lightbox[open]')
assert.equal(
  await page.evaluate(
    () => document.querySelector('dialog.image-lightbox img').src
  ),
  source
)
await page.press('dialog.image-lightbox', 'Escape')
await page.waitForFunction(
  () => !document.querySelector('dialog.image-lightbox').open
)
// 查看器按图片把副本对应到文中的源卡片；这篇里同一张图也出现在上方的竖卡栏，
// 所以只断言焦点回到真实卡片而不是循环副本。
assert.equal(
  await page.evaluate(
    () =>
      !!document.activeElement?.closest('.media-card') &&
      !document.activeElement.closest('[data-marquee-clone]')
  ),
  true,
  'closing a clone returns focus to a source card, not a duplicate tab stop'
)

await page.cdp('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
})
await page.waitForFunction(
  (selector) =>
    !document.querySelector(`${selector} [data-marquee-clone]`) &&
    !document.querySelector(selector).dataset.marquee,
  rail
)
await page.cdp('Emulation.setEmulatedMedia', { features: [] })
console.log(
  'Card rails: portrait/square rail shape, auto-rail loop/clones/pause/zoom/focus, reduced motion passed'
)
