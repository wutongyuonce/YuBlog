import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parsePlaylistsPayload,
  playlistText,
  sortPlaylistSongs,
} from '../src/utils/playlists-ui.js'

const songs = [
  { title: 'B', artist: 'A', album: 'Z' },
  { title: 'A', artist: 'B', album: 'Z' },
  { title: 'A', artist: 'A', album: 'Y' },
  { title: 'A', artist: 'A', album: 'Y' },
]
const config = [
  {
    id: 'qq-test',
    platform: 'qq',
    sourceId: '123',
    cover: '/base/playlists/local.jpg',
    url: 'https://y.qq.com/n/ryqq/playlist/123',
  },
]
const payload = {
  updatedAt: '2026-10-28T02:00:00Z',
  playlists: [
    {
      ...config[0],
      title: '测试',
      author: '',
      description: '',
      songCount: songs.length,
      songs,
    },
  ],
}

test('sorts use stable secondary fields and never mutate source order', () => {
  assert.deepEqual(sortPlaylistSongs(songs, 'title'), [
    songs[2],
    songs[3],
    songs[1],
    songs[0],
  ])
  assert.deepEqual(sortPlaylistSongs(songs, 'artist'), [
    songs[2],
    songs[3],
    songs[0],
    songs[1],
  ])
  assert.deepEqual(sortPlaylistSongs(songs, 'album'), [
    songs[2],
    songs[3],
    songs[1],
    songs[0],
  ])
  const original = sortPlaylistSongs(songs, 'original')
  assert.deepEqual(original, songs)
  assert.notEqual(original, songs)
  assert.equal(songs[0].title, 'B')
})

test('exports exactly one plain-text line per track, including missing albums', () => {
  assert.equal(
    playlistText([
      { title: '歌\n曲', artist: '歌手一 / 歌手二', album: '专辑' },
      { title: '<歌名>', artist: '歌手', album: '' },
    ]),
    '歌 曲 - 歌手一 / 歌手二 - 专辑\n<歌名> - 歌手 - '
  )
  assert.equal(playlistText([]), '')
})

test('validates the whole response and trusts only static cover/link metadata', () => {
  const data = structuredClone(payload)
  data.playlists[0].cover = 'https://remote.example/cover.jpg'
  data.playlists[0].url = 'javascript:alert(1)'
  const parsed = parsePlaylistsPayload(data, config)
  assert.equal(parsed.playlists[0].cover, config[0].cover)
  assert.equal(parsed.playlists[0].url, config[0].url)
  for (const invalid of [
    null,
    {},
    { ...payload, updatedAt: 'invalid' },
    { ...payload, playlists: [] },
    { ...payload, playlists: [null] },
    { ...payload, playlists: [{ ...payload.playlists[0], id: 'unknown' }] },
    { ...payload, playlists: [{ ...payload.playlists[0], songCount: -1 }] },
    {
      ...payload,
      playlists: [
        {
          ...payload.playlists[0],
          songs: [{ title: 'A', artist: {}, album: '' }],
        },
      ],
    },
  ])
    assert.equal(parsePlaylistsPayload(invalid, config), null)
})
