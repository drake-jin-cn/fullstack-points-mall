# Employee Points Mall — Synchronized Development Task List

> **Sync Principle:** At the end of each phase, all services must be at the same level of completion. It is not allowed for one service to be fully finished while another hasn't been scaffolded yet.
>
> **Pace Guide:** Each task takes roughly 2–4 hours; large tasks (🔴) may span two development days. Check off tasks when done.
>
> **Legend:** 🟢 Small (<2h) · 🟡 Medium (2–4h) · 🔴 Large (4–6h)

---

## Table of Contents

- [Phase 0 — Project Scaffolding](#phase-0--project-scaffolding-t001t005)
- [Phase 1 — Auth Foundation](#phase-1--auth-foundation-t006t015-t097t099)
- [Phase 2 — Permission System](#phase-2--permission-system-t016t022)
- [Phase 3 — Attendance & Points Core](#phase-3--attendance--points-core-t023t033)
- [Phase 4 — Product Catalog & Exchange Shop](#phase-4--product-catalog--exchange-shop-t034t044)
- [Phase 5 — File Storage & Notifications](#phase-5--file-storage--notifications-t045t054)
- [Phase 6 — Data Dashboard & ETL](#phase-6--data-dashboard--etl-t055t062)
- [Phase 7 — Performance & Security Hardening](#phase-7--performance--security-hardening-t063t071)
- [Phase 8 — Frontend Engineering Polish](#phase-8--frontend-engineering-polish-t072t081)
- [Phase 9 — Overseas & i18n](#phase-9--overseas--i18n-t082t088)
- [Phase 10 — DevOps & Final Polish](#phase-10--devops--final-polish-t089t096)

---

## Phase 0 — Project Scaffolding (T001–T005 + INFRA)

**Goal:** All 8 services have a runnable skeleton. Shared infrastructure (DB, Redis, MQ) is defined. Team can `docker-compose up` and see all services respond.

> **INFRA tasks** are tracked in `.tasks/infra/TASK-INFRA-XXXX.md` and managed via `pnpm run tasks:*` scripts.

### 1 — Service Foundation

- [x] All 8 service skeletons initialized with framework boilerplate — NestJS (bff), Spring Boot (core), Spring WebFlux (thirdparty), Laravel (shop), Express/TS (message), FastAPI (data), Next.js (frontend), Rollup/React (frontend-base). `TASK-INFRA-0001`
- [x] Multi-environment config (`dev` / `test` / `prod`) for all 8 services: `.env.example` + profile files + env-var loading wired at startup; no secrets in source. `TASK-INFRA-0003`
- [x] Standardized `GET /health` on all 6 backend services returns `{ status, service, timestamp, db: "ok"|"error", uptime }`. `TASK-INFRA-0004`

### 2 — Shared Infrastructure

- [x] `docker-compose.yml` at project root: `postgres:16-alpine`, `redis:7-alpine`, `rabbitmq:3-management-alpine`; `infra/postgres/init.sql` creates `points_core` and `points_shop` on first boot. `TASK-INFRA-0005`
- [x] Database schema — **`points_core`**: 6 Flyway migrations (departments → employees → roles/employee_roles → attendance_records → points_rules → points_ledger); **`points_shop`**: 7 Laravel migrations (categories, products, orders, order_items, menu_items, announcements, system_configs). ER diagrams in `.wiki/db/`. `TASK-INFRA-0005`

### 3 — Developer Toolchain

- [x] Root `package.json` with pnpm workspace; `tasks:sync` / `tasks:list` / `tasks:view` / `test:task` scripts; Bruno CLI (`bru`) installed. `TASK-INFRA-0002`
- [x] `commit-msg` Git hook enforcing `<type>(TASK-ID): <summary>` format installed on root + all 8 submodule repos via `pnpm run hooks:install`. `TASK-INFRA-0002`
- [x] `.github/CODEOWNERS` (auto-assigns PR reviewers by directory) + `pull_request_template.md` (requires linked TASK ID). `TASK-INFRA-0003` partial
- [x] `.github/workflows/ci.yml` (lint + type-check + test per service, all 8 jobs run in parallel, gates PR merge) + `deploy.yml` (build → GHCR push → SSH deploy, triggered on merge to `main`).

### 4 — Frontend Setup

- [x] `points-mall-frontend`: Next.js App Router + TypeScript + TailwindCSS + ESLint. `TASK-INFRA-0001`
- [x] `points-mall-frontend-base`: Rollup config with ESM + CJS dual output; placeholder `Button` component; `pnpm build` exits 0. `TASK-INFRA-0001`
- [x] Prettier + lint-staged wired on `points-mall-frontend`: `.prettierrc.json` + `.prettierignore`; `format` / `format:check` scripts; pre-commit hook runs lint-staged on staged `ts/tsx/json/md/css` files.
- [x] `points-mall-frontend-base` published to npm as `@points-mall/frontend-base`; `points-mall-frontend` consumes it as a versioned npm dependency. Publish workflow: `.github/workflows/publish.yml` auto-publishes on `v*` tag.

### 5 — Containerisation & Deployment

- [x] `Dockerfile` for all 7 deployable services (multi-stage for Node.js + Java; single-stage for Python + PHP). `.dockerignore` added to each service. `TASK-INFRA-0001`
- [x] `render.yaml` Blueprint at repo root: defines all 7 services with `runtime: docker`; secret vars marked `sync: false`; frontend port 3003. Two environments configured in Render dashboard: **dev** (`https://points-mall-dev.onrender.com`) and **prod** (`https://points-mall.onrender.com`). `TASK-INFRA-0003`
- [x] Neon PostgreSQL: two separate branches — `dev` and `prod` — with independent connection strings. All services use `DB_SSL_PARAMS=?sslmode=require`. Hikari pool tuned for Neon serverless (max 5, min 0). `TASK-INFRA-0005`

---

**Phase 0 primary goal:** ✅ All 8 services have runnable skeletons, `docker-compose up` brings up postgres/redis/rabbitmq, all `/health` endpoints respond, all services containerised, and both Render environments are live.

---

## Phase 1 — Auth Foundation (T006–T015, T097–T099)

**Goal:** Users can log in with email/password, GitHub OAuth, or Enterprise SSO (OIDC). All services validate JWT. Token storage follows security best practices.

- [x] **T006** 🟡 `[core]` Employee credential verification API: `POST /internal/auth/verify` — validate email + bcrypt password, return employee info. Endpoint is internal-only (requires `INTERNAL_API_KEY` header, rejects all other callers). Employee seeder: one admin + two employee accounts. Database: add `V7__add_password_hash_to_employees.sql` Flyway migration to add `password_hash VARCHAR NOT NULL` column to existing `employees` table (created in Phase 0 without this field).
  - **Architecture**: Classic layered approach — `InternalApiKeyFilter` → `AuthVerifyController` → `EmployeeAuthService` → `EmployeeRepository`
  - **INTERNAL_API_KEY validation**: `OncePerRequestFilter` intercepts all `/internal/**` routes globally; returns 401 JSON immediately on invalid/missing key — do NOT check per-controller (one missed endpoint = security hole)
  - **BCrypt dependency**: add `spring-security-crypto` only (zero side effects); do NOT use `spring-boot-starter-security` (activates login page, CSRF, session management, and other unwanted defaults)
  - **Seeder environment**: `ApplicationRunner` annotated with `@Profile({"dev","test"})`; seeds one admin + two employee accounts on startup in dev/test only — production must never auto-create accounts
  - **Why not full Spring Security**: Core has no external callers; all requests come from BFF over the internal network, so there are no JWT-bearing users — a single `OncePerRequestFilter` is the minimal sufficient solution

- [x] **T007** 🟡 `[bff]` JWT issuance strategy: on login, issue `access_token` (15 min) + `refresh_token` (7 days) using `@nestjs/jwt`. `POST /auth/login` proxies credential validation to Core's `POST /internal/auth/verify` via shared internal `INTERNAL_API_KEY` header (Core rejects calls without it); issues `access_token` via `Set-Cookie: access_token=...; HttpOnly; Secure; SameSite=Strict`; stores `refresh_token` in Redis (`refresh:{userId}`, TTL 7 days). Global `AuthGuard` validates bearer token on all protected routes; `/auth/login` and `/auth/refresh` are explicitly whitelisted.

- [x] **T015** 🟢 `[shop, message, data]` Add JWT validation middleware to all three remaining downstream services: extract and verify bearer token on every protected route; return `401` if invalid or missing. All services now uniformly reject unauthorized requests. *(moved here: only depends on T007's token format, independent of OAuth/OIDC)*

- [x] **T008** 🟡 `[bff]` Token refresh endpoint: `POST /auth/refresh` — validates refresh token by checking Redis key `refresh:{userId}` exists (server-side validity, not just signature); issues new access token via `Set-Cookie`. Invalidation endpoint: `POST /auth/logout` — DEL `refresh:{userId}` from Redis, clear access token cookie. Silent refresh logic: if access token cookie is expired but Redis refresh key is valid, auto-renew.

- [x] **T100** 🟡 `[frontend-base]` AppShell layout component: collapsible left Sidebar (240 px expanded / 64 px icon-only with tooltip, `localStorage` persists state), top Header (logo + product title on left; avatar dropdown with profile/logout + notification bell on right), auto-computed Breadcrumb from `menuItems[]` + current `pathname`. All data (menuItems, user, notificationCount, callbacks) are injected as props — the component makes no API calls. Hardcoded default styles (dark sidebar `#001529`, white header); consumers override via semantic CSS classes (`.pm-sidebar`, `.pm-header`). Zero runtime dependencies beyond React; styles use CSS Modules bundled by Rollup.

- [ ] **T009** 🟡 `[frontend]` Axios infrastructure + global loading/toast layer: shared Axios instance with auth token injection and unified response/error handling; global fullscreen loading overlay while any request is in-flight, with per-request opt-out for silent background calls; global toast notifications on API errors; zero per-page setup.

- [ ] **T010** 🟡 `[frontend]` Login page: email + password form with React Hook Form + Zod validation; call BFF login API via Axios instance from T009 (depends on T009); `access_token` is set automatically via BFF `Set-Cookie` — no manual token storage needed; store user info in `useAuthStore` (Zustand). Redirect to dashboard on success.

- [ ] **T011** 🟡 `[frontend]` Silent token refresh interceptor: on 401 response, pause the failed request queue, call `/auth/refresh`, then replay all queued requests with the new token. If refresh also fails, clear auth state and redirect to login.

- [ ] **T012** 🟡 `[thirdparty]` GitHub OAuth module: `GET /oauth/github/url` returns authorization URL with correct scopes; `GET /oauth/github/callback` exchanges code for access token, fetches user profile from GitHub API, returns normalized `{ githubId, email, name, avatar }`.

- [ ] **T013** 🟡 `[bff]` GitHub OAuth login flow: relay callback to ThirdPartyConnector, look up or create local employee record bound to GitHub ID (via Core), issue JWT same as password login. Frontend receives the same token format regardless of login method.

- [ ] **T014** 🟢 `[frontend]` GitHub OAuth button on login page: redirect to `GET /auth/github`; handle `/auth/github/callback` page — extract token from URL params, persist to store, redirect to dashboard.

### Enterprise SSO Extension (OIDC)

- [ ] **T097** 🔴 `[thirdparty]` Keycloak OIDC module: `GET /oauth/oidc/url` — build authorization URL with PKCE (`code_challenge`, `code_challenge_method=S256`); `POST /oauth/oidc/callback` — exchange `code` + `code_verifier` for tokens at Keycloak/Auth0 token endpoint; verify `id_token` signature using IdP's JWKS endpoint (`/.well-known/openid-configuration`); return normalized `{ sub, email, name, preferred_username }`. Config via env vars (`OIDC_ISSUER`, `OIDC_CLIENT_ID`, `OIDC_CLIENT_SECRET`) — IdP is swappable with no code change:
  - **Local dev**: add `keycloak:24` to `docker-compose.yml` (`start-dev` mode, port 8080); create realm `points-mall` + client via Keycloak admin UI; set `OIDC_ISSUER=http://localhost:8080/realms/points-mall`.
  - **Production (Render)**: Keycloak is too heavy for free tier — use Auth0 free tier (7500 MAU) instead; register account at auth0.com, create Application (Regular Web App), set `OIDC_ISSUER=https://<tenant>.auth0.com` in Render env vars. Same OIDC protocol, zero code change.

- [ ] **T098** 🟡 `[bff]` OIDC SSO login flow: `GET /auth/sso` redirects to IdP authorization URL (from ThirdPartyConnector); `GET /auth/sso/callback` relays OIDC callback to ThirdPartyConnector, looks up or creates local employee record by IdP `sub` field (via Core), issues internal JWT same as password/GitHub login. All three login methods now converge at a single JWT issuance path — business logic is auth-method agnostic.

- [ ] **T099** 🟢 `[frontend]` SSO login button on login page: "Enterprise SSO" button redirects to `GET /auth/sso`; `/auth/sso/callback` page extracts token from URL params, persists to `useAuthStore`, redirects to dashboard. Login page now presents three login options side by side: Email/Password, GitHub OAuth, Enterprise SSO.

---

## Phase 2 — Permission System (T016–T022)

**Goal:** Role-based access control works end-to-end. Admin and Employee see different menus and pages. Unauthorized access is blocked at every layer.

- [ ] **T016** 🟡 `[core]` Role and permission data model: `roles` table (admin, employee), `role_permissions` mapping, seed data. `GET /employees/me` returns employee profile including role. `GET /permissions` returns permission key list for current role.

- [ ] **T017** 🟡 `[shop]` Dynamic menu config: `menu_items` table (id, parent_id, label, path, icon, permission_key, sort_order, is_active). Admin CRUD APIs: `GET/POST/PUT/DELETE /admin/menus`. Seed default admin and employee menu trees.

- [ ] **T018** 🟡 `[bff]` Menu aggregation endpoint: `GET /menus` — fetch current user's role from Core, fetch menu tree from Shop, filter by permission keys, return sorted tree. This is the only menu API the frontend calls.

- [ ] **T019** 🟡 `[bff]` Next.js Middleware route guard (server-side): validate JWT from Cookie on every request before page render; redirect to `/login` if missing/expired; redirect to `/403` if role lacks permission for the requested route.

- [ ] **T020** 🟡 `[frontend-base]` Sidebar menu component: renders permission-filtered tree from BFF; supports collapsible groups, active route highlight, icon slots. Driven entirely by API response — no hardcoded routes.

- [ ] **T021** 🔴 `[frontend]` Three-level permission control:
  - Route level: Next Middleware (server-side, done in T019)
  - Page level: async permission check on page load → render `403` page if denied
  - Button level: `usePermission('key')` hook from `frontend-base` returns `{ visible, disabled }` — no permission key = button hidden or disabled

- [ ] **T022** 🟡 `[frontend]` Admin dashboard shell: App Router layout with `AppShell` from frontend-base, sidebar, topbar with user avatar + notification bell placeholder. Basic page routing for all planned modules (placeholder pages). Breadcrumb component wired to route.

---

## Phase 3 — Attendance & Points Core (T023–T033)

**Goal:** Employees can check in daily. Points are issued automatically by scheduled jobs. Personal points dashboard is live.

- [ ] **T023** 🟡 `[core]` Attendance check-in API: `POST /attendance/check-in` — guard against duplicate check-in on same calendar day; create `attendance_records` row; return today's status. `GET /attendance/today` returns today's check-in status for current user.

- [ ] **T024** 🟡 `[core]` Attendance history API: `GET /attendance/history` — paginated list with date range filter. `GET /attendance/stats` returns monthly summary (present days, absent days, late count). Admin: `GET /admin/attendance` lists all employees' attendance with filter by department/date.

- [ ] **T025** 🔴 `[core]` Points rule engine: `points_rules` table (rule_type, base_amount, multiplier, conditions JSON, is_active). Supported types: `attendance_daily`, `birthday_monthly`, `holiday_bonus`. Service method `calculatePoints(employeeId, ruleType, date)` returns calculated amount. Rules are editable by admin via `GET/PUT /admin/points-rules`.

- [ ] **T026** 🟡 `[core]` Points issuance & deduction: `points_transactions` table (employee_id, amount, type, balance_after, remark, created_at). Transactional method: atomically update `employees.points_balance` and insert ledger entry. `GET /points/balance` returns current balance. `GET /points/ledger` returns paginated transaction history.

- [ ] **T027** 🟡 `[core]` Spring Scheduler jobs (single-machine, `@Scheduled`, no external job framework):
  - Daily at 23:59: issue `attendance_daily` points to all employees who checked in today
  - 1st of each month: issue `birthday_monthly` points to employees whose birthday is this month
  - Configurable holiday bonus: admin sets holiday dates in `system_configs` (via Shop service)

- [ ] **T028** 🟡 `[bff]` Attendance & points API aggregation: proxy and compose endpoints from Core; `POST /check-in`, `GET /attendance/history`, `GET /points/balance`, `GET /points/ledger`. Add rate limiting guard on `POST /check-in` (max 3 attempts per user per 10 minutes).

- [ ] **T029** 🟡 `[frontend-base]` Shared components for this module: `StatsCard` (label + value + trend icon), `PointsBadge` (balance display), `TimelineList` (ledger entries), `CheckInButton` (disabled state logic).

- [ ] **T030** 🟡 `[frontend]` Attendance check-in page (SSR): today's check-in status card, check-in button (disabled if already checked in), calendar heatmap of this month's attendance, attendance stats summary (present / late / absent counts).

- [ ] **T031** 🟡 `[frontend]` Personal points dashboard (SSR): current balance card, points earned this month card, points trend chart (ECharts line chart, last 30 days), upcoming auto-issue preview (birthday/holiday bonus countdown).

- [ ] **T032** 🟡 `[frontend]` Points ledger page (SSR): paginated transaction list with columns (date, type, amount±, balance after, remark). Filters: transaction type (issue/deduct/all), date range picker. Page state persisted across navigation (filter + pagination saved in URL params).

- [ ] **T033** 🟢 `[frontend]` Admin attendance management page (SSR): table listing all employees' today status + monthly stats. Manual attendance correction modal (admin only, requires permission key). Department filter dropdown.

---

## Phase 4 — Product Catalog & Exchange Shop (T034–T044)

**Goal:** Products are synced from Amazon. Employees can browse the mall and place exchange orders.

- [ ] **T034** 🟡 `[shop]` Product catalog APIs: `GET /products` (paginated, category + keyword filter), `GET /products/:id`, `POST /admin/products`, `PUT /admin/products/:id`, `PATCH /admin/products/:id/status` (toggle shelf), `PUT /admin/products/:id/stock`. `products` table: title, description, images (JSON), category_id, points_cost, stock, status, source (`manual` | `amazon`).

- [ ] **T035** 🟡 `[thirdparty]` Amazon Product Advertising API integration: `POST /amazon/products/search` — AWS Signature V4 signed request, return normalized `{ asin, title, images, price, category, description }` list. Handle auth, timeout, and rate limit from Amazon's side.

- [ ] **T036** 🟡 `[shop]` Amazon product sync job: Laravel `schedule:run` hourly Artisan command → call BFF → ThirdPartyConnector → Amazon API; upsert products by ASIN; map Amazon price to points cost (configurable conversion rate in `system_configs`); set `source = amazon`. Admin can manually trigger sync via `POST /admin/products/sync`.

- [ ] **T037** 🟡 `[bff]` Product API aggregation: proxy `GET /products`, `GET /products/:id` from Shop; add Redis cache (5 min TTL) on product list to reduce Shop DB load; cache invalidation on product update.

- [ ] **T038** 🟡 `[frontend-base]` Product UI components: `ProductCard` (image, title, points cost, stock badge), `CategoryTabBar`, `ProductGrid` (responsive grid layout), `SkeletonProductCard` (loading state), `EmptyProductList`.

- [ ] **T039** 🟡 `[frontend]` Points mall page (ISR, 5-min revalidate): product grid, category tab filter, keyword search bar, infinite scroll or pagination. Each `ProductCard` links to detail page.

- [ ] **T040** 🟡 `[frontend]` Product detail page (ISR): SSR-safe product data fetch, image gallery, points cost, current stock, "Redeem Now" button (disabled if insufficient balance or out of stock). `generateStaticParams` pre-renders top-100 products.

- [ ] **T041** 🔴 `[shop]` Exchange order lifecycle: `POST /orders` — validate stock, create `orders` row (status: `pending`); `PUT /orders/:id/confirm` → status `confirmed`; `PUT /orders/:id/fulfill` → status `fulfilled`; `PUT /orders/:id/cancel` → restore stock. All status transitions validated (invalid transitions return 422).

- [ ] **T042** 🟡 `[bff]` Order API + points deduction coordination: `POST /orders` flow: (1) call Core to deduct points (transactional), (2) call Shop to create order. If step 2 fails, call Core to reverse the deduction (BFF-level compensating transaction, replacing distributed transaction middleware). Guard: max 1 order submission per user per 30 seconds (rate limiter).

- [ ] **T043** 🟡 `[frontend]` Order pages:
  - Order center (SSR): list of my orders, status badge, filter by status
  - Checkout flow: confirm redeem modal (points balance check, product summary, confirm button)
  - Order detail page: status timeline, product info, timestamps

- [ ] **T044** 🟡 `[frontend]` Admin product management page (SSR): product table with shelf toggle, stock edit inline, sync-from-Amazon button, add/edit product modal (React Hook Form + Zod). Permission-guarded with button-level control.

---

## Phase 5 — File Storage & Notifications (T045–T054)

**Goal:** File uploads work. Employees receive in-app and email notifications for key events.

- [ ] **T045** 🟡 `[message]` Local file storage module: `POST /files/upload` — Multer multipart; save to `./uploads/` with UUID filename; persist metadata to `file_records` table (original_name, stored_name, size, mime_type, uploader_id, created_at). `GET /files/:id` serves file with content-type header and access control.

- [ ] **T046** 🟡 `[thirdparty]` AWS S3 integration: `POST /s3/upload` — stream file to S3 bucket; `GET /s3/presigned-url/:key` — generate 1-hour presigned GET URL; `DELETE /s3/object/:key`. Handle AWS SDK auth and region config. Used for archiving attendance records and monthly report exports (not product images).

- [ ] **T047** 🟡 `[bff]` File upload routing: `POST /upload/image` (≤5 MB, product images) → Message service local storage; `POST /upload/archive` (reports, exports) → ThirdPartyConnector → S3. Return unified `{ fileId, url }` response regardless of storage backend.

- [ ] **T048** 🟡 `[frontend]` Chunked file upload component (from frontend-base): `useChunkedUpload(file, options)` hook — Blob slice (2 MB chunks), sequential POST each chunk to `POST /upload/chunk`, finalize with `POST /upload/merge`. Progress bar, pause/resume, error retry. Used for large attendance archive uploads.

- [ ] **T049** 🟡 `[message]` Internal notification module: `notifications` table (id, employee_id, type, title, body, is_read, created_at). APIs: `GET /notifications` (paginated, unread filter), `GET /notifications/unread-count`, `PATCH /notifications/:id/read`, `PATCH /notifications/read-all`.

- [ ] **T050** 🟡 `[bff]` RabbitMQ event producer: publish domain events after key actions:
  - After `POST /check-in` succeeds → `attendance.checked_in`
  - After order `fulfilled` → `order.fulfilled`
  - After points issued by scheduler → `points.issued`
  Use `direct` exchange, durable queues, persistent messages.

- [ ] **T051** 🟡 `[message]` RabbitMQ consumer: consume events from `attendance.checked_in`, `order.fulfilled`, `points.issued` queues; for each event, insert a notification record with contextual title and body text. Idempotency: skip if notification with same event ID already exists.

- [ ] **T052** 🟡 `[thirdparty]` SendGrid email module: `POST /email/send` — render template (Handlebars), call SendGrid API, log result (success/failure) to `email_logs` table. Templates: birthday bonus, order confirmation, attendance anomaly alert. Async send with 3-attempt retry + exponential backoff.

- [ ] **T053** 🟡 `[bff]` Email trigger wiring: after scheduler issues birthday bonus (from Core) or order is fulfilled, also call ThirdPartyConnector to send corresponding email. BFF orchestrates: DB update → MQ event → email send, keeping business services free of notification concerns.

- [ ] **T054** 🟡 `[frontend]` Notification center UI: bell icon in topbar with unread count badge; dropdown panel showing last 10 notifications with title, time, read/unread state, "mark all read" button. Separate `/notifications` page for full list with pagination.

---

## Phase 6 — Data Dashboard & ETL (T055–T062)

**Goal:** Admin data dashboard is live with real chart data. Reports can be exported as Excel files.

- [ ] **T055** 🔴 `[data]` ETL scheduler and pipeline: `APScheduler` cron (daily at 02:00) → pull last 24 hours of data from Core (attendance, points), Shop (orders), Message (notifications) via BFF internal endpoints; validate, clean (drop nulls, normalize dates), and upsert into `analytics_*` tables in `points_data` DB. Manual trigger: `POST /etl/run`.

- [ ] **T056** 🟡 `[data]` Data cleaning & normalization rules:
  - Unify all timestamps to UTC ISO 8601
  - Normalize employee names: trim whitespace
  - Drop records with `null` employee_id or `null` amount
  - Standardize `order_status` values across Shop and Core schemas

- [ ] **T057** 🟡 `[data]` Sensitive field masking pipeline: before any report generation, apply masking rules: phone `138****8888`, employee ID `1****8`, full name show only surname. Masking is applied at read time (not stored masked), configurable by field type.

- [ ] **T058** 🟡 `[data]` Chart data APIs:
  - `GET /charts/attendance-trend?days=30` — daily check-in counts per day
  - `GET /charts/points-issued?period=monthly` — total points issued per day/week/month
  - `GET /charts/order-volume?period=weekly` — order count + points redeemed per period
  - `GET /charts/top-products?limit=10` — most redeemed products by order count

- [ ] **T059** 🟡 `[data]` Excel report export: `GET /reports/attendance?month=YYYY-MM` → multi-sheet `.xlsx`: Sheet 1: attendance summary per employee (masked); Sheet 2: daily breakdown. `GET /reports/points?month=YYYY-MM` → points ledger export. File streamed as response with `Content-Disposition: attachment` header.

- [ ] **T060** 🟡 `[bff]` Data dashboard API proxy: forward all `/charts/*` and `/reports/*` requests to Data service; add 60-second Redis cache on chart endpoints (charts don't need real-time refresh); cache key includes query params.

- [ ] **T061** 🟡 `[frontend-base]` Chart wrapper components: `LineChart`, `BarChart`, `DonutChart` (thin wrappers over ECharts with consistent theme tokens); `DataTable` with sortable columns and export button; `KPIBanner` (4 stat cards in a row).

- [ ] **T062** 🔴 `[frontend]` Admin data dashboard page (SSR): KPI banner (total employees, points issued this month, orders this month, fulfillment rate); 4 chart panels with date range picker; "Export Report" button downloads Excel from Data service; live data polling every 5 minutes with React Query.

---

## Phase 7 — Performance & Security Hardening (T063–T071)

**Goal:** Redis cache defense in place. Rate limiting active. SQL indexes optimized. Security headers and XSS/CSRF protection complete.

- [ ] **T063** 🟡 `[bff, core]` Redis cache-aside integration for hot data: cache `GET /products` (5 min TTL), `GET /points/balance/:employeeId` (1 min TTL), `GET /menus` (10 min TTL). Invalidate on write. Verify cache hit rate with a simple request log.

- [ ] **T064** 🟡 `[core]` Redis cache three-layer defense:
  - **Penetration**: cache `null` result for 30 seconds when DB returns no record (prevents DB flood for non-existent keys)
  - **Breakdown**: use Redisson `tryLock` before DB query when cache misses on hot keys (prevents stampede)
  - **Avalanche**: add random jitter (±30 s) to all TTL values (prevents synchronized mass expiry)
  Document the approach with comments in code.

- [ ] **T065** 🟡 `[bff]` IP + User-ID rate limiting:
  - `POST /check-in`: max 3 requests / user / 10 min
  - `POST /orders`: max 1 request / user / 30 s
  - `POST /auth/login`: max 10 attempts / IP / 15 min (brute-force protection)
  Use in-memory store backed by Redis for distributed-safe counters.

- [ ] **T066** 🔴 `[core, shop]` SQL slow-query analysis and index optimization:
  - Add composite index on `attendance_records(employee_id, check_date)`
  - Add index on `points_transactions(employee_id, created_at)`
  - Add index on `orders(employee_id, status, created_at)`
  - Add index on `products(category_id, status, points_cost)`
  Run `EXPLAIN ANALYZE` on the top 5 most frequent queries; document results in `.wiki/`.

- [ ] **T067** 🟡 `[core]` Simulated read/write separation: configure two Spring DataSource beans — `primaryDataSource` (write: INSERT/UPDATE/DELETE) and `replicaDataSource` (read: SELECT). Route using a `AbstractRoutingDataSource` implementation. No actual DB replication — same DB, demonstrates the pattern.

- [ ] **T068** 🟡 `[bff]` Security headers and request hardening: add `helmet` (sets `Content-Security-Policy`, `X-Frame-Options`, `X-Content-Type-Options`); enforce request body size limit (10 MB); sanitize and strip unexpected fields from request bodies using class-transformer `excludeExtraneousValues`.

- [ ] **T069** 🟡 `[frontend-base]` XSS defense: HTML content escaping utility (`escapeHtml(str)`); CSP nonce injection helper for `<script>` tags; `dangerouslySetInnerHTML` usage audit — replace all unescaped instances with safe alternatives. CSRF: auto-inject `X-CSRF-Token` header from cookie in Axios interceptor.

- [ ] **T070** 🟡 `[frontend]` Sensitive data masking in UI: phone numbers, employee IDs, and names displayed through `maskSensitive(str)` helper from frontend-base. Admin pages only show full data when user has `VIEW_SENSITIVE` permission key. Test: verify masked display in report tables.

- [ ] **T071** 🟡 `[frontend]` Global canvas watermark + admin page protection: inject transparent watermark (current user email + timestamp) on all admin pages using a canvas overlay component. `position: fixed` overlay, pointer-events-none, survives DOM manipulation. From frontend-base.

---

## Phase 8 — Frontend Engineering Polish (T072–T081)

**Goal:** Component library published to NPM. Storybook live. Rendering strategies differentiated. Tests written. Advanced UX features added.

- [ ] **T072** 🟡 `[frontend-base]` Rollup build finalization: ESM + CJS dual output; tree-shakeable exports; TypeScript declaration files (`.d.ts`) generated alongside each module; `sideEffects: false` in package.json; verify `pnpm build` produces correct `dist/` structure with no circular dependency warnings.

- [ ] **T073** 🟡 `[frontend-base]` Storybook 8 setup: one Story file per exported component; interactive prop controls (`argTypes`); dark/light theme switcher; usage code snippet panel; accessibility addon. Deploy Storybook to GitHub Pages via Actions.

- [ ] **T074** 🟢 `[frontend-base]` Publish to NPM: finalize `package.json` (`exports`, `files`, `peerDependencies`); semantic version `1.0.0`; `npm publish --access public`. Update `points-mall-frontend` to install from NPM (remove `pnpm link`). Verify the import works in frontend.

- [ ] **T075** 🟡 `[frontend]` SSG / ISR / SSR rendering strategy differentiation:
  - `/(marketing)` landing pages → SSG (`generateStaticParams` + no `revalidate`)
  - `/mall` product list → ISR (`revalidate: 300`)
  - `/mall/[id]` product detail → ISR (`revalidate: 300`, `generateStaticParams` for top 100)
  - `/dashboard`, `/points`, `/orders` → SSR (dynamic, auth-gated)
  - `/attendance` → SSR

- [ ] **T076** 🟡 `[frontend]` Full SEO upgrade:
  - Static Metadata on layout files
  - Dynamic `generateMetadata` on product detail and employee-specific pages
  - OpenGraph + Twitter card tags
  - `sitemap.ts` auto-generated sitemap
  - `robots.ts` robots configuration
  - JSON-LD structured data on product detail pages (`Product` schema)

- [ ] **T077** 🟡 `[frontend-base]` Vitest unit tests: cover `maskSensitive`, `formatCurrency`, `formatDate`, `escapeHtml` utilities; `usePermission` hook; `useAuth` store actions; `StatsCard` component renders correct value. Aim for >80% coverage on `src/utils/` and `src/hooks/`.

- [ ] **T078** 🔴 `[frontend]` Playwright E2E tests (core user journeys):
  - `auth.spec.ts`: email login → redirect to dashboard; logout clears session
  - `permissions.spec.ts`: employee cannot access admin routes (should see 403)
  - `attendance.spec.ts`: check-in → button becomes disabled → refresh → stays disabled
  - `shop.spec.ts`: browse mall → open product → click redeem → see order in order center

- [ ] **T079** 🟡 `[frontend]` Advanced UX features batch:
  - `driver.js` onboarding tour: auto-triggers on first login, highlights sidebar, check-in button, mall link; can be re-triggered from profile menu
  - Table column customization: show/hide columns, column width drag; saved to `localStorage` per table key via `useTableConfig()` from frontend-base
  - Page state persistence: `usePageState()` saves search + filters + pagination in URL params; survives browser back navigation

- [ ] **T080** 🟢 `[frontend]` Form + request safeguards: `useDebounce` on search inputs (300 ms); prevent duplicate form submission with `isSubmitting` state lock; global button throttle wrapper component in frontend-base; `AbortController` on React Query fetch to cancel in-flight requests on unmount.

- [ ] **T081** 🟡 `[all]` API documentation finalization: BFF Swagger at `/api-docs` has all endpoints documented with request/response schemas and error codes; export `bff-api.yaml` to `.wiki/api/`; Core SpringDoc at `/v3/api-docs`; Data FastAPI at `/docs`. All specs committed and browsable.

---

## Phase 9 — Overseas & i18n (T082–T088)

**Goal:** System works correctly for overseas users: bilingual UI, timezone handling, GDPR compliance, Safari compatibility.

- [ ] **T082** 🟡 `[frontend-base, frontend]` next-intl i18n setup: `en` and `zh` locale files covering all static UI text (buttons, labels, empty states, error messages, form hints); zero hardcoded Chinese strings in source code; locale switcher in topbar.

- [ ] **T083** 🟡 `[frontend]` Timezone auto-adaptation: detect user timezone with `Intl.DateTimeFormat().resolvedOptions().timeZone` on first load; store in `useConfigStore`; all date/time display passed through `formatDate(utcDate, userTimezone)` from frontend-base; DB and API always use UTC.

- [ ] **T084** 🟢 `[frontend]` Multi-currency display: `formatCurrency(amount, currencyCode, locale)` formats with correct symbol, thousand separators, and decimal places per locale (`en-US` → `$1,234.56`, `zh-CN` → `¥1,234.56`, `de-DE` → `1.234,56 €`). Points costs shown in points, monetary values in user-locale currency.

- [ ] **T085** 🟡 `[frontend]` GDPR compliance:
  - Cookie consent banner on first visit: "Accept All" / "Essentials Only" / "Manage Preferences"
  - Before `essentials` consent: block localStorage analytics writes and埋点 event sends
  - Privacy policy page (`/privacy`)
  - "Delete my data" form on profile settings page (placeholder that sends email to admin)
  - All consent choices stored in `consent` cookie, respect on every page load

- [ ] **T086** 🟡 `[frontend]` Safari-specific compatibility fixes:
  - CSS: replace `gap` with explicit margin fallbacks for Safari 14; fix `position: sticky` inside `overflow: hidden`
  - Cookie: add `SameSite=None; Secure` to all cookies served over HTTPS; test JWT cookie in Safari private mode
  - Date: replace `new Date('YYYY-MM-DD')` with `new Date('YYYY/MM/DD')` or date-fns parsing (Safari doesn't parse ISO dash dates reliably)
  - Flexbox: add `-webkit-` prefixes for older Safari flex properties via PostCSS

- [ ] **T087** 🟡 `[frontend]` Weak network handling: separate timeout config by scenario (`NEXT_PUBLIC_NETWORK_REGION=global` → 15 s timeout, 3 retries with 1/2/4 s backoff; `domestic` → 8 s, 2 retries). Friendly offline banner when all retries fail. API fallback data (from frontend-base interceptor, T009) shown for critical pages.

- [ ] **T088** 🟢 `[all services]` Internationalized error messages: BFF maps all internal error codes to English-language user-facing messages in an `errorMessages.ts` constant; no raw stack traces or internal error details leak to frontend. Frontend `i18n` maps BFF error codes to locale-specific display strings.

---

## Phase 10 — DevOps & Final Polish (T089–T096)

**Goal:** All services are containerized, CI/CD pipeline is live, and the full demo is accessible online without local setup.

- [ ] **T089** 🔴 `[all]` Docker multi-stage Dockerfiles for all 8 services:
  - `frontend`: Node builder → nginx static serve stage
  - `frontend-base`: build-only (no runtime container needed)
  - `bff`: Node builder → production runner stage
  - `core`: Maven build → JRE slim runtime stage
  - `shop`: Composer install → PHP-FPM + nginx stage
  - `message`: Node builder → production runner stage
  - `data`: Python dependencies → uvicorn runner stage
  - `thirdparty`: Node builder → production runner stage

- [ ] **T090** 🟡 `[all]` `docker-compose.yml` for full local dev stack: all 8 application services + `postgres:15` (two DB instances or schemas) + `redis:7-alpine` + `rabbitmq:3-management` + `keycloak:24` (SSO IdP for local dev, `start-dev` mode, port 8080); health checks and `depends_on` on all services; `.env.docker` override file; verify `docker-compose up -d` brings entire stack up cleanly.

- [x] **T091** 🟡 `[all]` GitHub Actions CI workflow (`.github/workflows/ci.yml`): triggers on PR to `main`; jobs run in parallel per service:
  - frontend/bff/message/thirdparty: `pnpm lint && pnpm typecheck && pnpm test`
  - core: `mvn verify`
  - shop: `composer test`
  - data: `pytest`
  PR is blocked from merging until all jobs pass.

- [x] **T092** 🟡 `[all]` GitHub Actions CD workflow (`.github/workflows/deploy.yml`): triggers on merge to `main`; build Docker images for all services; push to GitHub Container Registry (GHCR); SSH deploy to cloud VPS (or Render/Railway): pull latest images, `docker-compose pull && docker-compose up -d --no-build`. Zero-downtime: rolling restart per service.

- [ ] **T093** 🟡 `[all services]` Upgrade health check endpoints (T004 baseline) to full connectivity checks: `GET /health` returns `{ status: "ok"|"degraded", db: "ok"|"error", redis: "ok"|"error", mq: "ok"|"error", uptime_seconds }`. Returns HTTP 200 if `status=ok`, HTTP 503 if `status=degraded`.

- [ ] **T094** 🟢 `[frontend]` Lightweight service status dashboard page (`/admin/system/health`): frontend polls all 7 backend `/health` endpoints every 30 seconds via BFF aggregation; displays a grid of service cards with green/red status indicator, last-check time, and uptime. No Prometheus/Grafana — pure frontend polling.

- [ ] **T095** 🟡 `[all]` Environment variable audit and security review:
  - Verify `.env.example` is up to date for every service (all required vars documented)
  - Confirm no secrets appear in Git history (`git log -S "SECRET"`)
  - Verify all HTTPS endpoints in production; HTTP redirects to HTTPS
  - Review CORS origins (BFF should only allow frontend domain in production)
  - Review `Content-Security-Policy` header (no `unsafe-inline` for scripts)

- [ ] **T096** 🔴 `[all]` End-to-end demo run — full user journey verification:
  1. Employee logs in (email + GitHub OAuth both tested)
  2. Check-in → points issued automatically (verify in ledger)
  3. Browse mall → redeem product → receive in-app + email notification
  4. Admin: view dashboard charts → export attendance report (desensitized Excel)
  5. Admin: manage menu config → verify frontend sidebar updates without redeploy
  6. Trigger ETL manually → verify chart data refreshes
  7. Verify Swagger docs, Storybook, and all health endpoints accessible at production URL
  8. Run Playwright E2E suite against production URL → all pass

---

## Summary

| Phase | Tasks | Focus |
|-------|-------|-------|
| 0 — Scaffolding | T001–T005 | All services initialized and runnable |
| 1 — Auth | T006–T015, T097–T099 | JWT, GitHub OAuth, OIDC SSO, token lifecycle |
| 2 — Permissions | T016–T022 | RBAC end-to-end, dynamic menus |
| 3 — Attendance & Points | T023–T033 | Core business logic, scheduled jobs |
| 4 — Shop | T034–T044 | Product catalog, Amazon sync, orders |
| 5 — Files & Notifications | T045–T054 | Upload, MQ, in-app notifications, email |
| 6 — Data Dashboard | T055–T062 | ETL pipeline, charts, Excel export |
| 7 — Performance & Security | T063–T071 | Redis defense, rate limit, SQL indexes, XSS/CSRF |
| 8 — Engineering Polish | T072–T081 | NPM publish, Storybook, tests, advanced UX |
| 9 — Overseas & i18n | T082–T088 | i18n, timezone, GDPR, Safari compat |
| 10 — DevOps | T089–T096 | Docker, CI/CD, monitoring, demo run |
| **Total** | **99 tasks** | **~3–4 months at 1 task/day** |
