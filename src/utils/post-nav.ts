/**
 * Neighbor + random helpers for blog post navigation.
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

/**
 * Pick a random entry from `candidates`, optionally excluding `excludeId`
 * (matched against `id`). Injectable `random` for tests (0 ≤ n < 1).
 */
export function pickRandomOther<T extends { id: string }>(
  candidates: readonly T[],
  excludeId: string | null | undefined,
  random: () => number = Math.random
): T | null {
  const pool =
    excludeId == null || excludeId === ''
      ? [...candidates]
      : candidates.filter((item) => item.id !== excludeId)
  if (pool.length === 0) return null
  const n = random()
  const clamped = Number.isFinite(n) ? Math.min(Math.max(n, 0), 0.999999999) : 0
  return pool[Math.floor(clamped * pool.length)] ?? null
}

/** Deterministic no-JS fallback: first candidate after exclude. */
export function fallbackRandomOther<T extends { id: string }>(
  candidates: readonly T[],
  excludeId: string | null | undefined
): T | null {
  return pickRandomOther(candidates, excludeId, () => 0)
}
