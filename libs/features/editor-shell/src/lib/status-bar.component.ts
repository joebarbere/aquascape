// Status bar — v1 QoL.
//
// A thin overlay at the bottom-right of the canvas host that shows useful
// at-a-glance state: cursor world coordinates (mm) and a count of objects
// in the current scene. Hidden when the cursor isn't over the canvas (the
// readout is more confusing than helpful when it's stale).

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

import type { Scene } from '@aquascape/domain/scene-model';
import { selectScene } from '@aquascape/state';
import { Store } from '@ngrx/store';

import { CursorPositionService } from './cursor-position.service';

@Component({
  selector: 'aquascape-status-bar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  template: `
    <div class="status-bar" role="status" aria-live="off">
      @if (cursor(); as c) {
        <span class="status-bar__readout" aria-label="Cursor position in millimetres">
          {{ formatCoord(c.x) }} mm, {{ formatCoord(c.y) }} mm
        </span>
      } @else {
        <span class="status-bar__readout status-bar__readout--idle">—</span>
      }
      <span class="status-bar__divider" aria-hidden="true">·</span>
      <span class="status-bar__readout">{{ objectCountLabel() }}</span>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .status-bar {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        background: rgba(32, 35, 42, 0.85);
        color: #e6e8eb;
        border-radius: 12px;
        font-size: 11px;
        font-variant-numeric: tabular-nums;
        pointer-events: none;
      }
      .status-bar__readout--idle {
        opacity: 0.5;
      }
      .status-bar__divider {
        opacity: 0.4;
      }
    `,
  ],
})
export class StatusBarComponent {
  private readonly cursorSvc = inject(CursorPositionService);
  private readonly store = inject(Store);

  readonly cursor = this.cursorSvc.position;
  private readonly scene = toSignal<Scene | null>(this.store.select(selectScene), {
    initialValue: null,
  });

  readonly objectCountLabel = computed<string>(() => {
    const s = this.scene();
    if (s === null) return '0 objects';
    let count = 0;
    for (const layer of s.layers) {
      count += layer.objects.length;
    }
    return count === 1 ? '1 object' : `${count} objects`;
  });

  formatCoord(value: number): string {
    return Math.round(value).toString();
  }
}
