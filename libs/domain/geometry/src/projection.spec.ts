import fc from 'fast-check';
import { project2D } from './projection';

const finite = (): fc.Arbitrary<number> => fc.double({ min: -1e6, max: 1e6, noNaN: true });

describe('project2D', () => {
  it('drops z, keeps x and y', () => {
    expect(project2D({ x: 1, y: 2, z: 3 })).toEqual({ x: 1, y: 2 });
  });

  it('handles z = 0', () => {
    expect(project2D({ x: 5, y: -7, z: 0 })).toEqual({ x: 5, y: -7 });
  });

  it('does not mutate input', () => {
    const v = { x: 1, y: 2, z: 3 };
    project2D(v);
    expect(v).toEqual({ x: 1, y: 2, z: 3 });
  });

  it('property: project2D is a left-inverse for any Vec3 with z = 0', () => {
    fc.assert(
      fc.property(finite(), finite(), (x, y) => {
        const p = project2D({ x, y, z: 0 });
        expect(p).toEqual({ x, y });
      }),
    );
  });
});
