// Simulation-mode UI state — HUD visibility + the Quake console open flag.
//
// Lives in a small service (not AppComponent) so the console command handlers
// and the HUD components can both read/write it without threading inputs
// through the host. AppComponent binds the HUD/console gates to these signals;
// the console's `hud` command + the `~` toggle drive them.

import { Injectable, signal } from '@angular/core';

/** Toggleable HUD surfaces the console's `hud` command understands. */
export type HudTarget =
  | 'info'
  | 'controls'
  | 'clock'
  | 'perf'
  | 'vitality'
  | 'actions'
  | 'all';

@Injectable({ providedIn: 'root' })
export class SimulationUiService {
  /** Top-right read-only spec HUD (`aquascape-simulation-hud`). */
  readonly infoVisible = signal(true);
  /** Top-left interactive control HUD (`aquascape-simulation-controls`). */
  readonly controlsVisible = signal(true);
  /** The date/clock block inside the info HUD. */
  readonly clockVisible = signal(true);
  /** The FPS/frame/entity/bubble perf strip inside the info HUD. */
  readonly perfVisible = signal(true);
  /** Stage 14 F14.3 — the fish-vitality HUD + inspector (left-middle). */
  readonly vitalityVisible = signal(true);
  /** Stage 15 — the bottom-center husbandry action HUD (`aquascape-simulation-actions`). */
  readonly actionsVisible = signal(true);
  /** The Quake-style console (bottom-left). */
  readonly consoleOpen = signal(false);

  toggleConsole(): void {
    this.consoleOpen.update((v) => !v);
  }

  closeConsole(): void {
    this.consoleOpen.set(false);
  }

  /** Apply a show/hide to one HUD target (or all of them). */
  setHud(target: HudTarget, visible: boolean): void {
    if (target === 'all') {
      this.infoVisible.set(visible);
      this.controlsVisible.set(visible);
      this.clockVisible.set(visible);
      this.perfVisible.set(visible);
      this.vitalityVisible.set(visible);
      this.actionsVisible.set(visible);
      return;
    }
    this.signalFor(target).set(visible);
  }

  /** Flip one HUD target. `all` flips toward "all hidden" if anything shows. */
  toggleHud(target: HudTarget): void {
    if (target === 'all') {
      const anyVisible =
        this.infoVisible() ||
        this.controlsVisible() ||
        this.clockVisible() ||
        this.perfVisible() ||
        this.vitalityVisible() ||
        this.actionsVisible();
      this.setHud('all', !anyVisible);
      return;
    }
    const s = this.signalFor(target);
    s.set(!s());
  }

  /** Restore the default layout (everything visible, console closed). Called
   *  on demo enter so a re-entry starts clean. */
  resetLayout(): void {
    this.setHud('all', true);
    this.consoleOpen.set(false);
  }

  private signalFor(target: Exclude<HudTarget, 'all'>) {
    switch (target) {
      case 'info':
        return this.infoVisible;
      case 'controls':
        return this.controlsVisible;
      case 'clock':
        return this.clockVisible;
      case 'perf':
        return this.perfVisible;
      case 'vitality':
        return this.vitalityVisible;
      case 'actions':
        return this.actionsVisible;
    }
  }
}
