# T008 + T015: Auth Token Lifecycle — Refresh, Logout & Downstream JWT Validation

**Date:** 2026-06-26  
**Tasks:** T008 (BFF token refresh & logout), T015 (downstream JWT middleware)  
**Status:** Approved — ready for implementation

---

## Background

T006 (TASK-AUTH-0001) delivered Core's credential verification endpoint.  
T007 (TASK-AUTH-0002) delivered BFF login: `access_token` cookie (15 min) + `refresh:{userId}` Redis key (7 days).

The next two tasks complete the auth token lifecycle:

- **T008**: BFF token refresh (`POST /auth/refresh`) and logout (`POST /auth/logout`)
- **T015**: JWT validation middleware in the three remaining downstream services (shop, message, data)

T008 and T015 are independent — they can be implemented in any order or in parallel.

---

## T008 — BFF Token Refresh & Logout

### Design Decisions

- **Refresh identity mechanism**: Use the expired `access_token` cookie to identify the user (`jwtService.decode()` without expiry check), then validate server-side by checking Redis `refresh:{userId}` exists. The `refresh_token` value is never sent to the browser (per T007 AC-22).
- **Silent refresh pattern**: Client-driven (Option B). Guard returns 401 on expiry; Axios interceptor calls `/auth/refresh` and retries. This keeps `JwtAuthGuard` single-responsibility.
- **Logout scope**: Invalidate session by DEL `refresh:{userId}` from Redis. Clear `access_token` cookie.

### POST /auth/refresh (Public)

**Request**: No body required. Must carry `access_token` cookie (may be expired).

**Flow**:
```
1. Read `access_token` cookie
2. jwtService.decode(token) — NO signature/expiry verification
   └─ if decode fails (malformed) → 401 bff-2003 "Invalid token"
3. Extract sub (userId), email, roles from payload
4. redis.exists(`refresh:${sub}`)
   └─ if false → 401 bff-2004 "Session expired, please login again"
5. jwtService.sign({ sub, email, roles }, JWT_SECRET, expiresIn: 15m)
6. res.cookie('access_token', newToken, { httpOnly, secure, sameSite:'strict', maxAge:15min, path:'/' })
7. return 200 { code:'OK', data:{ user:{ id, email, roles } } }
```

**Responses**:

| Scenario | HTTP | Code | Message |
|---|---|---|---|
| Success | 200 | `OK` | `success` |
| Malformed token | 401 | `bff-2003` | `Invalid token` |
| Redis key missing | 401 | `bff-2004` | `Session expired, please login again` |

### POST /auth/logout (Protected — JwtAuthGuard applies)

**Request**: No body required. Must carry valid `access_token` cookie.

**Flow**:
```
1. JwtAuthGuard verifies access_token → attaches request.user = { sub, email, roles }
2. AuthService.logout(sub, res):
   a. redis.del(`refresh:${sub}`)
   b. res.clearCookie('access_token', { path:'/' })
3. return 200 { code:'OK', data: null }
```

**Responses**:

| Scenario | HTTP | Code | Message |
|---|---|---|---|
| Success | 200 | `OK` | `success` |
| No/invalid token | 401 | `bff-2001` | `Missing access token` / `Invalid or expired access token` (from JwtAuthGuard) |

### New BFF Error Codes

| Code | HTTP | Scenario |
|---|---|---|
| `bff-2003` | 401 | `access_token` cookie cannot be decoded (malformed JWT) |
| `bff-2004` | 401 | Redis `refresh:{userId}` key does not exist (session expired) |

### Affected Files (T008)

| File | Change |
|---|---|
| `points-mall-bff/src/auth/auth.controller.ts` | Add `@Public() @Post('refresh')` and `@Post('logout')` handlers |
| `points-mall-bff/src/auth/auth.service.ts` | Add `refresh(token, res)` and `logout(userId, res)` methods |
| `points-mall-bff/src/auth/__tests__/auth.service.spec.ts` | Add unit tests for refresh + logout |
| `points-mall-bff/src/auth/__tests__/auth.controller.spec.ts` | Add route-level tests for refresh + logout |
| `.tests/api/bff/auth/refresh-valid.bru` | New Bruno test |
| `.tests/api/bff/auth/refresh-no-redis.bru` | New Bruno test |
| `.tests/api/bff/auth/refresh-invalid-token.bru` | New Bruno test |
| `.tests/api/bff/auth/logout-valid.bru` | New Bruno test |
| `.tests/api/bff/auth/logout-no-token.bru` | New Bruno test |

