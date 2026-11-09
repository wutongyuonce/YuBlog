import { glob, file } from 'astro/loaders'
import { defineCollection } from 'astro:content'

import {
  aboutSchema,
  interestSchema,
  interestTabSchema,
  friendSchema,
  postSchema,
  projectSchema,
  tripSchema,
} from '~/content/schema'

const blogs = defineCollection({
  loader: glob({ base: './src/content/blogs', pattern: '**/*.{md,mdx}' }),
  schema: postSchema,
})

const projects = defineCollection({
  loader: file('./src/content/projects/data.json'),
  schema: projectSchema,
})

const friends = defineCollection({
  loader: file('./src/content/friends/data.json'),
  schema: friendSchema,
})

const about = defineCollection({
  loader: glob({ base: './src/content/about', pattern: '**/*.{md,mdx}' }),
  schema: aboutSchema,
})

const interests = defineCollection({
  loader: glob({
    base: './src/content/interests',
    pattern: '*.{md,mdx}',
  }),
  schema: interestSchema,
})

// 同名子目录里的 Markdown 是该分类的页签，id 形如 `gear/device`。
const interestTabs = defineCollection({
  loader: glob({
    base: './src/content/interests',
    pattern: '*/*.{md,mdx}',
  }),
  schema: interestTabSchema,
})

// 一段旅程一个目录，目录名即 id（`/trips/#<id>`）。
const trips = defineCollection({
  loader: glob({
    base: './src/data/trips',
    pattern: '*/trip.json',
    generateId: ({ entry }) => entry.split('/')[0],
  }),
  schema: tripSchema,
})

export const collections = {
  interests,
  interestTabs,
  blogs,
  projects,
  friends,
  about,
  trips,
}
