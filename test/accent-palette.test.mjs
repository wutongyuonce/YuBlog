import assert from 'node:assert/strict'
import test from 'node:test'
import vm from 'node:vm'

import {
  ACCENT_PALETTES,
  accentPaletteStyles,
  createAccentPreference,
} from '../src/utils/accent-palette.js'

const fixture = () => {
  const values = new Map([['theme', 'dark']])
  const root = { dataset: {} }
  const storage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, value),
  }
  // Run the same self-contained factory that Head uses before module loading.
  const preference = vm.runInNewContext(
    `(${createAccentPreference.toString()})(${JSON.stringify(ACCENT_PALETTES)})`,
    { window: { localStorage: storage }, document: { documentElement: root } }
  )
  return { values, root, storage, preference }
}

test('every preset emits its light accent and a separate dark-mode accent', () => {
  const css = accentPaletteStyles()
  assert.equal(css.split(':root.dark').length - 1, ACCENT_PALETTES.length)
  for (const palette of ACCENT_PALETTES) {
    assert.match(css, new RegExp(`--accent:${palette.color}`))
    assert.match(css, new RegExp(`--accent-swatch:${palette.color}`))
  }
  assert.match(css, /:root\.dark\{--accent:#d0adf2/)
  assert.match(
    css,
    /:root\.dark\[data-accent-palette="purple"\]\{--accent:#a987e8/
  )
  assert.match(
    css,
    /:root\.dark\[data-accent-palette="blue"\]\{--accent:#7fafd2/
  )
  assert.match(
    css,
    /:root\.dark\[data-accent-palette="green"\]\{--accent:#7fd298/
  )
})

test('first visit and invalid saved IDs use grey violet rather than arbitrary CSS', () => {
  const { values, root, preference } = fixture()
  assert.equal(preference.restore().color, '#665477')
  for (const invalid of ['invalid', '__proto__', 'dark', '#ff0000']) {
    values.set('accent-palette', invalid)
    assert.equal(preference.restore().id, ACCENT_PALETTES[0].id)
    assert.equal(root.dataset.accentPalette, ACCENT_PALETTES[0].id)
  }
})

test('every preset survives incoming-page restoration without changing light/dark preference', () => {
  const { values, preference } = fixture()
  for (const { id } of ACCENT_PALETTES) {
    preference.select(id)
    const incoming = { dataset: {} }
    assert.equal(preference.restore(incoming).id, id)
    assert.equal(incoming.dataset.accentPalette, id)
    assert.equal(values.get('accent-palette'), id)
    assert.equal(values.get('theme'), 'dark')
  }
})

test('unavailable reads default safely while failed writes still apply the selected palette', () => {
  const { storage, root, preference } = fixture()
  storage.getItem = () => {
    throw new Error('Storage denied')
  }
  storage.setItem = () => {
    throw new Error('Storage quota exceeded')
  }
  assert.equal(preference.restore().id, ACCENT_PALETTES[0].id)
  assert.equal(preference.select('green').id, 'green')
  assert.equal(root.dataset.accentPalette, 'green')
  assert.equal(preference.restore().id, ACCENT_PALETTES[0].id)
})

test('even a denied localStorage getter does not prevent selection or restoration', () => {
  const root = { dataset: {} }
  const window = Object.defineProperty({}, 'localStorage', {
    get() {
      throw new Error('Storage unavailable')
    },
  })
  const preference = vm.runInNewContext(
    `(${createAccentPreference.toString()})(${JSON.stringify(ACCENT_PALETTES)})`,
    { window, document: { documentElement: root } }
  )
  assert.equal(preference.select('blue').id, 'blue')
  assert.equal(root.dataset.accentPalette, 'blue')
  assert.equal(preference.restore().id, ACCENT_PALETTES[0].id)
})
