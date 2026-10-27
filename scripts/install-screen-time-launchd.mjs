/** 把当前 Node 与仓库的绝对路径写入用户 launchd；更换路径／Node 版本后重新运行。 */
import { execFileSync } from 'node:child_process'
import { mkdir, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

if (process.platform !== 'darwin')
  throw new Error('This installer requires macOS')

const label = 'site.wutongyu.screen-time'
const root = fileURLToPath(new URL('../', import.meta.url))
const agentDirectory = join(homedir(), 'Library/LaunchAgents')
const logDirectory = join(homedir(), 'Library/Logs')
const target = join(agentDirectory, `${label}.plist`)
const domain = `gui/${process.getuid()}`
const xml = (value) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
const log = xml(join(logDirectory, 'YuBlog-screen-time.log'))

await mkdir(agentDirectory, { recursive: true })
await mkdir(logDirectory, { recursive: true })
await writeFile(
  target,
  `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${label}</string>
  <key>ProgramArguments</key><array>
    <string>${xml(process.execPath)}</string>
    <string>${xml(join(root, 'scripts/sync-screen-time.mjs'))}</string>
    <string>--publish</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(root)}</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${xml(dirname(process.execPath))}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string>
  </dict>
  <key>StartCalendarInterval</key><dict>
    <key>Hour</key><integer>23</integer>
    <key>Minute</key><integer>50</integer>
  </dict>
  <key>StandardOutPath</key><string>${log}</string>
  <key>StandardErrorPath</key><string>${log}</string>
</dict></plist>
`
)
execFileSync('plutil', ['-lint', target], { stdio: 'inherit' })
try {
  execFileSync('launchctl', ['print', `${domain}/${label}`], {
    stdio: 'ignore',
  })
  execFileSync('launchctl', ['bootout', `${domain}/${label}`])
} catch (error) {
  if (error.status !== 113) throw error
}
execFileSync('launchctl', ['bootstrap', domain, target])
console.log(`Installed ${target}\nRuns daily at 23:50 local time; log: ${log}`)
