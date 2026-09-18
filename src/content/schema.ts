import { z } from 'astro:content' // 导入 Zod 验证库
import type { SchemaContext } from 'astro:content' // 导入类型定义

/* =====================================================
   文章 Schema - 用于博客文章
   ===================================================== */
const isTitleImagePath = (value: string) => {
  if (value === '') return true

  let decodedValue: string
  try {
    decodedValue = decodeURIComponent(value)
  } catch {
    return false
  }

  if (value !== decodedValue || !value.startsWith('/blog-title-images/'))
    return false

  const segments = value.split('/').slice(2)
  return (
    segments.length > 0 &&
    segments.every(
      (segment) => segment !== '' && segment !== '.' && segment !== '..'
    ) &&
    !value.includes('\\') &&
    !/[?#\\\s]/.test(value)
  )
}

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

      category: z.enum(['技术向', '工具向']).default('技术向'),

      // 标签列表
      tags: z
        .array(z.string()) // 字符串数组
        .default([])
        .describe('文章标签。不需要时留空数组或删除。'),

      // 封面图片
      // 接收一个 SchemaContext 类型的参数
      // 从中解构出 image 函数
      // 用 image() 创建一个验证器，用于验证本地图片路径
      // 允许 cover 字段接受本地图片路径或远程 URL
      cover: z
        .union([image(), z.string().url()])
        .default('')
        .describe('封面图片。可以是 URL 或当前目录的相对路径。不需要时留空。'),

      // 封面图片的 alt 文本（无障碍访问）
      coverAlt: z
        .string()
        .default('')
        .describe('封面图片的 alt 文本。不需要时留空。'),

      // 标题图片（存放在 public/blog-title-images 下）
      titleImage: z
        .string()
        .default('')
        .refine(
          isTitleImagePath,
          '标题图片必须使用不包含 .. 或特殊字符的 /blog-title-images/ 路径。'
        )
        .describe(
          '可选。标题块背景图片，使用 /blog-title-images/ 下的绝对路径。'
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

      // 最后修改日期（可选）
      lastModDate: z
        .union([z.coerce.date(), z.literal('')]) // 可以是日期或空字符串
        .optional()
        .describe('最后修改日期。不需要时留空。'),

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
        .union([z.string().url('无效的 URL 格式。'), z.literal('')])
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
    .string()
    .url('无效的 URL 格式。') // 必须是有效的 URL
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
        '格式示例：i-logos-vue、i-ri:twitter-fill\n' +
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
    .string()
    .url('无效的 URL 格式。')
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
    .string()
    .describe('**必填**。友链所属分组。')
    .transform((value) => value.trim()),

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

/* =====================================================
   Insight Schema - 用于语录/启发/哲理内容
   ===================================================== */
export const insightSchema = z.object({
  title: z
    .string()
    .describe('**必填**。Insight 标题。')
    .transform((value) => value.trim()),

  description: z
    .string()
    .default('')
    .describe('简短描述，用于 SEO 或列表摘要。')
    .transform((value) => value.trim()),

  pubDate: z.coerce.date().describe('**必填**。Insight 的记录日期。'),

  category: z
    .string()
    .describe('**必填**。Insight 的分类标签。')
    .transform((value) => value.trim()),

  image: z
    .string()
    .default('')
    .describe(
      'Insight 右侧展示图片，使用 /public 下的路径。为空表示不展示图片。'
    )
    .transform((value) => value.trim()),

  imageAlt: z
    .string()
    .default('')
    .describe('图片的替代文本。无图时可留空。')
    .transform((value) => value.trim()),

  author: z
    .string()
    .default('')
    .describe('语录或观点的作者。为空表示不标注作者。')
    .transform((value) => value.trim()),

  sourceUrl: z
    .union([z.string().url('无效的 URL 格式。'), z.literal('')])
    .default('')
    .describe('语录来源链接。为空表示不提供来源链接。'),

  draft: z
    .boolean()
    .default(false)
    .describe('标记为草稿。true 时仅在开发环境可见，生产构建时会被排除。'),
})

export const aboutSchema = z.object({
  title: z
    .string()
    .describe('标签按钮上的名字。intro 可随便填。')
    .transform((value) => value.trim()),
  order: z.number().default(0).describe('标签排序，数值越小越靠前。'),
  tab: z.boolean().default(true).describe('false 时作为关于页顶部介绍，不进标签栏。'),
})
