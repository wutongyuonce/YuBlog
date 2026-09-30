/** Accumulate travel in one direction so tiny scroll reversals do not flicker. */
export function updateNavScroll(state, scrollY, pinned = false) {
  const y = Math.max(0, scrollY)
  const delta = y - state.y
  const direction = Math.sign(delta)
  const travel =
    direction === state.direction
      ? state.travel + Math.abs(delta)
      : Math.abs(delta)
  if (pinned || y <= 80) return { y, direction: 0, travel: 0, hidden: false }
  return {
    y,
    direction,
    travel,
    hidden: travel >= 18 ? direction > 0 : state.hidden,
  }
}
