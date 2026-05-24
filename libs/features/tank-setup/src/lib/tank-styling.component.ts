// Tank-styling subpanel. F1.2 Phase D.
//
// Standalone Angular component embedded inside `TankSetupComponent`. It
// renders the three styling subcontrols (frame / water tint / background)
// and dispatches `SceneActions.dispatchCommand(setTankStyle(...))` whenever
// the user changes a field. The component holds no document state of its
// own; it always reads the current `Tank.style` from the store and emits
// whole-style-replacement commands per the F1.2 Phase B contract.
//
// IMAGE-BACKGROUND TAB
// --------------------
// The Image tab is rendered for visual / a11y completeness but is
// `aria-disabled="true"`. Selecting it is a no-op (we deliberately do not
// dispatch `{ kind: 'image', ... }` — the asset pipeline ships in F6.3).
// The panel below shows an explanatory disabled state.
//
// COLOR INPUT APPROACH
// --------------------
// We chose **native `<input type="color">` + hex text field** rather than
// a custom color-picker. Both are intrinsically accessible (keyboard
// operability, screen-reader labels via `aria-label`) and ship in every
// browser; the hex text field supports `#RGB` / `#RRGGBB` / `#RRGGBBAA`
// (the native picker only supports `#RRGGBB`, so the text field is the
// canonical input for alpha values like the water-tint presets). The two
// inputs stay in sync via `(input)` handlers — typing in one writes to
// the form control which drives the other.
//
// Plan notes lean toward a "library or CDK overlay primitive" — we
// considered both and rejected them for Stage 1 because:
//   (a) the schema's hex format is the only canonical wire form, and
//   (b) every popular color-picker library either ships its own DOM
//       roots that fight `OnPush` or pulls in 30+ kB of overlay code.
// We can swap in a CDK overlay-based palette later without touching the
// dispatch shape.

import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toSignal } from '@angular/core/rxjs-interop';
import { setTankStyle } from '@aquascape/domain/scene-model';
import type { HexColor, TankStyle } from '@aquascape/domain/scene-model';
import { SceneActions, selectTank } from '@aquascape/state';
import { Store } from '@ngrx/store';

import {
  BACKGROUND_COLOR_PRESETS,
  DEFAULT_FRAME_COLOR,
  DEFAULT_GRADIENT,
  GRADIENT_ANGLE_PRESETS_DEG,
  MAX_GRADIENT_STOPS,
  MIN_GRADIENT_STOPS,
  WATER_TINT_PRESETS,
} from './tank-style-defaults';

/** Friendly UI label → schema enum mapping for the frame radio group. */
export interface FrameOption {
  readonly value: TankStyle['frame'];
  readonly label: string;
}

export const FRAME_OPTIONS: ReadonlyArray<FrameOption> = [
  { value: 'rimless', label: 'Rimless (modern)' },
  { value: 'framed', label: 'Black-rimmed' },
  { value: 'braced', label: 'Braced (large tanks)' },
];

/** Background-tab discriminator (UI only; collapses to `style.background.kind`). */
export type BackgroundTab = 'none' | 'color' | 'gradient' | 'image';

/** Hex format the UI accepts: #RGB, #RRGGBB, or #RRGGBBAA. */
export const UI_HEX_RE = /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3}([0-9a-fA-F]{2})?)?$/;

/** Hex format the domain command accepts: #RRGGBB or #RRGGBBAA. */
const DOMAIN_HEX_RE = /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/;

/**
 * Expand a 3-char hex (`#abc`) to a 6-char hex (`#aabbcc`). 6/8-char hex
 * passes through. Returns `null` if the input doesn't match
 * {@link UI_HEX_RE}.
 */
