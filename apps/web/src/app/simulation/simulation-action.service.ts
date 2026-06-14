// Stage 15 — the simulation action HUD's tool state machine.
//
// Owns the "which husbandry tool is active, and where in its flow are we"
// state for the bottom-center action HUD (`aquascape-simulation-actions`).
// The HUD component + the canvas pointer handlers in AppComponent both read
// this service's signals; selecting a tool button + advancing a sub-step
// drive it. Pure UI state — no scene mutation, no renderer calls live here
// (those go through `LivestockSimulationService.spawnFood` / the
// `SimulationInteractionRenderer` surface, driven from the app layer).
//
// STATE MACHINE
// -------------
//   idle ──(select tool)──▶ tool-selected ──(begin sub-step)──▶ sub-step…
//     ▲                          │                                  │
//     └──────(deselect / Esc)────┴──────────────────────────────────┘
//
// `phase` is the coarse stage; `tool` is which tool (null when idle). The
// feeding tool (F15.1) uses `tool-selected` (food-type picker shown) then a
// `placing` sub-step once a food is chosen (canvas drops are live). The
// water-change tool (F15.2) will reuse the SAME machine with its own
// multi-step flow (`params` → `place-siphon` → `siphon-out` → `siphon-in`),
// which is why `subStep` is a free-form string keyed per tool rather than a
// closed feeding-only union.

import { Injectable, computed, signal } from '@angular/core';

import { DEFAULT_REPLACEMENT, type ReplacementParams } from './water-change-flow';

/** The husbandry tools the action HUD exposes. F15.1 ships `feed`; F15.2 adds `water-change`. */
export type ActionTool = 'feed' | 'water-change';

/** The coarse phase of the active-tool flow. */
export type ActionPhase = 'idle' | 'tool-selected' | 'sub-step';

/**
 * A tool's sub-step within `sub-step` phase. Free-form per tool:
 *  - feed: `'placing'` (a food type is chosen, canvas clicks drop it).
 *  - water-change (F15.2): `'params' | 'place-siphon' | 'siphon-out' | 'siphon-in'`.
 */
export type ActionSubStep =
  | 'placing'
  | 'params'
  | 'place-siphon'
  | 'siphon-out'
  | 'siphon-in';

@Injectable({ providedIn: 'root' })
export class SimulationActionService {
  private readonly _tool = signal<ActionTool | null>(null);
  private readonly _phase = signal<ActionPhase>('idle');
  private readonly _subStep = signal<ActionSubStep | null>(null);
  private readonly _selectedFoodId = signal<string | null>(null);
  private readonly _replacement = signal<ReplacementParams>(DEFAULT_REPLACEMENT);
  private readonly _siphonPlaced = signal(false);

  /** Which tool is active (`null` = idle). */
  readonly tool = this._tool.asReadonly();
  /** The coarse phase (idle → tool-selected → sub-step). */
  readonly phase = this._phase.asReadonly();
  /** The current sub-step within a tool's flow (`null` outside `sub-step`). */
  readonly subStep = this._subStep.asReadonly();
  /**
   * F15.1 — the catalog `food` entry id chosen in the feeding picker, or `null`
   * before one is picked. The HUD writes it (`pickFood`); the app layer reads it
   * to resolve the catalog row for `spawnFoodFromCatalog` on a canvas drop. Held
   * here (not on the HUD component) so the canvas pointer handlers in AppComponent
   * — which mustn't reach into the HUD component — can see the selection.
   */
  readonly selectedFoodId = this._selectedFoodId.asReadonly();

  /**
   * F15.2 — the replacement-water params (temperature / pH / hardness) for the
   * new water mixed in on the IN step. Seeded to {@link DEFAULT_REPLACEMENT};
   * the params form writes it. Held here (not the HUD component) so the canvas
   * siphon handlers + the OUT/IN dispatch can read the chosen params.
   */
  readonly replacement = this._replacement.asReadonly();

  /**
   * F15.2 — true once the siphon nozzle has been placed (a canvas drag landed)
   * so the flow can gate the OUT step on a positioned nozzle.
   */
  readonly siphonPlaced = this._siphonPlaced.asReadonly();

  /** True when a tool is active (not idle). */
  readonly active = computed(() => this._phase() !== 'idle');

  /**
   * F15.2 — true when the water-change tool is in a sub-step where the 3D siphon
   * nozzle must be MOUNTED + draggable (place / out / in). The app gates
   * `RenderOptions.siphonTool` + the canvas siphon-drag listeners off this so the
   * nozzle only exists while the tool needs it (renders stay bit-identical
   * otherwise). False in the `params` sub-step (the form is up, no nozzle yet).
   */
  readonly siphonActive = computed(
    () =>
      this._tool() === 'water-change' &&
      (this._subStep() === 'place-siphon' ||
        this._subStep() === 'siphon-out' ||
        this._subStep() === 'siphon-in'),
  );

