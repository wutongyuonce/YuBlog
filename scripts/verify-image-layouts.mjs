/* global taskSpace */
// sed -e 's/__TASK_SPACE_ID__/<id>/g' -e "s|__REPO_ROOT__|$PWD|g" -e 's|__BASE_URL__|http://127.0.0.1:4333/|g' scripts/verify-image-layouts.mjs | ego-browser nodejs
// Run from the repository root with its dev server running. BASE includes any deployment base.
import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'

const task = await taskSpace(Number('__TASK_SPACE_ID__'))
const page = task.page('p1')
const base = '__BASE_URL__'
const root = '__REPO_ROOT__'
// Fixture writes can reload the previous dev document through Vite HMR.
await page.goto('about:blank')
const directory = await mkdtemp(
  path.join(root, 'src/content/blogs/image-layout-check-')
)
// Astro's content loader slugs each path segment with github-slugger, which
// lowercases it. mkdtemp appends mixed-case characters, so the raw directory
// name is not the route.
const url = new URL(
  `blogs/${path.basename(directory).toLowerCase()}/demo/`,
  base
).href

// Prepare distant pointer targets explicitly; keyboard focus does not need
// the element on screen and is checked directly below.
const scrollTo = (selector) =>
  page.evaluate(
    (target) =>
      document.querySelector(target).scrollIntoView({ block: 'center' }),
    selector
  )

