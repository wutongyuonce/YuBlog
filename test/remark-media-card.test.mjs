import assert from 'node:assert/strict'
import test from 'node:test'

import { createMarkdownProcessor } from '@astrojs/markdown-remark'
import remarkDirective from 'remark-directive'
import remarkDirectiveSugar from 'remark-directive-sugar'
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

test('card reviews reject Markdown images instead of silently dropping them', async (t) => {
  const processor = await createMarkdownProcessor({
    remarkPlugins: [remarkDirective, remarkMediaCard],
  })
  for (const [name, review] of [
    ['second cover', '![封面](./cover.jpg)\n\n![额外图片](./extra.jpg)'],
    ['inline image', '文字 ![额外图片](./extra.jpg)'],
    ['nested image', '> - **![额外图片](./extra.jpg)**'],
    ['image reference', '> ![额外图片][extra]\n\n[extra]: ./extra.jpg'],
  ]) {
    await t.test(name, async () => {
      await assert.rejects(
        processor.render(`:::card{title="仅文字介绍"}\n${review}\n:::`),
        { name: 'Error', message: /Card review.*仅文字介绍.*media/ }
      )
    })
  }
})

test('card reviews reject actual HTML media, including nested and mixed-case tags', async (t) => {
  const processor = await createMarkdownProcessor({
    remarkPlugins: [remarkDirective, remarkMediaCard],
  })
  for (const html of [
    '<span><IMG src="./extra.jpg"></span>',
    '<picture><source srcset="./extra.jpg"></picture>',
    '<svg><circle r="1"></circle></svg>',
    '<video src="./clip.mp4"></video>',
    '<audio src="./clip.mp3"></audio>',
    '<iframe src="https://example.com"></iframe>',
    '<object data="./extra.pdf"></object>',
    '<embed src="./extra.pdf">',
    '<canvas></canvas>',
  ]) {
    await t.test(html, async () => {
      await assert.rejects(
        processor.render(`:::card{title="HTML媒体"}\n${html}\n:::`),
        { name: 'Error', message: /Card review.*HTML媒体.*media/ }
      )
    })
  }
})

test('preceding directives cannot generate media inside text-only card reviews', async () => {
  const processor = await createMarkdownProcessor({
    remarkPlugins: [remarkDirective, remarkDirectiveSugar, remarkMediaCard],
    syntaxHighlight: false,
  })
  for (const review of [
    '::video-bilibili{id=BV1MC4y1c7Kv}',
    ':link[Vite]{id=@vitejs}',
  ]) {
    await assert.rejects(
      processor.render(
        `:::card{title="指令媒体"}\n![封面](./cover.jpg)\n\n${review}\n:::`
      ),
      /Card review.*指令媒体.*media/
    )
  }
  const { code } = await processor.render(
    ':::card{title="文字指令"}\n:badge[文字] [链接](https://example.com/)\n:::'
  )
  assert.match(code, /文字/)
  assert.match(code, /href="https:\/\/example.com\/"/)
})

test('static MDX media cannot bypass the shared card transformer', () => {
  for (const type of ['mdxJsxFlowElement', 'mdxJsxTextElement']) {
    const image = { type, name: 'img', attributes: [], children: [] }
    const tree = {
      type: 'root',
      children: [
        {
          type: 'containerDirective',
          name: 'card',
          attributes: { title: 'MDX媒体' },
          children: [
            type === 'mdxJsxTextElement'
              ? { type: 'paragraph', children: [image] }
              : image,
          ],
        },
      ],
    }
    assert.throws(() => remarkMediaCard()(tree), /Card review.*MDX媒体.*media/)
  }
})

