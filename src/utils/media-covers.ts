/**
 * 影音书游封面的唯一解析入口：`items.json` 的 `cover` 是相对
 * `src/content/interests/` 的路径，这里把它映射到 Astro 图片模块，
 * 合页封面墙与首页近期书影游共用，缺图在构建期报错。
 */
import { getImage } from 'astro:assets'
import type { ImageMetadata } from 'astro'

const coverModules = import.meta.glob<{ default: ImageMetadata }>(
  '/src/content/interests/{movie,anime,tv,game,book}/*.{jpg,jpeg,png,webp,avif,gif,JPG,JPEG,PNG,WEBP,AVIF,GIF}',
  { eager: true }
)

const coverByLower = new Map(
  Object.entries(coverModules).map(([key, mod]) => [
    key.toLowerCase(),
    mod.default,
  ])
)

export function mediaCoverSource(cover: string): ImageMetadata {
  const key = `/src/content/interests/${cover}`
  const src = coverModules[key]?.default || coverByLower.get(key.toLowerCase())
  if (!src) throw new Error(`影音书游：找不到封面 ${cover}`)
  return src
}

/** 按最大宽度输出 WebP，不放大原图。 */
export async function mediaCoverUrl(cover: string, width: number) {
  const src = mediaCoverSource(cover)
  const image = await getImage({
    src,
    width: Math.min(width, src.width),
    format: 'webp',
  })
  return image.src
}
