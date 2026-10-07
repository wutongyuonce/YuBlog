import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import {
  copyFile,
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

import { SITE } from '../src/config.ts'
import { toRssHtml } from '../src/utils/rss-content.js'
import { createRssXml } from '../src/utils/rss-feed.js'

const repository = fileURLToPath(new URL('../', import.meta.url))
const articleUrl = new URL('blogs/demo/', new URL(SITE.base, SITE.website)).href
const page = (body, shell = '') =>
  `<!doctype html><html><head><link rel="canonical" href="${articleUrl}"></head><body>${shell}<article class="post-content markdown-content">${body}</article></body></html>`

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'yublog-artifacts-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'scripts'), { recursive: true })
  await mkdir(join(root, 'dist/blogs/demo'), { recursive: true })
  for (const name of ['node_modules', 'plugins', 'src'])
    await symlink(join(repository, name), join(root, name), 'dir')
  for (const name of [
    'verify-markdown-pipeline.mjs',
    'check-content-rendered.mjs',
  ])
    await copyFile(
      join(repository, 'scripts', name),
      join(root, 'scripts', name)
    )
  return root
}

const childEnv = { ...process.env }
delete childEnv.NODE_TEST_CONTEXT
const check = (root, pattern) => {
  const result = spawnSync(
    process.execPath,
    [
      '--test',
      `--test-name-pattern=${pattern}`,
      'scripts/verify-markdown-pipeline.mjs',
    ],
    { cwd: root, encoding: 'utf8', env: childEnv }
  )
  // Node 22 打印 `# tests 1`，Node 24 打印 `ℹ tests 1`；两种都接受，否则
  // 模式写错时子进程一个用例都没跑，这里会误判为通过。
  assert.match(result.stdout, /(?:#|ℹ) tests 1\b/, result.stderr)
  return result
}
const expect = (result, status, name) =>
  assert.equal(
    result.status,
    status,
    `${name}\n${result.stdout}\n${result.stderr}`
  )

test('authored HTML guard follows declaration and fragment semantics without checking template tables', async (t) => {
  const root = await fixture(t)
  const cases = [
    [
      'zoom survives another broken declaration',
      '<p style="zoom:50%; broken">正文</p>',
      '',
      1,
    ],
    ['escaped zoom', '<p style="z\\6f om:50%">正文</p>', '', 1],
    [
      'a nested value is not a zoom declaration',
      '<p style="color:red; x: { zoom:50% }">正文</p>',
      '',
      0,
    ],
    [
      'comments cannot join an identifier',
      '<p style="z/**/oom:50%">正文</p>',
      '',
      0,
    ],
    ['top is an implicit document target', '<a href="#TOP">顶部</a>', '', 0],
    [
      'text directive is not part of the element id',
      '<p id="intro">正文</p><a href="#intro:~:text=正文">定位</a>',
      '',
      0,
    ],
    [
      'a missing id is still rejected',
      '<a href="#missing:~:text=正文">定位</a>',
      '',
      1,
    ],
    [
      'template tables are outside authored content',
      '<p>正文</p>',
      '<table><tr><td>模板</td></tr></table>',
      0,
    ],
    [
      'authored tables still need wrappers',
      '<table><tr><td>正文</td></tr></table>',
      '',
      1,
    ],
  ]
  for (const [name, body, shell, status] of cases) {
    await writeFile(join(root, 'dist/blogs/demo/index.html'), page(body, shell))
    expect(check(root, 'authored HTML'), status, name)
  }
})

test('media guard catches unresolved pipeline images and resolves document URLs as served', async (t) => {
  const root = await fixture(t)
  await mkdir(join(root, 'dist/about'), { recursive: true })
  await writeFile(join(root, 'dist/about/index.html'), '<p>关于</p>')
  await writeFile(join(root, 'dist/avatar.webp'), 'fixture')
  const cases = [
    [
      'unresolved Astro image',
      '<img __ASTRO_IMAGE_="./x.webp|w480" alt="图">',
      1,
    ],
    ...[
      'https:avatar.webp',
      'http:missing.mp4',
      'https:///cdn.example.com/demo.mp4',
    ].map((src) => [
      'an invalid authority cannot bypass classification through another origin',
      `<video src="${src}"></video>`,
      1,
    ]),
    [
      'valid external media',
      '<video src="https://cdn.example.com/demo.mp4"></video>',
      0,
    ],
    [
      'a local iframe may load an Astro route',
      `<iframe src="${SITE.base}about/"></iframe>`,
      0,
    ],
    [
      'a missing local route is rejected',
      `<object data="${SITE.base}missing/"></object>`,
      1,
    ],
  ]
  for (const [name, body, status] of cases) {
    await writeFile(join(root, 'dist/blogs/demo/index.html'), page(body))
    expect(check(root, 'every media'), status, name)
  }
})

test('RSS contract detects missing images and follows the sanitizer boundary for embedded subtrees', async (t) => {
  const root = await fixture(t)
  await writeFile(join(root, 'dist/avatar.webp'), 'fixture')
  const source = `<p>开头</p><img src="${SITE.base}avatar.webp" alt="图"><object><div><table><tr><td>嵌入备用内容</td></tr></table></div></object><p>结尾</p>`
  await writeFile(join(root, 'dist/blogs/demo/index.html'), page(source))
  const content = toRssHtml(source, articleUrl)
  const feed = (value) =>
    createRssXml({
      site: SITE,
      homeUrl: new URL(SITE.base, SITE.website).href,
      feedUrl: new URL('rss.xml', new URL(SITE.base, SITE.website)).href,
      items: [
        {
          title: '测试',
          pubDate: new Date('2026-09-21'),
          link: articleUrl,
          guid: articleUrl,
          content: value,
        },
      ],
    })
  await writeFile(join(root, 'dist/rss.xml'), await feed(content))
  expect(
    check(root, 'full RSS'),
    0,
    'unsupported object subtree is intentionally stripped'
  )
  await writeFile(
    join(root, 'dist/rss.xml'),
    await feed(content.replace(/<img\b[^>]*>/g, ''))
  )
  expect(
    check(root, 'full RSS'),
    1,
    'losing images must fail even when all prose remains'
  )
})

test('render guard checks each body and rejects control-only output while accepting media-only content', async (t) => {
  const root = await fixture(t)
  for (const [name, body, status] of [
    ['empty', '<!--comment-->', 1],
    [
      'only site TOC',
      '<table-of-contents><nav>目录</nav></table-of-contents>',
      1,
    ],
    ['only video', '<video src="/demo.mp4" controls></video>', 0],
    [
      'one of two independent bodies is empty',
      '<p>正文</p></article><section class="markdown&#45;content"><!--comment--></section><article>',
      1,
    ],
  ]) {
    await writeFile(join(root, 'dist/blogs/demo/index.html'), page(body))
    const result = spawnSync(
      process.execPath,
      ['scripts/check-content-rendered.mjs'],
      { cwd: root, encoding: 'utf8' }
    )
    expect(result, status, name)
  }
})
