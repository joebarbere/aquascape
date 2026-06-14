import type { FoodEntry } from '@aquascape/domain/catalog';
import type { Vec3 } from '@aquascape/domain/geometry';
import type { SimulationInteractionRenderer } from '@aquascape/rendering/renderer-api';

import { resolveFoodDrop, type FoodSpawner } from './feeding-drop';

const FOOD: FoodEntry = {
  kind: 'food',
  id: 'food.tetra.flakes',
  version: 1,
  name: 'TetraMin Flakes',
  type: 'flake',
  brand: 'Tetra',
  wasteFactor: 0.4,
  color: '#caa24a',
};

const POINT = { x: 100, y: 80, width: 800, height: 600 };

function mockRenderer(result: Vec3 | null): {
  renderer: SimulationInteractionRenderer;
  raycast: jest.Mock;
} {
  const raycast = jest.fn().mockReturnValue(result);
  const renderer = {
    raycastTankPoint: raycast,
    setSiphonPosition: jest.fn(),
    setSiphonMode: jest.fn(),
  } as unknown as SimulationInteractionRenderer;
  return { renderer, raycast };
}

function mockSpawner(): { spawner: FoodSpawner; spawn: jest.Mock } {
  const spawn = jest.fn().mockReturnValue(1);
  return { spawner: { spawnFoodFromCatalog: spawn }, spawn };
}

describe('resolveFoodDrop', () => {
  it('raycasts the pixel to the floor + spawns the armed food there', () => {
    const drop = { x: 250, y: 0, z: 180 };
    const { renderer, raycast } = mockRenderer(drop);
    const { spawner, spawn } = mockSpawner();

    const result = resolveFoodDrop(POINT, {
      renderer,
      foodId: FOOD.id,
      foods: [FOOD],
      spawner,
    });

    expect(raycast).toHaveBeenCalledWith(POINT, { plane: 'floor' });
    expect(spawn).toHaveBeenCalledWith(drop, FOOD);
    expect(result).toEqual(drop);
  });

  it('no-ops when no food is armed', () => {
    const { renderer, raycast } = mockRenderer({ x: 1, y: 0, z: 1 });
    const { spawner, spawn } = mockSpawner();
    const result = resolveFoodDrop(POINT, { renderer, foodId: null, foods: [FOOD], spawner });
    expect(result).toBeNull();
    expect(raycast).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('no-ops when the renderer is unavailable (2D-only / stub)', () => {
    const { spawner, spawn } = mockSpawner();
    const result = resolveFoodDrop(POINT, {
      renderer: null,
      foodId: FOOD.id,
      foods: [FOOD],
      spawner,
    });
    expect(result).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('no-ops when the armed food id is missing from the catalog', () => {
    const { renderer } = mockRenderer({ x: 1, y: 0, z: 1 });
    const { spawner, spawn } = mockSpawner();
    const result = resolveFoodDrop(POINT, {
      renderer,
      foodId: 'food.does-not-exist',
      foods: [FOOD],
      spawner,
    });
    expect(result).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('no-ops when the ray misses the plane (raycast returns null)', () => {
    const { renderer } = mockRenderer(null);
    const { spawner, spawn } = mockSpawner();
    const result = resolveFoodDrop(POINT, {
      renderer,
      foodId: FOOD.id,
      foods: [FOOD],
      spawner,
    });
    expect(result).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });

  it('no-ops when the point is null (canvas un-sized)', () => {
    const { renderer } = mockRenderer({ x: 1, y: 0, z: 1 });
    const { spawner, spawn } = mockSpawner();
    const result = resolveFoodDrop(null, {
      renderer,
      foodId: FOOD.id,
      foods: [FOOD],
      spawner,
    });
    expect(result).toBeNull();
    expect(spawn).not.toHaveBeenCalled();
  });
});
