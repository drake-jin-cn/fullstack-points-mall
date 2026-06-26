# T009-T011 面试考察点 — 前端 HTTP 基础设施、登录页、Token 静默刷新

> 覆盖范围：Axios 拦截器架构、HttpOnly Cookie 原理、shadcn/ui vs MUI 选型、
> Zustand vs Redux、Loading Counter 设计、401 队列刷新机制、
> Next.js middleware.ts（Edge Runtime）路由守卫、Logout fail-safe、
> 前端状态持久化方案、vitest 工程化

---

## 一、UI 组件库选型

**Q1：为什么选 shadcn/ui 而不是 MUI 或 Ant Design？**

A：这三者定位不同：

| | shadcn/ui | MUI | Ant Design |
|---|---|---|---|
| 本质 | 代码复制到项目 | npm 依赖 | npm 依赖 |
| 样式方案 | Tailwind CSS | Emotion/styled | Less |
| 定制方式 | 直接改源码 | theme override | Less 变量 |
| 包体积 | 0（只引入用到的） | 全量引入 | 全量引入 |
| 国际流行度 | ⭐ 目前 GitHub 增长最快 | 成熟 | 国内主流 |
| 主要优势 | 代码所有权、Tailwind 原生 | 组件最完整 | 国内生态好 |

选 shadcn/ui 的核心理由：**代码所有权**——组件代码在你的仓库里，可以任意修改，不受 npm 版本约束。配合 Tailwind v4，体积最小。

---

**Q2：shadcn/ui 不是一个 npm 包，那怎么"安装"？**

A：`npx shadcn@latest add button` 本质是把组件源码**复制**到你的 `src/components/ui/` 目录。所以：
- `package.json` 里不会有 `shadcn/ui` 这个依赖
- 只有底层依赖（`@radix-ui/*`, `class-variance-authority` 等）
- 你拥有这些文件，可以随意修改

---

## 二、HttpOnly Cookie 原理

**Q3：BFF 返回 `Set-Cookie: access_token=...;HttpOnly` 后，前端需要做什么？**

A：**什么都不用做。** 这是 HttpOnly Cookie 的核心机制：

```
BFF → 响应头：Set-Cookie: access_token=xxx; HttpOnly; Secure; SameSite=Strict
浏览器 → 自动存储 Cookie
浏览器 → 之后每个请求自动携带：Cookie: access_token=xxx
```

前端代码：
- ✅ 不能读取（`document.cookie` 看不到 HttpOnly Cookie）
- ✅ 不需要手动存储（localStorage、sessionStorage 都不需要）
- ✅ 不需要手动注入请求头（浏览器自动携带）
- ✅ 防止 XSS 攻击（JS 无法窃取 token）

唯一需要的是 Axios 配置 `withCredentials: true`，告诉浏览器跨域请求也要带 Cookie。

---

**Q4：既然浏览器自动发 Cookie，为什么 401 重试时也不需要手动注入 token？**

A：因为 Cookie 是浏览器级别的存储。调用 `POST /auth/refresh` 后，BFF 通过 `Set-Cookie` 更新 Cookie。之后重试原请求时，浏览器**自动**带上新 Cookie，无需前端任何操作。

这与 localStorage 方案的区别：localStorage 方案需要前端读出新 token 再手动塞到请求头 `Authorization: Bearer <token>`。

---

## 三、状态管理选型

**Q5：为什么用 Zustand 而不是 Redux？**

A：

| | Zustand | Redux |
|---|---|---|
| 代码量 | 极少（10行搞定一个 store） | 大量模板代码（action/reducer/selector） |
| 学习曲线 | 平缓 | 陡峭 |
| 适用场景 | 中小型、局部状态 | 大型应用、复杂异步流 |
| 异步方案 | 直接在 action 里 async/await | 需要 thunk/saga/observable |
| DevTools | ✅ 支持 | ✅ 支持 |
| React 外使用 | ✅ `getState()` 直接访问 | 需要额外配置 |

