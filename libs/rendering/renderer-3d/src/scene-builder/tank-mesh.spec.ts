import { LineSegments, Mesh } from 'three';
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

  it('skips the water plane when waterTint is undefined', () => {
    const group = buildTankMesh(tank());
    const hasWater = group.children.some((c) => c.name === 'aquascape:tank/water');
    expect(hasWater).toBe(false);
  });

  it('adds a horizontal water plane just below the rim when waterTint is set', () => {
    const group = buildTankMesh(
      tank({
        style: {
          frame: 'rimless',
          background: { kind: 'none' },
          waterTint: '#88ccff',
        },
      }),
    );
    const water = group.children.find((c) => c.name === 'aquascape:tank/water') as Mesh;
    expect(water).toBeDefined();
    // Plane is rotated −π/2 about X axis so it lies in the XZ plane.
    expect(water.rotation.x).toBeCloseTo(-Math.PI / 2, 5);
    // Y position is height − WATER_LINE_GAP_MM (30).
    expect(water.position.y).toBeCloseTo(360 - 30, 5);
  });
});
