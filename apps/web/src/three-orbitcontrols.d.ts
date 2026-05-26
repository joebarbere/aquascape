// Stage 10 F10.3 — TypeScript shim for the OrbitControls JS module.
//
// `apps/web/tsconfig.app.json` maps the import path
// `three/examples/jsm/controls/OrbitControls` (no `.js` suffix — the form
// the renderer-3d source uses) to the actual `.js` file under
// `node_modules/three/...`. esbuild needs that mapping to resolve the
// bundle; TypeScript needs THIS ambient declaration to assign types,
// because mapping to a `.js` path bypasses the `@types/three`
// auto-discovery that would otherwise pick up the .d.ts twin.
//
// The shim re-exports from the matching `@types/three/...` entry, so the
// surface stays in lockstep with the bundled JS class. No types declared
// here directly — that would risk drifting from the real shape.

declare module 'three/examples/jsm/controls/OrbitControls' {
  export * from 'three/examples/jsm/controls/OrbitControls.js';
}
