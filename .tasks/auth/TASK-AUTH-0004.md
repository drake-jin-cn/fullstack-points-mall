---
id: TASK-AUTH-0004
title: "JWT validation middleware for all downstream services (shop, message, data, tpc)"
status: test-pass
priority: high
services:
  - shop
  - message
  - data
  - tpc
assignee: ""
created: 2026-06-26
updated: 2026-06-26
depends_on:
  - TASK-AUTH-0002
wiki_refs:
  - .wiki/features/auth.md
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
  - points-mall-thirdparty-connector/src/main/java/com/pointsmall/thirdparty/security/JwtAuthWebFilter.java
  - points-mall-thirdparty-connector/src/main/java/com/pointsmall/thirdparty/security/SecurityConfig.java
  - points-mall-thirdparty-connector/src/main/resources/application.yml
  - points-mall-thirdparty-connector/pom.xml
  - points-mall-thirdparty-connector/.env.example
  - points-mall-shop/tests/Unit/Middleware/JwtAuthMiddlewareTest.php
  - points-mall-data/tests/test_auth_dependency.py
  - points-mall-thirdparty-connector/src/test/java/com/pointsmall/thirdparty/security/JwtAuthWebFilterTest.java
test_refs:
  - points-mall-message/src/__tests__/middleware/jwtAuth.test.ts
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

- [x] AC-01 Valid Bearer token → route handler proceeds, payload in request context
- [x] AC-02 Missing Authorization header → HTTP 401 `{ code:'<svc>-xxxx', message:'Unauthorized', data:null }`
- [x] AC-03 Invalid/expired JWT → HTTP 401, same body as AC-02
- [x] AC-04 GET /health (or /api/health) → HTTP 200 without any token
- [x] AC-05 (Shop) JWT_SECRET read from env; firebase/php-jwt HS256 used
- [x] AC-06 (Message) jsonwebtoken with algorithms:['HS256']; /health registered before jwtAuth
- [x] AC-07 (Data) verify_token FastAPI dependency; /health has no Depends(verify_token)
- [x] AC-08 (TPC) JwtAuthWebFilter (Spring WebFlux WebFilter); /health excluded; error code tpc-7001

## Status Change History

| Time | Previous Status | New Status | Actor | Notes |
|------|-----------------|------------|-------|-------|
| 2026-06-26 | test-pass | test-pass | script | test:task run |
| 2026-06-26 | dev-done | test-pass | script | test:task run |
| 2026-06-26 | — | draft | AI | Raw requirements converted to structured TASK |
| 2026-06-26 | draft | spec-pending | AI | Spec generated via brainstorming |
| 2026-06-26 | spec-pending | spec-ready | Human | Approved in brainstorming session |
| 2026-06-26 | spec-ready | in-dev | AI | Development started on feat/TASK-AUTH-0004 |
| 2026-06-26 | in-dev | dev-done | AI | Shop: 6 PHPUnit tests; Message: 6 Vitest tests; Data: 7 pytest tests; TPC: 6 JUnit tests (Spring WebFlux) |
