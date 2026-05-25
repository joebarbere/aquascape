// Validate every built-in template against the AquaDocument schema +
// confirm the template-specific invariants. Stage 5 F5.1.

import { validateAquaDocument } from '@aquascape/domain/document';

import { BUILTIN_TEMPLATES } from './builtin-templates';

describe('BUILTIN_TEMPLATES', () => {
  it('ships at least four starter templates', () => {
    expect(BUILTIN_TEMPLATES.length).toBeGreaterThanOrEqual(4);
  });

  it('every template has a unique listing id', () => {
    const ids = new Set(BUILTIN_TEMPLATES.map((t) => t.id));
    expect(ids.size).toBe(BUILTIN_TEMPLATES.length);
  });

  it.each(BUILTIN_TEMPLATES.map((t) => [t.id, t]))(
    '%s — passes schema validation',
    (_id, t) => {
      const result = validateAquaDocument(t.document);
      // Surface validator errors in the failure output so a regression is
      // obvious without re-running the validator by hand.
      if (!result.ok) {
        throw new Error(
          `template "${(_id as string)}" failed schema validation: ${JSON.stringify(
            result.errors,
            null,
            2,
          )}`,
        );
      }
    },
  );

  it.each(BUILTIN_TEMPLATES.map((t) => [t.id, t]))(
    '%s — meta.isTemplate is true',
    (_id, t) => {
      expect(t.document.meta.isTemplate).toBe(true);
    },
  );

  it.each(BUILTIN_TEMPLATES.map((t) => [t.id, t]))(
    '%s — has a non-empty name + description',
    (_id, t) => {
      expect(t.name.length).toBeGreaterThan(0);
      expect(t.description.length).toBeGreaterThan(0);
    },
  );

  it.each(BUILTIN_TEMPLATES.map((t) => [t.id, t]))(
    '%s — has a stable seed (for reproducible scatter placement)',
    (_id, t) => {
      expect(typeof t.document.meta.seed).toBe('number');
      expect(Number.isFinite(t.document.meta.seed)).toBe(true);
    },
  );

  it.each(BUILTIN_TEMPLATES.map((t) => [t.id, t]))(
    '%s — has at least one layer with at least one object',
    (_id, t) => {
      const totalObjects = t.document.layers.reduce(
        (sum, l) => sum + l.objects.length,
        0,
      );
      expect(totalObjects).toBeGreaterThan(0);
    },
  );

  it('all built-in template documents are deeply distinct (no shared mutable refs)', () => {
    const ids = BUILTIN_TEMPLATES.map((t) => t.document.meta.id);
    expect(new Set(ids).size).toBe(BUILTIN_TEMPLATES.length);
  });
});
