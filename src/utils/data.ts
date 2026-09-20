import { getCollection, render } from 'astro:content'

import { getYear } from '~/utils/datetime'
import { getInclusiveDayCount, sumWordCounts } from '~/utils/blog-stats'

import type { CollectionEntry } from 'astro:content'

/**
 * Ensures that a value is a positive integer.
 */
function ensurePositiveInteger(value: number, name: string) {
  if (Number.isInteger(value) && value > 0) return value
  throw new Error(
    `'${name}' must be a positive integer. Please check 'src/config.ts' for the correct configuration.`
  )
}

/**
 * Parses a tuple of boolean and number.
 */
export function parseTuple(
  tuple: boolean | [boolean, number] | undefined,
  name: string
) {
  if (!tuple || !Array.isArray(tuple) || !tuple[0]) return undefined
  return ensurePositiveInteger(tuple[1], name)
}

/**
 * Retrieves the minutes read for a post.
 */
export function getMinutesRead(
  minutesRead: number | boolean,
  computedMinutesRead: number
) {
  return minutesRead === false || minutesRead === 0
    ? 0
    : typeof minutesRead === 'number' && minutesRead > 0
      ? minutesRead
      : computedMinutesRead
}

/**
 * Retrieves filtered posts from the specified content collection.
 * In production, it filters out draft posts.
 */
export async function getFilteredPosts(collection: 'blogs') {
  return await getCollection(collection, ({ data }) => {
    return import.meta.env.PROD ? !data.draft : true
  })
}

/**
 * Sorts an array of posts by their publication date in descending order.
 */
export function getSortedPosts(posts: CollectionEntry<'blogs'>[]) {
  return [...posts].sort(
    (a, b) =>
      b.data.pubDate.valueOf() - a.data.pubDate.valueOf() ||
      a.id.localeCompare(b.id)
  )
}

async function getPublishedBlogPosts() {
  return await getCollection('blogs', ({ data }) => !data.draft)
}

/**
 * Retrieves the five newest published posts for the home page.
 */
export async function getRecentBlogPosts() {
  const posts = await getPublishedBlogPosts()
  return getSortedPosts(posts).slice(0, 5)
}

export interface BlogStats {
  postCount: number
  wordCount: number
  daySpan: number
  startedAt: string
}

/**
 * Summarizes published blog content for the home page.
 */
export async function getBlogStats(): Promise<BlogStats> {
  const posts = await getPublishedBlogPosts()
  const renderedPosts = await Promise.all(posts.map((post) => render(post)))
  const startedAt =
    posts.length === 0
      ? new Date().toISOString()
      : new Date(
          Math.min(...posts.map(({ data }) => data.pubDate.valueOf()))
        ).toISOString()

  return {
    postCount: posts.length,
    wordCount: sumWordCounts(
      renderedPosts.map((post) => post.remarkPluginFrontmatter.wordCount)
    ),
    daySpan: getInclusiveDayCount(startedAt),
    startedAt,
  }
}

export interface GroupedBlogItem {
  idx: number
  year: string
  id: CollectionEntry<'blogs'>['id']
  data: CollectionEntry<'blogs'>['data']
  minutesRead: number
}

export interface GroupedBlogYear {
  year: string
  items: GroupedBlogItem[]
}

export type FriendData = CollectionEntry<'friends'>['data']

export interface GroupedFriendItem {
  id: CollectionEntry<'friends'>['id']
  data: FriendData
}

export interface GroupedFriendCategory {
  category: string
  items: GroupedFriendItem[]
}

/**
 * Retrieves date-sorted blog items with reading metadata for list views.
 */
export async function getBlogListItems(
  collection: 'blogs' = 'blogs'
): Promise<GroupedBlogItem[]> {
  const items = await getFilteredPosts(collection)
  const sortedPosts = getSortedPosts(items)

  const enrichedPosts = await Promise.all(
    sortedPosts.map(async (item, idx) => {
      const { data, id } = item
      const { remarkPluginFrontmatter } = await render(item)

      return {
        idx,
        year: getYear(data.pubDate).toString(),
        id,
        data,
        minutesRead: getMinutesRead(
          data.minutesRead,
          remarkPluginFrontmatter.minutesRead
        ),
      }
    })
  )

  return enrichedPosts
}

/** Keeps the existing year-based list on the same article data source. */
export async function getGroupedPostsByYear(
  collection: 'blogs'
): Promise<GroupedBlogYear[]> {
  const enrichedPosts = await getBlogListItems(collection)
  return enrichedPosts.reduce<GroupedBlogYear[]>((groups, item) => {
    const existingGroup = groups.find((group) => group.year === item.year)

    if (existingGroup) {
      existingGroup.items.push(item)
      return groups
    }

    groups.push({
      year: item.year,
      items: [item],
    })

    return groups
  }, [])
}

/**
 * Retrieves sorted friends from the specified content collection.
 */
export async function getSortedFriends(
  collection: 'friends'
): Promise<GroupedFriendItem[]> {
  const items = await getCollection(collection)

  return items
    .map((item) => ({
      id: item.id,
      data: item.data,
    }))
    .sort((a, b) => {
      if (a.data.order !== b.data.order) {
        return a.data.order - b.data.order
      }

      return a.data.name.localeCompare(b.data.name, 'zh-Hans-CN')
    })
}

/**
 * Retrieves all friends and groups them by category.
 */
export async function getGroupedFriendsByCategory(
  collection: 'friends'
): Promise<GroupedFriendCategory[]> {
  const items = await getSortedFriends(collection)

  return items.reduce<GroupedFriendCategory[]>((groups, item) => {
    const existingGroup = groups.find(
      (group) => group.category === item.data.category
    )

    if (existingGroup) {
      existingGroup.items.push(item)
      return groups
    }

    groups.push({
      category: item.data.category,
      items: [item],
    })

    return groups
  }, [])
}
