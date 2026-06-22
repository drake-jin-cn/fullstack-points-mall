# Wiki Writing Guidelines

> This directory is the **single source of truth** for the project, replacing Confluence/Notion.
> Code must be consistent with Wiki documentation; when they conflict, Wiki takes precedence.

---

## Directory Structure

```
.wiki/
├── README.md           # this file
├── features/           # Feature specs (business scenarios, written by humans)
├── api/                # OpenAPI 3.0 interface specs (API contracts)
└── db/                 # Database schema specs
```

---

## Spec Writing Principles

1. **Explicitly define exclusions**: Every Spec must include an `Out of Scope` section stating what is NOT being done
2. **Versioned management**: Every change must increment the `version` field and document the reason in `Change Log`
3. **Testability**: Every functional requirement must be verifiable — avoid vague descriptions
4. **Task linkage**: The `related_tasks` field in a Spec must stay in sync with task IDs in `.tasks/`

---

## Spec Status Definitions

| Status | Meaning |
|--------|---------|
| `draft` | Draft, not yet reviewed — AI must not develop based on this Spec |
| `active` | Reviewed and approved — AI may develop based on this Spec |
| `deprecated` | Deprecated — corresponding feature is offline, related tasks are closed |

---

## Existing Spec Files

### features/ (Feature Specs)

> Organized by Task domain — one file covers all business scenarios for a Task domain.

| File | Task | Status | Description |
|------|------|--------|-------------|
| auth.md | TASK-AUTH | draft | User authentication and authorization |
| points.md | TASK-POINTS | draft | Points issuance and transaction management |
| shop.md | TASK-SHOP | draft | Points mall, product management, and order flow |
| attendance.md | TASK-ATTEND | draft | Employee attendance check-in |
| notifications.md | TASK-NOTIFY | draft | Message notifications and email push |
| data.md | TASK-DATA | draft | Data reports and export |
| system.md | TASK-SYS | draft | System configuration and dynamic menus |

### api/ (API Specs)

| File | Status | Description |
|------|--------|-------------|
| bff-api.yaml | draft | BFF gateway external API (frontend's only dependency) |
| core-internal.yaml | draft | Java core service internal API |
| shop-internal.yaml | draft | PHP shop service internal API |
| message-internal.yaml | draft | Node message service internal API |
| data-internal.yaml | draft | Python data service internal API |
| thirdparty-internal.yaml | draft | ThirdParty connector internal API |

### db/ (Database Schemas)

| File | Status | Description |
|------|--------|-------------|
| core-schema.md | draft | Java service PostgreSQL table structures |
| shop-schema.md | draft | PHP service database table structures |

---

## Creating a New Spec File

1. Copy the template for the corresponding type (see format examples below)
2. Fill in the frontmatter metadata
3. Complete the feature description and out-of-scope sections
4. Set `status` to `active` (indicates reviewed and approved)
5. Add this file path to the `wiki_refs` field of the corresponding task file

---

## Format Examples

### Feature Spec (`features/*.md`)

```markdown
---
spec_id: SPEC-AUTH
title: "User Authentication and Authorization"
version: 1.2
status: active          # draft | active | deprecated
services:
  - frontend
  - bff
  - core
last_reviewed: 2026-06-22
related_tasks:
  - TASK-AUTH-0001
  - TASK-AUTH-0002
---

## Business Background

(Describe what problem this feature solves and why it is needed)

## Functional Requirements

### Login Flow
1. Support username/password login
2. Support GitHub OAuth third-party login
3. After successful login, Token is stored in an HttpOnly Cookie; user info is stored in Zustand

## Non-Functional Requirements

- **Security**: Token must be stored in an HttpOnly Cookie — localStorage storage is prohibited
- **Performance**: Login endpoint response time < 500ms

## Out of Scope

- SMS verification code login is not implemented
- Multi-factor authentication (MFA) is not implemented

## Change Log

| Version | Date | Changes | Author |
|---------|------|---------|--------|
| 1.0 | 2026-06-01 | Initial creation | Human |
| 1.2 | 2026-06-22 | Added HttpOnly Cookie security requirement | Human |
```

---

### API Spec (`api/*.yaml`)

Uses the OpenAPI 3.0 standard.

```yaml
openapi: 3.0.0
info:
  title: Points Mall BFF API
  version: 1.0.0
paths:
  /api/auth/login:
    post:
      summary: Login with email and password
      tags: [Auth]
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [email, password]
              properties:
                email:
                  type: string
                  format: email
                password:
                  type: string
                  minLength: 8
      responses:
        '200':
          description: Login successful
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/LoginResponse'
        '401':
          description: Invalid email or password
```

---

### Database Schema Spec (`db/*.md`)

```markdown
# Core Service Database Schema v1.0

> Service: points-mall-core | Database: PostgreSQL

## Table: employees

| Column | Type | Constraints | Description |
|--------|------|-------------|-------------|
| id | bigint | PK, AUTO_INCREMENT | Primary key |
| employee_no | varchar(20) | UNIQUE, NOT NULL | Employee number |
| email | varchar(255) | UNIQUE, NOT NULL | Email address (login account) |
| password_hash | varchar(255) | NOT NULL | bcrypt-hashed password |
| department_id | bigint | FK → departments.id | Department |
| status | enum | NOT NULL | active/inactive/suspended |
| created_at | timestamp | NOT NULL | Creation time (UTC) |
| updated_at | timestamp | NOT NULL | Last updated time (UTC) |

## Index Design

| Index Name | Column | Type | Reason |
|------------|--------|------|--------|
| idx_employee_email | email | UNIQUE | High-frequency login queries |
```
