import { fromHtml } from 'hast-util-from-html'
import { sanitize } from 'hast-util-sanitize'
import { toHtml } from 'hast-util-to-html'
import { visit, SKIP } from 'unist-util-visit'

const strippedTags = [
  'script',
  'style',
  'link',
  'button',
  'svg',
  'iframe',
  'object',
  'embed',
  'video',
  'audio',
  'source',
  'template',
]
const schema = {
  tagNames: [
    'a',
    'p',
    'div',
    'span',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'strong',
    'em',
    'b',
    'i',
    's',
    'del',
    'br',
    'hr',
    'blockquote',
    'ul',
    'ol',
    'li',
    'dl',
    'dt',
    'dd',
    'pre',
    'code',
    'kbd',
    'samp',
    'sub',
    'sup',
    'table',
    'caption',
    'thead',
    'tbody',
    'tfoot',
    'tr',
    'th',
    'td',
    'img',
    'figure',
    'figcaption',
  ],
  attributes: {
    a: ['href', 'title'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    ol: ['start', 'reversed'],
    li: ['value'],
    th: ['colSpan', 'rowSpan', 'scope'],
    td: ['colSpan', 'rowSpan'],
  },
  protocols: {
    href: ['http', 'https', 'mailto', 'tel'],
    src: ['http', 'https'],
  },
  strip: strippedTags,
}

const hasClass = (node, name) => node.properties?.className?.includes(name)
const textOf = (node) =>
  node.type === 'text' ? node.value : (node.children || []).map(textOf).join('')
const element = (tagName, children, properties = {}) => ({
  type: 'element',
  tagName,
  properties,
  children,
})
const text = (value) => ({ type: 'text', value })

function absoluteUrl(value, articleUrl, protocols) {
  if (typeof value !== 'string' || !value.trim()) return undefined
  try {
    const url = new URL(value, articleUrl)
    return protocols.includes(url.protocol.slice(0, -1)) ? url.href : undefined
  } catch {
    return undefined
  }
}

/** Convert rendered Astro content to standalone, inert reader HTML. */
export function toRssHtml(html, articleUrl) {
  const tree = fromHtml(html, { fragment: true })
  visit(tree, 'element', (node, index, parent) => {
    if (
      strippedTags.includes(node.tagName) ||
      hasClass(node, 'header-anchor')
    ) {
      parent.children.splice(index, 1)
      return index
    }

    if (hasClass(node, 'katex-display') || hasClass(node, 'katex')) {
      let source
      visit(node, 'element', (child) => {
        if (
          child.tagName === 'annotation' &&
          child.properties.encoding === 'application/x-tex'
        ) {
          source = textOf(child)
        }
      })
      if (source === undefined)
        throw new Error('KaTeX formula is missing its TeX annotation')
      const code = element('code', [text(source)])
      parent.children[index] = hasClass(node, 'katex-display')
        ? element('pre', [code])
        : code
      return SKIP
    }

    if (node.tagName === 'pre') {
      const lines = []
      visit(node, 'element', (line) => {
        // Collapsible summaries contain ec-line markup but are controls, not source.
        if (line.tagName === 'summary') return SKIP
        if (!hasClass(line, 'ec-line')) return
        const code = line.children.find((child) => hasClass(child, 'code'))
        if (!code)
          throw new Error('Expressive Code line is missing its code content')
        const value = textOf(code)
        lines.push(value === '\n' ? '' : value)
        return SKIP
      })
      // Expressive Code expresses line breaks through divs, not text nodes.
      if (lines.length)
        node.children = [element('code', [text(lines.join('\n'))])]
    }

    if (node.tagName === 'details') node.tagName = 'div'
    if (node.tagName === 'summary') node.tagName = 'p'
    if (node.tagName === 'input' && node.properties.type === 'checkbox') {
      parent.children[index] = text(node.properties.checked ? '[x] ' : '[ ] ')
      return SKIP
    }
    if (node.tagName === 'a') {
      node.properties.href = absoluteUrl(
        node.properties.href,
        articleUrl,
        schema.protocols.href
      )
    }
    if (node.tagName === 'img') {
      const src = absoluteUrl(
        node.properties.src,
        articleUrl,
        schema.protocols.src
      )
      if (!src)
        throw new Error(
          `Image has no usable HTTP(S) source: ${node.properties.src || '(missing)'}`
        )
      node.properties.src = src
    }
  })
  tree.children.push(
    element('p', [element('a', [text('阅读原文')], { href: articleUrl })])
  )
  return toHtml(sanitize(tree, schema))
}
