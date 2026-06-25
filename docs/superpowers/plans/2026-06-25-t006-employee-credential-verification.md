# T006 — Employee Credential Verification API Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `POST /internal/auth/verify` to `points-mall-core`, gated by `INTERNAL_API_KEY` header, with BCrypt password verification, a dev/test employee seeder, and a V7 Flyway migration enforcing `password_hash NOT NULL`.

**Architecture:** `InternalApiKeyFilter` (OncePerRequestFilter) intercepts all `/internal/**` routes and checks the shared secret. `EmployeeAuthService` queries employees by email and verifies BCrypt passwords. All exceptions flow through `GlobalExceptionHandler` via the `CoreErrorCode` enum — no raw exception detail ever reaches the response body. The `EmployeeSeeder` is activated only in `dev`/`test` profiles.

**Tech Stack:** Spring Boot 4.1.0, Java 25, JPA/Hibernate, Flyway, `spring-security-crypto` (BCrypt only), JUnit 5, Mockito, MockMvc

---

## File Map

All paths relative to `points-mall-core/src/`.

| File | Action | Purpose |
|------|--------|---------|
| `main/resources/db/migration/V7__add_password_hash_not_null.sql` | Create | Enforce NOT NULL on existing column |
| `main/resources/application.yml` | Modify | Add `internal.api-key` binding |
| `main/resources/application-test.yml` | Modify | Add test API key, disable Flyway for test isolation |
| `../../pom.xml` | Modify | Add `spring-security-crypto` |
| `main/java/.../common/ApiResponse.java` | Create | Generic `{ code, message, data, traceId }` envelope |
| `main/java/.../common/exception/CoreErrorCode.java` | Create | Error code enum |
| `main/java/.../common/exception/BusinessException.java` | Create | Runtime exception carrying a CoreErrorCode |
| `main/java/.../common/exception/GlobalExceptionHandler.java` | Create | `@RestControllerAdvice` — maps all exceptions to `ApiResponse` |
| `main/java/.../employee/Role.java` | Create | JPA entity for `roles` table |
| `main/java/.../employee/Employee.java` | Create | JPA entity for `employees` table |
| `main/java/.../employee/RoleRepository.java` | Create | `findByName()` |
| `main/java/.../employee/EmployeeRepository.java` | Create | `findByEmail()` |
| `main/java/.../employee/seeder/EmployeeSeeder.java` | Create | `@Profile({"dev","test"})` seed 3 employees |
| `main/java/.../config/FilterConfig.java` | Create | Register `InternalApiKeyFilter` bean |
| `main/java/.../internal/auth/InternalApiKeyFilter.java` | Create | INTERNAL_API_KEY check for `/internal/**` |
| `main/java/.../internal/auth/dto/VerifyRequest.java` | Create | `{ email, password }` with validation |
| `main/java/.../internal/auth/dto/VerifyResponse.java` | Create | `{ id, name, email, isActive, roles }` |
| `main/java/.../internal/auth/EmployeeAuthService.java` | Create | BCrypt verify, throws `BusinessException` |
| `main/java/.../internal/auth/AuthVerifyController.java` | Create | `POST /internal/auth/verify` |
| `test/java/.../PointsMallCoreApplicationTests.java` | Modify | Add `@ActiveProfiles("test")` |
| `test/java/.../internal/auth/EmployeeAuthServiceTest.java` | Create | Unit tests (Mockito) |
| `test/java/.../internal/auth/AuthVerifyControllerTest.java` | Create | Integration tests (MockMvc) |
| `../../.tests/api/core/auth/verify.bru` | Create | Bruno manual tests |

Package prefix: `com.pointsmall.core` → abbreviated as `...` above.

---

## Task 1: V7 Migration + pom.xml + Config

**Files:**
- Create: `points-mall-core/src/main/resources/db/migration/V7__add_password_hash_not_null.sql`
- Modify: `points-mall-core/pom.xml`
- Modify: `points-mall-core/src/main/resources/application.yml`
- Modify: `points-mall-core/src/main/resources/application-test.yml`
- Modify: `points-mall-core/src/test/java/com/pointsmall/core/PointsMallCoreApplicationTests.java`

- [ ] **Step 1: Create V7 migration file**

```sql
-- points-mall-core/src/main/resources/db/migration/V7__add_password_hash_not_null.sql
--
-- V2 created password_hash as nullable (OAuth-only users have no password).
-- Now that all employees are seeded with passwords, enforce NOT NULL.
--
-- ⚠️  T013 Amendment Required: When GitHub OAuth (T013) creates OAuth-only employees,
--     this constraint MUST be re-evaluated before that task begins. Options:
--       (a) Revert to nullable   (b) Store a sentinel hash for OAuth users
ALTER TABLE employees
  ALTER COLUMN password_hash SET NOT NULL;
```

- [ ] **Step 2: Add `spring-security-crypto` to `pom.xml`**

Add inside the `<dependencies>` block, after the `postgresql` dependency:

```xml
<!-- BCrypt — spring-security-crypto only; no full Security auto-configuration -->
<dependency>
  <groupId>org.springframework.security</groupId>
  <artifactId>spring-security-crypto</artifactId>
</dependency>
```

- [ ] **Step 3: Add `internal.api-key` to `application.yml`**

Add as a top-level block **before** the `spring:` key:

```yaml
internal:
  api-key: ${INTERNAL_API_KEY}    # no default — application fails to start if unset
```

- [ ] **Step 4: Update `application-test.yml`**

Replace the full file content with:

```yaml
internal:
  api-key: test-internal-key-for-tests

spring:
  datasource:
    url: jdbc:postgresql://${DB_HOST:localhost}:${DB_PORT:5432}/${DB_NAME:points_core_test}
    username: ${DB_USERNAME:postgres}
    password: ${DB_PASSWORD:}
    driver-class-name: org.postgresql.Driver
  flyway:
    enabled: false    # schema managed by Hibernate create-drop in tests
  jpa:
    hibernate:
      ddl-auto: create-drop
    show-sql: false
    open-in-view: false
  data:
    redis:
      host: ${REDIS_HOST:localhost}
      port: ${REDIS_PORT:6379}
      password: ${REDIS_PASSWORD:}

logging:
  level:
    com.pointsmall: INFO
```

