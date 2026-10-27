/** 把当前 Node 与仓库的绝对路径写入用户 launchd；更换路径／Node 版本后重新运行。 */
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const LABEL = 'site.wutongyu.screen-time'

const xml = (value) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

/** 每小时第 50 分钟运行；只写 Minute 即表示每小时的该分钟。 */
export function launchAgentPlist({ node, script, cwd, log }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${LABEL}</string>
  <key>ProgramArguments</key><array>
    <string>${xml(node)}</string>
    <string>${xml(script)}</string>
    <string>--publish</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(cwd)}</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${xml(dirname(node))}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key><dict>
    <key>Minute</key><integer>50</integer>
  </dict>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`
}

async function install() {
  if (process.platform !== 'darwin')
    throw new Error('This installer requires macOS')
  const root = fileURLToPath(new URL('../', import.meta.url))
  const target = join(homedir(), 'Library/LaunchAgents', `${LABEL}.plist`)
  const log = join(homedir(), 'Library/Logs', 'YuBlog-screen-time.log')
  const domain = `gui/${process.getuid()}`
  await mkdir(dirname(target), { recursive: true })
  await mkdir(dirname(log), { recursive: true })
  await writeFile(
    target,
    launchAgentPlist({
      node: process.execPath,
      script: join(root, 'scripts/sync-screen-time.mjs'),
      cwd: root,
      log,
    })
  )
  execFileSync('plutil', ['-lint', target], { stdio: 'inherit' })
  try {
    execFileSync('launchctl', ['print', `${domain}/${LABEL}`], {
      stdio: 'ignore',
    })
    execFileSync('launchctl', ['bootout', `${domain}/${LABEL}`])
  } catch (error) {
    if (error.status !== 113) throw error
  }
  execFileSync('launchctl', ['bootstrap', domain, target])
  console.log(`Installed ${target}\nRuns hourly at :50 local time; log: ${log}`)
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
)
  await install()
