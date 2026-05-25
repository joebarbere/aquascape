// Floating selection inspector. Stage 3 F3.4.
//
// Compact toolbar that appears at the top-right when at least one object
// is selected. Buttons:
//   - Mirror H / Mirror V: dispatch MirrorObject for every selected id.
//   - Duplicate: AddObject of a deep-cloned object with a new id, offset
//     by 20 mm so the clone is visually distinct from its source.
//   - Delete: RemoveObject for every selected id.
//   - Z up / Z down: ReorderObjectInLayer ±1 within the object's layer
//     (clamped to layer bounds).
//
// Keyboard shortcuts (Stage 3 F3.4):
//   - Delete / Backspace → Delete
//   - Cmd/Ctrl+D → Duplicate
//   - ] / [ → Z up / Z down
// These are bound at the document level via @HostListener so the user
// doesn't need to focus the toolbar to use them.

import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  HostListener,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';

import {
  asObjectId,
  identityTransform,
  mirrorObject,
  moveObject,
  removeObject,
  reorderObjectInLayer,
  addObject,
  setObjectGroupId,
  type LayerId,
  type ObjectId,
  type Scene,
  type SceneObject,
} from '@aquascape/domain/scene-model';
import {
  SceneActions,
  SelectionActions,
  selectHasSelection,
  selectScene,
  selectSelectedIds,
} from '@aquascape/state';
import { Store } from '@ngrx/store';

const DUPLICATE_OFFSET_MM = 20;

