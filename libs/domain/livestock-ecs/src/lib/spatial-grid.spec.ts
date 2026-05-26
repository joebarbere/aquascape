import { SpatialGrid } from './spatial-grid';

describe('SpatialGrid', () => {
  it('rejects non-positive cell sizes at construction', () => {
    expect(() => new SpatialGrid(0)).toThrow();
    expect(() => new SpatialGrid(-1)).toThrow();
    expect(() => new SpatialGrid(Infinity)).toThrow();
    expect(() => new SpatialGrid(NaN)).toThrow();
  });

  it('round-trips inserted entities for in-range queries', () => {
    const g = new SpatialGrid(10);
    g.insert(1, 0, 0, 0);
    g.insert(2, 5, 0, 0);
    g.insert(3, 100, 100, 100); // far away
    const near = Array.from(g.query(0, 0, 0, 10));
    expect(near).toContain(1);
    expect(near).toContain(2);
    expect(near).not.toContain(3);
  });

  it('returns empty for out-of-range queries', () => {
    const g = new SpatialGrid(10);
    g.insert(1, 0, 0, 0);
    const far = g.query(1000, 1000, 1000, 5);
    expect(far.length).toBe(0);
  });

  it('handles negative coordinates (entities near origin can step <0 briefly)', () => {
    const g = new SpatialGrid(10);
    g.insert(7, -5, -5, -5);
    const found = Array.from(g.query(-5, -5, -5, 1));
    expect(found).toContain(7);
  });

  it('reports total entity population via size getter', () => {
    const g = new SpatialGrid(5);
    g.insert(1, 0, 0, 0);
    g.insert(2, 1, 1, 1);
    g.insert(3, 100, 100, 100);
    expect(g.size).toBe(3);
  });

  it('clear() drops every bucket', () => {
    const g = new SpatialGrid(5);
    g.insert(1, 0, 0, 0);
    g.insert(2, 1, 1, 1);
    expect(g.size).toBe(2);
    g.clear();
    expect(g.size).toBe(0);
    expect(g.query(0, 0, 0, 100).length).toBe(0);
  });

  it('rejects negative radii', () => {
    const g = new SpatialGrid(5);
    expect(() => g.query(0, 0, 0, -1)).toThrow();
    expect(() => g.query(0, 0, 0, Infinity)).toThrow();
  });

  it('multiple entities in same cell stack into one bucket', () => {
    const g = new SpatialGrid(10);
    g.insert(1, 1, 1, 1);
    g.insert(2, 2, 2, 2);
    g.insert(3, 9, 9, 9); // still cell (0,0,0) for size 10
    const out = Array.from(g.query(0, 0, 0, 1));
    expect(out.sort()).toEqual([1, 2, 3]);
  });

  it('zero-radius query still hits the containing cell', () => {
    const g = new SpatialGrid(10);
    g.insert(1, 5, 5, 5);
    const out = Array.from(g.query(5, 5, 5, 0));
    expect(out).toContain(1);
  });
});
