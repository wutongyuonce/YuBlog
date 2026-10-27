# 文档导航

先从 [项目 README](../README.md) 了解页面和功能，再按下面的任务进入详细文档。这里维护当前项目的用法与设计；框架概念笔记单独放在参考资料中。

## 按任务查找

| 我想做什么 | 从这里开始 | 继续阅读 |
| --- | --- | --- |
| 本地运行、预览、部署到自己的域名 | [开发与部署指南](./guides/development.md#local) | [部署](./guides/development.md#deployment)、[SEO 与地址](./design/distribution.md#canonical) |
| 替换作者、导航、头像、备案或外部账号 | [个性化配置](./guides/development.md#personalization) | [外部服务](./guides/development.md#services) |
| 写文章、加拾趣、维护友链或项目 | [内容维护](./guides/development.md#content) | [内容发布 skill](../blog-content-publisher-skill/SKILL.md)、[正文样式指南文章](../src/content/blogs/image-layout-demo.md) |
| 写图片排版、卡片日期、视频或绘图 | [正文与媒体](./design/content.md) | [源码与管线](./design/content.md#pipeline)、[组件验证](./design/content.md#verification) |
| 理解一个页面应如何工作 | [站点与页面](./design/site.md) | [模块属主](./design/architecture.md#ownership) |
| 修改导航、分类筛选、分页或上下篇 | [页面契约](./design/site.md#browsing) | [上下篇与随便逛逛](./design/site.md#post-navigation)、[实现边界](./design/architecture.md#boundaries) |
| 改样式、目录、主题、搜索或评论 | [架构与模块边界](./design/architecture.md) | [视觉约束](./design/site.md#visuals)、[评论](./design/site.md#comments) |
| 确认 RSS 会显示什么、换域名有什么影响 | [SEO 与全文订阅](./design/distribution.md) | [RSS 内容表达](./design/distribution.md#rss-content)、[验证](./design/distribution.md#verification) |
| 配置首页屏幕时间与本机每日同步 | [ActivityWatch 屏幕时间](./design/screen-time.md) | 本机脚本、公开数据边界与 launchd 任务 |
| 接入或排查首页听歌接口 | [Last.fm 运行时接口与展示](./design/listening.md) | [环境变量与部署](./guides/development.md#services) |
| 开关像素猫、改皮肤或访客隐藏 | [Oneko 像素猫](./design/oneko.md) | [全站功能配置](./guides/development.md#personalization) |
| 跑检查、准备交付 | [检查与验收](./guides/development.md#verification) | 对应设计文档末尾的验证映射 |
| 学习 Astro 组件、插槽和模板语法 | [Astro 学习笔记](./reference/astro.md) | 项目实现以架构文档和源码为准 |

## 文档分工

| 文档 | 负责回答 | 不在这里维护 |
| --- | --- | --- |
| [开发与部署指南](./guides/development.md) | 如何运行、配置、维护内容、部署和验证 | 完整算法及组件状态机 |
| [站点与页面](./design/site.md) | 各页面、导航、筛选、上下篇、目录、主题、评论的用户契约 | 正文组件和订阅的完整规则 |
| [架构与模块边界](./design/architecture.md) | 规则由谁定义、调用链路、改功能应落在哪 | 与专题重复的详细媒体契约 |
| [正文与媒体](./design/content.md) | 图片、卡片、相册、HTML／音视频、绘图与博文卡的写法、设计及资源边界 | 订阅器中的输出策略 |
| [SEO 与全文订阅](./design/distribution.md) | canonical、sitemap、RSS 身份、内容降级、安全及失败语义 | 网站视觉布局 |
| [Last.fm](./design/listening.md) | 运行时接口、缓存、专辑匹配、请求上限和页面状态 | 通用卡片与图片查看器实现 |
| [Oneko](./design/oneko.md) | 可选像素猫的托管集成、开关、换页和许可 | 本站内容与搜索 |
| [Astro 学习笔记](./reference/astro.md) | 框架概念与教学例子 | 当前项目规范或完整官方 API 文档 |

## 目录

```text
docs/
  README.md                 按任务查找文档
  guides/
    development.md          运行、个性化、内容、部署与验证
  design/
    site.md                 站点与页面
    architecture.md         架构与模块边界
    content.md              正文与媒体
    distribution.md         SEO 与全文订阅
    listening.md            Last.fm
    oneko.md                Oneko
  reference/
    astro.md                Astro 学习笔记
  img/                      学习笔记的本地配图
```

## 更新约定

- 先更新功能对应的设计文档及示例，再更新 README 的功能摘要和链接；README 不复制尺寸、状态机和完整参数表。
- 同一规则由一个专题完整解释，其它文档用简短说明和链接；全局模块属主集中在架构文档，专题保留必要的细化职责。
- 当前设计不夹带已经放弃的方案、阶段性报告或某次测试快照。历史变更留在 [CHANGELOG](../CHANGELOG.md) 和 Git；“需要验收”不代表当前线上已经验收。
- 跨专题的同一行为变化，检查代码、测试、专题文档和作者示例是否一起更新。移动文件同时更新相对链接、锚点及源码注释中的入口。
- [内容发布 skill](../blog-content-publisher-skill/SKILL.md) 是可独立分发的包，必要规则须在包内可读，不依赖仓库外部文档。
