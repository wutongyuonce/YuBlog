import assert from 'node:assert/strict'
import test from 'node:test'

import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import remarkDirective from 'remark-directive'
import remarkImageWidth from '../plugins/remark-image-width.ts'

import remarkMediaCard from '../plugins/remark-media-card.ts'
import { toRssHtml } from '../src/utils/rss-content.js'

const source = `:::card{title="侦探杰克 第四季" score="3.5" label="Tv"}
![海报](./s4.jpg)

过到后期也是乏善可陈。
:::

:::card{title="外部条目" href="https://example.com/jack" score="4" label="书"}
![封面](./book.jpg)

可以跳出去。
:::

:::card{title="坏链接" href="javascript:alert(1)"}
没有封面也能写介绍。
:::
`

test(':::card renders a scrollable media card and keeps the cover image', async () => {
  const processor = await createMarkdownProcessor({
    remarkPlugins: [remarkDirective, remarkMediaCard],
  })
  const { code } = await processor.render(source)

  assert.match(code, /<div class="media-cards">/)
  assert.equal(code.match(/<article class="media-card">/g)?.length, 3)
  assert.match(code, /<span class="media-card__label">Tv<\/span>/)
  assert.match(
    code,
    /<img\b(?=[^>]*class="media-card__cover")(?=[^>]*src="\.\/s4\.jpg")[^>]*>/
  )
  assert.match(code, /style="--score:3\.5"/)
  assert.match(code, /<p class="media-card__score">评分：/)
  assert.doesNotMatch(code, /个人评分：/)
  assert.match(
    code,
    /<span class="media-card__rating-value">3\.5 分，满分 5 分<\/span>/
  )
  assert.match(code, /class="media-card__stars"[^>]*aria-hidden="true"/)
  assert.match(
    toRssHtml(code, 'https://example.com/post/'),
    /3\.5 分，满分 5 分/
  )
  assert.match(
    code,
    /<a\b(?=[^>]*class="media-card__title")(?=[^>]*href="https:\/\/example\.com\/jack")[^>]*>外部条目<\/a>/
  )
  assert.match(code, /<p class="media-card__title">侦探杰克 第四季<\/p>/)
  assert.match(
    code,
    /<div class="media-card__review">[\s\S]*过到后期也是乏善可陈/
  )
  assert.doesNotMatch(code, /javascript:alert/)
  assert.doesNotMatch(
    code.slice(code.lastIndexOf('<article class="media-card">')),
    /class="media-card__score"/
  )
})

test('headings split card groups and untrusted titles stay text', async () => {
  const processor = await createMarkdownProcessor({
    remarkPlugins: [remarkDirective, remarkMediaCard],
  })
  const { code } = await processor.render(
    ':::card{title="<script>alert(1)</script>" score="0"}\n评价。\n:::\n\n### 分组\n\n:::card{title="无评分"}\n下一张。\n:::'
  )
  assert.equal(code.match(/class="media-cards"/g)?.length, 2)
  assert.match(code, /<h3[^>]*>分组<\/h3>/)
  assert.match(code, /(?:&lt;|&#x3C;)script/)
  assert.doesNotMatch(code, /<script>/)
  assert.match(code, /0 分，满分 5 分/)
  assert.doesNotMatch(
    code.slice(code.lastIndexOf('<article')),
    /class="media-card__score"/
  )
})

test('malformed scores and nested cards fail instead of silently changing content', async () => {
  const processor = await createMarkdownProcessor({
    remarkPlugins: [remarkDirective, remarkMediaCard],
  })
  for (const score of ['-1', '6', '3.7', 'NaN']) {
    await assert.rejects(
      processor.render(`:::card{title="分数" score="${score}"}\n正文。\n:::`),
      /Invalid card score/
    )
  }
  await assert.rejects(
    processor.render(
      '::::card{title="外层"}\n\n:::card{title="内层"}\n正文。\n:::\n\n::::'
    ),
    /Nested :::card/
  )
})

test('unsafe URL variants do not become links', async () => {
  const processor = await createMarkdownProcessor({
    remarkPlugins: [remarkDirective, remarkMediaCard],
  })
  for (const href of [
    'javascript:alert(1)',
    '//evil.example',
    '/\\\\evil.example',
    'https://example.com/\tbad',
  ]) {
    const { code } = await processor.render(
      `:::card{title="标题" href="${href}"}\n正文。\n:::`
    )
    assert.doesNotMatch(code, /<a\b/)
  }
})

test('an explicit cover width survives card decoration', async () => {
  const processor = await createMarkdownProcessor({
    remarkPlugins: [remarkDirective, remarkImageWidth, remarkMediaCard],
  })
  const { code } = await processor.render(
    ':::card{title="封面"}\n![说明|w180](./cover.jpg)\n:::'
  )
  assert.match(
    code,
    /<img\b(?=[^>]*class="media-card__cover")(?=[^>]*width="180")(?=[^>]*alt="说明")[^>]*>/
  )
  assert.doesNotMatch(code, /\|w180/)
})
