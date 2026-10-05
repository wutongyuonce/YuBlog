import type { MarkdownHeading } from 'astro'
import type { HeadingLevel } from '~/types'

export interface TocHeading extends MarkdownHeading {
  children: TocHeading[]
}

function injectChild(items: TocHeading[], item: TocHeading): void {
  const lastItem = items.at(-1)

  if (!lastItem || lastItem.depth >= item.depth) {
    items.push(item)
  } else {
    const depthDiff = item.depth - lastItem.depth

    if (depthDiff > 1 && lastItem.children.length === 0) {
      let currentDepth = lastItem.depth + 1
      let currentItems = lastItem.children

      while (currentDepth < item.depth) {
        const fillerItem: TocHeading = {
          depth: currentDepth,
          children: [],
          slug: '',
          text: '',
        }
        currentItems.push(fillerItem)
        currentItems = fillerItem.children
        currentDepth++
      }

      currentItems.push(item)
    } else {
      injectChild(lastItem.children, item)
    }
  }
}

export function generateToc(
  headings: readonly MarkdownHeading[],
  minHeadingLevel: HeadingLevel,
  maxHeadingLevel: HeadingLevel
) {
  if (minHeadingLevel > maxHeadingLevel) {
    throw new Error(
      '`minHeadingLevel` must be less than or equal to `maxHeadingLevel`'
    )
  }

  const bodyHeadings = headings.filter(
    ({ depth }) => depth >= minHeadingLevel && depth <= maxHeadingLevel
  )

  const toc: TocHeading[] = []
  for (const heading of bodyHeadings)
    injectChild(toc, { ...heading, children: [] })

  return toc
}
