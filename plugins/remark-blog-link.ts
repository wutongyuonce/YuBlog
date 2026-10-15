import type { Parent, Root, RootContent } from 'mdast'
import type { ElementContent } from 'hast'
import type { VFile } from 'vfile'

import { SITE } from '../src/config.ts'
import { resolveBlogEntry } from './blog-entry.ts'

/**
 * 双向博文链接卡片（手工互链，不做自动反链）：
 *
 * ```md
 * :::blog-link{slug="astro"}
 * :::
 *
 * :::blog-link{href="/blogs/astro/" title="Astro Notes" description="…"}
 * :::
 * ```
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

const element = (
  hName: string,
  className: string,
  children: (Element | RootContent)[] = [],
  properties: Record<string, unknown> = {}
): Element => ({
  type: 'blogLinkElement',
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

const safeHref = (value: string | null | undefined) => {
  const href = value?.trim() ?? ''
  if (
    href.includes('\\') ||
    [...href].some(
      (char) => char.charCodeAt(0) <= 32 || char.charCodeAt(0) === 127
    )
  )
    return ''
  if (/^https?:\/\//i.test(href) || /^mailto:/i.test(href)) return href
  if (href.startsWith('/') && !href.startsWith('//')) return href
  return ''
}

const defaultAvatar = () => {
  const base = SITE.base.replace(/\/+$/, '')
  return `${base}/avatar.webp`.replace(/\/+/g, '/')
}

function remarkBlogLink() {
  return (tree: Root, file: VFile) => {
    const fail = (message: string, node: RootContent): never =>
      file.fail(message, node.position)

    const replace = (parent: Parent, inside = false) => {
      parent.children = parent.children.flatMap((child) => {
        if (isDirective(child) && child.name === 'blog-link') {
          if (inside)
            return fail(
              'Nested :::blog-link directives are not supported',
              child
            )
          if (
            child.children.some(
              (c) =>
                !(
                  c.type === 'paragraph' &&
                  c.children.every(
                    (n) => n.type === 'text' && n.value.trim() === ''
                  )
                )
            )
          )
            return fail(
              ':::blog-link must be empty; use attributes only',
              child
            )

          const slug = child.attributes?.slug?.trim()
          const hrefAttr = child.attributes?.href
          const titleOverride = child.attributes?.title?.trim()
          const descOverride = child.attributes?.description?.trim()
          const avatarOverride = child.attributes?.avatar?.trim()

          let href: string
          let title = titleOverride ?? ''
          let description = descOverride ?? ''

          if (slug) {
            const entry = resolveBlogEntry(slug)
            if (!entry)
              return fail(`:::blog-link slug not found: ${slug}`, child)
            if (entry.draft)
              return fail(`:::blog-link points to draft post: ${slug}`, child)
            href = entry.href
            if (!title) title = entry.title
            if (descOverride === undefined) description = entry.description
          } else {
            href = safeHref(hrefAttr)
            if (!href)
              return fail(
                ':::blog-link requires slug="…" or a safe href="…" (http(s)/mailto/站内路径)',
                child
              )
            if (!title)
              return fail(':::blog-link without slug requires title="…"', child)
          }

          const avatar = avatarOverride || defaultAvatar()

          const body = element('span', 'blog-link-card__body', [
            element('span', 'blog-link-card__title', [text(title)]),
            ...(description
              ? [element('span', 'blog-link-card__desc', [text(description)])]
              : []),
          ])

          const thumb = element('span', 'blog-link-card__thumb', [
            element('img', 'blog-link-card__avatar', [], {
              src: avatar,
              alt: '',
              width: 72,
              height: 72,
              loading: 'lazy',
              decoding: 'async',
              ariaHidden: 'true',
            }),
          ])

          const card = element('a', 'blog-link-card', [body, thumb], { href })
          const wrap = element('div', 'blog-link-cards', [card])
          return [wrap as unknown as RootContent]
        }
        if ('children' in child && child.children)
          replace(child as Parent, inside)
        return [child]
      })
    }

    replace(tree)
  }
}

export default remarkBlogLink
