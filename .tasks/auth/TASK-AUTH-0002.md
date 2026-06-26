---
id: TASK-AUTH-0002
title: "BFF JWT issuance strategy: POST /auth/login + global AuthGuard"
status: dev-done
priority: high
services:
  - bff
assignee: ""
created: 2026-06-26
updated: 2026-06-26
depends_on:
  - TASK-AUTH-0001
wiki_refs: []
code_files:
  - points-mall-bff/package.json
  - points-mall-bff/src/main.ts
  - points-mall-bff/src/app.module.ts
  - points-mall-bff/src/health/health.controller.ts
  - points-mall-bff/src/common/api-response.ts
  - points-mall-bff/src/common/global-exception.filter.ts
  - points-mall-bff/src/redis/redis.module.ts
  - points-mall-bff/src/redis/redis.service.ts
  - points-mall-bff/src/connectors/core/core-connector.module.ts
  - points-mall-bff/src/connectors/core/core-connector.service.ts
  - points-mall-bff/src/auth/auth.module.ts
  - points-mall-bff/src/auth/auth.controller.ts
  - points-mall-bff/src/auth/auth.service.ts
  - points-mall-bff/src/auth/dto/login.dto.ts
  - points-mall-bff/src/auth/guards/jwt-auth.guard.ts
  - points-mall-bff/src/auth/decorators/public.decorator.ts
  - points-mall-bff/.env.example
  - points-mall-bff/.env.test
test_refs:
  - points-mall-bff/src/auth/__tests__/auth.service.spec.ts
  - points-mall-bff/src/auth/__tests__/jwt-auth.guard.spec.ts
  - points-mall-bff/src/auth/__tests__/auth.controller.spec.ts
  - .tests/api/bff/auth/login-valid.bru
  - .tests/api/bff/auth/login-invalid-credentials.bru
  - .tests/api/bff/auth/login-missing-fields.bru
  - .tests/api/bff/auth/protected-no-token.bru
---

## Raw Requirements

`[bff]` JWT issuance strategy: on login, issue `access_token` (15 min) + `refresh_token` (7 days)
using `@nestjs/jwt`. `POST /auth/login` proxies credential validation to Core's
`POST /internal/auth/verify` via shared internal `INTERNAL_API_KEY` header (Core rejects calls
without it); issues `access_token` via `Set-Cookie: access_token=...; HttpOnly; Secure;
SameSite=Strict`; stores `refresh_token` in Redis (`refresh:{userId}`, TTL 7 days). Global
`AuthGuard` validates bearer token on all protected routes; `/auth/login` and `/auth/refresh` are
explicitly whitelisted.

## Spec

> After human review, extract acceptance criteria into the [Acceptance Criteria] section below
> and set status to `spec-ready`.
> Before merging the PR, archive this section to `.wiki/features/auth.md`,
> fill in `wiki_refs`

### Background

T006 (TASK-AUTH-0001) delivered Core's internal credential verification endpoint
`POST /internal/auth/verify`. The BFF is the only external-facing service; it receives login
requests from the browser, verifies credentials against Core, and is responsible for issuing and
managing JWTs. The frontend stores no token manually — the BFF sets the token via `Set-Cookie`.

### Goals

1. `POST /auth/login` — validate credentials via Core, issue `access_token` cookie + Redis refresh token.
2. Global `JwtAuthGuard` — reject all requests without a valid `access_token` cookie; whitelist `/auth/login` and `/auth/refresh`.
3. Forward `X-Trace-Id` header to Core on every internal call (T006 follow-up, enables end-to-end trace correlation).
4. Install `@nestjs/jwt`, `@nestjs/axios`, `ioredis`, `class-validator`, `class-transformer` as production dependencies.

### Out of Scope

- Token refresh endpoint (`POST /auth/refresh`) and logout (`POST /auth/logout`) — covered in T008.
- GitHub OAuth / OIDC login flows — T012–T014, T097–T099.
- Downstream service JWT validation — T015.

### Technical Design

#### Module Structure

```
src/
  auth/
    auth.module.ts
    auth.controller.ts
    auth.service.ts
    dto/
      login.dto.ts          # { email: string; password: string }
    guards/
      jwt-auth.guard.ts     # reads access_token from cookie
    decorators/
      public.decorator.ts   # @Public() marks a route as unauthenticated
  redis/
    redis.module.ts         # global ioredis provider
    redis.service.ts        # get / set / del helpers + TTL
  connectors/               # one sub-folder per downstream service
    core/
      core-connector.module.ts
      core-connector.service.ts  # ONLY calls CORE_SERVICE_URL; injects INTERNAL_API_KEY + X-Trace-Id
    # future: shop/, data/, thirdparty/, message/ — each with their own module+service
```

**Convention:** Each `*ConnectorService` is injected with exactly one `baseURL` (from env) and
exposes semantically named methods (`verifyCredentials`, `getEmployeeProfile`, …). This makes it
immediately clear at the call site which downstream service is involved, regardless of how many
internal APIs are added later.

