# Auth Feature Spec

> **Status:** active  
> **Related tasks:** TASK-AUTH-0001  
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
