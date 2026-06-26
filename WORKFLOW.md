# AI-Driven Full-Stack Development Workflow v1.0

> This document is the AI's operating manual. For the human collaboration guide, see `HUMAN-GUIDE.md`.

---

## Core Design Principles

This project is developed with full AI assistance and follows the principles below — none may be violated:

| Principle | Description |
|-----------|-------------|
| **Full-Stack Ownership Per Task** | Each task is completed end-to-end by one person (frontend + BFF + backend). A single task may touch multiple repos, eliminating handoff delays between frontend and backend |
| **Wiki as Knowledge Hub** | `.wiki/` is the project's single source of truth, replacing Confluence/Notion. All feature designs, API contracts, and database schemas are archived here |
| **Spec First** | Every feature must have a corresponding Spec before development begins. AI must not implement anything not defined in the Spec |
| **Humans Own Business Spec Only** | Humans are responsible only for the correctness of business requirements (Spec), not code quality. Code quality is enforced by test coverage and CI |
| **Explicit State Ownership** | Every state transition has a clear owner: humans handle requirement-confirmation nodes (`spec-pending` / `spec-ready` / `closed`); AI handles development nodes (`in-dev` / `dev-done`); scripts handle test nodes (`test-fail` / `test-pass`). Out-of-role changes are prohibited |
| **Traceability** | Every task retains a complete status-change history. Existing history records must never be deleted |
| **Tests as Delivery Gate** | `dev-done` does not mean done. A task must pass `test:task` before transitioning to `test-pass`. Tests are the final delivery gate |

---

## Directory Structure

```
fullstack-points-mall/
├── WORKFLOW.md                        # This file: master workflow spec (required reading)
│
├── .tasks/                            # Task management hub (replacing Jira)
│   ├── _index.md                      # Task overview index (auto-rebuilt by script, do not edit)
│   ├── _templates/
│   │   └── task-template.md           # Task file template
│   ├── infra/                         # Phase 0 — Scaffolding & infrastructure tasks
│   ├── auth/                          # Phase 1 — Auth foundation tasks
│   ├── perm/                          # Phase 2 — Permission system tasks
│   ├── attend/                        # Phase 3 — Attendance & points core tasks
│   ├── shop/                          # Phase 4 — Product catalog & exchange shop tasks
│   ├── notify/                        # Phase 5 — File storage & notifications tasks
│   ├── data/                          # Phase 6 — Data dashboard & ETL tasks
│   ├── perf/                          # Phase 7 — Performance & security tasks
│   ├── fe/                            # Phase 8 — Frontend engineering tasks
│   ├── i18n/                          # Phase 9 — Overseas & i18n tasks
│   └── devops/                        # Phase 10 — DevOps & final polish tasks
│
├── .wiki/                             # Project knowledge base (replacing Confluence/Notion)
│   ├── README.md                      # Wiki writing guidelines
│   ├── features/                      # Feature specs (business scenarios, organized by Task domain)
│   │   ├── auth.md                    # TASK-AUTH: auth & authorization
│   │   ├── points.md                  # TASK-POINTS: points system
│   │   ├── shop.md                    # TASK-SHOP: shop & orders
│   │   ├── attendance.md              # TASK-ATTEND: attendance management
│   │   ├── notifications.md           # TASK-NOTIFY: notifications
│   │   ├── data.md                    # TASK-DATA: data export & analytics reports
│   │   └── system.md                  # TASK-SYS: system config & admin dashboard
│   ├── api/                           # OpenAPI 3.0 specs (the only authoritative API contracts)
│   │   ├── bff-api.yaml               # BFF external API (the only interface layer for frontend)
│   │   ├── core-internal.yaml         # Java service internal API
│   │   ├── shop-internal.yaml         # PHP service internal API
│   │   ├── message-internal.yaml      # Node message service internal API
│   │   ├── data-internal.yaml         # Python data service internal API
│   │   └── thirdparty-internal.yaml   # ThirdParty connector internal API
│   ├── db/                            # Database schema specs
│   │   ├── core-schema.md             # Java service database table structures
│   │   └── shop-schema.md             # PHP service database table structures
│
├── .github/                           # GitHub team collaboration constraints (code-tracked)
│   ├── CODEOWNERS                     # File ownership — auto-assigns PR reviewers
│   ├── pull_request_template.md       # PR template — requires linked TASK ID
│   └── workflows/
│       ├── ci.yml                     # Triggered on PR: lint + type-check + tests
│       └── deploy.yml                 # Triggered on merge: auto-deploy
│
├── .tests/                            # Test suites
│   ├── api/                           # Bruno API test collections (organized by service)
│   │   ├── bff/
│   │   │   ├── auth/
│   │   │   ├── points/
│   │   │   └── shop/
│   │   └── bruno.json                 # Bruno environment config
│   ├── e2e/                           # Playwright E2E tests
│   │   ├── auth.spec.ts
│   │   ├── permissions.spec.ts
│   │   └── shop.spec.ts
│   └── scripts/
│       ├── run-task-tests.js          # Script to run tests by task ID
│       ├── tasks-sync.js              # Rebuilds .tasks/_index.md index
│       └── check-spec-consistency.js  # Spec-to-code consistency checker
│
├── points-mall-frontend/
├── points-mall-bff/
├── points-mall-core/
├── points-mall-shop/
├── points-mall-message/
├── points-mall-data/
└── points-mall-thirdparty-connector/
```

