---
title: Afilmory 相册部署
description: 照片放 Cloudflare R2，网页用 GitHub Pages。第一次部署、加照片、同步上游。
pubDate: 2026-10-21
category: 博客开发
tags: [Afilmory, Cloudflare R2]
titleImage: ./_title-images/afilmory-home.png
titleImageAlt: Afilmory 官网首页截图
toc: true
search: true
draft: false
---

相册仓库是 [YuPhotos](https://github.com/wutongyuonce/YuPhotos)，线上是 [photos.wutongyu.site](https://photos.wutongyu.site/)。上游是 [Afilmory/afilmory](https://github.com/Afilmory/afilmory)。`origin` 指向自己的仓库，`upstream` 指向上游。

照片和网页分开托管。原图放 R2，构建时再生成缩略图和清单，跟网页一起发到 GitHub Pages。

| 地址 | 放什么 | 托管 |
| --- | --- | --- |
| `https://photos.wutongyu.site/` | 网页、缩略图、RSS | GitHub Pages |
| `https://images.wutongyu.site/` | 原图和 Live Photo 视频 | Cloudflare R2 |

## 第一次部署

### 1. 建桶并上传照片

在管理 `wutongyu.site` 的 Cloudflare 账户里开通 R2，建一个 Standard 桶，把要公开的照片传进去。桶名示例是 `yuphotos`。

照片不进 Git。构建脚本只有读权限，上传用 Cloudflare 控制台或自己的工具。

### 2. 挂图片域名

桶的 Settings → Custom Domains 添加 `images.wutongyu.site`，等到 Active。

访客看的原图走这个域名。`https://<账号 ID>.r2.cloudflarestorage.com` 是给构建脚本列文件用的 S3 API，只写进后面的 `S3_ENDPOINT`，不要当成图片地址。

### 3. 设置 CORS

把仓库里的 `r2-cors.json` 贴到这个桶的 CORS。允许这三个来源的 GET 和 HEAD：

- `https://photos.wutongyu.site`
- `http://localhost:1924`
- `http://127.0.0.1:1924`

网页在 `photos`，原图在 `images`，浏览器跨域读取要桶明确允许。本地开发端口是 1924，所以一并写上。

### 4. 建只读凭据

创建限定到这个桶的 Object Read only 凭据。记下桶名、S3 API 地址、Access Key ID、Secret Access Key。不要写进仓库。

构建只用它列出并下载原图，生成清单和缩略图，不需要写桶。

只扫描某个目录时再记一个前缀，例如 `photos/`。留空就扫描整个桶。

### 5. 写入 GitHub Actions

发布时由 GitHub Actions 读这些值去连 R2。仓库 Settings → Secrets and variables → Actions：

| 名称 | 类型 | 内容 |
| --- | --- | --- |
| `S3_BUCKET_NAME` | Variable | 桶名称 |
| `S3_ENDPOINT` | Variable | `https://<账号 ID>.r2.cloudflarestorage.com` |
| `S3_PREFIX` | Variable，可选 | 目录前缀 |
| `S3_ACCESS_KEY_ID` | Secret | Access Key ID |
| `S3_SECRET_ACCESS_KEY` | Secret | Secret Access Key |

密钥放 Secret，避免出现在日志里。区域固定是 `auto`，图片域名固定是 `https://images.wutongyu.site`，已经写在 `builder.config.default.ts`，不用再配。

本地跑同一套构建时，把同一组值写入不提交的 `.env`，字段见 `.env.example`。

### 6. 挂相册域名

Cloudflare DNS 加 `photos` CNAME，目标 `wutongyuonce.github.io`，代理选 DNS only。

这条把相册域名指到 GitHub Pages。DNS only 是为了让 GitHub 自己签发证书，不要开橙云代理。

GitHub 仓库 Settings → Pages：

- 构建来源选 GitHub Actions。产物由工作流上传，不是某个分支上的现成文件
- Custom domain 填 `photos.wutongyu.site`
- 证书可用后打开 Enforce HTTPS

### 7. 发布

Actions 运行 **Deploy YuPhotos to GitHub Pages**。推送到 `main` 也会触发。

这一次会用上面的凭据扫描 R2，生成清单和缩略图，再用 Vite 构建 `apps/web/dist/`，发到 GitHub Pages。

确认 Actions 的 build 和 deploy 都成功，再打开 [photos.wutongyu.site](https://photos.wutongyu.site/)。原图应来自 `images.wutongyu.site`。

直接打开 `/photos/:id` 时，HTTP 状态是 404。工作流把 `index.html` 复制成 `404.html`，Pages 仍会把这个单页应用交给浏览器打开。

## 加照片

照片传到 R2 后，再手动运行一次 **Deploy YuPhotos to GitHub Pages**，或往 `main` 推一次。

网页上的清单是构建时生成的，只上传不会更新线上相册。只改了 Actions 里的密钥时，同样手动重跑这一次，工作流会读当前的 Secrets 和 Variables。

## 本地

```bash
pnpm --filter '@afilmory/web...' --filter '@afilmory/monorepo...' install --frozen-lockfile
pnpm build:manifest -- --no-ui
pnpm --filter @afilmory/web dev
```

第一条只装相册和 builder。第二条用 `.env` 读 R2，生成清单和缩略图。第三条开开发服务器，地址是 `http://localhost:1924`。

安装时如果还没有 `config.json` 和 `builder.config.ts`，会从模板复制一份，之后不会自动覆盖。所以 `config.example.json` 或 `builder.config.default.ts` 改过之后，要自己更新本地这两份。线上每次都是空目录，用的是仓库里的模板。

## 同步上游

在单独分支上把上游合进来，看过 diff 再进 `main`。合进 `main` 会自动发布，所以不要直接在 `main` 上合并。

```bash
git fetch upstream
git switch main
git pull --ff-only origin main
git switch -c sync/afilmory
git merge upstream/main
```

`fetch` 只更新本地的上游引用。后面三条保证从最新的 `main` 拉出分支，再把 `upstream/main` 合并进来。

有冲突时，发布工作流保留当前分支。我们的 `build.yml` 负责把相册发到 GitHub Pages，不能换成上游那份测试工作流。下面四个工作流保持删除，避免合回来之后跟着 `main` 跑别的发布。

```bash
git checkout --ours -- .github/workflows/build.yml
git add .github/workflows/build.yml
git rm -f \
  .github/workflows/docs.yml \
  .github/workflows/site.yml \
  .github/workflows/core-image.yml \
  .github/workflows/mobile-testflight.yml
```

合并进行中时，`--ours` 是当前分支，不是上游。

提交前核对这三处没有被上游默认值盖掉：

- `.github/workflows/build.yml` 的名字仍是 Deploy YuPhotos to GitHub Pages，步骤里仍有 `pnpm build:manifest`、Vite 构建和 `deploy-pages`
- `builder.config.default.ts` 的图片域名仍是 `https://images.wutongyu.site`
- `config.example.json` 的地址仍是 `https://photos.wutongyu.site/`

```bash
git push -u origin sync/afilmory
```

向 `main` 开 Pull Request。合并后等 **Deploy YuPhotos to GitHub Pages** 成功，相册代码才算更新。R2、DNS、密钥和自定义域名不用再设。Actions 失败时，线上仍是上一次成功的版本。
