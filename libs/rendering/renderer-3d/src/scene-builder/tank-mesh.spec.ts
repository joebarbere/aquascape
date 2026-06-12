import { LineSegments, Mesh, MeshPhysicalMaterial } from 'three';
import type { Tank } from '@aquascape/domain/scene-model';
import { buildTankMesh } from './tank-mesh';

function tank(overrides: Partial<Tank> = {}): Tank {
  return {
    width: 600,
    height: 360,
    depth: 300,
    style: { frame: 'rimless', background: { kind: 'none' } },
    ...overrides,
  };
}

function meshes(g: { children: ReadonlyArray<unknown> }): Mesh[] {
  return g.children.filter((c) => c instanceof Mesh) as Mesh[];
}

describe('tank-mesh builder', () => {
  it('produces a glass-box mesh centred so its front-bottom-left is at the origin', () => {
    const group = buildTankMesh(tank());
    const glass = group.children.find(
      (m) => m instanceof Mesh && m.name === 'aquascape:tank/glass',
    ) as Mesh;
    expect(glass).toBeDefined();
    // Position is the box centre (w/2, h/2, d/2).
    expect(glass.position.x).toBeCloseTo(300, 5);
    expect(glass.position.y).toBeCloseTo(180, 5);
    expect(glass.position.z).toBeCloseTo(150, 5);
  });

  it('uses a physically-based transmissive glass material (fidelity pass)', () => {
    const group = buildTankMesh(tank());
    const glass = group.children.find(
      (m) => m instanceof Mesh && m.name === 'aquascape:tank/glass',
    ) as Mesh;
    const mat = glass.material as MeshPhysicalMaterial;
    expect(mat).toBeInstanceOf(MeshPhysicalMaterial);
    expect(mat.transmission).toBeGreaterThan(0);
    expect(mat.ior).toBeGreaterThan(1);
    // Glass neither casts nor receives shadows.
    expect(glass.castShadow).toBe(false);
    expect(glass.receiveShadow).toBe(false);
    // A faint inner sheen shell is parented to the glass for silhouette legibility.
    const sheen = glass.children.find((c) => c.name === 'aquascape:tank/glass-sheen');
    expect(sheen).toBeDefined();
  });

  it('omits the frame group when style.frame is rimless', () => {
    const group = buildTankMesh(tank({ style: { frame: 'rimless', background: { kind: 'none' } } }));
    const hasFrame = group.children.some((c) => c.name === 'aquascape:tank/frame');
    expect(hasFrame).toBe(false);
  });

  it('builds top + bottom rim + corner edges for framed tanks', () => {
    const group = buildTankMesh(tank({ style: { frame: 'framed', background: { kind: 'none' } } }));
    const frame = group.children.find((c) => c.name === 'aquascape:tank/frame');
    expect(frame).toBeDefined();
    // Top + bottom rims are Meshes; the corner outline is a LineSegments.
    const frameMeshes = meshes(frame as { children: ReadonlyArray<unknown> });
    expect(frameMeshes.some((m) => m.name === 'aquascape:tank/frame/top')).toBe(true);
    expect(frameMeshes.some((m) => m.name === 'aquascape:tank/frame/bottom')).toBe(true);
    const hasEdges = (frame as { children: ReadonlyArray<unknown> }).children.some(
      (c) => c instanceof LineSegments,
    );
    expect(hasEdges).toBe(true);
  });

  it('adds a centre brace for braced tanks', () => {
    const group = buildTankMesh(tank({ style: { frame: 'braced', background: { kind: 'none' } } }));
    const frame = group.children.find((c) => c.name === 'aquascape:tank/frame') as {
      children: ReadonlyArray<unknown>;
    };
    const frameMeshes = meshes(frame);
    expect(frameMeshes.some((m) => m.name === 'aquascape:tank/frame/brace')).toBe(true);
  });

  it('never builds the retired static water plane — even when waterTint is set', () => {
    // The Stage 10 v1 `aquascape:tank/water` plane was retired: the tint
    // now rides the renderer-level ANIMATED surface (water-mesh.ts).
    // Regression: two stacked water planes 25 mm apart read as a bug.
    const tinted = buildTankMesh(
      tank({
        style: { frame: 'rimless', background: { kind: 'none' }, waterTint: '#88ccff' },
      }),
    );
    expect(tinted.children.some((c) => c.name === 'aquascape:tank/water')).toBe(false);
    const untinted = buildTankMesh(tank());
    expect(untinted.children.some((c) => c.name === 'aquascape:tank/water')).toBe(false);
  });

  describe('open-topped glass (aquariums have no lid)', () => {
    /**
     * True when the mesh's geometry contains at least one triangle whose
     * three vertices ALL sit on the given local-Y plane — i.e. a face
     * coplanar with that horizontal plane.
     */
    function hasFaceAtY(mesh: Mesh, y: number): boolean {
      const geo = mesh.geometry;
      const index = geo.getIndex();
      const pos = geo.getAttribute('position');
      if (index === null) return false;
      const eps = 1e-4;
      for (let i = 0; i < index.count; i += 3) {
        const ys = [index.getX(i), index.getX(i + 1), index.getX(i + 2)].map((v) =>
          pos.getY(v),
        );
        if (ys.every((v) => Math.abs(v - y) < eps)) return true;
      }
      return false;
    }

    it('the transmissive glass box has no top face but keeps its bottom', () => {
      const group = buildTankMesh(tank());
      const glass = group.children.find(
        (m) => m instanceof Mesh && m.name === 'aquascape:tank/glass',
      ) as Mesh;
      // Local frame is centred: lid would be at +height/2, floor at −height/2.
      expect(hasFaceAtY(glass, 180)).toBe(false);
      expect(hasFaceAtY(glass, -180)).toBe(true);
    });

    it('the inner sheen shell is open-topped too', () => {
      const group = buildTankMesh(tank());
      const glass = group.children.find(
        (m) => m instanceof Mesh && m.name === 'aquascape:tank/glass',
      ) as Mesh;
      const sheen = glass.children.find(
        (c) => c.name === 'aquascape:tank/glass-sheen',
      ) as Mesh;
      expect(hasFaceAtY(sheen, 180)).toBe(false);
      expect(hasFaceAtY(sheen, -180)).toBe(true);
    });
  });
});