> Why disable Flyway in tests: `create-drop` + Flyway together have unpredictable ordering. Disabling Flyway lets Hibernate own the schema in tests; the `password_hash NOT NULL` constraint is still enforced by the entity's `nullable = false` annotation.

- [ ] **Step 5: Add `@ActiveProfiles("test")` to `PointsMallCoreApplicationTests`**

```java
// src/test/java/com/pointsmall/core/PointsMallCoreApplicationTests.java
package com.pointsmall.core;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest
@ActiveProfiles("test")
class PointsMallCoreApplicationTests {

  @Test
  void contextLoads() {}
}
```

> This prevents context startup from failing due to the missing `INTERNAL_API_KEY` env var (test profile provides `test-internal-key-for-tests` instead).

- [ ] **Step 6: Verify `mvn validate` passes (Spotless check on unchanged Java files)**

```bash
cd points-mall-core && mvn validate -q
```

Expected: `BUILD SUCCESS`

- [ ] **Step 7: Commit**

```bash
cd points-mall-core && git add \
  src/main/resources/db/migration/V7__add_password_hash_not_null.sql \
  pom.xml \
  src/main/resources/application.yml \
  src/main/resources/application-test.yml \
  src/test/java/com/pointsmall/core/PointsMallCoreApplicationTests.java
git commit -m "feat(TASK-AUTH-0001): V7 migration, spring-security-crypto, internal.api-key config

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 2: Common Types — ApiResponse, CoreErrorCode, BusinessException

**Files:**
- Create: `src/main/java/com/pointsmall/core/common/ApiResponse.java`
- Create: `src/main/java/com/pointsmall/core/common/exception/CoreErrorCode.java`
- Create: `src/main/java/com/pointsmall/core/common/exception/BusinessException.java`

- [ ] **Step 1: Create `CoreErrorCode` enum**

```java
// src/main/java/com/pointsmall/core/common/exception/CoreErrorCode.java
package com.pointsmall.core.common.exception;

public enum CoreErrorCode {
  // ── Auth ──────────────────────────────────────────────────────────────────
  INVALID_CREDENTIALS("core-1001", "Invalid credentials"),
  ACCOUNT_DISABLED("core-1002", "Account disabled"),
  UNAUTHORIZED_CALLER("core-1003", "Missing or invalid API key"),

  // ── Validation ────────────────────────────────────────────────────────────
  VALIDATION_FAILED("core-1010", "Request validation failed"),

  // ── Internal ──────────────────────────────────────────────────────────────
  INTERNAL_ERROR("core-1099", "Unexpected internal error");

  private final String code;
  private final String message;

  CoreErrorCode(String code, String message) {
    this.code = code;
    this.message = message;
  }

  public String getCode() {
    return code;
  }

  public String getMessage() {
    return message;
  }
}
```

- [ ] **Step 2: Create `BusinessException`**

```java
// src/main/java/com/pointsmall/core/common/exception/BusinessException.java
package com.pointsmall.core.common.exception;

public class BusinessException extends RuntimeException {

  private final CoreErrorCode errorCode;

  public BusinessException(CoreErrorCode errorCode) {
    super(errorCode.getMessage());
    this.errorCode = errorCode;
  }

  public CoreErrorCode getErrorCode() {
    return errorCode;
  }
}
```

- [ ] **Step 3: Create `ApiResponse<T>`**

```java
// src/main/java/com/pointsmall/core/common/ApiResponse.java
package com.pointsmall.core.common;

import com.fasterxml.jackson.annotation.JsonInclude;

@JsonInclude(JsonInclude.Include.NON_NULL)
public class ApiResponse<T> {

  private String code;
  private String message;
  private T data;
  private String traceId; // only present on errors

  private ApiResponse() {}

  public static <T> ApiResponse<T> ok(T data) {
    ApiResponse<T> r = new ApiResponse<>();
    r.code = "OK";
    r.message = "success";
    r.data = data;
    return r;
  }

  public static <T> ApiResponse<T> error(String code, String message, String traceId) {
    ApiResponse<T> r = new ApiResponse<>();
    r.code = code;
    r.message = message;
    r.traceId = traceId;
    return r;
  }

  public String getCode() {
    return code;
  }

  public String getMessage() {
    return message;
  }

  public T getData() {
    return data;
  }

  public String getTraceId() {
    return traceId;
  }
}
```

- [ ] **Step 4: Format and compile**

```bash
cd points-mall-core && mvn spotless:apply -q && mvn compile -q
```

Expected: `BUILD SUCCESS`

- [ ] **Step 5: Commit**

```bash
git add src/main/java/com/pointsmall/core/common/
git commit -m "feat(TASK-AUTH-0001): add ApiResponse, CoreErrorCode, BusinessException

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 3: GlobalExceptionHandler

**Files:**
- Create: `src/main/java/com/pointsmall/core/common/exception/GlobalExceptionHandler.java`

- [ ] **Step 1: Create `GlobalExceptionHandler`**

