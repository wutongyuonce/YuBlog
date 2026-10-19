/**
 * Rewrite [data-random-link] href from data-candidates JSON on each page load.
 * Safe with Astro ClientRouter: re-run on astro:page-load.
 */

/**
 * @param {ParentNode} [root=document]
 */
export function assignRandomBrowseLinks(root = document) {
  root.querySelectorAll('[data-random-link]').forEach((node) => {
    if (!(node instanceof HTMLAnchorElement)) return
    const raw = node.getAttribute('data-candidates')
    if (!raw) return
    let candidates
    try {
      candidates = JSON.parse(raw)
    } catch {
      return
    }
    if (!Array.isArray(candidates) || candidates.length === 0) return
    const hrefs = candidates.filter((item) => typeof item === 'string' && item)
    if (hrefs.length === 0) return
    const index = Math.floor(Math.random() * hrefs.length)
    node.href = hrefs[index]
  })
}

export function bindRandomBrowseLinks() {
  const run = () => assignRandomBrowseLinks(document)
  document.addEventListener('astro:page-load', run)
  run()
}
