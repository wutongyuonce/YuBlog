import {
  defineConfig,
  presetWind3,
  presetAttributify,
  presetIcons,
  transformerDirectives,
  transformerVariantGroup,
} from 'unocss'

import { UI } from './src/config'
import projecstData from './src/content/projects/data.json'

import type {
  IconNavItem,
  ResponsiveNavItem,
  IconSocialItem,
  ResponsiveSocialItem,
} from './src/types'

const { internalNavs, socialLinks } = UI
const navIcons = internalNavs
  .filter(
    (item) =>
      item.displayMode !== 'alwaysText' &&
      item.displayMode !== 'textHiddenOnMobile'
  )
  .map((item) => (item as IconNavItem | ResponsiveNavItem).icon)
const socialIcons = socialLinks
  .filter(
    (item) =>
      item.displayMode !== 'alwaysText' &&
      item.displayMode !== 'textHiddenOnMobile'
  )
  .map((item) => (item as IconSocialItem | ResponsiveSocialItem).icon)

const projectIcons = (projecstData as { icon?: string }[])
  .map((item) => item.icon)
  .filter((icon): icon is string => Boolean(icon))

export default defineConfig({
  // Astro 5 no longer pipes `src/content/**/*.{md,mdx}` through Vite
  content: {
    filesystem: ['./src/{content,pages,layouts}/**/*.{md,mdx,astro}'],
  },

  // will be deep-merged to the default theme
  extendTheme: (theme) => {
    const current = theme as {
      breakpoints?: Record<string, string>
      fontFamily?: Record<string, string>
    }
    return {
      ...theme,
      breakpoints: {
        ...current.breakpoints,
        lgp: '1128px',
      },
      fontFamily: {
        ...current.fontFamily,
        sans: 'Inter, ui-sans-serif, system-ui, sans-serif',
        mono: '"DM Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        condensed: 'ui-sans-serif, system-ui, sans-serif',
      },
    }
  },

  // define utility classes and the resulting CSS
  rules: [],

  // combine multiple rules as utility classes
  shortcuts: [
    [
      /^(\w+)-transition(?:-(\d+))?$/,
      (match) =>
        `transition-${match[1] === 'op' ? 'opacity' : match[1]} duration-${match[2] ? match[2] : '300'} ease-in-out`,
    ],
    [
      /^shadow-custom_(-?\d+)_(-?\d+)_(-?\d+)_(-?\d+)$/,
      ([_, x, y, blur, spread]) =>
        `shadow-[${x}px_${y}px_${blur}px_${spread}px_rgba(0,0,0,0.2)] dark:shadow-[${x}px_${y}px_${blur}px_${spread}px_rgba(255,255,255,0.25)]`,
    ],
  ],

  // presets are partial configurations
  presets: [
    presetWind3(),
    presetAttributify({
      strict: true,
      prefix: 'u-',
      prefixedOnly: false,
    }),
    presetIcons({
      extraProperties: {
        'display': 'inline-block',
        'height': '1.2em',
        'width': '1.2em',
        'vertical-align': 'text-bottom',
      },
    }),
  ],

  // provides a unified interface to transform source code in order to support conventions
  transformers: [transformerDirectives(), transformerVariantGroup()],

  // work around the limitation of dynamically constructed utilities
  // https://unocss.dev/guide/extracting#limitations
  safelist: [
    ...navIcons,
    ...socialIcons,
    ...projectIcons,
    'i-simple-icons-instagram',
    'i-simple-icons-bilibili',

    /* BaseLayout */
    'focus:not-sr-only',
    'focus:fixed',
    'focus:start-1',
    'focus:top-1.5',
    'focus:op-20',
    /* Toc */
    'i-ri-menu-2-fill',
    'i-ri-menu-3-fill',
    'i-ri-user-3-line',
    'i-ri-apps-line',
    'i-ri-heart-line',
    'i-ri-ghost-line',

    /* Rose background */
    'z--1',
    'fixed',
    'top-0',
    'bottom-0',
    'left-0',
    'right-0',
    'w-full',
    'h-full',
    'op-50',
    'dark:op-100',
    'pointer-events-none',
    'print:hidden',
    'absolute',
    'w-200px',
    'h-200px',
    'translate--50%',
    'left-50%',
    'transition-transform',
    'duration-50000',
    'ease-[cubic-bezier(0,0,.6,.95)]',
    'origin-bottom-center',
    'before:content-empty',
    'before:absolute',
    'before:w-full',
    'before:h-full',
    'before:rounded-tl-[50%_35%]',
    'before:rounded-br-[35%_50%]',
    'before:rounded-tr-[45%]',
    'before:rounded-bl-[10%]',
    'before:bg-[radial-gradient(ellipse_at_bottom_left,#ffffff_0%,#fefefe_70%,#88888855_95%)]',
    'dark:before:bg-[radial-gradient(ellipse_at_bottom_left,#000000_0%,#000000_70%,#77777755_85%)]',
    'before:transform-rotate-[-45deg]',

    /* StandardLayout (template literal) & ListView (attributify conflict) */
    'mb-10',
    'mb-16',
    'mb-36',
  ],
})
