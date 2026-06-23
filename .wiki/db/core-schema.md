# points_core — Database Schema

> **Canonical reference** for the `points_core` PostgreSQL database.
> Managed by **Flyway** migrations in `points-mall-core/src/main/resources/db/migration/`.
> Do not edit table structures directly — always create a new `V{n}__` migration file.

---

## ER Diagram

```mermaid
erDiagram
    departments {
        bigserial   id          PK
        varchar     name
        varchar     code        UK
        text        description
        bigint      parent_id   FK
        timestamptz created_at
        timestamptz updated_at
    }

    employees {
        bigserial   id            PK
        varchar     name
        varchar     email         UK
        varchar     password_hash
        bigint      department_id FK
        varchar     github_id     UK
        text        avatar_url
        boolean     is_active
        timestamptz created_at
        timestamptz updated_at
    }

    roles {
        bigserial   id          PK
        varchar     name        UK
        text        description
        timestamptz created_at
    }

    employee_roles {
        bigint      employee_id PK,FK
        bigint      role_id     PK,FK
        timestamptz granted_at
    }

    attendance_records {
        bigserial   id           PK
        bigint      employee_id  FK
        timestamptz check_in_at
        timestamptz check_out_at
        date        work_date
        varchar     status
        text        notes
        timestamptz created_at
        timestamptz updated_at
    }

    points_rules {
        bigserial   id           PK
        varchar     rule_code    UK
        text        description
        int         points_value
        boolean     is_active
        date        valid_from
        date        valid_until
        timestamptz created_at
        timestamptz updated_at
    }

    points_ledger {
        bigserial   id            PK
        bigint      employee_id   FK
        bigint      rule_id       FK
        int         delta
        int         balance_after
        text        description
        varchar     ref_type
        bigint      ref_id
        timestamptz created_at
    }

    departments  ||--o{ departments       : "parent_id (self-ref)"
    departments  ||--o{ employees         : "department_id"
    employees    ||--o{ employee_roles    : "employee_id"
    roles        ||--o{ employee_roles    : "role_id"
    employees    ||--o{ attendance_records: "employee_id"
    employees    ||--o{ points_ledger     : "employee_id"
    points_rules ||--o{ points_ledger     : "rule_id"
```

---

## Table Descriptions

### `departments`
Organizational hierarchy. Supports unlimited nesting via `parent_id` self-reference.

### `employees`
Core user entity. `password_hash` is nullable to support OAuth-only accounts.
`github_id` is unique to prevent duplicate GitHub-linked accounts.

### `roles` + `employee_roles`
Many-to-many RBAC. Pre-seeded roles: `admin`, `employee`.
`employee_roles` is the junction table.

### `attendance_records`
One row per attendance event. `status` values: `normal | late | early_leave | absent`.
Indexed on `(employee_id, work_date)` for fast monthly queries.

### `points_rules`
Defines how points are earned or deducted. `points_value` is signed:
positive = earn, negative = deduct. `valid_from`/`valid_until` support time-limited rules.

### `points_ledger`
Append-only ledger. Every points change (earn or spend) adds one row.
`balance_after` is the running balance snapshot — allows fast current-balance lookup
without re-summing all rows. `ref_type` + `ref_id` trace the originating event.

---

## Migration Files

| File | Description |
|------|-------------|
| `V1__create_departments.sql` | Create `departments` table |
| `V2__create_employees.sql` | Create `employees` table |
| `V3__create_roles.sql` | Create `roles` + `employee_roles`, seed admin/employee roles |
| `V4__create_attendance_records.sql` | Create `attendance_records` table |
| `V5__create_points_rules.sql` | Create `points_rules` table |
| `V6__create_points_ledger.sql` | Create `points_ledger` table |
