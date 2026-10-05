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
const fixture = async (t, source) => {
  const root = await mkdtemp(join(tmpdir(), 'yublog-publisher-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  await mkdir(join(root, 'src/content/blogs'), { recursive: true })
  await writeFile(join(root, 'package.json'), '{}')
  await symlink(dependencies, join(root, 'node_modules'), 'dir')
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
print(json.dumps(module["frontmatter"](Path(sys.argv[2]), Path(sys.argv[3]))))
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
