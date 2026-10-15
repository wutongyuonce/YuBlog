import { readdirSync, readFileSync } from 'node:fs'
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

const entryIdForStem = (stem: string) =>
  stem
    .split('/')
    .map((segment) => githubSlug(segment))
    .join('/')
    .replace(/\/index$/, '')

/** Resolve collection IDs or relative filename stems, including nested posts. */
export function resolveBlogEntry(slug: string): BlogEntryMeta | null {
  const needle = slug.trim()
  if (
    !needle ||
    path.isAbsolute(needle) ||
    needle.includes('\\') ||
    needle.split('/').some((segment) => segment === '.' || segment === '..')
  )
    return null

  // Enumerate real files rather than resolving the supplied slug as a path.
  for (const entry of readdirSync(BLOGS_ROOT, {
    recursive: true,
    withFileTypes: true,
  })) {
    if (!entry.isFile() || !/\.(md|mdx)$/i.test(entry.name)) continue
    const filePath = path.join(entry.parentPath, entry.name)
    const stem = path
      .relative(BLOGS_ROOT, filePath)
      .replace(/\.(md|mdx)$/i, '')
      .split(path.sep)
      .join('/')
    const { frontmatter } = parseFrontmatter(readFileSync(filePath, 'utf8'))
    const id = frontmatter.slug
      ? String(frontmatter.slug)
      : entryIdForStem(stem)
    if (stem !== needle && id !== needle && id !== entryIdForStem(needle))
      continue

    const title =
      typeof frontmatter.title === 'string' ? frontmatter.title.trim() : ''
    const description =
      typeof frontmatter.description === 'string'
        ? frontmatter.description.trim()
        : ''
    if (!title) return null

    const base = SITE.base.replace(/\/+$/, '')
    const href = `${base}/blogs/${id}/`.replace(/\/+/g, '/')
    return {
      id,
      filePath,
      title,
      description,
      draft: frontmatter.draft === true,
      href,
    }
  }
  return null
}