#### Login Flow

```
Browser  ──POST /auth/login──▶  BFF AuthController
                                    │
                                    ▼
                              CoreConnectorService
                                    │ POST /internal/auth/verify
                                    │ Headers: INTERNAL_API_KEY, X-Trace-Id
                                    ▼
                                 Core Service
                                    │ 200: { id, name, email, isActive, roles }
                                    │ 401: invalid credentials
                                    │ 403: account disabled
                                    ▼
                              AuthService.issueTokens()
                                    │ sign access_token (15 min, JWT_SECRET)
                                    │ sign refresh_token (7 d, JWT_REFRESH_SECRET)
                                    │ redis.set(`refresh:{userId}`, refreshToken, 7d)
                                    ▼
                         Set-Cookie: access_token=<jwt>; HttpOnly; Secure; SameSite=Strict
                         Response body: { user: { id, name, email, roles } }
```

#### JWT Payload

```ts
interface JwtPayload {
  sub: number;   // employee id
  email: string;
  roles: string[];
  iat?: number;
  exp?: number;
}
```

#### Cookie Settings

| Attribute | Value |
|-----------|-------|
| `httpOnly` | `true` |
| `secure` | `true` in production; `false` in dev/test |
| `sameSite` | `'strict'` |
| `maxAge` | `15 * 60 * 1000` ms (15 min) |
| `path` | `/` |

`secure` is driven by `NODE_ENV`: production = `true`, otherwise = `false`. This lets dev/test run over HTTP without special setup.

#### Global AuthGuard

`JwtAuthGuard` is registered as a global `APP_GUARD` in `AppModule`. It:
1. Reads the `access_token` cookie from the incoming request.
2. Verifies the token with `JwtService.verify()` using `JWT_SECRET`.
3. Attaches the decoded payload to `request.user`.
4. Throws `UnauthorizedException` (HTTP 401) if the cookie is absent or the token is invalid/expired.
5. Skips verification for any handler decorated with `@Public()`.

`/auth/login` and `/auth/refresh` are decorated with `@Public()`.

#### X-Trace-Id Forwarding

`CoreConnectorService` generates a UUID v4 `traceId` if the incoming request does not already carry
an `X-Trace-Id` header, then forwards it to Core. The same `traceId` is included in all error
responses from the BFF so that log correlation works end-to-end.

#### Error Mapping (Core → BFF → Browser)

| Core response | BFF HTTP status | BFF error code | Message |
|---------------|-----------------|----------------|---------|
| 401 `core-1001` | 401 | `bff-2001` | `"Invalid email or password"` |
| 403 `core-1002` | 403 | `bff-2002` | `"Account disabled"` |
| Core unreachable | 503 | `bff-2099` | `"Authentication service unavailable"` |
| Unexpected | 500 | `bff-2099` | `"Internal error"` |

All BFF error responses follow the same envelope as Core:
```json
{ "code": "bff-2001", "message": "...", "data": null, "traceId": "<uuid>" }
```

#### New npm Dependencies

| Package | Purpose |
|---------|---------|
| `@nestjs/jwt` | JWT signing / verification |
| `@nestjs/axios` | HttpModule for Core HTTP calls |
| `axios` | Peer dep of @nestjs/axios |
| `ioredis` | Redis client for refresh token storage |
| `class-validator` | DTO validation (`@IsEmail`, `@IsString`) |
| `class-transformer` | DTO transformation (`plainToInstance`) |
| `cookie-parser` | Parse cookies in Express middleware |
| `@types/cookie-parser` | TypeScript types (devDep) |

> ⚠️ Amendment: `uuid` package was removed during implementation; replaced with Node.js built-in
> `crypto.randomUUID()` (available since Node 14.17). No external dependency needed.

#### Env Variables Used (already in .env.example)

```
JWT_SECRET
JWT_REFRESH_SECRET
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=7d
REDIS_HOST
REDIS_PORT
REDIS_PASSWORD
CORE_SERVICE_URL
INTERNAL_API_KEY        # forwarded to Core
```

`INTERNAL_API_KEY` must be added to `.env.example`; BFF startup must fail if it is not set (same pattern as Core).

### Affected Files

| File Path | Change Description |
|-----------|-------------------|
| `points-mall-bff/package.json` | Add production and dev dependencies |
| `points-mall-bff/src/main.ts` | Register cookie-parser middleware |
| `points-mall-bff/src/app.module.ts` | Import AuthModule, RedisModule, CoreConnectorModule; register JwtAuthGuard as APP_GUARD |
| `points-mall-bff/src/auth/auth.module.ts` | New |
| `points-mall-bff/src/auth/auth.controller.ts` | New — POST /auth/login |
| `points-mall-bff/src/auth/auth.service.ts` | New — credential verify + token issuance |
| `points-mall-bff/src/auth/dto/login.dto.ts` | New — LoginDto |
| `points-mall-bff/src/auth/guards/jwt-auth.guard.ts` | New — global guard |
| `points-mall-bff/src/auth/decorators/public.decorator.ts` | New — @Public() |
| `points-mall-bff/src/redis/redis.module.ts` | New |
| `points-mall-bff/src/redis/redis.service.ts` | New |
| `points-mall-bff/src/connectors/core/core-connector.module.ts` | New |
| `points-mall-bff/src/connectors/core/core-connector.service.ts` | New |
| `points-mall-bff/.env.example` | Add INTERNAL_API_KEY |
| `points-mall-bff/.env.test` | Add INTERNAL_API_KEY=test-internal-key |
| `.tests/api/bff/auth/login.bru` | New Bruno API test |

