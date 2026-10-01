import type { Site, Ui, Features } from './types'

export const SITE: Site = {
  website: 'https://www.wutongyu.site/',
  base: '/',
  title: 'Wutong Yu',
  description: 'WutongRain 的技术文章、工具笔记与项目记录。',
  socialImage: '/og/default.png',
  socialImageAlt: '梧桐雨 · 技术文章与工具笔记',
  author: 'Wutong Yu',
  lang: 'zh-CN',
  imageDomains: [],
}

export const AUTHOR_LINKS = [
  {
    label: 'GitHub',
    href: 'https://github.com/wutongyuonce',
    icon: 'i-uil-github-alt',
  },
  {
    label: 'X',
    href: 'https://x.com/Yu2002964143523',
    icon: 'i-simple-icons-x',
  },
  {
    label: 'Instagram',
    href: 'https://www.instagram.com/wutongyu0730',
    icon: 'i-simple-icons-instagram',
  },
  {
    label: 'Bilibili',
    href: 'https://space.bilibili.com/521627597',
    icon: 'i-simple-icons-bilibili',
  },
  {
    label: '小红书',
    href: 'https://www.xiaohongshu.com/user/profile/64842572000000001f005e63',
    icon: 'i-simple-icons-xiaohongshu',
  },
  { label: '邮箱', href: 'mailto:18896680730@163.com', icon: 'i-ri-mail-line' },
]

export const MORE_LINKS = [
  {
    title: '友链',
    description: '推荐与双向友链',
    href: '/friends/',
    icon: 'i-ri-links-line',
    external: false,
  },
  {
    title: '相册',
    description: '光影与日常',
    href: 'https://example.com/album/',
    icon: 'i-ri-image-line',
    external: true,
  },
]

export const UI: Ui = {
  internalNavs: [
    {
      path: '/blogs/',
      title: '文稿',
      displayMode: 'alwaysText',
      text: '文稿',
    },
    {
      path: '/tags',
      title: '标签',
      displayMode: 'alwaysText',
      text: '标签',
    },
    {
      path: '/archives',
      title: '归档',
      displayMode: 'alwaysText',
      text: '归档',
    },
    {
      path: '/interests/',
      title: '拾趣',
      displayMode: 'alwaysText',
      text: '拾趣',
    },
    {
      path: '/projects',
      title: '项目',
      displayMode: 'alwaysText',
      text: '项目',
    },
    {
      path: '/about',
      title: '关于',
      displayMode: 'alwaysText',
      text: '关于',
    },
    {
      path: '/friends',
      title: '更多',
      displayMode: 'alwaysText',
      text: '更多',
    },
  ],
  socialLinks: [
    {
      link: 'https://github.com/wutongyuonce/YuBlog',
      title: 'GitHub',
      displayMode: 'alwaysIcon',
      icon: 'i-uil-github-alt',
    },
  ],
  navBarLayout: {
    left: ['internalNavs'],
    right: ['socialLinks', 'searchButton', 'themeButton'],
  },
  postView: {
    postMetaStyle: 'minimal',
  },
  groupView: {
    maxGroupColumns: 3,
    showGroupItemColorOnHover: true,
  },
  externalLink: {
    newTab: false,
    cursorType: '',
    showNewTabIcon: false,
  },
}

/**
 * Globally controls whether to enable special features:
 *  - Set to `false` or `[false, {...}]` to disable the feature.
 *  - Set to `[true, {...}]` to enable and configure the feature.
 */
export const FEATURES: Features = {
  slideEnterAnim: [true, { enterStep: 60 }],
  toc: [
    true,
    {
      minHeadingLevel: 2,
      maxHeadingLevel: 4,
      displayPosition: 'right',
    },
  ],
  search: [
    true,
    {
      includes: ['blogs'],
      filter: false,
      navHighlight: true,
      batchLoadSize: [true, 5],
      maxItemsPerPage: [true, 3],
    },
  ],
}

/** Dropdown icons also feed UnoCSS's dynamic-class safelist. */
export const INTEREST_ICONS: Record<string, string> = {
  device: 'i-ri-computer-line',
  anime: 'i-ri-sparkling-line',
  movie: 'i-ri-film-line',
  tv: 'i-ri-tv-line',
  game: 'i-ri-gamepad-line',
  book: 'i-ri-book-open-line',
  kpop: 'i-ri-music-2-line',
}
