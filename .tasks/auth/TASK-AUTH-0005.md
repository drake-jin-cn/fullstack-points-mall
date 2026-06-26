---
id: TASK-AUTH-0005
title: "AppShell layout component for @points-mall/frontend-base (T100)"
status: test-pass
priority: high
services:
  - frontend-base
assignee: ""
created: 2026-06-26
updated: 2026-06-26
depends_on: []
wiki_refs:
  - .wiki/features/auth.md
code_files:
  - points-mall-frontend-base/src/types/menu.ts
  - points-mall-frontend-base/src/css.d.ts
  - points-mall-frontend-base/src/components/AppShell/AppShell.tsx
  - points-mall-frontend-base/src/components/AppShell/AppShell.module.css
  - points-mall-frontend-base/src/components/AppShell/Sidebar.tsx
  - points-mall-frontend-base/src/components/AppShell/Sidebar.module.css
  - points-mall-frontend-base/src/components/AppShell/Header.tsx
  - points-mall-frontend-base/src/components/AppShell/Header.module.css
  - points-mall-frontend-base/src/components/AppShell/Breadcrumb.tsx
  - points-mall-frontend-base/src/components/AppShell/Breadcrumb.module.css
  - points-mall-frontend-base/src/components/AppShell/index.ts
  - points-mall-frontend-base/src/index.ts
  - points-mall-frontend-base/rollup.config.mjs
  - points-mall-frontend-base/package.json
  - points-mall-frontend-base/vitest.config.ts
  - points-mall-frontend-base/src/test-setup.ts
test_refs:
  - points-mall-frontend-base/src/components/AppShell/__tests__/AppShell.test.tsx
---

## Raw Requirements

`[frontend-base]` AppShell layout component: collapsible left Sidebar (240 px expanded / 64 px
icon-only with tooltip, `localStorage` persists state), top Header (logo + product title on left;
avatar dropdown with profile/logout + notification bell on right), auto-computed Breadcrumb from
`menuItems[]` + current `pathname`. All data (menuItems, user, notificationCount, callbacks) are
injected as props — the component makes no API calls. Hardcoded default styles (dark sidebar
`#001529`, white header); consumers override via semantic CSS classes (`.pm-sidebar`, `.pm-header`).
Zero runtime dependencies beyond React; styles use CSS Modules bundled by Rollup.

## Spec

Full design doc: `docs/superpowers/specs/2026-06-26-frontend-base-appshell-design.md`

### Background

`frontend-base` is a shared npm package (`@points-mall/frontend-base`) reused by multiple teams.
HTTP infrastructure (T009, T011) was moved out of this package — each team has its own BFF with
different API conventions, so sharing HTTP code provides no reuse value. The genuinely reusable
piece is the application shell: every team needs the same navigation frame.

### Goals

1. `AppShell` component with collapsible Sidebar, fixed Header, auto-computed Breadcrumb.
2. 100% props-driven — no API calls inside the component.
3. Collapsible sidebar (240 px / 64 px), animated transition, state persisted in `localStorage`.
4. Header: logo + title (left), notification bell + user avatar dropdown (right).
5. Breadcrumb: auto-computed from `menuItems` tree + current pathname.
6. Default professional dark-sidebar style; consumers override via `.pm-sidebar` / `.pm-header` CSS classes.
7. Zero runtime deps beyond React; CSS Modules bundled by Rollup.

### Out of Scope

- Axios / HTTP client setup (belongs to each consuming app).
- Silent token refresh (belongs to each consuming app).
- User profile page content.
- i18n / theme switching.

### Technical Design

**Component tree:**
```
AppShell
├── Sidebar (240px / 64px, collapse toggle at bottom)
│   ├── SidebarHeader (logo + title, hidden when collapsed)
│   └── SidebarMenu (recursive, icon+label / icon-only+tooltip)
├── Header (fixed top, z-50)
│   ├── HeaderLeft (Breadcrumb)
│   └── HeaderRight (NotificationBell + UserDropdown)
└── MainContent (<children />)
```

