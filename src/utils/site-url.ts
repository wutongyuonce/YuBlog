/**
 * Join a site-rooted path (already base-aware) with SITE.website.
 * `path` should begin with `/` or the configured base.
 */
export function toAbsoluteUrl(website: string, path: string): string {
  return new URL(path, website).href
}
