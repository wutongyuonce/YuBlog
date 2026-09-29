import assert from 'node:assert/strict'
import test from 'node:test'
import { z } from 'astro/zod'
import {
  friendSchema,
  postSchema,
  projectSchema,
} from '../src/content/schema.ts'

const post = postSchema({ image: () => z.any() })
const requiredPost = {
  title: '  示例文章  ',
  pubDate: '2026-09-21',
  category: ' 技术向 ',
}

test('post fields keep their defaults, trimming and date coercion', () => {
  const parsed = post.parse(requiredPost)
  assert.equal(parsed.title, '示例文章')
  assert.equal(parsed.category, '技术向')
  assert.ok(parsed.pubDate instanceof Date)
  assert.equal(parsed.minutesRead, true)
  assert.equal(parsed.draft, false)
  assert.equal(parsed.redirect, '')
  assert.deepEqual(parsed.tags, [])
})

test('content boundaries reject empty categories and malformed URLs', () => {
  assert.equal(
    post.safeParse({ ...requiredPost, category: '  ' }).success,
    false
  )
  assert.equal(
    post.safeParse({ ...requiredPost, redirect: 'not-a-url' }).success,
    false
  )
  assert.equal(
    projectSchema.safeParse({
      id: 'p',
      link: 'not-a-url',
      desc: 'p',
      category: 'Personal',
    }).success,
    false
  )
  assert.equal(
    friendSchema.safeParse({
      id: 'f',
      name: 'f',
      link: 'not-a-url',
      desc: 'f',
      category: 'Friends',
    }).success,
    false
  )
})

test('a title image without meaningful alt text is rejected', () => {
  assert.equal(
    post.safeParse({
      ...requiredPost,
      titleImage: {
        src: '/cover.webp',
        width: 1200,
        height: 630,
        format: 'webp',
      },
      titleImageAlt: '  ',
    }).success,
    false
  )
})
