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

// One live state for the header and anchor predictions. A preview must preserve
// accumulated travel without consuming it before the actual scroll arrives.
let current = { y: 0, direction: 0, travel: 0, hidden: false }

export function updateNavVisibility(scrollY, pinned = false) {
  current = updateNavScroll(current, scrollY, pinned)
  return current.hidden
}

export function predictNavVisibility(scrollY) {
  return updateNavScroll(current, scrollY).hidden
}
