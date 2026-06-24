# Infrastructure & Developer Toolchain Spec

> **Status:** active  
> **Version:** 1.3  
> **Related tasks:** TASK-INFRA-0001, TASK-INFRA-0002, TASK-INFRA-0003, TASK-INFRA-0004, TASK-INFRA-0005  
> **Last updated:** 2026-06-23

---

## Background

All 8 services have runnable skeletons (TASK-INFRA-0001), but the team workflow loop could not close end-to-end because:

1. No root-level `package.json` — `pnpm` had nowhere to define workspace scripts
2. `.tests/scripts/` did not exist — the task management scripts were not written
3. Bruno CLI was not installed — `.bru` test files existed but could not run
4. No commit-msg hook — developers could commit with any message format
5. No code quality enforcement — each service had no formatter or linter wired up
6. No CI — PRs in either the monorepo or individual sub-repos had no quality gate

This spec defines the minimum viable toolchain so that:
- The task management workflow (`tasks:sync`, `tasks:list`, `test:task`) works end-to-end
- Every commit is format-checked before it lands
- Every PR is blocked until lint + build passes, regardless of which repo it's opened in

---

## Out of Scope

- Real implementation of `check:spec-api` (placeholder only)
- Playwright installation (E2E tests deferred to Phase 2)
- Vitest setup at root level (unit tests are per-service)
- `post-commit` Spec cascade detection (deferred to a later task)
- Kubernetes / cloud deployment infrastructure (deferred)

---

## 1. pnpm Workspace & Task Scripts

### Root `package.json` scripts

| Script | Command | Description |
|--------|---------|-------------|
| `tasks:list` | `node .tests/scripts/tasks-sync.js --list` | Print all tasks; supports `--status=X` filter |
| `tasks:sync` | `node .tests/scripts/tasks-sync.js` | Rebuild `.tasks/_index.md` from all task files |
| `tasks:view` | `node .tests/scripts/tasks-sync.js --view` | Print a single task file to stdout |
| `test:task` | `node .tests/scripts/run-task-tests.js` | Run tests for a task; `--update-status` auto-promotes |
| `hooks:install` | `node .git-hooks/install.js` | Install git hooks into root + all 8 submodule repos |
| `prepare` | `node .git-hooks/install.js` | Auto-runs hooks:install after `pnpm install` |

### `tasks-sync.js` responsibilities

- Parse YAML frontmatter from every `.tasks/**/*.md` (recursive subdirectory scan)
- Generate `.tasks/_index.md` with a status-grouped table: id / domain / title / assignee / updated
- `--list [--status=X]` prints to stdout (no file write)
- `--view TASK-ID` prints the task file to stdout

### `run-task-tests.js` responsibilities

- Read `test_refs` from the task frontmatter
- Dispatch by file type: `*.bru` → Bruno CLI; `*.test.ts` → Vitest; `*.spec.ts` → Playwright
- If `--update-status`: all pass → `test-pass`; any fail → `test-fail`; appends history record

---

## 2. Git Hooks

### commit-msg hook

All repos (root + 8 submodules) enforce:

```
<type>(<scope>): <summary>

type  = feat | fix | chore | test | docs | refactor | ci
scope = TASK-ID (e.g. TASK-INFRA-0001) or service name
```

### pre-commit hook

Dispatches to the correct formatter based on which service directories have staged files. Only runs for services with staged changes — modifying `points-mall-core` will not trigger frontend lint-staged.

| Service | Tool | Action |
|---------|------|--------|
| bff / frontend / message / frontend-base | lint-staged → ESLint + Prettier | `--fix` + `--write`, then re-stage |
| core / thirdparty-connector | `mvn spotless:apply` | Format staged `.java` files, then re-stage |
| shop | `pint <staged files>` | Format staged `.php` files, then re-stage |
| data | `ruff format` + `ruff check --fix` | Format + lint staged `.py` files, then re-stage |

### Installation

`.git-hooks/install.js` copies hooks into root + all 8 submodule `.git/hooks/` directories. Runs automatically via the `prepare` lifecycle script after `pnpm install`. Uses file copy (not symlink) for cross-platform compatibility.

---

