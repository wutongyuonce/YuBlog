/**
 * Pick the heading the reader is in.
 *
 * A heading becomes current only after its top reaches the activation line —
 * the same line a TOC click scrolls it to. A later heading that is merely
 * visible below that line is still upcoming, so it must not steal the highlight.
 * At the real bottom of a scrollable page, the last heading wins: a short
 * final section may never reach the line.
 *
 * @param {readonly number[]} tops Heading tops in document order, viewport px.
 * @param {number} line Activation line, viewport px.
 * @param {boolean} atBottom Whether the page is scrolled to the bottom and can scroll.
 * @returns {number} Index into `tops`, or -1 when there are no headings.
 */
export function pickActiveHeadingIndex(tops, line, atBottom) {
  if (tops.length === 0) return -1
  if (atBottom) return tops.length - 1

  let active = -1
  for (let i = 0; i < tops.length; i++) {
    if (tops[i] <= line) active = i
  }
  return active === -1 ? 0 : active
}