**Key props:**
```ts
interface AppShellProps {
  title: string
  logo?: React.ReactNode
  menuItems: MenuItem[]
  user: { name: string; avatar?: string }
  notificationCount?: number
  onNotificationClick?: () => void
  onProfileClick?: () => void
  onLogout: () => void
  collapsed?: boolean
  onCollapsedChange?: (v: boolean) => void
  children: React.ReactNode
}

interface MenuItem {
  key: string
  label: string
  icon?: React.ReactNode
  path?: string
  children?: MenuItem[]
}
```

**Styles:** CSS Modules (`.module.css`), Rollup `rollup-plugin-postcss` with `inject: true` so
consumers need no separate CSS import. Semantic override classes: `.pm-sidebar`, `.pm-header`,
`.pm-content`.

**Build change:** Add `rollup-plugin-postcss` + `postcss` to devDependencies.

### Affected Files

| File Path | Change |
|-----------|--------|
| `points-mall-frontend-base/src/components/AppShell/AppShell.tsx` | New |
| `points-mall-frontend-base/src/components/AppShell/AppShell.module.css` | New |
| `points-mall-frontend-base/src/components/AppShell/Sidebar.tsx` | New |
| `points-mall-frontend-base/src/components/AppShell/Sidebar.module.css` | New |
| `points-mall-frontend-base/src/components/AppShell/Header.tsx` | New |
| `points-mall-frontend-base/src/components/AppShell/Header.module.css` | New |
| `points-mall-frontend-base/src/components/AppShell/Breadcrumb.tsx` | New |
| `points-mall-frontend-base/src/components/AppShell/Breadcrumb.module.css` | New |
| `points-mall-frontend-base/src/components/AppShell/index.ts` | New |
| `points-mall-frontend-base/src/types/menu.ts` | New |
| `points-mall-frontend-base/src/index.ts` | Modified — add AppShell + MenuItem exports |
| `points-mall-frontend-base/rollup.config.mjs` | Modified — add postcss plugin |
| `points-mall-frontend-base/package.json` | Modified — add rollup-plugin-postcss, postcss devDeps |

## Acceptance Criteria

- [x] AC-01 `<AppShell>` renders sidebar + header + breadcrumb + children without runtime errors
- [x] AC-02 Sidebar expands to 240 px and collapses to 64 px; width transition is animated (300ms ease)
- [x] AC-03 Collapsed state persists across page refreshes via `localStorage` key `pm-sidebar-collapsed`
- [x] AC-04 Collapsed sidebar shows icon-only menu items; hovering shows label as tooltip
- [x] AC-05 Breadcrumb auto-computes from `menuItems` tree + current pathname; shows "Home" root when no match
- [x] AC-06 Header right: avatar (initials fallback when no avatar URL), notification bell with badge count
- [x] AC-07 Clicking avatar opens dropdown with "Profile" and "Logout" items; clicking Logout fires `onLogout`
- [x] AC-08 `onNotificationClick` fires when bell is clicked
- [x] AC-09 `pnpm build` exits 0; `dist/` contains `index.esm.js`, `index.cjs.js`, `index.d.ts`
- [x] AC-10 `package.json` has no runtime dependencies other than `react`/`react-dom` in peerDependencies

## Status Change History

| Time | Previous Status | New Status | Actor | Notes |
|------|-----------------|------------|-------|-------|
| 2026-06-26 | dev-done | test-pass | script | test:task run |
| 2026-06-26 | — | draft | AI | Raw requirements converted to structured TASK |
| 2026-06-26 | spec-pending | spec-ready | Human | AC confirmed |
| 2026-06-26 | in-dev | dev-done | AI | 14/14 tests pass; pnpm build exits 0; dist: ESM+CJS+d.ts |
