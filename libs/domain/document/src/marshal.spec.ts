import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import type { AquaDocument } from './aqua-document';
import { CURRENT_SCHEMA_VERSION } from './aqua-document';
import { documentToScene, sceneToDocument } from './marshal';

const EXAMPLE: AquaDocument = JSON.parse(
  readFileSync(resolve(__dirname, '../../../../example.aqua.json'), 'utf8'),
);

describe('documentToScene', () => {
  it('returns the scene tank/substrate/layers and the seed from meta', () => {
    const { scene } = documentToScene(EXAMPLE);
    expect(scene.tank).toEqual(EXAMPLE.tank);
    expect(scene.substrate).toEqual(EXAMPLE.substrate);
    expect(scene.layers).toEqual(EXAMPLE.layers);
    expect(scene.seed).toBe(EXAMPLE.meta.seed);
  });

  it('captures meta + optional fields in the envelope', () => {
    const { envelope } = documentToScene(EXAMPLE);
    expect(envelope.meta).toEqual(EXAMPLE.meta);
    expect(envelope.livestock).toEqual(EXAMPLE.livestock);
    expect(envelope.equipment).toEqual(EXAMPLE.equipment);
    expect(envelope.extensions).toEqual(EXAMPLE.extensions);
  });

  it('omits optional fields from the envelope when the source doc omits them', () => {
    const noOptionals = structuredClone(EXAMPLE);
    delete noOptionals.livestock;
    delete noOptionals.equipment;
    delete noOptionals.extensions;
    delete noOptionals.renderHistory;
    const { envelope } = documentToScene(noOptionals);
    expect(envelope.livestock).toBeUndefined();
    expect(envelope.equipment).toBeUndefined();
    expect(envelope.extensions).toBeUndefined();
    expect(envelope.renderHistory).toBeUndefined();
  });
});

describe('sceneToDocument', () => {
  it('is the inverse of documentToScene (lossless round-trip)', () => {
    const { scene, envelope } = documentToScene(EXAMPLE);
    const round = sceneToDocument(scene, envelope);
    expect(round).toEqual(EXAMPLE);
  });

  it('preserves unknown extensions through a round-trip', () => {
    const withExt = structuredClone(EXAMPLE);
    withExt.extensions = { 'community:my-tool': { v: 1, custom: ['anything'] } };
    const { scene, envelope } = documentToScene(withExt);
    expect(sceneToDocument(scene, envelope).extensions).toEqual(withExt.extensions);
  });

  it('bumps schemaVersion to the writer-current version on save', () => {
    const v1 = structuredClone(EXAMPLE);
    v1.schemaVersion = 1;
    const { scene, envelope } = documentToScene(v1);
    const saved = sceneToDocument(scene, envelope);
    expect(saved.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('writes scene.seed into meta.seed (scene is the live source of truth)', () => {
    const { scene, envelope } = documentToScene(EXAMPLE);
    const edited = { ...scene, seed: 99999 };
    const saved = sceneToDocument(edited, envelope);
    expect(saved.meta.seed).toBe(99999);
  });

  it('always writes the "aquascape" format discriminator', () => {
    const { scene, envelope } = documentToScene(EXAMPLE);
    expect(sceneToDocument(scene, envelope).format).toBe('aquascape');
  });

  it('omits optional fields from the saved doc when the envelope omits them', () => {
    const { scene } = documentToScene(EXAMPLE);
    const envelopeOnlyMeta = { meta: EXAMPLE.meta };
    const saved = sceneToDocument(scene, envelopeOnlyMeta);
    expect('livestock' in saved).toBe(false);
    expect('equipment' in saved).toBe(false);
    expect('renderHistory' in saved).toBe(false);
    expect('extensions' in saved).toBe(false);
  });
});
