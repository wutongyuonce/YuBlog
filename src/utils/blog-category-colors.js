import { readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

/** @typedef {{palette: Record<string, number>, assignments: Record<string, string>}} CategoryColorRegistry */
const REGISTRY_PATH = resolve('src/data/blog-category-colors.json')

/** @param {CategoryColorRegistry} registry */
function validateRegistry(registry) {
  for (const field of ['palette', 'assignments']) {
    const value = registry?.[field]
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new Error(`分类配色记录的 ${field} 必须是对象`)
  }
  const hues = Object.values(registry.palette)
  if (
    !hues.length ||
    hues.some((hue) => !Number.isInteger(hue) || hue < 0 || hue >= 360) ||
    new Set(hues).size !== hues.length
  )
    throw new Error('分类配色 palette 必须包含不重复的整数色相（0–359）')

  const assigned = new Set()
  for (const [category, color] of Object.entries(registry.assignments)) {
    if (
      !category ||
      typeof color !== 'string' ||
      !Object.hasOwn(registry.palette, color)
    )
      throw new Error(`分类 ${JSON.stringify(category)} 引用了不存在的配色`)
    if (assigned.has(color))
      throw new Error(`分类配色 ${JSON.stringify(color)} 被重复分配`)
    assigned.add(color)
  }
}

/** @param {string} [registryPath] @returns {CategoryColorRegistry} */
function readRegistry(registryPath = REGISTRY_PATH) {
  const registry = JSON.parse(readFileSync(registryPath, 'utf8'))
  validateRegistry(registry)
  return registry
}

/** Allocate the whole batch before writing; absent categories retain their slots.
 * @param {string[]} categories @param {CategoryColorRegistry} registry
 * @returns {CategoryColorRegistry}
 */
export function assignCategoryColors(categories, registry) {
  validateRegistry(registry)
  if (categories.some((category) => typeof category !== 'string' || !category))
    throw new Error('分类名称必须是非空字符串')
  const assignments = new Map(Object.entries(registry.assignments))
  const used = new Set(assignments.values())
  const available = Object.keys(registry.palette).filter(
    (color) => !used.has(color)
  )
  const pending = [...new Set(categories)]
    .filter((category) => !assignments.has(category))
    .sort()
  if (pending.length > available.length)
    throw new Error(
      `分类配色池已用尽：新分类 ${pending.join('、')} 需要 ${pending.length} 个颜色，剩余 ${available.length} 个。请先在 src/data/blog-category-colors.json 的 palette 补充不重复配色，再构建。`
    )
  pending.forEach((category, index) =>
    assignments.set(category, available[index])
  )
  return {
    palette: registry.palette,
    assignments: Object.fromEntries(assignments),
  }
}

/** @param {string} category @param {CategoryColorRegistry} [registry] */
export function getBlogCategoryColors(category, registry = readRegistry()) {
  validateRegistry(registry)
  if (!Object.hasOwn(registry.assignments, category))
    throw new Error(`分类 ${JSON.stringify(category)} 尚未分配归档配色`)
  const hue = registry.palette[registry.assignments[category]]
  return { light: `hsl(${hue} 32% 36%)`, dark: `hsl(${hue} 32% 72%)` }
}

/** Persist new assignments on archive render (dev and build), never on the client.
 * @param {string[]} categories @param {string} [registryPath]
 */
export function syncCategoryColors(categories, registryPath = REGISTRY_PATH) {
  const previous = readRegistry(registryPath)
  const registry = assignCategoryColors(categories, previous)
  if (
    JSON.stringify(registry.assignments) !==
    JSON.stringify(previous.assignments)
  ) {
    const temporary = `${registryPath}.${process.pid}.tmp`
    writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`, {
      flag: 'wx',
    })
    try {
      renameSync(temporary, registryPath)
    } catch (error) {
      unlinkSync(temporary)
      throw error
    }
  }
  return registry
}
