# Release pipeline — versioning, installers, GitHub releases

**Stage:** cross-cutting tooling (not tied to a numbered F-feature).
**Owner:** `electron-platform-engineer` (lead; electron-builder + Electron app metadata) + `nx-workspace-engineer` (release script + version management).
**Status:** Not started.

## Goal

Ship `pnpm release <version>` (single command) that cuts a tagged, GitHub-published release of the Electron desktop app, plus a documented walkthrough for the first one (`v0.1.0`).

## Version scheme

The development plan §7 defines the milestones, not concrete numbers — codify the mapping here:

| Tag         | Meaning                                                                          |
|-------------|----------------------------------------------------------------------------------|
| `v0.1.0`    | **First release.** Stage 0 + F1.1 + F1.2 — tank size + styling on a live canvas. |
| `v0.1.x`    | Patch releases for the rest of Stage 1 features (F1.3 doc format, F1.4 file ops, F1.5 autosave, F1.6 dirty tracking) — minor by stage *completeness*, patch by feature. |
| `v0.2.0`    | Stage 1 complete.                                                                |
| `v0.3.0`    | Stage 2 complete.                                                                |
| `v0.4.0`    | Stage 3 complete.                                                                |
| `v0.5.0`    | Stage 4 complete (planting + growth-sim — the last critical-path stage).         |
| `v1.0.0`    | First stable release. Plan §7's "useful v1.0" — Stages 0–4 done, polished, signed installers, autoupdater. |
| `v1.x.0`    | Stages 5 + 6 round out (templates, precision guides, export polish).             |
| `v2.0.0+`   | Stages 7–10 land (livestock/equipment, gallery, AI render, 3D).                  |

Rule: each completed *stage* bumps the minor; feature additions within a stage bump the patch. v1.0.0 is reserved for the plan's "useful tool" milestone. Pre-v1 we don't promise stability; tags don't need `-alpha` suffixes — `v0.x.y` already signals "pre-stable" per semver convention.

## Spec reference

ADR-0001 (Electron tooling — hand-rolled + electron-builder, no nx-electron); `aquascape-development-plan.md` §7 (sequencing notes); F6.4 (share & installers — what this work is the *foundation* of, even though it lands now).

## Dependencies

**Requires:** F0.6 desktop (Electron shell — done). `electron@^33` + `electron-builder@^25` already in workspace devDeps; `gh` CLI installed locally.

**Enables:** F6.4 (auto-update + signed installers + cross-platform CI builds — the next-stage extensions of the same pipeline).

## Scope

### In

1. **`apps/desktop/package.json`** with the electron-builder metadata electron-builder needs to read (appId, productName, version sync rule, file globs). Stage 0 deliberately skipped this file because no build target needed it; the installer build does.
2. **`electron-builder.yml`** (or equivalent block in `apps/desktop/package.json`) configuring per-platform targets: macOS `dmg` + `zip` (arm64 + x64), Windows `nsis`, Linux `AppImage`. Output to `dist/installers/`. **No code signing** for v0.1.0 — document the Gatekeeper / SmartScreen warnings users will see and accept that cost for the alpha.
3. **`tools/release.cjs`** — Node release driver. Argument: explicit version (`0.1.0`) or bump-type (`patch` | `minor` | `major`). Steps:
   1. Verify on `main` branch, clean working tree, in sync with origin (`git status` + `git fetch`).
   2. Run `pnpm exec nx run-many -t lint test build` and bail on any failure.
   3. Resolve target version from the argument; refuse to proceed if a tag of that name already exists locally or on origin.
   4. Print a confirmation prompt (target version, commits since last tag, platforms about to build); abort if the user declines.
   5. Update root `package.json` `version` AND `apps/desktop/package.json` `version` to the target (the desktop package.json is the one electron-builder reads for installer metadata; both must agree). Commit as `chore: release v<x.y.z>`.
   6. Create annotated tag `v<x.y.z>` with the changelog body.
   7. Build the web bundle + desktop main + preload (`pnpm exec nx build desktop`).
   8. Invoke `electron-builder --mac --win --linux --publish=never` (or auto-detect host platform if cross-compile fails — see Notes). Installers land in `dist/installers/`.
   9. Push `main` + tag (`git push origin main --follow-tags`).
   10. Create the GitHub release via `gh release create v<x.y.z> dist/installers/* --title "v<x.y.z>" --notes-file <generated-notes>.md` — initially as a draft, so the user can review the auto-generated notes before publishing.
   11. Print the draft release URL and exit. User reviews + publishes manually for v0.1.0 (later, this can flip to `--draft=false` once the pipeline is trusted).
