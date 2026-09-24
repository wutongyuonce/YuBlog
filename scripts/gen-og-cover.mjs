/**
 * 生成社交分享封面图 public/og/default.png（1200×630），供 og:image / twitter:image 使用。
 *
 * 做法：拼一个 1200×630 的 HTML，字体直接指 public/fonts 里站点自带的 woff2，
 * 用 Chrome headless 以 2 倍缩放渲染，再用 sharp 降采样回 1200×630 —— 中文笔画边缘
 * 因此是 2 倍采样降下来的，比直接 1 倍渲染干净。
 *
 * 用法：pnpm og:cover
 * 改文案 / 换头像 / 调间距，改下面的 TEXT、PALETTE、LAYOUT 即可。
 */
import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import sharp from 'sharp'

const ROOT = process.cwd()
const OUT = join(ROOT, 'public', 'og', 'default.png')
const CHROME =
  process.env.CHROME_PATH ||
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'

const TEXT = {
  label: 'WutongRain’s Blog',
  title: '梧桐雨',
  latin: 'Wutong Yu',
  desc: '技术 · 工具 · 生活 · 思考',
  site: 'wutongyu.site',
}

const PALETTE = {
  paper: '#FAF7F2',
  ink: '#1A1A1A',
  hairline: '#D8D2C8',
  muted: '#6B6355',
  faint: '#B4AB9C',
  ring: '#E4DDD1',
}

// 标题字号 112 时量出的字面框（cssTop 164 → 墨迹 174..276，高 103）。
// 头像按这个框对齐，才能和右侧标题上下齐平。
const LAYOUT = {
  margin: 96,
  labelTop: 64,
  titleLeft: 242,
  titleTop: 164,
  titleSize: 112,
  avatarTop: 174,
  avatarSize: 103,
  ruleLeft: 242,
  ruleTop: 338,
  ruleWidth: 340,
  latinLeft: 244,
  latinTop: 376,
  footerBottom: 96,
  footerInset: 99,
}

const ASSETS = {
  serif: join(ROOT, 'public', 'fonts', 'SourceHanSerifCN-Regular.woff2'),
  kai: join(ROOT, 'public', 'fonts', 'LXGWWenKai-Regular.woff2'),
  avatar: join(ROOT, 'public', 'avatar.webp'),
}

for (const [name, path] of Object.entries({ chrome: CHROME, ...ASSETS })) {
  if (!existsSync(path)) {
    throw new Error(`Missing ${name}: ${path}`)
  }
}

const fileUrl = (path) => `file://${path}`

const html = `<!doctype html>
<html><head><meta charset="utf-8"><style>
@font-face{font-family:'SHSerif';src:url("${fileUrl(ASSETS.serif)}") format("woff2")}
@font-face{font-family:'LXGWWK';src:url("${fileUrl(ASSETS.kai)}") format("woff2")}
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:1200px;height:630px}
body{background:${PALETTE.paper};position:relative;overflow:hidden;
     font-family:'LXGWWK',system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.label{position:absolute;left:${LAYOUT.margin}px;top:${LAYOUT.labelTop}px;
       font-family:'SHSerif',serif;font-size:22px;line-height:1;letter-spacing:.01em;color:${PALETTE.muted}}
.avatar{position:absolute;left:${LAYOUT.margin}px;top:${LAYOUT.avatarTop}px;
        width:${LAYOUT.avatarSize}px;height:${LAYOUT.avatarSize}px;
        border-radius:50%;object-fit:cover;border:1px solid ${PALETTE.ring}}
.title{position:absolute;left:${LAYOUT.titleLeft}px;top:${LAYOUT.titleTop}px;
       font-family:'SHSerif',serif;font-size:${LAYOUT.titleSize}px;line-height:1;
       letter-spacing:.08em;color:${PALETTE.ink}}
.rule{position:absolute;left:${LAYOUT.ruleLeft}px;top:${LAYOUT.ruleTop}px;
      width:${LAYOUT.ruleWidth}px;height:2px;background:${PALETTE.hairline}}
.latin{position:absolute;left:${LAYOUT.latinLeft}px;top:${LAYOUT.latinTop}px;
       font-family:'SHSerif',serif;font-size:20px;line-height:1;letter-spacing:.38em;
       color:${PALETTE.muted};text-transform:uppercase}
.footer{position:absolute;left:${LAYOUT.footerInset}px;right:${LAYOUT.footerInset}px;
        bottom:${LAYOUT.footerBottom}px;display:flex;justify-content:space-between;align-items:baseline}
.desc{font-size:27px;line-height:1;letter-spacing:.04em;color:${PALETTE.muted}}
.site{font-size:19px;line-height:1;letter-spacing:.14em;color:${PALETTE.faint}}
</style></head><body>
<div class="label">${TEXT.label}</div>
<img class="avatar" src="${fileUrl(ASSETS.avatar)}">
<div class="title">${TEXT.title}</div>
<div class="rule"></div>
<div class="latin">${TEXT.latin.replace(' ', '&nbsp;')}</div>
<div class="footer"><div class="desc">${TEXT.desc}</div><div class="site">${TEXT.site}</div></div>
</body></html>`

const workDir = await mkdtemp(join(tmpdir(), 'og-cover-'))
const htmlPath = join(workDir, 'cover.html')
const shotPath = join(workDir, 'cover@2x.png')

await writeFile(htmlPath, html)
execFileSync(
  CHROME,
  [
    '--headless',
    '--disable-gpu',
    '--hide-scrollbars',
    '--allow-file-access-from-files',
    '--force-device-scale-factor=2',
    '--window-size=1200,630',
    `--screenshot=${shotPath}`,
    fileUrl(htmlPath),
  ],
  { stdio: 'ignore' }
)

const info = await sharp(shotPath)
  .resize(1200, 630, { kernel: 'lanczos3' })
  .png({ compressionLevel: 9 })
  .toFile(OUT)

console.log(`Wrote ${OUT} (${info.width}×${info.height}, ${info.size} bytes)`)
