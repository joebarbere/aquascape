# Stage 12 — Release pipeline: versioning, installers, GitHub releases

**Stage:** 12 — Release pipeline (cross-cutting tooling; not tied to a numbered F-feature).
**Owner:** `electron-platform-engineer` (lead; electron-builder + Electron app metadata) + `nx-workspace-engineer` (release script + version management).
**Status:** Not started.

## Goal

Ship `pnpm release <version>` (single command) that cuts a tagged, GitHub-published release of the Electron desktop app, plus a documented walkthrough for the first release.

## Version scheme — open decision

> **Deferred.** The maintainer hasn't picked a version scheme yet. The first-release number, the relationship between stage completeness and semver bumps, the "useful v1.0" milestone, and whether to ship calendar-style or semver-style tags are all open. The release script must therefore stay **scheme-agnostic** — it takes whatever version string the caller passes (positional `<version>` argument), validates the shape, and refuses to overwrite an existing tag. The script must NOT hard-code a milestone → version mapping.
>
> **What needs to be decided before the first `pnpm release` call:**
> - Tag prefix (`v` prefix or bare)?
> - Pre-stable signal — `-alpha`/`-beta` suffix, or `0.x` semver convention, or calendar tags (`2026.05.0`)?
> - What does a major bump mean? Stage completeness? Breaking `.aqua` schema change? Both?
> - What is the "first stable release" definition — Stages 0–4 done, all 12 stages done, or signed + autoupdater first?
>
> ADR-0005 (provisionally `docs/decisions/0005-release-version-scheme.md`) is the home for the eventual decision; the release script lands first with the scheme as a free parameter so this PR isn't blocked on it.

For the rest of this plan, version strings appear in placeholder form (`<x.y.z>`) and the walkthrough's example numbers (`v0.0.0-rc.1`, `v0.1.0`) are illustrative only — substitute whatever scheme the maintainer settles on. The walkthrough still works end-to-end with any concrete string.

## Spec reference

ADR-0001 (Electron tooling — hand-rolled + electron-builder, no nx-electron); `aquascape-development-plan.md` §7 (sequencing notes); F6.4 (share & installers — what this work is the *foundation* of, even though it lands now); ADR-0005 *(to be written when the version-scheme decision is made — see "Version scheme — open decision" above)*.

## Dependencies

**Requires:** F0.6 desktop (Electron shell — done). `electron@^33` + `electron-builder@^25` already in workspace devDeps; `gh` CLI installed locally.

**Enables:** F6.4 (auto-update + signed installers + cross-platform CI builds — the next-stage extensions of the same pipeline).

## Scope

### In

1. **`apps/desktop/package.json`** with the electron-builder metadata electron-builder needs to read (appId, productName, version sync rule, file globs). Stage 0 deliberately skipped this file because no build target needed it; the installer build does.
2. **`electron-builder.yml`** (or equivalent block in `apps/desktop/package.json`) configuring per-platform targets: macOS `dmg` + `zip` (arm64 + x64), Windows `nsis`, Linux `AppImage`. Output to `dist/installers/`. **No code signing** for the first release — document the Gatekeeper / SmartScreen warnings users will see and accept that cost for an early build.
3. **`tools/release.cjs`** — Node release driver. Argument: an opaque version string the script does not interpret (the maintainer chooses the scheme; the script only validates shape and uniqueness). Steps:
   1. Verify on `main` branch, clean working tree, in sync with origin (`git status` + `git fetch`).
   2. Run `pnpm exec nx run-many -t lint test build` and bail on any failure.
   3. Accept the version string as-is (the script does **not** assume a scheme — `0.1.0`, `2026.05.0`, `0.0.0-alpha.1` all flow through unchanged). Refuse to proceed if a tag of that name already exists locally or on origin.
   4. Print a confirmation prompt (target version, commits since last tag, platforms about to build); abort if the user declines.
   5. Update root `package.json` `version` AND `apps/desktop/package.json` `version` to the target (the desktop package.json is the one electron-builder reads for installer metadata; both must agree). Commit as `chore: release <tag>`.
   6. Create annotated tag (the script accepts a `--tag-prefix` flag — empty string for bare tags, default `v`) with the changelog body.
   7. Build the web bundle + desktop main + preload (`pnpm exec nx build desktop`).
   8. Invoke `electron-builder --mac --win --linux --publish=never` (or auto-detect host platform if cross-compile fails — see Notes). Installers land in `dist/installers/`.
   9. Push `main` + tag (`git push origin main --follow-tags`).
   10. Create the GitHub release via `gh release create <tag> dist/installers/* --title "<tag>" --notes-file <generated-notes>.md` — initially as a draft, so the user can review the auto-generated notes before publishing.
   11. Print the draft release URL and exit. User reviews + publishes manually for the first release (later, this can flip to `--draft=false` once the pipeline is trusted).
