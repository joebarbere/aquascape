import { asLayerId, asObjectId } from './ids';
import {
  getActiveLayer,
  getLayerById,
  getObjectById,
  getObjectWithLayer,
  iterateObjects,
} from './selectors';
import { makeScene } from './test-fixtures';

describe('selectors', () => {
  describe('getObjectById', () => {
    it('returns the object when present', () => {
      const scene = makeScene();
      const id = asObjectId('aaaaaaaa-0000-4000-8000-000000000001');
      expect(getObjectById(scene, id)?.id).toBe(id);
    });

    it('returns null when missing', () => {
      const scene = makeScene();
      expect(getObjectById(scene, asObjectId('missing'))).toBeNull();
    });

    it('returns null on an empty scene', () => {
      const scene = makeScene();
      scene.layers = [];
      expect(getObjectById(scene, asObjectId('anything'))).toBeNull();
    });
  });

  describe('getObjectWithLayer', () => {
    it('returns the owning layer alongside the object', () => {
      const scene = makeScene();
      const id = asObjectId('bbbbbbbb-0000-4000-8000-000000000001');
      const result = getObjectWithLayer(scene, id);
      expect(result?.object.id).toBe(id);
      expect(result?.layer.name).toBe('Carpet');
    });

    it('returns null when no layer owns the id', () => {
      const scene = makeScene();
      expect(getObjectWithLayer(scene, asObjectId('nope'))).toBeNull();
    });
  });

  describe('getLayerById', () => {
    it('returns the layer when present', () => {
      const scene = makeScene();
      const id = asLayerId('11111111-0000-4000-8000-000000000001');
      expect(getLayerById(scene, id)?.id).toBe(id);
    });

    it('returns null when missing', () => {
      const scene = makeScene();
      expect(getLayerById(scene, asLayerId('missing'))).toBeNull();
    });
  });

  describe('getActiveLayer', () => {
    it('returns null when active id is null', () => {
      const scene = makeScene();
      expect(getActiveLayer(scene, null)).toBeNull();
    });

    it('resolves a present id', () => {
      const scene = makeScene();
      const id = asLayerId('11111111-0000-4000-8000-000000000002');
      expect(getActiveLayer(scene, id)?.name).toBe('Carpet');
    });

    it('returns null for an unknown id', () => {
      const scene = makeScene();
      expect(getActiveLayer(scene, asLayerId('absent'))).toBeNull();
    });
  });

  describe('iterateObjects', () => {
    it('yields objects in render order: layer asc, then object asc', () => {
      const scene = makeScene();
      const ids = Array.from(iterateObjects(scene), ({ object }) => object.id);
      expect(ids).toEqual([
        'aaaaaaaa-0000-4000-8000-000000000001',
        'aaaaaaaa-0000-4000-8000-000000000002',
        'bbbbbbbb-0000-4000-8000-000000000001',
      ]);
    });

    it('yields nothing for a scene with no layers', () => {
      const scene = makeScene();
      scene.layers = [];
      expect(Array.from(iterateObjects(scene))).toEqual([]);
    });

    it('does not filter by visibility or opacity', () => {
      const scene = makeScene();
      scene.layers[0]!.visible = false;
      scene.layers[1]!.opacity = 0;
      const count = Array.from(iterateObjects(scene)).length;
      expect(count).toBe(3);
    });

    it('exposes the owning layer alongside each object', () => {
      const scene = makeScene();
      for (const { layer, object } of iterateObjects(scene)) {
        expect(layer.objects).toContain(object);
      }
    });
  });
});
