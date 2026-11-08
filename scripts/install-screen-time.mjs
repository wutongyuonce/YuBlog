/** 把采集程序装到本机应用目录，并登记每小时任务。装完后任务不再读取仓库。
 *
 * macOS 用用户级 launchd，凭证进登录钥匙串。Windows 用任务计划程序，凭证用当前用户
 * 的 DPAPI 加密后放在应用目录。两边都不把 token 写进任务定义或仓库。
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, realpathSync } from 'node:fs'
import { chmod, cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { homedir, userInfo } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { parseEnv } from 'node:util'

import {
  agentHome,
  CREDENTIAL_SERVICE,
  readSavedToken,
  SNAPSHOT_PATH,
} from './sync-screen-time.mjs'

export { CREDENTIAL_SERVICE as LABEL }

/** 复制到本机的采集逻辑版本。快照形状变了就加一，并重跑安装器。 */
export const AGENT_VERSION = 1

const WINDOWS_WRITE = `
$ErrorActionPreference = 'Stop'
$token = [Console]::In.ReadToEnd().Trim()
if (-not $token) { throw 'missing token' }
$secure = ConvertTo-SecureString $token -AsPlainText -Force
ConvertFrom-SecureString $secure | Set-Content -LiteralPath $env:YUBLOG_TOKEN_FILE -NoNewline
`

const xml = (value) =>
  value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export function installedPaths(home) {
  return {
    script: join(home, 'sync-screen-time.mjs'),
    log: join(home, 'screen-time.log'),
    snapshot: join(home, SNAPSHOT_PATH),
    tokenFile: join(home, 'blob-token.dpapi'),
    version: join(home, 'version'),
  }
}

export function launchAgentPlist({ node, script, cwd, log }) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${xml(CREDENTIAL_SERVICE)}</string>
  <key>ProgramArguments</key><array>
    <string>${xml(node)}</string>
    <string>${xml(script)}</string>
    <string>--publish</string>
  </array>
  <key>WorkingDirectory</key><string>${xml(cwd)}</string>
  <key>EnvironmentVariables</key><dict>
    <key>PATH</key><string>${xml(`${dirname(node)}:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin`)}</string>
  </dict>
  <key>StartCalendarInterval</key><dict>
    <key>Minute</key><integer>50</integer>
  </dict>
  <key>StandardOutPath</key><string>${xml(log)}</string>
  <key>StandardErrorPath</key><string>${xml(log)}</string>
</dict></plist>
`
}

/** 每天 00:50 起每小时一次，持续 23 小时，覆盖 :50 的 24 个整点。只在用户登录时运行。 */
export function scheduledTaskXml({ node, script, cwd }) {
  if ([node, script, cwd].some((value) => value.includes('"')))
    throw new Error('Screen time: install path cannot contain quotes')
  return `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <CalendarTrigger>
      <StartBoundary>2026-01-01T00:50:00</StartBoundary>
      <Enabled>true</Enabled>
      <ScheduleByDay><DaysInterval>1</DaysInterval></ScheduleByDay>
      <Repetition>
        <Interval>PT1H</Interval>
        <Duration>PT23H</Duration>
        <StopAtDurationEnd>false</StopAtDurationEnd>
      </Repetition>
    </CalendarTrigger>
  </Triggers>
  <Principals>
    <Principal>
      <LogonType>InteractiveToken</LogonType>
      <RunLevel>LeastPrivilege</RunLevel>
    </Principal>
  </Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <StartWhenAvailable>true</StartWhenAvailable>
    <ExecutionTimeLimit>PT5M</ExecutionTimeLimit>
    <AllowStartOnDemand>true</AllowStartOnDemand>
  </Settings>
  <Actions>
    <Exec>
      <Command>${xml(node)}</Command>
      <Arguments>${xml(`"${script}" --publish`)}</Arguments>
      <WorkingDirectory>${xml(cwd)}</WorkingDirectory>
    </Exec>
  </Actions>
