/**
 * 陈列架自动滚动的唯一属主。
 *
 * 插件输出轨道并标记 `media-cards--auto`。这里只决定是否复制一组，以及
 * 把一组的宽度交给 CSS。不创建轨道、不改卡片布局，避免竖卡退回横卡样式。
 */

export function authoredCards(rail) {
  const root = rail.querySelector(':scope > .media-cards__track') ?? rail
  return [...root.querySelectorAll(':scope > .media-card')].filter(
    (card) => !card.hasAttribute('data-marquee-clone')
  )
}

export function canMarquee(rail) {
  if (rail.clientWidth <= 0) return false
  const cards = authoredCards(rail)
  if (cards.length < 2) return false
  const first = cards[0]
  const last = cards[cards.length - 1]
  return (
    last.offsetLeft + last.offsetWidth - first.offsetLeft > rail.clientWidth + 1
  )
}

function muteClone(card) {
  card.setAttribute('data-marquee-clone', '')
  card.setAttribute('aria-hidden', 'true')
  for (const el of card.querySelectorAll(
    'a, button, input, textarea, select, [tabindex]'
  ))
    el.tabIndex = -1
}

function trackOf(rail) {
  return rail.querySelector(':scope > .media-cards__track')
}

function clearMarquee(rail) {
  const track = trackOf(rail)
  if (track) {
    for (const clone of [
      ...track.querySelectorAll(':scope > [data-marquee-clone]'),
    ])
      clone.remove()
  }
  delete rail.dataset.marquee
  track?.style.removeProperty('--marquee-distance')
}

function startMarquee(rail) {
  const track = trackOf(rail)
  if (!track) return false
  const originals = [...track.querySelectorAll(':scope > .media-card')].filter(
    (card) => !card.hasAttribute('data-marquee-clone')
  )
  if (!track.querySelector(':scope > [data-marquee-clone]')) {
    for (const card of originals) {
      const clone = card.cloneNode(true)
      muteClone(clone)
      track.append(clone)
    }
  }
  const first = originals[0]
  const clone = track.querySelector(':scope > .media-card[data-marquee-clone]')
  // 先关掉滚动条，再量一组宽度，否则隐藏滚动条后的列宽和动画距离对不上。
  rail.dataset.marquee = 'on'
  const distance = first && clone ? clone.offsetLeft - first.offsetLeft : 0
  if (distance <= 0) {
    clearMarquee(rail)
    return false
  }
  track.style.setProperty('--marquee-distance', `${distance}px`)
  return true
}

export function createMarqueeController({ query, reducedMotion }) {
  const started = new Set()
  const stop = (rail) => {
    started.delete(rail)
    clearMarquee(rail)
  }

  return {
    sync() {
      const live = new Set(query())
      for (const rail of started) {
        if (!live.has(rail) || !rail.isConnected) stop(rail)
      }
      for (const rail of live) {
        if (reducedMotion() || !canMarquee(rail)) {
          if (started.has(rail) || rail.dataset.marquee) stop(rail)
          continue
        }
        if (startMarquee(rail)) started.add(rail)
      }
    },
    stopAll() {
      for (const rail of [...started]) stop(rail)
      for (const rail of query()) stop(rail)
    },
  }
}
