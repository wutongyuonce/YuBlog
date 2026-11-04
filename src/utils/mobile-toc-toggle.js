/**
 * Whether the floating TOC toggle can open a panel, and its title.
 *
 * Callers set `sidebarOwnsToc` when there is a TOC and DesktopAside is visible
 * (`min-width: 1200px`). Keep that breakpoint in one place with the aside.
 *
 * @param {{ hasToc: boolean, sidebarOwnsToc: boolean }} input
 * @returns {{ disabled: boolean, title: string }}
 */
export function resolveTocToggleState({ hasToc, sidebarOwnsToc }) {
  if (!hasToc) {
    return { disabled: true, title: 'No table of contents' }
  }
  if (sidebarOwnsToc) {
    return { disabled: true, title: 'Table of contents (sidebar)' }
  }
  return { disabled: false, title: 'Table of contents' }
}
