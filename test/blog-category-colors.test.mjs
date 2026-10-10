import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  assignCategoryColors,
  getBlogCategoryColors,
  syncCategoryColors,
} from '../src/utils/blog-category-colors.js'

const registry = JSON.parse(
  readFileSync(
    new URL('../src/data/blog-category-colors.json', import.meta.url),
    'utf8'
  )
)
const emptyRegistry = () => ({ palette: registry.palette, assignments: {} })

test('the preset pool supports at least 16 unique colors in both themes and preserves existing categories', () => {
  const paletteSize = Object.keys(registry.palette).length
  assert.ok(paletteSize >= 16)
  const allocated = assignCategoryColors(
    Object.keys(registry.palette),
    emptyRegistry()
  )
  for (const theme of ['light', 'dark']) {
    const colors = Object.keys(allocated.assignments).map(
      (category) => getBlogCategoryColors(category, allocated)[theme]
    )
    assert.equal(new Set(colors).size, paletteSize)
  }
  assert.deepEqual(getBlogCategoryColors('技术', registry), {
    light: 'hsl(239 32% 36%)',
    dark: 'hsl(239 32% 72%)',
  })
  assert.deepEqual(getBlogCategoryColors('思考', registry), {
    light: 'hsl(8 32% 36%)',
    dark: 'hsl(8 32% 72%)',
  })
  assert.deepEqual(getBlogCategoryColors('日记', registry), {
    light: 'hsl(197 32% 36%)',
    dark: 'hsl(197 32% 72%)',
  })
})

test('new categories claim unused colors without recoloring or releasing old categories', () => {
  const existing = {
    palette: registry.palette,
    assignments: { 技术: 'blue', 思考: 'warm-red', 日记: 'cyan' },
  }
  const names = ['旅行', '读书', '__proto__', '旅行; color: red', '👩‍💻']
  const allocated = assignCategoryColors([...names, '旅行'], existing)
  assert.deepEqual(
    allocated,
    assignCategoryColors([...names].reverse(), existing)
  )
  for (const category of Object.keys(existing.assignments))
    assert.deepEqual(
      getBlogCategoryColors(category, allocated),
      getBlogCategoryColors(category, existing)
    )
  const remaining = assignCategoryColors(['新分类'], allocated)
  for (const category of names) {
    assert.equal(
      remaining.assignments[category],
      allocated.assignments[category]
    )
    for (const color of Object.values(
      getBlogCategoryColors(category, remaining)
    ))
      assert.match(color, /^hsl\(\d+ \d+% \d+%\)$/)
  }
  assert.equal(
    new Set(Object.values(remaining.assignments)).size,
    Object.keys(remaining.assignments).length
  )
  assert.ok(Object.hasOwn(remaining.assignments, '__proto__'))
  assert.throws(() => getBlogCategoryColors('未领取', existing), /尚未分配/)
})

test('assignments persist, rerenders are idempotent, and exhaustion leaves the file untouched', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'yublog-category-colors-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const path = join(dir, 'colors.json')
  writeFileSync(
    path,
    JSON.stringify({
      palette: { blue: 239, red: 8, green: 135 },
      assignments: {},
    })
  )
  const first = syncCategoryColors(['新增分类'], path)
  const saved = readFileSync(path, 'utf8')
  assert.deepEqual(syncCategoryColors([], path), first)
  assert.equal(readFileSync(path, 'utf8'), saved)
  const complete = syncCategoryColors(['分类甲', '分类乙'], path)
  assert.equal(complete.assignments['新增分类'], first.assignments['新增分类'])
  const fullFile = readFileSync(path, 'utf8')
  assert.throws(
    () => syncCategoryColors(['超额分类'], path),
    /配色池已用尽.*补充/
  )
  assert.equal(readFileSync(path, 'utf8'), fullFile)

  // Extending the pool unblocks publishing without resetting any assignment.
  const extended = { ...complete, palette: { ...complete.palette, extra: 250 } }
  writeFileSync(path, JSON.stringify(extended))
  const resumed = syncCategoryColors(['超额分类'], path)
  assert.equal(resumed.assignments['超额分类'], 'extra')
  for (const category of Object.keys(complete.assignments))
    assert.equal(resumed.assignments[category], complete.assignments[category])
})

test('insufficient capacity rejects the entire allocation without mutating the input', () => {
  const small = { palette: { blue: 239 }, assignments: {} }
  assert.throws(() => assignCategoryColors(['甲', '乙'], small), /剩余 1 个/)
  assert.deepEqual(small.assignments, {})
})

test('invalid or duplicate preset assignments fail instead of silently recycling colors', () => {
  for (const invalid of [
    { palette: { blue: 239, other: 239 }, assignments: {} },
    { palette: { blue: 360 }, assignments: {} },
    { palette: { blue: '239' }, assignments: {} },
    { palette: {}, assignments: {} },
    { palette: { blue: 239 }, assignments: { 技术: 'missing' } },
    { palette: { blue: 239 }, assignments: { 技术: 'blue', 思考: 'blue' } },
  ])
    assert.throws(
      () => assignCategoryColors([], invalid),
      /分类配色|不存在的配色/
    )
})
