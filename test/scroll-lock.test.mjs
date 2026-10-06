import assert from 'node:assert/strict'
import test from 'node:test'
import { lockScroll } from '../src/utils/misc.ts'

test('modal scroll locking compensates the gutter and restores the same body, not a replacement page', () => {
  const previous = {
    document: globalThis.document,
    window: globalThis.window,
    getComputedStyle: globalThis.getComputedStyle,
  }
  const body = {
    clientWidth: 980,
    style: { overflow: 'auto', paddingRight: '12px' },
  }
  try {
    globalThis.document = { body, getElementById: () => null }
    globalThis.window = { innerWidth: 1000 }
    globalThis.getComputedStyle = () => ({ paddingRight: '12px' })
    const release = lockScroll()
    assert.deepEqual(body.style, { overflow: 'hidden', paddingRight: '32px' })
    const newBody = { style: { overflow: '', paddingRight: '' } }
    globalThis.document.body = newBody
    release()
    assert.deepEqual(body.style, { overflow: 'auto', paddingRight: '12px' })
    assert.deepEqual(newBody.style, { overflow: '', paddingRight: '' })
  } finally {
    Object.assign(globalThis, previous)
  }
})
