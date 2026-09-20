/** Narrow layout breakpoint. CSS media queries must copy this number. */
export const BLOG_SIDEBAR_BREAKPOINT = 1099
export const SIDEBAR_BOTTOM_GAP_REDUCTION = 20
/** CSS `bottom` fallback on `.blog-sidebar[data-sidebar-locked]` must match. */
export const MIN_SIDEBAR_BOTTOM_GAP = 4

/** @param {number} sourceHeight measured from `[data-sidebar-bottom-gap-source]` */
export function getSidebarBottomGap(sourceHeight) {
  return Math.max(
    MIN_SIDEBAR_BOTTOM_GAP,
    sourceHeight - SIDEBAR_BOTTOM_GAP_REDUCTION
  )
}

/**
 * @param {{
 *   viewportWidth: number,
 *   sidebarHeight: number,
 *   viewportHeight: number,
 *   headerHeight: number | null,
 *   columnTop: number,
 *   columnBottom: number,
 *   sidebarBottomGap: number | null,
 * }} metrics
 */
export function shouldLockSidebar(metrics) {
  const { headerHeight, sidebarBottomGap } = metrics
  if (headerHeight == null || sidebarBottomGap == null) return false
  if (metrics.viewportWidth <= BLOG_SIDEBAR_BREAKPOINT) return false

  const canFitInViewport =
    metrics.sidebarHeight <=
      metrics.viewportHeight -
      Math.max(headerHeight, metrics.columnTop) -
      sidebarBottomGap

  return (
    !canFitInViewport &&
    metrics.columnBottom <= metrics.viewportHeight - sidebarBottomGap
  )
}