本项目选 Zustand 的理由：用户信息只有几个字段，**没有复杂异步流**，Zustand 代码更清晰，且可在拦截器（非 React 组件）里通过 `useAuthStore.getState().clearUser()` 直接访问。

---

**Q6：Redux 什么时候才真正有价值？**

A：Redux 的价值在其中间件生态：
- `redux-saga`：复杂的异步流（竞态、取消、重试、信道通信）
- `redux-observable`：RxJS 流式处理
- `redux-thunk`：简单异步（现在 Zustand 也能做）

当业务逻辑复杂到需要"状态机"级别的管理时（比如多步骤表单、实时协同编辑），Redux 才有优势。

---

## 四、Axios 拦截器架构

**Q7：Loading 计数器为什么用 counter 而不是 boolean？**

A：Boolean 在并发请求下会提前隐藏 overlay：

```
时间轴（boolean 方案）：
t=0: 请求A开始 → isLoading=true  ✅
t=1: 请求B开始 → isLoading=true  ✅
t=2: 请求A完成 → isLoading=false ❌ B 还在飞，overlay 消失了！
t=3: 请求B完成 → isLoading=false ✅
```

Counter 方案：
```
t=0: 请求A开始 → count=1, isLoading=true  ✅
t=1: 请求B开始 → count=2, isLoading=true  ✅
t=2: 请求A完成 → count=1, isLoading=true  ✅（还有B在飞）
t=3: 请求B完成 → count=0, isLoading=false ✅
```

`isLoading = count > 0`，只有所有请求都完成才隐藏。

---

**Q8：为什么 counter 需要下限保护 `Math.max(0, count - 1)`？**

A：防止计数器变负数，导致后续请求永远无法让 `isLoading` 变 true。

场景：页面刚加载时某些路径可能会直接抛错（如网络断开），没有经过 request 拦截器（increment），却触发了 response error 拦截器（decrement）。没有下限的话 count 会变 -1，之后一个请求进来 count 变 0，overlay 永远不显示。

---

**Q9：`{ silent: true }` 怎么实现"某个请求不触发 loading"？**

A：通过扩展 Axios 的 `AxiosRequestConfig` 类型：

```ts
// types.ts
declare module 'axios' {
  interface AxiosRequestConfig {
    silent?: boolean
  }
}

// loading.ts
instance.interceptors.request.use((config) => {
  if (!config.silent) {
    useLoadingStore.getState().increment()
  }
  return config
})
```

调用方：`http.post('/auth/refresh', null, { silent: true })`

---

**Q10：BFF 响应 envelope 是什么？为什么要在拦截器里统一解包？**

A：BFF 统一返回格式：
```json
{ "code": "OK", "message": "success", "data": { "id": 1, "name": "Alice" } }
{ "code": "bff-2001", "message": "用户不存在", "data": null, "traceId": "abc-123" }
```

在 error 拦截器里统一解包的好处：
```ts
// 没有解包：每个调用方都要这样写
const res = await http.get('/users/1')
return res.data.data  // 每次都要 .data.data

// 有解包后：
const user = await http.get('/users/1')
return user  // 直接就是数据
```

**调用方零感知**，完全不需要了解 envelope 格式。

---

## 五、401 队列刷新机制

**Q11：T011 的核心流程是什么？**

A：
```
1. 请求A → 401
2. 检查 isRefreshing？
   → false：设为 true，发起 POST /auth/refresh
   → true：把"重试请求A"的 resolve/reject 放入 queue[]

3. 此时请求B也来了 → 401
   → isRefreshing=true：进 queue[]

4. /auth/refresh 成功：
   → flushQueue()：执行 queue 中所有 resolve（重试 A、B）
   → isRefreshing=false

5. /auth/refresh 失败：
   → flushQueue(err)：执行所有 reject
   → clearUser() + redirect('/login')
```

**关键设计**：只有一个 refresh 请求，多个并发 401 都等它完成后复用结果。

---

**Q12：为什么 refresh 接口本身返回 401 时需要特殊处理？**

