import type { Site, Ui, Features } from './types'

export const SITE: Site = {
  website: 'https://www.wutongyu.site/',
  base: '/',
  title: 'Wutong Yu',
  description: 'WutongRain 的技术文章、工具笔记与项目记录。',
  author: 'Wutong Yu',
  lang: 'zh-CN',
  imageDomains: [],
}

export const UI: Ui = {
  internalNavs: [
    {
      path: '/',
      title: '首页',
      displayMode: 'alwaysText',
      text: '首页',
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
      title: '友链',
      displayMode: 'alwaysText',
      text: '友链',
    },
  ],
  socialLinks: [
    {
      link: 'https://github.com/wutongyuonce/YuBlog',
      title: 'GitHub',
      displayMode: 'alwaysIcon',
      icon: 'i-uil-github-alt',
    },
    {
      link: 'https://x.com/Yu2002964143523',
      title: 'X',
      displayMode: 'alwaysIcon',
      icon: 'i-simple-icons-x',
    },
    {
      link: 'https://www.instagram.com/wutongyu0730',
      title: 'Instagram',
      displayMode: 'alwaysIcon',
      icon: 'i-simple-icons-instagram',
    },
    {
      link: 'https://space.bilibili.com/521627597',
      title: 'Bilibili',
      displayMode: 'alwaysIcon',
      icon: 'i-simple-icons-bilibili',
    },
    {
      link: 'https://www.xiaohongshu.com/user/profile/64842572000000001f005e63',
      title: 'Xiaohongshu',
      displayMode: 'alwaysIcon',
      icon: 'i-simple-icons-xiaohongshu',
    },
  ],
  navBarLayout: {
    left: ['internalNavs'],
    right: ['socialLinks', 'hr', 'searchButton', 'themeButton'],
    mergeOnMobile: false,
  },
  postView: {
    postMetaStyle: 'minimal',
    useCoverAltAsCaption: true,
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
      displayMode: 'content',
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
