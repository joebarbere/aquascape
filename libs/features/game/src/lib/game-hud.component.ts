// Game HUD (Stage 16 F16.1).
//
// The overlay shown while a `--mode game:<submode>` run is active: the
// objective, the live score + elapsed timer, and a player health/food bar.
// Because Stage 14 vitality isn't built yet, the bar reads a clearly-marked
// PLACEHOLDER value (`vitality.isPlaceholder`) and the HUD shows a "preview"
// badge so it's never mistaken for real health.
//
// State-driven panels (objective briefing, pause, results) reuse the shared
// game state machine via `GameModeService.state`. The action buttons dispatch
// `GameEvent`s back through the service — they're native `<button>`s, so
// keyboard (Enter/Space) + focus + ARIA come for free; the panels are
// `role="dialog"` / `aria-label`led.
//
// Presentational: the HUD owns no game state — it binds to `GameModeService`
// signals (injected) and dispatches events. The app owns the input loop, the
// ECS world, and the renderer wiring.

import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import { GameModeService } from './game-mode.service';

@Component({
  selector: 'aquascape-game-hud',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="game-hud" role="region" aria-label="Game">
      <!-- Always-on top strip: objective + score + vitality -->
      <header class="game-hud__bar">
        <div class="game-hud__objective" role="group" aria-label="Objective">
          <span class="game-hud__mode">{{ title() }}</span>
          <span class="game-hud__obj-text">{{ objective() }}</span>
        </div>

        <dl class="game-hud__score" role="group" aria-label="Score">
          <dt>Score</dt>
          <dd>{{ score().points }}</dd>
          <dt>{{ hasCountdown() ? 'Time left' : 'Time' }}</dt>
          <dd>{{ timeLabel() }}</dd>
        </dl>

        <div class="game-hud__vitals" role="group" aria-label="Player vitality">
          @if (vitality().isPlaceholder) {
            <span class="game-hud__preview" title="Placeholder — real vitality lands in Stage 14"
              >preview</span
            >
          }
          <div class="game-hud__bar-row">
            <span class="game-hud__bar-label" id="game-hud-health-label">Health</span>
            <div
              class="game-hud__meter"
              role="progressbar"
              aria-labelledby="game-hud-health-label"
              [attr.aria-valuemin]="0"
              [attr.aria-valuemax]="100"
              [attr.aria-valuenow]="healthPct()"
            >
              <span class="game-hud__meter-fill game-hud__meter-fill--health" [style.width.%]="healthPct()"></span>
            </div>
          </div>
          <div class="game-hud__bar-row">
            <span class="game-hud__bar-label" id="game-hud-food-label">Food</span>
            <div
              class="game-hud__meter"
              role="progressbar"
              aria-labelledby="game-hud-food-label"
              [attr.aria-valuemin]="0"
              [attr.aria-valuemax]="100"
              [attr.aria-valuenow]="foodPct()"
            >
              <span class="game-hud__meter-fill game-hud__meter-fill--food" [style.width.%]="foodPct()"></span>
            </div>
          </div>
        </div>
      </header>

      <!-- Objective briefing -->
      @if (state() === 'objective') {
        <div class="game-hud__overlay" role="dialog" aria-modal="true" aria-label="Objective briefing">
          <h2>{{ title() }}</h2>
          <p>{{ objective() }}</p>
          <button type="button" class="game-hud__btn" (click)="onStart()">Start</button>
        </div>
      }

      <!-- Pause -->
      @if (state() === 'paused') {
        <div class="game-hud__overlay" role="dialog" aria-modal="true" aria-label="Paused">
          <h2>Paused</h2>
          <div class="game-hud__btn-row">
            <button type="button" class="game-hud__btn" (click)="onResume()">Resume</button>
            <button type="button" class="game-hud__btn game-hud__btn--ghost" (click)="onRestart()">
              Restart
            </button>
            <button type="button" class="game-hud__btn game-hud__btn--ghost" (click)="onQuit()">
              Quit
            </button>
          </div>
        </div>
      }

      <!-- Win / lose -->
      @if (state() === 'won' || state() === 'lost') {
        <div
          class="game-hud__overlay"
          role="dialog"
          aria-modal="true"
          [attr.aria-label]="state() === 'won' ? 'You won' : 'You lost'"
        >
          <h2>{{ state() === 'won' ? 'You win!' : 'Game over' }}</h2>
          <p class="game-hud__final">Final score: {{ score().points }}</p>
          <button type="button" class="game-hud__btn" (click)="onShowResults()">Continue</button>
        </div>
      }

      <!-- Results -->
      @if (state() === 'results') {
        <div class="game-hud__overlay" role="dialog" aria-modal="true" aria-label="Results">
          <h2>Results</h2>
          <dl class="game-hud__results">
            <dt>Score</dt>
            <dd>{{ score().points }}</dd>
            <dt>{{ hasCountdown() ? 'Time left' : 'Time' }}</dt>
            <dd>{{ timeLabel() }}</dd>
          </dl>
          <div class="game-hud__btn-row">
            <button type="button" class="game-hud__btn" (click)="onRestart()">Play again</button>
            <button type="button" class="game-hud__btn game-hud__btn--ghost" (click)="onQuit()">
              Quit
            </button>
          </div>
        </div>
      }
    </section>
  `,
  styles: [
    `
      :host {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 30;
        color: #e6f2f7;
        font-family: system-ui, sans-serif;
      }
      .game-hud__bar {
        position: absolute;
        top: 0;
        left: 0;
        right: 0;
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        padding: 12px 16px;
        background: linear-gradient(180deg, rgba(4, 14, 22, 0.7), rgba(4, 14, 22, 0));
      }
      .game-hud__mode {
        display: block;
        font-weight: 700;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        font-size: 13px;
      }
      .game-hud__obj-text {
        font-size: 13px;
        opacity: 0.85;
      }
      .game-hud__score {
        display: grid;
        grid-template-columns: auto auto;
        gap: 0 8px;
        margin: 0;
        font-variant-numeric: tabular-nums;
      }
      .game-hud__score dt {
        opacity: 0.7;
        font-size: 11px;
        text-transform: uppercase;
      }
      .game-hud__score dd {
        margin: 0;
        font-weight: 700;
        text-align: right;
      }
      .game-hud__vitals {
        min-width: 160px;
      }
      .game-hud__preview {
        display: inline-block;
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.06em;
        background: rgba(255, 196, 0, 0.2);
        border: 1px solid rgba(255, 196, 0, 0.5);
        border-radius: 4px;
        padding: 1px 5px;
        margin-bottom: 4px;
      }
      .game-hud__bar-row {
        display: flex;
        align-items: center;
        gap: 6px;
        margin-top: 2px;
      }
      .game-hud__bar-label {
        font-size: 11px;
        width: 44px;
        opacity: 0.8;
      }
      .game-hud__meter {
        flex: 1;
        height: 8px;
        background: rgba(255, 255, 255, 0.15);
        border-radius: 4px;
        overflow: hidden;
      }
      .game-hud__meter-fill {
        display: block;
        height: 100%;
      }
      .game-hud__meter-fill--health {
        background: #4ade80;
      }
      .game-hud__meter-fill--food {
        background: #fbbf24;
      }
      .game-hud__overlay {
        position: absolute;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%);
        pointer-events: auto;
        background: rgba(4, 14, 22, 0.92);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 12px;
        padding: 24px 32px;
        text-align: center;
        min-width: 280px;
      }
      .game-hud__overlay h2 {
        margin: 0 0 8px;
      }
      .game-hud__final {
        font-weight: 700;
      }
      .game-hud__btn-row {
        display: flex;
        gap: 8px;
        justify-content: center;
      }
      .game-hud__results {
        display: grid;
        grid-template-columns: auto auto;
        gap: 0 12px;
        justify-content: center;
        margin: 8px 0 16px;
      }
      .game-hud__results dt {
        opacity: 0.7;
      }
      .game-hud__results dd {
        margin: 0;
        font-weight: 700;
        text-align: right;
      }
      .game-hud__btn {
        pointer-events: auto;
        cursor: pointer;
        margin-top: 12px;
        padding: 8px 18px;
        border-radius: 8px;
        border: none;
        background: #0891b2;
        color: #fff;
        font-weight: 600;
        font-size: 14px;
      }
      .game-hud__btn--ghost {
        background: transparent;
        border: 1px solid rgba(255, 255, 255, 0.3);
      }
      .game-hud__btn:focus-visible {
        outline: 2px solid #fff;
        outline-offset: 2px;
      }
    `,
  ],
})
export class GameHudComponent {
  private readonly game = inject(GameModeService);

  readonly state = this.game.state;
  readonly score = this.game.score;
  readonly objective = this.game.objective;
  readonly vitality = this.game.vitality;

  readonly title = computed(() => this.game.descriptor()?.title ?? 'Game');

  readonly healthPct = computed(() => Math.round(this.vitality().health * 100));
  readonly foodPct = computed(() => Math.round(this.vitality().food * 100));

  /** True when the active mode has a hard time limit → show a countdown. */
  readonly hasCountdown = computed(() => this.game.descriptor()?.timeLimitSec !== undefined);

  /**
   * `m:ss` clock — the time REMAINING when the mode has a `timeLimitSec`
   * (predator F16.4), otherwise the elapsed (count-up) time. Clamped at 0 so a
   * just-expired run reads `0:00` rather than a negative value.
   */
  readonly timeLabel = computed(() => {
    const limit = this.game.descriptor()?.timeLimitSec;
    const elapsed = this.score().elapsedSec;
    const shown = limit === undefined ? elapsed : Math.max(0, limit - elapsed);
    const total = Math.floor(shown);
    const mins = Math.floor(total / 60);
    const secs = total % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  });

  onStart(): void {
    this.game.dispatch({ type: 'start' });
  }
  onResume(): void {
    this.game.dispatch({ type: 'resume' });
  }
  onRestart(): void {
    this.game.dispatch({ type: 'restart' });
  }
  onShowResults(): void {
    this.game.dispatch({ type: 'showResults' });
  }
  onQuit(): void {
    this.game.dispatch({ type: 'quit' });
  }
}
