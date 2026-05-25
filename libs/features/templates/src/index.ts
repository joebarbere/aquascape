// Public API for @aquascape/features/templates. Stage 5 F5.1 + F5.2.
//
// Pure-data home for the bundled built-in starter templates. The browser
// UI + personal-template service live in `features/editor-shell` so they
// can share the Angular jest setup; this lib is plain TypeScript (Node
// jest environment) so it stays trivially testable + reusable in
// headless / CLI tooling.

export { BUILTIN_TEMPLATES, type TemplateListing } from './lib/builtin-templates';