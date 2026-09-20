import assert from 'node:assert/strict'
import test from 'node:test'

import { encodePathSegments, escapeXml } from '../src/utils/rss-feed.js'

test('RSS path encoding preserves nested routes and escapes reserved slug characters', () => {
  assert.equal(
    encodePathSegments('/blogs/JUC 并发编程/Prompt Caching & Agent/'),
    '/blogs/JUC%20%E5%B9%B6%E5%8F%91%E7%BC%96%E7%A8%8B/Prompt%20Caching%20%26%20Agent/'
  )
})

test('RSS XML text escapes ampersands and markup characters', () => {
  assert.equal(
    escapeXml('A & B <title> "quoted"'),
    'A &amp; B &lt;title&gt; &quot;quoted&quot;'
  )
})
