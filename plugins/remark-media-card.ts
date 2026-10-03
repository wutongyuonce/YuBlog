import type { Image, Parent, Root, RootContent } from 'mdast'

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
 */
type Directive = Extract<RootContent, { type: 'containerDirective' }>

interface Element {
  type: string
  children?: (Element | RootContent)[]
  value?: string
  url?: string
  title?: string | null
  alt?: string
  data?: {
    hName?: string
    hProperties?: Record<string, unknown>
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
    hProperties: { className: [className], ...properties },
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

const markCover = (image: Image) => {
  const properties = (image.data as Element['data'])?.hProperties ?? {}
  image.data = {
    ...image.data,
    hProperties: {
      ...properties,
      className: [...classList(properties.className), 'media-card__cover'],
      width: properties.width ?? 240,
    },
  }
}

const buildCard = (node: Directive): Element | null => {
  const title = node.attributes?.title?.trim() ?? ''
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

  if (!title && !cover && review.length === 0) return null
  if (cover) markCover(cover)

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
  if (score !== null) {
    body.push(
      element('p', 'media-card__score', [
        text('个人评分：'),
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

  return element('article', 'media-card', [
    ...(label ? [element('span', 'media-card__label', [text(label)])] : []),
    ...(cover ? [cover] : []),
    ...(body.length ? [element('div', 'media-card__body', body)] : []),
  ])
}

const isCard = (node: RootContent | Element) =>
  node.type === 'mediaCardElement' &&
  classList((node.data as Element['data'])?.hProperties?.className).includes(
    'media-card'
  )

const wrapCards = (parent: Parent) => {
  const next: RootContent[] = []
  let group: RootContent[] = []
  const flush = () => {
    if (!group.length) return
    next.push(element('div', 'media-cards', group) as unknown as RootContent)
    group = []
  }

  for (const child of parent.children) {
    if (isCard(child)) {
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
