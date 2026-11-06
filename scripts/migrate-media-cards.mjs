#!/usr/bin/env node
/**
 * One-shot: parse interests/{movie,anime,tv,game,book}.md :::card blocks into JSON.
 * Run from repo root: node scripts/migrate-media-cards.mjs
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'src/data/media/items.json')

const CATEGORIES = [
  { id: 'movie', file: 'movie.md', title: '电影' },
  { id: 'anime', file: 'anime.md', title: '动漫' },
  { id: 'tv', file: 'tv.md', title: '电视剧' },
  { id: 'game', file: 'game.md', title: '游戏' },
  { id: 'book', file: 'book.md', title: '书' },
]

const TODO_HEADINGS = new Set([
  '准备看',
  '准备玩',
  '正在看',
  '最近在玩',
])
const DONE_HEADINGS = new Set(['看过', '玩过'])

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[：:·・\s]+/g, '-')
    .replace(/[^\p{L}\p{N}-]+/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'item'
}

function parseAttrs(raw) {
  const attrs = {}
  const re = /(\w+)=(?:"([^"]*)"|'([^']*)'|([^\s}]+))/g
  let m
  while ((m = re.exec(raw))) {
    attrs[m[1]] = m[2] ?? m[3] ?? m[4]
  }
  return attrs
}

function normalizeScore(s) {
  if (s == null || s === '') return undefined
  const n = Number(String(s).trim())
  return Number.isFinite(n) ? n : undefined
}

function normalizeDate(s) {
  if (!s) return undefined
  const t = String(s).trim()
  if (/^\d{4}-\d{2}-\d{2}/.test(t)) return t.slice(0, 10)
  return undefined
}

function statusFromHeading(h) {
  if (!h) return null
  if (TODO_HEADINGS.has(h)) return 'todo'
  if (DONE_HEADINGS.has(h)) return 'done'
  return null
}

function parseFile(category, file) {
  const text = readFileSync(join(ROOT, 'src/content/interests', file), 'utf8')
  const body = text.replace(/^---[\s\S]*?---\n*/, '')
  const lines = body.split(/\n/)
  let status = category === 'book' ? 'done' : 'done'
  let sectionTag = undefined
  const items = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    const h3 = line.match(/^###\s+(.+)\s*$/)
    if (h3) {
      const name = h3[1].trim()
      const mapped = statusFromHeading(name)
      if (mapped) {
        status = mapped
        sectionTag = undefined
      } else if (category === 'book') {
        status = 'done'
        sectionTag = name
      }
      i++
      continue
    }
    const h4 = line.match(/^####\s+(.+)\s*$/)
    if (h4) {
      sectionTag = h4[1].trim()
      i++
      continue
    }
    const open = line.match(/^:::card\{([^}]*)\}\s*$/)
    if (!open) {
      i++
      continue
    }
    const attrs = parseAttrs(open[1])
    const block = []
    i++
    while (i < lines.length && !/^:::\s*$/.test(lines[i])) {
      block.push(lines[i])
      i++
    }
    if (i < lines.length) i++ // skip closing :::

    let cover
    const coverLine = block.find((l) => /!\[[^\]]*\]\(([^)]+)\)/.test(l))
    if (coverLine) {
      const m = coverLine.match(/!\[[^\]]*\]\(([^)]+)\)/)
      cover = m[1].replace(/^\.\//, '')
    }
    const reviewLines = block
      .filter((l) => !/!\[[^\]]*\]\(/.test(l) && l.trim() !== '')
      .map((l) => l.trim())
    let review = reviewLines.join('\n').trim() || undefined

    let itemStatus = status
    if (category === 'book') {
      itemStatus = 'done'
      if (review && /准备/.test(review)) itemStatus = 'todo'
    } else if (review) {
      // strip boilerplate "准备看。" / "正在看。" from review when that's the whole body
      if (/^(准备看|准备玩|正在看)[。.]?$/.test(review)) review = undefined
      else if (/^准备玩。?$/.test(review)) review = undefined
    }

    const title = attrs.title
    if (!title || !cover) {
      console.warn(`skip incomplete card in ${file}:`, attrs.title)
      continue
    }

    const id = `${category}-${slugify(title)}`
    const item = {
      id,
      category,
      status: itemStatus,
      title,
      cover,
    }
    if (attrs.href) item.href = attrs.href
    const score = normalizeScore(attrs.score)
    if (score != null) item.score = score
    const date = normalizeDate(attrs.date)
    if (date) item.date = date
    if (attrs.label) item.label = attrs.label
    else if (sectionTag && category !== 'book') item.label = sectionTag
    if (attrs.meta) item.meta = attrs.meta
    if (sectionTag && category === 'book') {
      item.tags = [sectionTag]
    }
    if (review) item.review = review
    items.push(item)
  }
  return items
}

const all = []
const seen = new Set()
for (const cat of CATEGORIES) {
  const items = parseFile(cat.id, cat.file)
  for (const item of items) {
    let id = item.id
    let n = 2
    while (seen.has(id)) {
      id = `${item.id}-${n++}`
    }
    item.id = id
    seen.add(id)
    all.push(item)
  }
  console.log(`${cat.id}: ${items.length}`)
}

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, JSON.stringify(all, null, 2) + '\n')
console.log(`wrote ${all.length} items → ${OUT}`)