A：防止无限循环。如果不处理：
```
/protected → 401 → 发起 /auth/refresh → 401 → 又发起 /auth/refresh → 死循环
```

处理方式：在拦截器里加守卫：
```ts
if (config.url === '/auth/refresh') {
  clearUser()
  redirect('/login')
  return Promise.reject(error)  // 直接拒绝，不再触发重试
}
```

---

**Q13：为什么把 `isRefreshing` 和 `queue` 放在闭包里而不是模块级？**

A：模块级变量在测试间共享状态，会导致测试污染（一个测试的 `isRefreshing=true` 影响下一个测试）。

闭包方案：每次 `applyAuthInterceptor(instance)` 调用都创建独立的状态，每个 axios 实例有自己的刷新锁，测试间完全隔离。

---

## 六、middleware.ts 路由守卫

**Q14：为什么要用 middleware.ts 而不是在每个页面组件里判断？**

A：

| 方案 | 问题 |
|------|------|
| 页面组件里判断 | 页面 HTML 已下发到浏览器，再跳转有闪屏（先看到页面内容再被踢走） |
| API 请求时判断 | 拿到 401 后才跳转，用户已经看到了空页面骨架 |
| middleware.ts | **服务端直接重定向**，HTML 根本不下发，体验最好 |

middleware.ts 在 Next.js 的 Edge Runtime 里运行，在页面渲染之前就完成了鉴权跳转。

---

**Q15：middleware.ts 的缺点是什么？**

A：两个主要限制：

1. **Edge Runtime 限制**：不能运行 Node.js API（如 `jsonwebtoken`），只能用 Web Crypto API 验签，或用 `jose` 库
2. **只能检查 Cookie 存在性，不能验证 JWT 有效性**（签名验证成本较高）

实际方案：middleware 做"快速检查"（cookie 存在？），真正的 JWT 验证在 BFF 做。即使 cookie 存在但已过期，第一个 API 请求会触发 T011 的 401 刷新流程。两层防御：middleware 防无 cookie 的明显未登录，BFF 防 token 过期或篡改。

---

**Q16：middleware.ts 的 `?from=pathname` 参数有什么用？**

A：记录用户原本想访问的页面，登录成功后可以跳回去（"登录后跳回原页面"体验）：

```ts
// middleware.ts
loginUrl.searchParams.set('from', pathname)
// → /login?from=/dashboard/orders

// login/page.tsx（登录成功后）
const from = searchParams.get('from') ?? '/dashboard'
router.push(from)
```

---

## 七、Zustand 状态持久化

**Q17：为什么用 `sessionStorage` 而不是 `localStorage`？**

A：

| | sessionStorage | localStorage |
|---|---|---|
| 生命周期 | 关闭标签页清除 | 永久保存 |
| 安全性 | 稍好 | 略差（长期存在） |
| 适用场景 | 登录会话 | 用户偏好设置 |

用户关闭浏览器/标签页后，`sessionStorage` 自动清除，下次打开需重新登录。这符合大多数企业系统的安全要求。

---

**Q18：Zustand 的 `persist` 中间件如何工作？**

A：
```ts
persist(
  (set) => ({ user: null, setUser, clearUser }),
  {
    name: 'auth-store',          // storage key
    storage: {                    // 自定义 storage 实现
      getItem: (name) => JSON.parse(sessionStorage.getItem(name)),
      setItem: (name, value) => sessionStorage.setItem(name, JSON.stringify(value)),
      removeItem: (name) => sessionStorage.removeItem(name),
    }
  }
)
```

每次 `set()` 调用后，persist 中间件自动把最新状态序列化写入 storage。初始化时从 storage 恢复状态（hydration）。

---

## 八、Logout 设计

**Q19：Logout 为什么要做"fail-safe"？**

A：logout 的目的是让用户登出，即使服务器挂了也要让用户"感觉"登出了：

```ts
async function logout() {
  try {
    await http.post('/auth/logout')  // 告知 BFF 删除 Redis refresh key
  } catch {
    // 网络断开、服务器挂了 → 忽略
  } finally {
    // 无论如何都执行：
    clearUser()         // 清除 Zustand 状态
    redirect('/login')  // 跳转登录页
  }
}
```