---

## AI Development Workflow

> **Global rule:** Every time task status changes, append a record to the Status Change History
> table in the task file. Steps that auto-update status (Step 9 script) are exempt — the script
> handles it. All other status changes require a manual entry.

```
Step 1   Create a task file in the matching domain subfolder under .tasks/
          using .tasks/_templates/task-template.md as the starting point
          (e.g. .tasks/auth/TASK-AUTH-0001.md, .tasks/shop/TASK-SHOP-0001.md)
          - Fill only the fields marked "Step 1" in the template
          - All other fields are filled progressively as the task advances through later steps
         ↓
Step 2   Convert raw requirements into a Spec and draft Acceptance Criteria:
          - Fill the [Spec] section in the task file with detailed technical decisions
          - Fill the [Acceptance Criteria] section with a numbered checklist derived from the Spec
            (AI-generated draft: cover happy path, error cases, edge cases, and security constraints)
          - Clarify any ambiguities with the human before proceeding
          - status → spec-pending
         ↓
Step 3   ⚠️ Wait for human to confirm the Spec + Acceptance Criteria.
          Human may edit individual AC items, add missing scenarios, or reject and request a rewrite.
          Once human explicitly confirms (e.g. "AC confirmed"), AI updates:
          - status → spec-ready
         ↓
Step 4   Implement code based on the [Spec] section.
          - status → in-dev
         ↓
Step 5   Write test files item by item, following the [Acceptance Criteria] —
          AI implements exactly what is listed in the acceptance criteria, no more, no less
          - Unit tests (*.test.ts): in __tests__/ under the same directory as the source file
          - API tests (*.bru): in the corresponding directory under .tests/api/bff/
          - E2E tests (*.spec.ts): under .tests/e2e/ (may be added after dev-done)
         ↓
Step 6   Self-check against acceptance criteria item by item
          - If wiki_refs is empty (new feature, no prior spec): check against AC only
          - If wiki_refs is filled (implementing an existing wiki spec): also cross-check against
            the referenced wiki file to catch any divergence from the canonical design
         ↓
Step 7   Update the task file:
          - Fill all fields marked "Step 7" in the template (services, code_files, test_refs)
          - status → dev-done
         ↓
Step 8   Run `pnpm run tasks:sync` to refresh `.tasks/_index.md`
         ↓
Step 9   Run `pnpm run test:task TASK-XXX --update-status`
          - All pass → status auto-updates to test-pass
          - Any failure → status updates to test-fail, fix and retry from Step 4
         ↓
Step 10  Archive Spec to wiki before opening the PR:
          - Append the task's [Spec] section to the corresponding `.wiki/features/<domain>.md`
            (if the domain file already exists; otherwise create a new file)
          - Fill in `wiki_refs` in the task file (e.g. `wiki_refs: [.wiki/features/auth.md]`)
          - Increment the wiki file's version and append a row to its Change Log
          - Keep the [Spec] section in the task file (it records original rationale — do not delete)
          - Commit: `docs(TASK-XXX): archive spec to wiki`
         ↓
Step 11  ⚠️ Human closes after production verification:
          - Deployed to target environment without errors
          - E2E smoke test passes (or manual walkthrough confirms core flows work)
          - status → closed
          Note: closed is permanent. If a bug is found later, open a new task with
          depends_on pointing to this one — do not reopen a closed task.
```

### Mid-Task Spec Amendment Process

