// Layers panel. Plan Stage 4 F4.2.
//
// Lists the scene's layers (top of stack first, matching the visual paint
// order: layers[N-1] = front), one row per layer. Each row exposes:
//   - Visibility toggle  → SetLayerVisibility
//   - Lock toggle        → SetLayerLocked
//   - Inline name edit   → RenameLayer (commits on Enter / blur)
//   - Opacity slider     → SetLayerOpacity (commits on input)
//   - Up / Down arrows   → ReorderLayers (swap with neighbour)
//   - Remove (×)         → RemoveLayer
// A header button adds a new empty layer at the top of the stack.
//
// The panel does NOT manage selection or scene objects — it's purely a
// layer-metadata editor. Object reordering inside a layer lives on the
// selection inspector (Stage 3 F3.4).
//
// All mutations dispatch through `SceneActions.dispatchCommand` so the
// undo/redo stack treats each interaction as one entry. Reorder is a single
// `ReorderLayers` command per click; opacity dispatch fires on each `input`
// event (which produces granular undo entries — acceptable for v1; F4.x
// could batch into one entry per gesture if it proves noisy).

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';

import {
  addLayer,
  asLayerId,
  newLayerId,
  removeLayer,
  renameLayer,
  reorderLayers,
  setLayerLocked,
  setLayerOpacity,
  setLayerVisibility,
  type Layer,
  type LayerId,
  type Scene,
} from '@aquascape/domain/scene-model';
import { STORAGE_SERVICE } from '@aquascape/platform/platform-api/angular';
import type { StorageService } from '@aquascape/platform/platform-api';
import { SceneActions, selectScene } from '@aquascape/state';
import { Store } from '@ngrx/store';

/** StorageService key for the collapsed-state flag. */
export const LAYERS_PANEL_COLLAPSED_KEY = 'aquascape.ui.collapsed.layers-panel';

/**
 * Layer factory for the "+" button. Empty `objects` array; default opacity
 * 1, visible, unlocked. Name picks the next free "Layer N".
 */
function nextLayerName(existing: ReadonlyArray<Layer>): string {
  const used = new Set(existing.map((l) => l.name));
  for (let i = existing.length + 1; ; i++) {
    const candidate = `Layer ${i}`;
    if (!used.has(candidate)) return candidate;
  }
}

