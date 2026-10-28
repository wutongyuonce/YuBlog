# 拾趣歌单

`/interests/playlists/` 按配置顺序纵向展示歌单，每份歌单是一张横向的封面海报卡片，不使用选择器、曲目列表或排序控件。桌面把卡片分成两栏：左侧约三分之一是铺满卡面的固定站内封面，右侧依次展示平台、作者、歌曲数量、链接标题、完整介绍和操作按钮；封面右缘用渐隐过渡到深色内容区，没有硬边框。卡片最小高度 16rem，长标题或介绍自然撑高，不截断信息。

卡片固定使用近黑底与浅色文字，形成与页面留白的强对比；封面是唯一的彩色主体，因此效果取决于配置的固定封面。全站 `--accent` 不再参与卡内配色，仍继续控制站点其它部分与外观切换。深色主题把卡底提亮一档，避免卡片与页面融为一体。卡片静态显示，不使用滚动展开、悬浮位移或循环装饰动画。

手机把卡片改为上下排列：方形封面在上并向下渐隐，信息与按钮在下，按钮保持至少 44px 高且不溢出。

标题直接链接原平台，移除外链箭头，悬浮与键盘聚焦显示下划线与浅色焦点轮廓。「播放」使用配置中的原平台歌单链接，在新标签页打开，移动端可由对应 App 接管；导出按钮使用描边胶囊，与实心白色播放键区分主次。

「导出文本」仅导出所在卡片的歌单，使用 API 返回的歌曲原顺序下载 UTF-8 文本，每行 `歌名 - 歌手 - 专辑`，缺失字段留空。加载、失败及空歌单时禁用按钮。静态 HTML 为每份配置生成卡片、固定封面和文字骨架，骨架只替换文字行、沿用相同封面色块并保留轻量脉冲（减少动态时静止）；API 只填充标题、作者、数量和描述，不在页面渲染曲目。空歌单显示「歌单里还没有歌曲。」；失败时显示友好说明，各卡片保留配置标题、固定封面和原站链接，并隐藏未知的歌曲数量。无脚本时显示说明和配置中的原站链接。API 文字通过 `textContent` 写入，封面和外链只信任构建时配置。构建产物、搜索索引和 Git 不包含完整歌曲数组。

## 配置与资料

唯一配置是 `src/data/playlists.json`：`id` 是稳定站内标识，`platform` 目前支持 `qq` 与 `netease`，`sourceId` 是平台歌单 ID，`title` 是可选后备名称，`cover` 是 `src/content/interests/playlists/` 内的文件名（如 `qq-9798567837.jpg`），`url` 是原平台桌面链接。**API 的非空 `dissname`（网易云为 `name`）优先于配置 `title`**；配置名称仅用于加载前、失败、无脚本和上游未提供标题时。

封面与其他拾趣页一样走 Astro 图片管线：组件在构建期把 `cover` 解析为打包后的资源地址并加站点 base，文件缺失或文件名写错时构建报错，不静默留空图，也不使用上游远程封面。运行时 `data-config` 与 `/api/playlists` 都不携带封面，封面只由构建期配置决定。

`src/utils/qq-playlist.mjs` 负责 JSONP／JSON 解析、形状校验和字段归一化：歌曲取 `title`／`name`、`singer[].name`（用 ` / ` 连接）、`album.title`／`album.name`；歌单取 `dissname`、`nickname`、可选 `desc` 与 `songnum`。缺失歌手／专辑保留空字符串，导出时对应字段留空。数量使用上游 `songnum`；若有效歌曲少于标称数量，对应卡片明确提示当前可导出数量，导出仅含实际返回的歌曲。非空歌单返回空列表视为上游失败。

`src/utils/netease-playlist.mjs` 是结构对称的网易云适配器：一个接口取 `api/playlist/detail` 的资料与曲目（`name`、`creator.nickname`、`description`、`trackCount`），歌曲取 `name`、`artists[].name`／`ar[].name`（同样用 ` / ` 连接）、`album.name`／`al.name`。该接口对长歌单会只回前若干首；当返回曲目少于 `trackCount` 时，适配器按 `trackIds` 逐批（每批 200 个 id）调 `api/v3/song/detail` 整份重取，保证顺序与歌单一致，总量封顶 5000 首。两者都是非官方公共接口，可能变更、限流或不可用。

