/**
 * Siphon nozzle tool — Stage 15 F15.2 (water-change) + Stage 16 F16.5 (cleaner
 * mode). ONE implementation, shared by both: the HUD places/moves it via canvas
 * drags (using the canvas→tank raycast) and toggles its OUT/IN suction state;
 * the cleaner game mode reuses the same handle without forking.
 *
 * WHAT IT IS
 * ----------
 * A small procedural nozzle `Object3D` — a tapered tube (the gravel-vac body)
 * with a flared intake mouth at the bottom and a thin riser stem — built from
 * core `three` primitives only (`CylinderGeometry`), no addons, no GLB, no
 * texture. It is a PERSISTENT handle updated in place (like `WaterMeshHandle`),
 * NOT rebuilt in the content-group churn: the renderer parents `handle.group`
 * into each freshly-built content group but never disposes it on a rebuild.
 *
 * COORDINATES
 * -----------
 * `setPosition` takes a **canonical document** position (mm, origin
 * front-bottom-left). Because the renderer wraps content in the doc→world
 * X-mirror, the nozzle is parented INTO the mirrored content group, so a plain
 * `group.position.set(docX, docY, docZ)` renders at the right spot — the parent
 * mirror handles X. (This matches every other scene-builder: they all author in
 * doc space and let the group mirror do the flip.) The nozzle mouth points
 * straight down (−Y) so it reads as a vertical gravel vac regardless of mirror.
 *
 * OUT / IN VISUAL STATES
 * ----------------------
 * `setMode('idle' | 'out' | 'in')` recolours the body + toggles a small cone
 * "flow indicator" at the mouth:
 *  - `idle` — neutral grey body, indicator hidden.
 *  - `out`  — warm/amber body + a cone pointing UP INTO the nozzle (water +
 *             waste being sucked OUT of the tank), tinted to read as suction.
 *  - `in`   — cool/blue body + a cone pointing DOWN out of the nozzle (clean
 *             replacement water flowing IN), tinted to read as inflow.
 * The indicator is a single reused cone whose orientation + colour flip with
 * the mode (no per-mode geometry rebuild).
 *
 * DISPOSE
 * -------
 * `dispose()` releases every geometry + material it created (idempotent — nulls
 * its handles after the first call). The renderer detaches the group from the
 * content tree before `disposeNode` runs (same dance as the water mesh) so the
 * tool's resources are released exactly once, on tool-exit or renderer dispose.
 */

import type { Vec3 } from '@aquascape/domain/geometry';
import {
  CylinderGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Object3D,
  type Material,
} from 'three';

/** Active suction state of the nozzle. */
export type SiphonMode = 'idle' | 'out' | 'in';

/** Nozzle body height (mm) — a typical gravel-vac tube length. */
const NOZZLE_BODY_HEIGHT_MM = 120;
/** Nozzle body top radius (mm) — the narrow riser end. */
const NOZZLE_TOP_RADIUS_MM = 6;
/** Nozzle body bottom radius (mm) — the flared intake mouth. */
const NOZZLE_MOUTH_RADIUS_MM = 22;
/** Riser-stem height above the body (mm) — the hose attachment. */
const STEM_HEIGHT_MM = 60;
/** Riser-stem radius (mm). */
const STEM_RADIUS_MM = 4;
/** Flow-indicator cone height (mm). */
const INDICATOR_HEIGHT_MM = 28;
/** Flow-indicator cone base radius (mm). */
const INDICATOR_RADIUS_MM = 14;

/** Body colour per mode (hex). */
const BODY_COLOR_IDLE = 0x8a8f99;
const BODY_COLOR_OUT = 0xc9893f; // amber — suction OUT
const BODY_COLOR_IN = 0x3f8fc9; // blue — inflow IN
/** Flow-indicator colour per mode (emissive-leaning so it reads under water). */
const INDICATOR_COLOR_OUT = 0xe0a85a;
const INDICATOR_COLOR_IN = 0x5ab4e0;

/**
 * Handle returned by `buildSiphonTool`. Mirrors the `WaterMeshHandle` shape:
 * a `group` to parent into the content tree, in-place mutators, and an
 * idempotent `dispose`.
 */
export interface SiphonToolHandle {
  /** The nozzle `Object3D`. Parent into the (mirrored) content group. */
  readonly group: Object3D;
  /**
   * Place the nozzle at a canonical document position (mm). The group is
   * parented inside the mirrored content group, so X is handled by the parent
   * mirror — pass raw doc coordinates. No-op after `dispose()`.
   */
  setPosition(pos: Vec3): void;
  /** Current canonical document position (mm). */
  getPosition(): Vec3;
  /** Toggle the OUT/IN/idle visual state. No-op after `dispose()`. */
  setMode(mode: SiphonMode): void;
  /** Current mode. */
  getMode(): SiphonMode;
  /** Release geometry + material. Idempotent. */
  dispose(): void;
}