@Component({
  selector: 'aquascape-selection-inspector',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    @if (hasSelection()) {
      <aside class="selection-inspector" role="toolbar" aria-label="Selection actions">
        @if (selectionLocked()) {
          <span
            class="lock-pill"
            role="status"
            title="The selected object's layer is locked. Click the 🔒 icon in the Layers panel to unlock."
          >
            🔒 Layer locked
          </span>
        }
        <button
          type="button"
          (click)="onMirrorH()"
          [disabled]="selectionLocked()"
          aria-label="Mirror horizontal"
          title="Mirror horizontal"
        >
          ⇋
        </button>
        <button
          type="button"
          (click)="onMirrorV()"
          [disabled]="selectionLocked()"
          aria-label="Mirror vertical"
          title="Mirror vertical"
        >
          ⥯
        </button>
        <button
          type="button"
          (click)="onDuplicate()"
          [disabled]="selectionLocked()"
          aria-label="Duplicate (Cmd/Ctrl+D)"
          title="Duplicate (Cmd/Ctrl+D)"
        >
          ⎘
        </button>
        <button
          type="button"
          (click)="onGroup()"
          [disabled]="selectionCount() < 2 || selectionLocked()"
          aria-label="Group selected (Cmd/Ctrl+G)"
          title="Group selected (Cmd/Ctrl+G)"
        >
          ⊞
        </button>
        <button
          type="button"
          (click)="onUngroup()"
          [disabled]="!anySelectedGrouped() || selectionLocked()"
          aria-label="Ungroup selected (Cmd/Ctrl+Shift+G)"
          title="Ungroup selected (Cmd/Ctrl+Shift+G)"
        >
          ⊟
        </button>
        <button
          type="button"
          (click)="onZUp()"
          [disabled]="selectionLocked()"
          aria-label="Bring forward (])"
          title="Bring forward (])"
        >
          ↑
        </button>
        <button
          type="button"
          (click)="onZDown()"
          [disabled]="selectionLocked()"
          aria-label="Send backward ([)"
          title="Send backward ([)"
        >
          ↓
        </button>
        <button
          type="button"
          class="danger"
          (click)="onDelete()"
          [disabled]="selectionLocked()"
          aria-label="Delete (Del)"
          title="Delete (Del)"
        >
          ✕
        </button>
      </aside>
    }
  `,
  styles: [
    `
      :host {
        display: contents;
      }
      .selection-inspector {
        position: absolute;
        top: 12px;
        right: 12px;
        display: flex;
        gap: 4px;
        padding: 6px;
        background: #20232a;
        border-radius: 6px;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.25);
        z-index: 5;
      }
      button {
        min-width: 32px;
        height: 32px;
        padding: 0 8px;
        background: #2c3038;
        color: #fff;
        border: 1px solid #3a3f48;
        border-radius: 4px;
        cursor: pointer;
        font: inherit;
        font-size: 16px;
        line-height: 1;
      }
      button:hover,
      button:focus-visible {
        background: #3a3f48;
        outline: none;
      }
      button.danger {
        background: #7a1f1a;
        border-color: #a32d26;
      }
      button.danger:hover {
        background: #a32d26;
      }
      button:disabled {
        opacity: 0.35;
        cursor: not-allowed;
      }
      button:disabled:hover {
        background: #2c3038;
      }
      .lock-pill {
        display: inline-flex;
        align-items: center;
        padding: 0 10px;
        height: 32px;
        background: #3b2f00;
        color: #ffe69c;
        border: 1px solid #6b5400;
        border-radius: 4px;
        font-size: 12px;
        white-space: nowrap;
        cursor: help;
      }
    `,
  ],
})
export class SelectionInspectorComponent {
  private readonly store = inject(Store);
  private readonly destroyRef = inject(DestroyRef);

  readonly hasSelection = toSignal(this.store.select(selectHasSelection), {
    initialValue: false,
  });

  // Hold live copies of the store values in private fields. The action
  // handlers need synchronous reads. The subscriptions tear down on
  // component destroy via DestroyRef.
  //
  // For the Group / Ungroup `[disabled]` bindings to re-evaluate under
  // OnPush change detection we ALSO need signal-shaped reads (plain RxJS
  // subscriptions don't notify the change detector). We feed both from the
  // same store subscriptions so the field write and signal write stay in
  // lockstep — no risk of the keyboard handler and the disabled state
  // disagreeing about whether the selection is grouped.
  private readonly selectedIdsState = signal<readonly ObjectId[]>([]);
  private readonly sceneState = signal<Scene | null>(null);
  private currentSelectedIds: readonly ObjectId[] = [];
  private currentScene: Scene | null = null;

  readonly selectionCount = (): number => this.selectedIdsState().length;
  readonly anySelectedGrouped = (): boolean => {
    const scene = this.sceneState();
    if (scene === null) return false;
    const ids = new Set<ObjectId>(this.selectedIdsState());
    if (ids.size === 0) return false;
    for (const layer of scene.layers) {
      for (const obj of layer.objects) {
        if (ids.has(obj.id) && obj.groupId !== undefined) return true;
      }
    }
    return false;
  };

  /**
   * True when any selected object lives on a `locked` layer. Every mutation
   * command (Mirror, Duplicate, Z-up/down, Delete, Group/Ungroup) is rejected
   * by the scene-model reducer with `reason: 'locked'` in that case — the
   * button "click" then silently does nothing, leaving the user confused.
   * The template uses this signal to (a) disable the mutation buttons and
   * (b) show a "Layer locked" hint pill so the user knows to unlock the
   * layer in the right-rail layers panel.
   */
  readonly selectionLocked = (): boolean => {
    const scene = this.sceneState();
    if (scene === null) return false;
    const ids = new Set<ObjectId>(this.selectedIdsState());
    if (ids.size === 0) return false;
    for (const layer of scene.layers) {
      if (!layer.locked) continue;
      for (const obj of layer.objects) {
        if (ids.has(obj.id)) return true;
      }
    }
    return false;
  };

  constructor() {
    this.store
      .select(selectSelectedIds)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((ids) => {
        this.currentSelectedIds = ids;
        this.selectedIdsState.set(ids);
      });
    this.store
      .select(selectScene)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe((scene) => {
        this.currentScene = scene;
        this.sceneState.set(scene);
      });
  }

  private selectedIds(): readonly ObjectId[] {
    return this.currentSelectedIds;
  }
  private scene(): Scene | null {
    return this.currentScene;
  }

  // ── Actions ────────────────────────────────────────────────────────────

  onMirrorH(): void {
    for (const id of this.selectedIds()) {
      this.store.dispatch(SceneActions.dispatchCommand({ command: mirrorObject(id, 'x') }));
    }
  }

  onMirrorV(): void {
    for (const id of this.selectedIds()) {
      this.store.dispatch(SceneActions.dispatchCommand({ command: mirrorObject(id, 'y') }));
    }
  }

  onDelete(): void {
    for (const id of this.selectedIds()) {
      this.store.dispatch(SceneActions.dispatchCommand({ command: removeObject(id) }));
    }
    this.store.dispatch(SelectionActions.clearSelection());
  }

  onDuplicate(): void {
    const scene = this.scene();
    if (scene === null) return;
    const newlySelected: string[] = [];
    for (const id of this.selectedIds()) {
      const found = findObject(scene, id);
      if (found === null) continue;
      const clone = cloneObjectWithOffset(found.object, DUPLICATE_OFFSET_MM);
      this.store.dispatch(
        SceneActions.dispatchCommand({ command: addObject(found.layerId, clone) }),
      );
      newlySelected.push(clone.id);
    }
    if (newlySelected.length > 0) {
      this.store.dispatch(
        SelectionActions.replaceSelection({ ids: newlySelected.map((s) => asObjectId(s)) }),
      );
    }
  }

  onGroup(): void {
    const ids = this.selectedIds();
    if (ids.length < 2) return; // a single object can't form a group
    const groupId = asObjectId(newUuid());
    this.store.dispatch(SceneActions.dispatchCommand({ command: setObjectGroupId(ids, groupId) }));
  }

  onUngroup(): void {
    const ids = this.selectedIds();
    if (ids.length === 0) return;
    this.store.dispatch(SceneActions.dispatchCommand({ command: setObjectGroupId(ids, null) }));
  }

  /**
   * Nudge every selected object by `(dx, dy)` mm. Each id becomes one
   * MoveObject command, which under the scene-model reducer's lock guard
   * either succeeds or returns `'locked'`. We don't pre-filter on lock —
   * the keyboard handler already short-circuits when `selectionLocked()`
   * is true, AND a scatter plant's polygon ALSO needs translating (the
   * polygon coords are absolute scene mm, not relative to position), so
   * for scatter plants `moveObject` alone visually re-anchors the
   * transform but leaves the patch in place; for v1 single specimens
   * move correctly, scatter patches don't — same trade-off as the
   * cloneObjectWithOffset path. A follow-up can teach MoveObject to
   * translate the polygon too.
   */
  onNudge(dx: number, dy: number): void {
    const scene = this.scene();
    if (scene === null) return;
    for (const id of this.selectedIds()) {
      const found = findObject(scene, id);
      if (found === null) continue;
      const p = found.object.transform.position;
      this.store.dispatch(
        SceneActions.dispatchCommand({
          command: moveObject(id, { x: p.x + dx, y: p.y + dy, z: p.z }),
        }),
      );
    }
  }

  onZUp(): void {
    const scene = this.scene();
    if (scene === null) return;
    for (const id of this.selectedIds()) {
      const found = findObject(scene, id);
      if (found === null) continue;
      const layer = scene.layers.find((l) => l.id === found.layerId);
      if (layer === undefined) continue;
      const idx = layer.objects.findIndex((o) => o.id === id);
      if (idx < layer.objects.length - 1) {
        this.store.dispatch(
          SceneActions.dispatchCommand({ command: reorderObjectInLayer(id, idx + 1) }),
        );
      }
    }
  }

  onZDown(): void {
    const scene = this.scene();
    if (scene === null) return;
    for (const id of this.selectedIds()) {
      const found = findObject(scene, id);
      if (found === null) continue;
      const layer = scene.layers.find((l) => l.id === found.layerId);
      if (layer === undefined) continue;
      const idx = layer.objects.findIndex((o) => o.id === id);
      if (idx > 0) {
        this.store.dispatch(
          SceneActions.dispatchCommand({ command: reorderObjectInLayer(id, idx - 1) }),
        );
      }
    }
  }

  // ── Keyboard shortcuts ─────────────────────────────────────────────────

  @HostListener('document:keydown', ['$event'])
  onKeydown(event: KeyboardEvent): void {
    if (!this.hasSelection()) return;
    const target = event.target as HTMLElement | null;
    // Ignore shortcuts when typing in form fields.
    if (
      target !== null &&
      (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
    ) {
      return;
    }
    // Match the button [disabled] state — every action below would be
    // rejected by the reducer with `reason: 'locked'` and silently do
    // nothing, so don't waste a dispatch.
    if (this.selectionLocked()) return;
    const mod = event.ctrlKey || event.metaKey;
    // Arrow keys nudge the selection. Plain arrows = 1mm step (precision);
    // Shift+arrow = 10mm step (coarse). Cmd/Ctrl+arrow is intentionally
    // ignored so it can be used for future shortcuts (e.g. align). World
    // +y is up, so ArrowUp → +y. We do this BEFORE the mod check so the
    // arrow gestures work without modifiers.
    if (
      !mod &&
      (event.key === 'ArrowLeft' ||
        event.key === 'ArrowRight' ||
        event.key === 'ArrowUp' ||
        event.key === 'ArrowDown')
    ) {
      event.preventDefault();
      const step = event.shiftKey ? 10 : 1;
      const dx =
        event.key === 'ArrowLeft' ? -step : event.key === 'ArrowRight' ? step : 0;
      const dy =
        event.key === 'ArrowDown' ? -step : event.key === 'ArrowUp' ? step : 0;
      this.onNudge(dx, dy);
      return;
    }
    if (event.key === 'Delete' || event.key === 'Backspace') {
      event.preventDefault();
      this.onDelete();
    } else if (mod && event.key.toLowerCase() === 'd') {
      event.preventDefault();
      this.onDuplicate();
    } else if (mod && event.shiftKey && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      this.onUngroup();
    } else if (mod && event.key.toLowerCase() === 'g') {
      event.preventDefault();
      this.onGroup();
    } else if (event.key === ']') {
      event.preventDefault();
      this.onZUp();
    } else if (event.key === '[') {
      event.preventDefault();
      this.onZDown();
    }
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────

function findObject(scene: Scene, id: ObjectId): { object: SceneObject; layerId: LayerId } | null {
  for (const layer of scene.layers) {
    for (const obj of layer.objects) {
      if (obj.id === id) return { object: obj, layerId: layer.id };
    }
  }
  return null;
}

/**
 * Clone a SceneObject with a new id and a position offset along (x, y).
 * Used by the duplicate flow so the clone doesn't overlap its source.
 *
 * Scatter plants need a special case: their `scatter.polygon` coords live
 * in absolute scene-space mm, NOT relative to `transform.position`. The
 * renderer paints each scatter instance at the polygon's absolute coords
 * and ignores transform entirely. If we only offset the transform, the
 * duplicate paints exactly over the original and the user sees no change.
 * Fix: also offset every polygon vertex by the same delta, AND mint a
 * fresh `scatter.seed` so the duplicated patch's instance arrangement is
 * visibly different from the original (otherwise two patches of identical
 * grass blades end up overlapping by chance for any non-tiny offset).
 */
function cloneObjectWithOffset(obj: SceneObject, offsetMm: number): SceneObject {
  // SceneObject is plain JSON-serializable data (no class instances), so a
  // JSON round-trip is a safe deep clone. Avoids the `structuredClone`
  // global which jsdom does not currently polyfill.
  const fresh = JSON.parse(JSON.stringify(obj)) as SceneObject;
  fresh.id = asObjectId(newUuid());
  fresh.transform = {
    ...identityTransform(),
    ...fresh.transform,
    position: {
      x: fresh.transform.position.x + offsetMm,
      y: fresh.transform.position.y + offsetMm,
      z: fresh.transform.position.z,
    },
  };
  if (fresh.kind === 'plant' && fresh.scatter !== undefined) {
    const polygon = fresh.scatter.polygon.map((p) => ({
      x: p.x + offsetMm,
      y: p.y + offsetMm,
    }));
    // 32-bit XOR with a magic constant gives a deterministic-but-different
    // seed for the duplicate — the patch's instance arrangement visibly
    // differs from the original so the two patches don't read as one blob.
    const baseSeed = fresh.scatter.seed ?? 0;
    const reseed = (baseSeed ^ 0x9e3779b1) >>> 0;
    fresh.scatter = { ...fresh.scatter, polygon, seed: reseed };
  }
  return fresh;
}

function newUuid(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = Math.floor(Math.random() * 16);
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}