```java
// src/main/java/com/pointsmall/core/common/exception/GlobalExceptionHandler.java
package com.pointsmall.core.common.exception;

import com.pointsmall.core.common.ApiResponse;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;

@RestControllerAdvice
public class GlobalExceptionHandler {

  private static final Logger log = LoggerFactory.getLogger(GlobalExceptionHandler.class);

  @ExceptionHandler(BusinessException.class)
  public ResponseEntity<ApiResponse<Void>> handleBusiness(BusinessException ex) {
    CoreErrorCode ec = ex.getErrorCode();
    String traceId = UUID.randomUUID().toString();
    int status =
        switch (ec) {
          case INVALID_CREDENTIALS, UNAUTHORIZED_CALLER -> 401;
          case ACCOUNT_DISABLED -> 403;
          case VALIDATION_FAILED -> 400;
          default -> 500;
        };
    return ResponseEntity.status(status)
        .body(ApiResponse.error(ec.getCode(), ec.getMessage(), traceId));
  }

  @ExceptionHandler(MethodArgumentNotValidException.class)
  public ResponseEntity<ApiResponse<Void>> handleValidation(MethodArgumentNotValidException ex) {
    String traceId = UUID.randomUUID().toString();
    CoreErrorCode ec = CoreErrorCode.VALIDATION_FAILED;
    return ResponseEntity.status(HttpStatus.BAD_REQUEST)
        .body(ApiResponse.error(ec.getCode(), ec.getMessage(), traceId));
  }

  @ExceptionHandler(Exception.class)
  public ResponseEntity<ApiResponse<Void>> handleUnexpected(Exception ex) {
    String traceId = UUID.randomUUID().toString();
    log.error("Unexpected internal error [traceId={}]", traceId, ex);
    CoreErrorCode ec = CoreErrorCode.INTERNAL_ERROR;
    return ResponseEntity.status(HttpStatus.INTERNAL_SERVER_ERROR)
        .body(ApiResponse.error(ec.getCode(), ec.getMessage(), traceId));
  }
}
```

- [ ] **Step 2: Format and compile**

```bash
cd points-mall-core && mvn spotless:apply -q && mvn compile -q
```

Expected: `BUILD SUCCESS`

- [ ] **Step 3: Commit**

```bash
git add src/main/java/com/pointsmall/core/common/exception/GlobalExceptionHandler.java
git commit -m "feat(TASK-AUTH-0001): add GlobalExceptionHandler — all exceptions map to CoreErrorCode

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 4: Employee Domain — Entities + Repositories

**Files:**
- Create: `src/main/java/com/pointsmall/core/employee/Role.java`
- Create: `src/main/java/com/pointsmall/core/employee/Employee.java`
- Create: `src/main/java/com/pointsmall/core/employee/RoleRepository.java`
- Create: `src/main/java/com/pointsmall/core/employee/EmployeeRepository.java`

- [ ] **Step 1: Create `Role` entity**

```java
// src/main/java/com/pointsmall/core/employee/Role.java
package com.pointsmall.core.employee;

import jakarta.persistence.*;

@Entity
@Table(name = "roles")
public class Role {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(nullable = false, unique = true, length = 50)
  private String name;

  public Long getId() {
    return id;
  }

  public String getName() {
    return name;
  }

  public void setName(String name) {
    this.name = name;
  }
}
```

- [ ] **Step 2: Create `Employee` entity**

```java
// src/main/java/com/pointsmall/core/employee/Employee.java
package com.pointsmall.core.employee;

import jakarta.persistence.*;
import java.time.OffsetDateTime;
import java.util.HashSet;
import java.util.Set;

@Entity
@Table(name = "employees")
public class Employee {

  @Id
  @GeneratedValue(strategy = GenerationType.IDENTITY)
  private Long id;

  @Column(nullable = false, length = 100)
  private String name;

  @Column(nullable = false, unique = true, length = 255)
  private String email;

  @Column(name = "password_hash", nullable = false, length = 255)
  private String passwordHash;

  @Column(name = "is_active", nullable = false)
  private boolean active = true;

  @ManyToMany(fetch = FetchType.EAGER)
  @JoinTable(
      name = "employee_roles",
      joinColumns = @JoinColumn(name = "employee_id"),
      inverseJoinColumns = @JoinColumn(name = "role_id"))
  private Set<Role> roles = new HashSet<>();

  @Column(name = "created_at", nullable = false, updatable = false)
  private OffsetDateTime createdAt;

  @Column(name = "updated_at", nullable = false)
  private OffsetDateTime updatedAt;

  @PrePersist
  void prePersist() {
    createdAt = OffsetDateTime.now();
    updatedAt = OffsetDateTime.now();
  }

  @PreUpdate
  void preUpdate() {
    updatedAt = OffsetDateTime.now();
  }

  public Long getId() { return id; }
  public String getName() { return name; }
  public void setName(String name) { this.name = name; }
  public String getEmail() { return email; }
  public void setEmail(String email) { this.email = email; }
  public String getPasswordHash() { return passwordHash; }
  public void setPasswordHash(String hash) { this.passwordHash = hash; }
  public boolean isActive() { return active; }
  public void setActive(boolean active) { this.active = active; }
  public Set<Role> getRoles() { return roles; }
  public void setRoles(Set<Role> roles) { this.roles = roles; }
}
```

- [ ] **Step 3: Create `RoleRepository`**

```java
// src/main/java/com/pointsmall/core/employee/RoleRepository.java
package com.pointsmall.core.employee;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface RoleRepository extends JpaRepository<Role, Long> {
  Optional<Role> findByName(String name);
}
```

- [ ] **Step 4: Create `EmployeeRepository`**

```java
// src/main/java/com/pointsmall/core/employee/EmployeeRepository.java
package com.pointsmall.core.employee;

import java.util.Optional;
import org.springframework.data.jpa.repository.JpaRepository;

public interface EmployeeRepository extends JpaRepository<Employee, Long> {
  Optional<Employee> findByEmail(String email);
}
```

- [ ] **Step 5: Format and compile**

```bash
cd points-mall-core && mvn spotless:apply -q && mvn compile -q
```

Expected: `BUILD SUCCESS`

- [ ] **Step 6: Commit**

```bash
git add src/main/java/com/pointsmall/core/employee/
git commit -m "feat(TASK-AUTH-0001): add Role, Employee JPA entities and repositories

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 5: EmployeeAuthService (TDD)

**Files:**
- Create: `src/main/java/com/pointsmall/core/internal/auth/dto/VerifyRequest.java`
- Create: `src/main/java/com/pointsmall/core/internal/auth/dto/VerifyResponse.java`
- Create: `src/test/java/com/pointsmall/core/internal/auth/EmployeeAuthServiceTest.java`
- Create: `src/main/java/com/pointsmall/core/internal/auth/EmployeeAuthService.java`

- [ ] **Step 1: Create `VerifyRequest` DTO**

