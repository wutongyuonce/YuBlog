// Temporary device diagnostics. No theme writes, drawing, timers or uploads.
;(() => {
  const enabled = () =>
    new URL(location.href).searchParams.get('debug-theme') === '1'
  if (!enabled() || window.__themeDiagnostics) return

  const errors = []
  const onError = (event) => {
    const message = event.message || event.target?.src || '资源加载失败'
    errors.push(
      String(message)
        .replace(/https?:\/\/[^\s]+/g, '[URL]')
        .slice(0, 160)
    )
    if (errors.length > 3) errors.shift()
  }
  const onRejection = (event) => onError({ message: String(event.reason) })
  window.addEventListener('error', onError, true)
  window.addEventListener('unhandledrejection', onRejection)

  const panel = document.createElement('section')
  panel.id = 'theme-diagnostics'
  panel.setAttribute('aria-label', '临时主题诊断')
  panel.style.cssText =
    'position:fixed;bottom:8px;left:8px;right:8px;z-index:2147483647;max-height:48vh;overflow:auto;padding:10px;border:1px solid #888;border-radius:6px;background:#fff;color:#111;color-scheme:only light;font:11px/1.45 monospace;box-shadow:0 2px 12px #0004'
  const title = document.createElement('strong')
  title.textContent = '临时诊断 v1 · 只读，不上传数据'
  const output = document.createElement('pre')
  output.style.cssText =
    'margin:6px 0;white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;color:inherit;background:transparent'
  const controls = document.createElement('div')
  controls.style.marginTop = '6px'
  panel.append(title, controls, output)

  const snapshot = () => {
    const root = document.documentElement
    const background = document.querySelector('bg-dot, bg-snow')
    const canvas = background?.querySelector('canvas')
    // Read only the context owned by the background; never create one ourselves.
    const ctx = background?.ctx
    const rootStyle = getComputedStyle(root)
    const bodyStyle = getComputedStyle(document.body)
    const bgStyle = background ? getComputedStyle(background) : null
    let saved
    try {
      saved = localStorage.getItem('theme') ?? '未保存'
    } catch {
      saved = '读取被拒绝'
    }
    let contextLost = '未知'
    try {
      if (typeof ctx?.isContextLost === 'function')
        contextLost = ctx.isContextLost()
    } catch (error) {
      contextLost = `读取失败：${error.name}`
    }
    let pixels = '无已初始化上下文'
    if (ctx && canvas) {
      try {
        const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data
        let count = 0
        const colors = new Set()
        for (let i = 0; i < data.length; i += 4) {
          if (!data[i + 3]) continue
          count++
          if (data[i + 3] > 128 && colors.size < 4)
            colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`)
        }
        pixels = `${count}/${canvas.width * canvas.height} 非透明；RGB ${[...colors].join(' / ') || '无 alpha>128 样本'}`
      } catch (error) {
        pixels = `读取失败：${error.name}`
      }
    }
    const assets = performance
      .getEntriesByType('resource')
      .filter((entry) =>
        /\/(?:Dot\.|theme-observer\.|reduced-motion\.)/.test(
          new URL(entry.name).pathname
        )
      )
      .map(
        (entry) =>
          `${new URL(entry.name).pathname.split('/').pop()} 状态${entry.responseStatus || '未知'} ${Math.round(entry.duration)}ms`
      )
    return [
      `采集时间：${new Date().toLocaleTimeString()}；页面 ${document.readyState}`,
      `当前主题：${root.classList.contains('dark') ? '深色' : '浅色'}；保存值：${String(saved).slice(0, 40)}`,
      `系统偏好：${matchMedia('(prefers-color-scheme: dark)').matches ? '深色' : '浅色'}；减少动画：${matchMedia('(prefers-reduced-motion: reduce)').matches ? '是' : '否'}`,
      `颜色方案：CSS ${rootStyle.colorScheme}；meta ${document.querySelector('meta[name="color-scheme"]')?.content || '空'}`,
      `HTML 底色：${rootStyle.backgroundColor}；body 底色：${bodyStyle.backgroundColor}`,
      `body 层级：${bodyStyle.zIndex}；隔离：${bodyStyle.isolation}`,
      `背景：${background?.tagName || '无'}；组件注册：${background ? !!customElements.get(background.localName) : '无'}`,
      `背景样式：${bgStyle ? `display ${bgStyle.display}；visibility ${bgStyle.visibility}；opacity ${bgStyle.opacity}；z ${bgStyle.zIndex}` : '无'}`,
      `Canvas：${canvas ? `${canvas.width}×${canvas.height}；屏幕 ${Math.round(canvas.getBoundingClientRect().width)}×${Math.round(canvas.getBoundingClientRect().height)}` : '无'}`,
      `上下文：${ctx ? '已建立' : '无'}；contextLost：${contextLost}；RAF：${background?.rafId ?? '无'}`,
      `像素读取：${pixels}`,
      `背景脚本：${assets.join('\n') || '无已完成请求记录'}`,
      `最近3条错误（仅诊断加载后）：${errors.join(' / ') || '未捕获到'}`,
      `浏览器：${navigator.userAgent}`,
    ].join('\n')
  }
  const update = () => {
    if (!enabled()) return stop()
    if (!document.body) return
    // Capture before attaching the panel. A visible overlay can affect compositing.
    output.textContent = snapshot()
    if (!panel.isConnected) document.body.append(panel)
  }
  const mount = () => {
    if (!enabled()) return stop()
    if (!panel.isConnected && document.readyState === 'complete') update()
  }
  const stop = () => {
    panel.remove()
    window.removeEventListener('error', onError, true)
    window.removeEventListener('unhandledrejection', onRejection)
    window.removeEventListener('load', mount)
    document.removeEventListener('astro:page-load', mount)
    document.querySelector('[data-theme-diagnostics-script]')?.remove()
    delete window.__themeDiagnostics
  }
  for (const [label, action] of [
    ['更新数据', update],
    [
      '复制数据',
      async () => {
        try {
          await navigator.clipboard.writeText(output.textContent)
          title.textContent = '已复制诊断数据'
        } catch {
          title.textContent = '复制失败，请截图（面板可滚动）'
        }
      },
    ],
  ]) {
    const button = document.createElement('button')
    button.type = 'button'
    button.textContent = label
    button.style.cssText =
      'margin-right:8px;padding:4px 8px;border:1px solid #888;border-radius:4px;background:#fff;color:#111;font:inherit'
    button.addEventListener('click', action)
    controls.append(button)
  }
  window.__themeDiagnostics = { update, stop }
  document.addEventListener('astro:page-load', mount)
  if (document.readyState !== 'complete')
    window.addEventListener('load', mount, { once: true })
  else mount()
})()
