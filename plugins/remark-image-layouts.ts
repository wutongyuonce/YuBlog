import { visit, SKIP } from 'unist-util-visit'
import type {
  Image,
  ImageReference,
  Nodes,
  Parent,
  Root,
  RootContent,
} from 'mdast'
import type { ElementContent } from 'hast'
import type { VFile } from 'vfile'
import { fromHtml } from 'hast-util-from-html'
import { toHtml } from 'hast-util-to-html'

type Directive = Extract<RootContent, { type: 'containerDirective' }>

const element = (
  name: string,
  className: string,
  children: RootContent[],
  properties: Record<string, unknown> = {}
): RootContent =>
  ({
    type: 'imageLayoutElement',
    children,
    data: {
      hName: name,
      hProperties: { className: className.split(' '), ...properties },
    },
  }) as unknown as RootContent

const imagesIn = (node: RootContent): Image[] | null => {
  if (node.type !== 'paragraph') return null
  const children = node.children.filter(
    (child) => child.type !== 'text' || child.value.trim() !== ''
  )
  return children.length && children.every((child) => child.type === 'image')
    ? (children as Image[])
    : null
}

const nonProseTags = new Set([
  'img',
  'picture',
  'svg',
  'video',
  'audio',
  'iframe',
  'object',
  'embed',
  'canvas',
  'script',
  'style',
  'template',
])

// Keep raw HTML together so inline opening/closing tags retain their context;
// escape literal Markdown text/code so "<img>" is still readable prose.
const proseHtml = (node: Nodes): string => {
  if (node.type === 'definition' || node.type === 'footnoteDefinition')
    return ''
  if (node.type === 'html') return node.value
  const data = node.data as
    { hName?: string; hChildren?: ElementContent[] } | undefined
  const tag =
    node.type.startsWith('mdxJsx') &&
    'name' in node &&
    typeof node.name === 'string'
      ? node.name
      : data?.hName
  if (tag && nonProseTags.has(tag.toLowerCase())) return ''
  if (data?.hChildren) return toHtml({ type: 'root', children: data.hChildren })
  if ('value' in node) return toHtml({ type: 'text', value: node.value })
  return 'children' in node ? node.children.map(proseHtml).join('\n') : ''
}

const hasProse = (children: RootContent[]): boolean => {
  let found = false
  visit(
    fromHtml(children.map(proseHtml).join('\n'), { fragment: true }),
    (node) => {
      if (node.type === 'element' && nonProseTags.has(node.tagName)) return SKIP
      if (node.type === 'text' && node.value.trim()) found = true
    }
  )
  return found
}

