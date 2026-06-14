// Demo console command system — the Quake-style CLI's brain.
//
// `SimulationConsoleService.execute(line)` tokenises a command line, dispatches to a
// registered `ConsoleCommand`, and returns output lines for the console to
// print. Commands mutate the live scene through the same NgRx + Command
// pipeline the editor + control HUD use, drive the DayNightService, and toggle
// HUD visibility via SimulationUiService — so everything stays in one source of truth.
//
// Command grammar is dead simple: whitespace-separated tokens, first is the
// command name, the rest are args. No quoting (none of the commands need it).
// See `docs/guides/simulation-mode.md` for the full reference.

import { Injectable, inject } from '@angular/core';
import { Store } from '@ngrx/store';

import { coreCatalog } from '@aquascape/domain/catalog';
import {
  removeLivestockEntry,
  setWaterLevel,
  updateLivestockQuantity,
  type Command,
} from '@aquascape/domain/scene-model';
import { DayNightService } from '@aquascape/features/editor-shell';
import { SceneActions, selectScene } from '@aquascape/state';

import {
  addRandomItem,
  addSpecies,
  doseNutrientOp,
  matchNutrient,
  matchSpecies,
  NAME_BY_ID,
  NUTRIENT_ENTRIES,
  uuid,
  type ItemKind,
} from './simulation-scene-ops';
import { SimulationStoreService } from './simulation-store.service';
import { SimulationUiService, type HudTarget } from './simulation-ui.service';
import { createShowcaseScene } from './showcase-scene';

export interface ConsoleLine {
  readonly kind: 'in' | 'out' | 'err';
  readonly text: string;
}

export interface ConsoleCommand {
  readonly name: string;
  readonly summary: string;
  readonly usage: string;
  /** Sync commands return lines directly; async ones (storage) return a promise. */
  run(args: string[]): ConsoleLine[] | Promise<ConsoleLine[]>;
}

const out = (text: string): ConsoleLine => ({ kind: 'out', text });
const err = (text: string): ConsoleLine => ({ kind: 'err', text });

const PHASE_WORDS: Record<string, number> = {
  midnight: 0,
  night: 0,
  dawn: 0.25,
  morning: 0.25,
  day: 0.5,
  noon: 0.5,
  dusk: 0.75,
  evening: 0.75,
};

const HUD_TARGETS: readonly HudTarget[] = [
  'info',
  'controls',
  'clock',
  'perf',
  'vitality',
  'all',
];
const HUD_ACTIONS = ['show', 'hide', 'toggle'] as const;
const ITEM_KINDS: readonly ItemKind[] = ['rock', 'wood', 'plant', 'decor'];

/** Smallest authored water level the console will set (mm). */
const MIN_WATER_MM = 40;

function clampInt(value: string): number | null {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(9999, Math.round(n)));
}

@Injectable({ providedIn: 'root' })
export class SimulationConsoleService {
  private readonly store = inject(Store);
  private readonly dayNight = inject(DayNightService);
  private readonly ui = inject(SimulationUiService);
  private readonly simStore = inject(SimulationStoreService);
  private readonly sceneSig = this.store.selectSignal(selectScene);

  readonly commands: readonly ConsoleCommand[] = this.buildCommands();

  /** Parse + run a command line. Returns the output lines (no input echo). */
  async execute(line: string): Promise<ConsoleLine[]> {
    const tokens = line
      .trim()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    const name = tokens[0]?.toLowerCase();
    if (name === undefined) return [];
    const command = this.commands.find((c) => c.name === name);
    if (command === undefined) {
      return [err(`Unknown command "${name}". Type "help".`)];
    }
    try {
      return await command.run(tokens.slice(1));
    } catch (e) {
      return [err(`Error: ${e instanceof Error ? e.message : String(e)}`)];
    }
  }

  /** Command-name completions for a prefix (Tab key). */
  complete(prefix: string): string[] {
    const p = prefix.trim().toLowerCase();
    return this.commands.map((c) => c.name).filter((n) => n.startsWith(p));
  }

