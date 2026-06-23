# Fullstack Points Mall

> Enterprise employee points & rewards management system — production-grade full-stack demo targeting overseas Frontend / Full-Stack Engineer roles.

[![CI](https://github.com/your-username/fullstack-points-mall/actions/workflows/ci.yml/badge.svg)](https://github.com/your-username/fullstack-points-mall/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

## Live Demo

| Environment | URL |
|------------|-----|
| **Production** | https://points-mall.onrender.com |
| **Dev / Staging** | https://points-mall-dev.onrender.com |

> Free tier — first request may take ~30 s to wake up the service.

---

## What This System Does

Employees earn points automatically through daily attendance check-ins, birthday bonuses, and holiday subsidies. They browse an internal points mall stocked with products synced from Amazon, then redeem points for rewards. Admins configure rules, monitor operations, and export desensitized data reports.

**Full business loop:** points issuance → points wallet → mall browsing → order checkout → async notifications (email + in-app) → data reporting dashboard.

---

## Architecture

```
                   ┌──────────────────────────────────────┐
                   │         points-mall-frontend          │
                   │      Next.js 14 · React 18 · TS       │
                   │  (consumes points-mall-frontend-base) │
                   └─────────────────┬────────────────────┘
                                     │ HTTP
                   ┌─────────────────▼────────────────────┐
                   │           points-mall-bff              │
                   │   NestJS · JWT Auth · Rate Limiting    │
                   │   Request Aggregation · OpenAPI Docs   │
                   └──┬──────┬──────┬──────┬───────────────┘
                      │      │      │      │      │
                      ▼      ▼      ▼      ▼      ▼
                   ┌────┐ ┌────┐ ┌────┐ ┌────┐ ┌─────────────┐
                   │core│ │shop│ │msg │ │data│ │ thirdparty  │
                   │Java│ │PHP │ │Node│ │ Py │ │   Node.js   │
                   └────┘ └────┘ └────┘ └────┘ └──┬──────────┘
                                                   │
                                      ┌────┬───────┴──┬───────┐
                                      ▼    ▼          ▼       ▼
                                   GitHub  AWS S3  SendGrid  Amazon
                                   OAuth           Email     Products
```

**Star topology — BFF is the single gateway.** All downstream services talk only to BFF; no direct cross-service calls. Third-party platforms are entirely encapsulated in the ThirdPartyConnector.

---

## Services

| Service | Stack | Responsibility | Port |
|---------|-------|----------------|------|
| [points-mall-frontend](./points-mall-frontend) | Next.js 14, React 18, TS, TailwindCSS | Employee UI, admin dashboard, data visualization | 3000 |
| [points-mall-frontend-base](./points-mall-frontend-base) | React 18, TS, Rollup, Storybook | Shared NPM component library — layout, auth hooks, UI primitives | — |
| [points-mall-bff](./points-mall-bff) | NestJS, TypeScript, Redis | Unified API gateway, JWT auth, request aggregation | 4000 |
| [points-mall-core](./points-mall-core) | Java 25, Spring Boot 4.1, PostgreSQL, Redis | Employee accounts, attendance check-in, points ledger | 8080 |
| [points-mall-shop](./points-mall-shop) | PHP 8.5, Laravel 13, PostgreSQL | Product catalog, inventory, exchange orders, system config | 8081 |
| [points-mall-message](./points-mall-message) | Node.js 22, Express 5, TS, RabbitMQ | Local file storage, internal notifications, async event consumer | 8082 |
| [points-mall-data](./points-mall-data) | Python 3.12, FastAPI, Pandas | ETL pipeline, chart data API, desensitized Excel report export | 8083 |
| [points-mall-thirdparty-connector](./points-mall-thirdparty-connector) | Java 25, Spring Boot 4.1, WebFlux | Unified hub for all external APIs: GitHub OAuth, AWS S3, Amazon, SendGrid | 8084 |

---

## Tech Stack Matrix

| Dimension | Technology |
|-----------|-----------|
| Frontend Framework | Next.js 14 App Router, React 18, TypeScript |
| State Management | Zustand (modular, SSR-compatible), React Query (server state) |
| Styling | TailwindCSS + design token system |
| Form & Validation | React Hook Form + Zod (schema shared between frontend and BFF) |
| BFF Gateway | NestJS, Passport.js, class-validator, Swagger/OpenAPI |
| Core Service | Spring Boot 3, Spring Data JPA, Spring Scheduler, PostgreSQL |
| Cache | Redis (cache-aside, penetration / breakdown / avalanche guards) |
| Message Queue | RabbitMQ — async notification decoupling |
| Shop Service | Laravel 11, Eloquent ORM, PostgreSQL |
| Data Service | FastAPI, SQLAlchemy, Pandas, APScheduler, openpyxl |
| Third-Party | GitHub OAuth 2.0, AWS S3 SDK, Amazon Product Advertising API, SendGrid |
| Testing | Vitest (unit), Playwright (E2E), Bruno (API collections) |
| CI/CD | GitHub Actions — lint → typecheck → test → Docker build → deploy |
| Containerization | Docker multi-stage builds + docker-compose |
| Deployment | Render (Blueprint `render.yaml`) — dev + prod environments, Neon PostgreSQL |

---

## Business Modules

| Module | Description |
|--------|-------------|
| Employee & Auth | GitHub OAuth login, JWT sessions, role-based permissions (admin / employee) |
| Attendance & Points | Daily check-in, automatic points issuance rules, points wallet, transaction ledger |
| Points Mall | Product catalog (Amazon-synced), points-based checkout, order lifecycle tracking |
| File & Notifications | Chunked file upload, internal notification center, async email push via SendGrid |
| Data Dashboard | Real-time attendance / points / order charts, ETL pipeline, desensitized report export |
| System Config | Dynamic menu management, announcements, global feature flag toggles |

---

## Key Engineering Highlights

- **Star-Topology BFF** — frontend talks to one gateway; all backend services and third-party platforms are fully isolated from each other
- **Redis Cache Defense** — three-layer protection: null-value caching (penetration), distributed lock (breakdown), TTL jitter (avalanche)
- **SQL Performance Optimization** — composite indexes on hot query paths, EXPLAIN-based slow-query analysis documented in `.wiki/`
- **Lightweight ETL Pipeline** — Python multi-source data extraction, field normalization, sensitive-field masking, chart-ready output
- **NPM Component Library** — `points-mall-frontend-base` published to NPM with Rollup, full TypeScript declarations, Storybook documentation
- **GitHub Actions CI/CD** — code push → lint + typecheck + tests → Docker build → auto-deploy pipeline
- **Out-of-China Ready** — i18n bilingual support, timezone auto-sync, multi-currency formatting, GDPR cookie consent, Safari compatibility fixes

---

## Code Quality

Each service uses the idiomatic formatter for its language ecosystem:

| Service | Formatter | Linter |
|---------|-----------|--------|
| bff / frontend / message / frontend-base | Prettier | ESLint |
| core / thirdparty-connector | Spotless + google-java-format | — |
| shop | Laravel Pint | — |
| data | Ruff | Ruff |

A **pre-commit hook** (`.git-hooks/pre-commit`) runs the relevant formatter automatically on staged files before every commit — only for services with staged changes. The commit-msg hook enforces `<type>(<scope>): <summary>` format on all commits.

**Two-layer CI:** The monorepo `.github/workflows/ci.yml` runs all 8 service jobs in parallel on PRs to `main`. Each sub-repo also has its own `.github/workflows/ci.yml` so PRs opened directly in a sub-repo are independently gated — no submodule knowledge required.

---

## Local Development

```bash
# 1. Clone the repo with all submodules
git clone --recurse-submodules https://github.com/your-username/fullstack-points-mall.git
cd fullstack-points-mall

# 2. Install root dev tools (Bruno CLI, Husky) and set up Git hooks
pnpm install

# 3. Copy and configure environment variables for each service
#    Each service has its own .env.example — copy and fill in real values
cp points-mall-core/.env.example points-mall-core/.env
# Repeat for other services as needed

# 4. Start all services with Docker Compose
docker-compose up -d

# Services available at:
#   Frontend:  http://localhost:3000
#   BFF API:   http://localhost:4000 (NestJS)
#   Swagger:   http://localhost:4000/api-docs
```

> **Git hooks** are installed automatically by `pnpm install` (via the `prepare` lifecycle script).
> Every commit in this repo and all submodules must follow the format:
> `<type>(<scope>): <summary>` — e.g. `feat(TASK-AUTH-0001): implement JWT login`.
> Commits that don't match this format will be rejected locally before reaching GitHub.

> **If you cloned without `--recurse-submodules`**, run:
> `git submodule update --init --recursive`

---

## Deployment

All services are containerised (Docker multi-stage builds) and deployed to [Render](https://render.com) via `render.yaml` at the repo root.

| Environment | Neon Branch | Trigger |
|------------|-------------|--------|
| **prod** | `main` branch | push to `main` |
| **dev** | `dev` branch | push to `develop` |

Secret env vars (DB credentials, JWT secrets, API keys) are configured per-environment in the Render dashboard. See `render.yaml` for the full service manifest.

---

## Repository Structure

```
fullstack-points-mall/
├── .github/                         # GitHub Actions CI/CD workflows + PR templates
├── .tasks/                          # Task management hub (Jira-replacement)
├── .wiki/                           # API contracts (OpenAPI), DB schemas, feature specs
├── .tests/                          # Shared E2E (Playwright) and API (Bruno) test suites
├── points-mall-frontend/            # Next.js frontend application
├── points-mall-frontend-base/       # Shared NPM component library (published to npm)
├── points-mall-bff/                 # NestJS BFF API gateway
├── points-mall-core/                # Java Spring Boot — attendance & points core
├── points-mall-shop/                # PHP Laravel — product catalog & orders
├── points-mall-message/             # Node.js — file storage & notifications
├── points-mall-data/                # Python FastAPI — ETL & data reporting
├── points-mall-thirdparty-connector/# Node.js — third-party API aggregator
├── WORKFLOW.md                      # AI-assisted development workflow spec
├── TASKLIST.md                      # Synchronized cross-service task list
└── docker-compose.yml               # Full local dev stack
```

---

## License

MIT