export function normaliseHex(input: string): HexColor | null {
  const trimmed = input.trim();
  if (!UI_HEX_RE.test(trimmed)) return null;
  if (trimmed.length === 4) {
    const r = trimmed[1] as string;
    const g = trimmed[2] as string;
    const b = trimmed[3] as string;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return trimmed.toLowerCase();
}

/** Returns true if `value` is a domain-acceptable hex (`#RRGGBB` / `#RRGGBBAA`). */
export function isDomainHex(value: string): value is HexColor {
  return DOMAIN_HEX_RE.test(value);
}

/** Drop the alpha byte from a `#RRGGBBAA` hex so native `<input type=color>` accepts it. */
export function hexWithoutAlpha(hex: HexColor): string {
  return hex.length === 9 ? hex.slice(0, 7) : hex;
}

/** Convert degrees → radians. */
export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/** Convert radians → degrees, rounded to the nearest integer for UI display. */
export function radToDeg(rad: number): number {
  return Math.round(((rad * 180) / Math.PI) % 360);
}

@Component({
  selector: 'aquascape-tank-styling',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule],
  templateUrl: './tank-styling.component.html',
  styleUrls: ['./tank-styling.component.css'],
})
export class TankStylingComponent {
  // ── DI ────────────────────────────────────────────────────────────────
  private readonly store = inject(Store);
  private readonly destroyRef = inject(DestroyRef);

  // ── Constants exposed to the template ─────────────────────────────────
  readonly FRAME_OPTIONS = FRAME_OPTIONS;
  readonly WATER_TINT_PRESETS = WATER_TINT_PRESETS;
  readonly BACKGROUND_COLOR_PRESETS = BACKGROUND_COLOR_PRESETS;
  readonly GRADIENT_ANGLE_PRESETS_DEG = GRADIENT_ANGLE_PRESETS_DEG;
  readonly MIN_GRADIENT_STOPS = MIN_GRADIENT_STOPS;
  readonly MAX_GRADIENT_STOPS = MAX_GRADIENT_STOPS;
  readonly DEFAULT_FRAME_COLOR = DEFAULT_FRAME_COLOR;

  // ── Reactive store state ──────────────────────────────────────────────
  private readonly tank$ = this.store.select(selectTank);
  /** Signal-projected view of the current tank style. */
  readonly tank = toSignal(this.tank$);
  /** Convenience: just the style. */
  readonly style = signal<TankStyle>({
    frame: 'rimless',
    background: { kind: 'none' },
  });

  /** Active background tab. Defaults to whatever the current style says. */
  readonly backgroundTab = signal<BackgroundTab>('none');

  /** Last-used frame color, so toggling rimless → framed restores the picker. */
  readonly cachedFrameColor = signal<HexColor>(DEFAULT_FRAME_COLOR);

  /** Live text-input state for the water-tint hex (UI-level; may be invalid mid-type). */
  readonly waterTintInput = signal<string>('');
  /** Inline UI-level error for the water-tint hex field, or null when clean. */
  readonly waterTintError = signal<string | null>(null);

  /** Live text-input state for the solid-background hex (UI-level). */
  readonly bgSolidInput = signal<string>('');
  readonly bgSolidError = signal<string | null>(null);

  /** Current gradient editor state. Mirrors `style.background` when kind=gradient. */
  readonly gradientAngleDeg = signal<number>(90);
  readonly gradientStops = signal<ReadonlyArray<{ at: number; color: HexColor }>>(
    DEFAULT_GRADIENT.stops,
  );
  /** Per-stop inline error, keyed by index. */
  readonly gradientStopErrors = signal<ReadonlyArray<string | null>>([null, null]);

  /** Most recent command-rejection message, surfaced via aria-live=assertive. */
  readonly rejectionMessage = signal<string | null>(null);

  constructor() {
    // Keep the local view of the style synced with the store. The component
    // never mutates the scene; it always builds a fresh style and dispatches
    // through the Command pipeline.
    this.tank$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe((tank) => {
      this.style.set(tank.style);
      this.syncFromStyle(tank.style);
    });
  }

  // ── Frame picker ──────────────────────────────────────────────────────

