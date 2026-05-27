import { archetypeForSpecies } from './archetype-for-species';

describe('archetypeForSpecies', () => {
  describe('tag-based mapping', () => {
    it('maps tetra tag → slim-tetra', () => {
      expect(archetypeForSpecies({ tags: ['tetra'] })).toBe('slim-tetra');
    });
    it('maps rasbora tag → slim-tetra', () => {
      expect(archetypeForSpecies({ tags: ['rasbora'] })).toBe('slim-tetra');
    });
    it('maps danio tag → slim-tetra', () => {
      expect(archetypeForSpecies({ tags: ['danio'] })).toBe('slim-tetra');
    });
    it('maps gourami tag → deep-bodied', () => {
      expect(archetypeForSpecies({ tags: ['gourami'] })).toBe('deep-bodied');
    });
    it('maps angelfish tag → deep-bodied', () => {
      expect(archetypeForSpecies({ tags: ['angelfish'] })).toBe('deep-bodied');
    });
    it('maps discus tag → deep-bodied', () => {
      expect(archetypeForSpecies({ tags: ['discus'] })).toBe('deep-bodied');
    });
    it('maps barb tag → barb', () => {
      expect(archetypeForSpecies({ tags: ['barb'] })).toBe('barb');
    });
    it('maps cichlid tag → barb', () => {
      expect(archetypeForSpecies({ tags: ['cichlid'] })).toBe('barb');
    });
    it('maps cory tag → cory-cylinder', () => {
      expect(archetypeForSpecies({ tags: ['cory'] })).toBe('cory-cylinder');
    });
    it('maps pleco tag → cory-cylinder', () => {
      expect(archetypeForSpecies({ tags: ['pleco'] })).toBe('cory-cylinder');
    });
    it('maps loach tag → cory-cylinder', () => {
      expect(archetypeForSpecies({ tags: ['loach'] })).toBe('cory-cylinder');
    });
    it('maps otocinclus tag → cory-cylinder', () => {
      expect(archetypeForSpecies({ tags: ['otocinclus'] })).toBe('cory-cylinder');
    });
    it('maps kuhli tag → eel', () => {
      expect(archetypeForSpecies({ tags: ['kuhli'] })).toBe('eel');
    });
    it('maps eel tag → eel', () => {
      expect(archetypeForSpecies({ tags: ['eel'] })).toBe('eel');
    });
    it('maps hatchetfish tag → hatchet-wedge', () => {
      expect(archetypeForSpecies({ tags: ['hatchetfish'] })).toBe('hatchet-wedge');
    });
    it('maps pencilfish tag → hatchet-wedge', () => {
      expect(archetypeForSpecies({ tags: ['pencilfish'] })).toBe('hatchet-wedge');
    });
    it('matches the first known tag and ignores later ones', () => {
      expect(archetypeForSpecies({ tags: ['unknown', 'cory', 'tetra'] })).toBe('cory-cylinder');
    });
    it('is case-insensitive', () => {
      expect(archetypeForSpecies({ tags: ['Hatchetfish'] })).toBe('hatchet-wedge');
    });
    it('skips unknown tags and falls back through to default', () => {
      expect(archetypeForSpecies({ tags: ['unknown-clade'] })).toBe('slim-tetra');
    });
  });

  describe('group-based mapping', () => {
    it('maps catalog group=shrimp to crawler (F11.6 Wave 2)', () => {
      expect(archetypeForSpecies({ group: 'shrimp' })).toBe('crawler');
    });
    it('maps catalog group=snail to crawler (F11.6 Wave 2)', () => {
      expect(archetypeForSpecies({ group: 'snail' })).toBe('crawler');
    });
    it('is case-insensitive for shrimp/snail group strings', () => {
      expect(archetypeForSpecies({ group: 'Shrimp' })).toBe('crawler');
      expect(archetypeForSpecies({ group: 'SNAIL' })).toBe('crawler');
    });
    it('still maps catalog group=fish through the id sniff (regression vs F11.6)', () => {
      // Adding the crawler branch must not change the fish/unknown
      // fall-through to id substring matching.
      expect(archetypeForSpecies({ group: 'fish', id: 'cardinal-tetra' })).toBe('slim-tetra');
      expect(archetypeForSpecies({ group: 'fish', id: 'tiger-barb' })).toBe('barb');
    });
    it('treats group=tetra as slim-tetra', () => {
      expect(archetypeForSpecies({ group: 'tetra' })).toBe('slim-tetra');
    });
    it('treats group=gourami as deep-bodied', () => {
      expect(archetypeForSpecies({ group: 'gourami' })).toBe('deep-bodied');
    });
    it('treats group=barb as barb', () => {
      expect(archetypeForSpecies({ group: 'barb' })).toBe('barb');
    });
    it('treats group=cory as cory-cylinder', () => {
      expect(archetypeForSpecies({ group: 'cory' })).toBe('cory-cylinder');
    });
    it('treats group=kuhli as eel', () => {
      expect(archetypeForSpecies({ group: 'kuhli' })).toBe('eel');
    });
    it('treats group=hatchetfish as hatchet-wedge', () => {
      expect(archetypeForSpecies({ group: 'hatchetfish' })).toBe('hatchet-wedge');
    });
    it('falls through generic group=fish to the id sniff', () => {
      expect(archetypeForSpecies({ group: 'fish', id: 'kuhli-loach' })).toBe('eel');
    });
  });

  describe('id substring sniff', () => {
    it('detects hatchet by id substring', () => {
      expect(archetypeForSpecies({ id: 'marbled-hatchet-fish' })).toBe('hatchet-wedge');
    });
    it('detects pencil by id substring', () => {
      expect(archetypeForSpecies({ id: 'golden-pencilfish' })).toBe('hatchet-wedge');
    });
    it('detects kuhli by id substring', () => {
      expect(archetypeForSpecies({ id: 'kuhli-loach-striped' })).toBe('eel');
    });
    it('detects eel by id substring', () => {
      expect(archetypeForSpecies({ id: 'fire-eel' })).toBe('eel');
    });
    it('detects cory by id substring', () => {
      expect(archetypeForSpecies({ id: 'panda-cory' })).toBe('cory-cylinder');
    });
    it('detects pleco by id substring', () => {
      expect(archetypeForSpecies({ id: 'bristlenose-pleco' })).toBe('cory-cylinder');
    });
    it('detects oto by id substring', () => {
      expect(archetypeForSpecies({ id: 'oto-cat' })).toBe('cory-cylinder');
    });
    it('detects loach by id substring', () => {
      expect(archetypeForSpecies({ id: 'yoyo-loach' })).toBe('cory-cylinder');
    });
    it('detects angel by id substring', () => {
      expect(archetypeForSpecies({ id: 'altum-angel' })).toBe('deep-bodied');
    });
    it('detects discus by id substring', () => {
      expect(archetypeForSpecies({ id: 'blue-discus' })).toBe('deep-bodied');
    });
    it('detects gourami by id substring', () => {
      expect(archetypeForSpecies({ id: 'pearl-gourami' })).toBe('deep-bodied');
    });
    it('detects barb by id substring', () => {
      expect(archetypeForSpecies({ id: 'tiger-barb' })).toBe('barb');
    });
    it('detects cichlid by id substring', () => {
      expect(archetypeForSpecies({ id: 'electric-blue-cichlid' })).toBe('barb');
    });
    it('detects ram cichlid via id substring', () => {
      expect(archetypeForSpecies({ id: 'german-blue-ram' })).toBe('barb');
    });
    it('detects apisto via id substring', () => {
      expect(archetypeForSpecies({ id: 'apisto-cacatuoides' })).toBe('barb');
    });
    it('detects tetra by id substring', () => {
      expect(archetypeForSpecies({ id: 'cardinal-tetra' })).toBe('slim-tetra');
    });
    it('detects rasbora by id substring', () => {
      expect(archetypeForSpecies({ id: 'harlequin-rasbora' })).toBe('slim-tetra');
    });
    it('detects danio by id substring', () => {
      expect(archetypeForSpecies({ id: 'zebra-danio' })).toBe('slim-tetra');
    });
  });

  describe('fallback', () => {
    it('returns slim-tetra for a completely empty hint', () => {
      expect(archetypeForSpecies({})).toBe('slim-tetra');
    });
    it('returns slim-tetra for unknown group + unknown id', () => {
      expect(archetypeForSpecies({ group: 'mystery', id: 'totally-novel-species' })).toBe(
        'slim-tetra',
      );
    });
    it('returns slim-tetra when only an empty tag list is supplied', () => {
      expect(archetypeForSpecies({ tags: [] })).toBe('slim-tetra');
    });
  });
});
