/**
 * 「是否要求减少动态效果」的唯一属主。
 *
 * 背景动画在 `prefers-reduced-motion: reduce` 时只画一帧静态画面，并在系统
 * 设置变化时启停循环；Dot 与 Snow 共用这段逻辑，避免各写一份。
 *
 * `query` 可注入，这样闸门在没有 DOM 的环境里也能测（见
 * `test/reduced-motion.test.mjs`）。
 *
 * @param {{
 *   onStatic: () => void,
 *   onAnimate: () => void,
 *   query?: { matches: boolean, addEventListener: Function, removeEventListener: Function },
 * }} options
 * @returns {{ start: () => void, stop: () => void }}
 */
export function createReducedMotionGate({ onStatic, onAnimate, query }) {
  const media = query ?? window.matchMedia('(prefers-reduced-motion: reduce)')

  const apply = () => {
    if (media.matches) onStatic()
    else onAnimate()
  }

  return {
    /** 订阅变化并立刻按当前设置应用一次。 */
    start() {
      media.addEventListener('change', apply)
      apply()
    },
    /** 退订。循环的开停由调用方在 onStatic / onAnimate 里负责。 */
    stop() {
      media.removeEventListener('change', apply)
    },
  }
}
