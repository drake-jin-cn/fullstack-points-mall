# T009–T011 Frontend Auth Infrastructure Design

**Date:** 2026-06-26  
**Tasks:** T009 · T010 · T011  
**Status:** approved  
**Stack:** Next.js 16 · React 19 · Tailwind CSS · shadcn/ui · Sonner · Zustand · Axios

---

## Background

The frontend (`points-mall-frontend`) is a near-empty Next.js app. T009–T011 establish the
foundational HTTP layer, authentication UI, and token lifecycle management that all subsequent
frontend features will build on.

The BFF issues `access_token` as an `HttpOnly; Secure; SameSite=Strict` cookie — the browser
stores and sends it automatically. The frontend never reads or stores the raw JWT token; it only
stores the user's profile info in memory (Zustand).

---

## Goals

1. **T009** — Shared Axios instance with `withCredentials: true`; global fullscreen loading
   overlay driven by a request counter; global toast on API errors; per-request `silent` opt-out;
   response envelope unwrapped transparently.
2. **T010** — Login page with React Hook Form + Zod validation; store user info in
   `useAuthStore`; redirect to `/dashboard` on success.
3. **T011** — On 401, pause the failed-request queue, call `POST /auth/refresh`, replay all
   queued requests; on refresh failure, clear auth state and redirect to `/login`.

---

## Out of Scope

- Route-level auth guard (middleware.ts) — separate task.
- GitHub OAuth / SSO login buttons (T014, T099).
- Weak-network retry configuration (T087).
- AppShell layout component (T100 / TASK-AUTH-0005).

---

## Architecture

### File Structure

```
points-mall-frontend/src/
├── lib/
│   └── http/
│       ├── instance.ts              # Base axios instance
│       ├── interceptors/
│       │   ├── loading.ts           # Request counter → loading store
│       │   ├── error.ts             # Toast on API errors + envelope unwrap
│       │   └── auth.ts              # 401 → refresh → queue replay
│       └── index.ts                 # Compose interceptors, export http singleton
│
├── store/
│   ├── useAuthStore.ts              # Zustand: user info (persisted to sessionStorage)
│   └── useLoadingStore.ts           # Zustand: global loading counter
│
├── components/
│   ├── providers/
│   │   └── AppProviders.tsx         # Mount <Toaster /> + <LoadingOverlay />
│   └── ui/
│       └── LoadingOverlay.tsx       # Fullscreen backdrop + spinner
│
└── app/
    ├── layout.tsx                   # Wrap with <AppProviders>
    └── (auth)/
        └── login/
            └── page.tsx             # Login page (T010)
```

### Data Flow

```
Request dispatched
  → loading.ts: counter +1 → LoadingOverlay visible  (skipped if silent: true)
  → Browser auto-attaches HttpOnly cookie (withCredentials: true)
  → BFF responds
  ├─ Success (code === "OK"):
  │    error.ts unwraps response.data.data
  │    loading.ts: counter -1
  └─ Error:
       ├─ 401 → auth.ts: queue + refresh flow
       └─ Other → error.ts: toast.error(message), counter -1
```

---

## T009 — Axios Infrastructure

### `lib/http/instance.ts`

```ts
import axios from 'axios'

export const http = axios.create({
  baseURL: process.env.NEXT_PUBLIC_BFF_URL,
  timeout: 10_000,
  withCredentials: true,
})
```

### `lib/http/interceptors/loading.ts`

- **Request interceptor:** if `config.silent !== true`, call `useLoadingStore.getState().increment()`
- **Response interceptor (success + error):** if `config.silent !== true`, call `useLoadingStore.getState().decrement()`
- Uses a counter (not boolean) to correctly handle concurrent requests.

### `lib/http/interceptors/error.ts`

- **Response interceptor (success path):** if `response.data.code !== 'OK'`, call `toast.error(response.data.message)`, log `response.data.traceId` to console, and `return Promise.reject(response.data)`.
- **On success (`code === "OK"`):** return `response.data.data` (unwrap envelope).
- **Response interceptor (error path):** for non-401 HTTP errors, call `toast.error('网络异常，请稍后重试')`.

### `useLoadingStore`

```ts
interface LoadingState {
  count: number
  increment: () => void
  decrement: () => void
}
// isLoading derived: count > 0
```

### `LoadingOverlay`

Full-screen fixed backdrop (`bg-black/50`) with centered Tailwind CSS spinner. Rendered by `AppProviders`; subscribes to `useLoadingStore`.

### `AppProviders`

```tsx
export function AppProviders({ children }) {
  return (
    <>
      {children}
      <LoadingOverlay />
      <Toaster position="top-right" richColors />  {/* Sonner */}
    </>
  )
}
```

### Response Envelope Types

```ts
interface ApiResponse<T = unknown> {
  code: string
  message: string
  data: T
  traceId?: string   // present on error responses only
}
```

### Per-Request Silent Opt-Out

Extend axios config type:
```ts
declare module 'axios' {
  interface AxiosRequestConfig {
    silent?: boolean
  }
}
```

Usage: `http.get('/notifications/count', { silent: true })`

---

## T010 — Login Page + useAuthStore

### `store/useAuthStore.ts`