/**
 * Build the siphon nozzle tool.
 *
 * Geometry is authored with the nozzle mouth at the group's local origin
 * (the bottom), the body rising in +Y, so `setPosition(docPos)` places the
 * intake mouth exactly at `docPos` — the host raycasts a tank point and the
 * mouth lands there, which is the natural "this is where I'm vacuuming" point.
 */
export function buildSiphonTool(): SiphonToolHandle {
  const group = new Group();
  group.name = 'aquascape:siphon-tool';

  // Body: a tapered cylinder, narrow at the top (riser end), flared at the
  // mouth. Authored so the MOUTH sits at local y = 0 and the body rises in +Y.
  const bodyGeo = new CylinderGeometry(
    NOZZLE_TOP_RADIUS_MM,
    NOZZLE_MOUTH_RADIUS_MM,
    NOZZLE_BODY_HEIGHT_MM,
    20,
    1,
    true, // open-ended — it's a tube, the mouth is open
  );
  // CylinderGeometry is centred on its local origin; shift up so the mouth
  // (the −radius end) sits at y = 0.
  bodyGeo.translate(0, NOZZLE_BODY_HEIGHT_MM / 2, 0);
  const bodyMat = new MeshStandardMaterial({
    color: BODY_COLOR_IDLE,
    roughness: 0.6,
    metalness: 0.1,
  });
  const body = new Mesh(bodyGeo, bodyMat);
  body.name = 'aquascape:siphon-tool/body';
  group.add(body);

  // Riser stem rising above the body (the hose attachment).
  const stemGeo = new CylinderGeometry(STEM_RADIUS_MM, STEM_RADIUS_MM, STEM_HEIGHT_MM, 12);
  stemGeo.translate(0, NOZZLE_BODY_HEIGHT_MM + STEM_HEIGHT_MM / 2, 0);
  const stemMat = new MeshStandardMaterial({ color: 0x55585f, roughness: 0.5, metalness: 0.2 });
  const stem = new Mesh(stemGeo, stemMat);
  stem.name = 'aquascape:siphon-tool/stem';
  group.add(stem);

  // Flow indicator: a cone near the mouth. Hidden in idle; in OUT it points UP
  // (suction into the nozzle), in IN it points DOWN (water flowing out the
  // mouth). One geometry; we flip orientation + colour per mode.
  const indicatorGeo = new CylinderGeometry(0, INDICATOR_RADIUS_MM, INDICATOR_HEIGHT_MM, 16);
  const indicatorMat = new MeshStandardMaterial({
    color: INDICATOR_COLOR_OUT,
    emissive: INDICATOR_COLOR_OUT,
    emissiveIntensity: 0.6,
    roughness: 0.4,
    transparent: true,
    opacity: 0.85,
  });
  const indicator = new Mesh(indicatorGeo, indicatorMat);
  indicator.name = 'aquascape:siphon-tool/indicator';
  // Park it just below the mouth; mode flips its rotation + position.
  indicator.position.set(0, -INDICATOR_HEIGHT_MM, 0);
  indicator.visible = false;
  group.add(indicator);

  let disposed = false;
  let mode: SiphonMode = 'idle';
  const position: Vec3 = { x: 0, y: 0, z: 0 };

  function applyMode(next: SiphonMode): void {
    mode = next;
    switch (next) {
      case 'idle':
        bodyMat.color.set(BODY_COLOR_IDLE);
        indicator.visible = false;
        break;
      case 'out':
        bodyMat.color.set(BODY_COLOR_OUT);
        indicatorMat.color.set(INDICATOR_COLOR_OUT);
        indicatorMat.emissive.set(INDICATOR_COLOR_OUT);
        // Suction OUT: cone apex points UP into the nozzle mouth.
        indicator.rotation.set(0, 0, 0);
        indicator.position.set(0, -INDICATOR_HEIGHT_MM / 2, 0);
        indicator.visible = true;
        break;
      case 'in':
        bodyMat.color.set(BODY_COLOR_IN);
        indicatorMat.color.set(INDICATOR_COLOR_IN);
        indicatorMat.emissive.set(INDICATOR_COLOR_IN);
        // Inflow IN: cone apex points DOWN out of the mouth (flip about Z).
        indicator.rotation.set(Math.PI, 0, 0);
        indicator.position.set(0, -INDICATOR_HEIGHT_MM, 0);
        indicator.visible = true;
        break;
    }
  }

  return {
    group,
    setPosition(pos: Vec3): void {
      if (disposed) return;
      position.x = pos.x;
      position.y = pos.y;
      position.z = pos.z;
      group.position.set(pos.x, pos.y, pos.z);
    },
    getPosition(): Vec3 {
      return { x: position.x, y: position.y, z: position.z };
    },
    setMode(next: SiphonMode): void {
      if (disposed) return;
      applyMode(next);
    },
    getMode(): SiphonMode {
      return mode;
    },
    dispose(): void {
      if (disposed) return;
      disposed = true;
      for (const geo of [bodyGeo, stemGeo, indicatorGeo]) geo.dispose();
      for (const mat of [bodyMat, stemMat, indicatorMat] as Material[]) mat.dispose();
    },
  };
}
