import { glob, file } from 'astro/loaders'
import { defineCollection } from 'astro:content'

import {
  aboutSchema,
  friendSchema,
  postSchema,
  projectSchema,
} from '~/content/schema'

const home = defineCollection({
  loader: glob({ base: './src/content/home', pattern: 'index.{md,mdx}' }),
})

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

export const collections = {
  home,
  blogs,
  projects,
  friends,
  about,
}
