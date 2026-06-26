---
id: TASK-AUTH-0006
title: "Frontend auth infrastructure: Axios layer + login page + silent token refresh (T009-T011)"
status: dev-done
priority: high
assignee: ""
created: 2026-06-26
updated: 2026-06-26
depends_on:
  - TASK-AUTH-0003
services:
  - frontend
code_files: []
test_refs: []
wiki_refs:
  - .wiki/features/auth.md
---

## Raw Requirements

- **T009** `[frontend]` Axios infrastructure + global loading/toast layer: shared Axios instance with auth token injection and unified response/error handling; global fullscreen loading overlay while any request is in-flight, with per-request opt-out for silent background calls; global toast notifications on API errors; zero per-page setup.

- **T010** `[frontend]` Login page: email + password form with React Hook Form + Zod validation; call BFF login API via Axios instance from T009 (depends on T009); `access_token` is set automatically via BFF `Set-Cookie` — no manual token storage needed; store user info in `useAuthStore` (Zustand). Redirect to dashboard on success.

- **T011** `[frontend]` Silent token refresh interceptor: on 401 response, pause the failed request queue, call `/auth/refresh`, then replay all queued requests with the new token. If refresh also fails, clear auth state and redirect to login.

## Spec

> Full design: `docs/superpowers/specs/2026-06-26-t009-t011-axios-auth-design.md`

### Background

The frontend is a near-empty Next.js 16 app. T009–T011 establish the foundational HTTP layer,
authentication UI, and token lifecycle management that all subsequent frontend features depend on.

The BFF issues `access_token` as an `HttpOnly; Secure; SameSite=Strict` cookie. The browser
stores and sends it automatically — the frontend never touches the raw JWT. Frontend only stores
the user profile object in Zustand (persisted to `sessionStorage`).

### Goals

1. **T009** — Shared Axios instance (`withCredentials: true`); global fullscreen loading overlay
   driven by a request counter; Sonner toast on API errors; per-request `{ silent: true }` opt-out;
   BFF response envelope (`{ code, message, data, traceId? }`) transparently unwrapped.
2. **T010** — Login page (full-screen dark gradient + frosted glass card); React Hook Form + Zod
   validation; on success store user in `useAuthStore` and redirect to `/dashboard`; already-authed
   users redirected away from `/login`.
3. **T011** — 401 response interceptor: first 401 triggers `POST /auth/refresh`; all concurrent
   401s queue and replay after refresh succeeds; on refresh failure clear store and redirect to
   `/login`; infinite-loop guard on the refresh endpoint itself.
4. **Logout** — `POST /auth/logout` via BFF (clears Redis refresh key + cookie); then clear
   Zustand store and redirect to `/login`. Logout succeeds even if the API call fails (fail-safe).

### Out of Scope

- Route-level auth guard (`middleware.ts`) — now included in this task.
- GitHub OAuth / SSO login buttons (T014, T099).
- Weak-network retry / timeout config (T087).
- AppShell layout component (TASK-AUTH-0005).

### Technical Design

**UI stack additions:**
- `shadcn/ui` (component primitives, Tailwind-native)
- `sonner` (toast notifications)
- `zustand` (client state)
- `axios` (HTTP client)
- `react-hook-form` + `@hookform/resolvers` + `zod` (form validation)

**File structure:**
```
src/
├── lib/http/
│   ├── instance.ts              # axios.create({ withCredentials: true })
│   ├── interceptors/
│   │   ├── loading.ts           # counter-based overlay control
│   │   ├── error.ts             # envelope unwrap + toast
│   │   └── auth.ts              # 401 → refresh → queue replay
│   └── index.ts                 # compose + export http singleton
├── store/
│   ├── useAuthStore.ts          # { user, setUser, clearUser } + sessionStorage persist
│   └── useLoadingStore.ts       # { count, increment, decrement }
├── components/
│   ├── providers/AppProviders.tsx   # <LoadingOverlay> + <Toaster>
│   └── ui/LoadingOverlay.tsx        # fullscreen backdrop + spinner
└── app/
    ├── layout.tsx               # wrap with <AppProviders>
    └── (auth)/login/page.tsx    # login page
```

**Key decisions:**
- Loading uses a **counter** (not boolean) — concurrent requests don't hide overlay prematurely.
- `silent: true` on AxiosRequestConfig skips loading + toast (e.g. background polling).
- Cookie method means **no token injection on retry** — browser auto-sends updated cookie.
- `isRefreshing` + `queue[]` module-level state prevents duplicate refresh calls.

### Affected Files

