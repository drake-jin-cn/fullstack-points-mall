# Design: frontend-base AppShell Component (T100)

**Date:** 2026-06-26  
**Task:** T100 / TASK-AUTH-0005  
**Status:** Approved

---

## Background

`points-mall-frontend-base` is a shared npm package (`@points-mall/frontend-base`) intended for
reuse across multiple teams and web applications. Currently it only contains a placeholder `Button`
component. Phase 1 requires a reusable application shell so every consuming app gets a consistent,
professional layout without re-implementing navigation from scratch.

HTTP infrastructure (Axios, interceptors) was originally scoped here (T009, T011) but has been
moved to `points-mall-frontend`, because each consuming team has its own BFF with different API
conventions — sharing HTTP code across teams provides no reuse value.

---

## Goals

1. Ship an `AppShell` component that provides a complete page layout (sidebar + header + breadcrumb + content area).
2. All data is injected via props — the component never makes API calls.
3. Supports collapsible sidebar with state persisted in `localStorage`.
4. Default styles are professional and ready to use out of the box; consumers can override via semantic CSS classes.
5. Zero runtime dependencies beyond React.

---

## Out of Scope

- HTTP client / Axios setup (belongs to each consuming app).
- Silent token refresh logic (belongs to each consuming app).
- User profile pages or any business-specific content.
- i18n / theme switching.

---

## Architecture

### Component Tree

```
AppShell
├── Sidebar
│   ├── SidebarHeader (logo + product title)
│   ├── SidebarMenu (recursive MenuItem rendering)
│   └── CollapseToggle (button at bottom)
├── Header
│   ├── HeaderLeft (breadcrumb)
│   └── HeaderRight (NotificationBell + UserDropdown)
└── MainContent (children)
```

### Props Interface

```ts
export interface AppShellProps {
  title: string
  logo?: React.ReactNode
  menuItems: MenuItem[]
  user: { name: string; avatar?: string }
  notificationCount?: number
  onNotificationClick?: () => void
  onProfileClick?: () => void
  onLogout: () => void
  collapsed?: boolean                    // controlled
  onCollapsedChange?: (v: boolean) => void
  children: React.ReactNode
}

export interface MenuItem {
  key: string
  label: string
  icon?: React.ReactNode
  path?: string
  children?: MenuItem[]
}
```

### Layout Behaviour

| Sidebar State | Width  | Menu Display         |
|---------------|--------|----------------------|
| Expanded      | 240 px | icon + label         |
| Collapsed     | 64 px  | icon only + tooltip  |

- Width transition: `300ms ease`
- Main content area shrinks/grows to fill remaining space
- Collapsed state stored in `localStorage` key `pm-sidebar-collapsed`
- Both controlled (`collapsed` prop) and uncontrolled (internal `useState`) modes supported

### Breadcrumb

- Computed automatically by walking `menuItems` tree to find the entry whose `path` matches the
  current URL pathname (via `window.location.pathname` or an optional `currentPath` prop).
- Renders as: `Home / Parent Label / Current Label`

### Styles

- CSS Modules (`.module.css`) — bundled inline by Rollup, no separate CSS file import needed.
- Default palette: sidebar background `#001529` (dark navy), header background `#ffffff`.
- Semantic override classes exposed on root elements: `.pm-sidebar`, `.pm-header`, `.pm-content`.

---

## File Structure

```
points-mall-frontend-base/src/
├── components/
│   ├── AppShell/
│   │   ├── AppShell.tsx
│   │   ├── AppShell.module.css
│   │   ├── Sidebar.tsx
│   │   ├── Sidebar.module.css
│   │   ├── Header.tsx
│   │   ├── Header.module.css
│   │   ├── Breadcrumb.tsx
│   │   ├── Breadcrumb.module.css
│   │   └── index.ts
│   └── Button/
│       └── Button.tsx          (existing)
├── types/
│   └── menu.ts                 (MenuItem, AppShellProps)
└── index.ts                    (re-exports AppShell, Button, MenuItem type)
```

---

## Build Config Changes

Rollup needs `rollup-plugin-postcss` to handle CSS Modules:

```
pnpm add -D rollup-plugin-postcss postcss
```

Add to `rollup.config.mjs`:
```js
import postcss from 'rollup-plugin-postcss'
// plugins: [..., postcss({ modules: true, inject: true })]
```

---

## Acceptance Criteria

1. `<AppShell>` renders sidebar + header + breadcrumb + content without errors.
2. Sidebar toggles between 240 px and 64 px; transition is animated.
3. Collapsed state persists across page refreshes via `localStorage`.
4. Breadcrumb auto-computes from `menuItems` and current pathname; shows `Home` when no match.
5. Header right area shows avatar (initials fallback), notification bell with badge, dropdown with profile + logout items.
6. `onLogout` callback fires when logout is clicked.
7. `pnpm build` exits 0; `dist/` contains ESM + CJS + `.d.ts`.
8. No runtime dependencies other than React in `package.json`.
