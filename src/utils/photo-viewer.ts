/**
 * 照片对话框：点击 `[data-photo]` 链接（href 是大图，`data-caption` 是说明）放大，
 * 在最近的 `[data-photo-group]` 内前后翻看。旅行页与日历页共用，对话框见 `PhotoDialog.astro`。
 */
export function bindPhotoViewer(root: HTMLElement, signal: AbortSignal) {
  const dialog = root.querySelector<HTMLDialogElement>('[data-photo-dialog]')!
  const image = dialog.querySelector('img')!
  const caption = dialog.querySelector('p')!
  const prev = dialog.querySelector<HTMLButtonElement>('.photo-dialog__prev')!
  const next = dialog.querySelector<HTMLButtonElement>('.photo-dialog__next')!
  let links: HTMLAnchorElement[] = []
  let current = 0

  function show(index: number) {
    current = Math.max(0, Math.min(links.length - 1, index))
    const link = links[current]
    image.src = link.href
    image.alt = link.querySelector('img')?.alt ?? ''
    caption.textContent = `${link.dataset.caption ?? ''} · ${current + 1}/${links.length}`
    prev.disabled = current === 0
    next.disabled = current === links.length - 1
  }

  /** 打开某张，在它所在的组内翻看。 */
  function open(link: HTMLAnchorElement) {
    const group = link.closest('[data-photo-group]') ?? root
    links = [...group.querySelectorAll<HTMLAnchorElement>('a[data-photo]')]
    show(links.indexOf(link))
    dialog.showModal()
  }

  root.addEventListener(
    'click',
    (event) => {
      const link = (event.target as Element).closest<HTMLAnchorElement>(
        'a[data-photo]'
      )
      if (!link || event.button !== 0 || event.metaKey || event.ctrlKey) return
      event.preventDefault()
      open(link)
    },
    { signal }
  )
  dialog.addEventListener(
    'click',
    (event) => {
      const target = event.target as Element
      if (target.closest('.photo-dialog__prev')) show(current - 1)
      else if (target.closest('.photo-dialog__next')) show(current + 1)
      else if (target.closest('.photo-dialog__close') || target === dialog)
        dialog.close()
    },
    { signal }
  )
  dialog.addEventListener(
    'keydown',
    (event) => {
      if (event.key === 'ArrowLeft') show(current - 1)
      else if (event.key === 'ArrowRight') show(current + 1)
    },
    { signal }
  )
  return { open, isOpen: () => dialog.open }
}
