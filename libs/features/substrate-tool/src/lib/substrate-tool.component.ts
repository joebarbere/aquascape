// Substrate tool side panel. Stage 2 F2.2 / F2.3.
//
// Numeric editor for the scene's substrate regions. Side-panel UX (no
// canvas drag handles yet — those land in or after F3.3 with hit-testing).
//
// Per-region UI:
//   - Material dropdown (catalog kind=substrate)
//   - fromX / toX / blend numeric inputs (region extent in [0,1] + mm)
//   - Profile control-point list: each row is x ∈ [0,1] + y in mm, with
//     delete; an Add Point button inserts a mid-point between the last
//     two existing points.
//
// All edits dispatch substrate Commands through the scene store's
// `dispatchCommand` pipeline. The component is a thin view over the
// store; never mutates scene state directly. Validation runs in the
// domain layer (the command rejects on bad input); the UI mirrors the
// rules so the user sees a sane state before submit.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { FormsModule } from '@angular/forms';

import { coreCatalog } from '@aquascape/domain/catalog';
import type { SubstrateEntry } from '@aquascape/domain/catalog';
import {
  addSubstrateRegion,
  asRegionId,
  removeSubstrateRegion,
  setSubstrateRegionExtent,
  setSubstrateRegionMaterial,
  setSubstrateRegionProfile,
  type SubstrateRegion,
} from '@aquascape/domain/scene-model';
import { SceneActions, selectSubstrateRegions } from '@aquascape/state';
import { Store } from '@ngrx/store';

