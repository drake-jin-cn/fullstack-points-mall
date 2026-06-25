# T006 — Employee Credential Verification API: Design Spec

**Date:** 2026-06-25  
**Task:** T006 (Phase 1 — Auth Foundation)  
**Service:** `points-mall-core` (Spring Boot)  
**Status:** spec-pending

---

## 1. Background

Phase 0 created the `employees` table (V2 migration) with `password_hash VARCHAR(255)` as nullable.
Phase 1 requires the Core service to expose an internal-only credential verification endpoint so the
BFF (`points-mall-bff`) can authenticate employees via email + bcrypt password before issuing JWTs.

---

## 2. Goals

1. Add `POST /internal/auth/verify` — validate email + bcrypt password, return employee info.
2. Restrict the endpoint to internal callers via `INTERNAL_API_KEY` header.
3. Enforce `password_hash NOT NULL` via Flyway migration V7.
4. Seed one admin + two employee accounts in `dev` / `test` environments.
5. Establish a **system-wide error code convention** (service-prefixed enum) that all future services follow.

---

## 3. Out of Scope

- JWT issuance (that is T007, handled in `points-mall-bff`).
- GitHub OAuth / OIDC login flows (T012–T014, T097–T099).
- Role/permission management beyond seeding the two existing roles (`admin`, `employee`).

---

## 4. Architecture

```
[BFF - T007]
     │  POST /internal/auth/verify
     │  Header: INTERNAL_API_KEY: <secret>
     ▼
InternalApiKeyFilter          ← OncePerRequestFilter, intercepts /internal/**
     │  key missing/invalid → 401 { code:"core-1003", ... }
     ▼
AuthVerifyController          ← POST /internal/auth/verify
     ▼
EmployeeAuthService           ← query by email, BCrypt verify
     ▼
EmployeeRepository            ← JPA, findByEmail()
     ▼
PostgreSQL (employees table)
```

---

## 5. Database

### V7 Migration

File: `points-mall-core/src/main/resources/db/migration/V7__add_password_hash_not_null.sql`

```sql
-- V2 created password_hash as nullable. Now that all employees are seeded with passwords,
-- enforce NOT NULL at the DB level.
--
-- ⚠️ T013 Amendment Required: When GitHub OAuth (T013) creates OAuth-only employees,
-- this constraint MUST be re-evaluated. Options at that time:
--   (a) Revert to nullable  (b) Store a sentinel hash for OAuth users
-- Document the decision in V13 or via a Spec amendment.
ALTER TABLE employees ALTER COLUMN password_hash SET NOT NULL;
```

---

## 6. API Contract

### Request

```
POST /internal/auth/verify
Content-Type: application/json
INTERNAL_API_KEY: <value from env>
```

```json
{ "email": "admin@points-mall.com", "password": "Admin@123" }
```

### Success Response — HTTP 200

```json
{
  "code": "OK",
  "message": "success",
  "data": {
    "id": 1,
    "name": "Admin",
    "email": "admin@points-mall.com",
    "isActive": true,
    "roles": ["admin"]
  }
}
```

### Error Responses

| Scenario | HTTP | `code` | `message` |
|----------|------|--------|-----------|
| API key missing / invalid | 401 | `core-1003` | `Missing or invalid API key` |
| email not found | 401 | `core-1001` | `Invalid credentials` |
| password mismatch | 401 | `core-1001` | `Invalid credentials` |
| account disabled | 403 | `core-1002` | `Account disabled` |
| unexpected internal error | 500 | `core-1099` | `Unexpected internal error` |

> **Security note:** `email not found` and `password mismatch` share the same error code and message
> to prevent user enumeration attacks.

Error response envelope (errors only include `traceId`):

```json
{
  "code": "core-1001",
  "message": "Invalid credentials",
  "data": null,
  "traceId": "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
}
```

---

## 7. System-Wide Error Code Convention

This task establishes the **global error code convention** for all services:

| Service | Prefix | Range |
|---------|--------|-------|
| `points-mall-core` | `core` | `core-1xxx` |
| `points-mall-bff` | `bff` | `bff-2xxx` |
| `points-mall-thirdparty-connector` | `tpc` | `tpc-3xxx` |
| `points-mall-shop` | `shop` | `shop-4xxx` |
| `points-mall-message` | `msg` | `msg-5xxx` |
| `points-mall-data` | `data` | `data-6xxx` |

**Propagation rule:** When BFF calls a downstream service and receives an error response, it passes the
original `code` field through to the frontend unchanged. The frontend will see `core-1001` or `tpc-3001`
directly — never a generic `401` that loses the source context.

**Enum pattern (all services must follow):**  
Each service defines its own `XxxErrorCode` enum. `GlobalExceptionHandler` maps all exceptions
through the enum — raw exceptions never reach the response body. Unknown exceptions fall back to
`INTERNAL_ERROR` (`xxx-x099`).

### `CoreErrorCode` Enum (T006)

```java
public enum CoreErrorCode {
    // ── Auth ───────────────────────────────────────────────────────────
    INVALID_CREDENTIALS  ("core-1001", "Invalid credentials"),
    ACCOUNT_DISABLED     ("core-1002", "Account disabled"),
    UNAUTHORIZED_CALLER  ("core-1003", "Missing or invalid API key"),

    // ── Validation ─────────────────────────────────────────────────────
    VALIDATION_FAILED    ("core-1010", "Request validation failed"),

    // ── Internal ───────────────────────────────────────────────────────
    INTERNAL_ERROR       ("core-1099", "Unexpected internal error");

    private final String code;
    private final String message;

    CoreErrorCode(String code, String message) {
        this.code = code;
        this.message = message;
    }

    public String getCode()    { return code; }
    public String getMessage() { return message; }
}
```