</Task>
`
}

export function tokenFromEnvFile(contents) {
  if (!contents) return ''
  try {
    return parseEnv(contents).BLOB_READ_WRITE_TOKEN || ''
  } catch {
    return ''
  }
}

/** 删掉一行赋值，保留注释和其它变量。 */
export function stripEnvKey(contents, key) {
  return contents
    .split('\n')
    .filter((line) => {
      const trimmed = line.trim()
      if (!trimmed || trimmed.startsWith('#')) return true
      const eq = trimmed.indexOf('=')
      if (eq === -1) return true
      return trimmed.slice(0, eq).trim() !== key
    })
    .join('\n')
}

/** 环境变量优先，其次仓库 `.env`（只此一次），再次已保存的凭证。 */
export async function resolveInstallToken({
  env = '',
  envFile = '',
  readSaved,
  isTTY = false,
  prompt,
}) {
  if (env) return { token: env, source: 'env' }
  const fromFile = tokenFromEnvFile(envFile)
  if (fromFile) return { token: fromFile, source: 'env-file' }
  if (readSaved) {
    try {
      const saved = await readSaved()
      if (saved) return { token: saved, source: 'saved' }
    } catch {
      // 还没有保存过凭证。
    }
  }
  if (isTTY && prompt) {
    const token = (await prompt()).trim()
    if (!token) throw new Error('Screen time: missing BLOB_READ_WRITE_TOKEN')
    return { token, source: 'prompt' }
  }
  throw new Error(
    'Screen time: set BLOB_READ_WRITE_TOKEN for the installer. It is stored in the OS credential store, not in the repository.'
  )
}

function resolveDependency(name, fromPackageDir) {
  let current = fromPackageDir
  while (true) {
    const candidate = join(current, 'node_modules', name)
    if (existsSync(join(candidate, 'package.json')))
      return realpathSync(candidate)
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

/** `@vercel/blob` 及其声明的依赖。版本以仓库里已安装的为准，不另走网络。 */
export function blobPackageDirs(repoRoot) {
  const start = join(repoRoot, 'node_modules', '@vercel', 'blob')
  if (!existsSync(join(start, 'package.json')))
    throw new Error(
      'Screen time: run pnpm install before installing the local agent'
    )
  const dirs = []
  const seen = new Map()
  const walk = (dir) => {
    const real = realpathSync(dir)
    const pkg = JSON.parse(readFileSync(join(real, 'package.json'), 'utf8'))
    const previous = seen.get(pkg.name)
    if (previous) {
      if (previous !== real)
        throw new Error(`Screen time: conflicting package ${pkg.name}`)
      return
    }
    seen.set(pkg.name, real)
    dirs.push({ name: pkg.name, dir: real })
    for (const dep of Object.keys(pkg.dependencies ?? {})) {
      const next = resolveDependency(dep, real)
      if (!next)
        throw new Error(`Screen time: missing dependency ${dep} of ${pkg.name}`)
      walk(next)
    }
  }
  walk(start)
  return dirs
}

/** 覆盖采集脚本和上传库，不动快照、日志和凭证文件。 */
export async function installAgentFiles({ repoRoot, home }) {
  await mkdir(home, { recursive: true })
  for (const [from, to] of [
    ['scripts/sync-screen-time.mjs', 'sync-screen-time.mjs'],
    ['src/utils/screen-time.js', 'screen-time.js'],
    ['src/utils/screen-time-store.mjs', 'screen-time-store.mjs'],
  ])
    await cp(join(repoRoot, from), join(home, to), { force: true })
  await writeFile(join(home, 'version'), `${AGENT_VERSION}\n`)
  // 复制出来的 screen-time.js 离开仓库后，不再继承仓库的 "type": "module"。
  await writeFile(join(home, 'package.json'), '{"type":"module"}\n')
  const modules = join(home, 'node_modules')
  await rm(modules, { recursive: true, force: true })
  await mkdir(modules, { recursive: true })
  for (const { name, dir } of blobPackageDirs(repoRoot)) {
    const dest = join(modules, name)
    await mkdir(dirname(dest), { recursive: true })
    await cp(dir, dest, { recursive: true, dereference: true, force: true })
  }
}

/** 已有本机快照时保留它；仓库里的旧预览随后删除，避免两份。 */
export async function migrateSnapshot(repoRoot, home) {
  const from = join(repoRoot, '.local', 'screen-time.json')
  const to = join(home, SNAPSHOT_PATH)
  if (!existsSync(from)) return
  await mkdir(home, { recursive: true })
  if (!existsSync(to)) await cp(from, to)
  await rm(from, { force: true })
  await rm(join(repoRoot, '.local', 'screen-time-sync.lock'), {
    recursive: true,
    force: true,
  })
}

export async function stripRepoToken(repoRoot) {
  const path = join(repoRoot, '.env')
  const contents = await readFile(path, 'utf8').catch(() => '')
  if (!tokenFromEnvFile(contents)) return false
  const next = stripEnvKey(contents, 'BLOB_READ_WRITE_TOKEN')
  if (!next.trim()) await rm(path, { force: true })
  else await writeFile(path, next.endsWith('\n') ? next : `${next}\n`)
  return true
}

function runQuiet(command, args, options) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      windowsHide: true,
      ...options,
    })
  } catch {
    throw new Error('Screen time: credential command failed')
  }
}

async function storeToken(token, home) {
  if (process.platform === 'darwin') {
    runQuiet('/usr/bin/security', [
      'add-generic-password',
      '-U',
      '-s',
      CREDENTIAL_SERVICE,
      '-a',
      userInfo().username,
      '-T',
      '/usr/bin/security',
      '-w',
      token,
    ])
    return
  }
  const tokenFile = installedPaths(home).tokenFile
  runQuiet(
    join(
      process.env.SystemRoot || 'C:\\Windows',
      'System32',
      'WindowsPowerShell',
      'v1.0',
      'powershell.exe'
    ),
    ['-NoProfile', '-NonInteractive', '-Command', WINDOWS_WRITE],
    {
      input: token,
      env: { ...process.env, YUBLOG_TOKEN_FILE: tokenFile },
    }
  )
  await chmod(tokenFile, 0o600)
}

function forgetToken(home) {
  if (process.platform === 'darwin') {
    try {
      runQuiet('/usr/bin/security', [
        'delete-generic-password',
        '-s',
        CREDENTIAL_SERVICE,
        '-a',
        userInfo().username,
      ])
    } catch {
      // 凭证本来就不在。
    }
    return
  }
  return rm(installedPaths(home).tokenFile, { force: true })
}

function assertPlatform() {
  if (process.platform !== 'darwin' && process.platform !== 'win32')
    throw new Error('Screen time: the local agent supports macOS and Windows')
}

async function register(home) {
  const paths = installedPaths(home)
  if (process.platform === 'darwin') {
    const plistPath = join(
      homedir(),
      'Library',
      'LaunchAgents',
      `${CREDENTIAL_SERVICE}.plist`
    )
    await mkdir(dirname(plistPath), { recursive: true })
    await writeFile(
      plistPath,
      launchAgentPlist({
        node: process.execPath,
        script: paths.script,
        cwd: home,
        log: paths.log,
      })
    )
    execFileSync('plutil', ['-lint', plistPath], { stdio: 'inherit' })
    const domain = `gui/${process.getuid()}`
    try {
      execFileSync('launchctl', ['print', `${domain}/${CREDENTIAL_SERVICE}`], {
        stdio: 'ignore',
      })
      execFileSync('launchctl', ['bootout', `${domain}/${CREDENTIAL_SERVICE}`])
    } catch (error) {
      if (error.status !== 113) throw error
    }
    execFileSync('launchctl', ['bootstrap', domain, plistPath])
    return
  }
  const taskXml = join(home, 'task.xml')
  await writeFile(
    taskXml,
    Buffer.from(
      `\ufeff${scheduledTaskXml({
        node: process.execPath,
        script: paths.script,
        cwd: home,
      })}`,
      'utf16le'
    )
  )
  execFileSync(
    join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'schtasks.exe'),
    ['/Create', '/TN', CREDENTIAL_SERVICE, '/XML', taskXml, '/F'],
    { stdio: 'inherit' }
  )
  await rm(taskXml, { force: true })
}

async function unregister() {
  if (process.platform === 'darwin') {
    const domain = `gui/${process.getuid()}`
    try {
      execFileSync('launchctl', ['bootout', `${domain}/${CREDENTIAL_SERVICE}`])
    } catch (error) {
      if (error.status !== 113) throw error
    }
    await rm(
      join(homedir(), 'Library', 'LaunchAgents', `${CREDENTIAL_SERVICE}.plist`),
      { force: true }
    )
    return
  }
  try {
    execFileSync(
      join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'schtasks.exe'),
      ['/Delete', '/TN', CREDENTIAL_SERVICE, '/F'],
      { stdio: 'ignore' }
    )
  } catch {
    // 任务本来就不在。
  }
}

async function promptSecret() {
  process.stdout.write('BLOB_READ_WRITE_TOKEN: ')
  const stdin = process.stdin
  stdin.setRawMode(true)
  stdin.resume()
  stdin.setEncoding('utf8')
  let value = ''
  return await new Promise((resolve, reject) => {
    const onData = (key) => {
      if (key === '\u0003') {
        cleanup()
        reject(new Error('Screen time: install cancelled'))
        return
      }
      if (key === '\r' || key === '\n') {
        cleanup()
        process.stdout.write('\n')
        resolve(value)
        return
      }
      if (key === '\u007f') {
        value = value.slice(0, -1)
        return
      }
      value += key
    }
    const cleanup = () => {
      stdin.setRawMode(false)
      stdin.pause()
      stdin.off('data', onData)
    }
    stdin.on('data', onData)
  })
}

async function install() {
  assertPlatform()
  const repoRoot = fileURLToPath(new URL('../', import.meta.url))
  const home = agentHome()
  const decision = await resolveInstallToken({
    env: process.env.BLOB_READ_WRITE_TOKEN,
    envFile: await readFile(join(repoRoot, '.env'), 'utf8').catch(() => ''),
    readSaved: () => readSavedToken(),
    isTTY: process.stdin.isTTY === true,
    prompt: promptSecret,
  })
  await mkdir(home, { recursive: true })
  if (decision.source !== 'saved') await storeToken(decision.token, home)
  await installAgentFiles({ repoRoot, home })
  await migrateSnapshot(repoRoot, home)
  await register(home)
  const stripped = await stripRepoToken(repoRoot)
  const paths = installedPaths(home)
  console.log(
    `Installed screen time agent ${AGENT_VERSION} at ${home}\nRuns hourly at :50 local time; log: ${paths.log}\nThe git checkout is not used by the hourly task. Re-run this installer after the snapshot format or the Node path changes.${stripped ? '\nRemoved BLOB_READ_WRITE_TOKEN from .env.' : ''}`
  )
}

async function uninstall() {
  assertPlatform()
  const home = agentHome()
  await unregister()
  await forgetToken(home)
  console.log(
    `Removed the hourly task and saved token.\nSnapshot kept at ${installedPaths(home).snapshot}`
  )
}

if (
  process.argv[1] &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  const args = process.argv.slice(2)
  if (args.length > 1 || (args.length === 1 && args[0] !== '--uninstall')) {
    console.error('Usage: node scripts/install-screen-time.mjs [--uninstall]')
    process.exitCode = 1
  } else {
    const run = args[0] === '--uninstall' ? uninstall : install
    try {
      await run()
    } catch (error) {
      console.error(
        error instanceof Error ? error.message : 'Screen time: install failed'
      )
      process.exitCode = 1
    }
  }
}
