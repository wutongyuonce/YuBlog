import { glob, file } from 'astro/loaders'
import { defineCollection } from 'astro:content'

import {
  aboutSchema,
  interestSchema,
  friendSchema,
  postSchema,
  projectSchema,
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
  loader: glob({ base: './src/content/interests', pattern: '*.{md,mdx}' }),
  schema: interestSchema,
})

export const collections = {
  interests,
  blogs,
  projects,
  friends,
  about,
}
