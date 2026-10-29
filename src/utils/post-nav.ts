/**
 * Neighbor helpers for blog post navigation.
 * Order must match `getSortedPosts` in `data.ts` (pubDate desc, id asc).
 *
 * 上一篇 = older neighbor (next index in newest-first array)
 * 下一篇 = newer neighbor (previous index)
 */

export interface PostNavItem {
  id: string
  title: string
  href: string
}

export interface PostNeighbors {
  /** Older post (上一篇); null on the oldest. */
  prev: PostNavItem | null
  /** Newer post (下一篇); null on the newest. */
  next: PostNavItem | null
  index: number
}

/**
 * Resolve prev/next for `currentId` in an already-sorted (newest-first) list.
 */
export function getPostNeighbors(
  sorted: readonly PostNavItem[],
  currentId: string
): PostNeighbors {
  const index = sorted.findIndex((post) => post.id === currentId)
  if (index < 0) {
    return { prev: null, next: null, index: -1 }
  }
  return {
    prev: sorted[index + 1] ?? null,
    next: sorted[index - 1] ?? null,
    index,
  }
}