4. **`pnpm release` script** in root `package.json` invoking `node tools/release.cjs $@`.
5. **Release notes generator.** A small helper inside `tools/release.cjs` that:
   - Reads commits between the previous tag and HEAD via `git log --format=...`.
   - Groups them by conventional-commit prefix (`feat:`, `fix:`, `docs:`, `ci:`, `chore:`).
   - Lists them under headings in the generated notes file.
   - Appends a fixed "Known limitations" block sourced from a `tools/release-known-limitations.md` template (so each release explicitly enumerates what's stub vs. real — Stage 0 stubs in the platform layer, F6.3 image backgrounds deferred, no signed installers in the early builds, etc.).
6. **Documentation:**
   - Add a `## Releasing` section to `CLAUDE.md` describing the script + the "must be on main, clean tree" preflight. *Do not bake in a version scheme until ADR-0005 lands.*
   - Add a `## Downloading` section to `README.md` linking to GitHub Releases (text only until the first release ships; then add the link).
   - Add ADR-0005 (or whichever number is next) documenting **whatever version-scheme decision the maintainer makes** + the no-signing-for-early-builds trade-off. ADR-0005 can land **after** the script — they aren't dependencies of each other.

### Out

- **Code signing / notarization** — deferred to F6.4 + whatever the eventual "stable" milestone is. Early installers are unsigned; the release notes document the OS warning the user sees.
- **Auto-updater** (electron-updater integration) — deferred to post-"stable".
- **CI release builds** — early releases are cut manually from a developer's machine. F6.4 adds a GitHub Actions matrix release workflow.
- **Publishing libs to npm** — none of `libs/*` are published packages; their `package.json` files stay at `0.0.0`. Only the root + `apps/desktop` package.json carry the released version.
- **Web app deployment** — the web shell ships only as part of the desktop bundle for the first release. Publishing the SPA to a static host is a separate feature (likely under F6.4 alongside PWA install).
- **Changelog file** (`CHANGELOG.md`). The release-notes-per-tag on GitHub is the source of truth for early builds; a curated `CHANGELOG.md` lands once the version scheme + stability target stabilize.
- **The version scheme itself** — see "Version scheme — open decision" above. The script ships scheme-agnostic; ADR-0005 lands when the maintainer settles on a scheme.

## Acceptance criteria

(Substitute whichever version string the maintainer eventually picks for `<x.y.z>` below.)

- [ ] `pnpm release <x.y.z>` on a clean main branch produces installers in `dist/installers/`, an annotated tag, a pushed commit `chore: release <tag>`, and a draft GitHub release URL printed to stdout.
- [ ] The macOS DMG mounts and the bundled app launches on a fresh user, opens the same tank + sidebar + style controls the dev server shows, with no console errors.
- [ ] The Windows NSIS installer installs and runs the app to the same state on a Windows 11 VM (manual verification; cross-platform build from macOS using electron-builder's bundled wine is acceptable for an early build).
- [ ] The Linux AppImage runs on Ubuntu 22.04+ to the same state.
- [ ] The draft release on GitHub lists all three installer artifacts plus the generated changelog grouped by commit type.
- [ ] Running the script with a version equal to an existing tag exits non-zero with a clear message.
- [ ] Running the script on a dirty working tree exits non-zero before touching anything.
- [ ] The script is idempotent on `--dry-run` (lists what it *would* do without making changes — recommend implementing this flag for safety).
- [ ] The script accepts **any** opaque version string (scheme-agnostic). Tests cover at least: a semver triple, a semver-with-prerelease tag, a calendar-style tag, and a leading-zero refusal case.

## Testing

- **Unit:** `tools/release.cjs` is structured so its non-side-effecting helpers (version-shape validator, commit-grouper, known-limitations-appender) are exported and unit-tested in `tools/release.spec.cjs` via Jest (the workspace already has Jest; add a small `tools` test config or run via `node --test` — agent's call).
- **Integration:** a `--dry-run <any-version-string>` invocation that exercises the entire flow except `gh` + `git push` + `electron-builder`. Run it in CI on every PR that touches `tools/release.cjs` or `apps/desktop/package.json`.
- **Manual smoke:** cut a rehearsal release (e.g. a `*-rc.1` tag) against a throwaway branch first to verify the GitHub release flow before tagging the real first release on `main`.

## Notes

- **Cross-compile reliability.** Cross-building Windows installers from macOS with `electron-builder` needs `wine`. On Apple Silicon this is finicky. Fallback strategy: if `--win` fails on the dev's machine, the script offers a clear "build macOS only and ship that; file an issue to add CI release builds for the cross-platform path" message. Don't block the first release on cross-compile working.
- **gh CLI prereq.** The script checks `command -v gh` early and bails with a "brew install gh && gh auth login" hint if missing. Same for `git` (extremely unlikely missing but cheap to assert).
- **Two `package.json#version` fields.** Keeping the root and `apps/desktop` versions in sync is the cleanest model — root is for the workspace, `apps/desktop` is what electron-builder reads. The release script updates both atomically. If they drift, the next `pnpm release` should refuse to proceed until reconciled.
- **Tag format.** Determined by `--tag-prefix` (default `v`, empty string for bare tags). The `gh release create` first arg is the tag name; the script keeps the prefix as a top-level config knob so the eventual ADR-0005 decision can change it without touching script internals.
- **Why `gh` rather than the GitHub REST API.** `gh release create` handles file uploads, draft toggles, and prerelease flagging in one command without needing a PAT in the script. The dev's existing `gh auth login` is the credential surface.
- **Why draft-first.** For the first release specifically, the release notes are auto-generated from commit messages but the "Known limitations" block needs human review. Draft-first gives a beat to fix typos before clicking Publish.

---

# First release walkthrough — cutting `<first-tag>`

Concrete steps. Run from `/Users/joe/Documents/GitHub/aquascape`. The version numbers below (`<first-tag>`, `<rehearsal-tag>`) are placeholders — substitute whatever the maintainer settles on for ADR-0005. The pipeline itself is scheme-agnostic; only this walkthrough's copy depends on the chosen scheme.

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
feat(release): add release script + electron-builder config (release-pipeline prep)
```

PR scope (see "Scope > In"):
- `apps/desktop/package.json` (new) with appId `org.aquascape.desktop`, productName "Aquascape", version `0.0.0` (will be bumped by the script).
- `electron-builder.yml` (or `apps/desktop/package.json#build` block) with mac/win/linux targets.
- `tools/release.cjs` + companion `tools/release-known-limitations.md`.
- `tools/release.spec.cjs` covering the pure helpers (including the version-shape validator).
- `pnpm release` script in root `package.json`.
- CLAUDE.md `## Releasing` section (no version-scheme prescription — see "Version scheme — open decision").
- README.md `## Downloading` section (deferred link until the first release ships).

ADR-0005 capturing the version-scheme decision is **not** a blocker for this PR; it lands separately once the maintainer settles on a scheme. The script is scheme-agnostic by design.

Verify via `pnpm release --dry-run <any-string>` from a non-main branch (the dry run should NOT require being on main). Should print every action without taking any.

Merge the PR.

## 2. Cut a rehearsal release (`<rehearsal-tag>`) on a throwaway branch

Goal: prove the full pipeline works *before* cutting the real first release on `main`.

```bash
git switch -c release-rehearsal
pnpm release <rehearsal-tag>
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

**Don't publish the rehearsal release.** Delete the draft and the throwaway tag after verifying:

```bash
gh release delete <rehearsal-tag> --yes --cleanup-tag
git switch main
git branch -D release-rehearsal
```

If anything broke, file follow-ups + iterate before step 3.

## 3. Cut the first release (`<first-tag>`)

**Prerequisite:** the version scheme has been decided + ADR-0005 has landed. If not, this step is blocked on that decision — see "Version scheme — open decision" at the top of this plan.

```bash
git switch main
git pull --rebase origin main
pnpm release <first-tag>
```

The script runs the same flow. Once it prints the draft URL:

1. Open the draft on github.com/<owner>/<repo>/releases.
2. **Edit the auto-generated release notes** to add a "Welcome to Aquascape" intro paragraph above the commit list. Copy will depend on what's actually shipped + which stages are complete at first-release time — write it then, not now.

3. **Verify the "Known limitations" block** lists everything that's stubbed or deferred at first-release time. Pull the up-to-date list from `tools/release-known-limitations.md`.

4. **Toggle "Set as a pre-release"** on if the chosen version scheme + ADR-0005 mark this tag as pre-stable.

5. **Publish.** Click the green button.

6. **Smoke-test the published artifacts** by downloading each installer onto a clean machine/VM and confirming the app launches.

## 4. Post-release

- Update the README's `## Downloading` section with a direct link to the latest release.
- Open a follow-up issue: "F6.4 — cross-platform CI release workflow + code signing".
- Bump root `package.json` to whatever in-flight string ADR-0005 prescribes (e.g. `-dev` suffix, next-patch placeholder) so subsequent commits don't claim to be `<first-tag>`. Optional; the next `pnpm release` call will bump it anyway.

---

## Acceptance for this plan

This plan is "done" when:

- [ ] The PR from step 1 has merged (script is scheme-agnostic and shippable on its own).
- [ ] Step 2's rehearsal has succeeded (or surfaced fixable issues that step 1 resolves).
- [ ] ADR-0005 has landed (version-scheme decision recorded).
- [ ] Step 3 has published the first real release on GitHub.
- [ ] At least one external user (could be the developer on a clean second machine) has downloaded the installer and launched the app.