## 5. Containerisation & Deployment

### Dockerfiles

All 7 deployable services have a `Dockerfile` using multi-stage builds where applicable:

| Service | Base image | Strategy |
|---------|-----------|----------|
| bff, message, frontend | `node:22-alpine` | builder → prod (prune devDeps) |
| data | `python:3.12-slim` | single stage |
| core, thirdparty-connector | `maven:3.9-eclipse-temurin-25` → `eclipse-temurin:25-jdk` | multi-stage |
| shop | `php:8.5-cli` | single stage + composer |

Each service also has a `.dockerignore` excluding `node_modules`, `target`, `vendor`, and `.env*`.

### Render Deployment

Defined in `render.yaml` at the repo root (Render Blueprint). All services use `runtime: docker`.

| Environment | URL | Neon Branch |
|------------|-----|-------------|
| **Production** | https://points-mall.onrender.com | prod |
| **Dev / Staging** | https://points-mall-dev.onrender.com | dev |

Secret env vars are configured per-environment in the Render dashboard. Non-secret vars (ports, feature flags) are hardcoded in `render.yaml`.

---

## 3. Code Quality Tooling

Each language ecosystem uses its idiomatic formatter. Mixing tools would lose the best practices of each ecosystem.

| Service | Formatter | Linter | Rationale |
|---------|-----------|--------|-----------|
| bff / frontend / message / frontend-base | **Prettier** | **ESLint** | JS/TS de facto standard; Prettier owns format, ESLint owns logic |
| core / thirdparty-connector | **Spotless + google-java-format** | — | Maven plugin ecosystem; google-java-format is zero-config |
| shop | **Laravel Pint** | — | Laravel official tool, built on php-cs-fixer |
| data | **Ruff** | **Ruff** | Rust-based; replaces Black + isort + flake8 in one binary |

**Prettier vs ESLint:** Prettier only manages formatting (indent, quotes, semicolons). ESLint manages code quality (unused variables, type coercions). They are complementary. `eslint-config-prettier` disables all ESLint format rules to avoid conflicts.

**google-java-format vs Checkstyle:** google-java-format is a formatter (auto-fixes, no config). Checkstyle is a linter (reports violations, highly configurable). This project uses google-java-format because it eliminates formatter decisions — developers run `spotless:apply` before committing and the file is correct.

---

## 4. GitHub Actions CI

### Two-layer CI strategy

The 8 services are independent Git repositories (submodules). If CI only existed in the monorepo, a PR opened directly in a sub-repo would have no quality gate. A developer unfamiliar with the submodule workflow could bypass all checks.

| Layer | Trigger | Scope |
|-------|---------|-------|
| **Monorepo CI** (`.github/workflows/ci.yml`) | PR / push to `main` in monorepo | All 8 jobs in parallel; integration view |
| **Sub-repo CI** (each `<service>/.github/workflows/ci.yml`) | PR / push to `main` in any sub-repo | Only that service; independent of monorepo |

Both layers are configured as required status checks via GitHub branch protection rules.

### Monorepo CI job matrix

| Job | Steps |
|-----|-------|
| bff | `pnpm install` → `lint` → `format:check` → `build` |
| message | `pnpm install` → `lint` → `format:check` → `build` |
| frontend-base | `pnpm install` → `lint` → `format:check` → `build` |
| frontend | `pnpm install` (workspace) → build frontend-base → `lint` → `format:check` → `build` |
| core | `mvn verify` (includes Spotless check) |
| thirdparty | `mvn verify` (includes Spotless check) |
| shop | `composer install` → `pint --test` |
| data | `pip install ruff` → `ruff check` → `ruff format --check` |

### `points-mall-frontend` sub-repo special handling

`frontend` depends on `frontend-base` via `workspace:*`. In the monorepo this resolves to a symlink, but in the sub-repo's standalone checkout there is no workspace. The CI solves this by:

1. Checking out `frontend-base` alongside at `./points-mall-frontend-base`
2. Dynamically creating a `pnpm-workspace.yaml` that includes both packages
3. Running `pnpm install --no-frozen-lockfile` to resolve the workspace link

### Monorepo deploy workflow (`.github/workflows/deploy.yml`)

