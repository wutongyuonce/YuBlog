---
title: 用 Last.fm API 与 Vercel CDN 缓存做一个会自己更新的听歌排行
description: 从 Last.fm 取首页听歌排行，再用一个 Vercel 函数和 CDN 缓存挡住重复请求：记录用到的接口、踩过的坑、Cache-Control 的写法与上线步骤。
pubDate: 2026-10-15
category: 博客开发
tags: [Last.fm, Vercel CDN]
titleImage: ./_title-images/lastfm-profile.png
titleImageAlt: Last.fm 个人主页截图：累计 219 次记录、46 位歌手，最常听歌曲是 Gareth.T 的《玻璃》，下方是最近的播放列表
draft: false
---

首页一直想放一块“最近在听”。动手之前要先回答一个问题：这份数据从哪里来、多久更新一次。

我最早的实现是让 GitHub Actions 每小时取一次数据，写成一个 JSON 提交回仓库，用这次提交触发 Vercel 重新构建。能用，代价不小：仓库历史被 `chore: refresh ...` 这类提交填满，每小时整站重建一次，而数据依然是最多一小时前的。

后来换成另一种做法：数据不再进仓库，由一个 Vercel 函数在访问时去取，并用 Vercel 自带的 CDN 缓存住结果。

```text
浏览器打开首页
  → 先显示骨架，不阻塞首屏
  → 请求 /api/lastfm
      ├─ CDN 命中      → 直接返回缓存，函数不执行
      └─ 缓存已过期    → 执行函数 → 请求 Last.fm → 写回缓存
  → 校验响应，渲染统计与卡片
```

这篇文章记录两件事：Last.fm 的接口怎么接，以及这层 CDN 缓存是什么、怎么写才用对。

## Last.fm 的数据长什么样

Last.fm 记录的是 scrobble——一次“听了这首歌”的事件。所有请求都打同一个入口 `https://ws.audioscrobbler.com/2.0/`，用查询参数选方法：

```text
https://ws.audioscrobbler.com/2.0/?method=user.getTopTracks&user=你的用户名&period=7day&limit=10&api_key=...&format=json
```