```java
// src/main/java/com/pointsmall/core/internal/auth/dto/VerifyRequest.java
package com.pointsmall.core.internal.auth.dto;

import jakarta.validation.constraints.Email;
import jakarta.validation.constraints.NotBlank;

public class VerifyRequest {

  @NotBlank
  @Email
  private String email;

  @NotBlank
  private String password;

  public String getEmail() { return email; }
  public void setEmail(String email) { this.email = email; }
  public String getPassword() { return password; }
  public void setPassword(String password) { this.password = password; }

  /** Never log the password field. */
  @Override
  public String toString() {
    return "VerifyRequest{email='" + email + "', password='[REDACTED]'}";
  }
}
```

- [ ] **Step 2: Create `VerifyResponse` DTO**

```java
// src/main/java/com/pointsmall/core/internal/auth/dto/VerifyResponse.java
package com.pointsmall.core.internal.auth.dto;

import java.util.List;

public class VerifyResponse {

  private Long id;
  private String name;
  private String email;
  private boolean isActive;
  private List<String> roles;

  public VerifyResponse(Long id, String name, String email, boolean isActive, List<String> roles) {
    this.id = id;
    this.name = name;
    this.email = email;
    this.isActive = isActive;
    this.roles = roles;
  }

  public Long getId() { return id; }
  public String getName() { return name; }
  public String getEmail() { return email; }
  public boolean isActive() { return isActive; }
  public List<String> getRoles() { return roles; }
}
```

- [ ] **Step 3: Write failing unit tests**

```java
// src/test/java/com/pointsmall/core/internal/auth/EmployeeAuthServiceTest.java
package com.pointsmall.core.internal.auth;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;

import com.pointsmall.core.common.exception.BusinessException;
import com.pointsmall.core.common.exception.CoreErrorCode;
import com.pointsmall.core.employee.Employee;
import com.pointsmall.core.employee.EmployeeRepository;
import com.pointsmall.core.employee.Role;
import com.pointsmall.core.internal.auth.dto.VerifyResponse;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;

@ExtendWith(MockitoExtension.class)
class EmployeeAuthServiceTest {

  @Mock private EmployeeRepository employeeRepository;

  private EmployeeAuthService service;

  // Use strength 4 in tests for speed; BCrypt matches() reads strength from the hash string
  private final BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(4);

  @BeforeEach
  void setUp() {
    service = new EmployeeAuthService(employeeRepository);
  }

  @Test
  void verify_validCredentials_returnsEmployeeInfo() {
    Employee emp = buildEmployee(1L, "alice@test.com", "Alice", encoder.encode("Pass@123"), true, "employee");
    when(employeeRepository.findByEmail("alice@test.com")).thenReturn(Optional.of(emp));

    VerifyResponse res = service.verify("alice@test.com", "Pass@123");

    assertThat(res.getId()).isEqualTo(1L);
    assertThat(res.getEmail()).isEqualTo("alice@test.com");
    assertThat(res.getName()).isEqualTo("Alice");
    assertThat(res.isActive()).isTrue();
    assertThat(res.getRoles()).containsExactly("employee");
  }

  @Test
  void verify_emailNotFound_throwsInvalidCredentials() {
    when(employeeRepository.findByEmail(any())).thenReturn(Optional.empty());

    assertThatThrownBy(() -> service.verify("ghost@test.com", "any"))
        .isInstanceOf(BusinessException.class)
        .satisfies(e -> assertThat(((BusinessException) e).getErrorCode())
            .isEqualTo(CoreErrorCode.INVALID_CREDENTIALS));
  }

  @Test
  void verify_wrongPassword_throwsInvalidCredentials() {
    Employee emp = buildEmployee(1L, "alice@test.com", "Alice", encoder.encode("Pass@123"), true, "employee");
    when(employeeRepository.findByEmail("alice@test.com")).thenReturn(Optional.of(emp));

    assertThatThrownBy(() -> service.verify("alice@test.com", "WrongPassword"))
        .isInstanceOf(BusinessException.class)
        .satisfies(e -> assertThat(((BusinessException) e).getErrorCode())
            .isEqualTo(CoreErrorCode.INVALID_CREDENTIALS));
  }

  @Test
  void verify_accountDisabled_throwsAccountDisabled() {
    Employee emp = buildEmployee(1L, "alice@test.com", "Alice", encoder.encode("Pass@123"), false, "employee");
    when(employeeRepository.findByEmail("alice@test.com")).thenReturn(Optional.of(emp));

    assertThatThrownBy(() -> service.verify("alice@test.com", "Pass@123"))
        .isInstanceOf(BusinessException.class)
        .satisfies(e -> assertThat(((BusinessException) e).getErrorCode())
            .isEqualTo(CoreErrorCode.ACCOUNT_DISABLED));
  }

  @Test
  void verify_emailNotFoundAndWrongPassword_sameErrorCodePreventsEnumeration() {
    when(employeeRepository.findByEmail("ghost@test.com")).thenReturn(Optional.empty());
    Employee emp = buildEmployee(2L, "b@test.com", "B", encoder.encode("P@123"), true, "employee");
    when(employeeRepository.findByEmail("b@test.com")).thenReturn(Optional.of(emp));

    BusinessException notFound =
        catchThrowableOfType(() -> service.verify("ghost@test.com", "any"), BusinessException.class);
    BusinessException wrongPwd =
        catchThrowableOfType(() -> service.verify("b@test.com", "wrong"), BusinessException.class);

    assertThat(notFound.getErrorCode()).isEqualTo(wrongPwd.getErrorCode());
    assertThat(notFound.getMessage()).isEqualTo(wrongPwd.getMessage());
  }

  private Employee buildEmployee(
      Long id, String email, String name, String hash, boolean active, String roleName) {
    Role role = new Role();
    role.setName(roleName);
    Employee e = new Employee();
    e.setEmail(email);
    e.setName(name);
    e.setPasswordHash(hash);
    e.setActive(active);
    e.setRoles(Set.of(role));
    return e;
  }
}
```

- [ ] **Step 4: Run tests — expect failure (class not found)**

```bash
cd points-mall-core && mvn test -Dtest=EmployeeAuthServiceTest -q 2>&1 | tail -8
```

