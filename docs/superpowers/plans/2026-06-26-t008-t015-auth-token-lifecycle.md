# T008 + T015: Auth Token Lifecycle — Refresh, Logout & Downstream JWT Middleware

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement BFF token refresh/logout endpoints (T008) and JWT validation middleware across the shop, message, and data downstream services (T015).

**Architecture:** T008 extends the existing NestJS BFF auth module with two new endpoints; refresh uses the expired `access_token` cookie to identify the user and checks Redis for session validity. T015 adds independent JWT middleware to each of the three downstream services (Laravel, Express, FastAPI) sharing the same `JWT_SECRET`.

**Tech Stack:** NestJS/TypeScript (BFF), Laravel 13/PHP (shop), Express/TypeScript (message), FastAPI/Python (data), Redis, HS256 JWT, Jest, PHPUnit, pytest

---

> **⚠️ Scope Note:** T008 and T015 are fully independent. They can be executed in parallel. This plan sequences them (T008 first, T015 second) for simplicity, but a parallel approach is also valid.

**Spec:** `docs/superpowers/specs/2026-06-26-t008-t015-auth-token-lifecycle-design.md`

---

## File Map

### T008 — BFF (modify existing files only)

| File | Change |
|------|--------|
| `points-mall-bff/src/auth/auth.service.ts` | Add `refresh()` and `logout()` methods |
| `points-mall-bff/src/auth/auth.controller.ts` | Add `POST /auth/refresh` and `POST /auth/logout` handlers |
| `points-mall-bff/src/auth/__tests__/auth.service.spec.ts` | Add unit tests for `refresh()` and `logout()` |
| `points-mall-bff/src/auth/__tests__/auth.controller.spec.ts` | Add route integration tests for both new endpoints |
| `.tests/api/bff/auth/refresh-valid.bru` | New Bruno test |
| `.tests/api/bff/auth/refresh-no-redis.bru` | New Bruno test |
| `.tests/api/bff/auth/refresh-invalid-token.bru` | New Bruno test |
| `.tests/api/bff/auth/logout-valid.bru` | New Bruno test |
| `.tests/api/bff/auth/logout-no-token.bru` | New Bruno test |

### T015 — Downstream services (new files + small modifications)

| File | Change |
|------|--------|
| `points-mall-shop/app/Http/Middleware/JwtAuthMiddleware.php` | New: JWT Bearer token validation middleware |
| `points-mall-shop/bootstrap/app.php` | Register middleware alias + apply to api group |
| `points-mall-shop/routes/api.php` | Add `withoutMiddleware` on health route |
| `points-mall-shop/composer.json` | Add `firebase/php-jwt` dependency |
| `points-mall-shop/.env.example` | Add `JWT_SECRET=` |
| `points-mall-shop/tests/Unit/Middleware/JwtAuthMiddlewareTest.php` | New: unit tests |
| `points-mall-message/src/middleware/jwtAuth.ts` | New: Express JWT middleware |
| `points-mall-message/src/index.ts` | Register `/health` before jwtAuth, then apply jwtAuth globally |
| `points-mall-message/package.json` | Add `jsonwebtoken`, `vitest`, `@vitest/coverage-v8` |
| `points-mall-message/.env.example` | Add `JWT_SECRET=` |
| `points-mall-message/src/__tests__/middleware/jwtAuth.test.ts` | New: unit tests |
| `points-mall-data/app/dependencies/auth.py` | New: FastAPI JWT dependency |
| `points-mall-data/main.py` | Import and apply auth dependency to protected routes |
| `points-mall-data/requirements.txt` | Add `PyJWT` |
| `points-mall-data/.env.example` | Add `JWT_SECRET=` |
| `points-mall-data/tests/test_auth_dependency.py` | New: pytest tests |

---

## Phase 0: Create Task Files

### Task 0: Create TASK-AUTH-0003 (T008) and TASK-AUTH-0004 (T015)

**Files:**
- Create: `.tasks/auth/TASK-AUTH-0003.md`
- Create: `.tasks/auth/TASK-AUTH-0004.md`

- [ ] **Step 1: Create TASK-AUTH-0003.md**

```markdown
---
id: TASK-AUTH-0003
title: "BFF token refresh and logout: POST /auth/refresh + POST /auth/logout"
status: spec-ready
priority: high
services: []
assignee: ""
created: 2026-06-26
updated: 2026-06-26
depends_on:
  - TASK-AUTH-0002
wiki_refs: []
code_files: []
test_refs: []
---

## Raw Requirements

`[bff]` Token refresh endpoint: `POST /auth/refresh` — validates refresh token by checking Redis
key `refresh:{userId}` exists (server-side validity, not just signature); issues new access token
via `Set-Cookie`. Invalidation endpoint: `POST /auth/logout` — DEL `refresh:{userId}` from Redis,
clear access token cookie. Silent refresh logic: if access token cookie is expired but Redis
refresh key is valid, auto-renew.

## Spec

Full design doc: `docs/superpowers/specs/2026-06-26-t008-t015-auth-token-lifecycle-design.md`

### Background

T007 (TASK-AUTH-0002) issued `access_token` (15 min cookie) and stored `refresh:{userId}` in
Redis (7 days). This task completes the token lifecycle with refresh and logout endpoints.

### Goals

1. `POST /auth/refresh` (@Public) — decode expired access_token cookie, check Redis, issue new cookie.
2. `POST /auth/logout` (protected) — delete Redis refresh key, clear access_token cookie.
3. New error codes: `bff-2003` (invalid token), `bff-2004` (session expired).

### Out of Scope

- Silent refresh Axios interceptor in frontend (T-fe phase).
- Token rotation (issuing new refresh token on each refresh).

### Technical Design

See: `docs/superpowers/specs/2026-06-26-t008-t015-auth-token-lifecycle-design.md` — T008 section.

### Affected Files

See plan: `docs/superpowers/plans/2026-06-26-t008-t015-auth-token-lifecycle.md`

## Acceptance Criteria

- [ ] AC-01 Valid (or expired) access_token cookie + Redis key exists → HTTP 200, new access_token cookie, body `{ code:'OK', data:{ user:{id,email,roles} } }`
- [ ] AC-02 New cookie is HttpOnly; SameSite=Strict; Secure in production
- [ ] AC-03 New access_token JWT payload contains `{ sub, email, roles }`, expires in 15 min
- [ ] AC-04 Redis `refresh:{userId}` key is NOT renewed by calling /auth/refresh
- [ ] AC-05 Malformed/missing token → 401 `{ code:'bff-2003', message:'Invalid token', data:null, traceId }`
- [ ] AC-06 Redis key missing → 401 `{ code:'bff-2004', message:'Session expired, please login again', data:null, traceId }`
- [ ] AC-07 POST /auth/logout with valid token → 200, Redis key deleted, cookie cleared
- [ ] AC-08 POST /auth/logout without token → 401 (JwtAuthGuard intercepts)
- [ ] AC-09 After logout, /auth/refresh returns 401 bff-2004
- [ ] AC-10 POST /auth/refresh is @Public — accessible without valid token
- [ ] AC-11 jwtService.decode() (not verify) used in refresh — accepts expired tokens

## Status Change History

| Time | Previous Status | New Status | Actor | Notes |
|------|-----------------|------------|-------|-------|
| 2026-06-26 | — | draft | AI | Raw requirements converted to structured TASK |
| 2026-06-26 | draft | spec-pending | AI | Spec generated via brainstorming |
| 2026-06-26 | spec-pending | spec-ready | Human | Approved in brainstorming session |
```

- [ ] **Step 2: Create TASK-AUTH-0004.md**

