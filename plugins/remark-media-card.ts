import { fromHtml } from 'hast-util-from-html'
import type { ElementContent } from 'hast'
import type { Image, Parent, Root, RootContent } from 'mdast'
import { visit } from 'unist-util-visit'

/**
 * 封面卡片。博客、拾趣、关于共用这条 Markdown 管线，所以 `.md` 里都能写：
 *
 * ```md
 * :::card{title="侦探杰克 第四季" href="https://example.com" score="3.5" label="Tv"}
 * ![海报](./poster.jpg)
 *
 * 过到后期也是乏善可陈。介绍超出封面高度后在卡片内滚动。
 * :::
 * ```
 *
 * 封面必须是卡片里的第一张相对路径图片，这样仍走正文图片管线。
 * 连续的 `:::card` 合成一排；`href` 只接受 http(s)、mailto 和站内路径。
 * `layout="portrait"` 是 2:3 竖卡，`layout="square"` 是 1:1 方卡（专辑封面的常见比例）。
 * 两种陈列架都必须有标题和一张封面，`meta` 是可选小字，不接受评分、角标或介绍。
 * `scroll="auto"` 只是请求循环；每张都要写。布局、滚动模式或正文变化会分隔连续卡片组。
 */
type Directive = Extract<RootContent, { type: 'containerDirective' }>

interface Element {
  type: string
  children?: (Element | RootContent)[]
  value?: string
  url?: string
  title?: string | null
  alt?: string
  scrollMode?: 'auto' | 'manual'
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
  type: 'mediaCardElement',
  children,
  data: {
    hName,
    hProperties: { className: className.split(' '), ...properties },
  },
})

const text = (value: string) => ({ type: 'text' as const, value })

const isDirective = (node: RootContent): node is Directive =>
  node.type === 'containerDirective'

const isEmptyParagraph = (node: RootContent) =>
  node.type === 'paragraph' &&
  node.children.every(
    (child) => child.type === 'text' && child.value.trim() === ''
  )

const onlyImage = (node: RootContent): Image | null => {
  if (node.type === 'image') return node
  if (node.type !== 'paragraph') return null
  const meaningful = node.children.filter(
    (child) => child.type !== 'text' || child.value.trim() !== ''
  )
  const [image] = meaningful
  return meaningful.length === 1 && image?.type === 'image' ? image : null
}

const parseScore = (value: string | null | undefined) => {
  if (!value?.trim()) return null
  const score = Number(value)
  if (
    !Number.isFinite(score) ||
    score < 0 ||
    score > 5 ||
    !Number.isInteger(score * 2)
  ) {
    throw new Error(
      `Invalid card score: ${value}; expected 0–5 in half-star steps`
    )
  }
  return score
}

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

const classList = (value: unknown) =>
  Array.isArray(value) ? value.map(String) : value ? [String(value)] : []

const markCover = (image: Image, width = 240) => {
  const properties = (image.data as Element['data'])?.hProperties ?? {}
  image.data = {
    ...image.data,
    hProperties: {
      ...properties,
      className: [...classList(properties.className), 'media-card__cover'],
      width: properties.width ?? width,
    },
  }
}

const htmlMediaTags = new Set([
  'img',
  'picture',
  'svg',
  'video',
  'audio',
  'iframe',
  'object',
  'embed',
  'canvas',
])