Applies when a **technology or design decision changes after `in-dev` has started** but before
`dev-done`. This is distinct from a post-merge Spec change (which triggers the cascade detection
described in the Spec-to-Code Consistency Mechanism). Examples: switching a framework, changing a port, replacing a library.

```
Issue is identified (by any party):
  ├─ AI self-identifies a Spec inconsistency mid-implementation
  ├─ Human raises a change request during development
  └─ Reviewer raises a Spec issue during PR review
    ↓
⚠️  Code is reverted FIRST — before any Spec discussion begins:
  - AI finds it   → AI reverts immediately, then reports to Human
  - Reviewer finds it → requests developer to revert;
                        further development is blocked until revert is confirmed
    ↓
AI updates the [Spec] section in the task file:
  - Edit the affected technical decision
  - Add a ⚠️ amendment notice at the top of the Spec section with: date / what changed / why
    ↓
Human reviews the updated Spec → confirms or rejects
  ├─ Rejected → restore original Spec, resume from Step 4 with original Spec
  └─ Confirmed → AI re-implements based on updated Spec
    ↓
AI appends a record to Status Change History:
  | <date> | in-dev | in-dev | Human | Spec amended: <summary of change> |
    ↓
Continue from Step 4 with updated Spec as the source of truth
```

**Key rules:**
- **Revert first.** Code must be reverted before Spec discussion begins — this prevents the Spec
  from being unconsciously pulled toward code that already exists.
- **Spec is always the source of truth.** Code is never the source of truth, even temporarily.
  The amendment must be recorded in the task file before any new code is written.

### AI Git Commit Convention

```
feat(TASK-AUTH-0001): implement Axios request/response interceptors

- Request: inject Token, prepend baseURL, append timestamp
- Response: unwrap data, unified 401/403 handling
- Fallback: return static fallback data on API failure

Wiki: .wiki/features/auth.md
```

Format: `<type>(TASK-ID): <summary>`. Use `feat / fix / refactor / test / docs` for type.

### Parallel Task Development Rules

- Each task is completed end-to-end by one person independently — no frontend/backend handoff needed
- Only one task is developed at a time (a task may span multiple repos; avoid cross-task code conflicts)
- Tasks with dependencies must be developed in dependency order (declared via the `depends_on` field)

---

## Task Management Conventions

### Task Status Flow

```
Raw requirements input (natural language)
    ↓ AI converts
draft ──→ spec-pending ──→ spec-ready ──→ in-dev ──→ dev-done ──→ test-pass ──→ closed
                                               │
                                           test-fail ──→ in-dev (loop)
```

| Status | Meaning | Triggered By |
|--------|---------|--------------|
| `draft` | Raw requirements converted into a structured TASK file, awaiting human confirmation | AI when converting raw requirements |
| `spec-pending` | AI has generated Spec + draft Acceptance Criteria; awaiting human review and approval | AI after generating Spec and draft AC |
| `spec-ready` | Human has reviewed and approved the Spec and Acceptance Criteria (with edits if needed); development may begin | Human after confirming |
| `in-dev` | Developer (AI or human) is implementing; feature branch opened | Developer when starting work |
| `dev-done` | Implementation complete, PR opened, awaiting CI and code review | Developer after opening PR |
| `test-fail` | CI tests did not pass, fix required | CI / `test:task` script (automated) |
| `test-pass` | CI fully green, PR merged | Auto-updated after merge |
| `closed` | Task fully closed and archived | Human after confirming |

> **Special rule**: When a file in `.wiki/` is modified and merged, CI automatically scans all tasks with `dev-done` / `test-pass` status that reference that Spec in `wiki_refs`, downgrades their status to `spec-ready`, and notifies the `assignee` to re-implement.

### Task ID Naming Convention

**Format: `TASK-<DOMAIN>-<SEQNO>`**

| Prefix | Business Domain |
|--------|----------------|
| `TASK-AUTH` | Auth & authorization (login, tokens, permissions) |
| `TASK-POINTS` | Points system (issuance, consumption, ledger) |
| `TASK-SHOP` | Shop & orders (products, cart, checkout) |
| `TASK-ATTEND` | Attendance management |
| `TASK-NOTIFY` | Notifications |
| `TASK-DATA` | Data export & analytics reports |
| `TASK-SYS` | System config & admin dashboard |
| `TASK-INFRA` | Infrastructure (CI/CD, shared components, scaffolding) |

Sequence numbers start at `0001` and increment; IDs of deleted tasks must not be reused.


### Task Overview Index

