import { readdir, rm } from 'node:fs/promises'
import { join } from 'node:path'

const pagefindDir = join(process.cwd(), 'dist', 'pagefind')

async function cleanupPagefindUiFiles() {
  let removedCount = 0

  try {
    const entries = await readdir(pagefindDir, { withFileTypes: true })

    for (const entry of entries) {
      if (!entry.isFile() || !entry.name.includes('ui')) continue

      await rm(join(pagefindDir, entry.name))
      removedCount++
    }
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      console.log('Pagefind output not found, skip cleanup.')
      return
    }

    throw error
  }

  console.log(`Removed ${removedCount} Pagefind UI file(s).`)
}

await cleanupPagefindUiFiles()
