import assert from 'node:assert/strict'
import test from 'node:test'
import { getNavSection, isCurrentNav } from '../src/utils/nav-path.js'

test('trailing slashes cannot change dropdown or parent-page ownership', () => {
  for (const section of ['blogs', 'interests']) {
    for (const target of [`/${section}`, `/${section}/`]) {
      assert.equal(getNavSection(target), section)
      assert.equal(isCurrentNav(`/${section}`, target), true)
      assert.equal(isCurrentNav(`/${section}/child/`, target), true)
      assert.equal(isCurrentNav(`/${section}-other/`, target), false)
    }
  }
  assert.equal(getNavSection('/tags/'), null)
  assert.equal(isCurrentNav('/tags/child/', '/tags'), false)
})

test('base paths preserve the same parent ownership without selecting the home link', () => {
  for (const section of ['blogs', 'interests']) {
    const target = `/demo/${section}/`
    assert.equal(getNavSection(target, '/demo/'), section)
    assert.equal(isCurrentNav(`${target}child/`, target, '/demo/'), true)
    assert.equal(isCurrentNav(`${target}child/`, '/demo/', '/demo/'), false)
    assert.equal(isCurrentNav(`/other/${section}/`, target, '/demo/'), false)
  }
})