Expected: `FAILURE` — `EmployeeAuthService` cannot be resolved

- [ ] **Step 5: Create `EmployeeAuthService`**

```java
// src/main/java/com/pointsmall/core/internal/auth/EmployeeAuthService.java
package com.pointsmall.core.internal.auth;

import com.pointsmall.core.common.exception.BusinessException;
import com.pointsmall.core.common.exception.CoreErrorCode;
import com.pointsmall.core.employee.Employee;
import com.pointsmall.core.employee.EmployeeRepository;
import com.pointsmall.core.internal.auth.dto.VerifyResponse;
import java.util.List;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Service;

@Service
public class EmployeeAuthService {

  private final EmployeeRepository employeeRepository;
  private final BCryptPasswordEncoder passwordEncoder = new BCryptPasswordEncoder(12);

  public EmployeeAuthService(EmployeeRepository employeeRepository) {
    this.employeeRepository = employeeRepository;
  }

  public VerifyResponse verify(String email, String password) {
    Employee employee =
        employeeRepository
            .findByEmail(email)
            .orElseThrow(() -> new BusinessException(CoreErrorCode.INVALID_CREDENTIALS));

    if (!passwordEncoder.matches(password, employee.getPasswordHash())) {
      throw new BusinessException(CoreErrorCode.INVALID_CREDENTIALS);
    }

    if (!employee.isActive()) {
      throw new BusinessException(CoreErrorCode.ACCOUNT_DISABLED);
    }

    List<String> roles = employee.getRoles().stream().map(Role::getName).toList();
    return new VerifyResponse(
        employee.getId(), employee.getName(), employee.getEmail(), true, roles);
  }
}
```

- [ ] **Step 6: Format + run unit tests**

```bash
cd points-mall-core && mvn spotless:apply -q && mvn test -Dtest=EmployeeAuthServiceTest -q
```

Expected: `Tests run: 5, Failures: 0, Errors: 0`

- [ ] **Step 7: Commit**

```bash
git add \
  src/main/java/com/pointsmall/core/internal/auth/ \
  src/test/java/com/pointsmall/core/internal/auth/EmployeeAuthServiceTest.java
git commit -m "feat(TASK-AUTH-0001): add EmployeeAuthService with BCrypt verify (TDD, 5 tests green)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 6: InternalApiKeyFilter + FilterConfig

**Files:**
- Create: `src/main/java/com/pointsmall/core/internal/auth/InternalApiKeyFilter.java`
- Create: `src/main/java/com/pointsmall/core/config/FilterConfig.java`

- [ ] **Step 1: Create `InternalApiKeyFilter`**

```java
// src/main/java/com/pointsmall/core/internal/auth/InternalApiKeyFilter.java
package com.pointsmall.core.internal.auth;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.pointsmall.core.common.ApiResponse;
import com.pointsmall.core.common.exception.CoreErrorCode;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.web.filter.OncePerRequestFilter;

public class InternalApiKeyFilter extends OncePerRequestFilter {

  private final String expectedApiKey;
  private final ObjectMapper objectMapper;

  public InternalApiKeyFilter(String expectedApiKey, ObjectMapper objectMapper) {
    this.expectedApiKey = expectedApiKey;
    this.objectMapper = objectMapper;
  }

  @Override
  protected void doFilterInternal(
      HttpServletRequest request, HttpServletResponse response, FilterChain chain)
      throws ServletException, IOException {
    String header = request.getHeader("INTERNAL_API_KEY");
    if (header == null || !header.equals(expectedApiKey)) {
      CoreErrorCode ec = CoreErrorCode.UNAUTHORIZED_CALLER;
      String traceId = UUID.randomUUID().toString();
      response.setStatus(HttpServletResponse.SC_UNAUTHORIZED);
      response.setContentType(MediaType.APPLICATION_JSON_VALUE);
      objectMapper.writeValue(
          response.getWriter(), ApiResponse.error(ec.getCode(), ec.getMessage(), traceId));
      return;
    }
    chain.doFilter(request, response);
  }

  @Override
  protected boolean shouldNotFilter(HttpServletRequest request) {
    // Only intercept /internal/** — leave /health and other routes untouched
    return !request.getRequestURI().startsWith("/internal/");
  }
}
```

- [ ] **Step 2: Create `FilterConfig`**

```java
// src/main/java/com/pointsmall/core/config/FilterConfig.java
package com.pointsmall.core.config;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.pointsmall.core.internal.auth.InternalApiKeyFilter;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.web.servlet.FilterRegistrationBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class FilterConfig {

  @Value("${internal.api-key}")
  private String internalApiKey;

  @Bean
  public FilterRegistrationBean<InternalApiKeyFilter> internalApiKeyFilter(
      ObjectMapper objectMapper) {
    InternalApiKeyFilter filter = new InternalApiKeyFilter(internalApiKey, objectMapper);
    FilterRegistrationBean<InternalApiKeyFilter> registration =
        new FilterRegistrationBean<>(filter);
    registration.addUrlPatterns("/internal/*");
    registration.setOrder(1);
    return registration;
  }
}
```

- [ ] **Step 3: Format and compile**

```bash
cd points-mall-core && mvn spotless:apply -q && mvn compile -q
```

Expected: `BUILD SUCCESS`

- [ ] **Step 4: Commit**

```bash
git add \
  src/main/java/com/pointsmall/core/internal/auth/InternalApiKeyFilter.java \
  src/main/java/com/pointsmall/core/config/FilterConfig.java
git commit -m "feat(TASK-AUTH-0001): add InternalApiKeyFilter + FilterConfig for /internal/** guard

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 7: AuthVerifyController

**Files:**
- Create: `src/main/java/com/pointsmall/core/internal/auth/AuthVerifyController.java`

- [ ] **Step 1: Create `AuthVerifyController`**