**如果不 fail-safe**：logout 接口偶尔超时，用户点了"退出"却什么都没发生，体验很差。

注意：BFF 侧的 refresh token 可能没被删除（离线状态），但 access token 只有 15 分钟，安全风险可控。

---

## 九、前端工程化

**Q20：Tailwind v3 升级到 v4 有哪些破坏性变化？**

A：核心变化——从 JS 配置转向 CSS 优先：

```css
/* v3 */
@tailwind base;
@tailwind components;
@tailwind utilities;

/* v4 */
@import "tailwindcss";
@theme inline {
  --color-border: var(--border);  /* CSS 变量映射为 utility */
}
```

- `postcss.config.mjs`：`tailwindcss` → `@tailwindcss/postcss`
- `tailwind.config.ts` 可以删掉（配置移到 CSS）
- shadcn/ui 4.x **要求** Tailwind v4

---

**Q21：为什么选 vitest 而不是 Jest 做前端单元测试？**

A：

| | vitest | Jest |
|---|---|---|
| 配置 | 复用 vite.config，零配置 | 需要独立配置 babel/ts 转换 |
| 速度 | 更快（原生 ESM） | 较慢（CommonJS 转换） |
| API | 兼容 Jest（同名 API） | Jest 原生 |
| Watch 模式 | 极快（基于 Vite HMR） | 一般 |

对于已用 Vite/Next.js 的项目，vitest 几乎零配置。本项目 jsdom 有 ESM 兼容问题，换 `happy-dom` 解决。

---

**Q22：`await Promise.resolve()` 在测试里是什么技巧？**

A：让微任务队列执行一次，让 Axios 请求拦截器有机会运行：

```ts
const req = instance.get('/test')
// 此时请求拦截器还在微任务队列里，未执行
// count 仍然是 0

await Promise.resolve()  // 让出控制权，执行一次微任务队列
// 现在请求拦截器已执行（count = 1），响应还在等待（delayResponse: 20ms）
expect(count).toBe(1)  // ✅

await req  // 等待响应完成
expect(count).toBe(0)  // ✅
```

原理：JavaScript 是单线程，`await Promise.resolve()` 相当于把后续代码放到微任务队列尾部，先让之前排队的微任务（Axios 拦截器）执行。

---

## 十、架构全局视角

**Q23：整个前端认证体系的请求流是什么？**

A：
```
用户请求页面
    ↓
middleware.ts（Edge Runtime）
    ├─ 无 Cookie → redirect /login
    └─ 有 Cookie → 放行，渲染页面

页面发起 API 请求（http.get/post）
    ↓
Loading 拦截器（request）→ count++
    ↓
Auth 拦截器 → 无需操作（Cookie 自动携带）
    ↓
BFF 处理请求
    ├─ 200 → Error 拦截器解包 envelope → 返回 data
    └─ 401 → Auth 拦截器
               ├─ 发起 POST /auth/refresh（silent）
               │   ├─ 成功 → 重试原请求 → 200 → 返回 data
               │   └─ 失败 → clearUser() + redirect /login
               └─ Loading 拦截器（response/error）→ count--
```

---

**Q24：为什么 `http` 是 singleton（单例）？如果有多个 axios 实例会怎样？**

A：singleton 确保所有请求共享同一个拦截器链，特别是 auth 拦截器里的 `isRefreshing` 锁。

如果有多个实例：
- 实例A 的拦截器和实例B 的拦截器各有自己的 `isRefreshing`
- 可能同时发出多个 `/auth/refresh` 请求（竞态条件）
- 第一个 refresh 成功后，第二个可能让 refresh token 失效（单次使用）

因此整个应用应该只有一个 `http` 实例，一个刷新锁。

---

> 文档生成：2026-06-26
> 覆盖 TASK-AUTH-0006（T009 + T010 + T011）
> 共 24 道问题