try {
  await mkdir(path.join(directory, 'images'))
  await writeFile(
    path.join(directory, 'images', 'landscape.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#6a8b99"/></svg>'
  )
  await writeFile(
    path.join(directory, 'images', 'portrait.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="800" height="1200"><rect width="800" height="1200" fill="#c69a72"/></svg>'
  )
  await writeFile(
    path.join(directory, 'images', 'detail.svg'),
    '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800"><rect width="1200" height="800" fill="#719477"/></svg>'
  )
  const image = '![横图](./images/landscape.svg)'
  const portrait = '![竖图](./images/portrait.svg)'
  const longGallery = Array.from({ length: 12 }, (_, index) =>
    index % 2 ? portrait : image
  ).join('\n\n')
  await writeFile(
    path.join(directory, 'demo.md'),
    `---
title: 图片布局检查
category: 测试
pubDate: 2026-01-01
draft: true
---

## 并排

:::gallery{columns="3"}
![横图|w220](./images/landscape.svg)
${portrait}
${image}
:::

## 横向

:::gallery{layout="scroll"}
![横图|w220](./images/landscape.svg)
${portrait}
${image}
:::

## 比例列宽

:::gallery{widths="1fr 2fr"}
${portrait}
${image}
:::

## 固定列宽

:::gallery{widths="240px 1fr"}
${portrait}
${image}
:::

## 绕图

:::figure{side="right"}
${portrait}

${'这是可以绕图的正文，图片之外的段落应恢复完整宽度。'.repeat(35)}
:::

容器外正文。

## 单图相册

:::gallery{layout="scroll"}
${image}
:::

## 长相册

:::gallery{layout="scroll"}
${longGallery}
:::

## 普通缩略图

![缩略图|w220](./images/detail.svg)

[![链接图片](./images/portrait.svg)](https://example.com/)

[![复杂链接](./images/portrait.svg) 文字链接](https://example.com/)
`
  )
  // Wait for the content watcher, not an assumed fixed synchronization delay.
  let ready = false
  for (let i = 0; i < 40 && !ready; i++) {
    const response = await fetch(url)
    ready =
      response.ok && (await response.text()).includes('image-gallery--scroll')
    if (!ready) await new Promise((resolve) => setTimeout(resolve, 250))
  }
  assert.ok(
    ready,
    'dev must render the temporary draft through the real Astro pipeline'
  )
  await page.cdp('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })

  for (const width of [1440, 601, 600, 390, 320]) {
    await page.goto(url)
    await page.cdp('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    assert.equal(await page.evaluate(() => innerWidth), width)
    await page.evaluate(
      () =>
        new Promise((resolve) =>
          requestAnimationFrame(() => requestAnimationFrame(resolve))
        )
    )
    await page.waitForSelector('img[role="button"]')
    await page.evaluate(async () => {
      await Promise.all(
        [...document.querySelectorAll('.post-content img')].map((image) => {
          image.loading = 'eager'
          return image.decode()
        })
      )
    })
    for (const dark of [false, true]) {
      await page.evaluate(
        (dark) => document.documentElement.classList.toggle('dark', dark),
        dark
      )
      const state = await page.evaluate(() => {
        const grid = document.querySelector('.image-gallery--grid')
        const scroll = document.querySelector('.image-gallery--scroll')
        const first = scroll.firstElementChild
        const gridImage = grid.querySelector('img').getBoundingClientRect()
        const gridFrame = grid
          .querySelector('.image-gallery__item')
          .getBoundingClientRect()
        const thumbnail = [
          ...document.querySelectorAll('.post-content img'),
        ].find((img) => img.alt === '缩略图')
        const full = thumbnail
          .closest('.image-view')
          .querySelector('template')
          .content.querySelector('img')
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          customTracks: [...document.querySelectorAll('.image-gallery--grid')]
            .slice(1)
            .map((grid) =>
              getComputedStyle(grid)
                .gridTemplateColumns.split(' ')
                .map(parseFloat)
            ),
          stageHeight: scroll.getBoundingClientRect().height,
          scrollImages: [...scroll.querySelectorAll('img')].map((image) => {
            const rect = image.getBoundingClientRect()
            const stage = scroll.getBoundingClientRect()
            return {
              width: rect.width,
              height: rect.height,
              ratio: image.naturalWidth / image.naturalHeight,
              top: rect.top - stage.top,
              bottom: stage.bottom - rect.bottom,
              maxWidth: image.closest('.image-gallery__item').clientWidth,
            }
          }),
          slideHeights: [...scroll.children].map(
            (slide) => slide.getBoundingClientRect().height
          ),
          // A portrait neighbour must stay whole inside the fixed stage, not
          // get clipped to whatever height the active landscape happens to be.
          portrait: (() => {
            const image = [...scroll.querySelectorAll('img')].find(
              (img) => img.alt === '\u7ad6\u56fe'
            )
            const box = image.getBoundingClientRect()
            const stage = scroll.getBoundingClientRect()
            return {
              ratio: image.naturalWidth / image.naturalHeight,
              shown: box.width / box.height,
              inside:
                box.top >= stage.top - 1 && box.bottom <= stage.bottom + 1,
            }
          })(),
          arrow: (() => {
            const rect = scroll.parentElement
              .querySelector('.image-gallery__arrow--next')
              .getBoundingClientRect()
            const stage = scroll.getBoundingClientRect()
            return {
              middle: (rect.top + rect.bottom) / 2,
              stageMiddle: (stage.top + stage.bottom) / 2,
              right: rect.right,
              stageRight: stage.right,
            }
          })(),
          dots: (() => {
            const controls = scroll.parentElement.querySelector(
              '.image-gallery__controls'
            )
            return {
              count: controls.children.length,
              arrows: controls.querySelectorAll('.image-gallery__arrow').length,
              bottom: controls.getBoundingClientRect().bottom,
              stageBottom: scroll.getBoundingClientRect().bottom,
            }
          })(),
          gridCentered:
            Math.abs(
              gridImage.left -
                gridFrame.left -
                (gridFrame.width - gridImage.width) / 2
            ) < 1,
          gridImageWidth: grid.querySelector('img').width,
          columns: getComputedStyle(grid).gridTemplateColumns.split(' ').length,
          float: getComputedStyle(
            document.querySelector('.image-figure__media')
          ).float,
          slideWidth: first.getBoundingClientRect().width / scroll.clientWidth,
          scrollable: scroll.scrollWidth > scroll.clientWidth,
          thumbnailWidth: thumbnail.width,
          fullWidth: full.width,
          fullSrcset: full.getAttribute('srcset'),
          fullSource: new URL(full.getAttribute('src'), location.href).href,
          linkedHidden:
            document
              .querySelector('.image-view__linked-zoom')
              .getBoundingClientRect().width <= 1,
          badges: document.querySelectorAll('.image-view__zoom').length,
          nestedControls: document.querySelectorAll(
            'a img[role="button"], a .image-view__linked-zoom'
          ).length,
        }
      })
      assert.equal(
        state.overflow,
        false,
        `${width}/${dark}: page stays within viewport`
      )
      assert.ok(
        state.gridImageWidth <= 220,
        'gallery responsiveness must preserve authored width limits: ' +
          JSON.stringify(state)
      )
      assert.ok(
        state.gridCentered,
        'explicit-width images retain ordinary centered alignment: ' +
          JSON.stringify(state)
      )
      assert.ok(
        !state.fullSrcset,
        'inert full-size sources do not generate unused responsive variants'
      )
      for (const tracks of state.customTracks)
        assert.equal(tracks.length, width > 600 ? 2 : 1)
      if (width > 600) {
        assert.ok(
          Math.abs(state.customTracks[0][1] / state.customTracks[0][0] - 2) <
            0.01,
          'proportional tracks must distribute the available width'
        )
        assert.ok(
          Math.abs(state.customTracks[1][0] - 240) < 1,
          'fixed first track must leave the rest to the flexible track'
        )
      }
      assert.ok(
        state.stageHeight > 0 && state.stageHeight <= 520,
        'the gallery must reserve a visible stage before and after image loading'
      )
      for (const image of state.scrollImages) {
        assert.ok(image.width > 0 && image.height > 0)
        assert.ok(image.width <= image.maxWidth + 1)
        assert.ok(image.top >= -1 && image.bottom >= -1)
        assert.ok(Math.abs(image.width / image.height - image.ratio) < 0.02)
      }
      assert.ok(
        state.scrollImages[0].width <= 220,
        '|w remains a display limit'
      )
      assert.ok(
        state.slideHeights.every(
          (height) => Math.abs(height - state.stageHeight) < 1
        ),
        `${width}/${dark}: every slide fills the fixed stage ${state.stageHeight}px, got ${state.slideHeights}`
      )
      assert.ok(
        state.portrait.inside &&
          Math.abs(state.portrait.shown - state.portrait.ratio) < 0.02,
        `${width}/${dark}: the portrait stays whole and uncropped inside the stage`
      )
      assert.ok(
        Math.abs(state.arrow.middle - state.arrow.stageMiddle) < 1,
        'arrows belong at the image edge, not below it'
      )
      assert.ok(state.arrow.stageRight - state.arrow.right < 20)
      assert.equal(state.dots.count, 3, 'one dot per image')
      assert.equal(
        state.dots.arrows,
        0,
        'the pagination dots do not contain arrows'
      )
      assert.ok(
        state.dots.bottom <= state.dots.stageBottom,
        'pagination overlays the bottom of the image stage'
      )
      assert.equal(state.columns, width > 600 ? 3 : 1)
      assert.equal(state.float, width > 600 ? 'right' : 'none')
      assert.ok(
        state.scrollable,
        'scroll gallery must overflow its stage so paging is possible'
      )
      // Slides are max-content (image width), not a fixed ~94% track; |w can
      // make the first slide much narrower than the stage.
      assert.ok(
        state.slideWidth > 0.2,
        'first slide should keep a usable width: ' + state.slideWidth
      )
      assert.equal(state.thumbnailWidth, 220)
      assert.equal(
        state.fullWidth,
        1200,
        'zoom must not enlarge the 220px thumbnail'
      )
      assert.equal(
        await page.evaluate(
          (source) =>
            performance
              .getEntriesByType('resource')
              .some((entry) => entry.name === source),
          state.fullSource
        ),
        false,
        'the template alone must not download a full-size rendition'
      )
      assert.ok(
        (await fetch(state.fullSource)).ok,
        'full-size source resolves through Astro'
      )
      assert.equal(
        state.linkedHidden,
        true,
        'linked-image zoom actions stay hidden until keyboard focus'
      )
      assert.equal(state.badges, 0, 'no corner zoom badges remain')
      assert.equal(
        state.nestedControls,
        0,
        'zoom buttons must not be nested inside authored links'
      )
    }
  }

  // Hover feedback must change only the pixels inside an unchanged image frame.
  await page.cdp('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await page.goto(url)
  await scrollTo('.image-view:has(> img[alt="缩略图"])')
  await page.hover('.image-view:has(> img[alt="缩略图"])')
  await page.evaluate(() =>
    document.querySelector('img[alt="缩略图"]').decode()
  )
  await page.cdp('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  })
  // Hover needs a settled layout: the fixtures keep lazy images arriving.
  // Polling explicitly beats a predicate that hides which value moved.
  let settledTop
  let settled = false
  for (let i = 0; i < 40 && !settled; i++) {
    const top = await page.evaluate((target) => {
      const node = document.querySelector(target)
      return node ? node.getBoundingClientRect().top : null
    }, 'img[alt="缩略图"]')
    settled = top !== null && top === settledTop
    settledTop = top
    if (!settled) await page.waitForTimeout(150)
  }
  assert.ok(settled, 'the thumbnail position settles before hover assertions')
  await page.mouse.move(0, 0)
  const frame = await page.evaluate(() => {
    const image = document.querySelector('img[alt="缩略图"]')
    const rect = image.closest('.image-view').getBoundingClientRect()
    return { width: rect.width, height: rect.height }
  })
  await page.hover('.image-view:has(> img[alt="缩略图"])')
  await page.waitForFunction(() => {
    const scale = new DOMMatrixReadOnly(
      getComputedStyle(document.querySelector('img[alt="缩略图"]')).transform
    ).a
    return scale > 1.01 && scale < 1.05
  })
  const hover = await page.evaluate(() => {
    const image = document.querySelector('img[alt="缩略图"]')
    const view = image.closest('.image-view')
    const rect = view.getBoundingClientRect()
    return {
      width: rect.width,
      height: rect.height,
      clip: getComputedStyle(view).overflow,
      cursor: getComputedStyle(image).cursor,
    }
  })
  assert.deepEqual({ width: hover.width, height: hover.height }, frame)
  assert.equal(hover.clip, 'hidden')
  assert.equal(hover.cursor, 'zoom-in')
  await page.mouse.move(0, 0)
  await page.waitForFunction(
    () =>
      Math.abs(
        new DOMMatrixReadOnly(
          getComputedStyle(document.querySelector('img[alt="缩略图"]'))
            .transform
        ).a - 1
      ) < 0.001
  )
  await page.cdp('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'reduce' }],
  })
  await page.hover('.image-view:has(> img[alt="缩略图"])')
  assert.equal(
    await page.evaluate(
      () =>
        getComputedStyle(document.querySelector('img[alt="缩略图"]')).transform
    ),
    'none'
  )

  // Shared read of the enhanced first scroll gallery: active index, dots, and
  // how far the active image center sits from the stage center.
  const readScroll = () =>
    page.evaluate(() => {
      const gallery = document.querySelector('.image-gallery--scroll')
      const viewport = gallery.closest('.image-gallery__viewport')
      const items = [
        ...gallery.querySelectorAll(':scope > .image-gallery__item'),
      ]
      const gRect = gallery.getBoundingClientRect()
      const view = gRect.left + gRect.width / 2
      const center = (el) => {
        const r = el.getBoundingClientRect()
        return r.left + r.width / 2
      }
      const active = items.reduce(
        (nearest, item, index) =>
          Math.abs(center(item) - view) <
          Math.abs(center(items[nearest]) - view)
            ? index
            : nearest,
        0
      )
      const img = items[active].querySelector('img').getBoundingClientRect()
      const ideal =
        items[active].offsetLeft +
        items[active].offsetWidth / 2 -
        gallery.clientWidth / 2
      return {
        active,
        n: items.length,
        prevDisabled: viewport.querySelector('.image-gallery__arrow--previous')
          .disabled,
        nextDisabled: viewport.querySelector('.image-gallery__arrow--next')
          .disabled,
        currentDot: viewport
          .querySelector('.image-gallery__dot[aria-current="true"]')
          ?.getAttribute('aria-label'),
        imgVsGal: img.left + img.width / 2 - view,
        scrollLeft: gallery.scrollLeft,
        ideal,
        maxScroll: gallery.scrollWidth - gallery.clientWidth,
      }
    })
  // Ideal may be unreachable for a narrow |w first/last slide; then the
  // browser clamps to an edge and center error equals the clamped gap.
  const assertCentered = (state, label) => {
    const gap = Math.max(0, -state.ideal, state.ideal - state.maxScroll)
    assert.ok(
      Math.abs(state.imgVsGal) < gap + 3,
      `${label} (imgVsGal=${state.imgVsGal}, gap=${gap})`
    )
  }

  // The long-gallery fixture repeats these controls, so target the first
  // gallery explicitly; scrolling to it first keeps the click deterministic.
  await scrollTo('.image-gallery--scroll')
  // Boot must land on the first slide; a smooth relative scrollBy(≈0) used to
  // let mandatory snap walk forward to slide 2 on narrow viewports.
  await page.waitForFunction(() => {
    const gallery = document.querySelector('.image-gallery--scroll')
    const viewport = gallery?.closest('.image-gallery__viewport')
    if (!viewport) return false
    const items = [...gallery.querySelectorAll(':scope > .image-gallery__item')]
    return items[0]?.getBoundingClientRect().width > 2
  })
  const boot = await readScroll()
  assert.equal(boot.active, 0, 'scroll gallery boots on the first slide')
  assert.equal(boot.prevDisabled, true, 'previous arrow hidden on first slide')
  assert.equal(boot.currentDot, '显示第 1 张图片')
  assertCentered(boot, 'boot centers the first slide when reachable')

  // Skip from first to last via dot — absolute scrollTo must not stop mid-way
  // under scroll-snap-stop: always. Wait for the last image to actually sit
  // on the stage center (next.disabled alone only means nearest===last).
  await page.click(
    '.image-gallery__controls button[aria-label="显示第 3 张图片"] >> nth=0'
  )
  await page.waitForFunction(() => {
    const gallery = document.querySelector('.image-gallery--scroll')
    const items = [...gallery.querySelectorAll(':scope > .image-gallery__item')]
    const last = items[items.length - 1]
    if (!last) return false
    const g = gallery.getBoundingClientRect()
    const view = g.left + g.width / 2
    const img = last.querySelector('img').getBoundingClientRect()
    const ideal =
      last.offsetLeft + last.offsetWidth / 2 - gallery.clientWidth / 2
    const gap = Math.max(
      0,
      -ideal,
      ideal - (gallery.scrollWidth - gallery.clientWidth)
    )
    return Math.abs(img.left + img.width / 2 - view) < gap + 3
  })
  const skipped = await readScroll()
  assert.equal(skipped.active, skipped.n - 1, 'dot skip reaches the last slide')
  assert.equal(
    skipped.currentDot,
    `显示第 ${skipped.n} 张图片`,
    'active dot matches the centered slide after skip'
  )
  assertCentered(skipped, 'last slide centered after dot skip')
  // Return to first for the existing adjacent-arrow assertions below.
  await page.click(
    '.image-gallery__controls button[aria-label="显示第 1 张图片"] >> nth=0'
  )
  await page.waitForFunction(
    () =>
      document
        .querySelector(
          '.image-gallery__controls button[aria-label="显示第 1 张图片"]'
        )
        .getAttribute('aria-current') === 'true'
  )

  const initialStageHeight = await page.evaluate(
    () => document.querySelector('.image-gallery--scroll').clientHeight
  )
  await page.click('.image-gallery__arrow[aria-label="下一张图片"] >> nth=0')
  await page.waitForFunction(
    () =>
      document
        .querySelector(
          '.image-gallery__controls button[aria-label="显示第 2 张图片"]'
        )
        .getAttribute('aria-current') === 'true'
  )
  const activeSlide = await page.evaluate(() => {
    const gallery = document.querySelector('.image-gallery--scroll')
    const controls = gallery.parentElement.querySelector(
      '.image-gallery__controls'
    )
    const dots = [...controls.children]
    const alpha = (dot) => {
      const values = getComputedStyle(dot, '::before')
        .backgroundColor.match(/[\d.]+/g)
        .map(Number)
      return values[3] ?? 1
    }
    return {
      height: gallery.getBoundingClientRect().height,
      activeAlpha: alpha(dots[1]),
      inactiveAlpha: alpha(dots[0]),
    }
  })
  assert.ok(
    Math.abs(activeSlide.height - initialStageHeight) < 1,
    'paging keeps the stage height instead of jumping to the new image'
  )
  assert.ok(
    activeSlide.activeAlpha > activeSlide.inactiveAlpha,
    'the current dot is visibly darker'
  )
  await page.click(
    '.image-gallery__controls button[aria-label="显示第 3 张图片"] >> nth=0'
  )
  await page.waitForFunction(
    () => document.querySelector('.image-gallery__arrow--next').disabled
  )
  assert.equal(
    await page.evaluate(
      () =>
        getComputedStyle(document.querySelector('.image-gallery__arrow--next'))
          .visibility
    ),
    'hidden',
    'there is no forward arrow on the final image'
  )
  await page.focus('.image-gallery--scroll >> nth=0')
  await page.keyboard.press('ArrowLeft')
  await page.waitForFunction(
    () =>
      document
        .querySelector(
          '.image-gallery__controls button[aria-label="显示第 2 张图片"]'
        )
        .getAttribute('aria-current') === 'true'
  )
  await page.keyboard.press('ArrowLeft')
  await page.waitForFunction(
    () =>
      document
        .querySelector(
          '.image-gallery__controls button[aria-label="显示第 1 张图片"]'
        )
        .getAttribute('aria-current') === 'true'
  )
  await page.focus('img[alt="缩略图"]')
  assert.equal(
    await page.evaluate(() => document.activeElement?.getAttribute('alt')),
    '缩略图',
    'keyboard activation needs the image itself to hold focus'
  )
  await page.keyboard.press('Enter')
  await page.waitForSelector('dialog[open]')
  assert.equal(
    await page.evaluate(() => document.documentElement.style.overflow),
    'hidden',
    'the image viewer locks the document scroller'
  )
  assert.equal(
    await page.evaluate(
      () =>
        document.querySelector('dialog img').getAttribute('src') ===
        document
          .querySelector('img[alt="缩略图"]')
          .closest('.image-view')
          .querySelector('template')
          .content.querySelector('img').src
    ),
    true
  )
  for (const dark of [false, true]) {
    await page.evaluate(
      (dark) => document.documentElement.classList.toggle('dark', dark),
      dark
    )
    const colors = await page.evaluate(() => {
      const dialog = document.querySelector('dialog')
      const channels = getComputedStyle(dialog, '::backdrop')
        .backgroundColor.match(/[\d.]+/g)
        .map(Number)
      return {
        brightness: (channels[0] + channels[1] + channels[2]) / 3,
        cursor: getComputedStyle(dialog.querySelector('img')).cursor,
      }
    })
    assert.ok(
      dark ? colors.brightness < 128 : colors.brightness > 200,
      'viewer backdrop must follow the current theme'
    )
    assert.equal(colors.cursor, 'zoom-out')
  }
  await page.keyboard.press('Escape')
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute('aria-label')
    ),
    '查看大图：缩略图'
  )
  assert.equal(
    await page.evaluate(() => document.documentElement.style.overflow),
    ''
  )

  await page.focus('.image-view__linked-zoom[aria-label="查看大图：复杂链接"]')
  await page.keyboard.press('Enter')
  assert.equal(
    await page.evaluate(() => document.querySelector('dialog').open),
    true,
    'a linked image zoom button opens its associated image'
  )
  assert.equal(
    await page.evaluate(() =>
      document.querySelector('dialog img').getAttribute('alt')
    ),
    '复杂链接',
    'each linked zoom button opens its own image, not a sibling link image'
  )
  await page.click('.image-lightbox__close')
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute('aria-label')
    ),
    '查看大图：复杂链接',
    'closing returns focus to the linked image zoom button'
  )
  await page.focus('img[alt="缩略图"]')
  await page.keyboard.press('Space')
  await page.click('dialog img')
  assert.equal(
    await page.evaluate(() => document.querySelector('dialog').open),
    false,
    'clicking the large image shrinks it back'
  )
  assert.equal(
    await page.evaluate(() => document.documentElement.style.overflow),
    ''
  )
  await scrollTo('.image-view:has(> img[alt="缩略图"])')
  await page.click('img[alt="缩略图"]')
  await page.evaluate(() => document.querySelector('dialog').click())
  assert.equal(
    await page.evaluate(() => document.querySelector('dialog').open),
    false
  )

  // A real ClientRouter navigation must release the dialog and scroll lock.
  await page.click('img[alt="缩略图"]')
  await page.evaluate(() => document.querySelector('.nav-bar a[href]').click())
  await page.waitForFunction(() => !document.querySelector('.post-content'))
  assert.equal(
    await page.evaluate(() => document.documentElement.style.overflow),
    ''
  )
  assert.equal(
    await page.evaluate(
      () => document.querySelectorAll('dialog.image-lightbox').length
    ),
    1
  )

  // The shared scroll-lock consumer must acquire the replacement page too.
  // A normal fade-out can be cancelled by the faster ClientRouter body swap.
  await page.cdp('Emulation.setEmulatedMedia', {
    features: [{ name: 'prefers-reduced-motion', value: 'no-preference' }],
  })
  await page.waitForFunction(
    () =>
      document.querySelector('#search-switch')?.dataset.searchBound === 'true'
  )
  await page.click('#search-switch')
  await page.fill('#search-input', 'Astro')
  await page.waitForSelector('.search-result-item')
  await page.click('.search-result-item >> nth=0')
  await page.waitForURL(new URL('/', base).href)
  await page.waitForFunction(
    () =>
      document.querySelector('#search-switch')?.dataset.searchBound === 'true'
  )
  await page.click('#search-switch')
  assert.equal(
    await page.evaluate(() => document.documentElement.style.overflow),
    'hidden',
    'search reacquires the new page after a cancelled exit animation'
  )
  await page.keyboard.press('Escape')
  await page.waitForFunction(
    () => document.documentElement.style.overflow === ''
  )

  // Pagination must reveal the active dot inside its own scroller, not by
  // scrolling the article, once a gallery has more dots than fit.
  await page.goto(url)
  await page.cdp('Emulation.setDeviceMetricsOverride', {
    width: 320,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  assert.equal(await page.evaluate(() => innerWidth), 320)
  await page.waitForSelector('.image-gallery__arrow--next')
  await page.evaluate(() => {
    window.scrollTo(0, 0)
    const galleries = [...document.querySelectorAll('.image-gallery--scroll')]
    const gallery = galleries.at(-1)
    gallery.scrollLeft = gallery.scrollWidth
  })
  await page.waitForFunction(() => {
    const galleries = [...document.querySelectorAll('.image-gallery--scroll')]
    return (
      galleries
        .at(-1)
        .parentElement.querySelector(
          '.image-gallery__controls [aria-current="true"]'
        )
        .getAttribute('aria-label') === '显示第 12 张图片'
    )
  })
  const pagination = await page.evaluate(() => {
    const galleries = [...document.querySelectorAll('.image-gallery--scroll')]
    const controls = galleries
      .at(-1)
      .parentElement.querySelector('.image-gallery__controls')
    const dot = controls
      .querySelector('[aria-current="true"]')
      .getBoundingClientRect()
    const box = controls.getBoundingClientRect()
    return {
      dots: controls.children.length,
      clipped: dot.left < box.left - 0.5 || dot.right > box.right + 0.5,
      scrolled: controls.scrollLeft,
      pageScrolled: window.scrollY,
    }
  })
  assert.equal(pagination.dots, 12)
  assert.equal(
    pagination.clipped,
    false,
    'a long gallery reveals its active dot inside the pagination'
  )
  assert.ok(pagination.scrolled > 0, 'its own pagination scroller moves')
  assert.equal(
    pagination.pageScrolled,
    0,
    'revealing the dot must not scroll the article'
  )

  // Only galleries with something to page through are enhanced, and each of
  // them carries one dot per image plus both edge arrows.
  const enhanced = await page.evaluate(() =>
    [...document.querySelectorAll('.image-gallery__viewport')].map(
      (viewport) => ({
        slides: viewport.querySelectorAll('.image-gallery__item').length,
        dots: viewport.querySelectorAll('.image-gallery__dot').length,
        arrows: viewport.querySelectorAll('.image-gallery__arrow').length,
      })
    )
  )
  assert.deepEqual(
    enhanced,
    [
      { slides: 3, dots: 3, arrows: 2 },
      { slides: 12, dots: 12, arrows: 2 },
    ],
    'a gallery with one image keeps no pager, and every other pager has one dot per image'
  )
  const single = await page.evaluate(() => {
    const gallery = [
      ...document.querySelectorAll('.image-gallery--scroll'),
    ].find((item) => item.children.length === 1)
    return {
      images: gallery.querySelectorAll('img').length,
      width: gallery.firstElementChild.getBoundingClientRect().width,
    }
  })
  assert.equal(single.images, 1)
  assert.ok(single.width > 0, 'a single-image gallery still renders its image')

  await page.cdp('Emulation.setScriptExecutionDisabled', { value: true })
  try {
    await page.goto(url)
    const state = await page.evaluate(() => ({
      images: document.querySelectorAll('.post-content img').length,
      controls: document.querySelectorAll(
        'img[role="button"], .image-view__linked-zoom, .image-gallery__arrow, .image-gallery__dot'
      ).length,
      stageHeight: document.querySelector('.image-gallery--scroll')
        .clientHeight,
      scrollable:
        document.querySelector('.image-gallery--scroll').scrollWidth >
        document.querySelector('.image-gallery--scroll').clientWidth,
    }))
    assert.equal(state.images, 27, 'all authored images survive without JS')
    assert.equal(state.controls, 0)
    assert.ok(state.stageHeight > 0, 'the stage remains visible without JS')
    assert.equal(state.scrollable, true)
  } finally {
    await page.cdp('Emulation.setScriptExecutionDisabled', { value: false })
  }
  console.log(
    'Image layouts: desktop/mobile, themes, Astro full source, navigation, keyboard, close and no-JS passed'
  )
} finally {
  await rm(directory, { recursive: true, force: true })
}
