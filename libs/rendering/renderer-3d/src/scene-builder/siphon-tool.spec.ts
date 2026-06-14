import { Group, Mesh, MeshStandardMaterial } from 'three';
import { buildSiphonTool } from './siphon-tool';

describe('buildSiphonTool — construction', () => {
  it('returns a handle whose group is a named THREE.Group', () => {
    const tool = buildSiphonTool();
    expect(tool.group).toBeInstanceOf(Group);
    expect(tool.group.name).toBe('aquascape:siphon-tool');
    tool.dispose();
  });

  it('builds nozzle meshes (body + stem + indicator) with geometry + material', () => {
    const tool = buildSiphonTool();
    const meshes: Mesh[] = [];
    tool.group.traverse((n) => {
      if ((n as Mesh).isMesh) meshes.push(n as Mesh);
    });
    expect(meshes.length).toBe(3);
    for (const m of meshes) {
      expect(m.geometry).toBeDefined();
      expect(m.material).toBeDefined();
    }
    tool.dispose();
  });

  it('starts in idle mode with the flow indicator hidden', () => {
    const tool = buildSiphonTool();
    expect(tool.getMode()).toBe('idle');
    const indicator = tool.group.getObjectByName('aquascape:siphon-tool/indicator');
    expect(indicator?.visible).toBe(false);
    tool.dispose();
  });
});

describe('buildSiphonTool — placement (canonical doc coords)', () => {
  it('positions the group at the raw doc coordinate (parent mirror flips X)', () => {
    const tool = buildSiphonTool();
    tool.setPosition({ x: 250, y: 0, z: 120 });
    expect(tool.group.position.x).toBe(250);
    expect(tool.group.position.y).toBe(0);
    expect(tool.group.position.z).toBe(120);
    expect(tool.getPosition()).toEqual({ x: 250, y: 0, z: 120 });
    tool.dispose();
  });

  it('updates position in place on repeated setPosition calls', () => {
    const tool = buildSiphonTool();
    tool.setPosition({ x: 10, y: 1, z: 2 });
    tool.setPosition({ x: 400, y: 5, z: 90 });
    expect(tool.getPosition()).toEqual({ x: 400, y: 5, z: 90 });
    tool.dispose();
  });
});

describe('buildSiphonTool — OUT/IN mode toggles', () => {
  function bodyColorHex(tool: ReturnType<typeof buildSiphonTool>): number {
    const body = tool.group.getObjectByName('aquascape:siphon-tool/body') as Mesh;
    return (body.material as MeshStandardMaterial).color.getHex();
  }

  it('shows the indicator + recolours the body in OUT mode', () => {
    const tool = buildSiphonTool();
    const idleColor = bodyColorHex(tool);
    tool.setMode('out');
    expect(tool.getMode()).toBe('out');
    const indicator = tool.group.getObjectByName('aquascape:siphon-tool/indicator');
    expect(indicator?.visible).toBe(true);
    expect(bodyColorHex(tool)).not.toBe(idleColor);
    tool.dispose();
  });

  it('OUT and IN modes use distinct body colours', () => {
    const tool = buildSiphonTool();
    tool.setMode('out');
    const outColor = bodyColorHex(tool);
    tool.setMode('in');
    const inColor = bodyColorHex(tool);
    expect(outColor).not.toBe(inColor);
    tool.dispose();
  });

  it('returns to idle (indicator hidden) when set back to idle', () => {
    const tool = buildSiphonTool();
    tool.setMode('out');
    tool.setMode('idle');
    const indicator = tool.group.getObjectByName('aquascape:siphon-tool/indicator');
    expect(indicator?.visible).toBe(false);
    expect(tool.getMode()).toBe('idle');
    tool.dispose();
  });
});

describe('buildSiphonTool — dispose discipline', () => {
  it('disposes every geometry + material exactly once', () => {
    const tool = buildSiphonTool();
    const geoSpies: jest.SpyInstance[] = [];
    const matSpies: jest.SpyInstance[] = [];
    tool.group.traverse((n) => {
      if ((n as Mesh).isMesh) {
        const m = n as Mesh;
        geoSpies.push(jest.spyOn(m.geometry, 'dispose'));
        matSpies.push(jest.spyOn(m.material as MeshStandardMaterial, 'dispose'));
      }
    });
    tool.dispose();
    for (const s of [...geoSpies, ...matSpies]) expect(s).toHaveBeenCalledTimes(1);
  });

  it('is idempotent — a second dispose does not re-release resources', () => {
    const tool = buildSiphonTool();
    const body = tool.group.getObjectByName('aquascape:siphon-tool/body') as Mesh;
    const spy = jest.spyOn(body.geometry, 'dispose');
    tool.dispose();
    tool.dispose();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('no-ops setPosition / setMode after dispose', () => {
    const tool = buildSiphonTool();
    tool.dispose();
    tool.setPosition({ x: 99, y: 99, z: 99 });
    tool.setMode('out');
    // Position + mode unchanged from their pre-dispose defaults.
    expect(tool.getPosition()).toEqual({ x: 0, y: 0, z: 0 });
    expect(tool.getMode()).toBe('idle');
  });
});
