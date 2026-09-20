export const BLOG_SIDEBAR_BREAKPOINT = 1099
export const SIDEBAR_BOTTOM_GAP_REDUCTION = 20
export const MIN_SIDEBAR_BOTTOM_GAP = 4

/** @param {number} recentWritingHeight */
export function getSidebarBottomGap(recentWritingHeight) {
  return Math.max(
    MIN_SIDEBAR_BOTTOM_GAP,
    recentWritingHeight - SIDEBAR_BOTTOM_GAP_REDUCTION
  )
}

/**
 * @param {{
 *   viewportWidth: number,
 *   sidebarHeight: number,
 *   viewportHeight: number,
 *   headerHeight: number,
 *   columnTop: number,
 *   columnBottom: number,
 *   sidebarBottomGap: number,
 * }} metrics
 */
export function shouldLockSidebar(metrics) {
  if (metrics.viewportWidth <= BLOG_SIDEBAR_BREAKPOINT) return false

  const canFitInViewport =
    metrics.sidebarHeight <=
    metrics.viewportHeight -
      Math.max(metrics.headerHeight, metrics.columnTop) -
      metrics.sidebarBottomGap

  return (
    !canFitInViewport &&
    metrics.columnBottom <= metrics.viewportHeight - metrics.sidebarBottomGap
  )
}
