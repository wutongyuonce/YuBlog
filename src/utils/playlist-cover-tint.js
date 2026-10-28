/**
 * 从 RGBA 像素缓冲提取歌单卡片玻璃底色；不依赖 DOM，便于单测。
 * 跳过近黑／近白与透明像素，避免脏泥色；样本过少时回退到全体不透明平均。
 *
 * @param {ArrayLike<number>} data RGBA 交错缓冲（长度应为 4 的倍数）
 * @returns {{ tint: string, soft: string } | null} 空格分隔的 RGB 通道，供 `rgb(var(--x) / a)` 使用
 */
export function tintFromRgba(data) {
  if (!data || data.length < 4 || data.length % 4 !== 0) return null

  const accumulate = (skipExtremes) => {
    let r = 0
    let g = 0
    let b = 0
    let n = 0
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 128) continue
      const rr = data[i]
      const gg = data[i + 1]
      const bb = data[i + 2]
      if (skipExtremes) {
        const lum = (rr + gg + bb) / 3
        if (lum < 24 || lum > 232) continue
      }
      r += rr
      g += gg
      b += bb
      n += 1
    }
    return n ? [r / n, g / n, b / n] : null
  }

  const avg = accumulate(true) || accumulate(false)
  if (!avg) return null

  const [liftedR, liftedG, liftedB] = liftForGlassWash(avg[0], avg[1], avg[2])
  const tint = `${liftedR} ${liftedG} ${liftedB}`
  const soft = `${mixChannel(liftedR, 186)} ${mixChannel(liftedG, 186)} ${mixChannel(liftedB, 186)}`
  return { tint, soft }
}

function liftForGlassWash(r, g, b) {
  const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
  const target = 118
  const scale = lum >= target ? 1 : Math.min(target / Math.max(lum, 1), 2.4)
  return [
    Math.min(255, Math.round(r * scale)),
    Math.min(255, Math.round(g * scale)),
    Math.min(255, Math.round(b * scale)),
  ]
}

function mixChannel(channel, toward) {
  return Math.round(channel * 0.58 + toward * 0.42)
}
