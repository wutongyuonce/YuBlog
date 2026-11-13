import assert from 'node:assert/strict'
import test from 'node:test'

import { groupPhotos, readExif } from '../src/utils/photo-exif.mjs'

/**
 * 按给定字节序拼一个 `Exif\0\0` + TIFF 块。`ifds[i]` 是 `[tag, type, value]`：
 * ASCII（2）写字符串，BYTE（1）写数组，RATIONAL（5）写 `[分子, 分母]` 数组，
 * LONG（4）只用作子 IFD 指针，值是目标 IFD 的下标。
 */
function exifBlock(little, ifds) {
  const int = (bytes, value) => {
    const buffer = Buffer.alloc(bytes)
    buffer[`writeUInt${bytes * 8}${little ? 'LE' : 'BE'}`](value)
    return buffer
  }
  const data = (type, value) =>
    type === 2
      ? Buffer.from(`${value}\0`, 'latin1')
      : type === 5
        ? Buffer.concat(value.flatMap(([n, d]) => [int(4, n), int(4, d)]))
        : type === 1
          ? Buffer.from(value)
          : int(4, 0)
  const sizes = ifds.map((entries) =>
    entries.reduce((size, [, type, value]) => {
      const length = data(type, value).length
      return size + 12 + (length > 4 ? length : 0)
    }, 6)
  )
  const starts = sizes.map(
    (_, index) => 8 + sizes.slice(0, index).reduce((a, b) => a + b, 0)
  )
  const parts = [Buffer.from(little ? 'II' : 'MM'), int(2, 42), int(4, 8)]
  ifds.forEach((entries, index) => {
    let extra = starts[index] + 6 + 12 * entries.length
    const tail = []
    parts.push(int(2, entries.length))
    for (const [tag, type, value] of entries) {
      const bytes = type === 4 ? int(4, starts[value]) : data(type, value)
      const count = type === 2 ? bytes.length : type === 4 ? 1 : value.length
      parts.push(int(2, tag), int(2, type), int(4, count))
      if (bytes.length > 4) {
        parts.push(int(4, extra))
        tail.push(bytes)
        extra += bytes.length
      } else parts.push(Buffer.concat([bytes, Buffer.alloc(4 - bytes.length)]))
    }
    parts.push(int(4, 0), ...tail)
  })
  return Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), ...parts])
}

const ifd0 = [
  [0x0132, 2, '2026:01:01 08:00:00'],
  [0x8769, 4, 1],
  [0x8825, 4, 2],
]
const sample = (little, [ns, ew]) =>
  exifBlock(little, [
    ifd0,
    [
      [0x9003, 2, '2026:12:05 10:31:59'],
      [0x9011, 2, '+08:00'],
    ],
    [
      [1, 2, ns],
      [
        2,
        5,
        [
          [29, 1],
          [33, 1],
          [3600, 100],
        ],
      ],
      [3, 2, ew],
      [
        4,
        5,
        [
          [106, 1],
          [34, 1],
          [3792, 100],
        ],
      ],
      [5, 1, [0]],
      [6, 5, [[2455, 10]]],
    ],
  ])

test('readExif takes the original local time, offset and signed GPS in either byte order', () => {
  assert.deepEqual(readExif(sample(true, ['N', 'E'])), {
    takenAt: '2026-12-05T10:31',
    offset: '+08:00',
    coordinates: [106.5772, 29.56],
    altitude: 245.5,
  })
  assert.deepEqual(
    readExif(sample(false, ['S', 'W'])).coordinates,
    [-106.5772, -29.56]
  )
})

test('readExif falls back to DateTime and never throws on broken input', () => {
  assert.deepEqual(readExif(exifBlock(true, [ifd0.slice(0, 1)])), {
    takenAt: '2026-01-01T08:00',
  })
  for (const broken of [
    undefined,
    Buffer.from('Exif\0\0nope'),
    sample(true, ['N', 'E']).subarray(0, 30),
  ])
    assert.deepEqual(readExif(broken), {})
})

test('groupPhotos splits on date, time gap and distance, leaving untimed photos last', () => {
  const at = (file, takenAt, coordinates) => ({ file, takenAt, coordinates })
  const photos = [
    at('f', '2026-12-06T09:00', [106.6, 29.56]),
    at('b', '2026-12-05T10:40', [106.578, 29.5575]),
    at('g', undefined, [106.5, 29.5]),
    at('a', '2026-12-05T10:00', [106.5772, 29.5572]),
    at('e', '2026-12-05T13:00'),
    at('h'),
    at('d', '2026-12-05T11:00', [106.6, 29.56]),
    at('c', '2026-12-05T10:50'),
  ]
  assert.deepEqual(groupPhotos(photos), [
    {
      date: '2026-12-05',
      start: '10:00',
      end: '10:50',
      coordinates: [106.5776, 29.55735],
      files: ['a', 'b', 'c'],
    },
    {
      date: '2026-12-05',
      start: '11:00',
      end: '11:00',
      coordinates: [106.6, 29.56],
      files: ['d'],
    },
    { date: '2026-12-05', start: '13:00', end: '13:00', files: ['e'] },
    {
      date: '2026-12-06',
      start: '09:00',
      end: '09:00',
      coordinates: [106.6, 29.56],
      files: ['f'],
    },
    { coordinates: [106.5, 29.5], files: ['g', 'h'] },
  ])
})
