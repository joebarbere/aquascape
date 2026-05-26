import { expect, test } from '@playwright/test';

/**
 * Smoke spec — proves the Playwright wiring works end-to-end against the real
 * Angular dev server. Intentionally minimal: title check + host element
 * visibility. Feature-specific specs (livestock rendering, document I/O,
 * etc.) land in their own files alongside this one.
 */
test('home page loads with title Aquascape', async ({ page }) => {
  await page.goto('/');

  await expect(page).toHaveTitle(/Aquascape/i);

  // `aquascape-root` is the Angular host element declared in
  // `apps/web/src/index.html`. Once Angular bootstraps, it's in the DOM and
  // visible — if either step fails (broken bundle, runtime error, CSP
  // regression) this assertion catches it.
  await expect(page.locator('aquascape-root')).toBeVisible();
});
