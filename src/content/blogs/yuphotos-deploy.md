---
title: 部署梧桐雨相册，并同步 Afilmory 上游
description: 照片在 Cloudflare R2，网页由 GitHub Pages 发布。按仓库里的实际步骤写第一次部署，并说明 fork 现在为什么不能只点 GitHub 同步，以及同步后要不要重新部署。
pubDate: 2026-10-21
category: 博客开发
tags: [afilmory]
titleImage: ./_title-images/afilmory-home.png
titleImageAlt: Afilmory 官网首页截图，深色背景，左侧大字是「照片不该埋在网盘里。」，右侧是一张石灯照片，底部标着 DSCF0842、X-T5、f/2.8 和 1/800
toc: true
search: true
draft: false
---

封面是 [Afilmory](https://github.com/Afilmory/afilmory) 官网，不是已经上线的相册。相册本身在 [YuPhotos](https://github.com/wutongyuonce/YuPhotos)，地址是 [photos.wutongyu.site](https://photos.wutongyu.site/)。

这篇文章只写这一套部署：网页用 GitHub Pages，原图用 Cloudflare R2。不写 Workers，也不把前端交给 Cloudflare Pages。

## 两条地址

| 地址 | 放什么 | 谁托管 |
| --- | --- | --- |
| `https://photos.wutongyu.site/` | 网页、缩略图、RSS | GitHub Pages |
| `https://images.wutongyu.site/` | 原图和 Live Photo 视频 | Cloudflare R2 |

浏览器打开相册后，再去图片域名取原图。两个子域名都挂在已有的 `wutongyu.site` 上。博客「更多 → 相册」指向相册域名，不指向图片域名。

构建时，`@afilmory/builder` 用只读凭据扫描 R2，生成照片清单和缩略图。缩略图打进 `apps/web/dist/`，跟网页一起发到 GitHub Pages。原图留在 R2。访客看到的图片地址是 `images.wutongyu.site`，不是 S3 API 地址。

根目录的 `pnpm build` 构建的是上游 SSR，不用于这个站点。发布用的是另一条命令：先 `pnpm build:manifest`，再对 `apps/web` 跑 Vite。

## 第一次部署

仓库已经是 [Afilmory/afilmory](https://github.com/Afilmory/afilmory) 的 fork。`origin` 指向 `wutongyuonce/YuPhotos`，`upstream` 指向上游。照片不进 Git，也不再用照片子模块。

### 1. 建 R2 桶

在管理 `wutongyu.site` 的 Cloudflare 账户里开通 R2，建一个 Standard 桶，把要公开的照片传进去。桶名示例是 `yuphotos`，以控制台里的实际名称为准。

上传用 Cloudflare 控制台或自己的工具。构建脚本只有读权限，不会替你上传。

### 2. 给原图挂域名

在桶的 Settings → Custom Domains 添加 `images.wutongyu.site`，等到 Active。

不要把 `https://<账号 ID>.r2.cloudflarestorage.com` 当成网页里的图片地址。那是给构建脚本用的 S3 API。

### 3. 允许相册读取原图

把仓库里的 `r2-cors.json` 贴到这个桶的 CORS 设置。它允许：

- `https://photos.wutongyu.site`
- `http://localhost:1924`
- `http://127.0.0.1:1924`

只开放 GET 和 HEAD。CORS 解决的是浏览器跨域读取，不是访问鉴权。桶如果要对公众可读，仍按 R2 自定义域名自己的公开方式处理。

### 4. 建只读 API 凭据

创建限定到这个桶的 Object Read only 凭据。构建只读原图，不需要写权限。

记下四项，不要写进仓库、站点 JSON 或聊天记录：

- 桶名称
- S3 API 地址，形如 `https://<账号 ID>.r2.cloudflarestorage.com`
- Access Key ID
- Secret Access Key

可选的目录前缀，例如 `photos/`。留空就扫描整个桶。

### 5. 把凭据放进 GitHub Actions

仓库 Settings → Secrets and variables → Actions。生产和以后的发布都读这里，不读 Cloudflare Pages 的环境变量。

| 名称 | 类型 | 内容 |
| --- | --- | --- |
| `S3_BUCKET_NAME` | Variable | 桶名称 |
| `S3_ENDPOINT` | Variable | S3 API 地址 |
| `S3_PREFIX` | Variable，可选 | 只扫描的目录；留空扫描整个桶 |
| `S3_ACCESS_KEY_ID` | Secret | Access Key ID |
| `S3_SECRET_ACCESS_KEY` | Secret | Secret Access Key |

区域和图片域名不放在这张表里。`builder.config.default.ts` 把区域写成 `auto`，把公开域名写成 `https://images.wutongyu.site`。构建只认 `S3_BUCKET_NAME`，不用再填一个 `S3_BUCKET`。

本地同一组值放在不提交的 `.env`，字段见 `.env.example`。

### 6. 把相册域名指到 GitHub Pages

在 Cloudflare DNS 加一条 `photos` CNAME，目标是 `wutongyuonce.github.io`，代理状态用 DNS only。橙云代理不要开，否则和 GitHub Pages 的证书冲突。

在 GitHub 仓库 Settings → Pages：

- 构建来源选 GitHub Actions，不要选某个分支
- Custom domain 填 `photos.wutongyu.site`
- 证书可用后打开 Enforce HTTPS

仓库里的 `apps/web/public/CNAME` 内容是 `photos.wutongyu.site`。工作流会把它带进发布产物。

### 7. 发布

Actions 里运行 **Deploy YuPhotos to GitHub Pages**。`main` 上的推送也会触发它，也可以手动运行。

这一次运行会：

1. 用 Node.js 22 安装相册和 builder 的依赖。仓库锁定的是 pnpm 11。
2. 检查部署配置。
3. 用上面的凭据扫描 R2，生成清单和缩略图。
4. 用 Vite 构建 `apps/web`，输出 `apps/web/dist/`。
5. 把 `index.html` 复制成 `404.html`，再检查产物。
6. 用 `actions/deploy-pages` 发到 GitHub Pages。

`404.html` 是为了让 `/photos/:id` 这种直接链接还能打开单页应用。GitHub Pages 对这个地址返回的 HTTP 状态仍然是 404，这是静态 Pages 的限制，不是照片丢了。

确认：

- Actions 里 build 和 deploy 都成功
- `https://photos.wutongyu.site/` 打开的是相册，不是文档站或上游落地页
- 原图来自 `images.wutongyu.site`，不是 S3 API 域名

只把照片传进 R2，网页不会变。清单是构建时生成的。加完照片后，再手动运行一次这个工作流，或者往 `main` 推一次。

工作流没有保留照片处理缓存。每次发布都会重新扫描桶里的照片。

## 本地先看一眼

```bash
pnpm --filter '@afilmory/web...' --filter '@afilmory/monorepo...' install --frozen-lockfile
pnpm build:manifest -- --no-ui
pnpm --filter @afilmory/web dev
```

开发地址是 `http://localhost:1924`。安装时如果还没有 `config.json` 和 `builder.config.ts`，`scripts/preinstall.sh` 会从 `config.example.json` 和 `builder.config.default.ts` 复制。这两份副本被 Git 忽略，而且已经存在时不会被覆盖。

CI 每次都是空目录，所以线上用的是提交里的模板。本地如果早就复制过，模板改了之后要自己同步这两份，否则本地和发布用的不是同一份配置。

## 同步上游

可以在 GitHub 上同步，但只在它能自动完成时才行。完成之后也不用再去 Cloudflare 或 Pages 设置里点一次部署。推到 `main` 就会发布。现在这次不行。

### 按钮什么时候够用

仓库首页的 Sync fork / Update branch，只在 GitHub 能自己更新默认分支时有用：

- 能快进：你的 `main` 没有自己的提交，按钮把上游提交接到后面。
- 分叉了但没有冲突：按钮做一个合并提交，写进 `main`。

这两种都会产生一次到 `main` 的推送。工作流监听的就是 `main`，所以按钮成功的那一刻，**Deploy YuPhotos to GitHub Pages** 会自己开始。这就是重新部署。不需要再配 R2、DNS、密钥或自定义域名。

要看的是这次 Actions。构建失败时，deploy 不会跑，线上仍是上一次成功的版本。

### 现在为什么不能只点按钮

写这篇文章时，`main` 比上游多 4 个提交、少 13 个提交。多出来的是部署配置，不是上游已经有的功能。少的 13 个里有查看器、HEIC、依赖和构建改动。

我在本地对 `upstream/main` 做了合并试算，没有改工作区。结果合并不干净，所以网页上的同步按钮完不成，`main` 不会变，Actions 也不会跑。

冲突只有工作流：

- `.github/workflows/build.yml` 内容冲突。我们的文件名叫 **Deploy YuPhotos to GitHub Pages**，负责发布相册。上游同名文件叫 **Build**，是测试工作流。不能收成上游那份，否则 `main` 上的推送不再发布相册。
- 四个我们删掉、上游后来又改过的工作流：`docs.yml`、`site.yml`、`core-image.yml`、`mobile-testflight.yml`。

其中 `docs.yml` 不能加回来。它在 `main` 推送时把文档站发到同一个 GitHub Pages 环境，而且没有「只在上游仓库运行」的判断。加回来之后，一次推送可能把 [photos.wutongyu.site](https://photos.wutongyu.site/) 换成文档站。

`site.yml` 和 `core-image.yml` 限定在 `Afilmory/afilmory`，加回来也不会在这个 fork 上跑，但它们不是相册发布的一部分。`mobile-testflight.yml` 只在 `mobile-v*` 标签上跑。这四个都保持删除。

这次试算里，站点地址和图片域名没有被自动合并改掉：`config.example.json` 仍是 `https://photos.wutongyu.site/`，builder 仍读 `S3_BUCKET_NAME`，图片域名仍是 `https://images.wutongyu.site`。下次上游如果改了同一处，以合并后的 diff 为准，不要沿用这句话。

### 正确的同步

在 YuPhotos 仓库里：

```bash
git fetch upstream
git switch main
git pull --ff-only origin main
git switch -c sync/afilmory
git merge upstream/main
```

出现冲突后，发布工作流整份保留我们的，四个已删工作流继续删。合并进行中时，`--ours` 是当前分支，不是上游。

```bash
git checkout --ours -- .github/workflows/build.yml
git add .github/workflows/build.yml
git rm -f \
  .github/workflows/docs.yml \
  .github/workflows/site.yml \
  .github/workflows/core-image.yml \
  .github/workflows/mobile-testflight.yml
```

然后看完整 diff，至少核对这几处仍是自己的部署，而不是上游默认值：

- `builder.config.default.ts` 的桶、区域、`images.wutongyu.site`
- `config.example.json` 的站名和 `photos.wutongyu.site`
- `.github/workflows/build.yml` 的名字仍是 Deploy YuPhotos to GitHub Pages，步骤里仍有 `pnpm build:manifest`、Vite 构建和 `deploy-pages`

没有冲突标记，不代表语义没变。确认后再提交，推送这个分支，向 `main` 开 Pull Request。

先不要直接推 `main`。PR 合并进 `main` 的那一次推送，会自动开始发布。合并前工作流还是旧的，线上也不会变。

```bash
git push -u origin sync/afilmory
```

### 同步之后要不要重新部署

要重新构建网页，但不是再手工配一遍。

| 要不要重做 | 内容 |
| --- | --- |
| 不用 | R2 桶、桶里已有的照片、`images` 自定义域名、CORS、只读凭据 |
| 不用 | GitHub 的 Variables / Secrets、`photos` 的 CNAME、Pages 自定义域名和 HTTPS |
| 会自动发生 | PR 合并到 `main` 后，Actions 重新扫桶、重新生成清单和缩略图、发布 `apps/web/dist/` |
| 必须看结果 | Actions 失败时不要当已经上线。上一次成功的 Pages 版本还在 |
| 仅上传新照片 | 不自动更新网页。传完后手动运行 **Deploy YuPhotos to GitHub Pages**，或再推一次 `main` |

密钥改了也不用为了「刷新环境变量」空提交一次。手动重跑工作流会读当前的 Secrets 和 Variables。代码没变、只是加了照片时，同样手动跑这一次就够。

本地已有的 `config.json` 和 `builder.config.ts` 不会被安装脚本覆盖。模板在同步里变了的话，本地这两份要自己更新。CI 不用做这件事，它每次从模板重新复制。

当前线上首页由 GitHub Pages 返回，产物的 Last-Modified 是 2026-10-01。那次之后还没有新的成功发布。所以上游那 13 个提交现在不在线上，要点完上面的合并，并看到 Actions 成功，相册代码才会更新。
