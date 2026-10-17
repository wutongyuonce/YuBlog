---
title: 前端从底层到上层
description: 从 HTML、CSS 和 JavaScript 出发，串起浏览器、Node.js、React/Vue、前端工具链、构建与部署的完整主线。
pubDate: 2026-6-27
category: 技术
tags: [前端]
titleImage: ./_title-images/frontend-roadmap-2026.png
titleImageAlt: 2026 年前端技术路线图
draft: false
---

> [现代前端开发学习路线](https://front-talk.com/roadmap)

前端的主线是：**用 HTML、CSS 和 JavaScript 描述页面，通过工具链处理源码，由浏览器和 UI 框架完成显示与交互。**

理解一个工具时，先分清它属于哪一层：语言、运行时、开发工具、UI 库，还是应用框架。本文保留常用写法和核心原理。

## 一、页面基础：HTML、CSS、JavaScript

### 1. HTML：结构与语义

HTML 描述内容结构。浏览器解析 HTML 后建立 DOM 树，JavaScript 通过 DOM API 读取和修改页面。

```html
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>示例页面</title>
    <link rel="stylesheet" href="./style.css">
    <script type="module" src="./main.js"></script>
  </head>
  <body>
    <header><nav><a href="/">首页</a></nav></header>
    <main>
      <h1>用户登录</h1>
      <form action="/login" method="post">
        <label for="email">邮箱</label>
        <input id="email" name="email" type="email" autocomplete="email" required>
        <button type="submit">登录</button>
      </form>
    </main>
  </body>
</html>
```

最需要掌握的规则：

- 用 `header`、`nav`、`main`、`article` 等表达结构；无合适语义时再用 `div`、`span`。
- 标题按 `h1`–`h6` 的层级组织；按钮用 `button`，导航用 `a`，不要依赖 `div` 模拟交互。
- 表单用 `label` 说明字段，`name` 决定提交字段名；普通按钮写 `type="button"`，避免意外提交。
- 图片提供合适的 `alt`；交互元素应支持键盘操作和清晰的焦点样式。
- `./` 相对当前 URL 目录，`/` 相对站点根路径。部署到子路径时，要同步处理资源路径。
- `type="module"` 加载 ESM 脚本，默认延后到文档解析完成后执行；不要直接双击 HTML 调试模块项目，应通过本地 HTTP 服务访问。

`required`、`type="email"` 等浏览器校验改善体验；身份、权限、金额和数据合法性仍必须由后端检查。

### 2. CSS：样式与布局

CSS 的核心是：**选择元素 → 计算最终样式 → 确定尺寸和位置 → 绘制页面。** 先学原生 CSS，再使用 Tailwind 或组件库。

#### 层叠、继承与盒模型

```css
*, *::before, *::after {
  box-sizing: border-box;
}

:root {
  --brand: #2563eb;
}

body {
  margin: 0;
  font-family: system-ui, sans-serif;
  color: #222;
}

.button {
  padding: 0.5rem 1rem;
  color: white;
  background: var(--brand);
}

.button:focus-visible {
  outline: 2px solid var(--brand);
  outline-offset: 3px;
}
```

- 选择器日常以类名为主；`:hover`、`:focus-visible` 是状态伪类，`::before`、`::after` 是伪元素。
- 同一属性冲突时，浏览器综合来源、`!important`、层叠层（`@layer`）、选择器优先级和出现顺序决定结果。**在同一来源、重要性和层级下，才继续比较选择器优先级等因素。**
- 字体、文字颜色通常可继承；宽高、边距通常不继承。先在 DevTools 看最终生效的规则，再修改样式。
- 盒模型是 `content → padding → border → margin`；`border-box` 让声明的宽高包含内边距和边框，外边距仍在外部。
- CSS 变量可以继承并在运行时覆盖，适合主题色、间距和主题切换。

#### 布局优先用 Flex 和 Grid

| 需求 | 常用方式 | 核心属性 |
| --- | --- | --- |
| 导航、按钮组、一行或一列的对齐 | Flex | `justify-content`、`align-items`、`gap`、`flex` |
| 页面分栏、卡片网格、同时控制行列 | Grid | `grid-template-columns`、`gap`、`grid-column` |
| 徽标覆盖、弹出层等局部定位 | `position` | `relative`、`absolute`、`fixed`、`sticky` |

```css
.toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 1rem;
}

.layout {
  display: grid;
  grid-template-columns: 15rem minmax(0, 1fr);
  gap: 1.5rem;
}

@media (max-width: 48rem) {
  .layout {
    grid-template-columns: 1fr;
  }
}
```

Flex 处理一维排列，Grid 处理二维布局，两者可以嵌套。Flex 主轴默认横向，`justify-content` 控制主轴分布，`align-items` 控制交叉轴对齐。

常见边界只需要记住：

- `display: none` 不占布局空间；行内元素通常不能像块元素一样直接设置宽高。
- `absolute` 脱离正常文档流，常用父元素的 `position: relative` 提供定位参照；普通页面布局不应大量依赖绝对定位。
- Flex/Grid 子项被长内容撑开时，检查 `min-width: 0`、`minmax(0, 1fr)` 和换行规则。
- 响应式优先依赖弹性尺寸，再按内容需要增加断点；`rem` 适合字号与间距，`px` 常用于边框，移动端满屏高度可考虑 `dvh`。
- 图片通常设置 `max-width: 100%`；避免固定宽度导致小屏横向溢出。

### 3. JavaScript：数据、函数、事件与异步

JavaScript 负责保存状态、计算结果和响应操作。`document`、`fetch`、定时器等属于宿主环境提供的 API，不是语言本身。

#### 数据与函数

```js
const users = [{ id: 1, name: '张三' }]
const names = users.map(user => user.name)
const nextUsers = [...users, { id: 2, name: '李四' }]
```

优先掌握 `const`/`let`、对象与数组、解构、展开语法、函数，以及 `map`、`filter`、`find` 等常用方法。

- 原始值包括字符串、数字、布尔值、`null`、`undefined`、`bigint` 和 `symbol`；对象、数组、函数属于对象类型。
- 对象赋值会共享同一个对象；`const` 禁止重新赋值，不会冻结对象。
- `{ ...obj }`、`[...array]` 是浅拷贝，内部嵌套对象仍可能共享引用。
- 通常使用 `===` 比较；用 `?.` 安全访问可空值，用 `??` 为 `null`/`undefined` 提供默认值。

作用域决定变量能在哪里访问；闭包让函数在以后执行时仍能访问创建位置的外层变量：

```js
function createCounter() {
  let count = 0
  return () => ++count
}

const next = createCounter()
next() // 1
next() // 2
```

事件回调、定时器和组件函数中都可能用到闭包。它保留的是变量访问关系，不是创建时所有数据的固定快照。

对象通过原型链共享属性和方法；`class` 建立在这套机制上。日常更需要注意 `this`：普通函数的 `this` 取决于调用方式，箭头函数使用外层的 `this`。

#### DOM、事件与状态驱动

```js
const button = document.querySelector('#add')
const output = document.querySelector('#count')
let count = 0

if (button && output) {
  button.addEventListener('click', () => {
    count += 1
    output.textContent = String(count)
  })
}
```

这是最直接的页面更新：监听事件，改变数据，再修改 DOM。React/Vue 将这套过程组织为：

```text
状态 → 计算界面 → 用户操作 → 更新状态 → 更新界面
```

#### Promise、async/await 与事件循环

```js
console.log('开始')
setTimeout(() => console.log('定时器'), 0)
Promise.resolve().then(() => console.log('Promise'))
console.log('结束')
// 开始 → 结束 → Promise → 定时器
```

同一个 JavaScript 执行线程上，同步代码先完成。Promise 回调通过微任务执行；事件循环在处理下一个任务前会清空当前微任务队列，再按时机进行渲染等工作。`setTimeout(fn, 0)` 不代表立即执行，长时间同步计算仍会阻塞页面交互；重计算可考虑 Worker。

Promise 表示将来成功或失败的结果。`async` 函数总是返回 Promise，`await` 暂停当前异步函数，等待结果后继续，不会阻塞整个线程。

- `then` 返回新的 Promise，后续步骤采用回调返回的值或 Promise 的结果；抛出的错误沿链传播。
- 有先后依赖时逐个 `await`；独立请求可用 `Promise.all` 并发等待，其中一个失败会使整体拒绝，但不会自动取消其他请求。
- 用 `try/catch/finally` 处理失败和加载状态，避免捕获错误后悄悄返回 `undefined`。

#### 网络请求：先掌握 Fetch

```js
async function loadUser(id, signal) {
  const response = await fetch(`/api/users/${encodeURIComponent(id)}`, { signal })
  if (!response.ok) {
    throw new Error(`请求失败：HTTP ${response.status}`)
  }

  const user = await response.json()
  if (!user || typeof user.name !== 'string') {
    throw new Error('用户数据格式不正确')
  }
  return user
}

const controller = new AbortController()
try {
  const user = await loadUser('123', controller.signal)
  console.log(user.name)
} catch (error) {
  if (error instanceof Error && error.name === 'AbortError') {
    console.log('请求已取消')
  } else {
    console.error(error)
  }
}
// 页面离开或查询条件变化时，可调用 controller.abort() 取消不再需要的请求。
```

Fetch 是浏览器和现代 Node.js 提供的 API。网络失败通常会拒绝 Promise，`404`/`500` 则需要自己检查 `response.ok`。JSON 解析也可能失败，解析成功后仍需验证关键字段。

POST JSON 时设置 `method: 'POST'`、`Content-Type: application/json`，并用 `JSON.stringify` 生成请求体。需要统一拦截器、配置或已有请求层时再使用 Axios；不必从手写 XHR 开始。

浏览器跨域访问受 CORS 限制，需要服务端允许或通过同源后端代理处理。`mode: 'no-cors'` 不能让前端正常读取跨域响应。异步界面还需处理加载、空数据、失败，以及旧请求覆盖新结果的问题。

## 二、运行环境：浏览器与 Node.js

### 1. 引擎执行语言，宿主提供能力

JavaScript 引擎负责解析和执行代码、优化热点代码、回收不可达对象。运行时再提供文件、网络或页面等能力。

| 环境 | 主要能力 | 前端中的用途 |
| --- | --- | --- |
| 浏览器 | DOM、CSS、事件、网络、存储、渲染 | 运行页面与交互 |
| Node.js | 文件系统、进程、网络服务，以及部分 Web API | 开发工具、构建、SSR、后端 |

两者都能运行 JavaScript，也都能提供 `fetch` 等 API，但浏览器有 `window`/`document`，普通 Node.js 进程没有。浏览器也不能直接使用 `node:fs` 读取本地任意文件。

Chromium 是浏览器项目，Blink 负责页面渲染，V8 执行 JavaScript 和 WebAssembly；Node.js 同样使用 V8。WebAssembly 是供引擎执行的可移植指令格式，适合图像处理等计算任务，通过宿主提供的接口与页面或系统交互。

### 2. 浏览器如何显示页面

```text
HTML → DOM
CSS → 样式规则
        ↓
样式计算 → 布局 → 绘制 → 合成 → 屏幕
        ↑
JavaScript 通过 DOM/CSS API 改变页面
```

- 布局决定元素大小和位置；绘制生成文字、背景、边框等绘制内容；合成把图层组合显示。
- 修改内容或样式可能触发后续阶段，具体取决于修改了什么，并非每次都完整重走一遍。
- DOM 更新和屏幕显示不是同一时刻；避免在循环里交替读取布局与修改样式。

实际调试主要看 DevTools：Elements 查 DOM 和生效样式，Console 看错误，Network 查资源与接口，Performance 定位长任务和渲染开销。

### 3. 分清开发时与访问时

```text
开发/构建：Node.js 运行 Vite、类型检查器、测试工具
用户访问：浏览器执行交付的 HTML、CSS、JavaScript
SSR 请求：服务端运行框架的服务端代码，再返回 HTML 和客户端资源
```

纯静态前端部署后，用户浏览器不需要安装 Node.js。SSR 则需要兼容的服务端运行环境；运行环境可以是 Node.js，也可以是框架支持的其他平台。

## 三、源码组织：模块、TypeScript 与 JSX

### 1. ESM：显式声明模块依赖

```js
// user.js
export function getName(user) {
  return user.name
}

// main.js
import { getName } from './user.js'
```

新项目优先使用 ESM 的 `import`/`export`。它隔离文件作用域，声明依赖，也便于工具静态分析与拆包。

- 浏览器支持 `<script type="module">`，导入通常使用 URL 或相对路径。
- `import 'vue'` 这类包名需要构建工具解析，或通过 import map 映射为 URL。
- Node.js 也支持 ESM；`package.json` 的 `"type": "module"` 将包内 `.js` 默认视为 ESM，`.mjs` 明确表示 ESM，`.cjs` 表示 CommonJS。
- CommonJS 的 `require`/`module.exports` 仍常见于已有项目，不必为新项目主动混用两套写法。

按需加载使用动态导入：

```js
const { openEditor } = await import('./editor.js')
openEditor()
```

构建器通常据此拆出异步代码块，浏览器在这段逻辑执行时再加载它。

### 2. TypeScript：开发时检查，不替代运行时验证

TypeScript 为 JavaScript 增加类型系统。新项目主要掌握类型推导、对象类型、联合类型、泛型和函数参数/返回值，无需一开始研究复杂类型运算。

```ts
type User = {
  id: string
  name: string
  avatarUrl?: string
}

function getDisplayName(user: User): string {
  return user.name || '匿名用户'
}
```

核心边界：

- **类型检查**发现静态类型问题；**转换**移除类型并生成可执行代码，两者可以由不同工具完成。
- 浏览器不直接执行 TS 类型语法，前端通常交给 Vite 等工具转换。
- 现代 Node.js 可直接运行仅含可擦除类型语法的 `.ts`，但不做类型检查，也不读取 `tsconfig.json`；不等于完整支持所有 TS/TSX 特性。
- `as User` 只影响类型系统，不会把错误的接口数据变成合法用户。外部数据仍需运行时校验，尚未确定的值优先用 `unknown` 表达。
- 用 `import type` 明确导入类型；项目配置优先沿用脚手架的 `tsconfig`。

### 3. JSX、TSX 和 Vue 单文件组件

```jsx
const element = <button className="primary">保存</button>
```

JSX 是嵌在 JavaScript 中的 UI 描述语法，TSX 是同时使用 TypeScript 和 JSX 的文件格式。它们需要转换，浏览器不会直接执行 JSX 标签。

React 通常使用 JSX/TSX，现代转换会生成对 `react/jsx-runtime` 的调用，因此不必为使用 JSX 单独 `import React`。Vue 通常使用 `.vue` 单文件组件，把 `<template>`、`<script setup>`、`<style>` 放在一起；模板由 Vue 编译器生成渲染函数。

JSX 也能用于其他 UI 库，但转换必须匹配对应运行时。Vue 的常规项目直接使用模板即可；确需 JSX 时再接入 `@vitejs/plugin-vue-jsx`。不必为了开始写组件手动拼装 Babel 配置。

## 四、React 与 Vue：组件和状态如何变成页面

React 是 UI 库，Vue 是渐进式框架。两者都提供组件与状态更新机制；在 Web 项目中，最终仍通过浏览器 DOM API 改变页面。

### 1. 先掌握组件的共同模型

```text
props 输入 + 组件状态 → 描述界面
用户事件 → 更新状态 → 重新计算相关界面 → 更新 DOM
```

- **组件**封装一块 UI 及相关行为，组件名、文件名和真实 HTML 元素不是同一概念。
- **props** 把数据从父级传给子级；子级通过回调或事件请求父级修改数据。
- **状态**保存会影响界面的变化数据；能从已有数据算出的值，优先直接计算或使用计算属性。
- 列表使用稳定的业务 `key` 标识项目，避免重排后组件状态对应错误。
- 生命周期和副作用用于连接外部系统，例如订阅、定时器和 DOM 插件，并在适当时机清理。

### 2. React：函数组件与 Hooks

```tsx
import { useState } from 'react'

type CounterProps = { initial?: number }

export default function Counter({ initial = 0 }: CounterProps) {
  const [count, setCount] = useState(initial)

  return (
    <button onClick={() => setCount(current => current + 1)}>
      数量：{count}
    </button>
  )
}
```

- 函数组件返回 UI 描述；`useState` 保存组件状态，更新函数请求重新渲染。
- 每次渲染拿到的是当次状态快照。基于旧值计算新值时，用 `setCount(current => current + 1)`。
- 把数组和对象状态视为只读，通过创建新值表达更新。
- Hooks 通常在组件或自定义 Hook 顶层调用，遵循 React 的 Hooks 规则。
- 用户点击触发的业务逻辑直接放事件处理函数；不要把所有计算和状态同步都塞进 `useEffect`。Effect 主要用于与外部系统同步，并按需要返回清理函数。

纯客户端入口通常是：

```tsx
import { createRoot } from 'react-dom/client'
import App from './App'

const root = document.getElementById('root')
if (!root) throw new Error('缺少 #root 挂载节点')
createRoot(root).render(<App />)
```

### 3. Vue：响应式状态与模板

```vue
<script setup lang="ts">
import { computed, ref } from 'vue'

const props = defineProps<{ initial?: number }>()
const count = ref(props.initial ?? 0)
const doubled = computed(() => count.value * 2)
</script>

<template>
  <button @click="count++">数量：{{ count }}，两倍：{{ doubled }}</button>
</template>
```

- 新项目常用 Vue 3 的 Composition API 和 `<script setup>`。
- `ref` 在脚本中通过 `.value` 访问，在模板中通常自动解包；`reactive` 适合响应式对象。
- `computed` 表达派生值，`watch`/`watchEffect` 处理需要跟随数据变化的副作用。
- 用 `defineProps` 接收输入，`defineEmits` 声明事件；常见模板指令包括 `v-if`、`v-for`、`v-model`。
- `onMounted` 等生命周期钩子用于访问已挂载 DOM；外部订阅和定时器应在卸载时清理。

客户端入口通常是：

```ts
import { createApp } from 'vue'
import App from './App.vue'

createApp(App).mount('#app')
```

### 4. 核心原理：状态、调度、协调与 DOM

| 环节 | React | Vue |
| --- | --- | --- |
| 源码转换 | JSX/TSX 转成 JavaScript 调用 | `.vue` 模板转成渲染函数 |
| 更新触发 | 状态更新函数、父级更新等 | `ref`/`reactive` 的依赖追踪等 |
| UI 描述 | React element | VNode |
| 更新执行 | 调度渲染，协调结果，再提交变化 | 调度相关渲染副作用，比较并更新节点 |
| Web 平台输出 | `react-dom` | Vue DOM 渲染器 |

```text
源码转换 → 执行组件/渲染函数 → 得到 UI 描述 → 首次挂载 DOM
状态变化 → 调度相关更新 → 计算新 UI → 复用或调整节点 → 浏览器渲染
```

Vue 的 `setup` 通常在组件实例创建时执行，后续更新主要重新运行渲染过程；React 函数组件则在渲染时重新调用。不能笼统地把两者都理解为“每次状态变化重新执行整个组件初始化代码”。

框架会根据节点类型、位置和 `key` 等判断复用关系，并合并或调度更新。虚拟 DOM 是组织 UI 更新的一种方式，不保证比每一种手写 DOM 操作都快。业务中先保证数据流清晰，再用性能工具定位瓶颈。

### 5. CSR、SSR、SSG 与 hydration

| 模式 | 主要页面 HTML 的生成时机 | 常见用途 |
| --- | --- | --- |
| CSR：客户端渲染 | 浏览器执行 JavaScript 时 | 管理后台、交互型应用 |
| SSR：服务端渲染 | 服务端处理请求时，可结合缓存 | 需要首屏内容、请求相关数据的页面 |
| SSG：静态生成 | 构建或预生成时 | 文档、博客、相对稳定的内容页 |

CSR 通常先返回入口 HTML，再由客户端创建主要界面。SSR/SSG 先提供已有页面内容；如果页面还需要框架交互，客户端通常执行 **hydration（水合）**，将客户端组件树与现有 DOM 对齐并接管后续更新。

hydration 不只是绑定事件，还涉及组件状态和内部结构的建立。服务端与客户端首次输出应保持一致，避免时间、随机数或浏览器专属数据造成不匹配。服务端通常没有 DOM，应把浏览器专属操作放到客户端执行阶段。

Next.js、Nuxt 等应用框架可以混合使用这些模式。React Server Components（服务端组件）描述的是组件在哪执行及如何传递结果，与 SSR 的“在哪里生成 HTML”不是同一个维度，也不必作为基础入门的起点。

## 五、前端工具链：从创建项目到部署运行

工具链的职责是：**管理依赖，提供开发反馈，把源码变成可部署产物。** 按实际使用流程理解，比逐个背工具名称更直接。

```text
创建项目与安装依赖 → 本地开发 → 转换与检查 → 打包构建 → 预览部署 → 用户运行
```

转换和检查在开发时也会持续发生；生产构建会重新组织并优化完整产物。

### 1. 创建项目与管理依赖

先安装受项目支持的 Node.js LTS 版本，已有项目以版本声明、锁文件和 README 为准。Vue 官方脚手架基于 Vite，以下假设按提示将项目命名为 `my-vue-app`：

```bash
npm create vue@latest
# 按提示创建项目，可选择 TypeScript、Router 等能力
cd my-vue-app
npm install
npm run dev
```

学习 React 基础、创建独立客户端应用时，可以使用 Vite：

```bash
npm create vite@latest my-react-app -- --template react-ts
cd my-react-app
npm install
npm run dev
```

React 官方对新应用建议优先评估框架；需要完整路由、数据加载或服务端能力时，可考虑 Next.js、React Router 框架模式等。Vite 提供开发与构建基础，应用能力按需求选择。

日常依赖操作：

```bash
npm install                 # 安装依赖，必要时更新锁文件
npm install axios           # 添加业务依赖
npm install -D eslint       # 添加开发工具
npm uninstall axios         # 删除依赖并更新声明
npm ci                      # CI 中按已有锁文件干净安装
```

`npm ci` 要求存在锁文件，且它与 `package.json` 一致；不一致时失败，不会替你修改锁文件。

| 文件或字段 | 用途 |
| --- | --- |
| `package.json` | 项目元数据、依赖声明、脚本命令 |
| `dependencies` | 应用或库所需的依赖，如 React、Vue |
| `devDependencies` | 开发、类型检查、测试和构建工具 |
| `peerDependencies` | 这个库需要和项目里的哪些包、哪些版本搭配使用 |
| `package-lock.json` | npm 解析出的具体依赖版本与校验信息，应提交 |
| `node_modules` | 安装结果，不手动修改、不提交 |

`peerDependencies` 可以理解为一个库在说：**“我需要和你项目里的某个包一起用，而且版本得合适。”** 比如 React 组件库要求项目使用 React 19，就是在声明搭配要求，让组件库和应用共用兼容的 React，避免各用各的导致问题。这个字段主要用于组件库、插件等供别人安装的包。

`dependencies`/`devDependencies` 是依赖管理约定，**不决定某个包是否进入浏览器**；最终以实际导入关系和构建配置为准。构建通常需要安装开发依赖，静态产物部署后则不需要把整个 `node_modules` 一起上传。

npm、pnpm、Yarn 都能管理依赖。除了前面介绍的 npm 锁文件，**pnpm 用 `pnpm-lock.yaml`，Yarn 用 `yarn.lock`**；它们都记录实际安装的依赖版本，让团队和 CI 安装时能对齐。已有项目遵循原包管理器，不混用锁文件。

安装依赖不等于打包：包管理器先把需要的包准备到本地，构建器再分析源码实际引用了什么，并生成要交付的文件。

### 2. 本地开发：开发服务器与 HMR

典型 Vite 项目的主要文件：

```text
project/
├── index.html          # Web 入口，引用 src/main.ts 或 main.tsx
├── package.json        # 依赖和命令
├── package-lock.json
├── vite.config.ts     # Vite 配置与框架插件
├── tsconfig.json      # TS 配置，可能引用多个子配置
├── public/            # 按原文件名复制的公共资源
└── src/
    ├── main.ts        # React 项目通常是 main.tsx
    ├── App.vue        # React 项目通常是 App.tsx
    └── assets/
```

`npm run dev` 执行的是 `package.json` 中的 `scripts.dev`。npm 把项目依赖提供的命令加入脚本的查找路径，Vite 等 Node.js 工具由此启动；`dev` 是脚本名，具体行为取决于项目定义。最小脚本配置如下：

```json
{
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  }
}
```

```text
npm run dev
  → 启动 Vite，加载配置与框架插件
  → 浏览器请求 index.html 和入口模块
  → Vite 解析依赖，按需转换 TS、JSX、.vue 和 CSS
  → 浏览器加载转换后的模块，框架创建页面
```

Vite 的常规开发模式基于原生 ESM，通常不先生成完整 `dist`。`import 'vue'` 等包引用会被解析和重写，部分第三方依赖还会预打包以处理格式兼容和减少碎片请求。

保存文件后的 **HMR（热模块替换）**：

```text
文件变化 → 模块图确定影响范围 → WebSocket 通知浏览器
        → 加载新模块 → 框架接收更新，尽量保留状态
```

HMR 边界无法安全接收更新时会刷新页面；它不是生产环境的动态更新机制。Vue/React 项目通常需要对应的 Vite 插件，脚手架已配置，不必自行重写转换流程。

### 3. 源码转换与质量检查

浏览器认识标准 HTML、CSS 和 JavaScript，不认识 TS 类型、JSX、Vue SFC 或 Sass。工具链先将它们转换成可执行模块与样式：

```text
.ts   → 擦除类型 → JavaScript
.tsx  → 擦除类型 + JSX 转换 → JavaScript
.vue  → Vue 编译器处理 script/template/style → JavaScript + CSS
.scss → Sass → CSS（项目使用时才需要）
```

**转换成功不等于检查通过。** 常见工具的职责各有侧重：

| 工作 | 常见工具 | 解决的问题 |
| --- | --- | --- |
| 类型检查 | TypeScript、Vue 的 `vue-tsc` | 参数、返回值、组件类型是否匹配 |
| 语法转换 | Oxc、Babel、SWC 等 | 处理 TS/JSX 和目标语法 |
| 代码检查 | ESLint 等 | 可疑写法、规则违规 |
| 格式统一 | Prettier 等 | 缩进、换行、格式 |
| 行为验证 | Vitest、Playwright 等 | 逻辑和用户操作是否符合预期 |

类型检查常见命令是 `tsc --noEmit`，Vue 使用 `vue-tsc --noEmit`；有多个 TS 子项目的脚手架可能使用 `tsc -b`。沿用模板已有配置，CI 中显式执行项目提供的检查脚本，不要以为 `vite build` 自带类型检查。

Vite 环境变量通过 `import.meta.env` 读取。默认以 `VITE_` 开头的变量会暴露给客户端，不能用于保存密钥；这些值通常在构建时替换，修改部署机器的环境变量不会自动改变已构建的静态文件。

### 4. 打包构建：围绕模块图生成产物

先区分三个动作：

| 动作 | 含义 |
| --- | --- |
| 转换 | 将某个文件的 TS、JSX、模板等变成目标代码 |
| 打包 | 从入口分析模块依赖，把代码组织成可加载的 chunk（代码块） |
| 构建 | 项目级流程，包含转换、打包、资源处理、优化和输出 |

打包器从入口追踪 `import`，解析相对文件和 npm 包入口，递归建立模块图：

```text
index.html
└── src/main.ts
    ├── App.vue
    │   └── app.css
    ├── vue
    └── import('./pages/Admin.vue')
```

基于这张图，构建器完成：

- **Tree Shaking**：在能静态证明安全时删除未使用代码；有副作用、动态访问或 CommonJS 会限制优化。
- **Code Splitting**：按动态导入、多入口和共享关系拆分代码，不是把所有文件拼成一个大文件。
- **资源处理**：转换和提取 CSS，处理图片、字体及其引用。
- **优化输出**：压缩代码，生成带 hash 的资源名，并按配置生成 source map。语法降级不自动补齐所有缺失的运行时 API。

Vite 是开发服务器和构建入口，底层再调用打包器、转换器与插件。**Vite 8 的主线使用 Rolldown 打包、Oxc 提供编译能力**；早期 Vite 常见 esbuild/Rollup 组合。Webpack、Rollup 等仍存在于大量项目和库构建中，按项目版本理解即可，不需要先掌握每种配置。

默认静态应用的生产构建：

```bash
npm run build
npm run preview
```

以 `scripts` 的实际定义为准：`build` 可能先做类型检查再调用 `vite build`，`preview` 通常用 `vite preview` 在本地预览已有产物。

```text
dist/
├── index.html
└── assets/
    ├── index-a81c2.js
    ├── index-42be1.css
    ├── Admin-91d3f.js
    └── logo-14aa2.svg
```

入口 HTML 引用生产资源；异步 chunk 在对应逻辑触发时加载；hash 支持按内容缓存。编译器和打包器本身通常不交给浏览器，业务代码和实际需要的 React/Vue 运行时才进入相应产物。

### 5. 部署与运行：交付产物，浏览器执行

| 应用形式 | 交付什么 | 需要的运行环境 |
| --- | --- | --- |
| CSR、纯静态站点、静态导出 | HTML、CSS、JS、图片等 | 静态服务器、对象存储或 CDN |
| SSR、带服务端接口的应用 | 客户端资源 + 服务端代码 | 框架支持的 Node.js、边缘或托管平台等 |

`vite preview` 用于本地验证构建结果，正式部署应使用适合生产的服务器或平台。应用框架的目录和启动命令以其部署文档为准，不能一律只上传 `dist`。

部署时主要核对：

- **路由**：History 模式的 SPA 需要将前端页面路径回退到入口 HTML，同时保留 API 和静态资源的正常响应。
- **路径与接口**：部署子目录时配置正确的基础路径；开发服务器的 API 代理只用于开发，生产环境需配置真实接口地址或反向代理。
- **缓存**：带内容 hash 的资源适合长期缓存，HTML 应及时更新或重新验证；发布时考虑旧页面仍可能请求旧 chunk。
- **配置**：浏览器能读到的配置和代码都不是秘密，鉴权与业务规则在服务端落实。

用户访问后，浏览器加载资源并执行 JavaScript；CSR 由 React/Vue 创建主要 DOM，SSR/SSG 则在需要时进行 hydration。后续状态变化仍走“计算 UI → 更新 DOM → 浏览器渲染”这条链路。

## 六、项目扩展：路由、状态库、组件库与应用框架

先把组件和局部状态用好，出现对应需求后再增加工具。

| 层级 | 解决的问题 | 常见选择 |
| --- | --- | --- |
| 路由 | URL 对应页面、客户端导航 | Vue Router、React Router |
| 共享状态 | 跨组件或跨页面的客户端状态 | Pinia、Zustand、Redux Toolkit |
| 服务端数据管理 | 请求缓存、重新获取、失效和同步 | TanStack Query 等 |
| 样式工具 | 组织或生成 CSS | 原生 CSS、CSS Modules、Tailwind CSS |
| UI 组件 | 按钮、表单、弹窗等可复用交互 | Element Plus、Ant Design、MUI、shadcn/ui |
| 应用框架 | 路由、渲染、数据与部署约定 | Next.js、Nuxt、React Router 框架模式 |
| 独立后端 | 接口、鉴权、数据库和业务规则 | Express、NestJS 等 |

### 1. 路由与状态

客户端路由通常通过 History API 更新地址，再选择对应组件，不必每次下载完整页面。刷新页面仍然请求服务器，因此需要配合部署端的路由处理。

状态按归属存放：输入框和弹窗状态留在组件，筛选条件可放 URL，真正共享的客户端状态再进入 store；接口数据的缓存与同步可交给专用请求库。不要把所有数据都搬进全局状态。

### 2. 样式与组件库

Tailwind 根据源码中的类名生成 CSS，不替代浏览器布局引擎。Element Plus、Ant Design、MUI 提供框架组件，组件最终仍由 Vue/React 渲染。

Headless 组件侧重交互与无障碍行为，视觉样式由项目决定；shadcn/ui 主要将组件源码放入项目，由项目维护和修改。选择时先考虑框架兼容、交互需求和修改成本。

### 3. 应用框架与后端

Next.js 基于 React，Nuxt 基于 Vue。它们统一路由、布局、渲染方式、客户端/服务端边界、数据加载和部署；完整框架也可以用于 CSR 或静态导出，并非选择框架就一定需要长期运行服务器。

Express/NestJS 等主要负责服务端接口和业务规则。应用框架可以提供服务端接口，也可以只调用独立后端。涉及数据库、密钥、权限和可信业务判断的代码应留在服务端。

## 七、桌面扩展：Electron 与 Tauri

Web 技术也能构建桌面界面，区别主要在渲染引擎和系统能力由谁提供。

| 对比 | [Electron](https://www.electronjs.org) | [Tauri](https://tauri.app) |
| --- | --- | --- |
| 页面运行环境 | 随应用分发的 Chromium | 系统 WebView |
| 系统侧能力 | Node.js 主进程与原生模块 | Rust 核心、命令与插件 |
| 前端访问系统能力 | 通过受控的 preload/IPC 接口 | 通过受权限约束的命令/IPC 接口 |
| 主要取舍 | 体积通常更大，渲染环境较一致 | 安装包通常更小，需要考虑系统 WebView 差异 |

Electron 区分主进程与渲染进程，渲染页面不应直接暴露任意 Node.js 权限。Tauri 核心运行时不要求 Node.js，但开发前端时仍常使用 Node.js 工具链，也可按需求打包额外程序。两者都应只向界面开放必要的系统操作。

| 产品情况                                           | 优先考虑 | 主要原因                                      |
| -------------------------------------------------- | -------- | --------------------------------------------- |
| 已有 Node 后台的 Agent、开发工具、本地终端应用     | Electron | Node 环境与现有业务更匹配，减少额外运行时集成 |
| 从复杂 Web 产品扩展到桌面，需要覆盖多种 Linux 环境 | Electron | 固定 Chromium 版本有助于控制兼容范围          |
| 界面简单的托盘工具、小型文件工具，分发体积是硬约束 | Tauri    | 系统 WebView 加少量本地逻辑即可满足需求       |
| 已有 Rust 核心，需要增加桌面界面                   | Tauri    | 可直接复用核心能力，避免额外引入 Node         |

## 八、学习顺序与完整主线

1. 用 HTML/CSS 完成一个响应式页面，理解语义、盒模型、Flex/Grid。
2. 用 JavaScript 实现表单、列表增删和 Fetch 请求，处理加载与失败。
3. 选择 React 或 Vue 之一，用 TypeScript 掌握组件、props、事件、状态和派生数据。
4. 用脚手架完成一个包含列表、详情和编辑的小应用，理解依赖、开发、检查和构建命令。
5. 按需求加入路由、共享状态和请求缓存，部署一次并处理路径与刷新问题。
6. 需要完整应用能力时再深入框架，理解服务端边界、SSR/SSG 与 hydration。

整条链路可以放在一张图里：

```text
HTML/CSS/JS + TS/JSX/.vue 源码
  ↓ 包管理器准备依赖，Node.js 运行开发与构建工具
Vite + 框架插件：转换源码、组织模块、生成产物
  ↓
HTML + CSS + JS chunks + 资源 + 可选服务端代码
  ↓ 静态服务或应用服务器交付
浏览器加载；React/Vue 根据状态创建或接管 UI
  ↓
DOM/样式变化 → 布局、绘制与合成 → 用户看到并操作页面
```

## 参考资料

- [封面来源：roadmap.sh 前端技术路线图（2026 年版）](https://roadmap.sh/frontend)

- [MDN：学习 Web 开发](https://developer.mozilla.org/zh-CN/docs/Learn_web_development)
- [MDN：层叠](https://developer.mozilla.org/zh-CN/docs/Web/CSS/CSS_cascade/Cascade)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [Node.js：运行 TypeScript 的支持范围](https://nodejs.org/api/typescript.html)
- [Vue：快速上手](https://vuejs.org/guide/quick-start.html)
- [Vue：渲染机制](https://vuejs.org/guide/extras/rendering-mechanism.html)
- [React：创建应用](https://react.dev/learn/creating-a-react-app)
- [React：渲染与提交](https://react.dev/learn/render-and-commit)
- [Vite：入门与常用命令](https://vite.dev/guide/)
- [Vite 8：Rolldown 与 Oxc](https://vite.dev/blog/announcing-vite8)
- [Vite：生产构建](https://vite.dev/guide/build.html)
- [npm：npm ci](https://docs.npmjs.com/cli/v11/commands/npm-ci)
- [前端学习路线参考](https://github.com/sl1673495/frontend-roadmap)
