# E2E Test Conventions (Playwright)

## Run Commands

```bash
# Install (first time)
npx playwright install

# Run all E2E tests
npx playwright test .tests/e2e/

# Run a specific file
npx playwright test .tests/e2e/auth.spec.ts

# UI mode (for debugging)
npx playwright test --ui
```

## Test File Format

```typescript
// .tests/e2e/auth.spec.ts
import { test, expect } from '@playwright/test';

test.describe('Login & Auth Flow', () => {
  test('Successful login - redirects to Dashboard', async ({ page }) => {
    await page.goto('/login');
    await page.fill('[name=email]', 'test@company.com');
    await page.fill('[name=password]', 'Test123456');
    await page.click('[type=submit]');
    await expect(page).toHaveURL('/dashboard');
    await expect(page.locator('[data-testid=user-name]')).toBeVisible();
  });

  test('Unauthenticated access to protected route - redirects to login', async ({ page }) => {
    await page.goto('/dashboard');
    await expect(page).toHaveURL('/login');
  });

  test('Unauthorized access - redirects to 403 page', async ({ page }) => {
    await page.goto('/admin/system-config');
    await expect(page).toHaveURL('/403');
  });
});
```

## data-testid Conventions

**Must use `data-testid` to locate elements.** Using text content, CSS class names,
or DOM path selectors is prohibited.

| Selector | Allowed | Reason |
|----------|---------|--------|
| `[data-testid=login-submit]` | ✅ Recommended | Semantic, survives text/style changes |
| `button:has-text("Login")` | ❌ Prohibited | Breaks when copy changes |
| `.btn-primary` | ❌ Prohibited | Breaks when styles are refactored |
| `form > div:nth-child(2) > button` | ❌ Prohibited | Breaks when structure changes |

**Naming convention**: `<page/module>-<element-semantics>`, all lowercase, hyphen-separated.

```
login-submit            submit button on login page
user-name               user name display area
cart-item-list          shopping cart item list
points-balance          points balance value
delete-confirm-dialog   delete confirmation dialog
```

## Coverage Scenarios

| Scenario | File |
|----------|------|
| Login & authentication | auth.spec.ts |
| Permission-based route guards | permissions.spec.ts |
| Points redemption core flow | shop.spec.ts |