先去 [Last.fm API 账号页](https://www.last.fm/api/account/create)创建一个应用，填应用名和用途即可拿到 API key。同一个页面还会给一份 shared secret，那是给需要用户授权的写操作签名的；本文只读公开数据，用不到它。

首页要显示的内容决定了要用哪些方法：

| 首页要显示 | 方法 | 关键参数 | 注意 |
| --- | --- | --- | --- |
| 过去七天 Top 10 | `user.getTopTracks` | `period=7day`、`limit=10` | 每首自带 `playcount`，但不含专辑与封面 |
| 七天听歌总次数 | `user.getRecentTracks` | `from`、`to`、`limit=200`、`page` | 次数在 `@attr.total`，见下 |
| 是否正在播放 | `user.getRecentTracks` | 同上 | 正在播放的记录带 `@attr.nowplaying` |
| 累计记录数 | `user.getInfo` | — | `user.playcount` |
| 最常听歌手 | `user.getTopArtists` | `period=7day`、`limit=1` | 取第一项 |
| 专辑名与封面 | `album.getInfo` | `artist`、`album` | 找不到专辑时返回 error 6 |

所以“接一个听歌接口”听起来是一个请求，实际是四到五个并发请求，再加一批补封面的请求。下面是四个真正费过时间的细节。

### 一：七天的总次数不能拿 Top 10 的播放次数相加

Top 10 只返回前十首，把它们相加得到的是“前十首的次数”，不是这一周的总次数。听了很多首冷门歌的人，这两个数字能差出一大截。

正确做法是用 `user.getRecentTracks`：固定一个 7 天的 UTC 起止时间，读 `@attr.total`，那是这段时间内的播放总数（与 `limit`、`page` 无关）。

```js
const to = Math.floor(now.getTime() / 1000)
const from = to - 7 * 24 * 60 * 60
const recent = await request('user.getRecentTracks', {
  from: String(from),
  to: String(to),
  limit: '200',
})
const weeklyScrobbles = Number(recent.recenttracks['@attr'].total)
```

### 二：专辑和封面不在排行接口里

`user.getTopTracks` 只给你歌名、歌手、播放次数和几个尺寸的封面——封面常常是空的，专辑名干脆没有。

这里的取舍是：不额外调用接口，而是从刚才那段时间窗内的最近播放记录里，按“歌名 + 歌手”找到同一首歌的真实播放记录（它有专辑名和封面）。滚动翻页到找齐为止，最多十页。这样做的前提是过滤掉正在播放的记录（它没有时间戳），并且只认落在时间窗内的记录：

```js
for (const played of page.recenttracks.track) {
  if (played['@attr']?.nowplaying === 'true') continue   // 正在播放，没有 date
  if (Number(played.date?.uts) < from) continue          // 落在窗口外
  const key = songKey(played.name, played.artist['#text'])
  if (!wanted.has(key) || albums.has(key)) continue      // 不是排行里的歌，或已经找到了
  albums.set(key, { album: played.album['#text'], cover: coverOf(played.image) })
}
```

窗口内找不到的（比如某首歌只在七天前播过，但翻十页也没翻到），再退回 `album.getInfo`。这里有个实用的补丁：Last.fm 的专辑名常带版本后缀，直接用 `Album (Deluxe Version)` 查会返回 error 6，所以再试一次去掉 `Explicit`、`Deluxe Version` 之类后缀的基础名。封面可以来自基础版，但卡片上仍然显示真实播放记录里的专辑名。

### 三：封面有一个占位图和两种尺寸

Last.fm 在“没有封面”时会返回一张灰色星形占位图，URL 里的文件名固定是 `2a96cbd8b46e442fc41c2b86b821562f`。如果不过滤，页面上就会出现一排灰色星形，比留空更糟。

尺寸写在路径里：`/i/u/300x300/xxx.jpg` 是 300px 缩略图，把这段换成 `ar0` 就是原图：

```js
export const lastfmOriginalCover = (cover) =>
  cover ? cover.replace(/\/i\/u\/[^/]+\//, '/i/u/ar0/') : null
```

页面上列表用 300px（省流量），点开大图时才加载 `ar0`。另外，封面 URL 只接受 https 且必须是 Last.fm 的图片域名——这个地址会被塞进 `<img src>`，不适合让上游返回什么都照单全收。

### 四：请求要有预算

一次取数最多两轮连环请求：翻最近播放（最多十页，每页 200 条）+ 每首缺封面的歌最多两次 `album.getInfo`。没有预算的话，一个冷门口页就能把你的函数拖到超时。

本站在适配器里统一约束：每个请求 15 秒超时（`AbortSignal.timeout`）、最多十页、每首最多两次专辑查询、整轮最多 33 个请求，并且不做无限重试。这些数字集中在取数的那个模块里，接口和页面都不再各自判断。

还有一个容易忽略的地方：`fetch` 抛出的异常信息里可能带着完整 URL，而完整 URL 里就有 `api_key`。所以适配器不把原始异常往外传：

```js
try {
  response = await fetch(url, { signal: AbortSignal.timeout(15_000) })
  data = await response.json()
} catch {
  // 异常可能含 URL 与 key，只换成一句安全的描述
  throw new Error(`Last.fm: ${method} request failed`)
}
```

## Vercel CDN 是什么

Vercel 在部署的静态资源和函数前面有一层全球分布的缓存。平时它负责把构建产物放到离访客最近的节点；对这里更重要的是：**函数返回的响应也可以交给它缓存**。

需要知道的大概是这几点：

- **你不需要管理这层缓存。** 不建 Redis、不写失效逻辑，只在响应里给一个 `Cache-Control` 头，存储、过期、回源、部署时失效都由 Vercel 处理。
- **命中缓存时函数不会执行。** 这是它对我们最有价值的地方——接口每次执行都要访问第三方 API，访问量涨十倍时，函数调用和 Last.fm 请求不必跟着涨十倍。
- **默认不缓存。** 没有 `Cache-Control` 时，默认值是 `public, max-age=0, must-revalidate`，等于每次都回源。缓存是显式换来的。
- **缓存键是完整的 URL，包含查询字符串。** 这一点后面会用到。
- **新部署会失效旧缓存。** Vercel 文档里明确说 CDN 缓存随部署失效，所以你不必担心“改了代码但缓存还留着旧结果”。
- **缓存状态是可观察的。** 响应头 `x-vercel-cache` 与 `age` 会告诉你这次是命中还是回源、这份缓存存在多久了。本站正式站的首页就返回过 `x-vercel-cache: HIT` 与 `age: 4023`。

它和浏览器缓存是两套东西，别混：

| 缓存层 | 谁在存 | 由哪个指令控制 |
| --- | --- | --- |
| 访客浏览器 | 访客自己的电脑 | `max-age` |
| Vercel CDN | Vercel 的节点 | `s-maxage`、`stale-while-revalidate`、`stale-if-error` |

## 用一行 Cache-Control 决定缓存行为

本站接口返回的头是这样的：

```http
Cache-Control: public, max-age=0, s-maxage=1800, stale-while-revalidate=300, stale-if-error=86400
Content-Type: application/json; charset=utf-8
```

逐个拆开：

| 指令 | 管谁 | 本站在这里的意思 |
| --- | --- | --- |
| `public` | 所有缓存 | 响应里没有个人数据，可以共享缓存 |
| `max-age=0` | 浏览器 | 每次访问都向 CDN 确认一次，避免浏览器把旧数据留在本地 |
| `s-maxage=1800` | CDN | 30 分钟内直接用缓存，不执行函数 |
| `stale-while-revalidate=300` | CDN | 刚过期的那 5 分钟，先把旧数据给访客，同时在后台取新的 |
| `stale-if-error=86400` | CDN | 回源出错（比如 Last.fm 抖动）时最多再沿用一天旧数据，而不是把错误给访客 |

**“30 分钟”不是定时任务。** 没有任何人访问时不会产生请求；过期之后，是第一个访问者触发回源。`stale-while-revalidate` 让这个触发过程不影响体验：他仍然立刻拿到 30 分钟前的那份数据，后台取完再换新。

也正因为如此，这个方案对“一个人看的博客”和“有点访问量的站点”是同一个逻辑：访问越少，回源越少。

### 三个响应头的优先级

需要更精细的控制时，Vercel 还认另外两个头，优先级从高到低：

| 响应头 | 作用范围 |
| --- | --- |
| `Vercel-CDN-Cache-Control` | 只影响 Vercel 自己的缓存 |
| `CDN-Cache-Control` | 影响 Vercel 缓存和其它 CDN |
| `Cache-Control` | Web 标准，优先级最低，同时被浏览器理解 |

本站只用 `Cache-Control`，因为不需要给不同 CDN 不同策略。有一个细节值得先知道：Vercel 文档说明，**只设置 `Cache-Control` 时，它会消费掉 `s-maxage`、`stale-while-revalidate` 这些指令，不把它们转发给浏览器**。所以你在浏览器里审查这个请求，看到的是 `public, max-age=0`——判断缓存有没有生效要看 `age` 和 `x-vercel-cache`，而不是有没有出现 `s-maxage`。

## 缓存之上还要有失败语义

加缓存之后，最容易出的问题不是“没缓存上”，而是“把错误也缓存了”。

- **失败响应一律 `no-store`。** 一次 Last.fm 超时如果被缓存 30 分钟，用户要等半小时才能看到恢复。所以 502、503、400、405 全部带 `no-store`，下一次请求重新试。
- **只接受不带查询参数的 `GET`。** 缓存键包含查询字符串，`/api/lastfm?v=1` 和 `?v=2` 是两份缓存、两次回源；而一次回源最多会打 33 个 Last.fm 请求。把接口限定在唯一地址，既让缓存行为可预测，也让别人没法用随机参数消耗你的 API 配额。
- **错误信息分两层。** 响应体只给机器可读的错误码（`missing_api_key`、`upstream_unavailable`），人看的细节走运行日志；日志里的消息由适配器净化过，不含密钥。

这几点加起来，接口的行为就是：成功时“慢一半小时、快一百倍”，失败时“立刻失败、下次再试、不污染缓存”。

## 把接口放到 Vercel：根目录 api/ 一个文件一个函数

Vercel 的函数约定很简单：**项目根目录 `api/` 下的每个文件就是一个函数**，文件路径就是路由。本站只用得到一个接口，所以就是 `api/lastfm.js`。

### 这个约定只在没有框架预设接管时生效

第一次部署时文件放好了、构建也成功，但预览环境的 `/api/lastfm` 返回 404——代码没错，是项目用的 Astro 框架预设接管了构建，仓库根目录的 `api/` 不再被当作函数收集。

Vercel 文档里“根目录 `api/` 下一个文件一个函数”是平台层面的约定；Astro 的官方文档给的是另一条路：加 `@astrojs/vercel` adapter，需要按需渲染的路由交给它。本站只要一个接口，不想为此把整个站点的产物换成 adapter 的输出——那会牵动 Pagefind 索引、字体子集和几套构建后检查——所以选择让框架预设让开：

```json
// vercel.json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "framework": null,
  "buildCommand": "pnpm build",
  "outputDirectory": "dist"
}
```

`framework: null` 等价于在控制台把 Framework Preset 选成 “Other”（`vercel.json` 里的值优先于控制台设置）。这时静态产物仍然由 `pnpm build` 生成、仍然发布 `dist`，Pagefind 索引、字体子集和构建后检查全部照旧，而 `api/` 下的文件按平台约定变成函数。把 `buildCommand` 与 `outputDirectory` 一起写下来，是为了不再依赖控制台的默认值——尤其是输出目录：Other 预设不会替你猜出 `dist`。

所以遇到 404 先分清是哪一层：先确认文件路径与路由写法，再确认框架预设有没有接管函数收集。反过来说，如果你的站点本来就要全站按需渲染，那走 adapter 才是对的，不必为了一个接口去改预设。

### 函数本体

因为 `package.json` 里有 `"type": "module"`，这个 `.js` 直接按 ESM 写。函数本体分两层——外面的默认导出负责读环境变量，里面的处理函数接收参数、返回值可测试，测试时注入一个假的 `fetch` 就能覆盖所有失败分支：

```js
// api/lastfm.js
import { fetchLastfmSnapshot } from '../src/utils/lastfm.mjs'

const CACHE =
  'public, max-age=0, s-maxage=1800, stale-while-revalidate=300, stale-if-error=86400'

export async function handleListening(request, { apiKey, user, fetchImpl, now } = {}) {
  if (request.method !== 'GET')
    return new Response(null, {
      status: 405,
      headers: { allow: 'GET', 'cache-control': 'no-store' },
    })
  if (new URL(request.url).search)
    return json({ error: 'unexpected_query' }, { status: 400, cache: 'no-store' })
  if (typeof apiKey !== 'string' || !apiKey.trim())
    return json({ error: 'missing_api_key' }, { status: 503, cache: 'no-store' })
  try {
    const snapshot = await fetchLastfmSnapshot({ apiKey, user, now, fetchImpl })
    return json(snapshot, { cache: CACHE })
  } catch (error) {
    // 适配器的错误信息已经不含密钥与上游原文，可以安全写进运行日志
    console.error(error.message)
    return json({ error: 'upstream_unavailable' }, { status: 502, cache: 'no-store' })
  }
}

export default {
  fetch: (request) =>
    handleListening(request, {
      apiKey: process.env.LASTFM_API_KEY,
      user: process.env.LASTFM_USER,
    }),
}
```

`json()` 只是三行 `new Response(JSON.stringify(...))` 的包装，负责补上 `content-type` 和这次要用的缓存策略。

函数只做一件事：把参数交给取数模块，把结果和缓存策略翻译成响应。它不判断排行、不计算统计、拼装封面 URL——这些属于取数模块。反过来，取数模块也不知道缓存存在，它只是“取一份数据，失败就抛”。

### 环境变量与部署

密钥走环境变量，不进仓库。在 Vercel 项目的 **Settings → Environment Variables** 里新建：

| Key | Value | Environments |
| --- | --- | --- |
| `LASTFM_API_KEY` | 你的 Last.fm API key | Production、Preview |

如果账号不是默认用户名，再加一条 `LASTFM_USER`。可选，代码里已经有默认值。

**改完环境变量必须重新部署才生效**——环境变量是在构建和部署时注入的，已在运行的部署不会自动读取新值。在 Deployments 里对最新部署执行一次 Redeploy 即可。

## 本地开发也要有同一个接口

`pnpm dev` 启动的是 Astro 开发服务器，没有 Vercel 的函数运行时。不处理的话，本地页面永远停在加载状态，改样式也看不到真实数据。

解决办法是复用同一个处理函数，把它挂到 Vite 的中间件上：

```ts
// plugins/astro-listening-endpoint.ts
server.middlewares.use('/api/lastfm', (request, response) => {
  void respond(request, response)
})

async function respond(request, response) {
  const env = { ...(await dotenv()), ...process.env }
  const result = await handleListening(new Request(url, { method: request.method }), {
    apiKey: env.LASTFM_API_KEY,
    user: env.LASTFM_USER,
  })
  response.statusCode = result.status
  result.headers.forEach((value, name) => response.setHeader(name, value))
  response.end(Buffer.from(await result.arrayBuffer()))
}
```

要点是**本地和线上是同一个实现**：同一套状态码、同一套失败语义。本地不配密钥时同样返回 503，页面同样进入失败状态——不会出现“本地正常、线上报错”这种最难查的差异。

这里的 `dotenv()` 读的是项目根目录被 Git 忽略的 `.env`。之所以要自己读：Astro 的开发服务器会把 `.env` 交给 `import.meta.env`，但不写进 `process.env`，而处理函数按线上的方式读 `process.env`。密钥优先取进程环境变量，其次才是文件。

## 前端：先骨架，再校验，再渲染

页面本身不需要跟着改成服务端渲染。本站仍是静态构建，听歌区块由三部分组成：

```text
<section data-listening data-state="loading">  骨架：统计显示占位，轨道为空
<template data-listening-card>                  一张卡片的完整结构（服务端输出）
<noscript>                                      无脚本时的说明与出口
```

服务端只输出结构和模板，数据由一小段脚本取回后填进去。这样做的好处是：卡片样式仍写在组件里走站点自己的 CSS，脚本只负责把文本、属性和图片地址填进克隆出来的节点，不再手写一遍 HTML。

### 响应先校验，再进 DOM

接口是信任边界之外的东西：它可能返回 HTML 错误页、被改写过的字段，或者干脆是空的。所以填充 DOM 之前先校验形状——名称非空、计数是非负安全整数、链接是 https、时间可解析——任何一项不合规就整体按加载失败处理，不用可疑数据渲染一半。

校验之后也只是设置文本和属性，**不用 `innerHTML`**。歌名、专辑名这些字符串来自 Last.fm 的曲库，用 `textContent` 和 `setAttribute` 能省掉一整套转义规则。

页面一共只有四种状态，都由根元素上的 `data-state` 表示：

| 状态 | 用户看到 |
| --- | --- |
| `loading` | 统计为 `—`，卡片区留出一张卡片的高度，避免数据到达后页面跳动 |
| `ready` | 统计、卡片、更新时间 |
| `empty` | “过去 7 天还没有听歌记录。”，隐藏卡片区 |
| `error` | “暂时无法获取听歌数据。”，隐藏卡片区 |

区分 `empty` 和 `error` 是有意的：前者是真实数据（这周真的没听歌），后者是取数失败。把它们合成一句“暂无数据”，排查问题时会多绕很久。

### 注入的卡片要让原来的模块重新接管

首页的卡片横滑栏本来就有两个模块在管：陈列架负责在排不开时复制一组卡片做头尾循环，图片查看器负责给封面加键盘大图入口。它们都是在页面加载时扫一遍 DOM 就结束的，运行时新增的卡片不在它们视野里。

这里没有重写一套逻辑，而是加了一个约定：谁注入内容，谁就派发一次事件。

```ts
document.dispatchEvent(new Event('content:added'))
```

陈列架收到后清掉这一排的旧副本、按新卡片重新判断是否需要循环；图片查看器重新扫一遍并只接管还没接管过的视图。两个模块各自维护自己的状态，注入方不需要知道它们内部怎么工作。

## 怎么确认它真的在工作

缓存类的改动最怕“看起来对了”。这一步建议按顺序验证，每一层给的是不同的证据：

1. **先确认这个路径真的变成了函数。** 返回 404 说明没有被收集（先回到上一步查框架预设），200 或 503 才说明函数在跑、接下来看的才是缓存。然后看状态与头部：

   ```bash
   curl -sI https://你的域名/api/lastfm | grep -iE 'HTTP|cache-control|age|x-vercel-cache'
   ```

   连续请求两次，第二次应该能看到 `x-vercel-cache: HIT` 和增长的 `age`。看不到 `s-maxage` 是正常的，前面说过它不会转发给浏览器。

2. **用假上游跑单元测试。** 取数模块的 `fetch` 是注入的，所以可以在不打真实网络的前提下覆盖：翻页上限、占位图过滤、专辑缺失、API 错误、时间窗外的记录。接口层的测试同样注入假 `fetch`，覆盖四种状态码与“失败响应不带缓存”这一条——这比在线上制造一次故障便宜得多。

3. **在浏览器里看四种状态。** 正常加载、接口失败、真实空数据、禁用 JavaScript，各看一次。减少动态效果（`prefers-reduced-motion`）下的横滑也值得看一次。

4. **上线后确认一遍真实数据。** 冷缓存的那次访问要等函数把这一轮 Last.fm 请求跑完，随后 30 分钟内所有访客都命中缓存。这一步只能在实际部署上验证，本地和浏览器结果都代替不了。

## 如果要在自己的站上复刻

按依赖顺序，落在这些文件上：

1. 申请 API key，并规划好要用的接口与时间窗（本文用的是固定 7 天 UTC 窗口）。
2. 写一个只在服务端运行的取数模块：请求、校验、排行与统计、封面匹配、请求预算。本站是 `src/utils/lastfm.mjs`。
3. 在项目根目录 `api/` 下加一个函数文件，读环境变量、给响应加 `Cache-Control`、把失败映射成状态码；并确认框架预设不会接管函数收集（本站用 `vercel.json` 的 `framework: null`）。
4. 配 `LASTFM_API_KEY`（Production + Preview）并重新部署；本地写进被忽略的 `.env`。
5. 页面输出骨架与卡片模板，脚本取回数据后校验、填充、派发 `content:added`。
6. 验证：响应头、注入假 `fetch` 的单测、浏览器的四种状态、上线后的真实数据。

两个可以按需改的参数：`s-maxage` 决定数据最多滞后多久（本站 30 分钟，越小越新鲜、回源越频繁），以及是否保留 `stale-if-error`（保留的代价是上游故障时你会继续展示旧数据，而不是让页面显式报错）。

不适合这层缓存的东西也要说清楚：带登录态的个性化响应应该用 `private, max-age=0`；实时性要求高到“过期即错误”的数据用 `no-store`。CDN 缓存解决的是“同样的数据被反复请求”，不是“数据必须永远最新”。

## 参考资料

- [Vercel：Cache-Control 响应头](https://vercel.com/docs/headers/cache-control-headers)（`s-maxage`、`stale-while-revalidate`、`stale-if-error` 与三个响应头的优先级）
- [Vercel：Vercel CDN 缓存](https://vercel.com/docs/caching/cdn-cache)
- [Vercel：缓存状态与原因](https://vercel.com/docs/caching/cache-status)（`x-vercel-cache` 的取值）
- [Vercel：Node.js 运行时与 `api/` 目录](https://vercel.com/docs/functions/runtimes/node-js)
- [Vercel：vercel.json 的 `framework`、`buildCommand` 与 `outputDirectory`](https://vercel.com/docs/project-configuration/vercel-json)
- [Last.fm API 文档](https://www.last.fm/api)
- [Last.fm：创建 API 账号](https://www.last.fm/api/account/create)
- [Astro：On-demand 渲染与 Vercel adapter](https://docs.astro.build/en/guides/integrations-guide/vercel/)（整个站点要服务端渲染时走这条路）
