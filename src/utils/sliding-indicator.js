/**
 * 滑动指示条的唯一属主。
 *
 * 顶栏当前页指示条把一条绝对定位的滑块
 * 挪到当前项的宽度和位置上，并在「首次定位 / resize / 字体就绪」这类不该有
 * 动画的场合压掉过渡。
 *
 * 用 `indicator.dataset.ready` 记住是否已经定位过一次：第一次不播动画，
 * 之后才播。
 *
 * @param {{
 *   indicator: HTMLElement | null,
 *   target: HTMLElement | null | undefined,
 *   animate?: boolean,
 * }} options
 * @returns {boolean} 是否完成了定位（没有指示条或没有目标项时为 false）
 */
export function placeSlidingIndicator({ indicator, target, animate = true }) {
  if (!indicator) return false

  // 没有当前项时把指示条收成 0 宽：顶栏遇到不匹配的路径就用这个隐藏它。
  if (!target) {
    indicator.style.transition = 'none'
    indicator.style.width = '0px'
    indicator.getBoundingClientRect()
    indicator.style.transition = ''
    // There is no visible starting position to animate from on the next page.
    indicator.dataset.ready = 'false'
    return false
  }

  const shouldAnimate = animate && indicator.dataset.ready === 'true'
  if (!shouldAnimate) indicator.style.transition = 'none'

  indicator.style.width = `${target.offsetWidth}px`
  indicator.style.transform = `translateX(${target.offsetLeft}px)`

  if (!shouldAnimate) {
    // 强制回流，让上面压掉过渡的赋值先生效，再恢复过渡。
    indicator.getBoundingClientRect()
    indicator.style.transition = ''
  }

  indicator.dataset.ready = 'true'
  return true
}
