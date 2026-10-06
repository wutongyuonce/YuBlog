/** Optimized hero image size; matches the 660px reading column. */
export const ARTICLE_COLUMN_WIDTH = 660

/** Lock this document body and return a release that restores its prior styles. */
export function lockScroll() {
  const bodyEl = document.body
  const previousOverflow = bodyEl.style.overflow
  const previousPadding = bodyEl.style.paddingRight
  const scrollbarWidth = window.innerWidth - bodyEl.clientWidth
  const hasRose = document.getElementById('bg-rose')
  if (scrollbarWidth > 0 && !hasRose) {
    const padding = parseFloat(getComputedStyle(bodyEl).paddingRight) || 0
    bodyEl.style.paddingRight = `${padding + scrollbarWidth}px`
  }
  bodyEl.style.overflow = 'hidden'
  return () => {
    bodyEl.style.overflow = previousOverflow
    bodyEl.style.paddingRight = previousPadding
  }
}

// Backdrops are replaced with body on client navigation; bind the release to
// that element so a cancelled exit animation cannot retain the next page's lock.
const backdropScroll = new WeakMap<HTMLElement, () => void>()

function unlockScroll(backdrop: HTMLElement) {
  backdropScroll.get(backdrop)?.()
  backdropScroll.delete(backdrop)
}

/**
 * Controls the fading animation of an element,
 * showing or hiding it based on visibility.
 */
export function toggleFadeEffect(
  elementId: string,
  visible: boolean,
  hiddenClass: string
) {
  const element = document.getElementById(elementId)
  if (!element) return

  if (visible) {
    element.classList.remove(hiddenClass)
    if (elementId === 'backdrop' && !backdropScroll.has(element))
      backdropScroll.set(element, lockScroll())
    if (window.matchMedia('(prefers-reduced-motion)').matches) return
    element.classList.add('fade-in')
  } else {
    if (window.matchMedia('(prefers-reduced-motion)').matches) {
      element.classList.add(hiddenClass)
      if (elementId === 'backdrop') unlockScroll(element)
      return
    }
    element.classList.add('fade-out')
    element.addEventListener(
      'animationend',
      () => {
        element.classList.remove('fade-in', 'fade-out')
        element.classList.add(hiddenClass)
        if (elementId === 'backdrop') unlockScroll(element)
      },
      { once: true }
    )
  }
}
