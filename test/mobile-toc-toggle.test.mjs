import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import test from 'node:test'

import { resolveTocToggleState } from '../src/utils/mobile-toc-toggle.js'

test('disables TOC toggle when the page has no navigable TOC', () => {
  assert.deepEqual(
    resolveTocToggleState({ hasToc: false, sidebarOwnsToc: false }),
    {
      disabled: true,
      title: 'No table of contents',
    }
  )
})

test('disables TOC toggle when the desktop sidebar owns the TOC', () => {
  assert.deepEqual(
    resolveTocToggleState({ hasToc: true, sidebarOwnsToc: true }),
    {
      disabled: true,
      title: 'Table of contents (sidebar)',
    }
  )
})

test('enables TOC toggle when headings exist and the sidebar does not own them', () => {
  assert.deepEqual(
    resolveTocToggleState({ hasToc: true, sidebarOwnsToc: false }),
    {
      disabled: false,
      title: 'Table of contents',
    }
  )
})

test('sitewide reading control always mounts FAB chrome and drops ToTopButton', () => {
  const layout = readFileSync(
    new URL('../src/layouts/BaseLayout.astro', import.meta.url),
    'utf8'
  )
  const control = readFileSync(
    new URL('../src/components/toc/MobileTocControl.astro', import.meta.url),
    'utf8'
  )
  const toTopPath = new URL(
    '../src/components/widgets/ToTopButton.astro',
    import.meta.url
  )

  assert.match(layout, /MobileTocControl/)
  assert.match(layout, /headings=\{\[\]\}/)
  assert.doesNotMatch(layout, /ToTopButton/)
  assert.equal(existsSync(toTopPath), false)

  // Empty headings must still render the host chrome (no length gate around it).
  assert.doesNotMatch(
    control,
    /\{headings\.length\s*>\s*0\s*&&\s*\(\s*<mobile-toc-control/
  )
  assert.match(control, /data-has-toc/)
  assert.match(control, /mobile-toc-control__fab/)
})
