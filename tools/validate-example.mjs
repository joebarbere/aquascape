#!/usr/bin/env node
/**
 * One-line CLI to validate an `.aqua` JSON document against the canonical
 * schema (`libs/domain/document/src/schema/aqua-document.schema.json`).
 *
 * This is a thin wrapper around the AJV instance compiled at module load.
 * For the authoritative round-trip + schema check, run
 *   pnpm exec nx test testing -t document-round-trip
 * which is what CI gates on. This script exists so contributors editing the
 * format can sanity-check the fixture (`example.aqua.json`) without spinning
 * up Jest.
 *
 * Usage:
 *   node tools/validate-example.mjs                          # default fixture
 *   node tools/validate-example.mjs path/to/some.aqua.json   # validate a different file
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const schemaPath = resolve(
  repoRoot,
  'libs/domain/document/src/schema/aqua-document.schema.json',
);
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
