/** @param {string} pathname */
export function normalizeNavPath(pathname) {
  return pathname.endsWith('/') ? pathname : `${pathname}/`
}

const MORE_SECTIONS = ['about', 'projects', 'friends', 'resume']

/** Only these navigation entries own child pages and dropdowns.
 * @param {string} pathname
 * @param {string} [home]
 */
export function getNavSection(pathname, home = '/') {
  const path = normalizeNavPath(pathname)
  const root = normalizeNavPath(home)
  if (path === `${root}blogs/`) return 'blogs'
  if (path === `${root}interests/`) return 'interests'
  if (MORE_SECTIONS.some((name) => path === `${root}${name}/`)) return 'more'
  return null
}

/** Use the same parent-page rule before and after hydration.
 * @param {string} pathname
 * @param {string} target
 * @param {string} [home]
 */
export function isCurrentNav(pathname, target, home = '/') {
  const path = normalizeNavPath(pathname)
  const href = normalizeNavPath(target)
  return (
    path === href ||
    Boolean(getNavSection(href, home) && path.startsWith(href)) ||
    (getNavSection(href, home) === 'more' &&
      getNavSection(path, home) === 'more')
  )
}
