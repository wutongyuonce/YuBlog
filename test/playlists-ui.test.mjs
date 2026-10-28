import assert from 'node:assert/strict'
import test from 'node:test'
import {
  parsePlaylistsPayload,
  playlistText,
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

test('validates the whole response and keeps only configured links', () => {
  const data = structuredClone(payload)
  data.playlists[0].url = 'javascript:alert(1)'
  const parsed = parsePlaylistsPayload(data, config)
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

test('matches multiple playlists by id in config order and exports each original song order', () => {
  const secondEntry = {
    ...config[0],
    id: 'qq-second',
    sourceId: '456',
    url: 'https://y.qq.com/n/ryqq/playlist/456',
  }
  const secondPlaylist = {
    ...payload.playlists[0],
    ...secondEntry,
    title: '第二份歌单',
    songs: [songs[1], songs[0]],
    songCount: 2,
  }
  const multipleConfig = [...config, secondEntry]
  const data = {
    ...payload,
    playlists: [secondPlaylist, payload.playlists[0]],
  }
  const parsed = parsePlaylistsPayload(data, multipleConfig)
  assert.deepEqual(
    parsed.playlists.map(({ id }) => id),
    ['qq-test', 'qq-second']
  )
  assert.equal(
    playlistText(parsed.playlists[0].songs),
    'B - A - Z\nA - B - Z\nA - A - Y\nA - A - Y'
  )
  assert.equal(playlistText(parsed.playlists[1].songs), 'A - B - Z\nB - A - Z')
  assert.equal(
    parsePlaylistsPayload(
      {
        ...payload,
        playlists: [payload.playlists[0], payload.playlists[0]],
      },
      multipleConfig
    ),
    null
  )
})
