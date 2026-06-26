# Auth Feature Spec

> **Status:** active  
> **Related tasks:** TASK-AUTH-0001, TASK-AUTH-0002, TASK-AUTH-0003, TASK-AUTH-0004, TASK-AUTH-0005  
> **Last updated:** 2026-06-26

---

## Background

Phase 0 created the `employees` table (V2) with `password_hash VARCHAR(255)` nullable. Phase 1
requires Core to expose an internal-only credential verification endpoint so BFF can authenticate
employees via email + bcrypt before issuing JWTs.

---

## Goals

1. Add `POST /internal/auth/verify` — validate email + bcrypt password, return employee info.
2. Restrict endpoint to internal callers via `INTERNAL_API_KEY` header (no default value — startup fails if unset).
3. Enforce `password_hash NOT NULL` via Flyway migration V7.
4. Seed 1 admin + 2 employee accounts in `dev`/`test` environments only (`@Profile`).
5. Establish system-wide error code convention: service-prefixed enum (`CoreErrorCode`).

---

## Out of Scope

- JWT issuance (T007, BFF).
- GitHub OAuth / OIDC (T012–T014, T097–T099).
- Role/permission management beyond seeding existing roles.

---

## 1. Database Migration

> Related task: TASK-AUTH-0001

```sql
-- V7__add_password_hash_not_null.sql
-- ⚠️ T013 Amendment Required: OAuth-only employees may need this constraint relaxed.
ALTER TABLE employees ALTER COLUMN password_hash SET NOT NULL;
```

---

## 2. API Contract

### POST /internal/auth/verify

```
POST /internal/auth/verify
Header: INTERNAL_API_KEY: <value>
Body:   { "email": "...", "password": "..." }
```

**Success `200`:**
```json
{ "code": "OK", "message": "success", "data": { "id": 1, "name": "Admin", "email": "...", "isActive": true, "roles": ["admin"] } }
```

**Error (example):**
```json
{ "code": "core-1001", "message": "Invalid credentials", "data": null, "traceId": "<uuid>" }
```

### Response Envelope

```
// Success
{ "code": "OK", "message": "success", "data": <T> }

// Error (traceId on errors only)
{ "code": "<error-code>", "message": "<text>", "data": null, "traceId": "<uuid>" }
```

`traceId`: Core generates UUID per request (MDC). BFF should forward `X-Trace-Id` header (T007 follow-up).

---

## 3. Error Code Convention (System-wide)

| Service | Prefix | Range |
|---------|--------|-------|
| core | `core` | `core-1xxx` |
| bff | `bff` | `bff-2xxx` |
| thirdparty-connector | `tpc` | `tpc-3xxx` |
| shop | `shop` | `shop-4xxx` |
| message | `msg` | `msg-5xxx` |
| data | `data` | `data-6xxx` |

Propagation rule: BFF passes downstream `code` values through to frontend unchanged.
All exceptions mapped through `CoreErrorCode` enum — raw exceptions never reach the response.

### CoreErrorCode Enum

| Code | HTTP | Scenario |
|------|------|----------|
| `core-1001` | 401 | Invalid credentials (email not found OR password mismatch — prevents enumeration) |
| `core-1002` | 403 | Account disabled |
| `core-1003` | 401 | Missing or invalid INTERNAL_API_KEY |
| `core-1010` | 400 | Request validation failed |
| `core-1099` | 500 | Unexpected internal error |

---

## 4. Employee Seeder

Active under `@Profile({"dev","test"})` only. Idempotent (skips if email already exists).

| Email | Password | Role |
|-------|----------|------|
| `admin@points-mall.com` | `Admin@123` | admin |
| `alice@points-mall.com` | `Employee@123` | employee |
| `bob@points-mall.com` | `Employee@123` | employee |

BCrypt strength: 12 rounds.

---

## 5. Component Structure

```
com.pointsmall.core
├── common/
│   ├── ApiResponse.java
│   └── exception/
│       ├── CoreErrorCode.java
│       ├── BusinessException.java
│       └── GlobalExceptionHandler.java
├── config/
│   ├── FilterConfig.java
│   └── SecurityConfig.java
├── employee/
│   ├── Employee.java
│   ├── EmployeeRepository.java
│   └── EmployeeSeeder.java
└── internal/auth/
    ├── AuthVerifyController.java
    ├── EmployeeAuthService.java
    └── dto/{VerifyRequest,VerifyResponse}.java
```

---

## 6. Security Notes

- **User enumeration prevention**: Both "email not found" and "wrong password" return the same `core-1001` code and message. `isActive` check comes after password check.
- **Constant-time comparison**: `INTERNAL_API_KEY` compared via `MessageDigest.isEqual()` to prevent timing side-channel attacks.
- **Filter registration**: `InternalApiKeyFilter` registered only via `FilterRegistrationBean` (no `@Component`) to avoid double registration bug.
- **`password` field** must not appear in any log output.

