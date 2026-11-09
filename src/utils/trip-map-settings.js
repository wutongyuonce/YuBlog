/**
 * 旅行页地图设置：底图风格与 3D 视角。取值的校验、默认值、风格解析和
 * 随缩放倾斜的角度都在这里；地图如何应用见 `trip-map.ts`，面板在页面脚本。
 */

/** localStorage 键；设置只保存在当前浏览器。 */
export const MAP_SETTINGS_KEY = 'trips-map-settings'

/** OpenFreeMap 的样式名；`auto` 浅色用 liberty、深色用 dark。 */
export const MAP_STYLES = [
  { id: 'auto', label: '跟随主题', note: '浅色彩色，深色暗夜' },
  { id: 'liberty', label: '彩色', note: '道路与水系分色' },
  { id: 'bright', label: '明亮', note: '色彩更饱和' },
  { id: 'positron', label: '浅灰', note: '底图退后，路线更突出' },
  { id: 'dark', label: '深色', note: '黑底灰路' },
  { id: 'fiord', label: '深蓝', note: '蓝灰色调' },
]

const DARK_STYLES = new Set(['dark', 'fiord'])

export const DEFAULT_MAP_SETTINGS = { style: 'auto', tilt: true }

// 远看全国时平视，靠近街道时倾斜；[缩放级别, 倾斜角度]。
const PITCHES = [
  [4, 0],
  [7, 25],
  [10, 40],
  [13, 55],
]

/**
 * 从存储的文字读出设置；格式不对或取值未知时回到默认值。
 * @param {string | null | undefined} raw
 * @returns {{ style: string, tilt: boolean }}
 */
export function parseMapSettings(raw) {
  let value
  try {
    value = JSON.parse(raw ?? 'null')
  } catch {
    value = null
  }
  return {
    style: MAP_STYLES.some((style) => style.id === value?.style)
      ? value.style
      : DEFAULT_MAP_SETTINGS.style,
    tilt:
      typeof value?.tilt === 'boolean' ? value.tilt : DEFAULT_MAP_SETTINGS.tilt,
  }
}

/**
 * 当前设置与站点主题下实际使用的底图样式名。
 * @param {{ style: string }} settings
 * @param {boolean} dark 站点是否为深色主题
 */
export function resolveMapStyle(settings, dark) {
  if (settings.style !== 'auto') return settings.style
  return dark ? 'dark' : 'liberty'
}

/** @param {string} name OpenFreeMap 样式名 */
export function mapStyleUrl(name) {
  return `https://tiles.openfreemap.org/styles/${name}`
}

/** 该样式是否是深色底图，决定立体楼块的颜色。 */
export function isDarkMapStyle(name) {
  return DARK_STYLES.has(name)
}

/**
 * 3D 视角下某缩放级别的倾斜角度（度），在各档之间线性过渡。
 * @param {number} zoom
 */
export function pitchAtZoom(zoom) {
  const above = PITCHES.findIndex(([stop]) => stop > zoom)
  if (above === 0) return PITCHES[0][1]
  if (above === -1) return PITCHES.at(-1)[1]
  const [lowZoom, lowPitch] = PITCHES[above - 1]
  const [highZoom, highPitch] = PITCHES[above]
  return (
    lowPitch +
    ((highPitch - lowPitch) * (zoom - lowZoom)) / (highZoom - lowZoom)
  )
}