## Acceptance Criteria

> AI-generated draft. Human reviews and may edit, add, or reject items before setting status to spec-ready.

### Dependencies & Startup

- [x] AC-01 `package.json` adds `@nestjs/jwt`, `@nestjs/axios`, `axios`, `ioredis`, `class-validator`, `class-transformer`, `cookie-parser` as production deps; `@types/cookie-parser` as devDep. (`uuid` replaced by `crypto.randomUUID()`)
- [x] AC-02 `INTERNAL_API_KEY` is added to `.env.example`; BFF startup fails with a clear error message if `INTERNAL_API_KEY` is not set in the environment.
- [x] AC-03 `cookie-parser` middleware is registered in `main.ts` before the NestJS app starts listening.
- [x] AC-04 `ValidationPipe` is registered globally in `main.ts` (`whitelist: true`, `forbidNonWhitelisted: true`).

### POST /auth/login — Happy Path

- [x] AC-05 Valid email + password returns HTTP 200 with body `{ "code": "OK", "message": "success", "data": { "user": { "id": <number>, "name": "<string>", "email": "<string>", "roles": ["admin"|"employee"] } } }`.
- [x] AC-06 Response sets `Set-Cookie: access_token=<jwt>; HttpOnly; Path=/; SameSite=Strict` (and `Secure` when `NODE_ENV=production`).
- [x] AC-07 The `access_token` JWT payload contains `{ sub, email, roles }` and expires in 15 minutes.
- [x] AC-08 A `refresh:{userId}` key is written to Redis with the signed refresh token value and TTL of 7 days.

### POST /auth/login — Error Cases

- [x] AC-09 Invalid credentials (Core returns 401 `core-1001`) → BFF returns HTTP 401, `{ "code": "bff-2001", "message": "Invalid email or password", "data": null, "traceId": "<uuid>" }`.
- [x] AC-10 Account disabled (Core returns 403 `core-1002`) → BFF returns HTTP 403, `{ "code": "bff-2002", "message": "Account disabled", "data": null, "traceId": "<uuid>" }`.
- [x] AC-11 Core service unreachable → BFF returns HTTP 503, `{ "code": "bff-2099", ... }`.
- [x] AC-12 Request body missing `email` or `password` → BFF returns HTTP 400 (ValidationPipe rejects before reaching service).
- [x] AC-13 `email` field is not a valid email format → BFF returns HTTP 400.

### Global AuthGuard

- [x] AC-14 Any request to a non-`@Public()` route without an `access_token` cookie returns HTTP 401.
- [x] AC-15 Any request with an expired or tampered `access_token` cookie returns HTTP 401.
- [x] AC-16 `GET /health` responds 200 without an `access_token` cookie (decorated with `@Public()`).
- [x] AC-17 `POST /auth/login` responds normally without an `access_token` cookie (decorated with `@Public()`).

### X-Trace-Id Forwarding (T006 sub-task follow-up)

- [x] AC-18 `CoreConnectorService` always forwards an `X-Trace-Id` header to Core; if the incoming BFF request already carries `X-Trace-Id`, that value is reused; otherwise a `crypto.randomUUID()` is generated.
- [x] AC-19 BFF error responses include the same `traceId` value that was forwarded to Core.

### Security Constraints

- [x] AC-20 The `password` field in `LoginDto` must not appear in any log output.
- [x] AC-21 `access_token` cookie is always `HttpOnly`; it is never included in the JSON response body.
- [x] AC-22 `refresh_token` is stored only in Redis; it is never sent to the browser directly.

## Status Change History

| Time | Previous Status | New Status | Actor | Notes |
|------|-----------------|------------|-------|-------|
| 2026-06-26 | test-fail | test-pass | script | test:task run |
| 2026-06-26 | dev-done | test-fail | script | test:task run - Bruno failed |
| 2026-06-26 | — | draft | AI | Raw requirements converted to structured TASK |
| 2026-06-26 | draft | spec-pending | AI | Spec generated; awaiting human review |
| 2026-06-26 | spec-pending | spec-ready | Human | AC reviewed and approved |
| 2026-06-26 | spec-ready | in-dev | AI | Development started, branch feat/TASK-AUTH-0002 |
| 2026-06-26 | in-dev | dev-done | AI | 14 unit/integration tests passing; Bruno tests added |