---

## Change Log

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0 | 2026-06-26 | AI | Initial: auth verify API, error code convention, seeder, security notes (TASK-AUTH-0001) |

---

## 7. Token Refresh Endpoint (T008 — TASK-AUTH-0003)

> Related task: TASK-AUTH-0003

### Background

TASK-AUTH-0002 issues `access_token` (15 min HttpOnly cookie) and stores `refresh:{userId}` in Redis (7 days TTL). This section completes the token lifecycle with refresh and logout.

### POST /auth/refresh

```
POST /auth/refresh
Cookie: access_token=<expired or valid JWT>
(No Authorization header required — @Public)
```

**Flow:**
1. Read `access_token` cookie
2. `jwtService.decode()` — accepts expired tokens, returns `null` on malformed input
3. Extract `sub` (userId) from payload
4. `redis.exists('refresh:{userId}')` — check server-side session validity
5. On success: sign new JWT, `Set-Cookie: access_token=<new>; HttpOnly; Secure; SameSite=Strict`

**Success `200`:**
```json
{ "code": "OK", "data": { "user": { "id": 1, "email": "...", "roles": ["employee"] } } }
```

**Error responses:**

| Code | HTTP | Scenario |
|------|------|----------|
| `bff-2003` | 401 | Token missing, malformed, or decode returns null |
| `bff-2004` | 401 | Redis key `refresh:{userId}` does not exist (session expired or logged out) |

**Key design decision:** `jwtService.decode()` (not `verify()`) is used — verify() rejects expired tokens, but refresh is specifically for expired access tokens. Redis key is the source of truth for session validity.

**Redis refresh key is NOT renewed** on `/auth/refresh` calls — only a new access token is issued.

### POST /auth/logout

```
POST /auth/logout
Cookie: access_token=<valid JWT>
(Protected — JwtAuthGuard applies)
```

**Flow:**
1. JwtAuthGuard validates access token → extracts `req.user.sub` (userId)
2. `redis.del('refresh:{userId}')` — server-side session invalidation
3. `res.clearCookie('access_token', { path: '/' })` — clear client cookie

**Success `200`:** `{ "code": "OK", "data": null }`

After logout, any subsequent `/auth/refresh` call returns `bff-2004`.

### Error Code Updates

| Code | HTTP | Scenario |
|------|------|----------|
| `bff-2003` | 401 | Invalid / missing access_token (decode failure) |
| `bff-2004` | 401 | Session expired — Redis refresh key not found |

---

## 8. JWT Validation Middleware — All Downstream Services (T015 — TASK-AUTH-0004)

> Related task: TASK-AUTH-0004

### Background

All downstream services (shop, message, data, tpc) previously had no authentication. This adds defense-in-depth: each service independently validates the JWT Bearer token, rejecting unauthorized requests even if BFF is bypassed (internal network intrusion, misconfiguration).

BFF is the sole entry point. When calling downstream services, BFF forwards the user's JWT as `Authorization: Bearer <token>`. Downstream services decode the token to extract `userId`.

### Design Principles

- Algorithm: HS256, shared `JWT_SECRET` across all services
- Header: `Authorization: Bearer <token>`
- `/health` endpoint excluded from auth on all services (required by load balancers / k8s probes)
- Uniform error format: `{ "code": "<svc>-xxxx", "message": "Unauthorized", "data": null }`

### Service Implementations

| Service | Framework | Mechanism | Error Code |
|---------|-----------|-----------|------------|
| shop | Laravel (PHP) | `JwtAuthMiddleware` implements `Middleware` | `shop-4001` |
| message | Express (Node.js) | `jwtAuth` middleware function | `msg-5001` |
| data | FastAPI (Python) | `verify_token` + `Depends()` | `data-6001` |
| tpc | Spring WebFlux (Java) | `JwtAuthWebFilter` implements `WebFilter` | `tpc-7001` |

#### Shop (Laravel)
```php
// app/Http/Middleware/JwtAuthMiddleware.php
// Registered on api group in bootstrap/app.php
// /api/health excluded via withoutMiddleware()
JWT::decode($token, new Key($secret, 'HS256'));
```
Library: `firebase/php-jwt` v7 (requires HMAC key ≥ 32 chars)

#### Message (Express)
```typescript
// src/middleware/jwtAuth.ts
// /health registered BEFORE app.use(jwtAuth) in index.ts
jwt.verify(token, secret, { algorithms: ['HS256'] })
```
Library: `jsonwebtoken`