```
merge to main
  │
  ├─ 8 build jobs (parallel)
  │     docker build → push to GHCR
  │     tags: commit SHA (immutable) + latest (mutable)
  │
  └─ deploy job (needs: all build jobs)
        SSH to VPS
        docker compose pull
        docker compose up -d
        docker image prune -f
```

Two tags per image: commit SHA for rollback/audit; `latest` for `docker compose pull` convenience.

---

## 5. Service Skeletons

> Related task: TASK-INFRA-0001

Each service starts as a runnable skeleton with a single `GET /health → 200 OK` endpoint. No database connections, no business logic — the minimum to prove the process starts and CI can verify liveness.

**Spec amendment (2026-06-22):** `points-mall-thirdparty-connector` framework changed from Express/TypeScript → Spring Boot WebFlux (Java 25). WebFlux + WebClient is the better fit for a service whose sole purpose is non-blocking calls to external APIs. Amendment confirmed by Human before implementation.

### Framework decisions

| Service | Framework | Version | Health route |
|---------|-----------|---------|-------------|
| `points-mall-bff` | NestJS | 11 | `GET /health` |
| `points-mall-core` | Spring Boot | 4.1 (Java 25) | `GET /health` |
| `points-mall-shop` | Laravel | 13 (PHP 8.5) | `GET /health` |
| `points-mall-message` | Express + TypeScript | Express 5 / TS 5.8 | `GET /health` |
| `points-mall-thirdparty-connector` | Spring Boot WebFlux | 4.1 (Java 25) | `GET /health` |
| `points-mall-data` | FastAPI | 0.128 (Python 3.12) | `GET /health` |
| `points-mall-frontend` | Next.js App Router | 16 | `GET /api/health` |
| `points-mall-frontend-base` | Rollup + React 19 | Rollup 4 | N/A — build only |

### Minimal health response (Phase 0)

```json
{ "status": "ok" }
```

HTTP `200 OK`. The full response contract (with `db`, `uptime`, `timestamp`, `service`) is defined in Section 7.

### Out of scope (Phase 0)

- Database connections (Section 7)
- Multi-environment config (Section 6)
- Docker Compose (Section 8)
- Any business logic routes beyond `/health`

---

## 6. Multi-Environment Config

> Related task: TASK-INFRA-0003

Each service documents its environment variable contract in `.env.example` and loads the correct profile at startup. No secrets are hardcoded in source files.

### Profile mechanism per framework

| Service | Mechanism |
|---------|-----------|
| `bff` | `@nestjs/config` → loads `.env.${NODE_ENV}` |
| `core` | Spring profiles → `application-{profile}.yml` |
| `shop` | Single `.env` file (Laravel convention); profiles documented in `.env.example` |
| `message` | `dotenv` → loads `.env.${NODE_ENV}` |
| `thirdparty` | Spring profiles → `application-{profile}.yml` |
| `data` | `python-dotenv` → loads `.env.${ENVIRONMENT}` |
| `frontend` | Next.js built-in → `.env.{development,test,production}` |
| `frontend-base` | `.env.example` only (build-time, no runtime) |

### Conventions

- All secrets in `.env.example` use empty placeholder (`KEY=`) — never real values
- Non-secret defaults use `localhost` values for local development
- Variables requiring operator action are marked `# Required`
- All real `.env.*` files (except `.env.example`) are in `.gitignore`

### Out of scope

- Actual secret values (operator-managed, never committed)
- Docker Compose `.env.docker` override (T090)
- Kubernetes secret management (T089)
- Runtime secret rotation

---

## 7. Health Endpoint Standard

> Related task: TASK-INFRA-0004

All 6 backend services expose a standardized health endpoint that reports process liveness and DB connectivity. `frontend` and `frontend-base` are excluded (no backend runtime).

### Response contract

```json
{
  "status": "ok",
  "service": "points-mall-bff",
  "timestamp": "2026-06-23T10:00:00.000Z",
  "db": "ok",
  "uptime": 42
}
```