```java
// src/main/java/com/pointsmall/core/internal/auth/AuthVerifyController.java
package com.pointsmall.core.internal.auth;

import com.pointsmall.core.common.ApiResponse;
import com.pointsmall.core.internal.auth.dto.VerifyRequest;
import com.pointsmall.core.internal.auth.dto.VerifyResponse;
import jakarta.validation.Valid;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/internal/auth")
public class AuthVerifyController {

  private final EmployeeAuthService authService;

  public AuthVerifyController(EmployeeAuthService authService) {
    this.authService = authService;
  }

  @PostMapping("/verify")
  public ResponseEntity<ApiResponse<VerifyResponse>> verify(
      @Valid @RequestBody VerifyRequest request) {
    VerifyResponse result = authService.verify(request.getEmail(), request.getPassword());
    return ResponseEntity.ok(ApiResponse.ok(result));
  }
}
```

- [ ] **Step 2: Format and compile**

```bash
cd points-mall-core && mvn spotless:apply -q && mvn compile -q
```

Expected: `BUILD SUCCESS`

- [ ] **Step 3: Commit**

```bash
git add src/main/java/com/pointsmall/core/internal/auth/AuthVerifyController.java
git commit -m "feat(TASK-AUTH-0001): add AuthVerifyController POST /internal/auth/verify

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 8: EmployeeSeeder

**Files:**
- Create: `src/main/java/com/pointsmall/core/employee/seeder/EmployeeSeeder.java`

- [ ] **Step 1: Create `EmployeeSeeder`**

```java
// src/main/java/com/pointsmall/core/employee/seeder/EmployeeSeeder.java
package com.pointsmall.core.employee.seeder;

import com.pointsmall.core.employee.Employee;
import com.pointsmall.core.employee.EmployeeRepository;
import com.pointsmall.core.employee.Role;
import com.pointsmall.core.employee.RoleRepository;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.context.annotation.Profile;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.stereotype.Component;

@Component
@Profile({"dev", "test"})
public class EmployeeSeeder implements ApplicationRunner {

  private static final Logger log = LoggerFactory.getLogger(EmployeeSeeder.class);
  private static final BCryptPasswordEncoder ENCODER = new BCryptPasswordEncoder(12);

  private final EmployeeRepository employeeRepository;
  private final RoleRepository roleRepository;

  public EmployeeSeeder(EmployeeRepository employeeRepository, RoleRepository roleRepository) {
    this.employeeRepository = employeeRepository;
    this.roleRepository = roleRepository;
  }

  @Override
  public void run(ApplicationArguments args) {
    seed("Admin", "admin@points-mall.com", "Admin@123", "admin");
    seed("Alice", "alice@points-mall.com", "Employee@123", "employee");
    seed("Bob", "bob@points-mall.com", "Employee@123", "employee");
  }

  private void seed(String name, String email, String password, String roleName) {
    if (employeeRepository.findByEmail(email).isPresent()) {
      log.debug("Seeder: {} already exists, skipping", email);
      return;
    }
    Role role =
        roleRepository
            .findByName(roleName)
            .orElseThrow(() -> new IllegalStateException("Role not found: " + roleName));
    Employee employee = new Employee();
    employee.setName(name);
    employee.setEmail(email);
    employee.setPasswordHash(ENCODER.encode(password));
    employee.setActive(true);
    employee.setRoles(Set.of(role));
    employeeRepository.save(employee);
    log.info("Seeder: created {}", email);
  }
}
```

> **Note:** In test profile, the `roles` table starts empty (Flyway disabled, Hibernate `create-drop`). The seeder depends on `admin` and `employee` roles existing. The integration tests in Task 9 must pre-insert these roles before the context starts — handled via a `@Sql` script (see Task 9, Step 1).

- [ ] **Step 2: Format and compile**

```bash
cd points-mall-core && mvn spotless:apply -q && mvn compile -q
```

Expected: `BUILD SUCCESS`

- [ ] **Step 3: Commit**

```bash
git add src/main/java/com/pointsmall/core/employee/seeder/EmployeeSeeder.java
git commit -m "feat(TASK-AUTH-0001): add EmployeeSeeder (dev/test, idempotent, BCrypt-12)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 9: Integration Tests (AuthVerifyControllerTest)

**Files:**
- Create: `src/test/resources/db/seed-roles.sql`
- Create: `src/test/java/com/pointsmall/core/internal/auth/AuthVerifyControllerTest.java`

> Integration tests use `@ActiveProfiles("test")` → Flyway disabled, Hibernate `create-drop`. The seeder needs the `roles` table pre-populated. We use a `@Sql` script executed once before the Spring context starts.

- [ ] **Step 1: Create role seed SQL for tests**

```sql
-- src/test/resources/db/seed-roles.sql
INSERT INTO roles (name, description) VALUES
  ('admin',    'Full system administrator'),
  ('employee', 'Regular employee')
ON CONFLICT (name) DO NOTHING;
```

- [ ] **Step 2: Write integration tests**