@Component({
  selector: 'aquascape-substrate-tool',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <section class="substrate-tool" aria-labelledby="substrate-tool-heading">
      <header class="substrate-tool__header">
        <h2 id="substrate-tool-heading">Substrate</h2>
        <button
          type="button"
          class="substrate-tool__add-region"
          (click)="onAddRegion()"
          aria-label="Add substrate region"
        >
          + Add region
        </button>
      </header>

      @if (regions().length === 0) {
        <p class="substrate-tool__empty">
          No substrate yet. Add a region to start sculpting the bed.
        </p>
      }

      @for (region of regions(); track region.id; let regionIndex = $index) {
        <article
          class="substrate-tool__region"
          [attr.aria-label]="'Region ' + (regionIndex + 1)"
        >
          <header class="substrate-tool__region-header">
            <span class="substrate-tool__region-title"
              >Region {{ regionIndex + 1 }}</span
            >
            <button
              type="button"
              class="substrate-tool__remove-region"
              (click)="onRemoveRegion(region.id)"
              aria-label="Delete region"
            >
              Delete
            </button>
          </header>

          <label class="substrate-tool__field">
            <span>Material</span>
            <select
              [ngModel]="region.material.id"
              (ngModelChange)="onChangeMaterial(region.id, $event)"
              aria-label="Substrate material"
            >
              @for (entry of substrateChoices; track entry.id) {
                <option [value]="entry.id">{{ entry.name }}</option>
              }
            </select>
          </label>

          <div class="substrate-tool__row">
            <label class="substrate-tool__field">
              <span>From X (0–1)</span>
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                [ngModel]="region.fromX"
                (ngModelChange)="onExtentChange(region, 'fromX', $event)"
              />
            </label>
            <label class="substrate-tool__field">
              <span>To X (0–1)</span>
              <input
                type="number"
                min="0"
                max="1"
                step="0.01"
                [ngModel]="region.toX"
                (ngModelChange)="onExtentChange(region, 'toX', $event)"
              />
            </label>
            <label class="substrate-tool__field">
              <span>Blend (mm)</span>
              <input
                type="number"
                min="0"
                step="1"
                [ngModel]="region.blend ?? 0"
                (ngModelChange)="onExtentChange(region, 'blend', $event)"
              />
            </label>
          </div>

          <fieldset class="substrate-tool__profile">
            <legend>Profile points</legend>
            @for (point of region.profile; track $index; let pIndex = $index) {
              <div class="substrate-tool__profile-row">
                <label class="substrate-tool__field substrate-tool__field--narrow">
                  <span>x</span>
                  <input
                    type="number"
                    min="0"
                    max="1"
                    step="0.01"
                    [ngModel]="point.x"
                    (ngModelChange)="onPointChange(region, pIndex, 'x', $event)"
                  />
                </label>
                <label class="substrate-tool__field substrate-tool__field--narrow">
                  <span>y (mm)</span>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    [ngModel]="point.y"
                    (ngModelChange)="onPointChange(region, pIndex, 'y', $event)"
                  />
                </label>
                <button
                  type="button"
                  class="substrate-tool__remove-point"
                  (click)="onRemovePoint(region, pIndex)"
                  [disabled]="region.profile.length <= 2"
                  aria-label="Delete point"
                >
                  −
                </button>
              </div>
            }
            <button
              type="button"
              class="substrate-tool__add-point"
              (click)="onAddPoint(region)"
            >
              + Add point
            </button>
          </fieldset>
        </article>
      }
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
        padding: 12px;
        font-family: system-ui, sans-serif;
        font-size: 13px;
      }
      .substrate-tool__header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .substrate-tool__header h2 {
        margin: 0;
        font-size: 14px;
        font-weight: 600;
      }
      .substrate-tool__empty {
        margin: 0;
        padding: 12px;
        color: var(--text-muted, #777);
        font-style: italic;
        background: var(--surface, #f4f4f6);
        border-radius: 4px;
      }
      .substrate-tool__region {
        margin-top: 8px;
        padding: 8px;
        background: var(--surface-2, #fff);
        color: inherit;
        border: 1px solid var(--border, #e0e0e0);
        border-radius: 4px;
      }
      .substrate-tool__region-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        margin-bottom: 8px;
      }
      .substrate-tool__region-title {
        font-weight: 600;
      }
      .substrate-tool__field {
        display: flex;
        flex-direction: column;
        gap: 2px;
        margin-bottom: 6px;
      }
      .substrate-tool__field span {
        font-size: 11px;
        color: var(--text-muted, #555);
      }
      .substrate-tool__field input,
      .substrate-tool__field select {
        font: inherit;
        padding: 4px 6px;
        background: var(--surface-2, #fff);
        color: inherit;
        border: 1px solid var(--border-strong, #ccc);
        border-radius: 3px;
      }
      .substrate-tool__row {
        display: grid;
        grid-template-columns: repeat(3, 1fr);
        gap: 6px;
      }
      .substrate-tool__profile {
        border: 1px solid var(--border, #e0e0e0);
        border-radius: 4px;
        padding: 6px;
        margin: 6px 0 0;
      }
      .substrate-tool__profile legend {
        font-size: 11px;
        color: var(--text-muted, #555);
        padding: 0 4px;
      }
      .substrate-tool__profile-row {
        display: grid;
        grid-template-columns: 1fr 1fr auto;
        gap: 4px;
        align-items: end;
        margin-bottom: 4px;
      }
      .substrate-tool__field--narrow {
        margin-bottom: 0;
      }
      .substrate-tool__remove-point {
        padding: 4px 8px;
      }
      button {
        font: inherit;
        cursor: pointer;
        background: var(--accent, #20232a);
        color: var(--accent-text, #fff);
        border: none;
        border-radius: 4px;
        padding: 4px 10px;
      }
      button:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }
      .substrate-tool__remove-region,
      .substrate-tool__remove-point {
        background: var(--danger, #c0392b);
        color: var(--danger-text, #fff);
      }
    `,
  ],
})
export class SubstrateToolComponent {
  private readonly store = inject(Store);

  /** Substrate entries available to the material picker (kind: 'substrate'). */
  readonly substrateChoices: readonly SubstrateEntry[] = coreCatalog.byKind('substrate');

  readonly regions = toSignal(this.store.select(selectSubstrateRegions), { initialValue: [] });

  // ─── Actions ───────────────────────────────────────────────────────────

  onAddRegion(): void {
    const first = this.substrateChoices[0];
    if (first === undefined) return; // No catalog → no add possible.
    const region: SubstrateRegion = {
      id: newRegionUuid(),
      material: { catalog: first.catalog, id: first.id, version: first.version },
      fromX: 0,
      toX: 1,
      profile: [
        { x: 0, y: 30 },
        { x: 1, y: 30 },
      ],
    };
    this.store.dispatch(SceneActions.dispatchCommand({ command: addSubstrateRegion(region) }));
  }

  onRemoveRegion(regionId: string): void {
    this.store.dispatch(
      SceneActions.dispatchCommand({ command: removeSubstrateRegion(regionId) }),
    );
  }

  onChangeMaterial(regionId: string, materialId: string): void {
    const entry = this.substrateChoices.find((e) => e.id === materialId);
    if (entry === undefined) return;
    this.store.dispatch(
      SceneActions.dispatchCommand({
        command: setSubstrateRegionMaterial(regionId, {
          catalog: entry.catalog,
          id: entry.id,
          version: entry.version,
        }),
      }),
    );
  }

  onExtentChange(
    region: SubstrateRegion,
    field: 'fromX' | 'toX' | 'blend',
    raw: unknown,
  ): void {
    const value = clampFinite(raw);
    if (value === null) return;
    let fromX = region.fromX;
    let toX = region.toX;
    let blend: number | undefined | null = region.blend;
    if (field === 'fromX') fromX = clamp01(value);
    else if (field === 'toX') toX = clamp01(value);
    else blend = Math.max(0, value);
    // Keep fromX <= toX even mid-edit so the dispatched command isn't
    // rejected for being temporarily inverted — clamp the smaller one
    // up / larger one down rather than triggering an error toast.
    if (fromX > toX) {
      if (field === 'fromX') fromX = toX;
      else toX = fromX;
    }
    this.store.dispatch(
      SceneActions.dispatchCommand({
        command: setSubstrateRegionExtent({
          regionId: region.id,
          fromX,
          toX,
          blend: blend ?? null,
        }),
      }),
    );
  }

  onAddPoint(region: SubstrateRegion): void {
    // Insert a new point between the last two existing points. With the
    // typical "endpoints at 0 and 1" defaults this lands the new point
    // mid-region with the prior y value — the user can then drag it.
    const last = region.profile[region.profile.length - 1];
    const prev = region.profile[region.profile.length - 2];
    if (last === undefined || prev === undefined) return;
    const newX = (prev.x + last.x) / 2;
    const newY = (prev.y + last.y) / 2;
    const profile = [
      ...region.profile.slice(0, -1),
      { x: newX, y: newY },
      last,
    ];
    this.store.dispatch(
      SceneActions.dispatchCommand({
        command: setSubstrateRegionProfile(region.id, profile),
      }),
    );
  }

  onRemovePoint(region: SubstrateRegion, index: number): void {
    // Hard guard against dropping below 2 points (the schema floor).
    if (region.profile.length <= 2) return;
    const profile = region.profile.filter((_, i) => i !== index);
    this.store.dispatch(
      SceneActions.dispatchCommand({
        command: setSubstrateRegionProfile(region.id, profile),
      }),
    );
  }

  onPointChange(
    region: SubstrateRegion,
    index: number,
    field: 'x' | 'y',
    raw: unknown,
  ): void {
    const value = clampFinite(raw);
    if (value === null) return;
    const current = region.profile[index];
    if (current === undefined) return;
    const next = field === 'x' ? { ...current, x: clamp01(value) } : { ...current, y: Math.max(0, value) };
    const profile = region.profile.map((p, i) => (i === index ? next : p));
    // After an x-coordinate edit, the profile may not be sorted; the
    // command rejects on out-of-order input. Re-sort in place so the
    // user's edit lands cleanly.
    profile.sort((a, b) => a.x - b.x);
    this.store.dispatch(
      SceneActions.dispatchCommand({
        command: setSubstrateRegionProfile(region.id, profile),
      }),
    );
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

function clampFinite(raw: unknown): number | null {
  const n = typeof raw === 'number' ? raw : Number(raw);
  if (!Number.isFinite(n)) return null;
  return n;
}

/**
 * UUID v4 with a Math.random fallback for jsdom test envs that lack
 * `crypto.randomUUID`. Branded as `Uuid` (`SubstrateRegion.id`).
 */
function newRegionUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return asRegionId(c.randomUUID());
  return asRegionId(
    'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
      const r = Math.floor(Math.random() * 16);
      const v = ch === 'x' ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    }),
  );
}