`.tasks/_index.md` is rebuilt by `pnpm run tasks:sync` and must not be edited directly by AI or humans. AI runs this command explicitly at Step 8 (after marking `dev-done`); the `test:task` script in Step 9 also calls it automatically when `--update-status` is used.

---

## Wiki Conventions

> For field definitions, format rules, and complete examples for each document type, see [`.wiki/README.md`](.wiki/README.md).

### API Documentation Rules (AI must follow)

**`bff-api.yaml` is the only API contract that frontend references.** When developing the BFF, AI must:
- Implement only the interface paths already defined in `bff-api.yaml`
- Request parameters, response format, and HTTP status codes must exactly match the Spec
- New interfaces must be added to `bff-api.yaml` before writing implementation code

---

## Spec-to-Code Consistency Mechanism

This is the core safety mechanism of the workflow — it ensures "code written by AI must be consistent with the Spec."

### Three-Layer Consistency Check

#### Level 1 — AI self-check (Step 6 of the AI Development Workflow)

See Step 6 in the AI Development Workflow above.

#### Level 2 — API compliance check script (optional, run before each commit)

```bash
# Check whether BFF actual routes match the OpenAPI Spec
pnpm run check:spec-api
```

Script logic:
1. Scan all Controller annotations in `points-mall-bff/` to extract route paths and methods
2. Read all paths defined in `.wiki/api/bff-api.yaml`
3. Output three categories of differences:
   - 🔴 **In code only (not in Spec)**: violation — must be removed or added to Spec
   - 🟡 **In Spec only (not in code)**: pending development
   - 🟢 **Consistent on both sides**: compliant

#### Level 3 — Spec change cascade detection (triggered by Git Hook)

When changes to the `.wiki/` directory are detected via `.git/hooks/post-commit` or CI:

1. Extract the list of modified Spec files from the current commit
2. Scan all `.tasks/**/*.md` for tasks whose `wiki_refs` include those files
3. Automatically downgrade those tasks' status to `spec-ready` (preserving the previous status in history)
4. Output the list of affected tasks and prompt AI to re-implement

### AI Prohibited Actions

Under no circumstances may AI perform the following:

- ❌ Implement interfaces or features not defined in the Spec
- ❌ Modify an interface's request parameters or response format without updating the Spec first
- ❌ Skip acceptance criteria and directly mark `dev-done`
- ❌ Delete or overwrite a task's status change history
- ❌ Manually edit `.tasks/_index.md` (may only be generated by scripts)

---

## Testing Conventions

### Test Layer Overview

| Layer | Tool | Scope | Format / Reference |
|-------|------|-------|--------------------|
| Unit tests | Vitest | Utility functions, business hooks, shared component logic | `__tests__/` in the same directory as the source file |
| API integration tests | Bruno CLI | All request/response/status-code behaviors of BFF external APIs | See [.tests/api/README.md](.tests/api/README.md) |
| UI / E2E tests | Playwright | Core user journeys (full browser flow) | See [.tests/e2e/README.md](.tests/e2e/README.md) |

### Unit Test Conventions (Vitest)

Each acceptance criterion must have at least one corresponding test case. Coverage scope: utility functions, data formatting, permission-check methods, basic rendering of shared components.

### API Integration Test Conventions (Bruno)

> For file format and environment config examples, see [`.tests/api/README.md`](.tests/api/README.md).

Each endpoint must cover at minimum: happy path + auth failure (401) + bad request (400).

### UI / E2E Test Conventions (Playwright)

> For file format and run commands, see [`.tests/e2e/README.md`](.tests/e2e/README.md).

#### `data-testid` Selector Convention

**E2E tests must use `data-testid` to locate elements. Using text content, CSS class names, or DOM path selectors is prohibited.**

| Selector | Allowed | Reason |
|----------|---------|--------|
| `[data-testid=login-submit]` | ✅ Recommended | Semantic, survives text/style changes |
| `button:has-text("Login")` | ❌ Prohibited | Breaks when copy changes |
| `.btn-primary` | ❌ Prohibited | Breaks when styles are refactored |
| `form > div:nth-child(2) > button` | ❌ Prohibited | Breaks when structure changes |

**Naming convention**: `<page/module>-<element-semantics>`, all lowercase, hyphen-separated. Examples: `login-submit`, `user-name`, `points-balance`.

**AI responsibility**: For elements where the Spec defines a `data-testid`, the attribute must be added to the corresponding DOM node during implementation — it must not be omitted.

### Task Test Commands

`test:task` script execution logic:

