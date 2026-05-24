#!/usr/bin/env node
/**
 * Validate `example.aqua.json` against `aqua-document.schema.json`.
 *
 * Used during F1.2 Phase A to confirm lockstep edits to the canonical document
 * format remain coherent. F1.3 (`libs/domain/document/`) will subsume this into
 * the real loader + round-trip property tests; until then, this is the
 * authoritative check.
 *
 * Usage:
 *   node tools/validate-example.mjs                          # default fixture
 *   node tools/validate-example.mjs path/to/some.aqua.json   # validate a different file
 *
 * Exits non-zero on validation failure and prints AJV errors.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const schemaPath = resolve(repoRoot, 'aqua-document.schema.json');
const examplePath = resolve(process.argv[2] ?? resolve(repoRoot, 'example.aqua.json'));

const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const doc = JSON.parse(readFileSync(examplePath, 'utf8'));

const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);

const validate = ajv.compile(schema);
const ok = validate(doc);

if (!ok) {
  console.error(`FAIL: ${examplePath} does not validate against ${schemaPath}`);
  for (const err of validate.errors ?? []) {
    console.error(
      `  ${err.instancePath || '<root>'} ${err.message}` +
        (err.params ? `  ${JSON.stringify(err.params)}` : ''),
    );
  }
  process.exit(1);
}

console.log(`OK: ${examplePath} validates against ${schemaPath}`);