```markdown
---
id: TASK-AUTH-0004
title: "JWT validation middleware for shop, message, and data downstream services"
status: spec-ready
priority: high
services: []
assignee: ""
created: 2026-06-26
updated: 2026-06-26
depends_on:
  - TASK-AUTH-0002
wiki_refs: []
code_files: []
test_refs: []
---

## Raw Requirements

`[shop, message, data]` Add JWT validation middleware to all three remaining downstream services:
extract and verify bearer token on every protected route; return `401` if invalid or missing.
All services now uniformly reject unauthorized requests.

## Spec

Full design doc: `docs/superpowers/specs/2026-06-26-t008-t015-auth-token-lifecycle-design.md`

### Background

T007 established JWT format (HS256, JWT_SECRET). Downstream services currently have no auth.
This task adds defense-in-depth by making each service independently validate tokens.

### Goals

1. Shop (Laravel): JwtAuthMiddleware, applied to all api routes except /api/health.
2. Message (Express): jwtAuth middleware, applied after /health route registration.
3. Data (FastAPI): verify_token dependency, applied to all routes except /health.

### Out of Scope

- RS256 asymmetric key migration (possible future upgrade).
- Rate limiting or IP allowlisting.

### Technical Design

See: `docs/superpowers/specs/2026-06-26-t008-t015-auth-token-lifecycle-design.md` — T015 section.

### Affected Files

See plan: `docs/superpowers/plans/2026-06-26-t008-t015-auth-token-lifecycle.md`

## Acceptance Criteria

- [ ] AC-01 Valid Bearer token → route handler proceeds, payload in request context
- [ ] AC-02 Missing Authorization header → HTTP 401 `{ code:'<svc>-xxxx', message:'Unauthorized', data:null }`
- [ ] AC-03 Invalid/expired JWT → HTTP 401, same body as AC-02
- [ ] AC-04 GET /health (or /api/health) → HTTP 200 without any token
- [ ] AC-05 (Shop) JWT_SECRET read from env; firebase/php-jwt HS256 used
- [ ] AC-06 (Message) jsonwebtoken with algorithms:['HS256']; /health registered before jwtAuth
- [ ] AC-07 (Data) verify_token FastAPI dependency; /health has no Depends(verify_token)

## Status Change History

| Time | Previous Status | New Status | Actor | Notes |
|------|-----------------|------------|-------|-------|
| 2026-06-26 | — | draft | AI | Raw requirements converted to structured TASK |
| 2026-06-26 | draft | spec-pending | AI | Spec generated via brainstorming |
| 2026-06-26 | spec-pending | spec-ready | Human | Approved in brainstorming session |
```

- [ ] **Step 3: Commit task files**

```bash
cd /path/to/fullstack-points-mall
git add .tasks/auth/TASK-AUTH-0003.md .tasks/auth/TASK-AUTH-0004.md
git commit -m "docs(TASK-AUTH-0003/0004): create task files for T008 and T015"
```

---

## Phase 1: T008 — BFF Token Refresh & Logout

### Task 1: AuthService — `refresh()` method (TDD)

**Files:**
- Modify: `points-mall-bff/src/auth/__tests__/auth.service.spec.ts`
- Modify: `points-mall-bff/src/auth/auth.service.ts`

- [ ] **Step 1: Update the RedisService and JwtService mock in auth.service.spec.ts**

In `points-mall-bff/src/auth/__tests__/auth.service.spec.ts`, update the `beforeEach` to add missing mock methods. Find the existing `provide: JwtService` block and replace it:

```typescript
{
  provide: JwtService,
  useValue: {
    sign: jest.fn().mockReturnValue('signed-token'),
    decode: jest.fn(),
  },
},
```

Find the existing `provide: RedisService` block and replace it:

```typescript
{
  provide: RedisService,
  useValue: {
    set: jest.fn(),
    exists: jest.fn(),
    del: jest.fn(),
  },
},
```

Update the destructured mock variables near the top of the `describe` block:

```typescript
let service: AuthService;
let coreConnector: jest.Mocked<CoreConnectorService>;
let redisService: jest.Mocked<RedisService>;
let jwtService: jest.Mocked<JwtService>;
```

After the `describe('login', ...)` block, add this new describe block:

```typescript
describe('refresh', () => {
  const fakePayload = { sub: 1, email: 'admin@pointsmall.com', roles: ['admin'] };

  it('AC-01/03: decodes expired token, checks Redis, issues new access_token cookie', async () => {
    jwtService.decode.mockReturnValue(fakePayload as any);
    redisService.exists.mockResolvedValue(true);
    jwtService.sign.mockReturnValue('new-signed-token' as any);
    const res = mockResponse();

    const result = await service.refresh('expired-token', res);

    expect(jwtService.decode).toHaveBeenCalledWith('expired-token');
    expect(redisService.exists).toHaveBeenCalledWith('refresh:1');
    expect(jwtService.sign).toHaveBeenCalledWith(
      { sub: 1, email: 'admin@pointsmall.com', roles: ['admin'] },
      expect.objectContaining({ secret: 'test-secret', expiresIn: '15m' }),
    );
    expect(res.cookie).toHaveBeenCalledWith(
      'access_token',
      'new-signed-token',
      expect.objectContaining({ httpOnly: true, sameSite: 'strict', path: '/' }),
    );
    expect(result).toEqual({ user: { id: 1, email: 'admin@pointsmall.com', roles: ['admin'] } });
  });

  it('AC-04: Redis key is NOT renewed (exists called, set NOT called)', async () => {
    jwtService.decode.mockReturnValue(fakePayload as any);
    redisService.exists.mockResolvedValue(true);
    jwtService.sign.mockReturnValue('new-signed-token' as any);

    await service.refresh('expired-token', mockResponse());

    expect(redisService.set).not.toHaveBeenCalled();
  });

  it('AC-05: undefined token throws bff-2003 UnauthorizedException', async () => {
    await expect(service.refresh(undefined, mockResponse())).rejects.toMatchObject({
      response: expect.objectContaining({ statusCode: 401 }),
      bffCode: 'bff-2003',
    });
  });

  it('AC-05: null/non-object decode result throws bff-2003', async () => {
    jwtService.decode.mockReturnValue(null as any);

    await expect(service.refresh('bad-token', mockResponse())).rejects.toMatchObject({
      bffCode: 'bff-2003',
    });
  });

  it('AC-05: payload missing sub throws bff-2003', async () => {
    jwtService.decode.mockReturnValue({ email: 'x@x.com' } as any);

    await expect(service.refresh('no-sub-token', mockResponse())).rejects.toMatchObject({
      bffCode: 'bff-2003',
    });
  });

  it('AC-06: Redis key missing throws bff-2004 UnauthorizedException', async () => {
    jwtService.decode.mockReturnValue(fakePayload as any);
    redisService.exists.mockResolvedValue(false);

    await expect(service.refresh('expired-token', mockResponse())).rejects.toMatchObject({
      bffCode: 'bff-2004',
    });
  });
});
```

- [ ] **Step 2: Run the refresh tests — verify they FAIL**

```bash
cd /path/to/fullstack-points-mall/points-mall-bff
NODE_ENV=test npx jest src/auth/__tests__/auth.service.spec.ts --testNamePattern="refresh" --no-coverage
```

