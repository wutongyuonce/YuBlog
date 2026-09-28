import assert from 'node:assert/strict'
import test from 'node:test'
import remarkImageWidth from '../plugins/remark-image-width.ts'

test('width marker reaches the image pipeline as width, not alt text or CSS', () => {
  const sized = {
    type: 'image',
    url: './photo.png',
    alt: '半宽|w353',
    data: { hProperties: { className: 'zoom', loading: 'lazy' } },
  }
  const unsized = { type: 'image', url: './other.png', alt: '原始宽度' }
  const tree = { type: 'root', children: [sized, unsized] }

  remarkImageWidth()(tree)

  assert.equal(sized.alt, '半宽')
  assert.deepEqual(sized.data.hProperties, {
    className: 'zoom',
    loading: 'lazy',
    width: 353,
  })
  assert.equal(unsized.alt, '原始宽度')
  assert.equal(unsized.data, undefined)
})