```java
// src/test/java/com/pointsmall/core/internal/auth/AuthVerifyControllerTest.java
package com.pointsmall.core.internal.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.pointsmall.core.employee.Employee;
import com.pointsmall.core.employee.EmployeeRepository;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;
import org.springframework.test.web.servlet.MockMvc;

@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Sql(scripts = "/db/seed-roles.sql", executionPhase = Sql.ExecutionPhase.BEFORE_TEST_CLASS)
class AuthVerifyControllerTest {

  private static final String API_KEY = "test-internal-key-for-tests";
  private static final String URL = "/internal/auth/verify";

  @Autowired private MockMvc mockMvc;
  @Autowired private ObjectMapper objectMapper;
  @Autowired private EmployeeRepository employeeRepository;

  @AfterEach
  void cleanup() {
    employeeRepository.findByEmail("disabled@test.com").ifPresent(employeeRepository::delete);
  }

  // ── Filter tests ──────────────────────────────────────────────────────────

  @Test
  void missingApiKey_returns401_coreUnauthorized() throws Exception {
    mockMvc
        .perform(
            post(URL)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"admin@points-mall.com\",\"password\":\"Admin@123\"}"))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.code").value("core-1003"))
        .andExpect(jsonPath("$.traceId").isNotEmpty());
  }

  @Test
  void wrongApiKey_returns401_coreUnauthorized() throws Exception {
    mockMvc
        .perform(
            post(URL)
                .header("INTERNAL_API_KEY", "wrong-key")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"admin@points-mall.com\",\"password\":\"Admin@123\"}"))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.code").value("core-1003"))
        .andExpect(jsonPath("$.traceId").isNotEmpty());
  }

  @Test
  void healthEndpoint_notAffectedByFilter() throws Exception {
    mockMvc
        .perform(
            org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get("/health"))
        .andExpect(status().isOk());
  }

  // ── Happy path ────────────────────────────────────────────────────────────

  @Test
  void validCredentials_admin_returns200WithRoles() throws Exception {
    mockMvc
        .perform(
            post(URL)
                .header("INTERNAL_API_KEY", API_KEY)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"admin@points-mall.com\",\"password\":\"Admin@123\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.code").value("OK"))
        .andExpect(jsonPath("$.data.email").value("admin@points-mall.com"))
        .andExpect(jsonPath("$.data.isActive").value(true))
        .andExpect(jsonPath("$.data.roles[0]").value("admin"))
        .andExpect(jsonPath("$.traceId").doesNotExist());
  }

  @Test
  void validCredentials_alice_returns200WithEmployeeRole() throws Exception {
    mockMvc
        .perform(
            post(URL)
                .header("INTERNAL_API_KEY", API_KEY)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"alice@points-mall.com\",\"password\":\"Employee@123\"}"))
        .andExpect(status().isOk())
        .andExpect(jsonPath("$.code").value("OK"))
        .andExpect(jsonPath("$.data.roles[0]").value("employee"));
  }

  // ── Error scenarios ───────────────────────────────────────────────────────

  @Test
  void wrongPassword_returns401_invalidCredentials() throws Exception {
    mockMvc
        .perform(
            post(URL)
                .header("INTERNAL_API_KEY", API_KEY)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"admin@points-mall.com\",\"password\":\"WrongPass\"}"))
        .andExpect(status().isUnauthorized())
        .andExpect(jsonPath("$.code").value("core-1001"))
        .andExpect(jsonPath("$.traceId").isNotEmpty());
  }

  @Test
  void emailNotFoundAndWrongPassword_returnSameCodeAndMessage_preventsEnumeration()
      throws Exception {
    String notFoundResponse =
        mockMvc
            .perform(
                post(URL)
                    .header("INTERNAL_API_KEY", API_KEY)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"email\":\"ghost@test.com\",\"password\":\"any\"}"))
            .andExpect(status().isUnauthorized())
            .andReturn()
            .getResponse()
            .getContentAsString();

    String wrongPwdResponse =
        mockMvc
            .perform(
                post(URL)
                    .header("INTERNAL_API_KEY", API_KEY)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"email\":\"admin@points-mall.com\",\"password\":\"wrong\"}"))
            .andExpect(status().isUnauthorized())
            .andReturn()
            .getResponse()
            .getContentAsString();

    JsonNode notFound = objectMapper.readTree(notFoundResponse);
    JsonNode wrongPwd = objectMapper.readTree(wrongPwdResponse);

    assertThat(notFound.get("code")).isEqualTo(wrongPwd.get("code"));
    assertThat(notFound.get("message")).isEqualTo(wrongPwd.get("message"));
  }

  @Test
  void disabledAccount_returns403_accountDisabled() throws Exception {
    // Insert a disabled employee with a real BCrypt hash so password check passes first
    BCryptPasswordEncoder encoder = new BCryptPasswordEncoder(4);
    Employee emp = new Employee();
    emp.setName("Disabled");
    emp.setEmail("disabled@test.com");
    emp.setPasswordHash(encoder.encode("Test@123"));
    emp.setActive(false);
    employeeRepository.save(emp);

    mockMvc
        .perform(
            post(URL)
                .header("INTERNAL_API_KEY", API_KEY)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"disabled@test.com\",\"password\":\"Test@123\"}"))
        .andExpect(status().isForbidden())
        .andExpect(jsonPath("$.code").value("core-1002"))
        .andExpect(jsonPath("$.traceId").isNotEmpty());
  }

  @Test
  void missingPasswordField_returns400_validationFailed() throws Exception {
    mockMvc
        .perform(
            post(URL)
                .header("INTERNAL_API_KEY", API_KEY)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"email\":\"admin@points-mall.com\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("core-1010"))
        .andExpect(jsonPath("$.traceId").isNotEmpty());
  }

  @Test
  void missingEmailField_returns400_validationFailed() throws Exception {
    mockMvc
        .perform(
            post(URL)
                .header("INTERNAL_API_KEY", API_KEY)
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"password\":\"Admin@123\"}"))
        .andExpect(status().isBadRequest())
        .andExpect(jsonPath("$.code").value("core-1010"));
  }

  // ── Security constraints ──────────────────────────────────────────────────

  @Test
  void errorResponse_neverContainsInternalDetails() throws Exception {
    String body =
        mockMvc
            .perform(
                post(URL)
                    .header("INTERNAL_API_KEY", API_KEY)
                    .contentType(MediaType.APPLICATION_JSON)
                    .content("{\"email\":\"admin@points-mall.com\",\"password\":\"wrong\"}"))
            .andReturn()
            .getResponse()
            .getContentAsString();

    assertThat(body).doesNotContain("Exception");
    assertThat(body).doesNotContain("stack");
    assertThat(body).doesNotContain("SQL");
  }
}
```

- [ ] **Step 3: Run integration tests — expect failure**

```bash
cd points-mall-core && mvn test -Dtest=AuthVerifyControllerTest -DSPRING_PROFILES_ACTIVE=test -q 2>&1 | tail -10
```

Expected: Compilation error or context failure (roles table empty / seeder rollback issues)

- [ ] **Step 4: Run all tests**

```bash
cd points-mall-core && mvn test -q
```

Expected: All tests green including `PointsMallCoreApplicationTests`, `EmployeeAuthServiceTest`, `AuthVerifyControllerTest`

If tests fail due to context issues (e.g., Flyway/Hibernate conflict), re-verify `application-test.yml` has `spring.flyway.enabled: false`.

