import { visit } from 'unist-util-visit'  // 遍历 AST 树节点的工具函数

// ==================== Remark 插件（Markdown → MDAST） ====================
import remarkCjkFriendly from 'remark-cjk-friendly'      // CJK 标点旁的 **加粗**（Typora 能渲染，CommonMark 默认不能）
import remarkDirective from 'remark-directive'           // 支持通用指令语法（::name, :name）
import remarkDirectiveSugar from 'remark-directive-sugar' // 提供 :badge、:link、:image 等内置指令
import remarkMath from 'remark-math'                     // 解析数学公式（$...$ 和 $$...$$）
import remarkReadingTime from './remark-reading-time'    // 计算文章阅读时间（自定义）

// ==================== Rehype 插件（MDAST → HTML） ====================
import { rehypeHeadingIds } from '@astrojs/markdown-remark' // 为标题自动添加 ID
import rehypeCallouts from 'rehype-callouts'               // 创建提示框/标注（注、警告等）
import rehypeKatex from 'rehype-katex'                     // 渲染数学公式（LaTeX → HTML）
import rehypeExternalLinks from 'rehype-external-links'    // 处理外部链接（新窗口、图标等）
import rehypeAutolinkHeadings from 'rehype-autolink-headings' // 标题自动添加锚点链接
import rehypeWrapAll from './rehype-wrap-all'              // 用 div 包裹指定元素

import { UI } from '../src/config'                          // 导入项目配置

import type { RemarkPlugins, RehypePlugins } from 'astro'
import type { PropertiesFromTextDirective } from 'remark-directive-sugar'
import type { Text } from 'mdast'
import type { Element as HastElement, Properties as HastProperties } from 'hast'
import type { BuildProperties } from 'rehype-autolink-headings'
import type { CreateContent, CreateProperties } from 'rehype-external-links'

const linkImgProps: PropertiesFromTextDirective = (node) => {
  const props: HastProperties = { 'aria-hidden': 'true' }

  if (node.attributes?.class?.includes('github'))
    props.src = 'https://github.githubassets.com/favicons/favicon.svg'

  return props
}

const externalLinkContent: CreateContent = (el) => {
  // 如果没开启新标签页或不需要图标，返回 null
  if (!UI.externalLink.newTab || !UI.externalLink.showNewTabIcon) return null

  // 检测链接内是否包含图片（避免影响图片链接）
  let hasImage = false
  visit(el, 'element', (childNode: HastElement) => {
    if (childNode.tagName === 'img') {
      hasImage = true
      return false
    }
  })
  if (hasImage) return null

  // 返回空文本（实际图标由 CSS 类生成）
  return { type: 'text', value: '' }
}

const externalLinkContentProperties: CreateProperties = (el) => {
  if (!UI.externalLink.newTab || !UI.externalLink.showNewTabIcon) return null

  let hasImage = false
  visit(el, 'element', (childNode: HastElement) => {
    if (childNode.tagName === 'img') {
      hasImage = true
      return false
    }
  })
  if (hasImage) return null

  return {
    'u-i-carbon-arrow-up-right': true,  // 使用 Carbon 图标集
    className: ['new-tab-icon'],        // 添加 CSS 类
    'aria-hidden': 'true',              // 对屏幕阅读器隐藏
  }
}

const externalLinkProperties: CreateProperties = (el) => {
  const props: HastProperties = {}
  const href = el.properties.href

  if (!href || typeof href !== 'string') return props

  if (UI.externalLink.newTab) {
    props.target = '_blank'                    // 新标签页打开
    props.ariaLabel = 'Open in new tab'        // 无障碍标签

    // 自定义鼠标样式
    if (
      UI.externalLink.cursorType.length > 0 &&
      UI.externalLink.cursorType !== 'pointer'
    ) {
      props.className = Array.isArray(el.properties.className)
        ? [...el.properties.className, 'external-link-cursor']
        : ['external-link-cursor']
    }
  }

  return props
}

const headingAnchorProperties: BuildProperties = (el) => {
  // 提取标题文本内容（用于 aria-label）
  let content = ''
  visit(el, 'text', (textNode: Text) => {
    content += textNode.value
  })

  return {
    className: ['header-anchor'],
    tabIndex: 0,                      // 可用键盘导航
    'aria-hidden': 'false',           // 对屏幕阅读器可见
    'aria-label': content ? `Link to ${content}` : undefined,
    'data-pagefind-ignore': '',       // 排除搜索索引
  }
}

// ==================== 导出 Remark 插件配置 ====================
export const remarkPlugins: RemarkPlugins = [
  // 0. CJK 友好的强调语法（**术语（中文）**后接汉字）
  remarkCjkFriendly,

  // 1. 基础指令支持
  remarkDirective,  // 解析 :::warning 这类自定义指令

  // 2. 指令糖插件（提供开箱即用的指令）
  [
    remarkDirectiveSugar,
    {
      // 2.1 徽章指令
      badge: {
        presets: {
          n: { text: 'NEW' },     // :badge[n] → 显示 NEW
          a: { text: 'ARTICLE' }, // :badge[a] → 显示 ARTICLE
          v: { text: 'VIDEO' },   // :badge[v] → 显示 VIDEO
        },
      },
      // 2.2 链接指令（自动添加网站图标）
      link: {
        // 从 Google 服务获取网站 favicon
        faviconSourceUrl: 'https://icons.duckduckgo.com/ip3/{domain}.ico',
        // 动态设置图片属性
        imgProps: linkImgProps,
      },
      // 2.3 图片指令
      image: {
        stripParagraph: false,  // 保留图片周围的 <p> 标签
      },
    },
  ],

  // 3. 数学公式支持
  remarkMath,  // 解析 $inline$ 和 $$block$$ 语法

  // 4. 阅读时间计算
  remarkReadingTime,  // 统计文章字数，计算预计阅读时间

]

// ==================== 导出 Rehype 插件配置 ====================
export const rehypePlugins: RehypePlugins = [
  // 1. 为标题添加 ID（用于锚点链接）
  // 例如：## 标题 → <h2 id="标题">标题</h2>
  [rehypeHeadingIds, { headingIdCompat: true }],

  // 2. 渲染数学公式（使用 KaTeX）
  rehypeKatex,  // 将 LaTeX 公式转换为 HTML/CSS

  // 3. 提示框/标注组件
  [
    rehypeCallouts,
    {
      theme: 'vitepress',  // 使用 VitePress 风格的提示框样式
    },
  ],

  // 4. 外部链接处理
  [
    rehypeExternalLinks,
    {
      // 外部链接是否在新标签页打开
      rel: UI.externalLink.newTab ? 'noopener noreferrer' : [],

      // 链接内容处理（添加新标签图标）
      content: externalLinkContent,

      // 图标元素的属性
      contentProperties: externalLinkContentProperties,

      // 链接元素属性
      properties: externalLinkProperties,
    },
  ],

  // 5. 标题自动添加锚点链接（生成可点击的链接图标）
  [
    rehypeAutolinkHeadings,
    {
      behavior: 'append',  // 在标题内容后追加链接

      // 锚点链接属性
      properties: headingAnchorProperties,

      // 锚点内容（# 符号）
      content: {
        type: 'text',
        value: '#',
      },
    },
  ],

  // 6. 包装表格（使表格可以横向滚动）
  [
    rehypeWrapAll,
    {
      selector: 'table',   // 选择所有 <table> 元素
      wrapper: 'div',      // 用 <div> 包裹
    },
  ],
]