  /**
   * F15.2 — the siphon's current visual suction mode, derived from the sub-step:
   * `out` while draining, `in` while refilling, else `idle`. The app pushes this
   * to `setSiphonMode` from an event handler (never the render effect).
   */
  readonly siphonMode = computed<'idle' | 'out' | 'in'>(() => {
    if (this._tool() !== 'water-change') return 'idle';
    if (this._subStep() === 'siphon-out') return 'out';
    if (this._subStep() === 'siphon-in') return 'in';
    return 'idle';
  });

  /**
   * True when the feeding tool is in its placing sub-step — the app's canvas
   * pointer handlers gate drop-on-click off this (and the drop-preview marker
   * follows the cursor only while it holds).
   */
  readonly feedPlacing = computed(
    () => this._tool() === 'feed' && this._subStep() === 'placing',
  );

  /**
   * Select a tool. Toggling the already-active tool deselects it (returns to
   * idle) — the HUD buttons act like a radio group that can be cleared by
   * re-clicking. Selecting moves to `tool-selected` (the tool's picker/first
   * step shows); the sub-step is cleared until the tool begins one.
   */
  selectTool(tool: ActionTool): void {
    if (this._tool() === tool) {
      this.reset();
      return;
    }
    this._tool.set(tool);
    this._subStep.set(null);
    this._selectedFoodId.set(null);
    this._siphonPlaced.set(false);
    this._replacement.set(DEFAULT_REPLACEMENT);
    // The water-change tool opens straight into its first flow sub-step (the
    // replacement-params form); the feeding tool shows its picker (tool-selected).
    if (tool === 'water-change') {
      this._phase.set('sub-step');
      this._subStep.set('params');
    } else {
      this._phase.set('tool-selected');
    }
  }

  /**
   * Advance the active tool into a named sub-step (`sub-step` phase). No-op
   * when idle (a sub-step needs a selected tool first).
   */
  beginSubStep(step: ActionSubStep): void {
    if (this._tool() === null) return;
    this._phase.set('sub-step');
    this._subStep.set(step);
  }

  /**
   * Return to the tool's first step (`tool-selected`), keeping the tool
   * selected but clearing the sub-step. Used when a flow step is cancelled
   * but the tool stays open (e.g. clearing the chosen food type).
   */
  backToToolStart(): void {
    if (this._tool() === null) return;
    this._phase.set('tool-selected');
    this._subStep.set(null);
  }

  /**
   * F15.1 — pick a catalog `food` entry in the feeding picker and arm the
   * placing sub-step (canvas clicks now drop this food). Passing `null` clears
   * the selection and returns to the picker (`tool-selected`). No-op unless the
   * feeding tool is the active tool.
   */
  pickFood(foodId: string | null): void {
    if (this._tool() !== 'feed') return;
    this._selectedFoodId.set(foodId);
    if (foodId === null) {
      this.backToToolStart();
    } else {
      this.beginSubStep('placing');
    }
  }

  // ─── Water-change flow (F15.2) ────────────────────────────────────────────

  /**
   * F15.2 — store the replacement-water params from the form. No-op unless the
   * water-change tool is active. Does not advance the flow (the form's Confirm
   * button calls {@link confirmReplacement}).
   */
  setReplacement(params: ReplacementParams): void {
    if (this._tool() !== 'water-change') return;
    this._replacement.set(params);
  }

  /**
   * F15.2 — confirm the params form and advance to the place-siphon sub-step
   * (the 3D nozzle mounts; canvas drags move it). No-op unless the water-change
   * tool is in its `params` sub-step.
   */
  confirmReplacement(): void {
    if (this._tool() !== 'water-change' || this._subStep() !== 'params') return;
    this.beginSubStep('place-siphon');
    this._siphonPlaced.set(false);
  }

  /** F15.2 — mark the siphon nozzle as positioned (a canvas drag landed). */
  markSiphonPlaced(): void {
    if (this._tool() !== 'water-change') return;
    this._siphonPlaced.set(true);
  }

  /**
   * F15.2 — begin the siphon OUT step (drain). No-op unless the water-change
   * tool is in the place-siphon or siphon-in sub-step (you can re-OUT after an
   * IN). The app dispatches the drain command + drives the live runtime off the
   * `siphon-out` sub-step + `siphonMode`.
   */
  siphonOut(): void {
    if (this._tool() !== 'water-change') return;
    if (this._subStep() !== 'place-siphon' && this._subStep() !== 'siphon-in') return;
    this.beginSubStep('siphon-out');
  }

  /**
   * F15.2 — begin the siphon IN step (refill). No-op unless an OUT has run
   * (sub-step is `siphon-out`). The app dispatches the refill + chemistry lerp.
   */
  siphonIn(): void {
    if (this._tool() !== 'water-change' || this._subStep() !== 'siphon-out') return;
    this.beginSubStep('siphon-in');
  }

  /** Deselect everything → idle. Called on Esc, tool re-click, or HUD close. */
  reset(): void {
    this._tool.set(null);
    this._phase.set('idle');
    this._subStep.set(null);
    this._selectedFoodId.set(null);
    this._siphonPlaced.set(false);
    this._replacement.set(DEFAULT_REPLACEMENT);
  }
}