| File Path | Change |
|-----------|--------|
| `points-mall-frontend/package.json` | add: axios, sonner, zustand, react-hook-form, @hookform/resolvers, zod, shadcn/ui deps |
| `points-mall-frontend/src/lib/http/instance.ts` | add |
| `points-mall-frontend/src/lib/http/interceptors/loading.ts` | add |
| `points-mall-frontend/src/lib/http/interceptors/error.ts` | add |
| `points-mall-frontend/src/lib/http/interceptors/auth.ts` | add |
| `points-mall-frontend/src/lib/http/index.ts` | add |
| `points-mall-frontend/src/store/useAuthStore.ts` | add |
| `points-mall-frontend/src/store/useLoadingStore.ts` | add |
| `points-mall-frontend/src/components/providers/AppProviders.tsx` | add |
| `points-mall-frontend/src/components/ui/LoadingOverlay.tsx` | add |
| `points-mall-frontend/src/app/layout.tsx` | modify: wrap with AppProviders |
| `points-mall-frontend/src/app/(auth)/login/page.tsx` | add |
| `points-mall-frontend/src/middleware.ts` | add: Edge Runtime cookie check, public route whitelist |
| `points-mall-frontend/src/lib/auth/logout.ts` | add: logout() helper — POST /auth/logout → clearUser → redirect |
| `points-mall-frontend/.env.example` | add: NEXT_PUBLIC_BFF_URL |

## Acceptance Criteria

- [ ] AC-01: All requests show fullscreen loading overlay; overlay hides only after all concurrent requests complete.
- [ ] AC-02: Requests with `{ silent: true }` do not trigger the loading overlay.
- [ ] AC-03: BFF error responses (`code !== "OK"`) display `message` in a Sonner toast and reject the promise.
- [ ] AC-04: HTTP network errors (non-401) display a generic toast "网络异常，请稍后重试".
- [ ] AC-05: Successful responses return `data.data` directly (envelope unwrapped — callers see plain data).
- [ ] AC-06: `traceId` from error responses is logged to browser console.
- [ ] AC-07: `NEXT_PUBLIC_BFF_URL` controls the base URL; undefined value is documented in `.env.example`.
- [ ] AC-08: Submitting an invalid email shows inline validation error without making an API call.
- [ ] AC-09: Password shorter than 6 characters shows inline validation error.
- [ ] AC-10: Successful login stores user info in `useAuthStore` and redirects to `/dashboard`.
- [ ] AC-11: Failed login shows toast error automatically (no per-page error handling needed).
- [ ] AC-12: Visiting `/login` while already authenticated redirects to `/dashboard`.
- [ ] AC-13: Page refresh preserves auth state (sessionStorage persistence).
- [ ] AC-14: On 401, the failed request is automatically retried after token refresh succeeds.
- [ ] AC-15: Multiple concurrent 401 responses trigger only one `POST /auth/refresh` call.
- [ ] AC-16: All queued requests are replayed after a successful refresh.
- [ ] AC-17: If `POST /auth/refresh` fails, auth state is cleared and user is redirected to `/login`.
- [ ] AC-18: The refresh interceptor does not enter an infinite loop when `/auth/refresh` itself returns 401.
- [ ] AC-19: 未登录用户（无 `access_token` cookie）访问内部路由，`middleware.ts` 服务端直接重定向到 `/login`，页面 HTML 不下发。`/login` 等公开路由不受拦截。
- [ ] AC-20: 请求出错（网络超时、4xx、5xx）时，loading 计数器正确 -1，overlay 正常隐藏，不会永久卡住。
- [ ] AC-21: `useLoadingStore.decrement()` 有下限保护，计数不会低于 0（防止 overlay 之后永久失效）。
- [ ] AC-22: T011 内部调用 `POST /auth/refresh` 时带 `{ silent: true }`，不触发 loading overlay 和 toast。
- [ ] AC-23: 调用 `logout()` 时：先调 `POST /auth/logout`（BFF 删除 Redis refresh key、清除 cookie），再 `clearUser()`，最后跳转 `/login`。即使接口调用失败，仍强制清除本地状态并跳转。

## Status Change History

| Time | Previous Status | New Status | Actor | Notes |
|------|-----------------|------------|-------|-------|
| 2026-06-26 | — | spec-pending | AI | Task created from T009+T010+T011 raw requirements; full design in docs/superpowers/specs/2026-06-26-t009-t011-axios-auth-design.md |
| 2026-06-26 | spec-pending | spec-ready | Human | AC confirmed (23 items) |