QQ 请求携带固定 Referer `https://y.qq.com/`，网易云携带 `https://music.163.com/` 与固定 UA；两者都给整次抓取 15 秒预算（网易云补齐多批时共用同一计时），不重试，错误不泄露上游原文。不需要密钥、登录或 Cookie。`src/utils/playlists.mjs` 一次读取全部配置，按 `platform` 从 `ADAPTERS` 分派到对应适配器；未注册的平台抛 `not_implemented`。任何一份失败则整次快照失败，避免缓存部分歌单。

## 运行时接口与缓存

```text
PlaylistsPanel.astro：按配置静态生成 N 张卡片、骨架、无脚本链接
  → playlists-ui.js：GET /api/playlists、校验、按 ID 填充卡片、逐卡片导出
  → api/playlists.js：handlePlaylists(request, { fetchImpl, now })
  → playlists.mjs（按 platform 分派）→ qq-playlist.mjs／netease-playlist.mjs
```

只接受无查询参数的 `GET /api/playlists`，响应为 `{ updatedAt, playlists: [{ id, platform, sourceId, title, author, description, songCount, cover, url, songs: [{ title, artist, album }] }] }`。`updatedAt` 是本次抓取时间。其它方法返回 405 和 `Allow: GET`；包括 `?id=` 在内的查询参数返回 400，不访问上游。它不是任意 URL 转换器或开放代理。

成功返回 200，缓存头与 [首页听歌](./listening.md) 相同：`public, max-age=0, s-maxage=1800, stale-while-revalidate=300, stale-if-error=86400`。上游失败返回 502、`{ error: 'upstream_unavailable' }`；所有错误均为 `no-store`。没有跨请求进程缓存，旧数据由 CDN 管理。`.github/workflows/warm-playlists-cdn.yml` 约每 25 分钟（UTC）请求正式站无查询参数地址，检查 200 与响应形状，不提交数据。

Vercel 沿用现有 `vercel.json` 的 Other 预设收集根目录 `api/` 函数。`pnpm dev` 通过 `plugins/astro-playlists-endpoint.ts` 调用同一处理函数；`pnpm preview` 只服务静态文件。接口固定在 `/api/playlists`，不随站点 base 改变。页面元素断开时取消请求和事件监听，旧页面请求不能覆盖新页面。

QQ 使用非官方公共接口，可能变更、限流或不可用；网易云同样如此，且长歌单会多一次或多次补齐请求。两者都不能保证第三方接口持续可用。部署后仍需核实正式环境的函数路由、成功响应和 CDN 命中。

## 添加第二份歌单

1. 将封面放进 `src/content/interests/playlists/`，文件名自定（建议 `<id>.jpg`），不压缩、不改格式。
2. 向 `src/data/playlists.json` 追加唯一 `id`、`platform`、`sourceId`、`cover`、`url`，可选后备 `title`。
3. `platform` 写 `qq` 或 `netease`，两者都有适配器；其它平台需先在 `src/utils/playlists.mjs` 的 `ADAPTERS` 注册并补测试。
4. 重新构建并部署。卡片、各自的导出按钮与无脚本链接自动生成，暖缓存请求自动取得新的全量快照，不需要增加工作流请求或提交歌曲数组。

## 验证

`test/qq-playlist.test.mjs` 用两首歌的夹具覆盖字段回退、JSONP、空值、非法数据、净化错误及超时；`test/netease-playlist.test.mjs` 覆盖两种字段形状、详情截断后按 id 补齐、空单失败、净化错误及超时；`test/playlists-endpoint.test.mjs` 覆盖全量快照、标题优先级、静态封面、缓存、失败和方法／查询边界；`test/playlists-ui.test.mjs` 覆盖响应校验、静态链接、多歌单配置顺序及各自原顺序逐行导出。

```bash
node --test test/qq-playlist.test.mjs test/netease-playlist.test.mjs test/playlists-endpoint.test.mjs test/playlists-ui.test.mjs
pnpm check
pnpm build
pnpm test:built-restructure
pnpm test:built-markdown
```

浏览器另核实深浅主题、1440／390／320px、多卡片排列、标题悬浮与聚焦下划线、播放跳转、逐卡片导出文件、加载／空／失败／无脚本和站内往返；固定夹具的页面验证不能代替真实接口与部署验证。
