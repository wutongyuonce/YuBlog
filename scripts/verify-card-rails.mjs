/* global taskSpace */
// Run in the current worktree's Ego TaskSpace against its actual server address.
import assert from 'node:assert/strict'
const task = await taskSpace(Number('__TASK_SPACE_ID__'))
const page = task.page('p1')
const base = '__BASE_URL__'

// 听歌数据只在运行时取得：固定一份载荷替换接口，让卡片、循环和查看器都可复现。
const cover = (id, size) =>
  `https://lastfm-img.freetls.fastly.net/i/u/${size}/${id}.jpg`
const listening = {
  updatedAt: '2026-10-15T07:29:23.000Z',
  weeklyScrobbles: 39,
  totalScrobbles: 219,
  topArtist: 'Gareth.T',
  tracks: Array.from({ length: 6 }, (_, index) => ({
    name: `歌曲 ${index + 1}`,
    artist: `歌手 ${index + 1}`,
    album: index === 5 ? null : `专辑 ${index + 1}`,
    cover: index === 5 ? null : cover(`cover-${index + 1}`, '300x300'),
    fullCover: index === 5 ? null : cover(`cover-${index + 1}`, 'ar0'),
    url: `https://www.last.fm/music/artist${index + 1}/_/song${index + 1}`,
    playcount: 7,
  })),
}
await page.cdp('Page.addScriptToEvaluateOnNewDocument', {
  source: `(() => {
  const payload = ${JSON.stringify(listening)}
  const real = window.fetch.bind(window)
  const mode = window.localStorage.getItem('listening-stub') || 'ready'
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url
    if (!url.endsWith('/api/lastfm')) return real(input, init)
    const body =
      mode === 'fail'
        ? { status: 503, text: '{}' }
        : {
            status: 200,
            text: JSON.stringify(
              mode === 'empty'
                ? { ...payload, weeklyScrobbles: 0, totalScrobbles: 0, topArtist: null, tracks: [] }
                : payload
            ),
          }
    const response = new Response(body.text, {
      status: body.status,
      headers: { 'content-type': 'application/json' },
    })
    if (new URL(location.href).searchParams.has('listening-layout')) {
      return new Promise(resolve => {
        window.__releaseListening = payload => {
          resolve(payload ? new Response(JSON.stringify(payload), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          }) : response)
        }
      })
    }
    return Promise.resolve(response)
  }
})()`,
})

