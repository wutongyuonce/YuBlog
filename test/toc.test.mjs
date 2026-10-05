import assert from 'node:assert/strict'
import test from 'node:test'

import { generateToc } from '../src/utils/toc.ts'

const headings = (depths) =>
  depths.map((depth, index) => ({
    depth,
    slug: String(index),
    text: String(index),
  }))
const shape = (items) =>
  items.map(({ slug, children }) => [slug, shape(children)])

test('nested headings stay under their actual preceding parent', () => {
  const input = headings([2, 3, 4, 4, 3, 4])
  assert.deepEqual(shape(generateToc(input, 2, 4)), [
    [
      '0',
      [
        [
          '1',
          [
            ['2', []],
            ['3', []],
          ],
        ],
        ['4', [['5', []]]],
      ],
    ],
  ])
  assert.ok(input.every((heading) => !Object.hasOwn(heading, 'children')))
})

test('missing heading levels add fillers only where the level is absent', () => {
  assert.deepEqual(shape(generateToc(headings([2, 4, 5, 3, 5]), 2, 5)), [
    [
      '0',
      [
        ['', [['1', [['2', []]]]]],
        ['3', [['', [['4', []]]]]],
      ],
    ],
  ])
})

test('heading bounds preserve the eligible order and support empty content', () => {
  assert.deepEqual(generateToc([], 2, 4), [])
  assert.deepEqual(shape(generateToc(headings([1, 2, 6, 3]), 2, 4)), [
    ['1', [['3', []]]],
  ])
  assert.throws(() => generateToc([], 4, 2), /minHeadingLevel/)
})
