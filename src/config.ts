import type { Site, Ui, Features } from './types'

export const SITE: Site = {
  website: 'https://www.wutongyu.site/',
  base: '/',
  title: 'Wutong Yu',
  description:
    'A streamlined Astro Antfu-style site with blog, projects, search, and theme switching.',
  author: 'Wutong Yu',
  lang: 'en',
  imageDomains: [],
}

export const UI: Ui = {
  internalNavs: [
    {
      path: '/',
      title: 'Home',
      displayMode: 'alwaysText',
      text: 'Home',
    },
    {
      path: '/blogs',
      title: 'Blog',
      displayMode: 'alwaysText',
      text: 'Blogs',
    },
    {
      path: '/projects',
      title: 'Projects',
      displayMode: 'alwaysText',
      text: 'Projects',
    },
    {
      path: '/insights',
      title: 'Insights',
      displayMode: 'alwaysText',
      text: 'Insights',
    },
    {
      path: '/friends',
      title: 'Friends',
      displayMode: 'alwaysText',
      text: 'Friends',
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
      link: 'https://www.xiaohongshu.com/user/profile/64842572000000001f005e63',
      title: 'Xiaohongshu',
      displayMode: 'alwaysIcon',
      icon: 'i-simple-icons-xiaohongshu',
    },
  ],
  navBarLayout: {
    left: [],
    right: [
      'internalNavs',
      'hr',
      'socialLinks',
      'hr',
      'searchButton',
      'themeButton',
    ],
    mergeOnMobile: true,
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
