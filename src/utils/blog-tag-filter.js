/**
 * Normalizes one post's tags without changing their case.
 *
 * @param {string[]} tags
 * @returns {string[]}
 */
export function normalizePostTags(tags) {
  return [...new Set(tags.map((tag) => tag.trim()).filter(Boolean))]
}

/**
 * Counts how many posts contain each tag and returns a stable display order.
 *
 * @param {string[][]} postsTags
 * @returns {{ tag: string, count: number }[]}
 */
export function buildTagSummary(postsTags) {
  const counts = new Map()

  for (const tags of postsTags) {
    for (const tag of normalizePostTags(tags)) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1)
    }
  }

  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort(
      (a, b) =>
        b.count - a.count ||
        a.tag.localeCompare(b.tag, 'zh-Hans-CN', {
          numeric: true,
          sensitivity: 'base',
        })
    )
}

/**
 * Returns whether a post contains every selected tag.
 *
 * @param {string[]} postTags
 * @param {Iterable<string>} selectedTags
 */
export function matchesAllTags(postTags, selectedTags) {
  const normalizedTags = new Set(normalizePostTags(postTags))
  return [...selectedTags].every((tag) => normalizedTags.has(tag))
}


/**
 * Filters normalized tag names that contain the query (substring).
 * Trims the query; empty query yields []. Latin letters match case-insensitively;
 * display callers keep the original tag casing.
 *
 * @param {string[]} tags
 * @param {string} query
 * @returns {string[]}
 */
export function filterTagsMatchingQuery(tags, query) {
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return []
  return tags.filter((tag) => tag.toLocaleLowerCase().includes(needle))
}

/**
 * Truncates a label by Unicode code point while keeping its full value intact.
 *
 * @param {string} tag
 * @param {number} [maxLength]
 */
export function truncateTagLabel(tag, maxLength = 12) {
  const characters = Array.from(tag)
  return characters.length > maxLength
    ? `${characters.slice(0, maxLength).join('')}…`
    : tag
}
