import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'

const validator = fileURLToPath(
  new URL(
    '../blog-content-publisher-skill/scripts/validate_content.py',
    import.meta.url
  )
)
const dependencies = fileURLToPath(new URL('../node_modules', import.meta.url))
const config = fileURLToPath(new URL('../src/config.ts', import.meta.url))
const fixture = async (t, source) => {
  const root = await mkdtemp(join(tmpdir(), 'yublog-publisher-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src/content/blogs'), { recursive: true })
  await writeFile(join(root, 'package.json'), '{}')
  await symlink(dependencies, join(root, 'node_modules'), 'dir')
  await symlink(config, join(root, 'src/config.ts'), 'file')
  const path = join(root, 'src/content/blogs/post.md')
  await writeFile(path, source)
  return { root, path }
}
const validate = (root) =>
  spawnSync(
    'python3',
    [validator, '--root', root, '--blog', 'src/content/blogs/post.md'],
    { encoding: 'utf8' }
  )

test('publisher uses YAML semantics for comments, quoted hashes and structured values', async (t) => {
  const { root, path } = await fixture(
    t,
    `---
title: "C# 入门: YAML" # 标题注释
pubDate: 2026-09-21 # 发布时间
category: '技术 # 专栏' # 分类注释
description: |
  第一行 # 这是正文
  第二行
tags: [Astro, YAML]
---
正文。
`
  )
  const parsed = spawnSync(
    'python3',
    [
      '-c',
      `
import json, runpy, sys
from pathlib import Path
module = runpy.run_path(sys.argv[1])
data, _links = module["article"](Path(sys.argv[2]), Path(sys.argv[3]))
print(json.dumps(data))
`,
      validator,
      path,
      root,
    ],
    { encoding: 'utf8' }
  )
  assert.equal(parsed.status, 0, parsed.stderr)
  const data = JSON.parse(parsed.stdout)
  assert.equal(data.title, 'C# 入门: YAML')
  assert.equal(data.category, '技术 # 专栏')
  assert.equal(data.description, '第一行 # 这是正文\n第二行\n')
  assert.deepEqual(data.tags, ['Astro', 'YAML'])
  const result = validate(root)
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /OK: blog metadata/)
})

test('publisher fails on malformed YAML and invalid dates rather than ignoring them', async (t) => {
  const { root, path } = await fixture(t, '')
  for (const [metadata, error] of [
    ['pubDate: 2026-09-21\ntags: [Astro', /YAML/],
    ['pubDate: "2026-09-21 # not a comment"', /pubDate/],
  ]) {
    await writeFile(
      path,
      `---\ntitle: 测试\ncategory: 技术\n${metadata}\n---\n正文。`
    )
    const result = validate(root)
    assert.equal(result.status, 1, result.stderr)
    assert.match(result.stderr, error)
  }
})

test('publisher rejects body links that point at Markdown sources', async (t) => {
  const { root, path } = await fixture(t, '')
  const front = '---\ntitle: 测试\ncategory: 技术\npubDate: 2026-09-21\n---\n'
  const fence = '```'

  // 指向 .md 的相对链接在站点上会被解析成 <页面目录>/算法1.md，点下去是 404，
  // 而 pnpm build 不会报错 —— 预检必须拦住这种写法。
  await writeFile(path, front + '[上篇](./算法1.md#27)\n')
  const bad = validate(root)
  assert.equal(bad.status, 1, bad.stderr)
  assert.match(bad.stderr, /链接指向 Markdown 源文件/)
  assert.match(bad.stderr, /站内 URL/)

  // 外链里的 .md 是正常写法；代码块和行内代码里的示例也不是真链接。
  await writeFile(
    path,
    [
      front,
      '[文档](https://github.com/x/y/blob/main/README.md)',
      '',
      fence + 'md',
      '[上篇](./算法1.md#27)',
      fence,
      '',
      '行内示例 `](./x.md)` 也不算。',
      '',
    ].join('\n')
  )
  const ok = validate(root)
  assert.equal(ok.status, 0, ok.stderr)
})

