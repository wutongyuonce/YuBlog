export const MAX_DOT_POINTS = 8000
const BASE_SPACING = 15

/** Keep the full edge coverage while ensuring the rendered grid never exceeds the point limit. */
export function getDotGrid(width, height) {
  const baseColumns = Math.ceil((width + BASE_SPACING) / BASE_SPACING)
  const baseRows = Math.ceil((height + BASE_SPACING) / BASE_SPACING)
  let spacing = Math.max(
    BASE_SPACING,
    BASE_SPACING * Math.sqrt((baseColumns * baseRows) / MAX_DOT_POINTS)
  )
  // The drawing loop covers half a spacing outside each edge. The initial
  // estimate above omits some edge points, so check the actual grid dimensions.
  let columns = Math.ceil(width / spacing + 1.5)
  let rows = Math.ceil(height / spacing + 1.5)
  while (columns * rows > MAX_DOT_POINTS) {
    spacing *= 1.01
    columns = Math.ceil(width / spacing + 1.5)
    rows = Math.ceil(height / spacing + 1.5)
  }
  return { spacing, columns, rows }
}