  selectFrame(value: TankStyle['frame']): void {
    const current = this.style();
    if (value === 'rimless') {
      // Drop frameColor; cache the previous choice for re-toggle.
      if (current.frameColor !== undefined) {
        this.cachedFrameColor.set(current.frameColor);
      }
      const next: TankStyle = {
        frame: 'rimless',
        background: current.background,
      };
      if (current.waterTint !== undefined) {
        next.waterTint = current.waterTint;
      }
      this.dispatch(next);
      return;
    }
    // Non-rimless: ensure a frameColor is set; default to the cached value
    // (or DEFAULT_FRAME_COLOR on first switch).
    const frameColor = current.frameColor ?? this.cachedFrameColor();
    const next: TankStyle = {
      frame: value,
      frameColor,
      background: current.background,
    };
    if (current.waterTint !== undefined) {
      next.waterTint = current.waterTint;
    }
    this.dispatch(next);
  }

  setFrameColor(value: string): void {
    const hex = normaliseHex(value);
    if (hex === null) return;
    const current = this.style();
    if (current.frame === 'rimless') return;
    this.cachedFrameColor.set(hex);
    const next: TankStyle = {
      frame: current.frame,
      frameColor: hex,
      background: current.background,
    };
    if (current.waterTint !== undefined) {
      next.waterTint = current.waterTint;
    }
    this.dispatch(next);
  }

  isFrameSelected(value: TankStyle['frame']): boolean {
    return this.style().frame === value;
  }

  // ── Water-tint picker ─────────────────────────────────────────────────

  /** Handle a free-text hex input for water tint. Validates UI-side first. */
  onWaterTintInput(value: string): void {
    this.waterTintInput.set(value);
    const trimmed = value.trim();
    if (trimmed === '') {
      this.waterTintError.set(null);
      this.clearWaterTint();
      return;
    }
    const hex = normaliseHex(trimmed);
    if (hex === null) {
      this.waterTintError.set('Enter a hex color like #RRGGBB or #RRGGBBAA.');
      return;
    }
    this.waterTintError.set(null);
    this.applyWaterTint(hex);
  }

  /** Native `<input type=color>` always emits `#RRGGBB` — no need to validate. */
  onWaterTintNative(value: string): void {
    const hex = normaliseHex(value);
    if (hex === null) return;
    this.waterTintInput.set(hex);
    this.waterTintError.set(null);
    this.applyWaterTint(hex);
  }

  selectWaterTintPreset(hex: HexColor | null): void {
    if (hex === null) {
      this.waterTintInput.set('');
      this.waterTintError.set(null);
      this.clearWaterTint();
      return;
    }
    this.waterTintInput.set(hex);
    this.waterTintError.set(null);
    this.applyWaterTint(hex);
  }

  private applyWaterTint(hex: HexColor): void {
    const current = this.style();
    const next: TankStyle = {
      frame: current.frame,
      waterTint: hex,
      background: current.background,
    };
    if (current.frameColor !== undefined) next.frameColor = current.frameColor;
    this.dispatch(next);
  }

  private clearWaterTint(): void {
    const current = this.style();
    if (current.waterTint === undefined) return;
    const next: TankStyle = {
      frame: current.frame,
      background: current.background,
    };
    if (current.frameColor !== undefined) next.frameColor = current.frameColor;
    this.dispatch(next);
  }

  // ── Background tabs ───────────────────────────────────────────────────

