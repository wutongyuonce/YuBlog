import { existsSync } from 'node:fs'
import path from 'node:path'

import type { Image, Parent, Root, RootContent } from 'mdast'
import type { ElementContent } from 'hast'
import type { VFile } from 'vfile'

import {
  classifyMediaRef,
  DRAWING_EXTENSIONS,
  isMirrorableFile,
} from './media-paths.ts'

/**
 * Excalidraw 嵌入。博客／拾趣／关于共用 Markdown 管线：
 *
 * ```md
 * :::excalidraw{src="./post-img/diagram.excalidraw" preview="./post-img/diagram.svg" alt="说明"}
 * :::
 * ```
 *
 * 预览图走 Astro 图片管线；`.excalidraw` 源镜像到 `/_media/…`，外链是永久静态 URL，不是 blob:。
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

const resolvePreview = (
  markdownPath: string,
  srcPath: string,
  previewAttr: string | undefined
): { relative: string; absolute: string } => {
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
      const relative = path
        .relative(dir, absolute)
        .split(path.sep)
        .join('/')
      return {
        relative: relative.startsWith('.') ? relative : `./${relative}`,
        absolute,
      }
    }
  }
  throw new Error(
    'Excalidraw preview missing: set preview="…" or place a same-basename .svg/.png/.webp next to the .excalidraw file'
  )
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
            return fail('Nested :::excalidraw directives are not supported', child)
          if (child.children.some((c) => !isEmptyish(c)))
            return fail(
              ':::excalidraw must be empty; put src/preview in attributes',
              child
            )

          const src = child.attributes?.src?.trim() ?? ''
          if (!src) return fail(':::excalidraw requires src="…excalidraw"', child)

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
          if (!DRAWING_EXTENSIONS.has(extension))
            return fail(
              `:::excalidraw src must end with ${[...DRAWING_EXTENSIONS].join(' / ')}`,
              child
            )
          if (!isMirrorableFile(ref.file))
            return fail(
              `:::excalidraw src file missing or not mirrorable: ${src}`,
              child
            )

          let preview: { relative: string; absolute: string }
          try {
            preview = resolvePreview(
              markdownPath,
              ref.file,
              child.attributes?.preview ?? undefined
            )
          } catch (error) {
            return fail(
              error instanceof Error ? error.message : String(error),
              child
            )
          }
          if (!existsSync(preview.absolute))
            return fail(
              `:::excalidraw preview not found: ${preview.relative}`,
              child
            )
          const previewExt = path.extname(preview.absolute).toLowerCase()
          if (!PREVIEW_EXTS.includes(previewExt as (typeof PREVIEW_EXTS)[number]))
            return fail(
              `:::excalidraw preview must be an image (${PREVIEW_EXTS.join('/')})`,
              child
            )

          const alt =
            child.attributes?.alt?.trim() ||
            path.parse(ref.file).name ||
            'Excalidraw 图'
          const height =
            child.attributes?.height?.trim() || 'min(70vh, 520px)'

          const image: Image = {
            type: 'image',
            url: preview.relative,
            title: null,
            alt,
            data: {
              hProperties: {
                className: ['excalidraw-embed__image'],
              },
            },
          }

          const sourceHref = src // relative; rehype-media-assets rewrites to /_media/…

          const toolbar = element(
            'div',
            'excalidraw-embed__toolbar',
            [
              element('button', 'excalidraw-embed__zoom-out', [], {
                type: 'button',
                ariaLabel: '缩小',
              }),
              element('span', 'excalidraw-embed__zoom-label', [text('100%')], {
                ariaLive: 'polite',
              }),
              element('button', 'excalidraw-embed__zoom-in', [], {
                type: 'button',
                ariaLabel: '放大',
              }),
              element('span', 'excalidraw-embed__sep', [], { ariaHidden: 'true' }),
              element('button', 'excalidraw-embed__reset', [], {
                type: 'button',
                ariaLabel: '复位到初始大小',
              }),
              {
                type: 'link',
                url: sourceHref,
                title: null,
                children: [text('源文件')],
                data: {
                  hProperties: {
                    className: ['excalidraw-embed__source'],
                    target: '_blank',
                    rel: 'noopener noreferrer',
                    download: path.basename(ref.file),
                    ariaLabel: '打开 Excalidraw 源文件',
                  },
                },
              },
            ],
            { role: 'toolbar', ariaLabel: 'Excalidraw 图控制' }
          )

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
              element('div', 'excalidraw-embed__viewport', [
                element('div', 'excalidraw-embed__canvas', [image]),
              ]),
              toolbar,
              noscript,
            ],
            {
              style: `--excalidraw-height:${height}`,
              role: 'region',
              ariaLabel: alt,
              tabIndex: 0,
              'data-excalidraw-viewer': '',
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
