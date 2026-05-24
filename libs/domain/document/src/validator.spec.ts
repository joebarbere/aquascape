import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { AQUA_DOCUMENT_JSON_SCHEMA, validateAquaDocument } from './validator';

const EXAMPLE_PATH = resolve(__dirname, '../../../../example.aqua.json');

describe('validateAquaDocument', () => {
  const example = JSON.parse(readFileSync(EXAMPLE_PATH, 'utf8'));

  it('accepts the canonical example', () => {
    expect(validateAquaDocument(example)).toEqual({ ok: true });
  });

  it('rejects a doc missing the format discriminator', () => {
    const { format: _format, ...rest } = example;
    const result = validateAquaDocument(rest);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => /format/.test(e.message + e.path))).toBe(true);
  });

  it('rejects a doc with an out-of-range opacity', () => {
    const broken = structuredClone(example);
    broken.layers[0].opacity = 2;
    const result = validateAquaDocument(broken);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors.some((e) => e.path.includes('/layers/0/opacity'))).toBe(true);
  });

  it('rejects an unknown background kind', () => {
    const broken = structuredClone(example);
    broken.tank.style.background = { kind: 'rainbow' };
    const result = validateAquaDocument(broken);
    expect(result.ok).toBe(false);
  });

  it('exposes the compiled schema for tooling', () => {
    expect(AQUA_DOCUMENT_JSON_SCHEMA).toMatchObject({ title: 'AquaDocument' });
  });
});
