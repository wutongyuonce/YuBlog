import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { SITE } from '../src/config.ts'

const require = createRequire(import.meta.url)
const { slug: githubSlug } = require(
  require.resolve('github-slugger', { paths: [require.resolve('astro')] })
) as { slug: (value: string) => string }
const { parseFrontmatter } = require(
  require.resolve('@astrojs/internal-helpers/frontmatter', {
    paths: [require.resolve('astro')],
  })
) as {
  parseFrontmatter: (input: string) => {
    frontmatter: Record<string, unknown>
  }
}

const BLOGS_ROOT = fileURLToPath(
  new URL('../src/content/blogs/', import.meta.url)
)

export interface BlogEntryMeta {
  id: string
  filePath: string
  title: string
  description: string
  draft: boolean
  href: string
}

const entryIdForStem = (stem: string) => githubSlug(stem)

/** 按内容集合 id（URL slug）或文件名主干解析博文；与 Astro glob generateId 一致。 */
export function resolveBlogEntry(slug: string): BlogEntryMeta | null {
  const needle = slug.trim()
  if (
    !needle ||
    needle.includes('/') ||
    needle.includes('\\') ||
    needle.includes('..')
  )
    return null

  const files = readdirSync(BLOGS_ROOT).filter((name) =>
    /\.(md|mdx)$/i.test(name)
  )

  let match: string | null = null
  for (const name of files) {
    const stem = name.replace(/\.(md|mdx)$/i, '')
    const id = entryIdForStem(stem)
    if (stem === needle || id === needle || id === entryIdForStem(needle)) {
      match = name
      break
    }
  }
  if (!match) return null

  const filePath = path.join(BLOGS_ROOT, match)
  if (!existsSync(filePath)) return null

  const stem = match.replace(/\.(md|mdx)$/i, '')
  const id = entryIdForStem(stem)
  const { frontmatter } = parseFrontmatter(readFileSync(filePath, 'utf8'))
  const title =
    typeof frontmatter.title === 'string' ? frontmatter.title.trim() : ''
  const description =
    typeof frontmatter.description === 'string'
      ? frontmatter.description.trim()
      : ''
  const draft = frontmatter.draft === true
  if (!title) return null

  const base = SITE.base.replace(/\/+$/, '')
  const href = `${base}/blogs/${id}/`.replace(/\/+/g, '/')

  return { id, filePath, title, description, draft, href }
}
