import { existsSync } from 'node:fs'
import path from 'node:path'

import type { Image, Parent, Root, RootContent } from 'mdast'
import type { ElementContent } from 'hast'
import type { VFile } from 'vfile'

import { classifyMediaRef, isMirrorableFile } from './media-paths.ts'

/**
 * Excalidraw 嵌入。博客／拾趣／关于共用 Markdown 管线：
 *
 * ```md
 * :::excalidraw{src="./post-img/diagram.excalidraw" alt="说明"}
 * :::
 * ```
 *
 * 客户端用官方 exportToSvg 渲染源文件，自控只读视口；展开用当页 dialog。
 * `.excalidraw` 镜像到 `/_media/…`，下载保留原文件。
 * `preview`（SVG／PNG）可选，仅作无 JS／加载失败时的回退。
 */

type Directive = Extract<RootContent, { type: 'containerDirective' }>

interface Element {
  type: string
  children?: (Element | RootContent)[]
  data?: {
    hName?: string
    hProperties?: Record<string, unknown>
    hChildren?: ElementContent[]
  }
}

const PREVIEW_EXTS = ['.svg', '.png', '.webp', '.jpg', '.jpeg'] as const

const element = (
  hName: string,
  className: string,
  children: (Element | RootContent)[] = [],
  properties: Record<string, unknown> = {}
): Element => ({
  type: 'excalidrawElement',
  children,
  data: {
    hName,
    hProperties: {
      ...(className ? { className: className.split(' ') } : {}),
      ...properties,
    },
  },
})

const text = (value: string) => ({ type: 'text' as const, value })

const isDirective = (node: RootContent): node is Directive =>
  node.type === 'containerDirective'

/** Optional preview: explicit attr, else same-basename image next to source. */
const resolvePreview = (
  markdownPath: string,
  srcPath: string,
  previewAttr: string | undefined
): { relative: string; absolute: string } | null => {
  const dir = path.dirname(markdownPath)
  if (previewAttr?.trim()) {
    const absolute = path.resolve(dir, previewAttr.trim())
    return {
      relative: previewAttr.trim().replace(/\\/g, '/'),
      absolute,
    }
  }
  const parsed = path.parse(srcPath)
  for (const ext of PREVIEW_EXTS) {
    const absolute = path.join(parsed.dir, parsed.name + ext)
    if (existsSync(absolute)) {
      const relative = path.relative(dir, absolute).split(path.sep).join('/')
      return {
        relative: relative.startsWith('.') ? relative : `./${relative}`,
        absolute,
      }
    }
  }
  return null
}

function remarkExcalidraw() {
  return (tree: Root, file: VFile) => {
    const markdownPath = file.path
    if (!markdownPath) return

    const fail = (message: string, node: RootContent): never =>
      file.fail(message, node.position)

    const replace = (parent: Parent, inside = false) => {
      parent.children = parent.children.flatMap((child) => {
        if (isDirective(child) && child.name === 'excalidraw') {
          if (inside)
            return fail(
              'Nested :::excalidraw directives are not supported',
              child
            )
          if (child.children.some((c) => !isEmptyish(c)))
            return fail(
              ':::excalidraw must be empty; put src/preview in attributes',
              child
            )

          const src = child.attributes?.src?.trim() ?? ''
          if (!src)
            return fail(':::excalidraw requires src="…excalidraw"', child)

          const ref = classifyMediaRef(src, markdownPath)
          if (ref.kind === 'unsupported' && ref.scheme === 'blob')
            return fail(
              ':::excalidraw src cannot use blob: URLs; use a relative .excalidraw path',
              child
            )
          if (ref.kind !== 'local')
            return fail(
              `:::excalidraw src must be a relative path under src/ (got ${src})`,
              child
            )
          const extension = path.extname(ref.file).toLowerCase()
          if (extension !== '.excalidraw')
            return fail(
              ':::excalidraw src must be an .excalidraw scene; library files are not supported',
              child
            )
          if (!isMirrorableFile(ref.file))
            return fail(
              `:::excalidraw src file missing or not mirrorable: ${src}`,
              child
            )

          const previewAttr = child.attributes?.preview?.trim()
          const preview = resolvePreview(markdownPath, ref.file, previewAttr)
          if (previewAttr && preview && !existsSync(preview.absolute))
            return fail(
              `:::excalidraw preview not found: ${preview.relative}`,
              child
            )
          if (previewAttr && preview) {
            const previewExt = path.extname(preview.absolute).toLowerCase()
            if (
              !PREVIEW_EXTS.includes(
                previewExt as (typeof PREVIEW_EXTS)[number]
              )
            )
              return fail(
                `:::excalidraw preview must be an image (${PREVIEW_EXTS.join('/')})`,
                child
              )
          }
          // Explicit preview= that resolves but file missing already failed;
          // if attr set but resolve returned null somehow, fail:
          if (previewAttr && !preview)
            return fail(
              `:::excalidraw preview not found: ${previewAttr}`,
              child
            )

          const alt =
            child.attributes?.alt?.trim() ||
            path.parse(ref.file).name ||
            'Excalidraw 图'
          const height = child.attributes?.height?.trim() || ''

          const sourceHref = src // relative; rehype-media-assets → /_media/…

          const viewportChildren: (Element | RootContent)[] = [
            element('div', 'excalidraw-embed__host', [], {
              'data-excalidraw-host': '',
            }),
          ]

          if (preview && existsSync(preview.absolute)) {
            const image: Image = {
              type: 'image',
              url: preview.relative,
              title: null,
              alt,
              data: {
                hProperties: {
                  className: [
                    'excalidraw-embed__image',
                    'excalidraw-embed__fallback',
                  ],
                },
              },
            }
            viewportChildren.push(image)
          }

          // Hidden source <a> so rehype-media-assets rewrites to /_media/…
          // The viewer adds visible download and expand controls once ready.
          const toolbar = element('div', 'excalidraw-embed__source-slot', [
            {
              type: 'link',
              url: sourceHref,
              title: null,
              children: [text('Excalidraw 源文件')],
              data: {
                hProperties: {
                  className: ['excalidraw-embed__source'],
                  download: path.basename(ref.file),
                  ariaLabel: '下载 Excalidraw 源文件',
                },
              },
            },
          ])

          const noscript = element('p', 'excalidraw-embed__noscript-source', [
            {
              type: 'link',
              url: sourceHref,
              title: null,
              children: [text('Excalidraw 源文件')],
              data: {
                hProperties: {
                  download: path.basename(ref.file),
                },
              },
            },
          ])

          const figure = element(
            'figure',
            'excalidraw-embed',
            [
              element('div', 'excalidraw-embed__viewport', viewportChildren),
              toolbar,
              noscript,
            ],
            {
              ...(height ? { style: `--excalidraw-height:${height}` } : {}),
              'role': 'region',
              'ariaLabel': alt,
              'tabIndex': 0,
              'data-excalidraw-viewer': '',
              'data-excalidraw-src': sourceHref,
            }
          )

          return [figure as unknown as RootContent]
        }
        if ('children' in child && child.children)
          replace(child as Parent, inside)
        return [child]
      })
    }

    replace(tree)
  }
}

const isEmptyish = (node: RootContent) => {
  if (node.type === 'paragraph')
    return node.children.every(
      (child) => child.type === 'text' && child.value.trim() === ''
    )
  return false
}

export default remarkExcalidraw