  selectBackgroundTab(tab: BackgroundTab): void {
    if (tab === 'image') {
      // Image backgrounds ship in F6.3. We update the local tab signal so
      // the disabled panel is visible, but we DO NOT dispatch — selecting
      // the tab must not mutate the document.
      this.backgroundTab.set('image');
      return;
    }
    this.backgroundTab.set(tab);
    const current = this.style();
    if (tab === 'none') {
      if (current.background.kind === 'none') return;
      this.dispatchBackground({ kind: 'none' });
      return;
    }
    if (tab === 'color') {
      if (current.background.kind === 'color') return;
      // Default to the first preset on first switch.
      const first = BACKGROUND_COLOR_PRESETS[0];
      const fallback: HexColor = first ? first.hex : '#000000';
      this.bgSolidInput.set(fallback);
      this.bgSolidError.set(null);
      this.dispatchBackground({ kind: 'color', color: fallback });
      return;
    }
    if (tab === 'gradient') {
      if (current.background.kind === 'gradient') return;
      this.gradientAngleDeg.set(radToDeg(DEFAULT_GRADIENT.angle));
      this.gradientStops.set(DEFAULT_GRADIENT.stops.map((s) => ({ ...s })));
      this.gradientStopErrors.set(DEFAULT_GRADIENT.stops.map(() => null));
      this.dispatchBackground({
        kind: 'gradient',
        angle: DEFAULT_GRADIENT.angle,
        stops: DEFAULT_GRADIENT.stops.map((s) => ({ ...s })),
      });
    }
  }

  isBackgroundTab(tab: BackgroundTab): boolean {
    return this.backgroundTab() === tab;
  }

  // ── Solid background ──────────────────────────────────────────────────

  onBgSolidInput(value: string): void {
    this.bgSolidInput.set(value);
    const trimmed = value.trim();
    if (trimmed === '') {
      this.bgSolidError.set('Background color is required.');
      return;
    }
    const hex = normaliseHex(trimmed);
    if (hex === null) {
      this.bgSolidError.set('Enter a hex color like #RRGGBB or #RRGGBBAA.');
      return;
    }
    this.bgSolidError.set(null);
    this.dispatchBackground({ kind: 'color', color: hex });
  }

  onBgSolidNative(value: string): void {
    const hex = normaliseHex(value);
    if (hex === null) return;
    this.bgSolidInput.set(hex);
    this.bgSolidError.set(null);
    this.dispatchBackground({ kind: 'color', color: hex });
  }

  selectBgSolidPreset(hex: HexColor): void {
    this.bgSolidInput.set(hex);
    this.bgSolidError.set(null);
    this.dispatchBackground({ kind: 'color', color: hex });
  }

  // ── Gradient background ───────────────────────────────────────────────

  onGradientAngleInput(value: number): void {
    if (!Number.isFinite(value)) return;
    // UI accepts 0–360; wrap (negatives + > 360) into [0, 360).
    const wrapped = ((value % 360) + 360) % 360;
    this.gradientAngleDeg.set(wrapped);
    this.dispatchGradient();
  }

  setGradientAnglePreset(deg: number): void {
    this.gradientAngleDeg.set(deg);
    this.dispatchGradient();
  }

  addGradientStop(): void {
    const stops = this.gradientStops();
    if (stops.length >= MAX_GRADIENT_STOPS) return;
    // Insert a midpoint between the last two stops, defaulting color to
    // the previous stop's color.
    const last = stops[stops.length - 1];
    const prev = stops[stops.length - 2];
    const newAt = last && prev ? Math.min(1, (last.at + prev.at) / 2 + 0.01) : 0.5;
    const newColor: HexColor = last ? last.color : '#ffffff';
    const next = stops.concat([{ at: newAt, color: newColor }]);
    this.gradientStops.set(next);
    this.gradientStopErrors.set(next.map(() => null));
    this.dispatchGradient();
  }

  removeGradientStop(index: number): void {
    const stops = this.gradientStops();
    if (stops.length <= MIN_GRADIENT_STOPS) return;
    if (index < 0 || index >= stops.length) return;
    const next = stops.filter((_, i) => i !== index);
    this.gradientStops.set(next);
    this.gradientStopErrors.set(next.map(() => null));
    this.dispatchGradient();
  }

