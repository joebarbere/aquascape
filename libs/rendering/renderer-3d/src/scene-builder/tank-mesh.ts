/**
 * Tank mesh builder — Stage 10 F10.1.
 *
 * Renders the OPEN-TOPPED glass box and the optional frame (rimless /
 * framed / braced). The resulting group is positioned in world space so the
 * tank's front-bottom-left interior corner sits at the origin `(0, 0, 0)` —
 * same origin the `.aqua` document uses.
 *
 * **No top pane, no water plane here.** Real aquariums are open-topped, so
 * both glass shells slice the +Y face out of their box geometry (see
 * `buildOpenTopBoxGeometry`) — the closed `BoxGeometry` "lid" became
 * visibly reflective once the fidelity pass added transmissive glass + an
 * IBL environment, reading as a phantom pane at the rim. The water surface
 * is the renderer-level ANIMATED plane (`water-mesh.ts`); the Stage 10 v1
 * static `waterTint` plane that used to live here was retired when its job
 * (carrying the authored tint) moved onto the animated surface — two
 * stacked water planes 25 mm apart read as a rendering bug.
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
  BackSide,
  BoxGeometry,
  type BufferGeometry,
  EdgesGeometry,
  FrontSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
} from 'three';

/** Frame rim band thickness — matches the 2D renderer's `FRAME_RIM_MM`. */
const FRAME_RIM_MM = 8;
/** Centre brace bar width — matches the 2D renderer's `FRAME_BRACE_WIDTH_MM`. */
const FRAME_BRACE_WIDTH_MM = 10;
/** Default frame colour when `tankStyle.frameColor` is undefined. */
const DEFAULT_FRAME_COLOR = '#222222';

/**
 * Build the tank group: open-topped glass box + frame (when not rimless).
 * The water surface is NOT built here — see the header (it's the animated
 * renderer-level plane in `water-mesh.ts`, which also carries the authored
 * `style.waterTint`).
 */
export function buildTankMesh(tank: Tank): Group {
  const group = new Group();
  group.name = 'aquascape:tank';

  group.add(buildGlassBox(tank));

  const frame = buildFrame(tank, tank.style);
  if (frame !== null) group.add(frame);

  return group;
}

/**
 * A `BoxGeometry` with the TOP (+Y) face removed — aquariums are open-
 * topped. Implemented by filtering the index buffer: any triangle whose
 * three vertices ALL sit at the box's top plane (`y = +height/2` in the
 * geometry's local centred frame) belongs to the lid and is dropped.
 * Filtering by vertex position rather than by group order keeps this
 * independent of `BoxGeometry`'s internal face ordering. Group metadata is
 * cleared (it indexes the original 6-face layout; we draw with a single
 * material anyway).
 */
function buildOpenTopBoxGeometry(width: number, height: number, depth: number): BufferGeometry {
  const geo = new BoxGeometry(width, height, depth);
  const index = geo.getIndex();
  const pos = geo.getAttribute('position');
  if (index === null) return geo; // defensive — BoxGeometry is always indexed
  const topY = height / 2;
  const eps = 1e-4;
  const kept: number[] = [];
  for (let i = 0; i < index.count; i += 3) {
    const a = index.getX(i);
    const b = index.getX(i + 1);
    const c = index.getX(i + 2);
    const onLid =
      Math.abs(pos.getY(a) - topY) < eps &&
      Math.abs(pos.getY(b) - topY) < eps &&
      Math.abs(pos.getY(c) - topY) < eps;
    if (!onLid) kept.push(a, b, c);
  }
  geo.setIndex(kept);
  geo.clearGroups();
  return geo;
}

/**
 * The glass box — physically-based transmissive glass (fidelity pass).
 *
 * The original v1 used `MeshBasicMaterial` with low opacity because
 * `MeshPhysicalMaterial.transmission` needs an *environment* to refract /
 * reflect through; against the old empty dark clear color it rendered as a
 * near-opaque dark tint ("I see nothing in 3D"). Now that the renderer sets
 * an IBL environment (`scene.environment`, see `three-3d-renderer.ts`), the
 * glass has something to reflect and refract, so we can ship real glass: a
 * Fresnel-bright rim, a faint blue body tint, and a clear refractive
 * interior. `attenuationDistance` is left at its default (∞) so the large
 * millimetre-scale tank doesn't darken the contents seen through the glass.
 *
 * Single-sided (`FrontSide`) — the camera orbits OUTSIDE the tank, so we
 * render the outward-facing glass and let the contents show through via
 * transmission. `depthWrite: false` keeps the glass from occluding the
 * transparent water surface + fish behind it in the depth sort.
 *
 * A faint additive inner shell (`buildGlassInnerSheen`) gives the box a
 * readable silhouette from grazing angles where a perfectly clear pane
 * would otherwise vanish — cheap insurance against the "is the tank even
 * there?" read.
 *
 * Centred so the box's front-bottom-left interior corner is at the world
 * origin (matching `aqua-document.ts`).
 */
function buildGlassBox(tank: Tank): Mesh {
  const geo = buildOpenTopBoxGeometry(tank.width, tank.height, tank.depth);
  const mat = new MeshPhysicalMaterial({
    color: 0xeaf4f6,
    metalness: 0,
    roughness: 0.03,
    transmission: 1,
    ior: 1.45,
    thickness: 6,
    transparent: true,
    depthWrite: false,
    side: FrontSide,
    envMapIntensity: 1,
  });
  const mesh = new Mesh(geo, mat);
  mesh.name = 'aquascape:tank/glass';
  mesh.position.set(tank.width / 2, tank.height / 2, tank.depth / 2);
  // No shadows on glass — a transmissive pane neither casts a meaningful
  // shadow nor needs to receive one.
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.add(buildGlassInnerSheen(tank));
  return mesh;
}

/**
 * A faint inner shell rendered on the BackSide so the tank keeps a legible
 * edge/silhouette from grazing angles where the clear transmissive pane
 * alone would disappear. Very low opacity — it reads as the cool tint of
 * water-filled glass, not as a visible wall. Parented to the glass mesh so
 * it shares the box centre + is disposed by the same `disposeNode` walk.
 */
function buildGlassInnerSheen(tank: Tank): Mesh {
  const geo = buildOpenTopBoxGeometry(tank.width, tank.height, tank.depth);
  const mat = new MeshBasicMaterial({
    color: 0xb8d8e0,
    transparent: true,
    opacity: 0.05,
    side: BackSide,
    depthWrite: false,
  });
  const mesh = new Mesh(geo, mat);
  mesh.name = 'aquascape:tank/glass-sheen';
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

