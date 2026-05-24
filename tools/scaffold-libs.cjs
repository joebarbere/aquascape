#!/usr/bin/env node
// One-shot scaffold for the empty libraries from plan §2.1.
//
// This script was used to generate the per-lib project.json, tsconfig.*.json,
// jest.config.ts, eslint.config.cjs, src/index.ts, and README.md files
// alongside the two hand-written examples (libs/domain/geometry,
// libs/domain/scene-model). It is idempotent — running it again overwrites
// the same files. Kept in the repo so future libs can be added by appending
// to LIBS and re-running.
//
// Usage: node tools/scaffold-libs.cjs

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

/** All libs, each with the spec needed to render the boilerplate. */
const LIBS = [
  // domain/* — framework-free, scope:domain
  {
    dir: 'libs/domain/geometry',
    name: 'domain-geometry',
    tags: ['scope:domain', 'type:lib', 'framework:none'],
    coverage: 90,
    kind: 'js',
  },
  {
    dir: 'libs/domain/scene-model',
    name: 'domain-scene-model',
    tags: ['scope:domain', 'type:lib', 'framework:none'],
    coverage: 90,
    kind: 'js',
  },
  {
    dir: 'libs/domain/document',
    name: 'domain-document',
    tags: ['scope:domain', 'type:lib', 'framework:none'],
    coverage: 90,
    kind: 'js',
  },
  {
    dir: 'libs/domain/catalog',
    name: 'domain-catalog',
    tags: ['scope:domain', 'type:lib', 'framework:none'],
    coverage: 90,
    kind: 'js',
  },
  {
    dir: 'libs/domain/growth-sim',
    name: 'domain-growth-sim',
    tags: ['scope:domain', 'type:lib', 'framework:none'],
    coverage: 90,
    kind: 'js',
  },

  // rendering/* — scope:rendering
  {
    dir: 'libs/rendering/renderer-api',
    name: 'rendering-renderer-api',
    tags: ['scope:rendering', 'type:lib', 'framework:none'],
    coverage: 0,
    kind: 'js',
  },
  {
    dir: 'libs/rendering/renderer-2d',
    name: 'rendering-renderer-2d',
    tags: ['scope:rendering', 'type:lib', 'framework:none'],
    coverage: 0,
    kind: 'js',
  },
  {
    dir: 'libs/rendering/renderer-3d',
    name: 'rendering-renderer-3d',
    tags: ['scope:rendering', 'type:lib', 'framework:none'],
    coverage: 0,
    kind: 'js',
  },

  // features/* — scope:feature (Angular libs once @nx/angular is added; JS shells for Stage 0)
  {
    dir: 'libs/features/editor-shell',
    name: 'features-editor-shell',
    tags: ['scope:feature', 'type:lib'],
    coverage: 0,
    kind: 'js',
  },
  {
    dir: 'libs/features/tank-setup',
    name: 'features-tank-setup',
    tags: ['scope:feature', 'type:lib'],
    coverage: 0,
    kind: 'js',
  },
  {
    dir: 'libs/features/substrate-tool',
    name: 'features-substrate-tool',
    tags: ['scope:feature', 'type:lib'],
    coverage: 0,
    kind: 'js',
  },
  {
    dir: 'libs/features/hardscape-tool',
    name: 'features-hardscape-tool',
    tags: ['scope:feature', 'type:lib'],
    coverage: 0,
    kind: 'js',
  },
  {
    dir: 'libs/features/planting-tool',
    name: 'features-planting-tool',
    tags: ['scope:feature', 'type:lib'],
    coverage: 0,
    kind: 'js',
  },
  {
    dir: 'libs/features/layers-panel',
    name: 'features-layers-panel',
    tags: ['scope:feature', 'type:lib'],
    coverage: 0,
    kind: 'js',
  },
  {
    dir: 'libs/features/templates',
    name: 'features-templates',
    tags: ['scope:feature', 'type:lib'],
    coverage: 0,
    kind: 'js',
  },
  {
    dir: 'libs/features/export',
    name: 'features-export',
    tags: ['scope:feature', 'type:lib'],
    coverage: 0,
    kind: 'js',
  },
  {
    dir: 'libs/features/livestock-equipment',
    name: 'features-livestock-equipment',
    tags: ['scope:feature', 'type:lib'],
    coverage: 0,
    kind: 'js',
  },

  // ui — scope:ui
  { dir: 'libs/ui', name: 'ui', tags: ['scope:ui', 'type:lib'], coverage: 0, kind: 'js' },

  // state — scope:state (NgRx; JS shell for Stage 0)
  { dir: 'libs/state', name: 'state', tags: ['scope:state', 'type:lib'], coverage: 0, kind: 'js' },

  // platform/*
  {
    dir: 'libs/platform/platform-api',
    name: 'platform-api',
    tags: ['scope:platform-api', 'type:lib', 'framework:none'],
    coverage: 0,
    kind: 'js',
  },
  {
    dir: 'libs/platform/platform-web',
    name: 'platform-web',
    tags: ['scope:platform-web', 'type:lib'],
    coverage: 0,
    kind: 'js',
  },
  {
    dir: 'libs/platform/platform-electron',
    name: 'platform-electron',
    tags: ['scope:platform-electron', 'type:lib'],
    coverage: 0,
    kind: 'js',
  },

  // testing — scope:testing
  {
    dir: 'libs/testing',
    name: 'testing',
    tags: ['scope:testing', 'type:lib', 'framework:none'],
    coverage: 0,
    kind: 'js',
  },
];