#### Data (FastAPI)
```python
# app/dependencies/auth.py
# Applied as dependencies=[Depends(verify_token)] on protected routes
# /health has no Depends
jwt.decode(token, secret, algorithms=["HS256"], options={"verify_sub": False})
```
Library: `PyJWT` 2.x (`verify_sub: False` required — BFF issues integer `sub`, PyJWT expects string)

#### TPC (Spring WebFlux)
```java
// com.pointsmall.thirdparty.security.JwtAuthWebFilter
// Registered as @Bean WebFilter in SecurityConfig
// Reactive: returns Mono<Void>, uses ServerWebExchange
Jwts.parser().verifyWith(signingKey).build().parseSignedClaims(token)
```
Library: `io.jsonwebtoken:jjwt-api` 0.12.x

### Core vs Other Services

`points-mall-core` uses `INTERNAL_API_KEY` (not JWT) because its `/internal/auth/verify` endpoint is called **before** a JWT exists (it is the credential verification step that precedes JWT issuance). This is by design — the auth system's source cannot be authenticated by itself. Core follows **Mixed Authentication**: API Key for pre-auth endpoints, JWT for future user-context endpoints.

---

## Change Log

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0 | 2026-06-26 | AI | Initial: auth verify API, error code convention, seeder, security notes (TASK-AUTH-0001) |
| 1.1 | 2026-06-26 | AI | Added T007: JWT issuance, HttpOnly cookie, Redis refresh key, global AuthGuard (TASK-AUTH-0002) |
| 1.2 | 2026-06-26 | AI | Added T008: refresh/logout endpoints, bff-2003/bff-2004 error codes (TASK-AUTH-0003) |
| 1.3 | 2026-06-26 | AI | Added T015: JWT middleware for shop/message/data/tpc, defense-in-depth design (TASK-AUTH-0004) |
| 1.4 | 2026-06-26 | AI | Added T100: AppShell layout component in frontend-base (TASK-AUTH-0005) |

---

## 6. AppShell Layout Component (`@points-mall/frontend-base`)

> Related task: TASK-AUTH-0005 · Full design: `docs/superpowers/specs/2026-06-26-frontend-base-appshell-design.md`

### Background

`frontend-base` is a shared npm package (`@points-mall/frontend-base`) consumed by multiple teams.
HTTP infrastructure (T009, T011) was scoped out — each team has its own BFF conventions. The
genuinely reusable piece is the **application shell**: every team needs the same navigation frame.

### Goals

1. `AppShell` component with collapsible Sidebar, fixed Header, auto-computed Breadcrumb.
2. 100% props-driven — no API calls inside the component.
3. Sidebar: 240 px expanded / 64 px collapsed, 300 ms CSS transition, state persisted in `localStorage`.
4. Header: logo + title (left), notification bell with badge + user avatar dropdown (right).
5. Breadcrumb: auto-computed by walking `menuItems` tree against current pathname.
6. Hardcoded default dark-sidebar style (`#001529`); consumers override via `.pm-sidebar` / `.pm-header` CSS classes.
7. Zero runtime deps beyond React; CSS Modules bundled inline by `rollup-plugin-postcss`.

### Out of Scope

- Axios / HTTP client (each consuming app owns this).
- Silent token refresh (each consuming app owns this).
- User profile page content.
- i18n / theme switching.

### Component API

```ts
interface AppShellProps {
  title: string
  logo?: React.ReactNode
  menuItems: MenuItem[]
  user: { name: string; avatar?: string }
  notificationCount?: number
  onNotificationClick?: () => void
  onProfileClick?: () => void
  onLogout: () => void
  collapsed?: boolean                    // controlled mode
  onCollapsedChange?: (v: boolean) => void
  currentPath?: string                   // defaults to window.location.pathname
  children: React.ReactNode
}

interface MenuItem {
  key: string
  label: string
  icon?: React.ReactNode
  path?: string
  children?: MenuItem[]                  // nested menus supported
}
```

### Layout Structure

```
┌──────────────────────────────────────────────┐
│  Header (sticky top, z-index 10)              │
│  [Breadcrumb]            [Bell] [Avatar▾]     │
├────────────┬─────────────────────────────────┤
│            │                                 │
│  Sidebar   │   <children /> (pm-content)     │
│ 240/64px   │   padding: 24px                 │
│ dark navy  │                                 │
└────────────┴─────────────────────────────────┘
```

### CSS Override Classes

| Class | Element |
|-------|---------|
| `.pm-shell` | Root wrapper |
| `.pm-sidebar` | Sidebar `<aside>` |
| `.pm-header` | Header `<header>` |
| `.pm-content` | Main content `<div>` |
| `.pm-breadcrumb` | Breadcrumb `<nav>` |
