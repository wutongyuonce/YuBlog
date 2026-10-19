import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clampSlideIndex,
  imageViewSourceKey,
  isLightboxGalleryView,
  resolveLightboxSlideIndex,
} from '../src/utils/image-lightbox-gallery.js'

test('clampSlideIndex stays inside [0, total)', () => {
  assert.equal(clampSlideIndex(-1, 5), 0)
  assert.equal(clampSlideIndex(0, 5), 0)
  assert.equal(clampSlideIndex(2, 5), 2)
  assert.equal(clampSlideIndex(9, 5), 4)
  assert.equal(clampSlideIndex(0, 0), 0)
  assert.equal(clampSlideIndex(3, 1), 0)
})

/** Minimal element stubs — no jsdom dependency. */
function viewStub({
  src,
  clone = false,
  excalidraw = false,
  templateSrc,
} = {}) {
  const img = {
    src: src || '',
    getAttribute: (name) => (name === 'src' ? src || null : null),
  }
  const templateImg = templateSrc
    ? {
        src: templateSrc,
        getAttribute: (name) => (name === 'src' ? templateSrc : null),
      }
    : null
  return {
    closest(sel) {
      if (sel === '[data-marquee-clone]') return clone ? this : null
      if (sel === '.excalidraw-embed') return excalidraw ? this : null
      return null
    },
    querySelector(sel) {
      if (sel === 'img') return img
      if (sel === 'template')
        return templateImg
          ? { content: { querySelector: () => templateImg } }
          : null
      return null
    },
  }
}

test('isLightboxGalleryView keeps marquee sources, drops clones and excalidraw', () => {
  assert.equal(isLightboxGalleryView(viewStub({ src: '/a.jpg' })), true)
  assert.equal(
    isLightboxGalleryView(viewStub({ src: '/a.jpg', clone: true })),
    false
  )
  assert.equal(
    isLightboxGalleryView(viewStub({ src: '/d.svg', excalidraw: true })),
    false,
    'preview/export img nested under excalidraw-embed stays out'
  )
})

test('resolveLightboxSlideIndex maps a marquee clone onto the source slide', () => {
  const a = viewStub({ src: '/a.jpg', templateSrc: '/a-full.jpg' })
  const b = viewStub({ src: '/b.jpg', templateSrc: '/b-full.jpg' })
  const aClone = viewStub({
    src: '/a.jpg',
    templateSrc: '/a-full.jpg',
    clone: true,
  })
  const slides = [a, b]
  assert.equal(resolveLightboxSlideIndex(slides, a), 0)
  assert.equal(resolveLightboxSlideIndex(slides, b), 1)
  assert.equal(resolveLightboxSlideIndex(slides, aClone), 0)
  assert.equal(imageViewSourceKey(aClone), '/a-full.jpg')
})
