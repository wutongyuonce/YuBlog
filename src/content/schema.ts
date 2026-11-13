import { z } from 'astro/zod' // 导入与 Astro 同版本的 Zod 验证库
import type { SchemaContext } from 'astro:content'

import { CLOCK_TIME, ROUTE_MODES, SCHEDULED_MODES } from '../utils/trips.js'

/* =====================================================
   文章 Schema - 用于博客文章
   ===================================================== */

/**
 * Astro 注入的图片助手：把相对图片路径解析成 ImageMetadata。
 *
 * 图片助手只能从 schema 工厂函数的参数取得，不能从 `astro:content` 导入。
 */
export const postSchema = ({ image }: SchemaContext) =>
  z
    .object({
      // 文章标题（必填，最多60字符）
      title: z
        .string()
        .max(60) // SEO 最佳实践建议60字符以内
        .describe(
          '**必填**。文章标题，限制 **60 字符**。遵循 Moz 的建议，确保 90% 的标题在搜索结果中正常显示。'
        )
        .transform((value) => value.trim()), // 自动去除首尾空格

      // 文章副标题
      subtitle: z
        .string()
        .default('')
        .describe('文章副标题。不需要时留空或删除。')
        .transform((value) => value.trim()),

      // SEO 描述
      description: z
        .string()
        .default('')
        .describe('简短描述，用于 SEO 和分享。不需要时使用站点默认描述。')
        .transform((value) => value.trim()),

      category: z
        .string()
        .trim()
        .min(1, '文章分类不能为空。')
        .describe('文章分类。必填，任意非空字符串。'),

      // 标签列表
      tags: z
        .array(z.string()) // 字符串数组
        .default([])
        .describe('文章标签。不需要时留空数组或删除。'),

      // 标题图片（存放在 src/content/blogs/_title-images 下，写成相对路径）
      titleImage: image()
        .optional()
        .describe(
          '可选。标题块背景图片。用相对于本文件的路径，例如 `./_title-images/foo.webp`。'
        ),

      // 标题图片的 alt 文本（无障碍访问）
      titleImageAlt: z
        .string()
        .default('')
        .describe('标题图片的 alt 文本。不需要时留空。')
        .transform((value) => value.trim()),

      // 发布日期（必填）
      pubDate: z.coerce
        .date() // z.coerce 会自动转换各种日期格式
        .describe('**必填**。发布日期。'),

      // 最后修改日期（可选；未填时文章页「更新于」显示与发布日相同）
      lastModDate: z
        .union([z.coerce.date(), z.literal('')]) // 可以是日期或空字符串
        .optional()
        .describe('最后修改日期。可选；不填时文章页「更新于」与发布日一致。'),

      // 预计阅读时间
      minutesRead: z
        .union([z.number(), z.boolean()])
        .default(true)
        .describe(
          '预计阅读时间（分钟）。\n' +
            '- true：自动计算\n' +
            '- false/0：隐藏不显示'
        ),

      // 是否包含音频内容
      radio: z
        .boolean()
        .default(false)
        .describe('是否包含音频内容。如果为 true，文章列表项会显示音频图标。'),

      // 是否包含视频内容
      video: z
        .boolean()
        .default(false)
        .describe('是否包含视频内容。如果为 true，文章列表项会显示视频图标。'),

      // 音视频发布平台
      platform: z
        .string()
        .default('')
        .describe(
          '音视频内容的发布平台名称（如 YouTube、Spotify）。不需要时留空。'
        ),

      // 是否生成目录（Table of Contents）
      toc: z.boolean().default(true).describe('是否为文章生成目录。'),

      // 是否支持搜索
      search: z
        .boolean()
        .default(true)
        .describe('文章是否可被搜索。false 时会从搜索结果中排除。'),

      // 重定向 URL
      redirect: z
        .union([z.url({ error: '无效的 URL 格式。' }), z.literal('')])
        .default('')
        .describe('设置重定向目标 URL。不需要时留空。'),

      // 草稿状态
      draft: z
        .boolean()
        .default(false)
        .describe('标记为草稿。true 时仅在开发环境可见，生产构建时会被排除。'),
    })
    .superRefine((data, context) => {
      if (data.titleImage && !data.titleImageAlt.trim()) {
        context.addIssue({
          code: 'custom',
          path: ['titleImageAlt'],
          message: '配置 titleImage 时必须填写 titleImageAlt。',
        })
      }
    })

/* =====================================================
   项目 Schema - 用于作品集/项目展示
   ===================================================== */
export const projectSchema = z.object({
  // 项目 ID/名称（必填）
  id: z.string().describe('**必填**。要显示的项目名称。'),

  // 项目链接（必填）
  link: z
    .url({ error: '无效的 URL 格式。' }) // 必须是有效的 URL
    .describe('**必填**。项目页面或仓库的链接。'),

  // 项目描述（必填）
  desc: z.string().describe('**必填**。项目简短描述。'),

  // 图标
  icon: z
    .string()
    .regex(
      /^i-[\w-]+(:[\w-]+)?$/,
      '图标格式必须为 `i-<collection>-<icon>` 或 `i-<collection>:<icon>`，遵循 UnoCSS 规范。'
    )
    .describe(
      '**可选**。项目图标，遵循 UnoCSS 图标规范。' +
        '格式示例：i-ri-github-line、i-simple-icons-x（现役主用 ri + simple-icons + uil）\n' +
        '可用的图标：https://icones.js.org/'
    )
    .optional(),

  // 项目分类（必填）
  category: z.string().describe('**必填**。项目的分类。'),
})