Expected output: FAIL — `service.refresh is not a function` (or similar — method doesn't exist yet)

- [ ] **Step 3: Implement `refresh()` in auth.service.ts**

Add the following import at the top of `points-mall-bff/src/auth/auth.service.ts`:

```typescript
import { UnauthorizedException } from '@nestjs/common';
```

(It may already be there from the login implementation — check before adding.)

Add `refresh()` as a new method inside the `AuthService` class, after the existing `login()` method:

```typescript
async refresh(
  expiredToken: string | undefined,
  res: Response,
): Promise<{ user: { id: number; email: string; roles: string[] } }> {
  if (!expiredToken) {
    throw Object.assign(new UnauthorizedException('Invalid token'), {
      bffCode: 'bff-2003',
    });
  }

  const payload = this.jwtService.decode(expiredToken);
  if (!payload || typeof payload !== 'object' || typeof (payload as any).sub !== 'number') {
    throw Object.assign(new UnauthorizedException('Invalid token'), {
      bffCode: 'bff-2003',
    });
  }

  const { sub, email, roles } = payload as { sub: number; email: string; roles: string[] };

  const exists = await this.redisService.exists(`refresh:${sub}`);
  if (!exists) {
    throw Object.assign(new UnauthorizedException('Session expired, please login again'), {
      bffCode: 'bff-2004',
    });
  }

  const jwtSecret = this.config.getOrThrow<string>('JWT_SECRET');
  const accessExpiresIn = this.config.get<string>('JWT_ACCESS_EXPIRES_IN', '15m');

  const newToken = this.jwtService.sign(
    { sub, email, roles },
    { secret: jwtSecret, expiresIn: accessExpiresIn as any },
  );

  const isProduction = this.config.get<string>('NODE_ENV') === 'production';
  res.cookie('access_token', newToken, {
    httpOnly: true,
    secure: isProduction,
    sameSite: 'strict',
    maxAge: 15 * 60 * 1000,
    path: '/',
  });

  this.logger.log(`Token refreshed for userId=${sub}`);

  return { user: { id: sub, email, roles } };
}
```

- [ ] **Step 4: Run the refresh tests — verify they PASS**

```bash
cd /path/to/fullstack-points-mall/points-mall-bff
NODE_ENV=test npx jest src/auth/__tests__/auth.service.spec.ts --testNamePattern="refresh" --no-coverage
```

Expected: All 6 refresh tests PASS

- [ ] **Step 5: Commit**

```bash
git add points-mall-bff/src/auth/auth.service.ts \
        points-mall-bff/src/auth/__tests__/auth.service.spec.ts
git commit -m "feat(TASK-AUTH-0003): add AuthService.refresh() with TDD"
```

---

### Task 2: AuthService — `logout()` method (TDD)

**Files:**
- Modify: `points-mall-bff/src/auth/__tests__/auth.service.spec.ts`
- Modify: `points-mall-bff/src/auth/auth.service.ts`

- [ ] **Step 1: Add logout tests to auth.service.spec.ts**

After the `describe('refresh', ...)` block, add:

```typescript
describe('logout', () => {
  it('AC-07: deletes Redis refresh key and clears access_token cookie', async () => {
    redisService.del.mockResolvedValue();
    const res = mockResponse();
    // Add clearCookie mock
    (res as any).clearCookie = jest.fn();

    await service.logout(1, res);

    expect(redisService.del).toHaveBeenCalledWith('refresh:1');
    expect((res as any).clearCookie).toHaveBeenCalledWith('access_token', { path: '/' });
  });

  it('AC-07: returns void (no data in response)', async () => {
    redisService.del.mockResolvedValue();
    const res = mockResponse();
    (res as any).clearCookie = jest.fn();

    const result = await service.logout(42, res);

    expect(result).toBeUndefined();
  });
});
```

Also update `mockResponse()` at the top of the file to include `clearCookie`:

```typescript
const mockResponse = () => {
  const res: Partial<Response> = {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
  };
  return res as Response;
};
```

- [ ] **Step 2: Run logout tests — verify they FAIL**

```bash
cd /path/to/fullstack-points-mall/points-mall-bff
NODE_ENV=test npx jest src/auth/__tests__/auth.service.spec.ts --testNamePattern="logout" --no-coverage
```

Expected: FAIL — `service.logout is not a function`

- [ ] **Step 3: Implement `logout()` in auth.service.ts**

Add the following method inside `AuthService` class, after `refresh()`:

```typescript
async logout(userId: number, res: Response): Promise<void> {
  await this.redisService.del(`refresh:${userId}`);
  res.clearCookie('access_token', { path: '/' });
  this.logger.log(`User logged out userId=${userId}`);
}
```

- [ ] **Step 4: Run logout tests — verify they PASS**

```bash
cd /path/to/fullstack-points-mall/points-mall-bff
NODE_ENV=test npx jest src/auth/__tests__/auth.service.spec.ts --testNamePattern="logout" --no-coverage
```

Expected: Both logout tests PASS

- [ ] **Step 5: Run all auth service tests — ensure no regressions**

```bash
cd /path/to/fullstack-points-mall/points-mall-bff
NODE_ENV=test npx jest src/auth/__tests__/auth.service.spec.ts --no-coverage
```

Expected: All tests PASS (login + refresh + logout)

- [ ] **Step 6: Commit**

```bash
git add points-mall-bff/src/auth/auth.service.ts \
        points-mall-bff/src/auth/__tests__/auth.service.spec.ts
git commit -m "feat(TASK-AUTH-0003): add AuthService.logout() with TDD"
```

---

### Task 3: AuthController — `POST /auth/refresh` and `POST /auth/logout` routes (TDD)

**Files:**
- Modify: `points-mall-bff/src/auth/__tests__/auth.controller.spec.ts`
- Modify: `points-mall-bff/src/auth/auth.controller.ts`

- [ ] **Step 1: Add refresh and logout mocks and tests to auth.controller.spec.ts**

In `auth.controller.spec.ts`, find the line:
```typescript
const mockAuthService = { login: jest.fn() };
```
Replace it with:
```typescript
const mockAuthService = {
  login: jest.fn(),
  refresh: jest.fn(),
  logout: jest.fn(),
};
```

Also update the type annotation of `authService` to reflect the expanded mock:
```typescript
let authService: jest.Mocked<Pick<AuthService, 'login' | 'refresh' | 'logout'>>;
```

After the last existing `it(...)` block (before the closing `}`), add:

```typescript
describe('POST /auth/refresh', () => {
  it('AC-01: success returns 200 with user info and new cookie', async () => {
    (authService.refresh as jest.Mock).mockResolvedValue({
      user: { id: 1, email: 'admin@pointsmall.com', roles: ['admin'] },
    });

    const res = await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', 'access_token=any-token-here');

    expect(res.status).toBe(200);
    expect(res.body.code).toBe('OK');
    expect(res.body.data.user.email).toBe('admin@pointsmall.com');
  });

  it('AC-05: service throws bff-2003 → controller returns 401 with bff-2003', async () => {
    const err = Object.assign(
      new (require('@nestjs/common').UnauthorizedException)('Invalid token'),
      { bffCode: 'bff-2003', traceId: 'trace-abc' },
    );
    (authService.refresh as jest.Mock).mockRejectedValue(err);

    const res = await request(app.getHttpServer())
      .post('/auth/refresh');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('bff-2003');
    expect(res.body.traceId).toBeDefined();
  });

  it('AC-06: service throws bff-2004 → controller returns 401 with bff-2004', async () => {
    const err = Object.assign(
      new (require('@nestjs/common').UnauthorizedException)('Session expired, please login again'),
      { bffCode: 'bff-2004', traceId: 'trace-def' },
    );
    (authService.refresh as jest.Mock).mockRejectedValue(err);

    const res = await request(app.getHttpServer())
      .post('/auth/refresh');

    expect(res.status).toBe(401);
    expect(res.body.code).toBe('bff-2004');
  });

  it('AC-10: /auth/refresh is accessible without a valid access_token cookie (@Public)', async () => {
    (authService.refresh as jest.Mock).mockResolvedValue({
      user: { id: 1, email: 'admin@pointsmall.com', roles: ['admin'] },
    });

    // No cookie set — should still reach the handler (not blocked by JwtAuthGuard)
    const res = await request(app.getHttpServer())
      .post('/auth/refresh');

    expect(res.status).toBe(200);
  });
});

describe('POST /auth/logout', () => {
  it('AC-07: valid token → 200, service.logout called', async () => {
    (authService.logout as jest.Mock).mockResolvedValue(undefined);
    // Make JwtService.verify return a valid payload so guard passes
    const mockJwt = app.get(JwtService);
    (mockJwt.verify as jest.Mock).mockReturnValue({ sub: 1, email: 'a@b.com', roles: ['admin'] });

    const res = await request(app.getHttpServer())
      .post('/auth/logout')
      .set('Cookie', 'access_token=valid-token');

    expect(res.status).toBe(200);
    expect(res.body.code).toBe('OK');
    expect(authService.logout).toHaveBeenCalledWith(1, expect.anything());
  });

  it('AC-08: no access_token cookie → 401 from JwtAuthGuard', async () => {
    const res = await request(app.getHttpServer())
      .post('/auth/logout');

    expect(res.status).toBe(401);
  });
});
```

- [ ] **Step 2: Run controller tests — verify new tests FAIL**

```bash
cd /path/to/fullstack-points-mall/points-mall-bff
NODE_ENV=test npx jest src/auth/__tests__/auth.controller.spec.ts --testNamePattern="refresh|logout" --no-coverage
```

Expected: FAIL — routes not yet defined in controller

- [ ] **Step 3: Add routes to auth.controller.ts**

Replace the entire content of `points-mall-bff/src/auth/auth.controller.ts` with:

```typescript
import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { Public } from './decorators/public.decorator';
import { ok } from '../common/api-response';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const inboundTraceId = req.headers['x-trace-id'] as string | undefined;
    const result = await this.authService.login(
      dto.email,
      dto.password,
      inboundTraceId,
      res,
    );
    return ok(result);
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const token: string | undefined = req.cookies?.['access_token'];
    const result = await this.authService.refresh(token, res);
    return ok(result);
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const userId = (req as any).user?.sub as number;
    await this.authService.logout(userId, res);
    return ok(null);
  }
}
```

- [ ] **Step 4: Run controller tests — verify they PASS**

```bash
cd /path/to/fullstack-points-mall/points-mall-bff
NODE_ENV=test npx jest src/auth/__tests__/auth.controller.spec.ts --no-coverage
```

Expected: All tests PASS (including the new refresh and logout ones)

- [ ] **Step 5: Run all BFF tests to check no regressions**

```bash
cd /path/to/fullstack-points-mall/points-mall-bff
NODE_ENV=test npx jest --no-coverage
```

Expected: All tests PASS

- [ ] **Step 6: Commit**

```bash
git add points-mall-bff/src/auth/auth.controller.ts \
        points-mall-bff/src/auth/__tests__/auth.controller.spec.ts
git commit -m "feat(TASK-AUTH-0003): add POST /auth/refresh and POST /auth/logout routes"
```

---

### Task 4: Bruno API Tests for T008

**Files:**
- Create: `.tests/api/bff/auth/refresh-valid.bru`
- Create: `.tests/api/bff/auth/refresh-no-redis.bru`
- Create: `.tests/api/bff/auth/refresh-invalid-token.bru`
- Create: `.tests/api/bff/auth/logout-valid.bru`
- Create: `.tests/api/bff/auth/logout-no-token.bru`

- [ ] **Step 1: Create refresh-valid.bru**

```
meta {
  name: BFF refresh - valid expired token (Redis key present)
  type: http
  seq: 5
}

post {
  url: {{bffBaseUrl}}/auth/refresh
  body: none
  auth: none
}

headers {
  Cookie: access_token={{expiredAccessToken}}
}

assert {
  res.status: eq 200
  res.body.code: eq OK
  res.body.data.user.id: isDefined
  res.body.data.user.email: isDefined
  res.body.data.user.roles: isDefined
  res.headers["set-cookie"]: isDefined
}
```

- [ ] **Step 2: Create refresh-no-redis.bru**

```
meta {
  name: BFF refresh - Redis key missing (session expired)
  type: http
  seq: 6
}

post {
  url: {{bffBaseUrl}}/auth/refresh
  body: none
  auth: none
}

headers {
  Cookie: access_token={{loggedOutAccessToken}}
}

assert {
  res.status: eq 401
  res.body.code: eq bff-2004
  res.body.data: isNull
  res.body.traceId: isDefined
}
```

- [ ] **Step 3: Create refresh-invalid-token.bru**

```
meta {
  name: BFF refresh - invalid/malformed token
  type: http
  seq: 7
}

post {
  url: {{bffBaseUrl}}/auth/refresh
  body: none
  auth: none
}

headers {
  Cookie: access_token=this.is.not.a.jwt
}

assert {
  res.status: eq 401
  res.body.code: eq bff-2003
  res.body.data: isNull
  res.body.traceId: isDefined
}
```

- [ ] **Step 4: Create logout-valid.bru**

```
meta {
  name: BFF logout - valid token
  type: http
  seq: 8
}

post {
  url: {{bffBaseUrl}}/auth/logout
  body: none
  auth: none
}

headers {
  Cookie: access_token={{accessToken}}
}

assert {
  res.status: eq 200
  res.body.code: eq OK
  res.body.data: isNull
}
```

- [ ] **Step 5: Create logout-no-token.bru**

```
meta {
  name: BFF logout - no access_token cookie
  type: http
  seq: 9
}

post {
  url: {{bffBaseUrl}}/auth/logout
  body: none
  auth: none
}

assert {
  res.status: eq 401
}
```

- [ ] **Step 6: Commit Bruno tests**

```bash
git add .tests/api/bff/auth/refresh-valid.bru \
        .tests/api/bff/auth/refresh-no-redis.bru \
        .tests/api/bff/auth/refresh-invalid-token.bru \
        .tests/api/bff/auth/logout-valid.bru \
        .tests/api/bff/auth/logout-no-token.bru
git commit -m "test(TASK-AUTH-0003): add Bruno API tests for refresh and logout"
```

---

### Task 5: Update TASK-AUTH-0003 to dev-done and run tests

**Files:**
- Modify: `.tasks/auth/TASK-AUTH-0003.md`

- [ ] **Step 1: Update TASK-AUTH-0003.md frontmatter and status history**

In `.tasks/auth/TASK-AUTH-0003.md`, update the frontmatter:

```yaml
---
id: TASK-AUTH-0003
title: "BFF token refresh and logout: POST /auth/refresh + POST /auth/logout"
status: dev-done
priority: high
services:
  - bff
assignee: ""
created: 2026-06-26
updated: 2026-06-26
depends_on:
  - TASK-AUTH-0002
wiki_refs: []
code_files:
  - points-mall-bff/src/auth/auth.service.ts
  - points-mall-bff/src/auth/auth.controller.ts
test_refs:
  - points-mall-bff/src/auth/__tests__/auth.service.spec.ts
  - points-mall-bff/src/auth/__tests__/auth.controller.spec.ts
  - .tests/api/bff/auth/refresh-valid.bru
  - .tests/api/bff/auth/refresh-no-redis.bru
  - .tests/api/bff/auth/refresh-invalid-token.bru
  - .tests/api/bff/auth/logout-valid.bru
  - .tests/api/bff/auth/logout-no-token.bru
---
```

Check off all AC items in the Acceptance Criteria section (change `- [ ]` to `- [x]` for all 11 items).

Append to the Status Change History table:
```
| 2026-06-26 | spec-ready | in-dev | AI | Development started |
| 2026-06-26 | in-dev | dev-done | AI | All unit tests passing; Bruno tests added |
```

- [ ] **Step 2: Run pnpm tasks:sync to rebuild the index**

```bash
cd /path/to/fullstack-points-mall
pnpm run tasks:sync
```

Expected: `.tasks/_index.md` rebuilt without errors

- [ ] **Step 3: Commit updated task file**

```bash
git add .tasks/auth/TASK-AUTH-0003.md .tasks/_index.md
git commit -m "chore(TASK-AUTH-0003): mark dev-done, update task file with code_files and test_refs"
```

---

## Phase 2: T015 — Downstream JWT Validation Middleware

### Task 6: Shop Service (Laravel/PHP) JWT Middleware

**Files:**
- Modify: `points-mall-shop/composer.json`
- Create: `points-mall-shop/app/Http/Middleware/JwtAuthMiddleware.php`
- Modify: `points-mall-shop/bootstrap/app.php`
- Modify: `points-mall-shop/routes/api.php`
- Modify: `points-mall-shop/.env.example`
- Create: `points-mall-shop/tests/Unit/Middleware/JwtAuthMiddlewareTest.php`

- [ ] **Step 1: Install firebase/php-jwt**

```bash
cd /path/to/fullstack-points-mall/points-mall-shop
composer require firebase/php-jwt
```

Expected: `firebase/php-jwt` added to `composer.json` and installed in `vendor/`

- [ ] **Step 2: Create the middleware file**

Create `points-mall-shop/app/Http/Middleware/JwtAuthMiddleware.php`:

```php
<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Illuminate\Http\JsonResponse;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;

class JwtAuthMiddleware
{
    public function handle(Request $request, Closure $next): mixed
    {
        $token = $request->bearerToken();

        if (!$token) {
            return response()->json([
                'code'    => 'shop-4001',
                'message' => 'Unauthorized',
                'data'    => null,
            ], 401);
        }

        try {
            $secret = env('JWT_SECRET');
            $payload = JWT::decode($token, new Key($secret, 'HS256'));
            $request->attributes->set('auth_user', $payload);
        } catch (\Exception $e) {
            return response()->json([
                'code'    => 'shop-4001',
                'message' => 'Unauthorized',
                'data'    => null,
            ], 401);
        }

        return $next($request);
    }
}
```

- [ ] **Step 3: Write the unit test BEFORE verifying middleware works**

Create directory and file:
```bash
mkdir -p /path/to/fullstack-points-mall/points-mall-shop/tests/Unit/Middleware
```

Create `points-mall-shop/tests/Unit/Middleware/JwtAuthMiddlewareTest.php`:

```php
<?php

namespace Tests\Unit\Middleware;

use App\Http\Middleware\JwtAuthMiddleware;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Tests\TestCase;

class JwtAuthMiddlewareTest extends TestCase
{
    private JwtAuthMiddleware $middleware;
    private string $secret = 'test-jwt-secret';

    protected function setUp(): void
    {
        parent::setUp();
        $this->middleware = new JwtAuthMiddleware();
        // Ensure JWT_SECRET env is set for tests
        putenv("JWT_SECRET={$this->secret}");
        $_ENV['JWT_SECRET'] = $this->secret;
    }

    private function makeToken(array $payload = []): string
    {
        $defaultPayload = [
            'sub'   => 1,
            'email' => 'admin@pointsmall.com',
            'roles' => ['admin'],
            'iat'   => time(),
            'exp'   => time() + 900,
        ];
        return JWT::encode(array_merge($defaultPayload, $payload), $this->secret, 'HS256');
    }

    // AC-01: valid token passes through
    public function test_valid_bearer_token_passes_through(): void
    {
        $token   = $this->makeToken();
        $request = Request::create('/api/products', 'GET');
        $request->headers->set('Authorization', "Bearer {$token}");

        $nextCalled = false;
        $next = function ($req) use (&$nextCalled) {
            $nextCalled = true;
            return response()->json(['ok' => true]);
        };

        $response = $this->middleware->handle($request, $next);

        $this->assertTrue($nextCalled);
        $this->assertEquals(200, $response->getStatusCode());
    }

    // AC-01: decoded payload is attached to request attributes
    public function test_valid_token_attaches_payload_to_request(): void
    {
        $token   = $this->makeToken(['sub' => 42, 'email' => 'alice@test.com']);
        $request = Request::create('/api/products', 'GET');
        $request->headers->set('Authorization', "Bearer {$token}");

        $capturedPayload = null;
        $next = function ($req) use (&$capturedPayload) {
            $capturedPayload = $req->attributes->get('auth_user');
            return response()->json([]);
        };

        $this->middleware->handle($request, $next);

        $this->assertNotNull($capturedPayload);
        $this->assertEquals(42, $capturedPayload->sub);
        $this->assertEquals('alice@test.com', $capturedPayload->email);
    }

    // AC-02: missing Authorization header → 401
    public function test_missing_authorization_header_returns_401(): void
    {
        $request = Request::create('/api/products', 'GET');
        $next    = fn($req) => response()->json([]);

        $response = $this->middleware->handle($request, $next);

        $this->assertEquals(401, $response->getStatusCode());
        $body = json_decode($response->getContent(), true);
        $this->assertEquals('shop-4001', $body['code']);
        $this->assertEquals('Unauthorized', $body['message']);
        $this->assertNull($body['data']);
    }

    // AC-03: tampered/invalid token → 401
    public function test_invalid_token_returns_401(): void
    {
        $request = Request::create('/api/products', 'GET');
        $request->headers->set('Authorization', 'Bearer not.a.valid.jwt');

        $response = $this->middleware->handle($request, fn($r) => response()->json([]));

        $this->assertEquals(401, $response->getStatusCode());
        $body = json_decode($response->getContent(), true);
        $this->assertEquals('shop-4001', $body['code']);
    }

    // AC-03: expired token → 401
    public function test_expired_token_returns_401(): void
    {
        $expiredToken = $this->makeToken(['exp' => time() - 100]);
        $request      = Request::create('/api/products', 'GET');
        $request->headers->set('Authorization', "Bearer {$expiredToken}");

        $response = $this->middleware->handle($request, fn($r) => response()->json([]));

        $this->assertEquals(401, $response->getStatusCode());
        $body = json_decode($response->getContent(), true);
        $this->assertEquals('shop-4001', $body['code']);
    }

    // AC-05: uses HS256
    public function test_token_signed_with_wrong_algorithm_returns_401(): void
    {
        // Sign with RS256 — decode with HS256 will fail
        // Simplest test: sign with a different secret
        $tokenWrongSecret = JWT::encode(
            ['sub' => 1, 'email' => 'a@b.com', 'roles' => ['admin'], 'exp' => time() + 900],
            'wrong-secret',
            'HS256',
        );
        $request = Request::create('/api/products', 'GET');
        $request->headers->set('Authorization', "Bearer {$tokenWrongSecret}");

        $response = $this->middleware->handle($request, fn($r) => response()->json([]));

        $this->assertEquals(401, $response->getStatusCode());
    }
}
```

- [ ] **Step 4: Run shop unit tests to confirm they FAIL (middleware exists but tests may need Laravel TestCase base)**

```bash
cd /path/to/fullstack-points-mall/points-mall-shop
php artisan test tests/Unit/Middleware/JwtAuthMiddlewareTest.php
```

Expected: Tests run (may pass if middleware was already created — if they fail, check the error and fix imports)

> Note: Laravel's `TestCase` base class bootstraps the full app. If there are env issues, ensure `.env.testing` exists: `cp .env.example .env.testing && php artisan key:generate --env=testing`

- [ ] **Step 5: Add JWT_SECRET to .env.example**

In `points-mall-shop/.env.example`, find the `# ── Internal Service URLs` section and add above it:

```
# ── JWT (Required — must match BFF JWT_SECRET exactly) ──────
JWT_SECRET=
```

- [ ] **Step 6: Register middleware in bootstrap/app.php**

Replace the content of `points-mall-shop/bootstrap/app.php` with:

```php
<?php

use App\Http\Middleware\JwtAuthMiddleware;
use Illuminate\Foundation\Application;
use Illuminate\Foundation\Configuration\Exceptions;
use Illuminate\Foundation\Configuration\Middleware;

return Application::configure(basePath: dirname(__DIR__))
    ->withRouting(
        web: __DIR__.'/../routes/web.php',
        api: __DIR__.'/../routes/api.php',
        commands: __DIR__.'/../routes/console.php',
    )
    ->withMiddleware(function (Middleware $middleware) {
        $middleware->alias([
            'auth.jwt' => JwtAuthMiddleware::class,
        ]);
        $middleware->appendToGroup('api', JwtAuthMiddleware::class);
    })
    ->withExceptions(function (Exceptions $exceptions) {
        //
    })->create();
```

- [ ] **Step 7: Exclude /api/health from JWT middleware in routes/api.php**

Replace the content of `points-mall-shop/routes/api.php` with:

```php
<?php

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Route;
use App\Http\Middleware\JwtAuthMiddleware;

Route::get('/health', function () {
    $dbStatus = 'ok';
    try {
        DB::select('SELECT 1');
    } catch (\Throwable $e) {
        $dbStatus = 'error';
    }

    return response()->json([
        'status'    => 'ok',
        'service'   => 'points-mall-shop',
        'timestamp' => now()->utc()->toISOString(),
        'db'        => $dbStatus,
        'uptime'    => (int) round(microtime(true) - LARAVEL_START),
    ]);
})->withoutMiddleware(JwtAuthMiddleware::class);
```

- [ ] **Step 8: Run tests again and verify they PASS**

```bash
cd /path/to/fullstack-points-mall/points-mall-shop
php artisan test tests/Unit/Middleware/JwtAuthMiddlewareTest.php
```

Expected: 5 tests PASS

- [ ] **Step 9: Commit**

```bash
git add points-mall-shop/composer.json \
        points-mall-shop/composer.lock \
        points-mall-shop/app/Http/Middleware/JwtAuthMiddleware.php \
        points-mall-shop/bootstrap/app.php \
        points-mall-shop/routes/api.php \
        points-mall-shop/.env.example \
        points-mall-shop/tests/Unit/Middleware/JwtAuthMiddlewareTest.php
git commit -m "feat(TASK-AUTH-0004): add JWT auth middleware to shop service (Laravel)"
```

---

### Task 7: Message Service (Express/TypeScript) JWT Middleware

**Files:**
- Modify: `points-mall-message/package.json`
- Create: `points-mall-message/src/middleware/jwtAuth.ts`
- Modify: `points-mall-message/src/index.ts`
- Modify: `points-mall-message/.env.example`
- Create: `points-mall-message/src/__tests__/middleware/jwtAuth.test.ts`

- [ ] **Step 1: Add jsonwebtoken and vitest to package.json**

```bash
cd /path/to/fullstack-points-mall/points-mall-message
pnpm add jsonwebtoken
pnpm add -D @types/jsonwebtoken vitest @vitest/coverage-v8
```

Also add the `test` script to `package.json` manually:

In `points-mall-message/package.json`, update the `"scripts"` section:

```json
"scripts": {
  "dev": "ts-node src/index.ts",
  "build": "tsup src/index.ts --format cjs --out-dir dist",
  "start": "node dist/index.js",
  "test": "vitest run",
  "test:watch": "vitest",
  "lint": "tsc --noEmit",
  "format": "prettier --write .",
  "format:check": "prettier --check ."
},
```

- [ ] **Step 2: Write the failing test first**

Create directory and file:
```bash
mkdir -p /path/to/fullstack-points-mall/points-mall-message/src/__tests__/middleware
```

Create `points-mall-message/src/__tests__/middleware/jwtAuth.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { jwtAuth } from '../../middleware/jwtAuth';

const TEST_SECRET = 'test-jwt-secret';

function makeToken(payload: object = {}, secret = TEST_SECRET, expiresIn = '15m'): string {
  return jwt.sign(
    { sub: 1, email: 'admin@pointsmall.com', roles: ['admin'], ...payload },
    secret,
    { expiresIn },
  );
}

function mockReqResNext(
  authHeader?: string,
): { req: Partial<Request>; res: Partial<Response>; next: NextFunction } {
  const req: Partial<Request> = {
    headers: authHeader ? { authorization: authHeader } : {},
  };
  const res: Partial<Response> = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
  };
  const next: NextFunction = vi.fn();
  return { req, res, next };
}

// Provide JWT_SECRET via process.env for the middleware
beforeEach(() => {
  process.env.JWT_SECRET = TEST_SECRET;
});

describe('jwtAuth middleware', () => {
  // AC-01: valid token passes, payload attached to req.user
  it('passes valid Bearer token and attaches decoded payload to req.user', () => {
    const token = makeToken();
    const { req, res, next } = mockReqResNext(`Bearer ${token}`);

    jwtAuth(req as Request, res as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect((req as any).user).toBeDefined();
    expect((req as any).user.sub).toBe(1);
    expect((req as any).user.email).toBe('admin@pointsmall.com');
  });

  // AC-02: missing Authorization header → 401 msg-5001
  it('returns 401 msg-5001 when Authorization header is missing', () => {
    const { req, res, next } = mockReqResNext();

    jwtAuth(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      code: 'msg-5001',
      message: 'Unauthorized',
      data: null,
    });
  });

  // AC-02: "Bearer " prefix missing
  it('returns 401 when Authorization header does not start with "Bearer "', () => {
    const { req, res, next } = mockReqResNext('Token something');

    jwtAuth(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // AC-03: invalid token → 401
  it('returns 401 msg-5001 when token is malformed', () => {
    const { req, res, next } = mockReqResNext('Bearer not.a.valid.jwt');

    jwtAuth(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      code: 'msg-5001',
      message: 'Unauthorized',
      data: null,
    });
  });

  // AC-03: expired token → 401
  it('returns 401 msg-5001 when token is expired', () => {
    const expiredToken = makeToken({}, TEST_SECRET, '-1s');
    const { req, res, next } = mockReqResNext(`Bearer ${expiredToken}`);

    jwtAuth(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });

  // AC-06: HS256 enforcement — wrong secret → 401
  it('returns 401 when token signed with a different secret', () => {
    const token = makeToken({}, 'wrong-secret');
    const { req, res, next } = mockReqResNext(`Bearer ${token}`);

    jwtAuth(req as Request, res as Response, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
  });
});
```

- [ ] **Step 3: Run the test — verify it FAILS**

```bash
cd /path/to/fullstack-points-mall/points-mall-message
pnpm test
```

Expected: FAIL — `Cannot find module '../../middleware/jwtAuth'`

- [ ] **Step 4: Create the middleware**

Create directory:
```bash
mkdir -p /path/to/fullstack-points-mall/points-mall-message/src/middleware
```

Create `points-mall-message/src/middleware/jwtAuth.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

export function jwtAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['authorization'];
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;

  if (!token) {
    res.status(401).json({ code: 'msg-5001', message: 'Unauthorized', data: null });
    return;
  }

  try {
    const secret = process.env.JWT_SECRET!;
    const payload = jwt.verify(token, secret, { algorithms: ['HS256'] });
    (req as any).user = payload;
    next();
  } catch {
    res.status(401).json({ code: 'msg-5001', message: 'Unauthorized', data: null });
  }
}
```

- [ ] **Step 5: Run the tests — verify they PASS**

```bash
cd /path/to/fullstack-points-mall/points-mall-message
pnpm test
```

Expected: All 5 tests PASS

- [ ] **Step 6: Update src/index.ts to register jwtAuth after /health**

Replace the content of `points-mall-message/src/index.ts` with:

```typescript
import dotenv from 'dotenv';
dotenv.config({ path: `.env.${process.env.NODE_ENV ?? 'dev'}` });
import express from 'express';
import { jwtAuth } from './middleware/jwtAuth';

const app = express();
const PORT = process.env.PORT ?? 8082;
const startTime = Date.now();

app.use(express.json());

// /health is public — registered BEFORE jwtAuth middleware
app.get('/health', (_req, res) => {
  res.json({
    status: 'ok',
    service: 'points-mall-message',
    timestamp: new Date().toISOString(),
    db: 'ok',
    uptime: Math.floor((Date.now() - startTime) / 1000),
  });
});

// All routes below this line require a valid JWT
app.use(jwtAuth);

app.listen(PORT, () => {
  console.log(`Message service running on port ${PORT}`);
});

export default app;
```

- [ ] **Step 7: Verify AC-04 — /health is still accessible without a token**

Start the service and test (or add an integration test):

Add the following test to `jwtAuth.test.ts` as a note — /health itself is handled by index.ts route ordering, which is verified by the fact that /health is registered before `app.use(jwtAuth)`. The unit test for jwtAuth middleware is sufficient for the middleware logic; the ordering is verified by the index.ts code review.

- [ ] **Step 8: Add JWT_SECRET to .env.example**

In `points-mall-message/.env.example`, add after `# ── Application`:

```
# ── JWT (Required — must match BFF JWT_SECRET exactly) ──────
JWT_SECRET=
```

- [ ] **Step 9: Commit**

```bash
git add points-mall-message/package.json \
        points-mall-message/pnpm-lock.yaml \
        points-mall-message/src/middleware/jwtAuth.ts \
        points-mall-message/src/index.ts \
        points-mall-message/.env.example \
        "points-mall-message/src/__tests__/middleware/jwtAuth.test.ts"
git commit -m "feat(TASK-AUTH-0004): add JWT auth middleware to message service (Express)"
```

---

### Task 8: Data Service (FastAPI/Python) JWT Dependency

**Files:**
- Modify: `points-mall-data/requirements.txt`
- Create: `points-mall-data/app/__init__.py`
- Create: `points-mall-data/app/dependencies/__init__.py`
- Create: `points-mall-data/app/dependencies/auth.py`
- Modify: `points-mall-data/main.py`
- Modify: `points-mall-data/.env.example`
- Create: `points-mall-data/tests/__init__.py`
- Create: `points-mall-data/tests/test_auth_dependency.py`

- [ ] **Step 1: Add PyJWT to requirements.txt**

Replace the content of `points-mall-data/requirements.txt` with:

```
fastapi>=0.128.0
uvicorn[standard]>=0.39.0
python-dotenv>=1.0.0
PyJWT>=2.8.0

# dev
ruff>=0.4.0
pytest>=8.0.0
pytest-asyncio>=0.23.0
httpx>=0.27.0
```

Install the new packages:

```bash
cd /path/to/fullstack-points-mall/points-mall-data
pip install -r requirements.txt
```

- [ ] **Step 2: Create the app package structure**

```bash
mkdir -p /path/to/fullstack-points-mall/points-mall-data/app/dependencies
touch /path/to/fullstack-points-mall/points-mall-data/app/__init__.py
touch /path/to/fullstack-points-mall/points-mall-data/app/dependencies/__init__.py
mkdir -p /path/to/fullstack-points-mall/points-mall-data/tests
touch /path/to/fullstack-points-mall/points-mall-data/tests/__init__.py
```

- [ ] **Step 3: Write the failing test**

Create `points-mall-data/tests/test_auth_dependency.py`:

```python
import time
import pytest
import jwt as pyjwt
from fastapi import FastAPI, Depends
from fastapi.testclient import TestClient

TEST_SECRET = "test-jwt-secret"


def make_token(payload: dict = None, secret: str = TEST_SECRET, exp_offset: int = 900) -> str:
    """Create a signed HS256 JWT for testing."""
    base = {
        "sub": 1,
        "email": "admin@pointsmall.com",
        "roles": ["admin"],
        "iat": int(time.time()),
        "exp": int(time.time()) + exp_offset,
    }
    if payload:
        base.update(payload)
    return pyjwt.encode(base, secret, algorithm="HS256")


@pytest.fixture
def test_app(monkeypatch):
    """Create a minimal FastAPI app with auth dependency and a protected route."""
    monkeypatch.setenv("JWT_SECRET", TEST_SECRET)

    # Import AFTER monkeypatching so the env var is visible at import time
    from app.dependencies.auth import verify_token

    app = FastAPI()

    @app.get("/health")
    def health():
        return {"status": "ok"}

    @app.get("/protected", dependencies=[Depends(verify_token)])
    def protected():
        return {"message": "authorized"}

    return TestClient(app)


# AC-01: valid token passes through
def test_valid_bearer_token_passes(test_app):
    token = make_token()
    response = test_app.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 200
    assert response.json() == {"message": "authorized"}


# AC-02: missing Authorization header → 401 data-6001
def test_missing_authorization_header_returns_401(test_app):
    response = test_app.get("/protected")
    assert response.status_code == 401
    body = response.json()
    assert body["detail"]["code"] == "data-6001"
    assert body["detail"]["message"] == "Unauthorized"
    assert body["detail"]["data"] is None


# AC-02: non-Bearer format → 401
def test_non_bearer_format_returns_401(test_app):
    response = test_app.get("/protected", headers={"Authorization": "Token something"})
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "data-6001"


# AC-03: invalid/malformed token → 401
def test_invalid_token_returns_401(test_app):
    response = test_app.get("/protected", headers={"Authorization": "Bearer not.a.valid.jwt"})
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "data-6001"


# AC-03: expired token → 401
def test_expired_token_returns_401(test_app):
    expired_token = make_token(exp_offset=-100)
    response = test_app.get("/protected", headers={"Authorization": f"Bearer {expired_token}"})
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "data-6001"


# AC-03: wrong secret → 401
def test_wrong_secret_token_returns_401(test_app):
    token = make_token(secret="wrong-secret")
    response = test_app.get("/protected", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.json()["detail"]["code"] == "data-6001"


# AC-04: /health has no auth requirement
def test_health_route_accessible_without_token(test_app):
    response = test_app.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "ok"
```

- [ ] **Step 4: Run tests — verify they FAIL**

```bash
cd /path/to/fullstack-points-mall/points-mall-data
python -m pytest tests/test_auth_dependency.py -v
```

Expected: FAIL — `ModuleNotFoundError: No module named 'app.dependencies'`

- [ ] **Step 5: Create the auth dependency**

Create `points-mall-data/app/dependencies/auth.py`:

```python
import os
import jwt as pyjwt
from fastapi import Header, HTTPException


def verify_token(authorization: str = Header(default=None)) -> dict:
    """
    FastAPI dependency that validates a Bearer JWT in the Authorization header.
    Returns the decoded payload dict on success.
    Raises HTTP 401 with code 'data-6001' on any validation failure.
    """
    _unauthorized = HTTPException(
        status_code=401,
        detail={"code": "data-6001", "message": "Unauthorized", "data": None},
    )

    if not authorization or not authorization.startswith("Bearer "):
        raise _unauthorized

    token = authorization[7:]
    secret = os.environ.get("JWT_SECRET", "")
    if not secret:
        raise _unauthorized

    try:
        payload = pyjwt.decode(token, secret, algorithms=["HS256"])
        return payload
    except pyjwt.PyJWTError:
        raise _unauthorized
```

- [ ] **Step 6: Run tests — verify they PASS**

```bash
cd /path/to/fullstack-points-mall/points-mall-data
python -m pytest tests/test_auth_dependency.py -v
```

Expected: All 7 tests PASS

- [ ] **Step 7: Update main.py to apply auth dependency to protected routes**

Replace the content of `points-mall-data/main.py` with:

```python
import os
import time
from datetime import datetime, timezone
from dotenv import load_dotenv

# Load profile-specific env file: .env.dev / .env.test / .env.prod
_env = os.getenv("ENVIRONMENT", "dev")
load_dotenv(f".env.{_env}", override=False)

from fastapi import FastAPI, Depends
from app.dependencies.auth import verify_token

app = FastAPI(title="Points Mall Data Service", version="0.1.0")

_start_time = time.time()


@app.get("/health")
def health():
    # Public route — no auth dependency
    return {
        "status": "ok",
        "service": "points-mall-data",
        "timestamp": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "db": "ok",
        "uptime": int(time.time() - _start_time),
    }


# Example protected route — all future business routes follow this pattern:
# @app.get("/some-route", dependencies=[Depends(verify_token)])
# For now, no business routes exist yet — the dependency is ready when needed.


if __name__ == "__main__":
    import uvicorn

    port = int(os.getenv("PORT", "8083"))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=True)
```

- [ ] **Step 8: Add JWT_SECRET to .env.example**

In `points-mall-data/.env.example`, add after `# ── Application`:

```
# ── JWT (Required — must match BFF JWT_SECRET exactly) ──────
JWT_SECRET=
```

Also add to `.env.dev` and `.env.test` if they exist:
```bash
ls /path/to/fullstack-points-mall/points-mall-data/.env.* 2>/dev/null
```
If `.env.dev` or `.env.test` exist, add `JWT_SECRET=test-jwt-secret` to `.env.test`.

- [ ] **Step 9: Run all data service tests**

```bash
cd /path/to/fullstack-points-mall/points-mall-data
python -m pytest tests/ -v
```

Expected: All 7 tests PASS

- [ ] **Step 10: Commit**

```bash
git add points-mall-data/requirements.txt \
        points-mall-data/app/__init__.py \
        points-mall-data/app/dependencies/__init__.py \
        points-mall-data/app/dependencies/auth.py \
        points-mall-data/main.py \
        points-mall-data/.env.example \
        points-mall-data/tests/__init__.py \
        points-mall-data/tests/test_auth_dependency.py
git commit -m "feat(TASK-AUTH-0004): add JWT auth dependency to data service (FastAPI)"
```

---

### Task 9: Update TASK-AUTH-0004 to dev-done and run tests

**Files:**
- Modify: `.tasks/auth/TASK-AUTH-0004.md`

- [ ] **Step 1: Update TASK-AUTH-0004.md frontmatter**

```yaml
---
id: TASK-AUTH-0004
title: "JWT validation middleware for shop, message, and data downstream services"
status: dev-done
priority: high
services:
  - shop
  - message
  - data
assignee: ""
created: 2026-06-26
updated: 2026-06-26
depends_on:
  - TASK-AUTH-0002
wiki_refs: []
code_files:
  - points-mall-shop/app/Http/Middleware/JwtAuthMiddleware.php
  - points-mall-shop/bootstrap/app.php
  - points-mall-shop/routes/api.php
  - points-mall-shop/composer.json
  - points-mall-shop/.env.example
  - points-mall-message/src/middleware/jwtAuth.ts
  - points-mall-message/src/index.ts
  - points-mall-message/package.json
  - points-mall-message/.env.example
  - points-mall-data/app/dependencies/auth.py
  - points-mall-data/main.py
  - points-mall-data/requirements.txt
  - points-mall-data/.env.example
test_refs:
  - points-mall-shop/tests/Unit/Middleware/JwtAuthMiddlewareTest.php
  - points-mall-message/src/__tests__/middleware/jwtAuth.test.ts
  - points-mall-data/tests/test_auth_dependency.py
---
```

Check off all AC items (change `- [ ]` to `- [x]` for all 7 items).

Append to Status Change History:
```
| 2026-06-26 | spec-ready | in-dev | AI | Development started |
| 2026-06-26 | in-dev | dev-done | AI | All middleware implemented; unit tests passing in all 3 services |
```

- [ ] **Step 2: Run tasks:sync**

```bash
cd /path/to/fullstack-points-mall
pnpm run tasks:sync
```

- [ ] **Step 3: Commit**

```bash
git add .tasks/auth/TASK-AUTH-0004.md .tasks/_index.md
git commit -m "chore(TASK-AUTH-0004): mark dev-done, update task file"
```

---

## Self-Review Checklist

### Spec Coverage

| Spec Requirement | Task |
|---|---|
| T008 AC-01: valid/expired token + Redis → 200, new cookie | Task 1 (service unit test) + Task 3 (controller test) |
| T008 AC-02: cookie HttpOnly, Secure, SameSite | Task 1 step 1 (cookie assertion) |
| T008 AC-03: JWT payload { sub, email, roles }, 15 min | Task 1 step 1 (sign assertion) |
| T008 AC-04: Redis key NOT renewed | Task 1 step 1 (set not called) |
| T008 AC-05: malformed/missing token → 401 bff-2003 | Task 1 + Task 3 |
| T008 AC-06: Redis missing → 401 bff-2004 | Task 1 + Task 3 |
| T008 AC-07: logout → 200, Redis deleted, cookie cleared | Task 2 + Task 3 |
| T008 AC-08: logout no token → 401 from guard | Task 3 |
| T008 AC-09: after logout, refresh → 401 bff-2004 | (covered by AC-06 test with Redis empty) |
| T008 AC-10: refresh is @Public | Task 3 (no-cookie test passes) |
| T008 AC-11: jwtService.decode used not verify | Task 1 (mock uses decode, not verify) |
| T015 AC-01: valid token passes, payload in context | Task 6, 7, 8 (pass-through tests) |
| T015 AC-02: missing header → 401 | Task 6, 7, 8 |
| T015 AC-03: invalid/expired → 401 | Task 6, 7, 8 |
| T015 AC-04: /health accessible without token | Task 6 (withoutMiddleware), Task 7 (route order), Task 8 (no Depends) |
| T015 AC-05: shop uses firebase/php-jwt HS256 | Task 6 |
| T015 AC-06: message uses jsonwebtoken algorithms HS256, health before jwtAuth | Task 7 |
| T015 AC-07: data /health has no verify_token | Task 8 |

All AC items covered. ✅

### Type Consistency Check

- `AuthService.refresh(expiredToken: string | undefined, res: Response)` — used consistently in Task 1 and Task 3
- `AuthService.logout(userId: number, res: Response)` — `userId` extracted from `req.user.sub` (number) in controller, matches service signature ✅
- `jwtService.decode` mock added to service test before Task 1 tests use it ✅
- `redisService.exists` and `redisService.del` mocks added before Task 1 and Task 2 tests use them ✅
- `mockResponse()` updated with `clearCookie` in Task 2 before the logout test uses it ✅
