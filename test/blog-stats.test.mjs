import assert from 'node:assert/strict'
import test from 'node:test'

import {
  countReadableUnits,
  formatChineseCount,
} from '../src/utils/blog-stats.js'

test('counts CJK characters and non-CJK words without whitespace', () => {
  assert.equal(countReadableUnits('你好 Astro 5, hello-world!'), 5)
})

test('formats large Chinese counts in ten-thousands', () => {
  assert.equal(formatChineseCount(9_999), '9,999')
  assert.equal(formatChineseCount(12_300), '1.2万')
  assert.equal(formatChineseCount(1_370_000), '137万')
})
