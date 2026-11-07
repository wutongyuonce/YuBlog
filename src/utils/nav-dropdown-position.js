/**
 * 顶栏下拉面板的水平落点：优先居中在触发按钮正下方，再夹进导航外框，
 * 使宽屏、缩窄桌面与手机两排布局都不偏出按钮或越出导航。
 *
 * 所有坐标都是视口 px；返回值相对面板的包含块（`.nav-bar__pages`）左缘。
 *
 * @param {{
 *   triggerLeft: number,
 *   triggerWidth: number,
 *   panelWidth: number,
 *   boundLeft: number,
 *   boundRight: number,
 *   originLeft: number,
 * }} box
 * @returns {number}
 */
export function placeDropdownPanel({
  triggerLeft,
  triggerWidth,
  panelWidth,
  boundLeft,
  boundRight,
  originLeft,
}) {
  const preferred = triggerLeft + triggerWidth / 2 - panelWidth / 2
  const max = Math.max(boundLeft, boundRight - panelWidth)
  const left = Math.min(Math.max(preferred, boundLeft), max)
  return Math.round(left - originLeft)
}
