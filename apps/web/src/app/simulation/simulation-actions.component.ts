// Stage 15 — the bottom-center husbandry **action HUD**.
//
// A row of square, rounded-border tool buttons pinned to the lower-middle of
// the simulation view. Selecting a tool enters its mode (an inline panel +
// a 3D-canvas interaction). F15.1 ships the **feeding** tool: a food-type
// picker (catalog `food` entries) → place-the-drop on the 3D canvas. F15.2
// adds the multi-step water-change tool to the same shell.
//
// The component is presentational + thin: it owns NO scene/tool state. The
// active-tool state machine lives in `SimulationActionService` (idle →
// tool-selected → sub-step); the food picker writes the chosen entry there,
// and AppComponent's canvas pointer handlers read it to drop typed food at
// the raycast point. This keeps the HUD free of renderer/ECS calls (which
// would risk the NG0600 signal-write-in-effect trap — those calls live in
// event handlers in the app layer).
//
// ACCESSIBILITY
// -------------
// The button row is a `role="toolbar"` with roving-tabindex arrow-key
// navigation (Left/Right move focus + Home/End jump to the ends); each tool
// button is a labelled toggle (`aria-pressed`). The food picker is a labelled
// list of buttons. Esc (handled in AppComponent) resets the tool.

import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  ViewChildren,
  type QueryList,
  computed,
  inject,
  signal,
} from '@angular/core';

import { coreCatalog, type FoodEntry } from '@aquascape/domain/catalog';

import { SimulationActionService, type ActionTool } from './simulation-action.service';

interface ToolButton {
  readonly tool: ActionTool;
  readonly label: string;
  /** A simple inline-SVG glyph id (rendered in the template). */
  readonly glyph: 'feed' | 'water';
}

