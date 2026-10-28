# 拾趣歌单

`/interests/playlists/` 按配置顺序纵向展示歌单，每份歌单是一张横向卡片，不使用选择器、曲目列表或排序控件。封面与文字直接铺在页面上，卡间用轻分隔线，不加填充底色与描边底板。左侧为约 9rem 的固定站内圆角封面（细描边与轻阴影，悬停微抬，尊重减少动态偏好），右侧信息栏依次为平台名、链接标题、`by 作者` 与强调色「N 首」、介绍文案。卡片底部右侧保留轻量幽灵「导出文本」按钮。手机缩小封面和间距，介绍仍在信息栏内可读。

标题直接链接原平台，移除外链箭头；悬浮与键盘聚焦采用文章列表标题相同的透明下边框、文字颜色过渡和主题混色下划线。按钮和文字沿用主题变量，适配深浅主题。

「导出文本」仅导出所在卡片的歌单，使用 API 返回的歌曲原顺序下载 UTF-8 文本，每行 `歌名 - 歌手 - 专辑`，缺失字段留空。加载、失败及空歌单时禁用按钮。每份配置在静态 HTML 中都有对应卡片和轻量骨架，减少动态偏好下骨架静止；API 只填充标题、作者、数量和描述，不在页面渲染曲目。空歌单显示「歌单里还没有歌曲。」；失败时显示友好说明，各卡片保留配置标题、固定封面和原站链接。无脚本时显示说明和配置中的原站链接。API 文字通过 `textContent` 写入，封面和外链只信任构建时配置。构建产物、搜索索引和 Git 不包含完整歌曲数组。

## 配置与资料

唯一配置是 `src/data/playlists.json`：`id` 是稳定站内标识，`platform` 当前为 `qq`（预留 `netease`），`sourceId` 是平台歌单 ID，`title` 是可选后备名称，`cover` 是 `public/` 下的固定站内路径，`url` 是原平台桌面链接。**API 的非空 `dissname` 优先于配置 `title`**；配置名称仅用于加载前、失败、无脚本和上游未提供标题时。组件通过 `withBasePath` 为封面加入站点 base，不使用上游远程封面。

`src/utils/qq-playlist.mjs` 负责 JSONP／JSON 解析、形状校验和字段归一化：歌曲取 `title`／`name`、`singer[].name`（用 ` / ` 连接）、`album.title`／`album.name`；歌单取 `dissname`、`nickname`、可选 `desc` 与 `songnum`。缺失歌手／专辑保留空字符串，导出时对应字段留空。数量使用上游 `songnum`；若有效歌曲少于标称数量，对应卡片明确提示当前可导出数量，导出仅含实际返回的歌曲。非空歌单返回空列表视为上游失败。

QQ 请求携带固定 Referer `https://y.qq.com/`，15 秒超时，不重试；错误不泄露上游原文。不需要密钥、登录、Cookie 或播放器。`src/utils/playlists.mjs` 一次读取全部配置并按平台汇总快照；预留平台尚未实现时抛出 `not_implemented`。任何一份失败则整次快照失败，避免缓存部分歌单。

## 运行时接口与缓存

```text
PlaylistsPanel.astro：按配置静态生成 N 张卡片、骨架、无脚本链接
  → playlists-ui.js：GET /api/playlists、校验、按 ID 填充卡片、逐卡片导出
  → api/playlists.js：handlePlaylists(request, { fetchImpl, now })
  → playlists.mjs → qq-playlist.mjs → QQ 公共接口
```

只接受无查询参数的 `GET /api/playlists`，响应为 `{ updatedAt, playlists: [{ id, platform, sourceId, title, author, description, songCount, cover, url, songs: [{ title, artist, album }] }] }`。`updatedAt` 是本次抓取时间。其它方法返回 405 和 `Allow: GET`；包括 `?id=` 在内的查询参数返回 400，不访问上游。它不是任意 URL 转换器或开放代理。

成功返回 200，缓存头与 [首页听歌](./listening.md) 相同：`public, max-age=0, s-maxage=1800, stale-while-revalidate=300, stale-if-error=86400`。上游失败返回 502、`{ error: 'upstream_unavailable' }`；所有错误均为 `no-store`。没有跨请求进程缓存，旧数据由 CDN 管理。`.github/workflows/warm-playlists-cdn.yml` 约每 25 分钟（UTC）请求正式站无查询参数地址，检查 200 与响应形状，不提交数据。

Vercel 沿用现有 `vercel.json` 的 Other 预设收集根目录 `api/` 函数。`pnpm dev` 通过 `plugins/astro-playlists-endpoint.ts` 调用同一处理函数；`pnpm preview` 只服务静态文件。接口固定在 `/api/playlists`，不随站点 base 改变。页面元素断开时取消请求和事件监听，旧页面请求不能覆盖新页面。

QQ 使用非官方公共接口，可能变更、限流或不可用；不能保证第三方接口持续可用。部署后仍需核实正式环境的函数路由、成功响应和 CDN 命中。

## 添加第二份歌单

1. 将固定封面放入 `public/playlists/`。
2. 向 `src/data/playlists.json` 追加唯一 `id`、`platform`、`sourceId`、`cover`、`url`，可选后备 `title`。
3. 若平台不是 QQ，在 `src/utils/playlists.mjs` 接入对应适配器并补充测试；QQ 可直接复用。
4. 重新构建并部署。卡片、各自的导出按钮与无脚本链接自动生成，暖缓存请求自动取得新的全量快照，不需要增加工作流请求或提交歌曲数组。

## 验证

`test/qq-playlist.test.mjs` 用两首歌的夹具覆盖字段回退、JSONP、空值、非法数据、净化错误及超时；`test/playlists-endpoint.test.mjs` 覆盖全量快照、标题优先级、静态封面、缓存、失败和方法／查询边界；`test/playlists-ui.test.mjs` 覆盖响应校验、静态封面与链接、多歌单配置顺序及各自原顺序逐行导出。

```bash
node --test test/qq-playlist.test.mjs test/playlists-endpoint.test.mjs test/playlists-ui.test.mjs
pnpm check
pnpm build
pnpm test:built-restructure
pnpm test:built-markdown
```

浏览器另核实深浅主题、1440／390／320px、多卡片排列、标题悬浮与聚焦下划线、逐卡片导出文件、加载／空／失败／无脚本和站内往返；固定夹具的页面验证不能代替真实接口与部署验证。