/** Layout structure is decided here; images remain MDAST images for Astro. */
export default function remarkImageLayouts() {
  return (tree: Root, file: VFile) => {
    const fail = (message: string, node: RootContent): never =>
      file.fail(message, node.position)

    const transform = (parent: Parent, insideLayout = false) => {
      parent.children = parent.children.map((child) => {
        if (
          child.type !== 'containerDirective' ||
          !['gallery', 'figure'].includes(child.name)
        ) {
          if ('children' in child) transform(child as Parent, insideLayout)
          return child
        }
        const node: Directive = child
        if (insideLayout) fail('Image layouts cannot be nested', node)
        transform(node, true)
        const attrs = node.attributes ?? {}
        const allowed =
          node.name === 'gallery' ? ['layout', 'columns', 'widths'] : ['side']
        for (const key of Object.keys(attrs)) {
          if (!allowed.includes(key))
            fail(`Unknown ${node.name} attribute: ${key}`, node)
        }

        if (node.name === 'gallery') {
          const layout = attrs.layout === undefined ? 'grid' : attrs.layout
          if (layout !== 'grid' && layout !== 'scroll')
            fail('Gallery layout must be grid or scroll', node)
          if (layout === 'scroll' && attrs.columns !== undefined)
            fail('Scroll galleries do not accept columns', node)
          if (layout === 'scroll' && attrs.widths !== undefined)
            fail('Scroll galleries do not accept widths', node)
          let tracks: string[] | undefined
          if (attrs.widths !== undefined) {
            tracks = (attrs.widths ?? '').trim().split(/\s+/)
            if (
              ![2, 3].includes(tracks.length) ||
              tracks.some((token) => {
                const match = /^(\d+(?:\.\d+)?|\.\d+)(px|fr)$/.exec(token)
                const value = match ? Number(match[1]) : NaN
                return !Number.isFinite(value) || value <= 0
              })
            )
              fail(
                'Grid gallery widths must be 2 or 3 positive finite px/fr tracks',
                node
              )
          }
          const columns =
            attrs.columns === undefined
              ? (tracks?.length.toString() ?? '2')
              : attrs.columns
          if (columns !== '2' && columns !== '3')
            fail('Grid gallery columns must be 2 or 3', node)
          if (tracks && Number(columns) !== tracks.length)
            fail('Grid gallery columns must match widths count', node)
          const images = node.children.flatMap((item) => {
            const images = imagesIn(item)
            if (!images)
              return fail(
                'Gallery accepts only standalone Markdown images',
                item
              )
            return images
          })
          if (!images.length)
            fail('Gallery must contain at least one image', node)
          return element(
            'div',
            `image-gallery image-gallery--${layout}`,
            images.map((image) =>
              element('div', 'image-gallery__item', [image])
            ),
            layout === 'grid'
              ? {
                  'data-columns': columns,
                  ...(tracks
                    ? {
                        style: `--image-gallery-columns: ${tracks.map((token) => `minmax(0, ${token})`).join(' ')}`,
                      }
                    : {}),
                }
              : {}
          )
        }

        const side = attrs.side === undefined ? 'right' : attrs.side
        if (side !== 'left' && side !== 'right')
          fail('Figure side must be left or right', node)
        const images = node.children[0] && imagesIn(node.children[0])
        if (!images || images.length !== 1 || !hasProse(node.children.slice(1)))
          return fail(
            'Figure requires one first standalone image followed by prose',
            node
          )
        return element('div', `image-figure image-figure--${side}`, [
          element('div', 'image-figure__media', images),
          ...node.children.slice(1),
        ])
      })
    }
    transform(tree)

    // The inert template keeps a full-size rendition in the same Astro pipeline.
    // It is neither downloaded before opening nor included by the RSS sanitizer.
    const isImage = (node: RootContent): node is Image | ImageReference =>
      node.type === 'image' || node.type === 'imageReference'
    const view = (image: Image | ImageReference, visible: RootContent) => {
      const full = {
        ...image,
        data: undefined,
      }
      return element('span', 'image-view', [
        visible,
        element('template', 'image-view__source', [full]),
      ])
    }
    const wrap = (parent: Parent) => {
      parent.children = parent.children.map((child) => {
        if (isImage(child)) return view(child, child)
        // Keep the zoom control outside an authored link, not inside it.
        if (
          (child.type === 'link' || child.type === 'linkReference') &&
          child.children.length === 1 &&
          isImage(child.children[0])
        )
          return view(child.children[0], child)
        if ('children' in child) wrap(child as Parent)
        return child
      })
    }
    wrap(tree)
  }
}

/** Keep generated source images visible to Astro's image visitor after rehype-raw. */
export function rehypeImageSources() {
  return (tree: import('hast').Root, file: VFile) => {
    const owned = new Set([
      ...(file.data.astro?.localImagePaths ?? []),
      ...(file.data.astro?.remoteImagePaths ?? []),
    ])
    visit(tree, 'element', (node) => {
      if (
        node.tagName !== 'template' ||
        !node.properties.className?.includes('image-view__source')
      )
        return
      // Share image objects: Astro mutates properties via children; the final
      // raw pass serializes content. Neither view may replace these nodes.
      if (node.content) {
        node.children = node.content.children.filter(
          (child) => child.type !== 'doctype'
        )
        for (const image of node.children) {
          if (image.type !== 'element' || image.tagName !== 'img') continue
          const src = image.properties.src
          if (typeof src === 'string' && owned.has(decodeURI(src))) {
            // Only Astro-owned images consume these props; external/public
            // images must not leak them into HTML. The viewer uses src only.
            Object.assign(image.properties, { layout: 'none', widths: [] })
          }
        }
      }
    })
  }
}