@Component({
  selector: 'aquascape-simulation-actions',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="actions" aria-label="Husbandry tools">
      @if (action.tool() === 'feed') {
        <div class="actions__panel" role="group" aria-label="Feeding">
          <p class="actions__panel-title">
            @if (action.feedPlacing()) {
              <span>Click the tank to drop {{ selectedFoodName() }}</span>
              <button
                type="button"
                class="actions__back"
                (click)="action.pickFood(null)"
                aria-label="Change food type"
              >
                change
              </button>
            } @else {
              Pick a food
            }
          </p>
          @if (!action.feedPlacing()) {
            <ul class="actions__picker" aria-label="Food types">
              @for (food of foods(); track food.id) {
                <li>
                  <button
                    type="button"
                    class="actions__food"
                    (click)="action.pickFood(food.id)"
                    [attr.aria-label]="food.name + ' (' + food.type + ')'"
                  >
                    <span
                      class="actions__food-swatch"
                      [style.background]="food.color"
                      aria-hidden="true"
                    ></span>
                    <span class="actions__food-name">{{ food.name }}</span>
                    <span class="actions__food-type">{{ food.type }}</span>
                  </button>
                </li>
              }
            </ul>
          }
        </div>
      }

      <div
        #toolbar
        class="actions__bar"
        role="toolbar"
        aria-label="Husbandry tools"
        aria-orientation="horizontal"
        (keydown)="onToolbarKey($event)"
      >
        @for (btn of toolButtons; track btn.tool; let i = $index) {
          <button
            #toolBtn
            type="button"
            class="actions__tool"
            [class.actions__tool--active]="action.tool() === btn.tool"
            [attr.aria-pressed]="action.tool() === btn.tool"
            [attr.aria-label]="btn.label"
            [attr.title]="btn.label"
            [attr.tabindex]="i === focusIndex() ? 0 : -1"
            (click)="onSelect(btn.tool, i)"
            (focus)="focusIndex.set(i)"
          >
            @switch (btn.glyph) {
              @case ('feed') {
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                  <circle cx="8" cy="9" r="2" fill="currentColor" />
                  <circle cx="14" cy="7" r="2" fill="currentColor" />
                  <circle cx="11" cy="13" r="2" fill="currentColor" />
                  <circle cx="16" cy="13" r="1.6" fill="currentColor" />
                  <circle cx="9" cy="16" r="1.6" fill="currentColor" />
                </svg>
              }
              @case ('water') {
                <svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true">
                  <path
                    d="M12 3c3 4 5 6.5 5 9a5 5 0 0 1-10 0c0-2.5 2-5 5-9z"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linejoin="round"
                  />
                </svg>
              }
            }
            <span class="actions__tool-label">{{ btn.label }}</span>
          </button>
        }
      </div>
    </section>
  `,
  styles: [
    `
      :host {
        position: absolute;
        left: 50%;
        bottom: 18px;
        transform: translateX(-50%);
        z-index: 6;
        pointer-events: none;
      }
      .actions {
        pointer-events: auto;
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: 10px;
      }
      .actions__panel {
        min-width: 240px;
        max-width: 360px;
        padding: 12px 14px;
        background: rgba(10, 16, 22, 0.78);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(120, 200, 230, 0.28);
        border-radius: 12px;
        color: #eaf4f8;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
      }
      .actions__panel-title {
        margin: 0 0 8px;
        font-size: 12px;
        opacity: 0.85;
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }
      .actions__back {
        font: inherit;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        padding: 2px 8px;
        border-radius: 999px;
        border: 1px solid rgba(120, 200, 230, 0.4);
        background: rgba(90, 200, 240, 0.12);
        color: #9fe0f5;
        cursor: pointer;
      }
      .actions__picker {
        list-style: none;
        margin: 0;
        padding: 0;
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 6px;
        max-height: 200px;
        overflow-y: auto;
      }
      .actions__food {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border-radius: 8px;
        border: 1px solid rgba(255, 255, 255, 0.1);
        background: rgba(255, 255, 255, 0.05);
        color: inherit;
        font: inherit;
        font-size: 11px;
        cursor: pointer;
        text-align: left;
      }
      .actions__food:hover,
      .actions__food:focus-visible {
        border-color: rgba(120, 200, 230, 0.6);
        background: rgba(90, 200, 240, 0.12);
        outline: none;
      }
      .actions__food-swatch {
        width: 14px;
        height: 14px;
        border-radius: 3px;
        border: 1px solid rgba(255, 255, 255, 0.35);
        flex: 0 0 auto;
      }
      .actions__food-name {
        flex: 1 1 auto;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .actions__food-type {
        opacity: 0.55;
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .actions__bar {
        display: flex;
        gap: 10px;
        padding: 8px;
        background: rgba(10, 16, 22, 0.72);
        backdrop-filter: blur(10px);
        -webkit-backdrop-filter: blur(10px);
        border: 1px solid rgba(120, 200, 230, 0.28);
        border-radius: 16px;
        box-shadow: 0 8px 30px rgba(0, 0, 0, 0.45);
      }
      .actions__tool {
        width: 58px;
        height: 58px;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 3px;
        border-radius: 12px;
        border: 1px solid rgba(255, 255, 255, 0.14);
        background: rgba(255, 255, 255, 0.05);
        color: #cfe7f1;
        cursor: pointer;
        transition:
          border-color 0.12s ease,
          background 0.12s ease,
          color 0.12s ease;
      }
      .actions__tool:hover,
      .actions__tool:focus-visible {
        border-color: rgba(120, 200, 230, 0.6);
        background: rgba(90, 200, 240, 0.12);
        color: #f4fbfd;
        outline: none;
      }
      .actions__tool--active {
        border-color: rgba(120, 200, 230, 0.85);
        background: rgba(90, 200, 240, 0.22);
        color: #f4fbfd;
        box-shadow: 0 0 0 2px rgba(120, 200, 230, 0.35);
      }
      .actions__tool-label {
        font-size: 9px;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        opacity: 0.8;
      }
      @media (prefers-reduced-motion: reduce) {
        .actions__tool {
          transition: none;
        }
      }
    `,
  ],
})
export class SimulationActionsComponent {
  readonly action = inject(SimulationActionService);

  /** The husbandry tools the HUD exposes. F15.2 wires the water-change flow. */
  readonly toolButtons: readonly ToolButton[] = [
    { tool: 'feed', label: 'Feed', glyph: 'feed' },
    { tool: 'water-change', label: 'Water change', glyph: 'water' },
  ];

  /** Roving-tabindex focus position within the toolbar. */
  readonly focusIndex = signal(0);

  /** Catalog `food` rows for the feed picker (type + name + swatch). */
  readonly foods = computed<readonly FoodEntry[]>(() => coreCatalog.byKind('food'));

  /** Display name of the currently-armed food, for the "drop X" prompt. */
  readonly selectedFoodName = computed(() => {
    const id = this.action.selectedFoodId();
    if (id === null) return 'food';
    return this.foods().find((f) => f.id === id)?.name ?? 'food';
  });

  @ViewChildren('toolBtn')
  private toolBtns!: QueryList<ElementRef<HTMLButtonElement>>;

  /** Click a tool button — drives the state machine + tracks focus. */
  onSelect(tool: ActionTool, index: number): void {
    this.focusIndex.set(index);
    this.action.selectTool(tool);
  }

  /** Arrow-key roving focus across the toolbar (toolbar a11y pattern). */
  onToolbarKey(event: KeyboardEvent): void {
    const count = this.toolButtons.length;
    if (count === 0) return;
    let next = this.focusIndex();
    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        next = (next + 1) % count;
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        next = (next - 1 + count) % count;
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = count - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    this.focusIndex.set(next);
    this.toolBtns?.get(next)?.nativeElement.focus();
  }
}