```ts
interface AuthUser {
  id: number
  name: string
  email: string
  roles: string[]
}

interface AuthState {
  user: AuthUser | null
  setUser: (user: AuthUser) => void
  clearUser: () => void
}
```

Persisted to `sessionStorage` via Zustand `persist` middleware — survives page refresh,
cleared on browser tab close.

### Login Form

**Zod schema:**
```ts
const loginSchema = z.object({
  email: z.string().email('请输入有效邮箱'),
  password: z.string().min(6, '密码至少 6 位'),
})
```

**Flow:**
1. React Hook Form validates via Zod (client-side, no request).
2. On valid: `http.post('/auth/login', { email, password })`.
3. Loading overlay appears automatically (T009).
4. BFF sets `Set-Cookie: access_token` — browser stores it, frontend does nothing.
5. Response `data`: `{ user: { id, name, email, roles } }`.
6. `authStore.setUser(user)` → `router.push('/dashboard')`.
7. On failure: `toast.error` fires automatically (T009). No per-page error handling needed.

### Login Page Visual (Option C)

- Full-screen dark gradient background: `from-slate-950 to-indigo-950`
- Frosted glass card: `backdrop-blur-md bg-white/10 border border-white/20`
- Indigo gradient submit button: `from-indigo-500 to-purple-600`
- Logo mark + title centered above form
- Redirect to `/dashboard` if already authenticated (check `useAuthStore.user` on mount)

---

## T011 — Silent Token Refresh Interceptor

### State Variables (module-level, not React state)

```ts
let isRefreshing = false
let queue: Array<{
  resolve: (value: unknown) => void
  reject:  (reason: unknown) => void
  config:  InternalAxiosRequestConfig
}> = []
```

### Response Interceptor Logic (401 path)

```
Receive 401
  ├─ Request URL is /auth/refresh?
  │    → reject queue + clearUser() + router.push('/login')
  │    → isRefreshing = false, queue = []
  │
  ├─ isRefreshing === true
  │    → push { resolve, reject, config } to queue
  │    → return new Promise (stays pending until queue is flushed)
  │
  └─ isRefreshing === false  (first 401)
       → isRefreshing = true
       → await http.post('/auth/refresh', {}, { silent: true })
       ├─ Success:
       │    BFF issued new Set-Cookie automatically
       │    → replay all queued requests (no token injection needed — cookie updated)
       │    → resolve each queued Promise with retry result
       │    → isRefreshing = false, queue = []
       └─ Failure:
            → reject all queued Promises
            → clearUser() + router.push('/login')
            → isRefreshing = false, queue = []
```

### Why No Token Injection on Retry

Because the BFF uses `HttpOnly` cookies, the browser automatically sends the new `access_token`
cookie on every retry. Unlike a `localStorage`/`Authorization: Bearer` approach, there is no
token to inject into request headers — the retry is simply `return http(config)`.

### Infinite Loop Guard

The interceptor checks `config.url === '/auth/refresh'` before entering the refresh flow.
If the refresh endpoint itself returns 401, it short-circuits to logout immediately.

---

## Acceptance Criteria (draft — pending human confirmation)

### T009
- [ ] AC-01: All requests show fullscreen loading overlay; overlay hides only after all concurrent requests complete.
- [ ] AC-02: Requests with `{ silent: true }` do not trigger the loading overlay.
- [ ] AC-03: BFF error responses (`code !== "OK"`) display `message` in a toast and reject the promise.
- [ ] AC-04: HTTP network errors (4xx/5xx non-401) display a generic toast error.
- [ ] AC-05: Successful responses return `data.data` directly (envelope unwrapped).
- [ ] AC-06: `traceId` from error responses is logged to browser console.
- [ ] AC-07: `NEXT_PUBLIC_BFF_URL` controls the base URL; missing env var causes a build-time warning.

### T010
- [ ] AC-08: Submitting an invalid email shows inline validation error without making an API call.
- [ ] AC-09: Password shorter than 6 characters shows inline validation error.
- [ ] AC-10: Successful login stores user info in `useAuthStore` and redirects to `/dashboard`.
- [ ] AC-11: Failed login shows toast error automatically (no per-page error handling).
- [ ] AC-12: Visiting `/login` while already authenticated redirects to `/dashboard`.
- [ ] AC-13: Page refresh preserves auth state (sessionStorage persistence).

### T011
- [ ] AC-14: On 401, the failed request is automatically retried after refresh succeeds.
- [ ] AC-15: Multiple concurrent 401 responses trigger only one `/auth/refresh` call.
- [ ] AC-16: All queued requests are replayed after a successful refresh.
- [ ] AC-17: If `/auth/refresh` fails (401), auth state is cleared and user is redirected to `/login`.
- [ ] AC-18: The refresh interceptor does not enter an infinite loop when `/auth/refresh` itself returns 401.

---

## Dependencies

| Task | Depends On | Reason |
|------|-----------|--------|
| T010 | T009 | Uses http instance and loading/toast layer |
| T011 | T009 | Attaches as an additional response interceptor |

---

## Change Log

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0 | 2026-06-26 | AI | Initial design: T009 Axios infra, T010 login page, T011 refresh interceptor |
