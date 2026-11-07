import assert from 'node:assert/strict'
import test from 'node:test'
import {
  sortMediaItems,
  mediaStats,
  tagTone,
  TAG_TONES,
} from '../src/utils/media-hub.js'
import items from '../src/data/media/items.json' with { type: 'json' }

test('todo first, dated done before undated, undated by title', () => {
  const sorted = sortMediaItems([
    { status: 'done', title: '乙', date: '2026-01-01' },
    { status: 'todo', title: '待看甲' },
    { status: 'done', title: '甲' },
    { status: 'done', title: '丙', date: '2026-11-01' },
  ])
  assert.deepEqual(
    sorted.map((i) => i.title),
    ['待看甲', '丙', '乙', '甲']
  )
})

test('stats use Shanghai calendar month/year', () => {
  const now = new Date('2026-11-06T12:00:00+08:00')
  const stats = mediaStats(
    [
      { status: 'todo' },
      { status: 'done', date: '2026-11-03' },
      { status: 'done', date: '2026-01-01' },
      { status: 'done' },
    ],
    now
  )
  assert.deepEqual(stats, { todo: 1, doneMonth: 1, doneYear: 2, total: 4 })
})

test('tag tones stay within the palette', () => {
  for (const tag of ['美剧', '科幻', 'RPG', '华语文学']) {
    const tone = tagTone(tag)
    assert.ok(Number.isInteger(tone) && tone >= 0 && tone < TAG_TONES)
  }
})

test('items follow the tag convention: 1–3 unique tags, region first for tv/anime', () => {
  const regions = {
    tv: ['美剧', '英剧', '韩剧', '日剧', '国产剧', '德剧', '印度剧', '综艺'],
    anime: ['日漫', '国漫', '动画电影'],
  }
  for (const item of items) {
    const { tags } = item
    assert.ok(
      Array.isArray(tags) && tags.length >= 1 && tags.length <= 3,
      `${item.id}: 1–3 tags`
    )
    assert.equal(new Set(tags).size, tags.length, `${item.id}: unique tags`)
    assert.ok(
      tags.every((tag) => typeof tag === 'string' && tag.trim() === tag && tag),
      `${item.id}: trimmed non-empty tags`
    )
    if (regions[item.category])
      assert.ok(
        regions[item.category].includes(tags[0]),
        `${item.id}: first tag is the region/type`
      )
  }
})