### Acceptance Criteria (T008)

**POST /auth/refresh — Happy Path**
- [ ] AC-01 Valid (or expired) `access_token` cookie + Redis `refresh:{userId}` key exists → HTTP 200, new `access_token` cookie set, body `{ code:'OK', data:{ user:{id, email, roles} } }`
- [ ] AC-02 New `access_token` cookie is `HttpOnly; SameSite=Strict; Path=/` and `Secure` when `NODE_ENV=production`
- [ ] AC-03 New `access_token` JWT payload contains `{ sub, email, roles }` and expires in 15 minutes
- [ ] AC-04 Redis `refresh:{userId}` key is NOT renewed/extended by calling this endpoint

**POST /auth/refresh — Error Cases**
- [ ] AC-05 Malformed/missing `access_token` cookie → HTTP 401, `{ code:'bff-2003', message:'Invalid token', data:null, traceId:'<uuid>' }`
- [ ] AC-06 Valid token but Redis `refresh:{userId}` key does not exist → HTTP 401, `{ code:'bff-2004', message:'Session expired, please login again', data:null, traceId:'<uuid>' }`

**POST /auth/logout**
- [ ] AC-07 Valid `access_token` cookie → HTTP 200, Redis `refresh:{userId}` key is deleted, `access_token` cookie is cleared
- [ ] AC-08 Request without `access_token` cookie → HTTP 401 (JwtAuthGuard intercepts before reaching handler)
- [ ] AC-09 After logout, calling `/auth/refresh` with the old cookie → HTTP 401 `bff-2004` (Redis key gone)

**Security**
- [ ] AC-10 `POST /auth/refresh` is decorated with `@Public()` — JwtAuthGuard does not block it even without a valid token
- [ ] AC-11 `jwtService.decode()` is used (not `verify`) in the refresh flow — expired tokens are accepted for identity extraction only

---

## T015 — Downstream JWT Validation Middleware

### Design Decisions

