/* global taskSpace */
// Run in the current worktree's Ego TaskSpace against its actual server address.
import assert from 'node:assert/strict'
const task = await taskSpace(Number('__TASK_SPACE_ID__'))
const page = task.page('p1')
const base = '__BASE_URL__'

await page.goto(new URL('interests/book/', base).href)
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
      const frames = [...rail.querySelectorAll('.media-card .image-view')].map(
        (view) => view.getBoundingClientRect()
      )
      return {
        hasTrack: !!rail.querySelector(':scope > .media-cards__track'),
        sameRow: frames.every(
          (frame) => Math.abs(frame.top - frames[0].top) < 1
        ),
        portrait: frames.every(
          (frame) => Math.abs(frame.width / frame.height - 2 / 3) < 0.01
        ),
        pageOverflow: document.documentElement.scrollWidth > innerWidth,
      }
    })
  )
  assert.ok(groups.length > 0)
  for (const group of groups)
    assert.deepEqual(
      group,
      {
        hasTrack: true,
        sameRow: true,
        portrait: true,
        pageOverflow: false,
      },
      `${width}: same-category books share a portrait rail`
    )
}

await page.cdp('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
})
await page.goto(base)
await page.waitForFunction(
  () =>
    document.querySelector('.recent-listening .media-cards--auto')?.dataset
      .marquee === 'on'
)
const markup = await page.evaluate(() => {
  const root = document.querySelector('.recent-listening')
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
    metadata: originals.every((card) =>
      card.querySelector('.media-card__meta').textContent.includes(' - ')
    ),
    originalNotPreloaded: !performance
      .getEntriesByType('resource')
      .some((entry) => entry.name.includes('/i/u/ar0/')),
  }
})
assert.equal(markup.cloneCount, markup.originalCount)
assert.equal(markup.clonesMuted, true)
assert.equal(markup.metadata, true)
assert.equal(markup.originalNotPreloaded, true)

await page.focus('.recent-listening .media-cards--auto')
assert.equal(
  await page.evaluate(
    () =>
      getComputedStyle(
        document.querySelector('.recent-listening .media-cards__track')
      ).animationPlayState
  ),
  'paused'
)
// Put the first clone in view to exercise document delegation, not copied listeners.
await page.evaluate(() => {
  const track = document.querySelector('.recent-listening .media-cards__track')
  const animation = track.getAnimations()[0]
  animation.currentTime = Number(animation.effect.getTiming().duration) * 0.98
})
const source = await page.evaluate(() => {
  const rail = document.querySelector('.recent-listening .media-cards--auto')
  const bounds = rail.getBoundingClientRect()
  const image = [
    ...rail.querySelectorAll('[data-marquee-clone] > .image-view > img'),
  ].find((image) => {
    const rect = image.getBoundingClientRect()
    return rect.left > bounds.left + 24 && rect.right < bounds.right - 24
  })
  if (!image) throw new Error('A complete clone cover must be visible')
  image.id = 'card-rails-cover'
  return image
    .closest('.image-view')
    .querySelector('template')
    .content.querySelector('img').src
})
await page.click('#card-rails-cover')
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
assert.equal(
  await page.evaluate(() => document.activeElement.id),
  'card-rails-cover'
)

await page.cdp('Emulation.setEmulatedMedia', {
  features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
})
await page.waitForFunction(
  () => !document.querySelector('.recent-listening [data-marquee-clone]')
)
assert.equal(
  await page.evaluate(() => {
    const rail = document.querySelector('.recent-listening .media-cards--rail')
    return rail.scrollWidth > rail.clientWidth && !rail.dataset.marquee
  }),
  true
)

await page.cdp('Emulation.setScriptExecutionDisabled', { value: true })
await page.reload()
const nojs = await page.evaluate(() => {
  const root = document.querySelector('.recent-listening')
  const rail = root.querySelector('.media-cards--rail')
  return {
    clones: root.querySelectorAll('[data-marquee-clone]').length,
    scrollable: rail.scrollWidth > rail.clientWidth,
  }
})
assert.deepEqual(nojs, { clones: 0, scrollable: true })
await page.cdp('Emulation.setScriptExecutionDisabled', { value: false })
await page.cdp('Emulation.setEmulatedMedia', { features: [] })
await page.reload()
console.log(
  'Card rails: book grouping, listening loop/clones, separator, original zoom, focus, reduced motion and no-JS passed'
)
