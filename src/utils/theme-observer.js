/**
 * 观察实际生效的深浅主题；忽略转场等无关 class 变化。
 * Dot / Snow 共用订阅，静态背景也能在切换和页面交换后重绘。
 * @param {() => void} onChange
 * @returns {() => void} 停止订阅，组件断开时调用
 */
export function observeTheme(onChange) {
  const root = document.documentElement
  let dark = root.classList.contains('dark')
  const observer = new MutationObserver(() => {
    const nextDark = root.classList.contains('dark')
    if (nextDark === dark) return
    dark = nextDark
    onChange()
  })
  observer.observe(root, { attributes: true, attributeFilter: ['class'] })
  return () => observer.disconnect()
}