  /**
   * Argument completions for `command` given the already-typed `args` (the Tab
   * key, when past the command name). Currently only `dose` completes its first
   * argument — over nutrient ids + names — so `dose easy` → the matching
   * product. Returns lower-cased completion tokens; an empty list = no help.
   */
  completeArgs(command: string, args: string[]): string[] {
    if (command === 'dose' && args.length <= 1) {
      const prefix = (args[0] ?? '').toLowerCase();
      const pool = ['list', ...NUTRIENT_ENTRIES.flatMap((e) => [e.id, e.name])];
      return pool
        .map((s) => s.toLowerCase())
        .filter((s) => s.startsWith(prefix))
        .filter((s, i, a) => a.indexOf(s) === i);
    }
    return [];
  }

  private dispatch(command: Command): void {
    this.store.dispatch(SceneActions.dispatchCommand({ command }));
  }

  private buildCommands(): ConsoleCommand[] {
    const commands: ConsoleCommand[] = [
      {
        name: 'help',
        summary: 'List commands, or show usage for one',
        usage: 'help [command]',
        run: (args) => {
          const topic = args[0];
          if (topic !== undefined) {
            const c = this.commands.find((x) => x.name === topic.toLowerCase());
            return c
              ? [out(`${c.name} — ${c.summary}`), out(`usage: ${c.usage}`)]
              : [err(`No such command: ${topic}`)];
          }
          return [
            out('Commands — "help <command>" for usage:'),
            ...this.commands.map((c) => out(`  ${c.name.padEnd(6)} ${c.summary}`)),
          ];
        },
      },
      {
        name: 'clear',
        summary: 'Clear the console output',
        usage: 'clear',
        // Intercepted by the component (it owns the log); never actually run.
        run: () => [],
      },
      {
        name: 'close',
        summary: 'Close the console',
        usage: 'close',
        run: () => {
          this.ui.closeConsole();
          return [];
        },
      },
      {
        name: 'hud',
        summary: 'Show / hide / toggle HUD elements',
        usage: 'hud <show|hide|toggle> <info|controls|clock|perf|vitality|all>',
        run: (args) => {
          const [action, target] = args;
          if (
            !HUD_ACTIONS.includes(action as (typeof HUD_ACTIONS)[number]) ||
            !HUD_TARGETS.includes(target as HudTarget)
          ) {
            return [err(`usage: hud <show|hide|toggle> <info|controls|clock|perf|vitality|all>`)];
          }
          if (action === 'toggle') this.ui.toggleHud(target as HudTarget);
          else this.ui.setHud(target as HudTarget, action === 'show');
          return [out(`hud ${target} → ${action}`)];
        },
      },
      {
        name: 'light',
        summary: 'Set the day/night phase',
        usage: 'light <midnight|dawn|day|dusk|0..1>',
        run: (args) => {
          const token = (args[0] ?? '').toLowerCase();
          const word = PHASE_WORDS[token];
          let phase: number;
          if (word !== undefined) {
            phase = word;
          } else {
            const n = Number(token);
            if (!Number.isFinite(n)) return [err('usage: light <midnight|dawn|day|dusk|0..1>')];
            phase = ((n % 1) + 1) % 1;
          }
          this.dayNight.setMode('manual');
          this.dayNight.setPhase(phase);
          return [out(`lighting → ${token || phase.toFixed(2)} (phase ${phase.toFixed(2)})`)];
        },
      },
      {
        name: 'water',
        summary: 'Set the water level in mm (or "auto")',
        usage: 'water <mm|auto>',
        run: (args) => {
          const token = args[0];
          if (token === 'auto') {
            this.dispatch(setWaterLevel(null));
            return [out('water level → auto')];
          }
          const mm = clampInt(token ?? '');
          const tank = this.sceneSig()?.tank;
          if (mm === null || tank === undefined) return [err('usage: water <mm|auto>')];
          const clamped = Math.max(MIN_WATER_MM, Math.min(tank.height, mm));
          this.dispatch(setWaterLevel(clamped));
          return [out(`water level → ${clamped} mm`)];
        },
      },
      {
        name: 'fish',
        summary: 'Manage livestock (list / add / remove / set)',
        usage:
          'fish list | fish add <species> [qty] | fish remove <species> | fish set <species> <qty>',
        run: (args) => this.fishCommand(args),
      },
      {
        name: 'item',
        summary: 'Add a random item to the tank',
        usage: 'item add <rock|wood|plant|decor>',
        run: (args) => {
          if (args[0] !== 'add' || !ITEM_KINDS.includes(args[1] as ItemKind)) {
            return [err('usage: item add <rock|wood|plant|decor>')];
          }
          const scene = this.sceneSig();
          if (scene === null) return [err('No scene loaded.')];
          const object = addRandomItem(this.store, scene, args[1] as ItemKind);
          if (object === null) return [err(`No ${args[1]} available in the catalog.`)];
          return [out(`added ${args[1]}: ${NAME_BY_ID.get(object.ref.id) ?? object.ref.id}`)];
        },
      },
      {
        name: 'dose',
        summary: 'Dose a nutrient / additive (recorded only)',
        usage: 'dose list | dose <product> [amount]',
        run: (args) => this.doseCommand(args),
      },
      {
        name: 'reset',
        summary: 'Reload the pristine showcase scene',
        usage: 'reset',
        run: () => {
          this.store.dispatch(SceneActions.setScene({ scene: createShowcaseScene() }));
          return [out('scene reset to the showcase default')];
        },
      },
      {
        name: 'sim',
        summary: 'Save / load / list / delete simulations (persisted)',
        usage: 'sim save <name> | sim load <name> | sim list | sim delete <name>',
        run: (args) => this.simCommand(args),
      },
    ];
    return commands;
  }

