/**
 * Tank mesh builder — Stage 10 F10.1.
 *
 * Renders the glass box, optional frame (rimless / framed / braced), and an
 * optional water surface plane just below the rim. The resulting group is
 * positioned in world space so the tank's front-bottom-left interior corner
 * sits at the origin `(0, 0, 0)` — same origin the `.aqua` document uses.
 *
 * What's NOT here (Stage 10 v2 follow-up):
 *   - `tank.style.background` (rear-glass paint) — that's a 2D conceit;
 *     painting it on the back face of the glass box reads weird in
 *     perspective and we'd rather paint a textured back wall once we have
 *     the "customise the room" scope.
 *   - Glass thickness as visible geometry. v1 paints the inner box only.
 */

import type { Tank, TankStyle } from '@aquascape/domain/scene-model';
import {
  BoxGeometry,
  DoubleSide,
  EdgesGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
} from 'three';

/** Frame rim band thickness — matches the 2D renderer's `FRAME_RIM_MM`. */
const FRAME_RIM_MM = 8;
/** Centre brace bar width — matches the 2D renderer's `FRAME_BRACE_WIDTH_MM`. */
const FRAME_BRACE_WIDTH_MM = 10;
/** Default frame colour when `tankStyle.frameColor` is undefined. */
const DEFAULT_FRAME_COLOR = '#222222';
/** Water gap below tank top — typical aquarium air gap. */
const WATER_LINE_GAP_MM = 30;

/**
 * Build the tank group: glass box, frame (when not rimless), and water
 * plane (when `style.waterTint` is defined).
 */
export function buildTankMesh(tank: Tank): Group {
  const group = new Group();
  group.name = 'aquascape:tank';

  group.add(buildGlassBox(tank));

  const frame = buildFrame(tank, tank.style);
  if (frame !== null) group.add(frame);

  const water = buildWaterPlane(tank, tank.style);
  if (water !== null) group.add(water);

  return group;
}

/**
 * The glass box — barely-tinted plain transparency. We deliberately do
 * NOT use `MeshPhysicalMaterial.transmission` here: physical transmission
 * needs an environment to refract through, and against an empty
 * dark-blue clear color the glass renders as a near-opaque dark tint
 * (the symptom that made "I see nothing in 3D" the first reported bug).
 * `MeshBasicMaterial` with low opacity reads cleanly as "clear glass"
 * regardless of what's behind it.
 *
 * Two-sided so the camera inside an orbit volume sees both faces.
 * Centred so the box's front-bottom-left interior corner is at the
 * world origin (matching `aqua-document.ts`).
 */
function buildGlassBox(tank: Tank): Mesh {
  const geo = new BoxGeometry(tank.width, tank.height, tank.depth);
  const mat = new MeshBasicMaterial({
    color: 0xb8d8e0,
    transparent: true,
    opacity: 0.12,
    side: DoubleSide,
    depthWrite: false,
  });
  const mesh = new Mesh(geo, mat);
  mesh.name = 'aquascape:tank/glass';
  mesh.position.set(tank.width / 2, tank.height / 2, tank.depth / 2);
  return mesh;
}

/**
 * Frame overlay — top + bottom rim for `'framed'`, plus a centre brace
 * for `'braced'`. We use `EdgesGeometry` from the box plus thin rim boxes
 * (cheap + reads correctly at every angle). Returns `null` for rimless.
 */
function buildFrame(tank: Tank, style: TankStyle): Group | null {
  if (style.frame === 'rimless') return null;
  const color = style.frameColor ?? DEFAULT_FRAME_COLOR;
  const group = new Group();
  group.name = 'aquascape:tank/frame';
  const mat = new MeshBasicMaterial({ color });

  // Top rim
  const topGeo = new BoxGeometry(tank.width, FRAME_RIM_MM, tank.depth);
  const top = new Mesh(topGeo, mat);
  top.name = 'aquascape:tank/frame/top';
  top.position.set(tank.width / 2, tank.height - FRAME_RIM_MM / 2, tank.depth / 2);
  group.add(top);

  // Bottom rim
  const botGeo = new BoxGeometry(tank.width, FRAME_RIM_MM, tank.depth);
  const bot = new Mesh(botGeo, mat);
  bot.name = 'aquascape:tank/frame/bottom';
  bot.position.set(tank.width / 2, FRAME_RIM_MM / 2, tank.depth / 2);
  group.add(bot);

  // Edge wireframe along the corner posts so the cube reads as framed.
  const edgesGeo = new EdgesGeometry(new BoxGeometry(tank.width, tank.height, tank.depth));
  const edges = new LineSegments(edgesGeo, new LineBasicMaterial({ color }));
  edges.name = 'aquascape:tank/frame/edges';
  edges.position.set(tank.width / 2, tank.height / 2, tank.depth / 2);
  group.add(edges);

  if (style.frame === 'braced') {
    const braceGeo = new BoxGeometry(FRAME_BRACE_WIDTH_MM, FRAME_RIM_MM, tank.depth);
    const brace = new Mesh(braceGeo, mat);
    brace.name = 'aquascape:tank/frame/brace';
    brace.position.set(tank.width / 2, tank.height - FRAME_RIM_MM / 2, tank.depth / 2);
    group.add(brace);
  }
  return group;
}

/**
 * Water surface plane sits just below the rim. Only present when
 * `style.waterTint` is defined — we keep v1 honest by NOT painting water
 * in a "clear" tank (which is what the user authored). Future iterations
 * can default to a clear water surface.
 *
 * The plane is horizontal (rotated −π/2 about the X axis from its default
 * XY orientation so it ends up in the XZ plane) and sits at
 * `y = tank.height - WATER_LINE_GAP_MM`.
 */
function buildWaterPlane(tank: Tank, style: TankStyle): Mesh | null {
  if (style.waterTint === undefined) return null;
  const geo = new PlaneGeometry(tank.width, tank.depth);
  // Same lesson as the glass box: against an empty clear color,
  // `transmission` reads as a dark tint. Plain transparency is
  // honest about what we can render in v1 without a real environment.
  const mat = new MeshBasicMaterial({
    color: style.waterTint,
    transparent: true,
    opacity: 0.2,
    side: DoubleSide,
    depthWrite: false,
  });
  const mesh = new Mesh(geo, mat);
  mesh.name = 'aquascape:tank/water';
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(tank.width / 2, tank.height - WATER_LINE_GAP_MM, tank.depth / 2);
  return mesh;
}
