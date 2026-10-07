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
const directory = await mkdtemp(
  path.join(root, 'src/content/blogs/image-layout-check-')
)
const url = new URL(
  `blogs/${path.basename(directory).toLowerCase()}/demo/`,
  base
).href

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
${image}
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

  for (const width of [1440, 390, 320]) {
    await page.cdp('Emulation.setDeviceMetricsOverride', {
      width,
      height: 900,
      deviceScaleFactor: 1,
      mobile: false,
    })
    await page.goto(url)
    await page.waitForSelector('img[role="button"]')
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
          galleryHeight: scroll.getBoundingClientRect().height,
          frameHeight: first
            .querySelector('.image-view')
            .getBoundingClientRect().height,
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
        Math.abs(state.galleryHeight - state.frameHeight) < 1,
        'off-screen portraits must not create blank space below the active frame'
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
        state.scrollable && state.slideWidth > 0.85,
        'slides must not be squeezed into one row'
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

  // The long-gallery fixture repeats these controls, so target the first
  // gallery explicitly; scrolling to it first keeps the click deterministic.
  await page.evaluate(() =>
    document
      .querySelector('.image-gallery--scroll')
      .scrollIntoView({ block: 'center' })
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
      frameHeight: gallery.children[1]
        .querySelector('.image-view')
        .getBoundingClientRect().height,
      activeAlpha: alpha(dots[1]),
      inactiveAlpha: alpha(dots[0]),
    }
  })
  assert.ok(
    Math.abs(activeSlide.height - activeSlide.frameHeight) < 1,
    'switching to a portrait shows its complete frame'
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
  await page.keyboard.press('Enter')
  await page.waitForSelector('dialog[open]')
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
  assert.equal(await page.evaluate(() => document.body.style.overflow), '')

  await page.focus('.image-view__linked-zoom[aria-label="查看大图：复杂链接"]')
  await page.keyboard.press('Enter')
  await page.click('.image-lightbox__close')
  await page.focus('img[alt="缩略图"]')
  await page.keyboard.press('Space')
  await page.click('dialog img')
  assert.equal(
    await page.evaluate(() => document.querySelector('dialog').open),
    false,
    'clicking the large image shrinks it back'
  )
  assert.equal(await page.evaluate(() => document.body.style.overflow), '')
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
  assert.equal(await page.evaluate(() => document.body.style.overflow), '')
  assert.equal(
    await page.evaluate(
      () => document.querySelectorAll('dialog.image-lightbox').length
    ),
    1
  )

  // The shared scroll-lock consumer must acquire the replacement body too.
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
    await page.evaluate(() => document.body.style.overflow),
    'hidden',
    'search reacquires the new body after a cancelled exit animation'
  )
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.body.style.overflow === '')

  // Pagination must reveal the active dot inside its own scroller, not by
  // scrolling the article, once a gallery has more dots than fit.
  await page.cdp('Emulation.setDeviceMetricsOverride', {
    width: 320,
    height: 900,
    deviceScaleFactor: 1,
    mobile: false,
  })
  await page.goto(url)
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
      scrollable:
        document.querySelector('.image-gallery--scroll').scrollWidth >
        document.querySelector('.image-gallery--scroll').clientWidth,
    }))
    assert.equal(state.images, 27, 'all authored images survive without JS')
    assert.equal(state.controls, 0)
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