const ROOT_DEPTH = (libDir) => libDir.split('/').length; // libs/domain/x => 3, libs/ui => 2
const upPath = (libDir) => '../'.repeat(ROOT_DEPTH(libDir));

const headerNote = (name) =>
  `// Public API for @aquascape/${name.replace(/^(features|domain|rendering|platform)-/, '$1/').replace(/^(platform-api|platform-web|platform-electron)$/, 'platform/$1')}.\n//\n// Stage 0 scaffold — empty stub. Real implementation lands in a later feature\n// (see the corresponding plan in plans/stage-0-foundation/ or later stages).\nexport {};\n`;

function writeFile(rel, contents) {
  const abs = path.join(ROOT, rel);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, contents);
}

function scaffold(lib) {
  const { dir, name, tags, coverage } = lib;
  const up = upPath(dir);

  // project.json
  writeFile(
    `${dir}/project.json`,
    JSON.stringify(
      {
        name,
        $schema: `${up}node_modules/nx/schemas/project-schema.json`,
        sourceRoot: `${dir}/src`,
        projectType: 'library',
        tags,
        targets: {
          build: {
            executor: '@nx/js:tsc',
            outputs: ['{options.outputPath}'],
            options: {
              outputPath: `dist/${dir}`,
              main: `${dir}/src/index.ts`,
              tsConfig: `${dir}/tsconfig.lib.json`,
              assets: [`${dir}/*.md`],
            },
          },
        },
      },
      null,
      2,
    ) + '\n',
  );

  // src/index.ts
  writeFile(`${dir}/src/index.ts`, headerNote(name));

  // tsconfig.json
  writeFile(
    `${dir}/tsconfig.json`,
    JSON.stringify(
      {
        extends: `${up}tsconfig.base.json`,
        files: [],
        include: [],
        references: [{ path: './tsconfig.lib.json' }, { path: './tsconfig.spec.json' }],
        compilerOptions: {
          module: 'commonjs',
          forceConsistentCasingInFileNames: true,
          strict: true,
          noImplicitOverride: true,
          noImplicitReturns: true,
          noFallthroughCasesInSwitch: true,
        },
      },
      null,
      2,
    ) + '\n',
  );

  // tsconfig.lib.json
  writeFile(
    `${dir}/tsconfig.lib.json`,
    JSON.stringify(
      {
        extends: './tsconfig.json',
        compilerOptions: {
          outDir: `${up}dist/out-tsc`,
          declaration: true,
          types: ['node'],
        },
        include: ['src/**/*.ts'],
        exclude: ['jest.config.ts', 'src/**/*.spec.ts', 'src/**/*.test.ts'],
      },
      null,
      2,
    ) + '\n',
  );

  // tsconfig.spec.json
  writeFile(
    `${dir}/tsconfig.spec.json`,
    JSON.stringify(
      {
        extends: './tsconfig.json',
        compilerOptions: {
          outDir: `${up}dist/out-tsc`,
          module: 'commonjs',
          types: ['jest', 'node'],
        },
        include: ['jest.config.ts', 'src/**/*.test.ts', 'src/**/*.spec.ts', 'src/**/*.d.ts'],
      },
      null,
      2,
    ) + '\n',
  );

  // jest.config.ts
  const jestThreshold =
    coverage > 0
      ? `\n  coverageThreshold: {\n    global: {\n      branches: ${coverage},\n      functions: ${coverage},\n      lines: ${coverage},\n      statements: ${coverage},\n    },\n  },`
      : '';
  writeFile(
    `${dir}/jest.config.ts`,
    `/* eslint-disable */\nexport default {\n  displayName: '${name}',\n  preset: '${up}jest.preset.js',\n  testEnvironment: 'node',\n  transform: {\n    '^.+\\\\.[tj]s$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.spec.json' }],\n  },\n  moduleFileExtensions: ['ts', 'js', 'html'],\n  coverageDirectory: '${up}coverage/${dir}',${jestThreshold}\n};\n`,
  );

  // eslint.config.cjs
  writeFile(
    `${dir}/eslint.config.cjs`,
    `const baseConfig = require('${up}eslint.config.cjs');\nmodule.exports = [...baseConfig];\n`,
  );

  // README.md
  const tagsList = tags.map((t) => '`' + t + '`').join(', ');
  writeFile(
    `${dir}/README.md`,
    `# \`@aquascape/${dir.replace(/^libs\//, '').replace(/\//g, '/')}\`\n\nStage 0 scaffold — empty stub.\n\n- **Tags:** ${tagsList}\n- **Status:** awaiting real implementation in a later feature.\n`,
  );
}

LIBS.forEach(scaffold);
console.log(`Scaffolded ${LIBS.length} libs.`);
