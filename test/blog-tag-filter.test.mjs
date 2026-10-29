import assert from 'node:assert/strict'
import test from 'node:test'

import {
  buildTagSummary,
  filterTagsMatchingQuery,
  matchesAllTags,
  normalizePostTags,
  truncateTagLabel,
} from '../src/utils/blog-tag-filter.js'
import {
  serializeBlogQuery,
  tagSelectionLinks,
} from '../src/utils/blog-browser.js'

test('normalizes whitespace, empty values, and duplicates per post', () => {
  assert.deepEqual(normalizePostTags([' Agent ', '', 'Agent', 'RAG']), [
    'Agent',
    'RAG',
  ])
})

test('counts posts once per tag and sorts by count then name', () => {
  assert.deepEqual(
    buildTagSummary([['RAG', 'Agent', 'Agent'], ['Agent', '测试'], ['RAG']]),
    [
      { tag: 'Agent', count: 2 },
      { tag: 'RAG', count: 2 },
      { tag: '测试', count: 1 },
    ]
  )
})

test('matches empty, single, and multiple AND selections', () => {
  const tags = ['Agent', 'RAG', '测试']

  assert.equal(matchesAllTags(tags, []), true)
  assert.equal(matchesAllTags(tags, ['Agent']), true)
  assert.equal(matchesAllTags(tags, ['Agent', 'RAG']), true)
  assert.equal(matchesAllTags(tags, ['Agent', 'Java']), false)
})

test('truncates by Unicode code point without changing short labels', () => {
  assert.equal(truncateTagLabel('Context Engineering'), 'Context Engi…')
  assert.equal(truncateTagLabel('Agent'), 'Agent')
  assert.equal(truncateTagLabel('😀😀😀', 2), '😀😀…')
})

test('search filter keeps tags that contain the query and hides empty matches', () => {
  const tags = ['Agent', 'RAG', '测试', 'Context Engineering', 'agent-ops']

  assert.deepEqual(filterTagsMatchingQuery(tags, ''), [])
  assert.deepEqual(filterTagsMatchingQuery(tags, '   '), [])
  assert.deepEqual(filterTagsMatchingQuery(tags, '无此标签'), [])
  assert.deepEqual(filterTagsMatchingQuery(tags, ' agent '), ['Agent', 'agent-ops'])
  assert.deepEqual(filterTagsMatchingQuery(tags, 'ENGINE'), ['Context Engineering'])
  assert.deepEqual(filterTagsMatchingQuery(tags, '测'), ['测试'])
  // Ablation: case-sensitive String.includes misses Latin casing on "Agent".
  assert.equal('Agent'.includes('agent'), false)
})

test('search tag links reuse tagSelectionLinks / serializeBlogQuery shape', () => {
  const tags = filterTagsMatchingQuery(['Agent', 'C#', 'a/b'], 'a')
  assert.deepEqual(tags, ['Agent', 'a/b'])
  const links = tagSelectionLinks(tags)
  assert.equal(links.length, 2)
  for (const link of links) {
    assert.equal(
      link.query,
      serializeBlogQuery({ category: '', tags: [link.tag], page: 1 })
    )
    assert.equal(link.label, `#${link.tag}`)
  }
})