test('text formatting, links, HTML comments and literal media code remain valid', async () => {
  const processor = await createMarkdownProcessor({
    remarkPlugins: [remarkDirective, remarkMediaCard],
    syntaxHighlight: false,
  })
  const { code } = await processor.render(
    [
      ':::card{title="文字与封面"}',
      '**先写介绍** [链接](https://example.com/review)',
      '',
      '![封面](./cover.jpg)',
      '',
      '> - *保留列表*',
      '',
      '<span title="<img>">HTML 排版</span>',
      '',
      '<!-- <img src="./ignored.jpg"> -->',
      '',
      '`<img>`',
      '',
      '```html',
      '<img src="./literal.jpg">',
      '```',
      ':::',
      '',
      ':::card{title="无封面和评分"}',
      '只有文字。',
      ':::',
    ].join('\n')
  )
  assert.equal(code.match(/class="media-card__cover"/g)?.length, 1)
  assert.match(code, /<strong>先写介绍<\/strong>/)
  assert.match(code, /<a href="https:\/\/example.com\/review">链接<\/a>/)
  assert.match(code, /<em>保留列表<\/em>/)
  assert.match(code, /HTML 排版/)
  assert.match(code, /<!-- <img src="\.\/ignored.jpg"> -->/)
  assert.match(code, /<code>(?:&lt;|&#x3C;)img/)
  assert.match(code, /<pre><code class="language-html">/)
  assert.match(code, /只有文字。/)
  assert.doesNotMatch(code, /class="media-card__score"/)
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

test('portrait cards render cover, title and arbitrary metadata in one keyboard-scrollable rail', async () => {
  const processor = await createMarkdownProcessor({
    remarkPlugins: [remarkDirective, remarkImageWidth, remarkMediaCard],
  })
  const { code } = await processor.render(
    [
      ':::card{layout="portrait" title="夏日重现" meta="已看完 · 25 集" href="/interests/anime/"}',
      '![海报](./summer.jpg)',
      ':::',
      '',
      ':::card{layout="portrait" title="第二本书" meta="<script>作者</script>" href="javascript:alert(1)"}',
      '![书封面|w360](./book.jpg)',
      ':::',
      '',
      ':::card{layout="portrait" title="没有小字"}',
      '![封面](./other.jpg)',
      ':::',
    ].join('\n')
  )
  assert.equal(code.match(/class="media-cards media-cards--rail"/g)?.length, 1)
  assert.match(code, /tabindex="0" role="region" aria-label="横向卡片栏"/)
  assert.equal(
    code.match(/class="media-card media-card--portrait"/g)?.length,
    3
  )
  assert.match(
    code,
    /<p class="media-card__meta" tabindex="0">已看完 · 25 集<\/p>/
  )
  assert.match(code, /<a[^>]*href="\/interests\/anime\/"[^>]*>夏日重现<\/a>/)
  assert.match(
    code,
    /<img\b(?=[^>]*width="480")(?=[^>]*src="\.\/summer.jpg")[^>]*>/
  )
  assert.match(code, /<img\b(?=[^>]*width="360")(?=[^>]*alt="书封面")[^>]*>/)
  assert.doesNotMatch(
    code,
    /javascript:|<script>|media-card__(?:review|score|label)/
  )
})

test('layout switches and prose separate rails without changing horizontal cards', async () => {
  const processor = await createMarkdownProcessor({
    remarkPlugins: [remarkDirective, remarkMediaCard],
  })
  const portrait =
    ':::card{layout="portrait" title="竖卡"}\n![封面](./cover.jpg)\n:::'
  const { code } = await processor.render(
    `${portrait}\n\n:::card{title="旧卡" score="4"}\n旧卡介绍。\n:::\n\n${portrait}\n\n普通正文。\n\n${portrait}`
  )
  assert.equal(code.match(/class="media-cards media-cards--rail"/g)?.length, 3)
  assert.equal(code.match(/class="media-cards"/g)?.length, 1)
  assert.match(code, /<article class="media-card">/)
  assert.match(code, /4 分，满分 5 分/)
  assert.match(code, /<div class="media-card__review">[\s\S]*旧卡介绍/)
  assert.match(code, /<p>普通正文。<\/p>/)
})

test('invalid portrait content fails rather than hiding authored information', async (t) => {
  const processor = await createMarkdownProcessor({
    remarkPlugins: [remarkDirective, remarkMediaCard],
  })
  for (const [attrs, body, error] of [
    ['layout="sideways"', '![封面](./cover.jpg)', /Card layout/],
    ['layout="portrait"', '![封面](./cover.jpg)', /requires a title/],
    ['layout="portrait" title="无封面"', '', /standalone cover/],
    [
      'layout="portrait" title="有介绍"',
      '![封面](./cover.jpg)\n\n不能藏掉这段文字。',
      /no review/,
    ],
    [
      'layout="portrait" title="评分" score="4"',
      '![封面](./cover.jpg)',
      /no review, score or label/,
    ],
    [
      'layout="portrait" title="角标" label="书"',
      '![封面](./cover.jpg)',
      /no review, score or label/,
    ],
    ['title="横卡" meta="不能忽略"', '正文。', /meta requires/],
  ]) {
    await t.test(attrs, async () => {
      await assert.rejects(
        processor.render(`:::card{${attrs}}\n${body}\n:::`),
        error
      )
    })
  }
})