- [ ] **Step 5: Format + final test run**

```bash
cd points-mall-core && mvn spotless:apply -q && mvn test -q
```

Expected: `BUILD SUCCESS`, all tests pass

- [ ] **Step 6: Commit**

```bash
git add \
  src/test/resources/db/seed-roles.sql \
  src/test/java/com/pointsmall/core/internal/auth/AuthVerifyControllerTest.java
git commit -m "test(TASK-AUTH-0001): add integration tests for AuthVerifyController (10 scenarios)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Task 10: Bruno API Test + Task File Update

**Files:**
- Create: `.tests/api/core/auth/verify.bru`

- [ ] **Step 1: Create `.tests/api/core/auth/` directory and Bruno test**

```bash
mkdir -p .tests/api/core/auth
```

```
// .tests/api/core/auth/verify.bru
meta {
  name: POST /internal/auth/verify
  type: http
  seq: 1
}

post {
  url: {{core_base_url}}/internal/auth/verify
  body: json
  auth: none
}

headers {
  INTERNAL_API_KEY: {{internal_api_key}}
  Content-Type: application/json
}

body:json {
  {
    "email": "admin@points-mall.com",
    "password": "Admin@123"
  }
}

tests {
  test("status 200", function() {
    expect(res.getStatus()).to.equal(200);
  });
  test("code is OK", function() {
    expect(res.getBody().code).to.equal("OK");
  });
  test("roles contains admin", function() {
    expect(res.getBody().data.roles).to.include("admin");
  });
  test("no traceId on success", function() {
    expect(res.getBody().traceId).to.be.undefined;
  });
}
```

- [ ] **Step 2: Update task file — status → dev-done, fill code_files and test_refs**

Edit `.tasks/auth/TASK-AUTH-0001.md` front matter:

```yaml
status: dev-done
services:
  - core
code_files:
  - points-mall-core/src/main/resources/db/migration/V7__add_password_hash_not_null.sql
  - points-mall-core/pom.xml
  - points-mall-core/src/main/resources/application.yml
  - points-mall-core/src/main/resources/application-test.yml
  - points-mall-core/src/main/java/com/pointsmall/core/common/ApiResponse.java
  - points-mall-core/src/main/java/com/pointsmall/core/common/exception/CoreErrorCode.java
  - points-mall-core/src/main/java/com/pointsmall/core/common/exception/BusinessException.java
  - points-mall-core/src/main/java/com/pointsmall/core/common/exception/GlobalExceptionHandler.java
  - points-mall-core/src/main/java/com/pointsmall/core/employee/Role.java
  - points-mall-core/src/main/java/com/pointsmall/core/employee/Employee.java
  - points-mall-core/src/main/java/com/pointsmall/core/employee/RoleRepository.java
  - points-mall-core/src/main/java/com/pointsmall/core/employee/EmployeeRepository.java
  - points-mall-core/src/main/java/com/pointsmall/core/employee/seeder/EmployeeSeeder.java
  - points-mall-core/src/main/java/com/pointsmall/core/config/FilterConfig.java
  - points-mall-core/src/main/java/com/pointsmall/core/internal/auth/InternalApiKeyFilter.java
  - points-mall-core/src/main/java/com/pointsmall/core/internal/auth/EmployeeAuthService.java
  - points-mall-core/src/main/java/com/pointsmall/core/internal/auth/AuthVerifyController.java
  - points-mall-core/src/main/java/com/pointsmall/core/internal/auth/dto/VerifyRequest.java
  - points-mall-core/src/main/java/com/pointsmall/core/internal/auth/dto/VerifyResponse.java
test_refs:
  - points-mall-core/src/test/java/com/pointsmall/core/internal/auth/EmployeeAuthServiceTest.java
  - points-mall-core/src/test/java/com/pointsmall/core/internal/auth/AuthVerifyControllerTest.java
  - .tests/api/core/auth/verify.bru
```

Append to Status Change History:

```
| 2026-06-25 | spec-ready | in-dev | AI | Implementation started |
| 2026-06-25 | in-dev | dev-done | AI | All 10 integration tests + 5 unit tests green |
```

- [ ] **Step 3: Run `pnpm run tasks:sync`**

```bash
cd /path/to/fullstack-points-mall && pnpm run tasks:sync
```

Expected: `✓ .tasks/_index.md rebuilt`

- [ ] **Step 4: Final commit**

```bash
git add \
  .tests/api/core/auth/verify.bru \
  .tasks/auth/TASK-AUTH-0001.md \
  .tasks/_index.md
git commit -m "feat(TASK-AUTH-0001): Bruno test + task file dev-done

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>"
```

---

## Self-Review

**Spec coverage check:**

| Spec requirement | Covered by |
|-----------------|-----------|
| `POST /internal/auth/verify` | Task 7 (Controller) |
| BCrypt password verify | Task 5 (Service) |
| Return employee info + roles | Task 5 (VerifyResponse) |
| INTERNAL_API_KEY header guard | Task 6 (Filter) |
| Reject callers without key | Task 6 + Integration test (Task 9) |
| V7 migration NOT NULL | Task 1 |
| Employee seeder (1 admin + 2 employee) | Task 8 |
| Seeder dev/test only | Task 8 (`@Profile`) |
| `ApiResponse { code, message, data }` | Task 2 |
| `traceId` on errors only | Task 2 + Task 3 |
| CoreErrorCode enum (5 entries) | Task 2 |
| GlobalExceptionHandler (no raw leaks) | Task 3 |
| `INTERNAL_API_KEY` no default, startup fails | Task 1 (Step 3) |
| Password not logged | Task 5 (`VerifyRequest.toString()`) |
| Enumeration prevention (same error) | Task 5 + Unit test |
| Bruno test | Task 10 |

**Placeholder scan:** None found — all steps contain complete code.

**Type consistency:** `VerifyResponse(Long, String, String, boolean, List<String>)` constructor used in `EmployeeAuthService.verify()` matches definition in Task 5 Step 2. `ApiResponse.error(String, String, String)` matches usage in `GlobalExceptionHandler` and `InternalApiKeyFilter`. ✓
