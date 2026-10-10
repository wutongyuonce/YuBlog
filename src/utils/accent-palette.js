/** 全站点缀色的唯一配置；首项也是无脚本和非法保存值的默认配色。 */
export const ACCENT_PALETTES = [
  {
    id: 'rose',
    name: '原粉色',
    color: '#ad526c',
    soft: '#c98299',
    dark: '#e7a1b5',
    darkSoft: 'color-mix(in srgb, #d58ba3 82%, #fff 18%)',
  },
  { id: 'violet', name: '灰紫', color: '#665477', dark: '#d0adf2' },
  { id: 'purple', name: '深紫', color: '#3a1b74', dark: '#a987e8' },
  { id: 'blue', name: '雾蓝', color: '#476d89', dark: '#7fafd2' },
  { id: 'green', name: '鼠尾草绿', color: '#52735c', dark: '#7fd298' },
]

/** 生成首屏即生效的变量，不让组件各自维护配色表。 */
export function accentPaletteStyles() {
  return ACCENT_PALETTES.map((palette, index) => {
    const selector = index ? `[data-accent-palette="${palette.id}"]` : ''
    const soft =
      palette.soft ?? `color-mix(in srgb, ${palette.color} 72%, #fff)`
    const dark =
      palette.dark ?? `color-mix(in srgb, ${palette.color} 45%, #fff)`
    const darkSoft = palette.darkSoft ?? dark
    return `:root${selector}{--accent:${palette.color};--accent-soft:${soft};--accent-swatch:${palette.color}}:root.dark${selector}{--accent:${dark};--accent-soft:${darkSoft}}`
  }).join('\n')
}

/**
 * 自包含工厂：Head 序列化同一函数提前恢复，选择器也使用同一规则。
 * 仅保存配色 ID；存储读取和写入失败都不妨碍当前页面应用配色。
 * @param {typeof ACCENT_PALETTES} palettes
 */
export function createAccentPreference(palettes) {
  const resolve = (value) =>
    palettes.find((palette) => palette.id === value) ?? palettes[0]

  const restore = (root = document.documentElement) => {
    let saved = null
    try {
      saved = window.localStorage.getItem('accent-palette')
    } catch {
      // 读取不可用时显示默认配色。
    }
    const palette = resolve(saved)
    root.dataset.accentPalette = palette.id
    return palette
  }

  const select = (value, root = document.documentElement) => {
    const palette = resolve(value)
    root.dataset.accentPalette = palette.id
    try {
      window.localStorage.setItem('accent-palette', palette.id)
    } catch {
      // 页面已经变色；后续重新加载允许回到默认配色。
    }
    return palette
  }

  return { resolve, restore, select }
}