- **Token location**: `Authorization: Bearer <token>` header (not cookie — downstream services are called by BFF on behalf of users, over internal network)
- **Algorithm**: HS256 with shared `JWT_SECRET` environment variable (identical value to BFF's `JWT_SECRET`)
- **Health routes excluded**: `/health` (all services) does not require a token
- **Payload attachment**: Decoded payload attached to request context in each service
- **Error response format**: Each service uses its own error code prefix (`shop-4xxx`, `msg-5xxx`, `data-6xxx`) consistent with the system-wide error code convention established in T006

### Error Response Format

All three services return JSON in the same envelope as other services:

```json
{
  "code": "<svc>-<code>",
  "message": "Unauthorized",
  "data": null
}
```

No `traceId` required at this phase (internal services don't yet have tracing infrastructure).

### Shop Service (Laravel/PHP)

**Dependency**: `composer require firebase/php-jwt`

**Middleware**: `app/Http/Middleware/JwtAuthMiddleware.php`

```
handle($request, $next):
  1. $token = $request->bearerToken()
     └─ if null → return 401 JSON { code:'shop-4001', message:'Unauthorized', data:null }
  2. try JWT::decode($token, new Key(env('JWT_SECRET'), 'HS256'))
     └─ catch Exception → return 401 JSON { code:'shop-4001', ... }
  3. $request->attributes->set('auth_user', $payload)
  4. return $next($request)
```

**Registration**: In `bootstrap/app.php`, apply `JwtAuthMiddleware` to the `api` middleware group.  
`/api/health` is excluded by registering it before the middleware group or using route-level exclusion.

**New env variable**: `JWT_SECRET=` in `.env.example`

### Message Service (Express/Node.js)

**Dependency**: `npm install jsonwebtoken @types/jsonwebtoken` (or `pnpm add`)

**Middleware**: `src/middleware/jwtAuth.ts`

```typescript
export function jwtAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['authorization'];
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) → res.status(401).json({ code: 'msg-5001', message: 'Unauthorized', data: null })
  try {
    (req as any).user = jwt.verify(token, process.env.JWT_SECRET!, { algorithms: ['HS256'] });
    next();
  } catch → res.status(401).json({ code: 'msg-5001', message: 'Unauthorized', data: null })
}
```

**Registration**: In `src/index.ts`:
```typescript
app.get('/health', healthHandler);   // registered BEFORE jwtAuth
app.use(jwtAuth);                    // all subsequent routes require auth
```

**New env variable**: `JWT_SECRET=` in `.env.example` (and `.env.dev`, `.env.test`)

### Data Service (FastAPI/Python)

**Dependency**: `pip install PyJWT` (add to `requirements.txt` / `pyproject.toml`)

**Dependency function**: `app/dependencies/auth.py` (or inline in `main.py` at this phase)

```python
from fastapi import Header, HTTPException
from fastapi.security import HTTPBearer
import jwt as pyjwt

def verify_token(authorization: str = Header(None)) -> dict:
    if not authorization or not authorization.startswith('Bearer '):
        raise HTTPException(status_code=401, detail={"code": "data-6001", "message": "Unauthorized", "data": None})
    token = authorization[7:]
    try:
        return pyjwt.decode(token, JWT_SECRET, algorithms=['HS256'])
    except pyjwt.PyJWTError:
        raise HTTPException(status_code=401, detail={"code": "data-6001", "message": "Unauthorized", "data": None})
```

**Registration**: Applied as a `Depends` parameter on protected routes. `/health` does NOT inject this dependency.

**New env variable**: `JWT_SECRET=` in `.env.example`, `.env.dev`, `.env.test`

### Affected Files (T015)

| File | Change |
|---|---|
| `points-mall-shop/app/Http/Middleware/JwtAuthMiddleware.php` | New middleware |
| `points-mall-shop/bootstrap/app.php` | Register JwtAuthMiddleware on api group |
| `points-mall-shop/composer.json` | Add `firebase/php-jwt` |
| `points-mall-shop/.env.example` | Add `JWT_SECRET=` |
| `points-mall-message/src/middleware/jwtAuth.ts` | New middleware |
| `points-mall-message/src/index.ts` | Register jwtAuth, order health before auth |
| `points-mall-message/package.json` | Add `jsonwebtoken` |
| `points-mall-message/.env.example` | Add `JWT_SECRET=` |
| `points-mall-data/app/dependencies/auth.py` | New (or inline in main.py) |
| `points-mall-data/main.py` | Apply auth dependency to protected routes |
| `points-mall-data/requirements.txt` | Add `PyJWT` |
| `points-mall-data/.env.example` | Add `JWT_SECRET=` |
| `points-mall-shop/tests/Unit/Middleware/JwtAuthMiddlewareTest.php` | New unit test |
| `points-mall-message/src/__tests__/middleware/jwtAuth.test.ts` | New unit test |
| `points-mall-data/tests/test_auth_dependency.py` | New unit test |

### Acceptance Criteria (T015)

**All three services — shared behavior**
- [ ] AC-01 Request with valid `Authorization: Bearer <jwt>` header → proceeds to route handler, decoded payload accessible in request context
- [ ] AC-02 Request with missing `Authorization` header → HTTP 401, `{ code:'<svc>-<code>', message:'Unauthorized', data:null }`
- [ ] AC-03 Request with invalid/expired JWT → HTTP 401, same body as AC-02
- [ ] AC-04 `GET /health` (or `/api/health`) → HTTP 200 without requiring any token

**Shop-specific**
- [ ] AC-05 `JWT_SECRET` read from environment; app logs an error (or fails) if unset
- [ ] AC-06 Middleware uses `firebase/php-jwt` with `HS256` algorithm

**Message-specific**
- [ ] AC-07 Middleware registered after `/health` route — health check always accessible
- [ ] AC-08 Uses `jsonwebtoken` with `{ algorithms: ['HS256'] }` option

**Data-specific**
- [ ] AC-09 `verify_token` dependency raises `HTTPException(401)` on invalid token
- [ ] AC-10 `/health` endpoint does NOT declare `verify_token` as a dependency

---

## Implementation Order

Since T008 and T015 are independent, the recommended order is:

1. **T008** first — smaller scope, single service (BFF), builds on existing auth foundation
2. **T015** second — three services in parallel, each is a small self-contained middleware

Both must be complete before any downstream business features (shop catalog, notifications, data export) can be implemented securely.

---

## Out of Scope

- GitHub OAuth / OIDC login flows (T012–T014, T097–T099)
- RS256 asymmetric keys — HS256 shared secret is sufficient for this phase
- Token blacklisting beyond Redis-based session invalidation
- Rate limiting on `/auth/refresh` (Phase 7, T-perf)
- Silent refresh Axios interceptor in frontend (T-fe phase)