test('publisher finds real links through the Markdown parser, not by regex', async (t) => {
  const { root, path } = await fixture(t, '')
  const front = '---\ntitle: 测试\ncategory: 技术\npubDate: 2026-09-21\n---\n'
  const fence = '```'

  // 代码里的示例不是链接，外链也不受影响
  const ignored = [
    '    [示例](./indented.md)',
    '示例 ``](./inline.md)`` 说明',
    `${fence}md\n[示例](./fenced.md)\n${fence}`,
    `> ${fence}\n> [示例](./quoted.md)\n> ${fence}`,
    '[文档](HTTPS://github.com/x/y/blob/main/README.md)',
    '[文档](//cdn.example.com/README.md)',
    // 分号属于浏览器 pathname，attachment 之后不再是 .md 后缀。
    '[下载](./download.md;attachment)',
    // HTTP(S) URL 将反斜杠视为分隔符：两个反斜杠开头会访问外站。
    String.raw`<a href="\\cdn.example.com\README.md">文档</a>`,
    String.raw`<a href="\downloads\README.md">下载</a>`,
    '<a href="https:/downloads/README.md">下载</a>',
    '[文档](https://www.wutongyu.site/README.md)',
    '[文档](http:missing.md)',
    '<a href="mailto:missing.md">邮箱</a>',
    // pathname 只解码一次，%252E 不等价于扩展名里的点。
    '[下载](./missing%252Emd)',
    '[下载](./100%.txt)',
    '<a href="&#x1f; //cdn.example.com/README.md&#x1f;">文档</a>',
    '<a href="https:\t//cdn.example.com/README.md">文档</a>',
  ]
  for (const body of ignored) {
    await writeFile(path, `${front}\n${body}\n`)
    const result = validate(root)
    assert.equal(result.status, 0, `${body}\n${result.stderr}`)
  }

  // 真链接都要抓到：引用式、带查询串、引用块围栏之后的正文，
  // 以及三种用正则取 href 会漏掉或误报的写法
  const flagged = [
    '[旧文][1]\n\n[1]: ./ref.md',
    '[旧文](./old.md?raw=1)',
    `> ${fence}\n> [示例](./quoted.md)\n> ${fence}\n\n[别的](./real.md)`,
    // 正则会把 data-href 的值当 href，于是漏掉真正的 href
    '<a data-href="/blogs/ok/" href="./missing.md">旧文</a>',
    // 实体不解码时 `#` 会被当成 fragment，`.md` 后缀就看不见了
    '[旧文](./a&b.md)',
    // URL 语义下与 .md 等价，路径不解码就漏
    '[旧文](./missing%2Emd)',
    '<a href="./missing.%6Dd">旧文</a>',
    '<a href="./missing%ZZ.md">旧文</a>',
    // 同本站协议、没有 slash 的 scheme 写法会相对于页面目录解析。
    '[旧文](https:missing.md)',
    '<a href="HTTPS:../missing.mdx?raw=1#intro">旧文</a>',
    String.raw`<a href=".\missing.md">旧文</a>`,
    '[旧文](./download;attachment.md)',
    '<a href="&#x1f;./missing.md&#x1f;">旧文</a>',
    '<a href="./mis\tsing.\r\nmd">旧文</a>',
  ]
  for (const body of flagged) {
    await writeFile(path, `${front}\n${body}\n`)
    const result = validate(root)
    assert.equal(result.status, 1, `${body}\n${result.stderr}`)
    assert.match(result.stderr, /链接指向 Markdown 源文件/)
  }

  // 浏览器解析 URL 时去掉首尾空白、删掉制表符与换行：
  // 不照做会把带前导空格的协议相对外链当站内，也会漏掉尾随空格后的 .md
  await writeFile(
    path,
    `${front}\n<a href=" //cdn.example.com/README.md">外链</a>\n`
  )
  assert.equal(validate(root).status, 0, '前导空格的协议相对外链是外站')

  await writeFile(path, `${front}\n<a href="./missing.md ">旧文</a>\n`)
  assert.equal(
    validate(root).status,
    1,
    '浏览器会去掉尾随空白，这个链接仍然指向 Markdown 源文件'
  )

  // 站内绝对路径指向 public/ 里的真实文件，不在预检范围内（由产物测试判定）
  await writeFile(path, `${front}\n[下载](/downloads/README.md)\n`)
  assert.equal(validate(root).status, 0, '站内绝对路径不归预检')

  // 注释里的 <a> 不是链接：正则取 href 会把它当成链接误报
  await writeFile(path, `${front}\n<!-- <a href="./missing.md">旧文</a> -->\n`)
  assert.equal(validate(root).status, 0, '注释里的标签不算链接')

  // data-href 不能冒充 href
  await writeFile(
    path,
    `${front}\n<a data-href="./missing.md" href="/blogs/ok/">旧文</a>\n`
  )
  assert.equal(validate(root).status, 0, 'data-href 不是 href')

  await writeFile(
    path,
    `${front}\n<a href="https://[invalid]/README.md">坏链接</a>\n`
  )
  const invalid = validate(root)
  assert.equal(invalid.status, 1, invalid.stderr)
  assert.match(invalid.stderr, /链接解析失败/)
  assert.doesNotMatch(invalid.stderr, /YAML parsing failed/)
})