/* =====================================================
   Friend Schema - 用于友链展示
   ===================================================== */
export const friendSchema = z.object({
  id: z
    .string()
    .describe('**必填**。友链唯一标识，用于数据维护。')
    .transform((value) => value.trim()),

  name: z
    .string()
    .describe('**必填**。站点名称。')
    .transform((value) => value.trim()),

  link: z
    .url({ error: '无效的 URL 格式。' })
    .describe('**必填**。友链站点地址。'),

  avatar: z
    .string()
    .default('')
    .describe('头像图片地址。支持 https URL 或 /public 下的绝对路径。')
    .transform((value) => value.trim()),

  desc: z
    .string()
    .describe('**必填**。站点简介。')
    .transform((value) => value.trim()),

  category: z
    .enum(['推荐', '双向'])
    .describe('**必填**。推荐为单向收藏，双向为已交换友链的站点。'),

  siteLabel: z
    .string()
    .default('')
    .describe('补充说明，用于展示更轻的描述标签。')
    .transform((value) => value.trim()),

  order: z
    .number()
    .int()
    .default(999)
    .describe('同组内排序值，数值越小越靠前。'),
})

export const aboutSchema = z.object({
  title: z
    .string()
    .describe('介绍文档的标题；页面页头由路由提供。')
    .transform((value) => value.trim()),
})

/** Content-driven interest sections; their metadata also drives the navigation menu. */
export const interestSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().trim().min(1),
  order: z.number().int().nonnegative(),
})

/** `interests/<id>/<tab>.md`: one tab of a tabbed interest page; title is the tab label. */
export const interestTabSchema = z.object({
  title: z.string().trim().min(1),
  order: z.number().int().nonnegative(),
})

/* =====================================================
   旅行 Schema - `src/data/trips/<id>/trip.json`，由导入脚本生成
   ===================================================== */
const isoDate = z.iso.date({ error: '日期必须是 YYYY-MM-DD。' })
const clockTime = z.string().regex(CLOCK_TIME, '时间必须是 HH:mm。')
/** WGS84 `[经度, 纬度]`。 */
const lngLat = z.tuple([
  z.number().min(-180).max(180),
  z.number().min(-90).max(90),
])
const optionalText = z.string().trim().min(1).optional()

/** 两站之间的一段路：方式、里程、路径，以及班次或公交明细。 */
const tripRoute = z
  .object({
    mode: z.enum(ROUTE_MODES),
    /** 米。 */
    distance: z.number().nonnegative(),
    /** 秒。 */
    duration: z.number().nonnegative().optional(),
    /** 本该有路线却没有取到，路径是两点直线、里程按直线计；班次本来就画直线，不标。 */
    straight: z.literal(true).optional(),
    path: z.array(lngLat).min(2),
    /** 飞机、火车、船的班次。 */
    service: z
      .object({
        number: optionalText,
        depart: clockTime.optional(),
        arrive: clockTime.optional(),
      })
      .optional(),
    /** 公共交通的乘坐明细。 */
    transit: z
      .object({
        fare: optionalText,
        lines: z
          .array(
            z.object({
              name: z.string().trim().min(1),
              from: optionalText,
              to: optionalText,
              stops: z.number().int().positive().optional(),
            })
          )
          .min(1),
      })
      .optional(),
  })
  .superRefine((route, ctx) => {
    if (route.service && !SCHEDULED_MODES.has(route.mode))
      ctx.addIssue({
        code: 'custom',
        path: ['service'],
        message: '只有飞机、火车、船有班次。',
      })
    if (route.transit && route.mode !== 'transit')
      ctx.addIssue({
        code: 'custom',
        path: ['transit'],
        message: '只有公共交通有乘坐明细。',
      })
  })

export const tripSchema = ({ image }: SchemaContext) =>
  z
    .object({
      title: z.string().trim().min(1),
      start: isoDate,
      end: isoDate,
      /** 封面候选，按优先级排列；拼图规则见 `src/utils/trips.js`。 */
      cover: z.array(image()).default([]),
      days: z
        .array(
          z.object({
            date: isoDate,
            summary: optionalText,
            stops: z.array(
              z.object({
                name: z.string().trim().min(1),
                category: optionalText,
                emoji: optionalText,
                address: optionalText,
                coordinates: lngLat,
                time: z
                  .object({
                    start: clockTime.optional(),
                    end: clockTime.optional(),
                  })
                  .optional(),
                note: optionalText,
                photos: z.array(image()).default([]),
                /** 去往下一站；最后一站没有。 */
                route: tripRoute.optional(),
              })
            ),
          })
        )
        .min(1),
    })
    .superRefine((trip, ctx) => {
      const dates = trip.days.map((day) => day.date)
      if (dates.some((date, index) => index > 0 && date <= dates[index - 1]))
        ctx.addIssue({
          code: 'custom',
          path: ['days'],
          message: 'days 必须按日期递增且不重复。',
        })
      if (trip.start !== dates[0] || trip.end !== dates.at(-1))
        ctx.addIssue({
          code: 'custom',
          path: ['start'],
          message: 'start／end 必须等于第一天和最后一天。',
        })
    })
