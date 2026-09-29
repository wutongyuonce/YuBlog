import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import test from 'node:test'

const built = (path) => new URL(`../dist/${path}`, import.meta.url)
const html = (path) => readFile(built(path), 'utf8')

test('static routes, feed, sitemap and search index exist', async () => {
  await Promise.all(
    [
      'index.html',
      'tags/index.html',
      'archives/index.html',
      'projects/index.html',
      'about/index.html',
      'rss.xml',
      'sitemap-index.xml',
      'pagefind/pagefind-entry.json',
    ].map((path) => access(built(path)))
  )
})

test('Markdown width, reading metadata and heading links reach the built site', async () => {
  const [home, post] = await Promise.all([
    html('index.html'),
    html('blogs/east-asian-meritocracy/index.html'),
  ])

  // This article has no explicit minutesRead: losing remarkReadingTime would
  // remove the automatic reading time (and zero out the sidebar word count).
  assert.match(post, /\b[1-9]\d* min read\b/)
  const wordCount = home.match(
    /<dt>字数<\/dt>\s*<dd>\s*<span class="blog-profile__value">([\d.]+)<\/span>/
  )
  assert.ok(wordCount, 'the sidebar should show the total word count')
  assert.ok(
    Number(wordCount[1]) > 0,
    'word count must not silently become zero'
  )

  const image = post.match(
    /<img\b[^>]*alt="两位女孩在列车车厢中的画面"[^>]*>/
  )?.[0]
  assert.ok(image, 'the |w480 image must not leak its marker into alt text')
  assert.match(image, /\bwidth="480"/)
  assert.match(image, /\bdata-astro-image="constrained"/)
  assert.match(image, /\bsrcset="[^"]+\.webp/)
  assert.match(
    post,
    /class="header-anchor"[^>]*href="#一优绩主义怎样从学校走进家庭"/
  )
})

test('rehype tables, code, math and callouts remain active', async () => {
  const [tablePost, mathPost, calloutPost] = await Promise.all([
    html('blogs/fastapi/index.html'),
    html('blogs/算法笔记/算法-2哈希表字符串双指针总结栈与队列/index.html'),
    html('blogs/juc并发编程/juc-并发编程-1多线程基础/index.html'),
  ])
  assert.match(tablePost, /<div>\s*<table>/)
  assert.match(tablePost, /<div class="expressive-code">/)
  assert.match(mathPost, /<span class="katex">/)
  assert.match(
    calloutPost,
    /<div class="callout" data-callout="caution"[^>]*>[\s\S]*?<div class="callout-content"><p><strong>临界区/
  )
  assert.doesNotMatch(calloutPost, /\[!CAUTION\]/)
})
