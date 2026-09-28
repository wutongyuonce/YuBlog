import type { AtRule, ChildNode } from 'postcss'

/**
 * KaTeX 的 CSS 为每个字体声明 woff2 / woff / ttf 三种格式，而访客只会取 woff2。
 * 另两种格式会在产物里多出约 800 KiB。
 *
 * 这个 PostCSS 插件在 Vite 生成 CSS 产物之前裁：只保留 KaTeX 自己的 @font-face
 * 里的 woff2 源。于是 Vite 既不会复制 woff / ttf，CSS 文件名的哈希也是在裁剪后的
 * 内容上算出来的。
 *
 * 挂在 `vite.css.postcss.plugins`（见 astro.config.ts）：Vite 会先内联
 * `@import 'katex/dist/katex.min.css'`，所以插件能看到 KaTeX 的规则。
 */
export function katexWoff2Only() {
  // KaTeX 里多数写法是 `font-family:KaTeX_Main`，但 SansSerif 带引号：
  // `font-family:"KaTeX_SansSerif"`，所以去掉引号后再匹配。
  const isKatexFontFace = (rule: AtRule) =>
    rule.nodes?.some(
      (node: ChildNode) =>
        node.type === 'decl' &&
        node.prop === 'font-family' &&
        /^["']?KaTeX_/.test(node.value.trim())
    ) === true

  return {
    postcssPlugin: 'katex-woff2-only',
    Once(root: {
      walkAtRules: (name: string, cb: (rule: AtRule) => void) => void
    }) {
      root.walkAtRules('font-face', (rule: AtRule) => {
        if (!isKatexFontFace(rule)) return

        rule.walkDecls('src', (decl: { value: string }) => {
          // 形如 `url(a.woff2) format("woff2"), url(a.woff) format("woff"), ...`。
          // 按逗号切分再拼回是无损的，即使某个源是含逗号的 data URI。
          const sources = decl.value.split(',')
          const kept = sources.filter(
            (source) => !/format\(["']?(?:woff|truetype)["']?\)/.test(source)
          )

          // 上游已经只发 woff2 时无需改动，不算异常。
          if (kept.length === sources.length) return

          if (kept.length === 0) {
            throw rule.error(
              'katex-woff2-only: 这个 @font-face 没有任何 woff2 源可保留，规则需要更新。'
            )
          }

          decl.value = kept.join(',')
        })
      })
    },
  }
}

katexWoff2Only.postcss = true
