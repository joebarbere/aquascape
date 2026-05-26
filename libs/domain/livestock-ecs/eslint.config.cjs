const baseConfig = require('../../../eslint.config.cjs');

// Determinism guard: the ECS world is the source of truth for fish position
// reproducibility (same seed + same SpawnOpts + same tick count → byte-identical
// snapshot). `Math.random()` would silently break that invariant, so we forbid
// it at the lint layer. The deterministic alternative is `tickPrng()` /
// `seededHash01()`. See `plans/stage-11-animated-livestock.md` §Determinism.
module.exports = [
  ...baseConfig,
  {
    files: ['**/*.ts'],
    ignores: ['**/*.spec.ts', '**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "MemberExpression[object.name='Math'][property.name='random']",
          message:
            'Math.random() is forbidden in domain-livestock-ecs — use tickPrng() or seededHash01() to preserve determinism.',
        },
      ],
    },
  },
];