- `status` — always `"ok"` at this phase. T093 adds `"degraded"` with HTTP 503.
- `db` — `"ok"` on successful lightweight probe (e.g. `SELECT 1`); `"error"` on failure or when service has no DB by design.
- `uptime` — process uptime in whole seconds.
- `timestamp` — UTC ISO 8601.
- The endpoint always returns HTTP 200 — a DB failure must not crash the health check.

### DB probe strategy per service

| Service | DB probe | `db` when no DB configured |
|---------|----------|---------------------------|
| `bff` | No direct DB | `"ok"` by convention |
| `core` | `DataSource.getConnection().isValid(1)` | `"error"` (DB required) |
| `shop` | `DB::select('SELECT 1')` | `"error"` (DB required) |
| `message` | No direct DB at this phase | `"ok"` |
| `thirdparty-connector` | No direct DB | `"ok"` |
| `data` | No direct DB at this phase | `"ok"` |

### Out of scope

- `redis` and `mq` fields — deferred to T093
- HTTP 503 on degraded state — deferred to T093
- Prometheus / OpenTelemetry integration — out of project scope

---

## 8. Shared Infrastructure (docker-compose + Database Schema)

> Related task: TASK-INFRA-0005  
> DB schema specs: [.wiki/db/core-schema.md](../db/core-schema.md), [.wiki/db/shop-schema.md](../db/shop-schema.md)

### docker-compose

Project-root `docker-compose.yml` provides postgres, redis, and rabbitmq for local development. `infra/postgres/init.sql` creates both application databases on first boot:

```sql
CREATE DATABASE points_core;
CREATE DATABASE points_shop;
```

Default credentials (local dev only): user `points`, password `points_dev`.

### Database ownership

| Database | Owned by | Migration tool |
|----------|----------|---------------|
| `points_core` | `points-mall-core` | Flyway (versioned SQL migrations) |
| `points_shop` | `points-mall-shop` | Laravel Migrations |

### points_core schema (Flyway — 6 migrations)

| Migration | Table | Key columns |
|-----------|-------|-------------|
| V1 | `departments` | `id`, `name`, `code` (unique), `parent_id` (self-ref) |
| V2 | `employees` | `id`, `email` (unique), `password_hash`, `department_id`, `github_id`, `is_active` |
| V3 | `roles` + `employee_roles` | `roles`: name unique; `employee_roles`: composite PK `(employee_id, role_id)` |
| V4 | `attendance_records` | `employee_id`, `check_in_at`, `work_date`, `status` (normal/late/early_leave/absent) |
| V5 | `points_rules` | `rule_code` (unique), `points_value`, `is_active`, `valid_from`, `valid_until` |
| V6 | `points_ledger` | `employee_id`, `delta`, `balance_after`, `ref_type`, `ref_id`; append-only |

Full DDL and ER diagram in `.wiki/db/core-schema.md`.

### points_shop schema (Laravel — 7 migrations)

Tables: `categories`, `products`, `orders`, `order_items`, `menu_items`, `announcements`, `system_configs`.

Key design decisions:
- `orders.employee_id` is a plain integer (no FK) — cross-database reference to `points_core.employees`
- `system_configs` is a `key`/`value` table for runtime feature flags consumed by the frontend

Full DDL and ER diagram in `.wiki/db/shop-schema.md`.

### Out of scope

- Seed / fixture data (T006 employee seeder)
- ORM entity classes (T006 / T034)
- Full-text search indexes, partitioning (Phase 7)
- Redis key schema (separate INFRA tasks)
- `points-mall-message`, `points-mall-data`, `points-mall-thirdparty-connector` have no own DB

---

## Change Log

| Version | Date | Author | Summary |
|---------|------|--------|---------|
| 1.0 | 2026-06-22 | AI | Initial: pnpm workspace, task scripts, Bruno CLI, commit-msg hook (TASK-INFRA-0002) |
| 1.1 | 2026-06-23 | AI | Added: code quality tooling, pre-commit hook, two-layer GitHub Actions CI, deploy workflow (TASK-INFRA-0002 expanded) |
| 1.2 | 2026-06-23 | AI | Added: service skeletons (§5), multi-env config (§6), health endpoint standard (§7), shared infrastructure / DB schema (§8) — TASK-INFRA-0001/0003/0004/0005 |
