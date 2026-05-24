// Public API for @aquascape/testing.
//
// Test harnesses, fixtures, builders, mocks, and reusable fast-check
// arbitraries. Hosts the F1.3 document round-trip property test
// (`document-round-trip.spec.ts`) which is what the CI gate runs.

export { arbAquaDocument } from './arbitraries/aqua-document';
