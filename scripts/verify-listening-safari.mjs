// macOS + a running dev/preview server. Exercises Safari without remote automation.
// Run: node scripts/verify-listening-safari.mjs http://127.0.0.1:4322/
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import http from 'node:http'
import { promisify } from 'node:util'

const exec = promisify(execFile)
const base = new URL(process.argv[2] || 'http://127.0.0.1:4321/')
const response = await fetch(base)
assert.ok(response.ok, 'the local homepage must be available')
const original = await response.text()
const snapshot = {
  updatedAt: '2026-01-01T00:00:00Z',
  weeklyScrobbles: 10,
  totalScrobbles: 100,
  topArtist: 'Artist',
  tracks: Array.from({ length: 10 }, (_, index) => ({
    name: `Song ${index}`,
    artist: 'Artist',
    album: 'Album',
    cover: null,
    fullCover: null,
    url: 'https://www.last.fm/music/Artist',
    playcount: 1,
  })),
}

function checkInBrowser(snapshot) {
  const realFetch = window.fetch.bind(window)
  let release
  const gate = new Promise((resolve) => (release = resolve))
  window.fetch = (input, init) =>
    String(input) === '/api/lastfm'
      ? gate.then(() => new Response(JSON.stringify(snapshot)))
      : realFetch(input, init)
  const frame = () => new Promise(requestAnimationFrame)
  document.addEventListener('DOMContentLoaded', async () => {
    let result
    try {
      await document.fonts.ready
      const root = document.querySelector('[data-listening]')
      if (root?.dataset.state !== 'loading')
        throw new Error('the test must begin with the skeleton')
      document.documentElement.style.scrollBehavior = 'auto'
      window.scrollTo(0, document.documentElement.scrollHeight)
      await frame()
      await frame()
      const before = {
        y: window.scrollY,
        height: document.documentElement.scrollHeight,
      }
      release()
      const start = performance.now()
      while (root.dataset.state === 'loading') {
        if (performance.now() - start > 5000)
          throw new Error('the cards did not render')
        await frame()
      }
      await frame()
      await frame()
      result = {
        before,
        after: {
          y: window.scrollY,
          height: document.documentElement.scrollHeight,
        },
        state: root.dataset.state,
        cards: root.querySelectorAll('.media-card:not([data-marquee-clone])')
          .length,
        skeletons: root.querySelectorAll('[data-listening-skeleton]').length,
        bottom: root.getBoundingClientRect().bottom,
        viewport: window.innerHeight,
        browser: navigator.userAgent,
      }
    } catch (error) {
      result = { error: error.message }
    }
    await realFetch('/__listening-safari-result', {
      method: 'POST',
      body: JSON.stringify(result),
    })
  })
}

const html = original.replace(
  '<head>',
  `<head><script>(${checkInBrowser})(${JSON.stringify(snapshot)})</script>`
)
assert.notEqual(html, original, 'the page must accept the test bootstrap')
let receive
const report = new Promise((resolve) => (receive = resolve))
const server = http.createServer(async (req, res) => {
  try {
    if (req.url === '/__listening-safari-result' && req.method === 'POST') {
      let body = ''
      for await (const chunk of req) {
        body += chunk
        if (body.length > 8192) throw new Error('oversized test result')
      }
      receive(JSON.parse(body))
      res.end('ok')
    } else if (req.url === '/') {
      res.setHeader('content-type', 'text/html; charset=utf-8')
      res.end(html)
    } else {
      const upstream = await fetch(new URL(req.url, base), {
        signal: AbortSignal.timeout(15000),
      })
      res.writeHead(upstream.status, {
        'content-type': upstream.headers.get('content-type') || 'text/plain',
      })
      res.end(Buffer.from(await upstream.arrayBuffer()))
    }
  } catch (error) {
    if (!res.headersSent) res.writeHead(502)
    res.end(String(error))
  }
})
let windowId
let timeout
try {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/`
  const { stdout } = await exec('osascript', [
    '-e',
    `tell application "Safari"
      activate
      make new document with properties {URL:"${url}"}
      return id of front window
    end tell`,
  ])
  windowId = stdout.trim()
  const result = await Promise.race([
    report,
    new Promise((_, reject) => {
      timeout = setTimeout(() => reject(new Error('Safari timed out')), 30000)
    }),
  ])
  assert.ifError(result.error)
  assert.equal(result.state, 'ready')
  assert.equal(result.cards, 10)
  assert.equal(result.skeletons, 0)
  assert.ok(
    Math.abs(result.after.height - result.before.height) <= 1,
    'page height stays stable'
  )
  assert.ok(
    Math.abs(result.after.y - result.before.y) <= 1,
    'replacing the skeleton must not raise the scroll position'
  )
  assert.ok(
    result.bottom <= result.viewport + 1,
    'the complete listening section stays visible'
  )
  console.log('Safari listening replacement passed:', JSON.stringify(result))
} finally {
  clearTimeout(timeout)
  try {
    if (/^\d+$/.test(windowId || ''))
      await exec('osascript', [
        '-e',
        `tell application "Safari"
          if exists window id ${windowId} then close window id ${windowId}
        end tell`,
      ])
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}