// Hold the API until fonts settle, then measure the real loading → ready path.
// Both short content and two-line content must fit the same reserved space.
for (const motion of ['no-preference', 'reduce']) {
  await page.cdp('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: motion }],
  })
  for (const width of [1440, 390, 320]) {
    await page.cdp('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    for (const long of [false, true]) {
      await page.goto(new URL('?listening-layout', base).href)
      await page.waitForFunction(() => !!window.__releaseListening)
      await page.evaluate(async () => {
        await document.fonts.ready
        window.__listeningLayout = () => {
          const root = document.querySelector('[data-listening]')
          const top = root.getBoundingClientRect().top
          return [
            root.getBoundingClientRect().height,
            ...[
              '.recent-listening__stats',
              '.media-cards',
              '.recent-listening__updated',
            ].map(
              (selector) =>
                root.querySelector(selector).getBoundingClientRect().top - top
            ),
          ]
        }
      })
      const before = await page.evaluate(() => window.__listeningLayout())
      const checkBottomAnchor =
        motion === 'no-preference' && width === 1440 && long
      if (checkBottomAnchor) {
        await page.evaluate(() => {
          document.documentElement.style.scrollBehavior = 'auto'
          window.scrollTo(0, document.documentElement.scrollHeight)
          window.__listeningBottomY = window.scrollY
        })
      }
      const checkCoverSurface =
        motion === 'no-preference' && width === 1440 && !long
      const loadingCoverBackground = checkCoverSurface
        ? await page.evaluate(
            () =>
              getComputedStyle(
                document.querySelector('.recent-listening__skeleton-cover')
              ).backgroundColor
          )
        : ''
      const payload = {
        ...listening,
        weeklyScrobbles: long ? 1234567 : 0,
        totalScrobbles: long ? 123456789 : 1,
        topArtist: long
          ? 'A very long artist name that must remain accessible'
          : 'A',
        tracks: Array.from({ length: long ? 10 : 1 }, (_, index) => ({
          ...listening.tracks[index % listening.tracks.length],
          name: long ? 'A long song title spanning more than two lines' : 'A',
          album: long
            ? 'A long album description spanning more than two lines'
            : null,
        })),
      }
      await page.evaluate(
        (payload) => window.__releaseListening(payload),
        payload
      )
      await page.waitForFunction(
        () =>
          document.querySelector('[data-listening]')?.dataset.state === 'ready'
      )
      await page.evaluate(
        () =>
          new Promise((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(resolve))
          )
      )
      const after = await page.evaluate(() => window.__listeningLayout())
      if (checkBottomAnchor) {
        assert.equal(
          await page.evaluate(() => {
            const root = document.querySelector('[data-listening]')
            return (
              Math.abs(window.scrollY - window.__listeningBottomY) <= 1 &&
              root.getBoundingClientRect().bottom <= window.innerHeight + 1
            )
          }),
          true,
          'replacing the skeleton at the bottom keeps the cards in view'
        )
      }
      if (motion === 'no-preference' && width === 1440 && long) {
        assert.equal(
          await page.evaluate(() => {
            const rail = document.querySelector(
              '.recent-listening .media-cards--rail'
            )
            rail.removeAttribute('data-marquee')
            return getComputedStyle(rail).overflowX
          }),
          'hidden',
          'the listening rail stays clipped without waiting for the marquee'
        )
      }
      if (checkCoverSurface) {
        assert.equal(
          await page.evaluate(
            () =>
              getComputedStyle(
                document.querySelector(
                  '[data-listening] .media-card .image-view'
                )
              ).backgroundColor
          ),
          loadingCoverBackground,
          'a rendered cover frame keeps the skeleton surface'
        )
      }
      if (width === 1440) {
        const spacing = await page.evaluate(() => {
          const stats = document.querySelector('.recent-listening__stats')
          const textBoxes = [...stats.children].map((item) => {
            const range = document.createRange()
            range.selectNodeContents(item)
            const { left, right } = range.getBoundingClientRect()
            return { left, right }
          })
          return {
            gap: parseFloat(getComputedStyle(stats).columnGap),
            gaps: textBoxes
              .slice(1)
              .map((box, index) => box.left - textBoxes[index].right),
          }
        })
        assert.ok(
          spacing.gaps.every((gap) => Math.abs(gap - spacing.gap) <= 1),
          'listening statistics stay one gap apart instead of filling equal columns'
        )
      }
      for (let index = 0; index < before.length; index++) {
        assert.ok(
          Math.abs(after[index] - before[index]) <= 1,
          `${width}px/${motion}/${long ? 'long' : 'short'}: listening height and row positions remain stable (${before} → ${after})`
        )
      }
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth
        ),
        true
      )
    }
  }
}
await page.cdp('Emulation.setEmulatedMedia', { features: [] })

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
// 卡片在接口载荷到达后才存在；先等区块离开加载状态，失败会停在明确的状态上。
await page.waitForFunction(
  () => document.querySelector('.recent-listening')?.dataset.state === 'ready'
)
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
    stats: [...root.querySelectorAll('[data-listening-stat]')].map(
      (node) => node.textContent
    ),
    updated: root.querySelector('[data-listening-time]').textContent,
    placeholder: originals.filter((card) =>
      card.querySelector('.recent-listening__placeholder')
    ).length,
    placeholderSized: originals.every((card) => {
      const node = card.querySelector('.recent-listening__placeholder')
      if (!node) return true
      const box = node.getBoundingClientRect()
      return box.width > 0 && box.height > 0
    }),
  }
})
assert.equal(markup.originalCount, listening.tracks.length)
assert.equal(markup.cloneCount, markup.originalCount)
assert.equal(markup.clonesMuted, true)
assert.equal(markup.metadata, true)
assert.equal(markup.originalNotPreloaded, true)
assert.deepEqual(markup.stats, ['39', '219', 'Gareth.T'])
assert.equal(markup.updated, '10/15 15:29')
assert.equal(markup.placeholder, 1, '缺封面的一首显示占位，不伪造图片')
assert.equal(markup.placeholderSized, true)

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
  await page.evaluate((source) => {
    const active = document.activeElement
    const view = active.closest('.image-view')
    return (
      active.matches(
        '.recent-listening .media-card:not([data-marquee-clone]) img'
      ) &&
      view?.querySelector('template')?.content.querySelector('img')?.src ===
        source
    )
  }, source),
  true,
  'closing a clone returns focus to its source card, not a duplicate tab stop'
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
    return (
      !rail.dataset.marquee && getComputedStyle(rail).overflowX === 'hidden'
    )
  }),
  true
)

await page.cdp('Emulation.setScriptExecutionDisabled', { value: true })
await page.reload()
// 数据在运行时取得：无脚本时只保留骨架和说明，不假装有数据。
const nojs = await page.evaluate(() => {
  const root = document.querySelector('.recent-listening')
  return {
    cards: root.querySelectorAll('.media-card').length,
    skeletons: root.querySelectorAll('[data-listening-skeleton]').length,
    clones: root.querySelectorAll('[data-marquee-clone]').length,
    state: root.dataset.state,
    hint: root.querySelector('noscript')?.textContent ?? '',
  }
})
assert.equal(nojs.cards, 0)
assert.equal(nojs.skeletons, 10)
assert.equal(nojs.clones, 0)
assert.equal(nojs.state, 'loading')
assert.match(nojs.hint, /JavaScript/)
await page.cdp('Emulation.setScriptExecutionDisabled', { value: false })
await page.cdp('Emulation.setEmulatedMedia', { features: [] })

// 接口失败与真实空数据都必须落在各自的状态，而不是停在“加载中”。
const stateAfter = async (mode) => {
  await page.evaluate(
    (value) => window.localStorage.setItem('listening-stub', value),
    mode
  )
  await page.reload()
  await page.waitForFunction(
    () =>
      document.querySelector('.recent-listening')?.dataset.state !== 'loading'
  )
  return page.evaluate(() => {
    const root = document.querySelector('.recent-listening')
    return {
      state: root.dataset.state,
      message: root.querySelector('[data-listening-message]').textContent,
      cards: root.querySelectorAll('.media-card').length,
      busy: root.getAttribute('aria-busy'),
      railHidden:
        getComputedStyle(root.querySelector('.recent-listening__body'))
          .display === 'none',
    }
  })
}
assert.deepEqual(await stateAfter('fail'), {
  state: 'error',
  message: '暂时无法获取听歌数据。',
  cards: 0,
  busy: 'false',
  railHidden: true,
})
assert.deepEqual(await stateAfter('empty'), {
  state: 'empty',
  message: '过去 7 天还没有听歌记录。',
  cards: 0,
  busy: 'false',
  railHidden: true,
})
await page.evaluate(() => window.localStorage.removeItem('listening-stub'))
console.log(
  'Card rails: book grouping, listening cards/loop/separator/zoom, focus, reduced motion, failure and empty states, no-JS passed'
)
