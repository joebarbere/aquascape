## `apps/web-e2e`

Playwright e2e harness for `apps/web`. **Tags:** `scope:app`, `type:app`, `platform:web`, `kind:e2e`.

### How to run

```bash
pnpm exec playwright install chromium   # one-time — downloads ~150 MB of browser binaries
pnpm exec nx run web-e2e:e2e            # boots `nx serve web` + runs specs against http://localhost:4200
```

Reports + traces land in `dist/.playwright/apps/web-e2e/`. Chromium only for now; Firefox / WebKit can be added to `playwright.config.ts#projects` when cross-browser coverage justifies the CI install time.

If the dev server is already running locally, Playwright reuses it (`reuseExistingServer: !CI`). On CI the server is spawned fresh and gets 90s to come up — see `docs/caveats/platform.md` for the dev-server race note.