4. **`pnpm release` script** in root `package.json` invoking `node tools/release.cjs $@`.
5. **Release notes generator.** A small helper inside `tools/release.cjs` that:
   - Reads commits between the previous tag and HEAD via `git log --format=...`.
   - Groups them by conventional-commit prefix (`feat:`, `fix:`, `docs:`, `ci:`, `chore:`).
   - Lists them under headings in the generated notes file.
   - Appends a fixed "Known limitations" block sourced from a `tools/release-known-limitations.md` template (so each release explicitly enumerates what's stub vs. real — Stage 0 stubs in the platform layer, F6.3 image backgrounds deferred, no signed installers in pre-v1, etc.).
6. **Documentation:**
   - Add a `## Releasing` section to `CLAUDE.md` describing the script, the version scheme above, and the "must be on main, clean tree" preflight.
   - Add a `## Downloading` section to `README.md` linking to GitHub Releases (text only until v0.1.0 ships; then add the link).
   - Add ADR-0005 (or whichever number is next) documenting the version-scheme decision and the no-signing-for-pre-v1 trade-off.

### Out

- **Code signing / notarization** — deferred to F6.4 + v1.0.0. Pre-v1 installers are unsigned; the release notes document the OS warning the user sees.
- **Auto-updater** (electron-updater integration) — post-v1.
- **CI release builds** — pre-v1 releases are cut manually from a developer's machine. F6.4 adds a GitHub Actions matrix release workflow.
- **Publishing libs to npm** — none of `libs/*` are published packages; their `package.json` files stay at `0.0.0`. Only the root + `apps/desktop` package.json carry the released version.
- **Web app deployment** — the web shell ships only as part of the desktop bundle for v0.1.0. Publishing the SPA to a static host is a separate feature (likely under F6.4 alongside PWA install).
- **Changelog file** (`CHANGELOG.md`). The release-notes-per-tag on GitHub is the source of truth for pre-v1; a curated `CHANGELOG.md` lands with v1.0.

## Acceptance criteria

- [ ] `pnpm release 0.1.0` on a clean main branch produces installers in `dist/installers/`, an annotated tag `v0.1.0`, a pushed commit `chore: release v0.1.0`, and a draft GitHub release URL printed to stdout.
- [ ] The macOS DMG mounts and the bundled app launches on a fresh user, opens the same tank + sidebar + style controls the dev server shows, with no console errors.
- [ ] The Windows NSIS installer installs and runs the app to the same state on a Windows 11 VM (manual verification; cross-platform build from macOS using electron-builder's bundled wine is acceptable for alpha).
- [ ] The Linux AppImage runs on Ubuntu 22.04+ to the same state.
- [ ] The draft release on GitHub lists all three installer artifacts plus the generated changelog grouped by commit type.
- [ ] Running the script with a version equal to an existing tag exits non-zero with a clear message.
- [ ] Running the script on a dirty working tree exits non-zero before touching anything.
- [ ] The script is idempotent on `--dry-run` (lists what it *would* do without making changes — recommend implementing this flag for safety).

## Testing

- **Unit:** `tools/release.cjs` is structured so its non-side-effecting helpers (version-resolver, commit-grouper, known-limitations-appender) are exported and unit-tested in `tools/release.spec.cjs` via Jest (the workspace already has Jest; add a small `tools` test config or run via `node --test` — agent's call).
- **Integration:** a `--dry-run v0.0.0-test` invocation that exercises the entire flow except `gh` + `git push` + `electron-builder`. Run it in CI on every PR that touches `tools/release.cjs` or `apps/desktop/package.json`.
- **Manual smoke:** cut a `v0.0.0-rc.1` against a throwaway branch first to verify the GitHub release flow before tagging `v0.1.0` on `main`.

## Notes

- **Cross-compile reliability.** Cross-building Windows installers from macOS with `electron-builder` needs `wine`. On Apple Silicon this is finicky. Fallback strategy: if `--win` fails on the dev's machine, the script offers a clear "build macOS only and ship that; file an issue to add CI release builds for the cross-platform path" message. Don't block v0.1.0 on cross-compile working.
- **gh CLI prereq.** The script checks `command -v gh` early and bails with a "brew install gh && gh auth login" hint if missing. Same for `git` (extremely unlikely missing but cheap to assert).
- **Two `package.json#version` fields.** Keeping the root and `apps/desktop` versions in sync is the cleanest model — root is for the workspace, `apps/desktop` is what electron-builder reads. The release script updates both atomically. If they drift, the next `pnpm release` should refuse to proceed until reconciled.
- **Tag format.** `v<x.y.z>` (with the `v` prefix). The `gh release create` first arg is the tag name; consistent prefixing keeps GitHub's UI tidy and matches semver convention.
- **Why `gh` rather than the GitHub REST API.** `gh release create` handles file uploads, draft toggles, and prerelease flagging in one command without needing a PAT in the script. The dev's existing `gh auth login` is the credential surface.
- **Why draft-first.** For v0.1.0 specifically, the release notes are auto-generated from commit messages but the "Known limitations" block needs human review. Draft-first gives a beat to fix typos before clicking Publish.

---

# First release walkthrough — cutting `v0.1.0`

Concrete steps. Run from `/Users/joe/Documents/GitHub/aquascape`.

## 0. Preflight (one-time, before the very first release)

```bash
# Sanity-check the dev environment
pnpm --version          # 9.12+
node --version          # 20.11+
gh --version            # any
gh auth status          # confirm logged in to github.com

# Make sure the workspace builds clean from cold
rm -rf node_modules .nx/cache dist
pnpm install
pnpm exec nx run-many -t lint test build
```

If any of those fail, fix before continuing.

## 1. Wire the pipeline (one-time)

Implement the `In` scope above as a single PR:

```
feat(release): add release script + electron-builder config (v0.1.0 prep)
```

PR scope (see "Scope > In"):
- `apps/desktop/package.json` (new) with appId `org.aquascape.desktop`, productName "Aquascape", version `0.0.0` (will be bumped by the script).
- `electron-builder.yml` (or `apps/desktop/package.json#build` block) with mac/win/linux targets.
- `tools/release.cjs` + companion `tools/release-known-limitations.md`.
- `tools/release.spec.cjs` covering the pure helpers.
- `pnpm release` script in root `package.json`.
- CLAUDE.md `## Releasing` section.
- README.md `## Downloading` section (deferred link until v0.1.0 ships).
- ADR-0005 (`docs/decisions/0005-pre-v1-release-policy.md`) capturing version scheme + no-signing decision.

Verify via `pnpm release --dry-run 0.0.0-rc.1` from a non-main branch (the dry run should NOT require being on main). Should print every action without taking any.

Merge the PR.

## 2. Cut a release candidate (`v0.0.0-rc.1`) on a throwaway branch

Goal: prove the full pipeline works *before* cutting the real `v0.1.0` on `main`.

```bash
git switch -c release-rehearsal
pnpm release 0.0.0-rc.1
```

The script should:
1. Run nx lint/test/build (all green).
2. Show the confirmation summary, including "commits since previous tag: N (all of git history — no prior tag)".
3. Bump versions in both `package.json` files, commit, tag, push.
4. Build installers (~5–10 minutes per platform depending on cross-compile).
5. Open a draft GitHub release URL.

Open the draft release in the browser. Verify:
- All three installer assets attached (or two if cross-compile failed — that's the documented fallback).
- Auto-generated notes group commits sensibly.
- Known-limitations block matches reality.

**Don't publish the rc.1 release.** Delete the draft and the throwaway tag after verifying:

```bash
gh release delete v0.0.0-rc.1 --yes --cleanup-tag
git switch main
git branch -D release-rehearsal
```

If anything broke, file follow-ups + iterate before step 3.

## 3. Cut `v0.1.0` (the real first release)

```bash
git switch main
git pull --rebase origin main
pnpm release 0.1.0
```

The script runs the same flow. Once it prints the draft URL:

1. Open the draft on github.com/<owner>/<repo>/releases.
2. **Edit the auto-generated release notes** to add a "Welcome to Aquascape" intro paragraph above the commit list. Suggested copy:

   > Aquascape's first published build — an early alpha of the desktop app. Stage 0 of the development plan is complete (the walking skeleton: tank renders in both web and Electron with full security posture), plus F1.1 tank-size selection and F1.2 tank styling (frame + water tint + background, including gradients) from Stage 1.
   >
   > **This is pre-stable.** Installers are unsigned, so:
   > - macOS will show "Aquascape can't be opened because Apple cannot check it for malicious software" — right-click → Open → Open Anyway.
   > - Windows SmartScreen will flag the installer — More info → Run anyway.
   > - Linux AppImage runs without warning; `chmod +x` first.
   >
   > Document persistence (Save / Open / Autosave) is the next milestone (F1.3–F1.5); for now, your work is in memory only.

3. **Verify the "Known limitations" block** lists at least:
   - No save/open yet (F1.3–F1.4).
   - No real file dialogs (platform stubs).
   - No autosave (F1.5).
   - No image-background support (F6.3).
   - No code signing (post-v1).

4. **Toggle "Set as a pre-release"** on (GitHub's UI flag — since this is v0.x).

5. **Publish.** Click the green button.

6. **Smoke-test the published artifacts** by downloading each installer onto a clean machine/VM and confirming the app launches.

## 4. Post-release

- Update the README's `## Downloading` section with a direct link to the latest release.
- Open a follow-up issue: "F6.4 — cross-platform CI release workflow + code signing for v1.0".
- Bump root `package.json` to `0.1.1-dev` so subsequent commits don't claim to be `v0.1.0`. (Optional; the next `pnpm release` call will bump it anyway, but the `-dev` suffix is a courtesy for anyone inspecting an in-flight build.)

---

## Acceptance for this plan

This plan is "done" when:

- [ ] The PR from step 1 has merged.
- [ ] Step 2's rehearsal has succeeded (or surfaced fixable issues that step 1 resolves).
- [ ] Step 3 has published `v0.1.0` on GitHub.
- [ ] At least one external user (could be the developer on a clean second machine) has downloaded the installer and launched the app.
