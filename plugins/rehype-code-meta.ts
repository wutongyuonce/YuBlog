import { visit } from 'unist-util-visit'
import type { Root } from 'hast'

/** Raw 重建元素时会丢 data.meta；metastring 是 Expressive Code 支持的传递接口。 */
export default function rehypeCodeMeta() {
  return (tree: Root) => {
    visit(tree, 'element', (node) => {
      const meta = node.data && 'meta' in node.data ? node.data.meta : undefined
      if (node.tagName === 'code' && typeof meta === 'string')
        node.properties.metastring = meta
    })
  }
}
