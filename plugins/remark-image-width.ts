import { visit } from 'unist-util-visit'

import type { Image, Root } from 'mdast'

/**
 * 正文图片的宽度标记。
 *
 * 图片进入 Astro 图片管线后默认按原图尺寸输出，这个插件让作者仍能控制显示宽度：
 *
 * ```md
 * ![满宽](./代码库搜索-img/a.png)
 * ![半宽|w353](./代码库搜索-img/b.png)
 * ```
 *
 * 标记会被剥离，转成 `width` 传给图片管线。正文目标列宽为 670px，所以「半宽」写
 * `|w335`。用宽度而不是 CSS `max-width`，是因为管线按 `width` 同时生成
 * `srcset` 和 `sizes`，浏览器才会真的去下小图；只用 CSS 限制显示宽度的话，
 * `sizes` 仍按原图尺寸计算，窄屏和大屏都会多下载。
 */
const WIDTH_MARKER = /\|w(\d+)$/

function remarkImageWidth() {
  return (tree: Root) => {
    visit(tree, 'image', (node: Image) => {
      const match = node.alt ? WIDTH_MARKER.exec(node.alt) : null
      if (!match || match.index === undefined) return

      // 标记只用于声明尺寸，不能留在 alt 里。
      node.alt = node.alt!.slice(0, match.index)
      node.data = {
        ...node.data,
        hProperties: {
          ...(
            node.data as { hProperties?: Record<string, unknown> } | undefined
          )?.hProperties,
          width: Number(match[1]),
        },
      }
    })
  }
}

export default remarkImageWidth
