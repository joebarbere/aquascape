// Orbit-3D service. Stage 10 follow-up — extending the editor's zoom
// control + adding pan / rotate buttons in 3D mode.
//
// The 3D renderer's `Three3DRenderer` implements an `Orbital3DControls`
// interface (zoom / pan / rotate / reset + change subscription). This
// service is the Angular-flavoured wrapper around that interface:
//
//   - Injects `ORBITAL_3D_CONTROLS` (provided by `apps/web` with the
//     same instance backing `SCENE_RENDERER_3D`). Resolves to `null` in
//     2D-only test beds or when the SCENE_RENDERER_3D stub doesn't
//     implement orbital methods — every method on this service then
//     no-ops, so call sites don't need null-checks.
//   - Exposes `zoomFraction` as an Angular signal so the zoom control's
//     "% label" updates reactively whether the user clicked a button or
//     spun the camera with the mouse.
//   - Wraps `zoomIn` / `zoomOut` / `pan` / `rotate` / `reset` so the UI
//     speaks application-level intents instead of factor / radian math.
//
// Why a service rather than direct injection of the token into the
// component: the signal-shaped reactive state lives ONLY here. The
// component reads `zoomFraction()` for its label and calls the named
// methods for actions — no factor math leaks into the template, and
// future renderer instrumentation (analytics, autosave hints) only has
// to wire into one place.

import { DestroyRef, Injectable, NgZone, inject, signal } from '@angular/core';

import { ORBITAL_3D_CONTROLS, type Orbital3DControls } from './orbital-3d-controls.token';

/** Multiplier for one zoom-button click. Mirrors `ZOOM_STEP_MULT` in `zoom-math.ts`. */
const ZOOM_BUTTON_STEP = 1.25;
/**
 * One pan-button click = 10% of the current camera-target distance, so
 * the visual shift feels consistent regardless of how zoomed-in the
 * camera is. Matches the `panBy()` doc contract on `Orbital3DControls`.
 */
const PAN_BUTTON_FRACTION = 0.1;
/** One rotate-button click = ~6° (π / 30 radians). Smooth + predictable. */
const ROTATE_BUTTON_RADIANS = Math.PI / 30;

@Injectable({ providedIn: 'root' })
export class Orbit3DService {
  private readonly controls: Orbital3DControls | null = inject(ORBITAL_3D_CONTROLS, {
    optional: true,
  });
  private readonly destroyRef = inject(DestroyRef);
  private readonly zone = inject(NgZone);

  /**
   * Current zoom fraction — `1` at the initial framing distance, `> 1`
   * when zoomed in, `< 1` when zoomed out. Signal so the zoom-percent
   * label re-renders under OnPush. Stays at `1` when no 3D controls are
   * wired (2D-only test beds).
   */
  readonly zoomFraction = signal<number>(1);

  /**
   * True iff a real `Orbital3DControls` implementation is wired. The
   * pan/rotate UI uses this to render disabled buttons (rather than
   * pretending to work) when 3D is stubbed.
   */
  readonly available: boolean = this.controls !== null;

  constructor() {
    if (this.controls === null) return;
    // Seed the signal with whatever the renderer reports right now, then
    // mirror every subsequent change. The 3D renderer fires change events
    // from OrbitControls's `'change'` event — which OrbitControls dispatches
    // inside the animation tick that runs OUTSIDE the Angular zone, so
    // re-entering the zone is required to make the signal write trigger
    // change detection on consumers (the zoom-control label).
    this.zoomFraction.set(this.controls.getZoomFraction());
    const unsub = this.controls.addChangeListener(() => {
      const next = this.controls!.getZoomFraction();
      this.zone.run(() => this.zoomFraction.set(next));
    });
    this.destroyRef.onDestroy(unsub);
  }

  /** Zoom IN by one button step (camera moves closer to the orbit target). */
  zoomIn(): void {
    this.controls?.zoomBy(ZOOM_BUTTON_STEP);
  }

  /** Zoom OUT by one button step (camera moves farther from the orbit target). */
  zoomOut(): void {
    this.controls?.zoomBy(1 / ZOOM_BUTTON_STEP);
  }

  /** Pan LEFT — shifts the camera + target left in the camera's screen-X axis. */
  panLeft(): void {
    this.controls?.panBy(-PAN_BUTTON_FRACTION, 0);
  }

  /** Pan RIGHT. */
  panRight(): void {
    this.controls?.panBy(PAN_BUTTON_FRACTION, 0);
  }

  /** Pan UP. */
  panUp(): void {
    this.controls?.panBy(0, PAN_BUTTON_FRACTION);
  }

  /** Pan DOWN. */
  panDown(): void {
    this.controls?.panBy(0, -PAN_BUTTON_FRACTION);
  }

  /** Rotate the camera LEFT around the orbit target (around the Y axis). */
  rotateLeft(): void {
    this.controls?.rotateBy(-ROTATE_BUTTON_RADIANS, 0);
  }

  /** Rotate RIGHT. */
  rotateRight(): void {
    this.controls?.rotateBy(ROTATE_BUTTON_RADIANS, 0);
  }

  /** Tilt the camera UP (orbit toward the top of the scene). */
  rotateUp(): void {
    this.controls?.rotateBy(0, -ROTATE_BUTTON_RADIANS);
  }

  /** Tilt the camera DOWN (orbit toward the bottom of the scene). */
  rotateDown(): void {
    this.controls?.rotateBy(0, ROTATE_BUTTON_RADIANS);
  }

  /** Reset the camera to its initial 3/4-view framing for the current tank. */
  reset(): void {
    this.controls?.resetView();
  }
}