```
1. Parse the test_refs field from the specified task file
2. Group by test type:
   - *.test.ts → Vitest
   - *.bru → Bruno CLI
   - *.spec.ts (under .tests/e2e/) → Playwright
3. Run each test type in parallel
4. Aggregate output: pass count / fail count / failure details per task
5. If --update-status:
   - All pass → task status updated to test-pass, history record appended
   - Any failure → task status updated to test-fail, failure summary attached to task file
6. Rebuild .tasks/_index.md
```

---

## Multi-Environment Configuration

| Environment | Description | Trigger |
|-------------|-------------|---------|
| `dev` | Local development — all services run locally | `pnpm dev` |
| `test` | Test environment — CI auto-deploys | PR merged to `dev` branch |
| `prod` | Production environment | Merged to `main` branch, then manually triggered |

Environment variable files for each service live in the service root: `.env.dev`, `.env.test`, `.env.prod`.  
**Committing any `.env.*` file to Git is prohibited** (already excluded in `.gitignore`).

> **Note:** Bruno API test environments use a separate naming convention (`local` / `staging`) that
> maps to deployment targets, not application profiles. These are two independent dimensions.

---

## CI/CD Pipeline (GitHub Actions)

```yaml
# Trigger: Push to dev/main branch, or PR
on: [push, pull_request]

jobs:
  spec-check:       # Detect Spec changes and auto-downgrade affected tasks
  lint-typecheck:   # ESLint + TypeScript type checking
  unit-test:        # Vitest unit tests
  api-test:         # Bruno CLI API tests (staging environment)
  e2e-test:         # Playwright E2E tests (staging environment)
  build:            # Docker image build for each service
  deploy-staging:   # Auto-deploy to Staging (dev branch only)
  deploy-prod:      # Deploy to Production after manual approval (main branch only)
```

---

## Quick Reference

| Command | Description |
|---------|-------------|
| `pnpm run tasks:list` | View status overview of all tasks |
| `pnpm run tasks:list --status=dev-done` | Filter dev-done tasks |
| `pnpm run tasks:view TASK-AUTH-0001` | View a single task's details |
| `pnpm run test:task TASK-AUTH-0001` | Run tests for a specific task |
| `pnpm run test:task --status=dev-done` | Run tests for all dev-done tasks |
| `pnpm run test:task --status=dev-done --update-status` | Run tests and auto-update status |
| `pnpm run tasks:sync` | Rebuild `.tasks/_index.md` index (run after task status changes) |
| `pnpm run check:spec-api` | Check BFF API code vs. Spec consistency |
| `bru run .tests/api/bff/ --env local` | Run Bruno API test collection directly |
| `npx playwright test .tests/e2e/` | Run Playwright E2E tests directly |

---

## Team Collaboration Constraints

This section describes hard constraints that apply to **all team members** (including AI). They are enforced via native GitHub features and **cannot be bypassed**.

### Constraint Layer Overview

| Layer | Mechanism | Bypassable | Constraint |
|-------|-----------|------------|------------|
| 1 | WORKFLOW.md documentation | ✅ Yes, by discipline | Development guideline |
| 2 | Husky `commit-msg` hook | ⚠️ `--no-verify` can bypass | Commit message format |
| 3 | GitHub Branch Protection | ❌ No | Direct push prohibited, must go through PR |
| 4 | CODEOWNERS + Required Review | ❌ No | Spec/core file changes require designated approver |
| 5 | Required CI Checks | ❌ No | Cannot merge if tests fail |

### Branch Protection Configuration (must be enabled manually in GitHub Settings)

```
Settings → Branches → Add rule

Branch name pattern: main
✅ Require a pull request before merging
  ✅ Require approvals: 1
  ✅ Dismiss stale pull request approvals when new commits are pushed
  ✅ Require review from Code Owners        ← key: CODEOWNERS owners must approve
✅ Require status checks to pass before merging
  ✅ Require branches to be up to date before merging
  Required checks (all CI jobs must pass before merge):
    - ci / lint-typecheck
    - ci / unit-tests
    - ci / api-tests
    - ci / spec-consistency
✅ Restrict who can push to matching branches (only allow designated users to push directly)
✅ Include administrators                   ← repo owner is not exempt

Branch name pattern: dev
✅ Require a pull request before merging
  ✅ Require approvals: 1
✅ Require status checks to pass before merging
  Required checks: (same as above)
```

**Spec PRs and business-code PRs must be submitted separately** to prevent reviewers from overlooking Spec changes in a large PR.

