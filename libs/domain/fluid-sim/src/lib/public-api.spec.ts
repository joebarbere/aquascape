import * as api from '../index';

describe('public API surface', () => {
  it('exports the three bake/sample functions + the slice step', () => {
    expect(typeof api.bakeFlowField).toBe('function');
    expect(typeof api.sampleFlowField).toBe('function');
    expect(typeof api.createBubbleSlice).toBe('function');
    expect(typeof api.stepBubbleSlice).toBe('function');
    expect(typeof api.bakeHardscapeSdf).toBe('function');
    expect(typeof api.sampleSdf).toBe('function');
    expect(typeof api.sampleSdfGradient).toBe('function');
  });
});