---

## 8. Response Envelope

Shared `ApiResponse<T>` wrapper used by all Core internal endpoints:

```java
// Success
{ "code": "OK", "message": "success", "data": <T> }

// Error
{ "code": "<CoreErrorCode.code>", "message": "<text>", "data": null, "traceId": "<uuid>" }
```

`traceId` in errors:
- **T006 scope:** Core generates a UUID per request via `MDC` / `UUID.randomUUID()`.
- **⚠️ Sub-task for T007:** Once BFF is implemented, it should forward an `X-Trace-Id` request header.
  Core must prefer that value over its own generated UUID to enable end-to-end trace correlation.
  Add as an Acceptance Criteria item in the T007 task file.

---

## 9. Component Structure

```
points-mall-core/src/main/java/com/pointsmall/core/
├── common/
│   ├── ApiResponse.java                  # Generic response wrapper (new)
│   └── exception/
│       ├── CoreErrorCode.java            # Error code enum (new)
│       ├── BusinessException.java        # Runtime exception carrying a CoreErrorCode (new)
│       └── GlobalExceptionHandler.java   # @RestControllerAdvice (new)
├── config/
│   └── FilterConfig.java                 # Registers InternalApiKeyFilter bean (new)
├── employee/
│   ├── Employee.java                     # JPA entity (new)
│   ├── EmployeeRepository.java           # findByEmail() (new)
│   └── seeder/
│       └── EmployeeSeeder.java           # @Profile("dev","test") ApplicationRunner (new)
└── internal/
    └── auth/
        ├── InternalApiKeyFilter.java     # OncePerRequestFilter for /internal/** (new)
        ├── AuthVerifyController.java     # POST /internal/auth/verify (new)
        ├── EmployeeAuthService.java      # BCrypt verify logic (new)
        └── dto/
            ├── VerifyRequest.java        # { email, password } (new)
            └── VerifyResponse.java       # { id, name, email, isActive, roles } (new)
```

### `pom.xml` changes

Add `spring-security-crypto` (BCrypt only, no full Security auto-configuration):

```xml
<dependency>
    <groupId>org.springframework.security</groupId>
    <artifactId>spring-security-crypto</artifactId>
</dependency>
```

---

## 10. INTERNAL_API_KEY Configuration

Loaded from environment variable — **no default value**. Application startup fails with a clear error
if the variable is not set.

```yaml
# application.yml
internal:
  api-key: ${INTERNAL_API_KEY}   # no default — must be explicitly set
```

`InternalApiKeyFilter` reads `@Value("${internal.api-key}")`. If the property is missing, Spring
context initialization fails before the first request is served.

---

## 11. Employee Seeder

Active in `dev` and `test` profiles only (`@Profile({"dev", "test"})`).

| Email | Password | Role |
|-------|----------|------|
| `admin@points-mall.com` | `Admin@123` | `admin` |
| `alice@points-mall.com` | `Employee@123` | `employee` |
| `bob@points-mall.com` | `Employee@123` | `employee` |

BCrypt strength: 12 rounds. Seeder is idempotent (`findByEmail` + skip if already exists).

---

## 12. Test Plan

| Type | File | Covers |
|------|------|--------|
| Unit | `EmployeeAuthServiceTest.java` | valid login, email not found, wrong password, disabled account |
| Integration | `AuthVerifyControllerTest.java` | missing API key, wrong API key, full happy path with DB |
| API (Bruno) | `.tests/api/core/auth/verify.bru` | manual acceptance across all scenarios |

---

## 13. Affected Files

| Path | Change |
|------|--------|
| `points-mall-core/src/main/resources/db/migration/V7__add_password_hash_not_null.sql` | New |
| `points-mall-core/pom.xml` | Add `spring-security-crypto` |
| `points-mall-core/src/main/java/com/pointsmall/core/common/ApiResponse.java` | New |
| `points-mall-core/src/main/java/com/pointsmall/core/common/exception/CoreErrorCode.java` | New |
| `points-mall-core/src/main/java/com/pointsmall/core/common/exception/BusinessException.java` | New |
| `points-mall-core/src/main/java/com/pointsmall/core/common/exception/GlobalExceptionHandler.java` | New |
| `points-mall-core/src/main/java/com/pointsmall/core/config/FilterConfig.java` | New |
| `points-mall-core/src/main/java/com/pointsmall/core/employee/Employee.java` | New |
| `points-mall-core/src/main/java/com/pointsmall/core/employee/EmployeeRepository.java` | New |
| `points-mall-core/src/main/java/com/pointsmall/core/employee/seeder/EmployeeSeeder.java` | New |
| `points-mall-core/src/main/java/com/pointsmall/core/internal/auth/InternalApiKeyFilter.java` | New |
| `points-mall-core/src/main/java/com/pointsmall/core/internal/auth/AuthVerifyController.java` | New |
| `points-mall-core/src/main/java/com/pointsmall/core/internal/auth/EmployeeAuthService.java` | New |
| `points-mall-core/src/main/java/com/pointsmall/core/internal/auth/dto/VerifyRequest.java` | New |
| `points-mall-core/src/main/java/com/pointsmall/core/internal/auth/dto/VerifyResponse.java` | New |
| `points-mall-core/src/main/resources/application.yml` | Add `internal.api-key` property |
| `.tests/api/core/auth/verify.bru` | New Bruno test |
| `.tasks/auth/TASK-AUTH-0001.md` | New task file |
| `.wiki/features/auth.md` | Update with error code convention + this endpoint |
