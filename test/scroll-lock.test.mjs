import assert from 'node:assert/strict'
import test from 'node:test'
import { lockScroll } from '../src/utils/misc.ts'

test('modal locking targets the document scroller, respects reserved gutters and ignores a replaced page', () => {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    getComputedStyle: globalThis.getComputedStyle,
  }
  try {
    for (const gutter of ['auto', 'stable']) {
      const root = { clientWidth: 980, style: { overflow: 'clip' } }
      const body = { style: { overflow: '', paddingRight: '12px' } }
      globalThis.document = { documentElement: root, body }
      globalThis.window = { innerWidth: 1000 }
      globalThis.getComputedStyle = (element) =>
        element === root
          ? { scrollbarGutter: gutter }
          : { paddingRight: '12px' }

      const release = lockScroll()
      assert.equal(
        root.style.overflow,
        'hidden',
        'lock the actual page scroller'
      )
      assert.equal(
        body.style.overflow,
        '',
        'do not create a body scroll container'
      )
      assert.equal(
        body.style.paddingRight,
        gutter === 'stable' ? '12px' : '32px',
        'compensate only when the browser does not already reserve the gutter'
      )
      release()
      assert.equal(root.style.overflow, 'clip')
      assert.equal(body.style.paddingRight, '12px')

      const releaseOldPage = lockScroll()
      const newBody = { style: { overflow: '', paddingRight: '' } }
      globalThis.document.body = newBody
      root.style.overflow = 'auto'
      const releaseNewPage = lockScroll()
      releaseOldPage()
      assert.equal(
        root.style.overflow,
        'hidden',
        'old release cannot unlock the new page'
      )
      assert.equal(body.style.paddingRight, '12px')
      releaseNewPage()
      assert.equal(root.style.overflow, 'auto')
      assert.deepEqual(newBody.style, { overflow: '', paddingRight: '' })
    }
  } finally {
    Object.assign(globalThis, previous)
  }
})
