/**
 * 渲染测试用的最小 DOM。没有 jsdom 依赖，只支持渲染器实际用到的标签、class 与
 * 「属性存在」选择器；样式只记录 `setProperty` 的结果。
 *
 * 放在 `test/` 之外：`node --test` 会把 `test/` 下的每个文件当成测试文件执行。
 */
export function createDocument() {
  const doc = {
    createElement(tag) {
      return createElement(tag, doc)
    },
  }
  return doc
}

function dataAttrName(key) {
  return `data-${key.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`)}`
}

function datasetProxy(node) {
  return new Proxy(
    {},
    {
      get(_, key) {
        if (typeof key !== 'string') return undefined
        return node.attributes[dataAttrName(key)]
      },
      set(_, key, value) {
        if (typeof key !== 'string') return false
        node.attributes[dataAttrName(key)] = String(value)
        return true
      },
    }
  )
}

function createElement(tag, ownerDocument) {
  const node = {
    nodeType: 1,
    tagName: String(tag).toUpperCase(),
    ownerDocument,
    childNodes: [],
    attributes: Object.create(null),
    listeners: [],
    isConnected: true,
    _content: null,
    get children() {
      return this.childNodes.filter((child) => child.nodeType === 1)
    },
    get firstElementChild() {
      return this.children[0] ?? null
    },
    get className() {
      return this.attributes.class ?? ''
    },
    set className(value) {
      this.attributes.class = value
    },
    get textContent() {
      return this.childNodes
        .map((child) =>
          child.nodeType === 3 ? child.data : (child.textContent ?? '')
        )
        .join('')
    },
    set textContent(value) {
      this.childNodes = []
      if (value !== '' && value != null)
        this.childNodes.push({ nodeType: 3, data: String(value) })
    },
    get content() {
      if (this.tagName !== 'TEMPLATE') return undefined
      if (!this._content) {
        this._content = createElement('#document-fragment', ownerDocument)
        this._content.childNodes = this.childNodes
        this.childNodes = []
      }
      return this._content
    },
    get dataset() {
      return datasetProxy(this)
    },
    style: {
      setProperty(name, value) {
        this[name] = String(value)
      },
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value)
    },
    getAttribute(name) {
      return Object.hasOwn(this.attributes, name) ? this.attributes[name] : null
    },
    hasAttribute(name) {
      return Object.hasOwn(this.attributes, name)
    },
    removeAttribute(name) {
      delete this.attributes[name]
    },
    toggleAttribute(name, force) {
      const on = force ?? !this.hasAttribute(name)
      if (on) this.setAttribute(name, '')
      else this.removeAttribute(name)
      return on
    },
    append(...nodes) {
      for (const child of nodes) {
        if (child.parentNode)
          child.parentNode.childNodes = child.parentNode.childNodes.filter(
            (n) => n !== child
          )
        child.parentNode = this
        this.childNodes.push(child)
      }
    },
    replaceChildren(...nodes) {
      for (const child of this.childNodes) child.parentNode = null
      this.childNodes = []
      this.append(...nodes)
    },
    replaceWith(next) {
      const parent = this.parentNode
      if (!parent) return
      const index = parent.childNodes.indexOf(this)
      this.parentNode = null
      next.parentNode = parent
      parent.childNodes.splice(index, 1, next)
    },
    remove() {
      const parent = this.parentNode
      if (!parent) return
      parent.childNodes = parent.childNodes.filter((n) => n !== this)
      this.parentNode = null
    },
    get hidden() {
      return this.hasAttribute('hidden')
    },
    set hidden(value) {
      if (value) this.setAttribute('hidden', '')
      else this.removeAttribute('hidden')
    },
    get disabled() {
      return this.hasAttribute('disabled')
    },
    set disabled(value) {
      if (value) this.setAttribute('disabled', '')
      else this.removeAttribute('disabled')
    },
    addEventListener(type, handler, options) {
      this.listeners.push({ type, handler, options })
      const signal =
        options && typeof options === 'object' ? options.signal : null
      if (signal) {
        if (signal.aborted) return
        signal.addEventListener('abort', () => {
          this.listeners = this.listeners.filter(
            (entry) => entry.handler !== handler || entry.type !== type
          )
        })
      }
    },
    cloneNode(deep) {
      const copy = createElement(this.tagName, this.ownerDocument)
      Object.assign(copy.attributes, this.attributes)
      if (this.tagName === 'TEMPLATE') {
        const content = this.content
        for (const child of content.childNodes)
          copy.content.append(
            deep ? child.cloneNode(true) : child.cloneNode(false)
          )
      } else if (deep) {
        for (const child of this.childNodes)
          copy.append(
            child.nodeType === 3
              ? { nodeType: 3, data: child.data }
              : child.cloneNode(true)
          )
      }
      return copy
    },
    matches(selector) {
      return matchSelector(this, selector)
    },
    querySelector(selector) {
      return this.querySelectorAll(selector)[0] ?? null
    },
    querySelectorAll(selector) {
      const found = []
      const walk = (current) => {
        for (const child of current.children ?? current.childNodes ?? []) {
          if (child.nodeType !== 1) continue
          if (matchSelector(child, selector)) found.push(child)
          walk(child)
          if (child.tagName === 'TEMPLATE') walk(child.content)
        }
      }
      walk(this)
      return found
    },
  }
  if (tag === 'a') {
    Object.defineProperty(node, 'href', {
      get() {
        return this.attributes.href ?? ''
      },
      set(value) {
        this.attributes.href = String(value)
      },
    })
  }
  if (tag === 'img') {
    Object.defineProperty(node, 'src', {
      get() {
        return this.attributes.src ?? ''
      },
      set(value) {
        this.attributes.src = String(value)
      },
    })
    Object.defineProperty(node, 'alt', {
      get() {
        return this.attributes.alt ?? ''
      },
      set(value) {
        this.attributes.alt = String(value)
      },
    })
  }
  if (tag === 'time') {
    Object.defineProperty(node, 'dateTime', {
      get() {
        return this.attributes.datetime ?? ''
      },
      set(value) {
        this.attributes.datetime = String(value)
      },
    })
  }
  return node
}

function matchSelector(node, selector) {
  const parts = selector.trim().split(/\s+/).filter(Boolean)
  // Only support single simple selectors used by the renderer.
  if (parts.length !== 1) return false
  const sel = parts[0]
  if (sel.startsWith('.')) {
    return node.className.split(/\s+/).includes(sel.slice(1))
  }
  if (sel.startsWith('[') && sel.endsWith(']')) {
    const body = sel.slice(1, -1)
    if (body.includes('=')) return false
    return node.hasAttribute(body)
  }
  if (sel.startsWith('template[')) {
    const attr = sel.slice('template['.length, -1)
    return node.tagName === 'TEMPLATE' && node.hasAttribute(attr)
  }
  return node.tagName === sel.toUpperCase()
}