  /**
   * `sim` subcommands persist + recall named scene snapshots via
   * SimulationStoreService. `save` snapshots the CURRENT live scene, so you can
   * tweak the tank (control HUD or console) and bank it as a reusable
   * simulation. `demo` is the built-in simulation — the showcase scene; it's
   * always loadable and can't be overwritten or deleted. Names may contain
   * spaces (remaining tokens are joined).
   */
  private async simCommand(args: string[]): Promise<ConsoleLine[]> {
    const sub = (args[0] ?? '').toLowerCase();
    const name = args.slice(1).join(' ').trim();
    const isDemo = name.toLowerCase() === 'demo';
    const usage = 'usage: sim save <name> | sim load <name> | sim list | sim delete <name>';

    if (sub === 'list') {
      const saved = await this.simStore.list();
      return [
        out('simulations:'),
        out('  demo (built-in)'),
        ...saved.map((d) => out(`  ${d.name}`)),
      ];
    }

    if (sub === 'save') {
      if (name === '') return [err('usage: sim save <name>')];
      if (isDemo) return [err('"demo" is the built-in simulation — pick another name')];
      const scene = this.sceneSig();
      if (scene === null) return [err('no scene to save')];
      await this.simStore.save(name, scene, Date.now());
      const fish = (scene.livestock ?? []).reduce((n, l) => n + l.quantity, 0);
      return [out(`saved "${name}" (${fish} livestock)`)];
    }

    if (sub === 'load') {
      if (name === '') return [err('usage: sim load <name>')];
      if (isDemo) {
        this.store.dispatch(SceneActions.setScene({ scene: createShowcaseScene() }));
        return [out('loaded "demo" (the showcase)')];
      }
      const scene = await this.simStore.load(name);
      if (scene === null) return [err(`no simulation named "${name}" — try "sim list"`)];
      this.store.dispatch(SceneActions.setScene({ scene }));
      return [out(`loaded "${name}"`)];
    }

    if (sub === 'delete') {
      if (name === '') return [err('usage: sim delete <name>')];
      if (isDemo) return [err('"demo" is built-in and can\'t be deleted')];
      const existed = await this.simStore.remove(name);
      return [existed ? out(`deleted "${name}"`) : err(`no simulation named "${name}"`)];
    }

    return [err(usage)];
  }

