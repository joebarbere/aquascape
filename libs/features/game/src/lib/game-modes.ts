// Game sub-mode metadata (Stage 16 F16.1).
//
// PURE — the per-sub-mode rules (objective text, win/lose framing, default
// player speed) that the shared shell renders generically. The four playable
// games (16.2–16.5) fill in their real scoring + win/lose logic later; F16.1
// ships the descriptor table + a placeholder so the shell, HUD, and state
// machine can be built + tested end-to-end now.
//
// `GameMode` is defined here (not imported from the app's `app-mode.ts`)
// because feature libs must not depend on `apps/*`. The string values are the
// SAME tokens the CLI grammar uses (`game:<submode>`), so the app maps
// `gameModeOf(appMode)` straight onto this type.

/** The four playable game sub-modes. Mirrors the CLI `game:<submode>` family. */
export type GameMode = 'survival' | 'feeding' | 'predator' | 'cleaner';

/** Ordered list of the sub-modes (mirrors the CLI allowlist). */
export const GAME_MODES: readonly GameMode[] = ['survival', 'feeding', 'predator', 'cleaner'];

/** Type guard for an arbitrary string against the `GameMode` allowlist. */
export function isGameMode(value: string): value is GameMode {
  return (GAME_MODES as readonly string[]).includes(value);
}

/**
 * Static, per-sub-mode descriptor consumed by the shell + HUD. The real
 * scoring + win/lose evaluation lands with each game (16.2–16.5); F16.1 only
 * needs the human-facing framing + the player movement speed.
 */
export interface GameModeDescriptor {
  readonly mode: GameMode;
  /** Short title for the HUD / menu. */
  readonly title: string;
  /** The one-line objective shown on the objective briefing + the HUD. */
  readonly objective: string;
  /** Default player swim speed in mm/s (the input → velocity scale). */
  readonly playerSpeedMmPerSec: number;
}

const SURVIVAL: GameModeDescriptor = {
  mode: 'survival',
  title: 'Survival',
  objective: 'Stay alive — avoid the predators and reach cover.',
  playerSpeedMmPerSec: 220,
};

const FEEDING: GameModeDescriptor = {
  mode: 'feeding',
  title: 'Feeding',
  objective: 'Eat the falling food — fill the food meter without overeating.',
  playerSpeedMmPerSec: 200,
};

const PREDATOR: GameModeDescriptor = {
  mode: 'predator',
  title: 'Predator',
  objective: 'Hunt the prey before time runs out.',
  playerSpeedMmPerSec: 260,
};

const CLEANER: GameModeDescriptor = {
  mode: 'cleaner',
  title: 'Cleaner',
  objective: 'Graze the algae and clear the tank.',
  playerSpeedMmPerSec: 180,
};

const DESCRIPTORS: Readonly<Record<GameMode, GameModeDescriptor>> = {
  survival: SURVIVAL,
  feeding: FEEDING,
  predator: PREDATOR,
  cleaner: CLEANER,
};

/** Look up the descriptor for a sub-mode. */
export function describeGameMode(mode: GameMode): GameModeDescriptor {
  return DESCRIPTORS[mode];
}