  onGradientStopColorInput(index: number, value: string): void {
    const stops = this.gradientStops();
    const current = stops[index];
    if (current === undefined) return;
    const trimmed = value.trim();
    const hex = normaliseHex(trimmed);
    if (hex === null) {
      const errs = this.gradientStopErrors().slice();
      errs[index] = 'Enter a hex color like #RRGGBB or #RRGGBBAA.';
      this.gradientStopErrors.set(errs);
      return;
    }
    const errs = this.gradientStopErrors().slice();
    errs[index] = null;
    this.gradientStopErrors.set(errs);
    const next = stops.slice();
    next[index] = { at: current.at, color: hex };
    this.gradientStops.set(next);
    this.dispatchGradient();
  }

  onGradientStopAtInput(index: number, value: number): void {
    const stops = this.gradientStops();
    const current = stops[index];
    if (current === undefined) return;
    if (!Number.isFinite(value)) return;
    const clamped = Math.min(1, Math.max(0, value));
    const next = stops.slice();
    next[index] = { at: clamped, color: current.color };
    this.gradientStops.set(next);
    this.dispatchGradient();
  }

  /** Build & dispatch a gradient command from the current local editor state. */
  private dispatchGradient(): void {
    const stops = this.gradientStops()
      .map((s) => ({ ...s }))
      // Sort on dispatch — per spec, we don't block edits, we re-order.
      .sort((a, b) => a.at - b.at);
    // Block dispatch if any stop has an inline color-error.
    if (this.gradientStopErrors().some((e) => e !== null)) return;
    this.dispatchBackground({
      kind: 'gradient',
      angle: degToRad(this.gradientAngleDeg()),
      stops,
    });
  }

  // ── Dispatch helpers ──────────────────────────────────────────────────

  private dispatchBackground(background: TankStyle['background']): void {
    const current = this.style();
    const next: TankStyle = {
      frame: current.frame,
      background,
    };
    if (current.frameColor !== undefined) next.frameColor = current.frameColor;
    if (current.waterTint !== undefined) next.waterTint = current.waterTint;
    this.dispatch(next);
  }

  private dispatch(style: TankStyle): void {
    // Last-chance UI-level validation so we don't round-trip an obviously
    // bad hex through the effect. The domain layer still re-validates.
    if (style.frameColor !== undefined && !isDomainHex(style.frameColor)) {
      this.rejectionMessage.set(`Frame color "${style.frameColor}" is not a valid hex.`);
      return;
    }
    if (style.waterTint !== undefined && !isDomainHex(style.waterTint)) {
      this.rejectionMessage.set(`Water tint "${style.waterTint}" is not a valid hex.`);
      return;
    }
    this.rejectionMessage.set(null);
    this.store.dispatch(SceneActions.dispatchCommand({ command: setTankStyle(style) }));
  }

  // ── Internals ─────────────────────────────────────────────────────────

  /**
   * Reflect a fresh style coming from the store into the UI-level signals.
   * Pure mirror — no dispatch happens here.
   */
  private syncFromStyle(style: TankStyle): void {
    if (style.frameColor !== undefined) {
      this.cachedFrameColor.set(style.frameColor);
    }
    if (style.waterTint !== undefined) {
      this.waterTintInput.set(style.waterTint);
    } else if (this.waterTintError() === null) {
      // Don't clobber an in-flight error message from the user mid-type.
      this.waterTintInput.set('');
    }
    switch (style.background.kind) {
      case 'none':
        this.backgroundTab.set('none');
        break;
      case 'color':
        this.backgroundTab.set('color');
        if (this.bgSolidError() === null) {
          this.bgSolidInput.set(style.background.color);
        }
        break;
      case 'gradient':
        this.backgroundTab.set('gradient');
        this.gradientAngleDeg.set(radToDeg(style.background.angle));
        this.gradientStops.set(style.background.stops.map((s) => ({ ...s })));
        this.gradientStopErrors.set(style.background.stops.map(() => null));
        break;
      case 'image':
        this.backgroundTab.set('image');
        break;
    }
  }
}
