/**
 * Map a catalog livestock entry to a procedural archetype id. The mapper
 * is structural — it only inspects `group`, `tags`, and `id` so it can
 * stay free of any dependency on `@aquascape/domain/catalog`. This keeps
 * `fish-anatomy` at the bottom of the dependency graph and lets the
 * renderer use it without dragging catalog types into the Three.js layer.
 *
 * Heuristics (in priority order):
 *   1. `tags` (most precise — manifest authors can override `group`-level
 *      defaults by adding a tag like `"hatchetfish"`).
 *   2. `group` (broad bucket — fish / shrimp / snail today; future-proofed
 *      for the per-clade group strings in the Stage 11 plan).
 *   3. `id` substring sniff (last-resort heuristic — catches manifests
 *      that haven't been retagged yet).
 *   4. Default `slim-tetra`.
 *
 * Snails + shrimp map to `slim-tetra` for now; Stage 11 F11.6 introduces
 * a real crawler archetype and this mapper will gain a branch then.
 */

export type FishArchetypeId =
  | 'slim-tetra'
  | 'deep-bodied'
  | 'barb'
  | 'cory-cylinder'
  | 'eel'
  | 'hatchet-wedge';

/**
 * Structural shape we accept. Any livestock-ish object with optional
 * `group` / `tags` / `id` works — including, but not limited to, a
 * catalog `LivestockEntry`.
 */
export interface SpeciesMappingHints {
  group?: string;
  tags?: readonly string[];
  id?: string;
}

const TAG_TO_ARCHETYPE: Record<string, FishArchetypeId> = {
  tetra: 'slim-tetra',
  rasbora: 'slim-tetra',
  danio: 'slim-tetra',
  minnow: 'slim-tetra',
  gourami: 'deep-bodied',
  angelfish: 'deep-bodied',
  discus: 'deep-bodied',
  barb: 'barb',
  cichlid: 'barb',
  cory: 'cory-cylinder',
  corydoras: 'cory-cylinder',
  pleco: 'cory-cylinder',
  loach: 'cory-cylinder',
  otocinclus: 'cory-cylinder',
  kuhli: 'eel',
  eel: 'eel',
  hatchetfish: 'hatchet-wedge',
  pencilfish: 'hatchet-wedge',
};

const KEYWORDS: ReadonlyArray<[string, FishArchetypeId]> = [
  ['hatchet', 'hatchet-wedge'],
  ['pencil', 'hatchet-wedge'],
  ['kuhli', 'eel'],
  ['eel', 'eel'],
  ['cory', 'cory-cylinder'],
  ['pleco', 'cory-cylinder'],
  ['oto', 'cory-cylinder'],
  ['loach', 'cory-cylinder'],
  ['angel', 'deep-bodied'],
  ['discus', 'deep-bodied'],
  ['gourami', 'deep-bodied'],
  ['barb', 'barb'],
  ['cichlid', 'barb'],
  ['ram', 'barb'],
  ['apisto', 'barb'],
  ['tetra', 'slim-tetra'],
  ['rasbora', 'slim-tetra'],
  ['danio', 'slim-tetra'],
];

export function archetypeForSpecies(entry: SpeciesMappingHints): FishArchetypeId {
  // 1. Tag check — exact (lowercased) match against the lookup.
  if (entry.tags) {
    for (const raw of entry.tags) {
      const tag = raw.toLowerCase();
      const hit = TAG_TO_ARCHETYPE[tag];
      if (hit) return hit;
    }
  }

  // 2. Group check — same lookup table, since catalog `group` may be a
  // narrow bucket today ('fish' | 'shrimp' | 'snail') or a clade string
  // tomorrow ('tetra', 'cory', ...). Both flow through the same table.
  if (entry.group) {
    const g = entry.group.toLowerCase();
    const hit = TAG_TO_ARCHETYPE[g];
    if (hit) return hit;
    // Shrimp + snail are placeholder until F11.6 adds a real crawler.
    if (g === 'shrimp' || g === 'snail') return 'slim-tetra';
    // Bare 'fish' is too generic — fall through to the id sniff.
  }

  // 3. ID substring sniff — covers manifests that haven't been retagged.
  if (entry.id) {
    const id = entry.id.toLowerCase();
    for (const [needle, archetype] of KEYWORDS) {
      if (id.includes(needle)) return archetype;
    }
  }

  // 4. Default — safe for unknown species.
  return 'slim-tetra';
}
