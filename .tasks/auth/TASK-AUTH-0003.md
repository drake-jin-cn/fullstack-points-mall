---
id: TASK-AUTH-0003
title: "BFF token refresh and logout: POST /auth/refresh + POST /auth/logout"
status: test-pass
priority: high
services:
  - bff
assignee: ""
created: 2026-06-26
updated: 2026-06-26
depends_on:
  - TASK-AUTH-0002
wiki_refs:
  - .wiki/features/auth.md
code_files:
  - points-mall-bff/src/auth/auth.service.ts
  - points-mall-bff/src/auth/auth.controller.ts
  - .tests/api/bff/auth/refresh-valid.bru
  - .tests/api/bff/auth/refresh-no-redis.bru
  - .tests/api/bff/auth/refresh-invalid-token.bru
  - .tests/api/bff/auth/logout-valid.bru
  - .tests/api/bff/auth/logout-no-token.bru
test_refs:
  - points-mall-bff/src/auth/__tests__/auth.service.spec.ts
  - points-mall-bff/src/auth/__tests__/auth.controller.spec.ts
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

- [x] AC-01 Valid (or expired) access_token cookie + Redis key exists → HTTP 200, new access_token cookie, body `{ code:'OK', data:{ user:{id,email,roles} } }`
- [x] AC-02 New cookie is HttpOnly; SameSite=Strict; Secure in production
- [x] AC-03 New access_token JWT payload contains `{ sub, email, roles }`, expires in 15 min
- [x] AC-04 Redis `refresh:{userId}` key is NOT renewed by calling /auth/refresh
- [x] AC-05 Malformed/missing token → 401 `{ code:'bff-2003', message:'Invalid token', data:null, traceId }`
- [x] AC-06 Redis key missing → 401 `{ code:'bff-2004', message:'Session expired, please login again', data:null, traceId }`
- [x] AC-07 POST /auth/logout with valid token → 200, Redis key deleted, cookie cleared
- [x] AC-08 POST /auth/logout without token → 401 (JwtAuthGuard intercepts)
- [x] AC-09 After logout, /auth/refresh returns 401 bff-2004
- [x] AC-10 POST /auth/refresh is @Public — accessible without valid token
- [x] AC-11 jwtService.decode() (not verify) used in refresh — accepts expired tokens

## Status Change History

| Time | Previous Status | New Status | Actor | Notes |
|------|-----------------|------------|-------|-------|
| 2026-06-26 | test-fail | test-pass | script | test:task run |
| 2026-06-26 | dev-done | test-fail | script | test:task run - Bruno failed |
| 2026-06-26 | — | draft | AI | Raw requirements converted to structured TASK |
| 2026-06-26 | draft | spec-pending | AI | Spec generated via brainstorming |
| 2026-06-26 | spec-pending | spec-ready | Human | Approved in brainstorming session |
| 2026-06-26 | spec-ready | in-dev | AI | Development started on feat/TASK-AUTH-0003 |
| 2026-06-26 | in-dev | dev-done | AI | 28 unit tests passing (was 14); 5 Bruno tests added |
