#!/usr/bin/env node
/**
 * One-line CLI to validate every JSON manifest under
 * `libs/domain/catalog/src/data/**` against the canonical schema in
 * `libs/domain/catalog/src/schema/catalog-entry.schema.json`.
 *
 * This is a contributor sanity-check (mirrors `tools/validate-example.mjs`).
 * The authoritative gate is `nx test domain-catalog --configuration=ci`,
 * which the CI workflow runs as part of the coverage job.
 *
 * Usage:
 *   node tools/validate-catalog.mjs
 *   node tools/validate-catalog.mjs path/to/manifest.json
 *
 * Exits non-zero on validation failure or duplicate id.
 */

import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, extname, resolve, relative } from 'node:path';

import Ajv from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, '..');

const schemaPath = resolve(
  repoRoot,
  'libs/domain/catalog/src/schema/catalog-entry.schema.json',
);
const dataRoot = resolve(repoRoot, 'libs/domain/catalog/src/data');

const schema = JSON.parse(readFileSync(schemaPath, 'utf8'));
const ajv = new Ajv({ allErrors: true, strict: true });
addFormats(ajv);
const validate = ajv.compile(schema);

function listManifests(root) {
  const results = [];
  for (const entry of readdirSync(root)) {
    const abs = resolve(root, entry);
    if (statSync(abs).isDirectory()) {
      results.push(...listManifests(abs));
    } else if (extname(entry) === '.json') {
      results.push(abs);
    }
  }
  return results;
}

const targets =
  process.argv.length > 2
    ? process.argv.slice(2).map((p) => resolve(p))
    : listManifests(dataRoot);

let failures = 0;
const seenIds = new Map();

for (const file of targets) {
  const rel = relative(repoRoot, file);
  const data = JSON.parse(readFileSync(file, 'utf8'));
  if (!validate(data)) {
    failures += 1;
    console.error(`FAIL: ${rel}`);
    for (const err of validate.errors ?? []) {
      console.error(`  ${err.instancePath || '<root>'} ${err.message}`);
    }
    continue;
  }
  const key = `${data.catalog}|${data.id}`;
  if (seenIds.has(key)) {
    failures += 1;
    console.error(
      `FAIL: duplicate id "${data.catalog}|${data.id}" in ${rel} (also ${relative(
        repoRoot,
        seenIds.get(key),
      )})`,
    );
    continue;
  }
  seenIds.set(key, file);
  console.log(`OK: ${rel}`);
}

if (failures > 0) {
  console.error(`\n${failures} manifest(s) failed validation.`);
  process.exit(1);
}
console.log(`\n${targets.length} manifest(s) validated.`);
