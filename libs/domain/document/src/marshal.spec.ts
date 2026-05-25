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

  it('puts livestock on the scene (F7.1 promotion)', () => {
    const { scene } = documentToScene(EXAMPLE);
    expect(scene.livestock).toEqual(EXAMPLE.livestock);
  });

  it('omits scene.livestock when the source doc omits it', () => {
    const noLivestock = structuredClone(EXAMPLE);
    delete noLivestock.livestock;
    const { scene } = documentToScene(noLivestock);
    expect('livestock' in scene).toBe(false);
  });

  it('captures meta + remaining optional fields in the envelope', () => {
    const { envelope } = documentToScene(EXAMPLE);
    expect(envelope.meta).toEqual(EXAMPLE.meta);
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

  it('omits optional fields from the saved doc when the envelope + scene omit them', () => {
    const { scene } = documentToScene(EXAMPLE);
    // The example does carry livestock — strip it from the scene so the
    // "omit when absent" path is exercised end-to-end.
    const { livestock: _l, ...sceneNoLivestock } = scene;
    const envelopeOnlyMeta = { meta: EXAMPLE.meta };
    const saved = sceneToDocument(sceneNoLivestock, envelopeOnlyMeta);
    expect('livestock' in saved).toBe(false);
    expect('equipment' in saved).toBe(false);
    expect('renderHistory' in saved).toBe(false);
    expect('extensions' in saved).toBe(false);
  });

  it('saves livestock from the scene, not the envelope (F7.1 asymmetry)', () => {
    const { scene, envelope } = documentToScene(EXAMPLE);
    // Mutate scene.livestock; saved doc must reflect scene, not envelope.
    const editedLivestock = [
      {
        id: '99999999-0000-4000-8000-000000099999',
        ref: { catalog: 'core', id: 'fish.added', version: 1 },
        quantity: 5,
      },
    ];
    const saved = sceneToDocument({ ...scene, livestock: editedLivestock }, envelope);
    expect(saved.livestock).toEqual(editedLivestock);
  });
});
