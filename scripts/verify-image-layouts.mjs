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

## 绕图

:::figure{side="right"}
${portrait}

${'这是可以绕图的正文，图片之外的段落应恢复完整宽度。'.repeat(35)}
:::

容器外正文。

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
    await page.waitForSelector('.image-view__zoom')
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
          .querySelector('.image-view')
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
          linkedPosition: getComputedStyle(
            document.querySelector('.image-view__zoom--linked')
          ).position,
          nestedControls: document.querySelectorAll('a .image-view__zoom')
            .length,
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
        state.linkedPosition,
        'static',
        'mixed-text image links keep a usable adjacent zoom button'
      )
      assert.equal(
        state.nestedControls,
        0,
        'zoom buttons must not be nested inside authored links'
      )
    }
  }

  await page.click('.image-gallery__controls button[aria-label="下一张图片"]')
  await page.waitForFunction(
    () =>
      document
        .querySelector(
          '.image-gallery__controls button[aria-label="显示第 2 张图片"]'
        )
        .getAttribute('aria-current') === 'true'
  )
  await page.focus('.image-gallery--scroll')
  await page.keyboard.press('ArrowLeft')
  await page.waitForFunction(
    () =>
      document
        .querySelector(
          '.image-gallery__controls button[aria-label="显示第 1 张图片"]'
        )
        .getAttribute('aria-current') === 'true'
  )
  await page.click('.image-view__zoom[aria-label="查看大图：缩略图"]')
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
  await page.keyboard.press('Escape')
  assert.equal(
    await page.evaluate(() =>
      document.activeElement?.getAttribute('aria-label')
    ),
    '查看大图：缩略图'
  )
  assert.equal(await page.evaluate(() => document.body.style.overflow), '')

  await page.click('.image-view__zoom[aria-label="查看大图：复杂链接"]')
  await page.click('.image-lightbox__close')
  await page.click('img[alt="缩略图"]')
  await page.click('.image-lightbox__close')
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
  await page.click('#search-switch')
  await page.fill('#search-input', 'Astro')
  await page.waitForSelector('.search-result-item')
  await page.click('.search-result-item >> nth=0')
  await page.waitForURL(new URL('/', base).href)
  await page.click('#search-switch')
  assert.equal(
    await page.evaluate(() => document.body.style.overflow),
    'hidden',
    'search reacquires the new body after a cancelled exit animation'
  )
  await page.keyboard.press('Escape')
  await page.waitForFunction(() => document.body.style.overflow === '')

  await page.cdp('Emulation.setScriptExecutionDisabled', { value: true })
  try {
    await page.goto(url)
    const state = await page.evaluate(() => ({
      images: document.querySelectorAll('.post-content img').length,
      controls: document.querySelectorAll('.image-view__zoom').length,
      scrollable:
        document.querySelector('.image-gallery--scroll').scrollWidth >
        document.querySelector('.image-gallery--scroll').clientWidth,
    }))
    assert.equal(state.images, 10, 'all authored images survive without JS')
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
