/* global taskSpace */
// Replace __TASK_SPACE_ID__ and __DIST_DIR__ before piping into ego-browser nodejs.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createServer } from 'node:http'
import { extname, resolve, sep } from 'node:path'

const task = await taskSpace(Number('__TASK_SPACE_ID__'))
const page = task.page('p1')
const dist = resolve('__DIST_DIR__')
const snapshot = {
  updatedAt: '2026-10-10T12:00:00Z',
  weeklyScrobbles: 7,
  totalScrobbles: 42,
  topArtist: 'Artist',
  tracks: [
    {
      name: 'Song',
      artist: 'Artist',
      album: null,
      cover: null,
      fullCover: null,
      url: 'https://www.last.fm/music/Artist/_/Song',
      playcount: 7,
    },
  ],
}
let releaseModules
const modules = new Promise((resolve) => {
  releaseModules = resolve
})
let held = false
let requests = 0
const mime = {
  '.js': 'text/javascript',
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
}
const server = createServer(async (request, response) => {
  response.setHeader('cache-control', 'no-store')
  const url = new URL(request.url, 'http://localhost')
  if (url.pathname === '/api/lastfm') {
    requests++
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify(snapshot))
    return
  }
  const pathname = decodeURIComponent(url.pathname)
  const file = resolve(
    dist,
    '.' + pathname + (pathname.endsWith('/') ? 'index.html' : '')
  )
  if (!file.startsWith(dist + sep)) {
    response.writeHead(403)
    response.end()
    return
  }
  // Hold one dependency, leaving HTTP/1 connection slots for the API itself.
  if (pathname.includes('/ClientRouter.astro_')) {
    held = true
    await modules
  }
  try {
    const bytes = await readFile(file)
    response.setHeader(
      'content-type',
      mime[extname(file)] || 'application/octet-stream'
    )
    response.end(bytes)
  } catch {
    response.writeHead(404)
    response.end()
  }
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/`
try {
  await page.cdp('Network.enable')
  await page.cdp('Network.setBlockedURLs', {
    urls: ['*oneko*', '*umami*', '*/fonts/*'],
  })
  await page.goto(base, { waitUntil: 'commit' })
  // A pending ClientRouter must not prevent listening from rendering. Failing
  // its request would unblock later modules and falsely pass the old code.
  await page.waitForFunction(
    () => document.querySelector('[data-listening]')?.dataset.state === 'ready'
  )
  assert.equal(held, true, 'exercise an actually pending ClientRouter request')
  assert.equal(requests, 1)
  assert.equal(
    await page.evaluate(
      () =>
        document.querySelector('[data-listening] .media-card__title')
          .textContent
    ),
    'Song'
  )
  releaseModules()
  await page.waitForLoadState('domcontentloaded')
  await page.waitForFunction(() => !!document.querySelector('bg-dot')?.ctx)
  assert.equal(requests, 1, 'page-load must not fetch a second snapshot')
  await page.evaluate(() => {
    window.__listeningDocument = true
  })
  await page.click('a[aria-label="文稿"]')
  await page.waitForURL(base + 'blogs/')
  assert.equal(requests, 1, 'non-home pages must not fetch listening data')
  await page.click('a.nav-bar__brand')
  await page.waitForURL(base)
  await page.waitForFunction(
    () => document.querySelector('[data-listening]')?.dataset.state === 'ready'
  )
  assert.equal(
    await page.evaluate(() => window.__listeningDocument),
    true,
    'exercise ClientRouter, not a hard navigation'
  )
  assert.equal(requests, 2, 'returning home fetches exactly one fresh snapshot')
  console.log(
    'Listening renders with other modules pending; ClientRouter round-trip and single requests: passed'
  )
} finally {
  releaseModules()
  await page.goto('about:blank')
  await page.cdp('Network.setBlockedURLs', { urls: [] })
  await new Promise((resolve) => server.close(resolve))
}
