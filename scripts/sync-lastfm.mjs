import { writeFile, rename, rm } from 'node:fs/promises'
import { pathToFileURL } from 'node:url'
import { fetchLastfmSnapshot } from './lib/lastfm.mjs'

export async function syncLastfm({
  destination = new URL('../src/data/lastfm.json', import.meta.url),
  ...options
} = {}) {
  const snapshot = await fetchLastfmSnapshot(options)
  const temporary =
    typeof destination === 'string'
      ? `${destination}.tmp`
      : new URL(`${destination.href}.tmp`)
  try {
    await writeFile(temporary, `${JSON.stringify(snapshot, null, 2)}\n`)
    await rename(temporary, destination)
  } finally {
    await rm(temporary, { force: true })
  }
  return snapshot
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  try {
    const snapshot = await syncLastfm({
      apiKey: process.env.LASTFM_API_KEY,
      user: process.env.LASTFM_USER,
    })
    console.log(
      `Last.fm synced: ${snapshot.tracks.length} tracks, ${snapshot.weeklyScrobbles} scrobbles in 7 days`
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