  private fishCommand(args: string[]): ConsoleLine[] {
    const sub = (args[0] ?? '').toLowerCase();
    const scene = this.sceneSig();
    const livestock = scene?.livestock ?? [];

    if (sub === 'list') {
      if (livestock.length === 0) return [out('no livestock')];
      return livestock.map((l) => out(`  ${l.quantity}× ${NAME_BY_ID.get(l.ref.id) ?? l.ref.id}`));
    }

    if (sub === 'add') {
      const token = args[1];
      if (token === undefined) return [err('usage: fish add <species> [qty]')];
      const qty = args[2] !== undefined ? clampInt(args[2]) : 5;
      if (qty === null || qty < 1) return [err('quantity must be a positive number')];
      const match = matchSpecies(
        token,
        coreCatalog.byKind('livestock').map((e) => e.id),
      );
      if (match.status === 'none') return [err(`no species matches "${token}"`)];
      if (match.status === 'ambiguous') {
        return [err(`"${token}" is ambiguous:`), ...match.candidates.map((c) => out(`  ${c}`))];
      }
      addSpecies(this.store, match.id, qty, uuid);
      return [out(`added ${qty}× ${match.name}`)];
    }

    if (sub === 'remove' || sub === 'set') {
      const token = args[1];
      if (token === undefined)
        return [err(`usage: fish ${sub} <species>${sub === 'set' ? ' <qty>' : ''}`)];
      const match = matchSpecies(
        token,
        livestock.map((l) => l.ref.id),
      );
      if (match.status === 'none') return [err(`no stocked species matches "${token}"`)];
      if (match.status === 'ambiguous') {
        return [err(`"${token}" is ambiguous:`), ...match.candidates.map((c) => out(`  ${c}`))];
      }
      const entry = livestock.find((l) => l.ref.id === match.id);
      if (entry === undefined) return [err(`no stocked species matches "${token}"`)];

      if (sub === 'remove') {
        this.dispatch(removeLivestockEntry(entry.id));
        return [out(`removed ${match.name}`)];
      }
      const qty = clampInt(args[2] ?? '');
      if (qty === null) return [err('usage: fish set <species> <qty>')];
      if (qty <= 0) {
        this.dispatch(removeLivestockEntry(entry.id));
        return [out(`removed ${match.name}`)];
      }
      this.dispatch(updateLivestockQuantity(entry.id, qty));
      return [out(`${match.name} → ${qty}`)];
    }

    return [
      err(
        'usage: fish list | fish add <species> [qty] | fish remove <species> | fish set <species> <qty>',
      ),
    ];
  }

  /**
   * `dose` — record a nutrient/additive dose through the `DoseNutrient` command.
   *
   *   dose list                  → list every catalog nutrient
   *   dose <product> [amount]    → dose `amount` (the product's representative
   *                                dose if omitted). `<product>` is fuzzy (id or
   *                                name fragment). `amount` may carry a unit
   *                                suffix (`2ml`, `0.6g`); the unit is otherwise
   *                                taken from the product's `dose.unit`.
   *
   * Chemistry is recorded-only — the dose appends to `scene.doseLog`; the actual
   * water-chemistry effect is deferred pending `domain/water-sim`.
   */
  private doseCommand(args: string[]): ConsoleLine[] {
    const sub = (args[0] ?? '').toLowerCase();
    if (sub === '' || sub === 'help') {
      return [err('usage: dose list | dose <product> [amount]')];
    }

    if (sub === 'list') {
      return [
        out('nutrients:'),
        ...NUTRIENT_ENTRIES.map((e) =>
          out(`  ${e.name} — ${e.category} (${e.dose.amount}${e.dose.unit}/dose)`),
        ),
      ];
    }

    const scene = this.sceneSig();
    if (scene === null) return [err('No scene loaded.')];

    const match = matchNutrient(sub);
    if (match.status === 'none') return [err(`no nutrient matches "${sub}"`)];
    if (match.status === 'ambiguous') {
      return [err(`"${sub}" is ambiguous:`), ...match.candidates.map((c) => out(`  ${c}`))];
    }

    const entry = NUTRIENT_ENTRIES.find((e) => e.id === match.id);
    if (entry === undefined) return [err(`no nutrient matches "${sub}"`)];

    // Amount token (optional): `2`, `2ml`, `0.6g`. Default = representative dose.
    const amountToken = args[1];
    let amount = entry.dose.amount;
    if (amountToken !== undefined) {
      const m = /^(\d+(?:\.\d+)?)(ml|g)?$/i.exec(amountToken.trim());
      if (m === null) return [err('amount must be a positive number (optionally with g/ml)')];
      amount = Number(m[1]);
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      return [err('amount must be a positive number')];
    }

    const dosed = doseNutrientOp(this.store, scene, entry.id, amount, uuid);
    if (dosed === null) return [err('amount must be a positive number')];
    return [out(`dosed ${amount} ${entry.dose.unit} of ${entry.name} (recorded only)`)];
  }
}