@Component({
  selector: 'aquascape-layers-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <section class="layers-panel" aria-label="Layers">
      <header class="panel-header">
        <button
          type="button"
          class="panel-header__toggle"
          [attr.aria-expanded]="!collapsed()"
          aria-controls="layers-panel-body"
          (click)="toggleCollapsed()"
        >
          <span
            class="panel-header__chevron"
            [class.panel-header__chevron--open]="!collapsed()"
            aria-hidden="true"
            >›</span
          >
          <h3 class="panel-header__title">Layers</h3>
          <span class="panel-header__count" aria-label="layers">{{ layerCount() }}</span>
        </button>
      </header>

      <div id="layers-panel-body" class="layers-panel__body" [hidden]="collapsed()">
      <div class="layers-panel__actions">
        <button
          type="button"
          class="add"
          (click)="onAddLayer()"
          aria-label="Add layer"
          title="Add layer"
        >
          + New layer
        </button>
      </div>

      @if (layers().length === 0) {
        <p class="empty">No layers — add one to start placing objects.</p>
      } @else {
        <ul role="list">
          @for (entry of layersReversed(); track entry.layer.id; let i = $index) {
            <li
              class="layer-row"
              [class.locked]="entry.layer.locked"
              [class.hidden]="!entry.layer.visible"
            >
              <button
                type="button"
                class="icon"
                (click)="onToggleVisible(entry.layer)"
                [attr.aria-label]="entry.layer.visible ? 'Hide layer' : 'Show layer'"
                [title]="entry.layer.visible ? 'Hide layer' : 'Show layer'"
              >
                {{ entry.layer.visible ? '◉' : '○' }}
              </button>
              <button
                type="button"
                class="icon"
                (click)="onToggleLocked(entry.layer)"
                [attr.aria-label]="entry.layer.locked ? 'Unlock layer' : 'Lock layer'"
                [title]="entry.layer.locked ? 'Unlock layer' : 'Lock layer'"
              >
                {{ entry.layer.locked ? '🔒' : '🔓' }}
              </button>
              <input
                type="text"
                class="name"
                [value]="entry.layer.name"
                (change)="onRename(entry.layer, $event)"
                (keydown.enter)="onRename(entry.layer, $event); $any($event.target).blur()"
                aria-label="Layer name"
              />
              <input
                type="range"
                class="opacity"
                min="0"
                max="1"
                step="0.05"
                [value]="entry.layer.opacity"
                (input)="onOpacity(entry.layer, $event)"
                aria-label="Layer opacity"
                [title]="opacityLabel(entry.layer.opacity)"
              />
              <button
                type="button"
                class="icon"
                (click)="onMoveUp(entry.indexInStack)"
                [disabled]="entry.indexInStack === layers().length - 1"
                aria-label="Move layer up"
                title="Move layer up"
              >
                ↑
              </button>
              <button
                type="button"
                class="icon"
                (click)="onMoveDown(entry.indexInStack)"
                [disabled]="entry.indexInStack === 0"
                aria-label="Move layer down"
                title="Move layer down"
              >
                ↓
              </button>
              <button
                type="button"
                class="icon danger"
                (click)="onRemove(entry.layer.id)"
                [disabled]="layers().length <= 1"
                aria-label="Delete layer"
                title="Delete layer"
              >
                ✕
              </button>
            </li>
          }
        </ul>
      }
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .layers-panel {
        background: var(--surface);
        color: var(--text);
        padding: 8px;
        border-radius: 6px;
        font-size: 13px;
      }
      .panel-header {
        margin: 0 0 6px;
      }
      .panel-header__toggle {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 4px 6px;
        background: transparent;
        color: inherit;
        border: 1px solid transparent;
        border-radius: 4px;
        cursor: pointer;
        font: inherit;
        text-align: left;
      }
      .panel-header__toggle:hover,
      .panel-header__toggle:focus-visible {
        background: var(--surface-hover);
        outline: none;
        border-color: var(--border);
      }
      .panel-header__chevron {
        display: inline-block;
        font-size: 16px;
        line-height: 1;
        width: 12px;
        transition: transform 0.15s ease;
        transform: rotate(0deg);
        color: var(--text-muted);
      }
      .panel-header__chevron--open {
        transform: rotate(90deg);
      }
      @media (prefers-reduced-motion: reduce) {
        .panel-header__chevron {
          transition: none;
        }
      }
      .panel-header__title {
        margin: 0;
        font-size: 14px;
        flex: 1;
      }
      .panel-header__count {
        color: var(--text-muted);
        font-variant-numeric: tabular-nums;
        font-size: 11px;
        padding: 1px 6px;
        border-radius: 8px;
        background: var(--surface-2);
        border: 1px solid var(--border);
      }
      .layers-panel__actions {
        display: flex;
        justify-content: flex-end;
        margin-bottom: 6px;
      }
      .add {
        background: var(--surface-2);
        color: var(--text);
        border: 1px solid var(--border-strong);
        border-radius: 4px;
        padding: 3px 8px;
        cursor: pointer;
        font: inherit;
      }
      .add:hover,
      .add:focus-visible {
        background: var(--surface-hover);
        outline: none;
      }
      .empty {
        font-style: italic;
        color: var(--text-muted);
        margin: 4px 0;
      }
      ul {
        list-style: none;
        margin: 0;
        padding: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
      }
      .layer-row {
        display: grid;
        grid-template-columns: auto auto 1fr 80px auto auto auto;
        gap: 4px;
        align-items: center;
        padding: 3px 4px;
        border-radius: 3px;
        background: var(--surface-2);
        border: 1px solid var(--border);
      }
      .layer-row.hidden {
        opacity: 0.5;
      }
      .layer-row.locked .name {
        color: var(--text-muted);
      }
      input.name {
        background: transparent;
        color: inherit;
        border: 1px solid transparent;
        padding: 2px 4px;
        border-radius: 3px;
        font: inherit;
        min-width: 0;
      }
      input.name:hover,
      input.name:focus-visible {
        border-color: var(--border-strong);
        background: var(--surface);
        outline: none;
      }
      input.opacity {
        width: 100%;
        accent-color: var(--accent);
      }
      .icon {
        background: transparent;
        border: 1px solid transparent;
        color: inherit;
        cursor: pointer;
        padding: 2px 6px;
        border-radius: 3px;
        font: inherit;
      }
      .icon:hover,
      .icon:focus-visible {
        border-color: var(--border-strong);
        background: var(--surface-hover);
        outline: none;
      }
      .icon:disabled {
        opacity: 0.3;
        cursor: not-allowed;
      }
      .icon.danger:hover {
        background: var(--danger);
        color: var(--danger-text);
        border-color: var(--danger-hover);
      }
    `,
  ],
})
export class LayersPanelComponent {
  private readonly store = inject(Store);
  private readonly destroyRef = inject(DestroyRef);
  private readonly storage = inject<StorageService>(STORAGE_SERVICE);

  private readonly scene$ = this.store.select(selectScene);
  readonly scene = toSignal<Scene | null>(this.scene$, { initialValue: null });
  readonly layers = (): ReadonlyArray<Layer> => this.scene()?.layers ?? [];

  /** Layer count for the header badge. */
  readonly layerCount = computed<number>(() => this.scene()?.layers.length ?? 0);

  /** Collapsed-panel state. Hydrated from StorageService on construct. */
  readonly collapsed = signal<boolean>(false);

  /**
   * Layers in display order — front (top of stack) first. Carries the
   * original stack index for reorder commands; the renderer paints
   * `layers[0]` first (back) and `layers[length-1]` last (front), so the
   * "topmost in UI = front-painted" convention is satisfied by reversing.
   */
  readonly layersReversed = (): ReadonlyArray<{ layer: Layer; indexInStack: number }> => {
    const ls = this.layers();
    const out: Array<{ layer: Layer; indexInStack: number }> = [];
    for (let i = ls.length - 1; i >= 0; i--) {
      out.push({ layer: ls[i] as Layer, indexInStack: i });
    }
    return out;
  };

  // Cache live scene state for action handlers so reorder math reads the
  // current value without re-querying the store inside a synchronous click.
  private currentScene: Scene | null = null;
  constructor() {
    this.scene$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((s) => {
      this.currentScene = s;
    });

    // Hydrate collapsed state. Failures non-fatal.
    this.storage
      .get<boolean>(LAYERS_PANEL_COLLAPSED_KEY)
      .then((stored) => {
        if (typeof stored === 'boolean') {
          this.collapsed.set(stored);
        }
      })
      .catch(() => {
        // Best-effort.
      });

    // Persist collapsed state on every change. Skip the effect's initial
    // pass so we don't immediately overwrite the hydrate.
    let firstRun = true;
    effect(() => {
      const value = this.collapsed();
      if (firstRun) {
        firstRun = false;
        return;
      }
      this.storage.set(LAYERS_PANEL_COLLAPSED_KEY, value).catch(() => {
        // Best-effort.
      });
    });
  }

  toggleCollapsed(): void {
    this.collapsed.update((v) => !v);
  }

  // ── Action handlers ────────────────────────────────────────────────────

  onAddLayer(): void {
    const layers = this.currentScene?.layers ?? [];
    this.store.dispatch(
      SceneActions.dispatchCommand({
        command: addLayer(
          {
            id: newLayerId(),
            name: nextLayerName(layers),
            opacity: 1,
            visible: true,
            locked: false,
            objects: [],
          },
          null,
        ),
      }),
    );
  }

  onToggleVisible(layer: Layer): void {
    this.store.dispatch(
      SceneActions.dispatchCommand({
        command: setLayerVisibility(layer.id, !layer.visible),
      }),
    );
  }

  onToggleLocked(layer: Layer): void {
    this.store.dispatch(
      SceneActions.dispatchCommand({ command: setLayerLocked(layer.id, !layer.locked) }),
    );
  }

  onRename(layer: Layer, event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (input === null) return;
    const next = input.value.trim();
    if (next === '' || next === layer.name) {
      // Revert the input to the canonical value when an empty rename is
      // entered, so the UI stays in sync with the (unchanged) store.
      input.value = layer.name;
      return;
    }
    this.store.dispatch(SceneActions.dispatchCommand({ command: renameLayer(layer.id, next) }));
  }

  onOpacity(layer: Layer, event: Event): void {
    const input = event.target as HTMLInputElement | null;
    if (input === null) return;
    const value = Number.parseFloat(input.value);
    if (!Number.isFinite(value)) return;
    if (value === layer.opacity) return;
    this.store.dispatch(
      SceneActions.dispatchCommand({ command: setLayerOpacity(layer.id, value) }),
    );
  }

  onMoveUp(indexInStack: number): void {
    // "Up" in UI = forward in paint order = higher stack index. Swap with
    // the next index up; guard rails: caller-side `disabled` blocks the
    // out-of-range case, but defend here too.
    this.swapNeighbour(indexInStack, indexInStack + 1);
  }

  onMoveDown(indexInStack: number): void {
    this.swapNeighbour(indexInStack, indexInStack - 1);
  }

  private swapNeighbour(a: number, b: number): void {
    const ids = this.currentScene?.layers.map((l) => l.id) ?? [];
    if (a < 0 || a >= ids.length || b < 0 || b >= ids.length) return;
    const next = ids.slice();
    [next[a], next[b]] = [next[b] as LayerId, next[a] as LayerId];
    this.store.dispatch(SceneActions.dispatchCommand({ command: reorderLayers(next) }));
  }

  onRemove(layerId: LayerId): void {
    const ids = this.currentScene?.layers ?? [];
    if (ids.length <= 1) return; // Don't leave the scene with zero layers.
    this.store.dispatch(SceneActions.dispatchCommand({ command: removeLayer(layerId) }));
  }

  opacityLabel(value: number): string {
    return `${Math.round(value * 100)}%`;
  }

  /** Re-exposes `asLayerId` for tests that build IDs without importing the lib. */
  static readonly asLayerId = asLayerId;
}