const buildCard = (node: Directive): Element | null => {
  const layout = node.attributes?.layout ?? 'horizontal'
  if (layout !== 'horizontal' && layout !== 'portrait' && layout !== 'square')
    throw new Error('Card layout must be horizontal, portrait or square')
  const rail = layout === 'portrait' || layout === 'square'
  const rawScroll = node.attributes?.scroll
  if (rawScroll !== undefined && rawScroll !== 'auto' && rawScroll !== 'manual')
    throw new Error('Card scroll must be auto or manual')
  if (!rail && rawScroll !== undefined)
    throw new Error('Card scroll requires layout="portrait" or layout="square"')
  const title = node.attributes?.title?.trim() ?? ''
  const meta = node.attributes?.meta?.trim() ?? ''
  if (!rail && node.attributes?.meta !== undefined)
    throw new Error('Card meta requires layout="portrait" or layout="square"')
  const href = safeHref(node.attributes?.href)
  const label = node.attributes?.label?.trim() ?? ''
  const score = parseScore(node.attributes?.score)
  let cover: Image | null = null
  const review: RootContent[] = []

  for (const child of node.children) {
    if (!cover) {
      const image = onlyImage(child)
      if (image) {
        cover = image
        continue
      }
    }
    if (!isEmptyParagraph(child)) review.push(child)
  }

  for (const child of review) {
    visit(child, (node) => {
      let containsMedia =
        node.type === 'image' || node.type === 'imageReference'
      if (
        node.type.startsWith('mdxJsx') &&
        'name' in node &&
        typeof node.name === 'string' &&
        htmlMediaTags.has(node.name.toLowerCase())
      )
        containsMedia = true
      const data = node.data as Element['data']
      if (data?.hName && htmlMediaTags.has(data.hName.toLowerCase()))
        containsMedia = true
      if (node.type === 'html' || data?.hChildren) {
        visit(
          node.type === 'html'
            ? fromHtml(node.value, { fragment: true })
            : { type: 'root', children: data?.hChildren ?? [] },
          'element',
          (element) => {
            if (htmlMediaTags.has(element.tagName)) containsMedia = true
          }
        )
      }
      if (containsMedia) {
        throw new Error(
          `Card review "${title}" cannot contain media; use at most one standalone cover image`
        )
      }
    })
  }

  if (rail) {
    if (!title || !cover)
      throw new Error(
        'Rail card requires a title and one standalone cover image'
      )
    if (
      review.length ||
      node.attributes?.score !== undefined ||
      node.attributes?.label !== undefined
    )
      throw new Error(
        'Rail card accepts only a cover, title and optional meta; no review, score or label'
      )
  }
  if (!title && !cover && review.length === 0) return null
  if (cover) markCover(cover, rail ? 480 : 240)

  const body: (Element | RootContent)[] = []
  if (title) {
    body.push(
      href
        ? {
            type: 'link',
            url: href,
            title: null,
            children: [text(title)],
            data: { hProperties: { className: ['media-card__title'] } },
          }
        : element('p', 'media-card__title', [text(title)])
    )
  }
  if (rail && meta)
    body.push(element('p', 'media-card__meta', [text(meta)], { tabIndex: 0 }))
  if (score !== null) {
    body.push(
      element('p', 'media-card__score', [
        text('评分：'),
        element('span', 'media-card__stars', [], {
          style: `--score:${score}`,
          ariaHidden: 'true',
        }),
        element('span', 'media-card__rating-value', [
          text(`${score} 分，满分 5 分`),
        ]),
      ])
    )
  }
  if (review.length) body.push(element('div', 'media-card__review', review))

  const card = element(
    'article',
    rail ? `media-card media-card--${layout}` : 'media-card',
    [
      ...(label ? [element('span', 'media-card__label', [text(label)])] : []),
      ...(cover ? [cover] : []),
      ...(body.length ? [element('div', 'media-card__body', body)] : []),
    ]
  )
  card.scrollMode = rawScroll === 'auto' ? 'auto' : 'manual'
  return card
}

const isCard = (node: RootContent | Element) =>
  node.type === 'mediaCardElement' &&
  classList((node.data as Element['data'])?.hProperties?.className).includes(
    'media-card'
  )

const railLayout = (node: RootContent | Element) => {
  const classes = classList(
    (node.data as Element['data'])?.hProperties?.className
  )
  if (classes.includes('media-card--square')) return 'square'
  if (classes.includes('media-card--portrait')) return 'portrait'
  return 'horizontal'
}

const groupKey = (node: RootContent | Element) =>
  `${railLayout(node)}:${(node as Element).scrollMode === 'auto' ? 'auto' : 'manual'}`

const wrapCards = (parent: Parent) => {
  const next: RootContent[] = []
  let group: RootContent[] = []
  const flush = () => {
    if (!group.length) return
    const rail = railLayout(group[0]) !== 'horizontal'
    const auto = (group[0] as Element).scrollMode === 'auto'
    // 轨道在插件里就固定下来。脚本只负责复制，不能再把卡片挪出竖卡选择器。
    const children = rail
      ? [element('div', 'media-cards__track', group)]
      : group
    next.push(
      element(
        'div',
        [
          'media-cards',
          rail ? 'media-cards--rail' : '',
          auto ? 'media-cards--auto' : '',
        ]
          .filter(Boolean)
          .join(' '),
        children,
        rail ? { tabIndex: 0, role: 'region', ariaLabel: '横向卡片栏' } : {}
      ) as unknown as RootContent
    )
    group = []
  }

  for (const child of parent.children) {
    if (isCard(child)) {
      if (group.length && groupKey(group[0]) !== groupKey(child)) flush()
      group.push(child)
      continue
    }
    flush()
    if ('children' in child && child.children) wrapCards(child)
    next.push(child)
  }
  flush()
  parent.children = next
}

function remarkMediaCard() {
  return (tree: Root) => {
    const replace = (parent: Parent, insideCard = false) => {
      parent.children = parent.children.flatMap((child) => {
        if (isDirective(child) && child.name === 'card') {
          if (insideCard)
            throw new Error('Nested :::card directives are not supported')
          replace(child, true)
          const card = buildCard(child)
          return card ? [card as unknown as RootContent] : []
        }
        if ('children' in child && child.children) replace(child, insideCard)
        return [child]
      })
    }
    replace(tree)
    wrapCards(tree)
  }
}

export default remarkMediaCard
