import {
  asLayerId,
  asObjectId,
  defaultIdFactory,
  newLayerId,
  newObjectId,
  setIdFactory,
} from './ids';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('ids', () => {
  afterEach(() => {
    setIdFactory(undefined);
  });

  it('newObjectId() returns a UUID v4 string by default', () => {
    const id = newObjectId();
    expect(typeof id).toBe('string');
    expect(id).toMatch(UUID_RE);
  });

  it('newLayerId() returns a UUID v4 string by default', () => {
    const id = newLayerId();
    expect(id).toMatch(UUID_RE);
  });

  it('two minted ids are distinct', () => {
    expect(newObjectId()).not.toEqual(newObjectId());
    expect(newLayerId()).not.toEqual(newLayerId());
  });

  it('asObjectId / asLayerId brand existing strings', () => {
    expect(asObjectId('deadbeef-0000-4000-8000-000000000000')).toBe(
      'deadbeef-0000-4000-8000-000000000000',
    );
    expect(asLayerId('deadbeef-0000-4000-8000-000000000001')).toBe(
      'deadbeef-0000-4000-8000-000000000001',
    );
  });

  it('setIdFactory swaps in a deterministic source', () => {
    let counter = 0;
    setIdFactory({ uuid: () => `00000000-0000-4000-8000-${String(counter++).padStart(12, '0')}` });
    expect(newObjectId()).toBe('00000000-0000-4000-8000-000000000000');
    expect(newLayerId()).toBe('00000000-0000-4000-8000-000000000001');
  });

  it('setIdFactory(undefined) restores the default', () => {
    setIdFactory({ uuid: () => 'fixed' });
    expect(newObjectId()).toBe('fixed');
    setIdFactory(undefined);
    expect(newObjectId()).toMatch(UUID_RE);
  });

  it('defaultIdFactory yields v4 UUIDs', () => {
    expect(defaultIdFactory.uuid()).toMatch(UUID_RE);
  });
});
