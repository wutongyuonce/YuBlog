const CJK_CHAR_RE =
  /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
const WORD_RE = /[\p{L}\p{N}_'-]+/gu

/**
 * Counts readable CJK characters and non-CJK words in plain text.
 *
 * @param {string} text
 */
export function countReadableUnits(text) {
  const cjkChars = text.match(CJK_CHAR_RE)?.length ?? 0
  const nonCjkText = text.replace(CJK_CHAR_RE, ' ')
  const words = nonCjkText.match(WORD_RE)?.length ?? 0

  return cjkChars + words
}

/**
 * Uses ten-thousands for long Chinese counts while preserving exact small counts.
 *
 * @param {number} count
 */
export function formatChineseCount(count) {
  if (count < 10_000) return count.toLocaleString('zh-CN')

  const tenThousands = count / 10_000
  const precision = tenThousands < 100 ? 1 : 0

  return `${tenThousands.toFixed(precision).replace(/\.0$/, '')}万`
}
