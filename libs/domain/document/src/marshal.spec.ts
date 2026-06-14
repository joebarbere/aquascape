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

  it('carries tank.waterLevelMm onto the scene when present (v3)', () => {
    expect(EXAMPLE.tank.waterLevelMm).toBe(190); // fixture authors an override
    const { scene } = documentToScene(EXAMPLE);
    expect(scene.tank.waterLevelMm).toBe(190);
  });

  it('leaves tank.waterLevelMm absent on the scene when the doc omits it (no defaulting)', () => {
    const noLevel = structuredClone(EXAMPLE);
    delete noLevel.tank.waterLevelMm;
    const { scene } = documentToScene(noLevel);
    // Absent must stay ABSENT — the default fill is derived at render time
    // via scene-model's effectiveWaterLevelMm; the marshal must never
    // materialise it into the scene (or, on save, into the document).
    expect('waterLevelMm' in scene.tank).toBe(false);
  });

  it('carries tank.waterChemistry onto the scene verbatim when present (v4)', () => {
    expect(EXAMPLE.tank.waterChemistry).toBeDefined(); // fixture authors a snapshot
    const { scene } = documentToScene(EXAMPLE);
    expect(scene.tank.waterChemistry).toEqual(EXAMPLE.tank.waterChemistry);
  });

  it('leaves tank.waterChemistry absent on the scene when the doc omits it (no defaulting)', () => {
    const noChem = structuredClone(EXAMPLE);
    delete noChem.tank.waterChemistry;
    const { scene } = documentToScene(noChem);
    // Absent must stay ABSENT — "no chemistry recorded" must never be
    // materialised into an invented snapshot by the marshal.
    expect('waterChemistry' in scene.tank).toBe(false);
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

  it('puts equipment on the scene (F7.3 promotion)', () => {
    const { scene } = documentToScene(EXAMPLE);
    expect(scene.equipment).toEqual(EXAMPLE.equipment);
  });

  it('omits scene.equipment when the source doc omits it', () => {
    const noEquipment = structuredClone(EXAMPLE);
    delete noEquipment.equipment;
    const { scene } = documentToScene(noEquipment);
    expect('equipment' in scene).toBe(false);
  });

  it('captures meta + remaining optional fields in the envelope', () => {
    const { envelope } = documentToScene(EXAMPLE);
    expect(envelope.meta).toEqual(EXAMPLE.meta);
    expect(envelope.extensions).toEqual(EXAMPLE.extensions);
  });

  it('envelope no longer carries equipment (F7.3 promotion)', () => {
    const { envelope } = documentToScene(EXAMPLE);
    // After F7.3 (and the v5 renderHistory removal) the envelope is strictly
    // { meta, extensions? }.
    expect('equipment' in envelope).toBe(false);
  });

  it('omits optional fields from the envelope when the source doc omits them', () => {
    const noOptionals = structuredClone(EXAMPLE);
    delete noOptionals.livestock;
    delete noOptionals.equipment;
    delete noOptionals.extensions;
    const { envelope } = documentToScene(noOptionals);
    expect(envelope.extensions).toBeUndefined();
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
    // The example carries livestock + equipment — strip them from the scene
    // so the "omit when absent" path is exercised end-to-end.
    const { livestock: _l, equipment: _e, ...sceneNoOptionals } = scene;
    const envelopeOnlyMeta = { meta: EXAMPLE.meta };
    const saved = sceneToDocument(sceneNoOptionals, envelopeOnlyMeta);
    expect('livestock' in saved).toBe(false);
    expect('equipment' in saved).toBe(false);
    expect('extensions' in saved).toBe(false);
  });

  it('round-trips tank.waterLevelMm: present stays present, absent stays absent', () => {
    // Present → present (the canonical example authors 190).
    const { scene, envelope } = documentToScene(EXAMPLE);
    expect(sceneToDocument(scene, envelope).tank.waterLevelMm).toBe(190);

    // Absent → absent: strip the field from the scene tank and assert the
    // saved doc does NOT materialise the render-time default.
    const { waterLevelMm: _stripped, ...tankNoLevel } = scene.tank;
    const saved = sceneToDocument({ ...scene, tank: tankNoLevel }, envelope);
    expect('waterLevelMm' in saved.tank).toBe(false);
  });

  it('round-trips tank.waterChemistry: present stays present (lossless), absent stays absent', () => {
    // Present → present, byte-for-byte (the canonical example authors a snapshot).
    const { scene, envelope } = documentToScene(EXAMPLE);
    expect(sceneToDocument(scene, envelope).tank.waterChemistry).toEqual(
      EXAMPLE.tank.waterChemistry,
    );

    // Absent → absent: strip the field from the scene tank and assert the
    // saved doc does NOT materialise an invented chemistry snapshot.
    const { waterChemistry: _stripped, ...tankNoChem } = scene.tank;
    const saved = sceneToDocument({ ...scene, tank: tankNoChem }, envelope);
    expect('waterChemistry' in saved.tank).toBe(false);
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

  it('saves equipment from the scene, not the envelope (F7.3 symmetry)', () => {
    const { scene, envelope } = documentToScene(EXAMPLE);
    // Mutate scene.equipment; saved doc must reflect scene.
    const editedEquipment = [
      {
        id: '88888888-0000-4000-8000-000000088888',
        ref: { catalog: 'core', id: 'filter.canister.test', version: 1 },
        settings: { wattage: 12 },
      },
    ];
    const saved = sceneToDocument({ ...scene, equipment: editedEquipment }, envelope);
    expect(saved.equipment).toEqual(editedEquipment);
  });
});
