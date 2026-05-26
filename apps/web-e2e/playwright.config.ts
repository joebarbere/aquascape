import { defineConfig, devices } from '@playwright/test';
import { nxE2EPreset } from '@nx/playwright/preset';
import { workspaceRoot } from '@nx/devkit';

/**
 * Playwright config for the `apps/web` SPA.
 *
 * The Nx preset wires:
 *   - `outputDir`  → `dist/.playwright/apps/web-e2e/test-output`
 *   - `reporter`   → html into `dist/.playwright/apps/web-e2e/playwright-report`
 *   - `forbidOnly` on CI
 *   - `workers: 1` on CI, parallel locally
 *
 * We override on top of the preset:
 *   - `webServer` — spins up `nx serve web` with a generous 90s timeout. The
 *     `docs/caveats/platform.md` "dev-server race" note flags that the Angular
 *     dev server can take a beat on cold starts; 90s leaves headroom on CI
 *     hardware. Locally we `reuseExistingServer` so iterating doesn't
 *     restart the server on every run.
 *   - `retries` — explicit `2` on CI, `0` locally (matches Wave 1 spec; the
 *     preset already defaults to the same values but we make it intentional).
 *   - `projects` — chromium only for now. Firefox / WebKit added later when
 *     CI install time + cross-browser coverage justifies it.
 *   - `use.baseURL` — points at the dev server above.
 */
export default defineConfig({
  ...nxE2EPreset(__filename, { testDir: './src' }),
  use: {
    baseURL: 'http://localhost:4200',
    trace: 'on-first-retry',
  },
  retries: process.env['CI'] ? 2 : 0,
  webServer: {
    command: 'pnpm exec nx serve web',
    port: 4200,
    timeout: 90_000,
    reuseExistingServer: !process.env['CI'],
    cwd: workspaceRoot,
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
});
