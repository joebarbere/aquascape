#!/usr/bin/env node
/**
 * generate-decor-models.mjs — deterministic procedural aquarium-decoration baker.
 *
 * Bakes 10 showcase GLB ornament models (treasure chest, sunken galleon, skull,
 * diver helmet, anchor, greek column, moai, castle, amphora, cannon) into
 * libs/domain/catalog/assets/models/. Pure three.js geometry math -> GLB via
 * GLTFExporter; no network, no licensed assets, no textures/images inside the
 * GLBs (geometry + vertex colors + PBR material params only), no Math.random(),
 * no Date.
 *
 *   node tools/generate-decor-models.mjs                 # bake + verify + write all
 *   node tools/generate-decor-models.mjs --only=skull,anchor
 *
 * Pipeline per model:
 *   1. build(rng) constructs a THREE.Group of named Meshes. All randomness comes
 *      from a splitmix32 PRNG with a fixed per-model seed plus stateless integer
 *      hashing (hash01) and seeded 3D value-noise fBm — never Math.random/Date.
 *   2. World transforms are baked into the geometry, then the whole model is
 *      scaled per-axis so its AABB is EXACTLY width x height x depth (mm, Y-up,
 *      front facing +Z), re-positioned to bottom-center origin (minY = 0,
 *      centered on x/z), and asserted to 1e-3 mm.
 *   3. Materials use the full MeshPhysicalMaterial palette where physically
 *      appropriate (metalness/roughness, clearcoat, transmission + ior + volume,
 *      iridescence, sheen, emissive strength) so the exporter emits the matching
 *      KHR_materials_* extensions. Weathering/patina/rust is per-vertex color
 *      (COLOR_0 multiplies base color in glTF).
 *   4. Smooth vs flat normals are chosen deliberately per part: organic sculpts
 *      are welded (mergeVertices) + smooth-normal'd; gems/splinters are
 *      flat-shaded via toNonIndexed + computeVertexNormals.
 *   5. Determinism: every model is built + exported TWICE from scratch and the
 *      two GLB byte streams are asserted identical before anything is written.
 *
 * The GLB JSON chunk is parsed back to report extensionsUsed + triangle counts.
 * UVs are stripped (no textures), keeping files small.
 */

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = resolve(__dirname, '..', 'libs', 'domain', 'catalog', 'assets', 'models');

// GLTFExporter's binary path uses FileReader (browser API). Node has Blob with
// .arrayBuffer(); a 3-line shim covers the exporter's exact usage.
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReaderShim {
    readAsArrayBuffer(blob) {
      blob.arrayBuffer().then((result) => {
        this.result = result;
        if (this.onloadend) this.onloadend();
      });
    }
  };
}

// ---------------------------------------------------------------------------
// PRNG + hashing — identical discipline to tools/generate-textures.mjs.
// splitmix32 (Steele/Lea/Flood SplitMix adapted to 32-bit JS — bryc/code).
// ---------------------------------------------------------------------------
function splitmix32(seed) {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x9e3779b9) | 0;
    let t = a ^ (a >>> 16);
    t = Math.imul(t, 0x21f0aaad);
    t = t ^ (t >>> 15);
    t = Math.imul(t, 0x735a2d97);
    return ((t = t ^ (t >>> 15)) >>> 0) / 4294967296;
  };
}

/** Stable integer hash -> [0,1) (no PRNG state). */
function hash01(n) {
  let t = (n + 0x9e3779b9) >>> 0;
  t = Math.imul(t ^ (t >>> 16), 0x21f0aaad);
  t = (t ^ (t >>> 15)) >>> 0;
  t = Math.imul(t ^ (t >>> 7), 0x735a2d97);
  return ((t ^ (t >>> 15)) >>> 0) / 4294967296;
}

const lerp = (a, b, t) => a + (b - a) * t;
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);
const fade = (t) => t * t * t * (t * (t * 6 - 15) + 10);
const smoothstep = (e0, e1, x) => {
  const t = clamp01((x - e0) / (e1 - e0));
  return t * t * (3 - 2 * t);
};
const DEG = Math.PI / 180;

/** Seeded 3D value noise on an integer lattice, output [0,1). */
function vnoise3(seed, x, y, z) {
  const xi = Math.floor(x);
  const yi = Math.floor(y);
  const zi = Math.floor(z);
  const u = fade(x - xi);
  const v = fade(y - yi);
  const w = fade(z - zi);
  const h = (i, j, k) =>
    hash01((Math.imul(i, 0x8da6b343) ^ Math.imul(j, 0xd8163841) ^ Math.imul(k, 0xcb1ab31f) ^ seed) >>> 0);
  const n00 = lerp(h(xi, yi, zi), h(xi + 1, yi, zi), u);
  const n10 = lerp(h(xi, yi + 1, zi), h(xi + 1, yi + 1, zi), u);
  const n01 = lerp(h(xi, yi, zi + 1), h(xi + 1, yi, zi + 1), u);
  const n11 = lerp(h(xi, yi + 1, zi + 1), h(xi + 1, yi + 1, zi + 1), u);
  return lerp(lerp(n00, n10, v), lerp(n01, n11, v), w);
}

/** Seeded 3D fBm, output roughly [0,1]. Coordinates are in caller units. */
function fbm3(seed, x, y, z, octaves = 4, gain = 0.5) {
  let s = 0;
  let amp = 1;
  let total = 0;
  let f = 1;
  for (let o = 0; o < octaves; o++) {
    s += amp * vnoise3((seed + o * 0x9e37) >>> 0, x * f, y * f, z * f);
    total += amp;
    amp *= gain;
    f *= 2;
  }
  return s / total;
}

const ridge = (n) => 1 - Math.abs(2 * n - 1);

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------
function stripUv(g) {
  if (g.getAttribute('uv')) g.deleteAttribute('uv');
  return g;
}

/** Apply translate/rotate/scale to a geometry in place (normals fixed up by three). */
function place(g, pos = [0, 0, 0], rot = [0, 0, 0], scale = 1) {
  const s = Array.isArray(scale) ? scale : [scale, scale, scale];
  const m = new THREE.Matrix4().compose(
    new THREE.Vector3(...pos),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(...rot)),
    new THREE.Vector3(...s),
  );
  g.applyMatrix4(m);
  return g;
}

/** Flat-shade a geometry (deliberate faceting: gems, splinters, breaks). */
function flat(g) {
  const out = g.getIndex() ? stripUv(g).toNonIndexed() : stripUv(g);
  out.computeVertexNormals();
  return out;
}

/** Merge geometries into one (mixed indexed/non-indexed handled). */
function merged(geoms) {
  const mixed = geoms.some((g) => !g.getIndex());
  const list = geoms.map((g) => {
    stripUv(g);
    return mixed && g.getIndex() ? g.toNonIndexed() : g;
  });
  const g = mergeGeometries(list, false);
  if (!g) throw new Error('mergeGeometries failed (inconsistent attributes?)');
  return g;
}

/**
 * Per-vertex color paint. fn(p: Vector3, n: Vector3, i) -> [r,g,b] in [0,1].
 * COLOR_0 multiplies the material base color in glTF, so paints are usually
 * multipliers around ~0.8–1.0 (or full colors when material color is white).
 */
function paint(g, fn) {
  const pos = g.getAttribute('position');
  const nor = g.getAttribute('normal');
  const colors = new Float32Array(pos.count * 3);
  const p = new THREE.Vector3();
  const n = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    p.fromBufferAttribute(pos, i);
    n.fromBufferAttribute(nor, i);
    const [r, gg, b] = fn(p, n, i);
    colors[i * 3] = clamp01(r);
    colors[i * 3 + 1] = clamp01(gg);
    colors[i * 3 + 2] = clamp01(b);
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  return g;
}

/**
 * Indexed (ni x nj) parametric grid. posFn(u, v, i, j) -> [x, y, z] with
 * u = i/ni, v = j/nj. skip(u, v, i, j) drops quads (holes / breaches).
 */
function grid(ni, nj, posFn, { skip, flip } = {}) {
  const verts = new Float32Array((ni + 1) * (nj + 1) * 3);
  for (let i = 0; i <= ni; i++) {
    for (let j = 0; j <= nj; j++) {
      const [x, y, z] = posFn(i / ni, j / nj, i, j);
      const o = (i * (nj + 1) + j) * 3;
      verts[o] = x;
      verts[o + 1] = y;
      verts[o + 2] = z;
    }
  }
  const idx = [];
  for (let i = 0; i < ni; i++) {
    for (let j = 0; j < nj; j++) {
      if (skip && skip((i + 0.5) / ni, (j + 0.5) / nj, i, j)) continue;
      const a = i * (nj + 1) + j;
      const b = (i + 1) * (nj + 1) + j;
      const c = (i + 1) * (nj + 1) + j + 1;
      const d = i * (nj + 1) + j + 1;
      if (flip) idx.push(a, d, b, b, d, c);
      else idx.push(a, b, d, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Organic sculpt base: welded unit sphere; displaceFn(dir: Vector3) -> Vector3 position. */
function sculptedSphere(widthSegs, heightSegs, displaceFn) {
  let g = stripUv(new THREE.SphereGeometry(1, widthSegs, heightSegs));
  g = mergeVertices(g);
  const pos = g.getAttribute('position');
  const d = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    const out = displaceFn(d.clone(), i);
    pos.setXYZ(i, out.x, out.y, out.z);
  }
  g.computeVertexNormals();
  return g;
}

/** Angular gaussian around a unit direction (organic feature mask). */
function gdir(d, cx, cy, cz, sigma) {
  const len = Math.hypot(cx, cy, cz);
  const dot = Math.min(1, Math.max(-1, (d.x * cx + d.y * cy + d.z * cz) / len));
  const ang = Math.acos(dot);
  return Math.exp(-(ang * ang) / (2 * sigma * sigma));
}

function physical(name, props) {
  const m = new THREE.MeshPhysicalMaterial(props);
  m.name = name;
  return m;
}

function namedMesh(name, geometry, material) {
  const m = new THREE.Mesh(stripUv(geometry), material);
  m.name = name;
  return m;
}

// ---------------------------------------------------------------------------
// Model builders. Units mm, Y-up, front faces +Z. Builders aim close to the
// target dims; finalizeModel() applies the exact per-axis fit afterwards.
// ---------------------------------------------------------------------------

// ---------------------------------------------------------- 1. treasure chest
function buildTreasureChest(rng, seed) {
  const g = new THREE.Group();
  const W = 148;
  const D = 88;
  const BH = 56; // body height
  const R = D / 2; // lid radius
  const LID_OPEN = -55 * DEG;

  const wood = physical('chest-wood', { color: 0x573a1e, roughness: 0.85, vertexColors: true });
  const iron = physical('chest-iron', {
    color: 0x4e545c,
    metalness: 0.55,
    roughness: 0.85,
    vertexColors: true,
  });
  const gold = physical('chest-gold', {
    color: 0xe8a825,
    metalness: 1,
    roughness: 0.3,
    clearcoat: 0.6,
    clearcoatRoughness: 0.3,
    vertexColors: true,
  });

  const woodGrain = (p, tone) => {
    const grain = fbm3(seed ^ 0x11, p.x * 0.1, p.y * 0.45, p.z * 0.45, 3);
    const k = tone * (0.82 + 0.45 * (grain - 0.5));
    return [k, k * 0.9, k * 0.78];
  };

  // --- body: planked walls
  const bodyGeos = [];
  const rows = 4;
  const ph = BH / rows;
  for (const zs of [-1, 1]) {
    for (let r = 0; r < rows; r++) {
      const b = new THREE.BoxGeometry(W, ph - 1.4, 7, 8, 1, 1);
      const tone = 0.78 + 0.24 * rng();
      const jitter = (rng() - 0.5) * 1.6;
      paint(b, (p) => woodGrain(p, tone));
      place(b, [0, ph * (r + 0.5), zs * (D / 2 - 3.5) + jitter], [(rng() - 0.5) * 0.02, 0, 0]);
      bodyGeos.push(b);
    }
    for (let r = 0; r < rows; r++) {
      const b = new THREE.BoxGeometry(7, ph - 1.4, D - 15, 1, 1, 6);
      const tone = 0.78 + 0.24 * rng();
      paint(b, (p) => woodGrain(p, tone));
      place(b, [zs * (W / 2 - 3.5) + (rng() - 0.5) * 1.2, ph * (r + 0.5), 0]);
      bodyGeos.push(b);
    }
  }
  const bottom = new THREE.BoxGeometry(W - 4, 6, D - 4);
  paint(bottom, (p) => woodGrain(p, 0.7));
  place(bottom, [0, 3, 0]);
  bodyGeos.push(bottom);
  g.add(namedMesh('chest-body', merged(bodyGeos), wood));

  // --- iron straps, corner brackets, hasp
  const ironGeos = [];
  const ironPaint = (p) => {
    const wear = fbm3(seed ^ 0x22, p.x * 0.2, p.y * 0.2, p.z * 0.2, 3);
    const k = 0.35 + 0.45 * wear;
    return [k, k * 1.05, k * 1.12];
  };
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      ironGeos.push(place(new THREE.BoxGeometry(10, BH + 2, 3), [sx * (W / 2 - 5), BH / 2, sz * (D / 2 + 0.8)]));
      ironGeos.push(place(new THREE.BoxGeometry(3, BH + 2, 10), [sx * (W / 2 + 0.8), BH / 2, sz * (D / 2 - 5)]));
    }
  }
  for (const sx of [-1, 1]) {
    ironGeos.push(place(new THREE.BoxGeometry(11, BH + 2, 2.6), [sx * 40, BH / 2, D / 2 + 1.4]));
    ironGeos.push(place(new THREE.BoxGeometry(11, BH + 2, 2.6), [sx * 40, BH / 2, -(D / 2 + 1.4)]));
  }
  // hasp plate + pull ring on front center
  ironGeos.push(place(new THREE.BoxGeometry(15, 16, 2.8), [0, BH - 9, D / 2 + 1.6]));
  ironGeos.push(
    place(new THREE.TorusGeometry(5.2, 1.8, 10, 20), [0, BH - 21, D / 2 + 3.5], [Math.PI / 2 - 0.3, 0, 0]),
  );
  const ironMerged = merged(ironGeos);
  paint(ironMerged, ironPaint);
  g.add(namedMesh('chest-iron', ironMerged, iron));

  // --- lid (open, hinged at the back top edge)
  const lid = new THREE.Group();
  lid.position.set(0, BH, -R + 2);
  lid.rotation.x = LID_OPEN;
  const lidGeos = [];
  const shell = new THREE.CylinderGeometry(R, R, W - 2, 48, 1, true, 0, Math.PI);
  place(shell, [0, 0, 0], [0, 0, Math.PI / 2]); // axis along X, dome up
  paint(shell, (p) => {
    const ang = Math.atan2(p.y, p.z); // 0..PI over the dome
    const band = (ang / Math.PI) * 5;
    const seam = Math.pow(ridge(band - Math.floor(band)), 6);
    const tone = 0.82 + 0.14 * hash01(Math.floor(band) * 977 + 13);
    const c = woodGrain(p, tone * (1 - 0.35 * seam));
    return c;
  });
  place(shell, [0, 0, R]);
  lidGeos.push(shell);
  for (const sx of [-1, 1]) {
    const cap = new THREE.CircleGeometry(R, 24, 0, Math.PI);
    paint(cap, (p) => woodGrain(p, 0.8));
    place(cap, [sx * (W / 2 - 1), 0, R], [0, sx * (Math.PI / 2), 0]);
    lidGeos.push(cap);
  }
  const lip = new THREE.BoxGeometry(W - 2, 4, 9);
  paint(lip, (p) => woodGrain(p, 0.74));
  place(lip, [0, 0.5, 2 * R - 4]);
  lidGeos.push(lip);
  const lidMesh = namedMesh('chest-lid', merged(lidGeos), wood);
  lidMesh.material.side = THREE.DoubleSide;
  lid.add(lidMesh);
  // lid iron straps (half-torus over the shell) + hasp tongue
  const lidIron = [];
  for (const sx of [-1, 1]) {
    const strap = new THREE.TorusGeometry(R + 1.2, 2.2, 8, 26, Math.PI);
    place(strap, [sx * 40, 0, R], [0, Math.PI / 2, 0]);
    lidIron.push(strap);
  }
  lidIron.push(place(new THREE.BoxGeometry(12, 3, 14), [0, 1.5, 2 * R - 5]));
  const lidIronMerged = merged(lidIron);
  paint(lidIronMerged, ironPaint);
  lid.add(namedMesh('chest-lid-iron', lidIronMerged, iron));
  g.add(lid);

  // --- coin pile (heap inside + spill over the front lip + on the ground)
  const coinGeos = [];
  const addCoin = (x, y, z, tiltScale) => {
    const c = new THREE.CylinderGeometry(6.4, 6.4, 1.7, 14);
    const tone = 0.82 + 0.18 * rng();
    paint(c, () => [tone, tone * (0.94 + 0.06 * rng()), tone * 0.8]);
    place(c, [x, y, z], [(rng() - 0.5) * tiltScale, rng() * Math.PI, (rng() - 0.5) * tiltScale]);
    coinGeos.push(c);
  };
  for (let i = 0; i < 95; i++) {
    const x = (rng() * 2 - 1) * 60;
    const z = (rng() * 2 - 1) * 32;
    const mound = 18 + 44 * Math.exp(-((x / 46) ** 2) - (z / 28) ** 2);
    addCoin(x, Math.min(mound + rng() * 3, 72), z, 0.8);
  }
  for (let i = 0; i < 9; i++) {
    // cascade over the front wall
    const t = i / 8;
    addCoin((rng() * 2 - 1) * 46, 58 - t * 42, D / 2 + 2 + t * 9, 1.4);
  }
  for (let i = 0; i < 7; i++) {
    addCoin((rng() * 2 - 1) * 55, 1.2, D / 2 + 8 + rng() * 10, 0.25);
  }
  g.add(namedMesh('coin-pile', merged(coinGeos), gold));

  // --- gems (faceted, transmissive) + pearls (iridescent)
  const gemSpecs = [
    { name: 'gem-ruby', color: 0xd84055, att: 0x99081f, pos: [-26, 64, 6] },
    { name: 'gem-emerald', color: 0x37b56a, att: 0x0b5c2c, pos: [16, 67, -6] },
    { name: 'gem-sapphire', color: 0x4a6fe0, att: 0x12278c, pos: [33, 60, 16] },
  ];
  for (const spec of gemSpecs) {
    const mat = physical(spec.name, {
      color: spec.color,
      metalness: 0,
      roughness: 0.02,
      transmission: 0.9,
      ior: 1.8,
      thickness: 10,
      attenuationColor: new THREE.Color(spec.att),
      attenuationDistance: 22,
      clearcoat: 1,
      clearcoatRoughness: 0.04,
      emissive: spec.color,
      emissiveIntensity: 0.15,
    });
    // round-brilliant-ish cut: shallow 8-facet crown + deep pavilion
    const crown = new THREE.ConeGeometry(8, 4.5, 8, 1);
    place(crown, [0, 2.25, 0]);
    const pavilion = new THREE.ConeGeometry(8, 9, 8, 1);
    place(pavilion, [0, -4.5, 0], [Math.PI, 0, 0]);
    const gem = flat(merged([crown, pavilion]));
    place(gem, spec.pos, [rng() * 0.5 - 0.25, rng() * Math.PI, rng() * 0.5 - 0.25]);
    g.add(namedMesh(spec.name, gem, mat));
  }
  const pearlMat = physical('pearl', {
    color: 0xf6f1e7,
    metalness: 0,
    roughness: 0.16,
    clearcoat: 0.8,
    clearcoatRoughness: 0.2,
    iridescence: 1,
    iridescenceIOR: 1.8,
  });
  const pearlGeos = [];
  for (const [x, y, z] of [
    [-6, 63, 22],
    [40, 56, -14],
    [-42, 58, -12],
  ]) {
    pearlGeos.push(place(new THREE.SphereGeometry(5, 24, 18), [x, y, z]));
  }
  g.add(namedMesh('pearls', merged(pearlGeos), pearlMat));

  return g;
}

// ---------------------------------------------------------- 2. sunken galleon
function buildSunkenGalleon(rng, seed) {
  const g = new THREE.Group();
  const LIST = 14 * DEG; // roll about the long axis
  const X0 = -160;
  const LEN = 350;
  const BEAM = 55;
  const KEEL_Y = 14;
  const N_PLANK = 11;

  const woodMat = physical('galleon-wood', {
    color: 0x55482e,
    roughness: 0.9,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  const sparMat = physical('galleon-spar', { color: 0x4e4128, roughness: 0.9, vertexColors: true });

  const halfBeam = (t) => BEAM * Math.pow(Math.max(0.001, 1 - smoothstep(0.35, 1, t) ** 1.6), 0.75);
  const keelY = (t) => KEEL_Y + 130 * smoothstep(0.6, 1, t) ** 1.7;
  const railY = (t) => 148 + 70 * t ** 2.1 + 14 * (1 - t) ** 2;
  const sternJag = (j) => 42 * fbm3(seed ^ 0x31, j * 0.55, 0, 0, 3);

  const hullPoint = (t, s) => {
    const a = (s * Math.PI) / 2;
    const ky = keelY(t);
    const ry = railY(t);
    const y = ky + (ry - ky) * (1 - Math.cos(a));
    const z = Math.sign(s) * halfBeam(t) * Math.pow(Math.abs(Math.sin(a)), 0.78);
    const x = X0 + t * LEN;
    return [x, y, z];
  };

  // breach (swim-through) on the +z side, mid-length, jagged edge
  const inBreach = (t, s) => {
    const dt = (t - 0.4) / 0.095;
    const ds = (s - 0.62) / 0.2;
    const jag = 0.7 * (fbm3(seed ^ 0x32, t * 22, s * 22, 0, 3) - 0.5);
    return dt * dt + ds * ds + jag < 0.9;
  };

  const NI = 64;
  const NJ = 44;
  const hull = grid(
    NI,
    NJ,
    (u, v, i, j) => {
      const t = u;
      const s = v * 2 - 1;
      let [x, y, z] = hullPoint(t, s);
      // plank scalloping: per-plank bulge + per-plank jitter, radial in section
      const pf = (v * N_PLANK) % 1;
      const plankIdx = Math.floor(v * N_PLANK);
      const bump = 0.018 * 4 * pf * (1 - pf) + 0.012 * (hash01(plankIdx * 31 + Math.floor(t * 6) * 7 + (seed & 0xffff)) - 0.5);
      const cy = (keelY(t) + railY(t)) / 2;
      y = cy + (y - cy) * (1 + bump);
      z *= 1 + bump;
      // organic sag/warp + jagged broken stern edge
      x += 4 * (fbm3(seed ^ 0x33, y * 0.03, z * 0.03, t * 4, 3) - 0.5);
      if (i === 0) x += sternJag(j);
      return [x, y, z];
    },
    { skip: (t, v) => inBreach(t, v * 2 - 1), flip: false },
  );
  paint(hull, (p, n) => {
    const tt = (p.x - X0) / LEN;
    let k = 0.85 + 0.45 * (fbm3(seed ^ 0x34, p.x * 0.05, p.y * 0.12, p.z * 0.12, 3) - 0.5);
    // plank seams (recompute v-ish from section angle)
    const cy = (keelY(tt) + railY(tt)) / 2;
    const ang = Math.atan2(Math.abs(p.z), cy - p.y); // 0 at keel
    const pv = ang / Math.PI + 0.5;
    const pf = (pv * N_PLANK) % 1;
    k *= 1 - 0.5 * Math.pow(ridge(pf), 6);
    // dark waterline band
    k *= 1 - 0.55 * smoothstep(52, 68, p.y) * smoothstep(104, 88, p.y);
    // greenish algae mottle + pale barnacle speckle low on the hull
    const algae = smoothstep(0.48, 0.7, fbm3(seed ^ 0x35, p.x * 0.04, p.y * 0.04, p.z * 0.04, 4));
    const barn = smoothstep(0.68, 0.8, fbm3(seed ^ 0x36, p.x * 0.18, p.y * 0.18, p.z * 0.18, 3)) * smoothstep(85, 50, p.y);
    let r = k * (1 - 0.45 * algae) + 0.5 * barn;
    let gg = k * (1 + 0.18 * algae) + 0.55 * barn;
    let b = k * (0.8 - 0.25 * algae) + 0.5 * barn;
    // charred broken edge near the stern break
    const burn = smoothstep(0.07, 0.0, tt);
    return [lerp(r, 0.2, burn * 0.8), lerp(gg, 0.18, burn * 0.8), lerp(b, 0.15, burn * 0.8)];
  });
  g.add(namedMesh('hull', hull, woodMat));

  // --- keel
  const keel = new THREE.BoxGeometry(LEN * 0.62, 10, 8, 12, 1, 1);
  paint(keel, () => [0.5, 0.45, 0.36]);
  place(keel, [X0 + LEN * 0.31, KEEL_Y - 2, 0]);
  g.add(namedMesh('keel', keel, sparMat));

  // --- deck (planked, jagged forward break)
  const DECK_T0 = 0.04;
  const DECK_T1 = 0.74;
  const deck = grid(
    36,
    12,
    (u, v) => {
      const t = DECK_T0 + u * (DECK_T1 - DECK_T0);
      const w = (halfBeam(t) - 5) * (v * 2 - 1);
      return [X0 + t * LEN, railY(t) - 16 + 1.5 * (fbm3(seed ^ 0x37, t * 12, v * 6, 0, 2) - 0.5), w];
    },
    {
      skip: (u, v) =>
        u > 0.82 + 0.15 * (fbm3(seed ^ 0x38, v * 9, 0, 0, 2) - 0.5) || // collapsed fore-deck edge
        (u < 0.1 && Math.abs(v - 0.5) < 0.2), // ragged opening at the stern break
      flip: true,
    },
  );
  paint(deck, (p) => {
    const seam = Math.pow(ridge(((p.z + 200) / 13) % 1), 6);
    const k = (0.62 + 0.4 * fbm3(seed ^ 0x39, p.x * 0.07, 0, p.z * 0.3, 3)) * (1 - 0.5 * seam);
    return [k, k * 0.9, k * 0.74];
  });
  g.add(namedMesh('deck', deck, woodMat));

  // --- masts + bowsprit + crow's nest
  const mastPaint = (p) => {
    const k = 0.75 + 0.3 * (fbm3(seed ^ 0x3a, p.x * 0.1, p.y * 0.06, p.z * 0.1, 3) - 0.5);
    return [k, k * 0.9, k * 0.78];
  };
  const mkBrokenMast = (name, tPos, h, rTop, rBot, lean, leanDir) => {
    const geos = [];
    const trunk = new THREE.CylinderGeometry(rTop, rBot, h, 14, 4, true);
    // jagged splintered top: pull top ring vertices up unevenly
    const pos = trunk.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      if (pos.getY(i) > h / 2 - 0.1) {
        pos.setY(i, h / 2 + 26 * hash01(i * 51 ^ (seed & 0xffff)) - 12);
      }
    }
    trunk.computeVertexNormals();
    geos.push(trunk);
    for (let k = 0; k < 5; k++) {
      const sp = flat(new THREE.ConeGeometry(2.6, 22 + 12 * rng(), 5));
      place(sp, [(rng() - 0.5) * 9, h / 2 + 4, (rng() - 0.5) * 9], [(rng() - 0.5) * 0.6, 0, (rng() - 0.5) * 0.6]);
      geos.push(sp);
    }
    const m = merged(geos);
    paint(m, mastPaint);
    const [x, y] = [X0 + tPos * LEN, railY(tPos) - 18];
    place(m, [x, y + (h / 2) * Math.cos(lean), (h / 2) * Math.sin(lean) * leanDir], [lean * leanDir, 0, lean * 0.3]);
    g.add(namedMesh(name, m, sparMat));
    return [x, y];
  };
  mkBrokenMast('mast-main', 0.3, 140, 6.5, 9, 16 * DEG, 1);
  mkBrokenMast('mast-stub', 0.58, 52, 6, 8, 10 * DEG, -1);

  // exposed frame ribs at the broken stern (wreck character, seen through the break)
  const ribGeos = [];
  for (const tR of [0.06, 0.125]) {
    const arc = new THREE.TorusGeometry(10, 1.7, 8, 36, Math.PI);
    // scale the half-torus to the inner hull section at tR; rotz PI flips the
    // dome into a U opening upward, then rotY 90deg puts it across the hull.
    const hb = halfBeam(tR) - 11;
    const hh = (railY(tR) - keelY(tR)) * 0.78;
    place(arc, [0, 0, 0], [0, 0, Math.PI], [hb / 10, hh / 10, 1]);
    place(arc, [X0 + tR * LEN + 14, railY(tR) - 10, 0], [0, Math.PI / 2, 0]);
    ribGeos.push(arc);
  }
  const ribs = merged(ribGeos);
  paint(ribs, (p) => {
    const k = 0.5 + 0.3 * fbm3(seed ^ 0x3b, p.x * 0.1, p.y * 0.1, p.z * 0.1, 3);
    return [k * 0.6, k * 0.52, k * 0.42];
  });
  g.add(namedMesh('frame-ribs', ribs, sparMat));

  // crow's nest ring lying on the deck (fallen)
  const nest = merged([
    place(new THREE.TorusGeometry(14, 2.4, 8, 20), [0, 0, 0], [Math.PI / 2, 0, 0]),
    place(new THREE.CylinderGeometry(14, 14, 3, 20, 1, true), [0, -2, 0]),
  ]);
  paint(nest, mastPaint);
  place(nest, [X0 + 0.46 * LEN, railY(0.46) - 12, 24], [0.2, 0.4, 0.12]);
  g.add(namedMesh('crows-nest', nest, sparMat));

  // bowsprit (rooted into the bow tip)
  const bow = new THREE.CylinderGeometry(3, 4.8, 70, 10);
  paint(bow, mastPaint);
  place(bow, [X0 + LEN + 12, railY(0.97) - 2, 0], [0, 0, -64 * DEG]);
  g.add(namedMesh('bowsprit', bow, sparMat));

  // --- railing posts along both rails
  const railGeos = [];
  for (let i = 0; i < 11; i++) {
    const t = 0.07 + (i / 10) * (DECK_T1 - 0.1);
    for (const sgn of [-1, 1]) {
      if (hash01(i * 17 + sgn * 5 + (seed & 0xfff)) < 0.22) continue; // missing posts
      const post = new THREE.BoxGeometry(3.4, 14, 3.4);
      place(post, [X0 + t * LEN, railY(t) - 6, sgn * (halfBeam(t) - 3)], [(rng() - 0.5) * 0.2, 0, (rng() - 0.5) * 0.2]);
      railGeos.push(post);
    }
  }
  const rails = merged(railGeos);
  paint(rails, mastPaint);
  g.add(namedMesh('railing', rails, sparMat));

  g.rotation.x = LIST; // list toward the viewer: deck + breach visible
  return g;
}

// ----------------------------------------------------------------- 3. skull
function buildSkull(rng, seed) {
  const g = new THREE.Group();
  const RX = 80;
  const RY = 76;
  const RZ = 90;
  const CY = 92;
  const boneMat = physical('skull-bone', {
    color: 0xd9cdb0,
    roughness: 0.6,
    sheen: 0.4,
    sheenColor: new THREE.Color(0xfff6e0),
    sheenRoughness: 0.6,
    vertexColors: true,
  });
  const teethMat = physical('skull-teeth', { color: 0xe8dfc6, roughness: 0.42 });

  const gauss = (v, c, s) => Math.exp(-((v - c) ** 2) / (2 * s * s));
  // cavity accumulator for dirt-in-recess painting (parallel array by vertex idx)
  const cavities = [];
  const cranium = sculptedSphere(88, 64, (d, i) => {
    let r = 1;
    let cav = 0;
    const front = smoothstep(0.35, 0.75, d.z);
    // brow shelf above the sockets
    const brow = gauss(d.y, 0.3, 0.09) * gauss(d.x, 0, 0.42) * front;
    r += 0.12 * brow;
    // eye sockets: deep elliptical wells (wider than tall)
    for (const sx of [-1, 1]) {
      const k = gauss(d.x, sx * 0.4, 0.15) * gauss(d.y, 0.08, 0.105) * front;
      r -= 0.38 * k;
      cav = Math.max(cav, k * 1.6);
    }
    // nasal cavity: inverted triangle (widens downward)
    const nasalW = 0.045 + 0.075 * smoothstep(0.05, -0.28, d.y);
    const nasal = gauss(d.x, 0, nasalW) * gauss(d.y, -0.16, 0.13) * front;
    r -= 0.24 * nasal;
    cav = Math.max(cav, nasal * 1.5);
    // cheekbones out, cheek hollows below them
    for (const sx of [-1, 1]) {
      r += 0.1 * gdir(d, sx * 0.58, -0.1, 0.74, 0.17);
      r -= 0.08 * gdir(d, sx * 0.6, -0.44, 0.62, 0.16);
    }
    // temple flattening
    for (const sx of [-1, 1]) r -= 0.09 * gdir(d, sx * 0.9, 0.2, 0.18, 0.36);
    // maxilla muzzle below the nasal opening
    r += 0.13 * gdir(d, 0, -0.62, 0.78, 0.3);
    // back-of-head fullness
    r += 0.05 * gdir(d, 0, 0.25, -1, 0.55);
    // overall bone-surface noise
    r += 0.015 * (fbm3(seed ^ 0x41, d.x * 4, d.y * 4, d.z * 4, 4) - 0.5);
    cavities[i] = cav;
    const p = new THREE.Vector3(d.x * RX * r, d.y * RY * r, d.z * RZ * r);
    // flatten the facial plane below the forehead so it isn't egg-round
    const faceGate = smoothstep(0.45, 0.1, d.y) * smoothstep(-0.75, -0.3, d.y);
    if (p.z > 56) p.z = lerp(p.z, 56 + (p.z - 56) * 0.45, faceGate);
    // narrow the lower skull (no mandible)
    p.x *= lerp(1, 0.78, smoothstep(-0.15, -0.85, d.y));
    p.y += CY;
    // soft-flatten the base so it sits
    if (p.y < 32) p.y = 32 - (32 - p.y) * 0.22;
    return p;
  });
  paint(cranium, (p, n, i) => {
    const grime = fbm3(seed ^ 0x42, p.x * 0.05, p.y * 0.05, p.z * 0.05, 3);
    const hole = clamp01(cavities[i]);
    let k = 0.9 + 0.32 * (grime - 0.5);
    // ambient-dirt where the surface faces down (under brow, under cheekbones)
    k *= 1 - 0.25 * smoothstep(0.1, -0.6, n.y);
    const c = [k, k * 0.94, k * 0.84];
    // cavities go near-black (deep socket shadow)
    const dark = smoothstep(0.12, 0.5, hole);
    return [lerp(c[0], 0.03, dark), lerp(c[1], 0.03, dark), lerp(c[2], 0.035, dark)];
  });
  g.add(namedMesh('cranium', cranium, boneMat));

  // --- upper dental arch: gum ridge + arc of rounded teeth under the maxilla
  const gum = new THREE.TorusGeometry(34, 7.5, 10, 28, Math.PI * 0.8);
  place(gum, [0, 0, 0], [Math.PI / 2, 0, Math.PI / 2 + Math.PI * 0.1]);
  paint(gum, () => [0.85, 0.8, 0.7]);
  place(gum, [0, 38, 36], [0, 0, 0], [1.05, 0.9, 0.95]);
  g.add(namedMesh('dental-arch', gum, boneMat));
  const teethGeos = [];
  const N_TEETH = 12;
  for (let i = 0; i < N_TEETH; i++) {
    const a = lerp(-66, 66, i / (N_TEETH - 1)) * DEG;
    const x = 37 * Math.sin(a) * 1.05;
    const z = 36 + 35 * Math.cos(a) * 0.95;
    const tooth = new THREE.SphereGeometry(5.8, 12, 10);
    place(tooth, [x, 33, z], [0, 0, (rng() - 0.5) * 0.15], [0.6, 1.15, 0.52]);
    teethGeos.push(tooth);
  }
  g.add(namedMesh('teeth', merged(teethGeos), teethMat));

  return g;
}

// ----------------------------------------------------------- 4. diver helmet
function buildDiverHelmet(rng, seed) {
  const g = new THREE.Group();
  const BON_R = 58;
  const BON_Y = 114;
  const brass = physical('helmet-brass', {
    color: 0xc09a48,
    metalness: 0.85,
    roughness: 0.38,
    clearcoat: 0.5,
    clearcoatRoughness: 0.25,
    vertexColors: true,
  });
  const glassMat = physical('porthole-glass', {
    color: 0xd9efe2,
    metalness: 0,
    roughness: 0.05,
    transmission: 0.9,
    ior: 1.5,
    thickness: 3,
    attenuationColor: new THREE.Color(0xbfe8cf),
    attenuationDistance: 60,
    side: THREE.DoubleSide,
  });

  const patina = (p, n) => {
    const crev = fbm3(seed ^ 0x51, p.x * 0.045, p.y * 0.045, p.z * 0.045, 4);
    const low = smoothstep(92, 64, p.y) * 0.6;
    const k = clamp01(0.45 + 0.55 * crev);
    const green = clamp01(smoothstep(0.5, 0.72, crev) * 1.1 + low) * 0.85;
    return [lerp(k, 0.22, green), lerp(k, 0.5, green), lerp(k * 0.95, 0.42, green)];
  };

  // porthole directions on the bonnet (front + two sides, slightly forward)
  const PORTS = [
    { dir: new THREE.Vector3(0, -0.04, 1), grille: true },
    { dir: new THREE.Vector3(0.95, -0.04, 0.32), grille: false },
    { dir: new THREE.Vector3(-0.95, -0.04, 0.32), grille: false },
  ].map((p) => ({ ...p, dir: p.dir.normalize() }));
  const PORT_SIGMA = 0.4;

  // --- bonnet sphere with recessed (dark) porthole cavities
  const cavity = [];
  const bonnet = sculptedSphere(64, 44, (d, i) => {
    let r = BON_R;
    let cav = 0;
    for (const port of PORTS) {
      const k = smoothstep(0.55, 0.95, gdir(d, port.dir.x, port.dir.y, port.dir.z, PORT_SIGMA));
      r -= 10 * k;
      cav = Math.max(cav, k);
    }
    cavity[i] = cav;
    return new THREE.Vector3(d.x * r, d.y * r * 1.02 + BON_Y, d.z * r);
  });
  paint(bonnet, (p, n, i) => {
    const base = patina(p, n);
    const dark = smoothstep(0.45, 0.95, cavity[i]);
    return [lerp(base[0], 0.05, dark), lerp(base[1], 0.06, dark), lerp(base[2], 0.06, dark)];
  });
  g.add(namedMesh('bonnet', bonnet, brass));

  // --- corselet (lathe) + flange bolts
  const profile = [
    [72, 0],
    [70, 4],
    [62, 8],
    [52, 20],
    [45, 38],
    [42, 54],
    [44, 62],
    [46, 66],
    [46, 72],
    [40, 72],
    [39, 64],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const corselet = new THREE.LatheGeometry(profile, 48);
  paint(corselet, patina);
  const corsMesh = namedMesh('corselet', corselet, brass);
  corsMesh.material.side = THREE.DoubleSide;
  g.add(corsMesh);

  const fittings = [];
  // flange bolts
  const N_BOLT = 14;
  for (let i = 0; i < N_BOLT; i++) {
    const a = (i / N_BOLT) * Math.PI * 2;
    fittings.push(place(new THREE.SphereGeometry(4.2, 12, 10), [60 * Math.sin(a), 7.5, 60 * Math.cos(a)]));
  }
  // neck ring where bonnet meets corselet
  fittings.push(place(new THREE.TorusGeometry(43.5, 4.6, 12, 36), [0, 70, 0], [Math.PI / 2, 0, 0]));
  // porthole rims (+ grille bars on the front port) + recessed glass
  const glassGeos = [];
  for (const port of PORTS) {
    const d = port.dir;
    const rimCenter = d.clone().multiplyScalar(Math.sqrt(BON_R * BON_R - 21 * 21));
    rimCenter.y += BON_Y;
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), d);
    const e = new THREE.Euler().setFromQuaternion(q);
    const rim = new THREE.TorusGeometry(21, 4, 12, 32);
    place(rim, [rimCenter.x, rimCenter.y, rimCenter.z], [e.x, e.y, e.z]);
    fittings.push(rim);
    const glass = new THREE.CircleGeometry(19.5, 32);
    const gc = d.clone().multiplyScalar(Math.sqrt(BON_R * BON_R - 21 * 21) - 3);
    place(glass, [gc.x, gc.y + BON_Y, gc.z], [e.x, e.y, e.z]);
    glassGeos.push(glass);
    if (port.grille) {
      for (const dy of [-10, 0, 10]) {
        const bar = new THREE.CylinderGeometry(1.3, 1.3, 38, 8);
        const bc = d.clone().multiplyScalar(56);
        place(bar, [bc.x, bc.y + BON_Y + dy, bc.z], [0, 0, Math.PI / 2]);
        fittings.push(bar);
      }
    }
  }
  // top valve
  fittings.push(place(new THREE.CylinderGeometry(6.5, 7.5, 9, 16), [0, BON_Y + BON_R * 1.02 + 2, 0]));
  fittings.push(place(new THREE.SphereGeometry(4.6, 14, 12), [0, BON_Y + BON_R * 1.02 + 8.5, 0]));
  // two small lifting lugs on the corselet front/back
  for (const sz of [-1, 1]) {
    fittings.push(place(new THREE.TorusGeometry(5, 1.8, 8, 16), [0, 30, sz * 50], [0, 0, 0]));
  }
  const fitMerged = merged(fittings);
  paint(fitMerged, patina);
  g.add(namedMesh('brass-fittings', fitMerged, brass));
  g.add(namedMesh('porthole-glass', merged(glassGeos), glassMat));

  return g;
}

// ----------------------------------------------------------------- 5. anchor
function buildAnchor(rng, seed) {
  const g = new THREE.Group();
  const iron = physical('anchor-iron', {
    color: 0xffffff,
    metalness: 0.4,
    roughness: 0.85,
    vertexColors: true,
  });
  const geos = [];

  // shank (reaches down into the crown)
  geos.push(place(new THREE.CylinderGeometry(7.5, 9.5, 186, 14, 4), [0, 123, 0]));
  // crown + curved arms: torus arc opening upward
  const arms = new THREE.TorusGeometry(60, 9, 14, 48, 152 * DEG);
  place(arms, [0, 0, 0], [0, 0, (270 - 76) * DEG]); // center the arc at the bottom
  place(arms, [0, 84, 0]);
  geos.push(arms);
  // flukes: flattened cones at the arm tips, pointing up-out
  for (const sx of [-1, 1]) {
    const tipA = (76 * DEG) * 1;
    const tx = sx * 60 * Math.sin(tipA);
    const ty = 84 - 60 * Math.cos(tipA);
    const fluke = flat(new THREE.ConeGeometry(15, 34, 8, 3));
    place(fluke, [0, 13, 0]); // pivot at base
    place(fluke, [tx, ty, 0], [0, 0, sx * -38 * DEG], [1, 1, 0.28]);
    geos.push(fluke);
  }
  // stock: perpendicular bar with ball ends
  geos.push(place(new THREE.CylinderGeometry(6.5, 6.5, 58, 12), [0, 196, 0], [Math.PI / 2, 0, 0]));
  for (const sz of [-1, 1]) geos.push(place(new THREE.SphereGeometry(8.5, 14, 12), [0, 196, sz * 29]));
  // ring
  geos.push(place(new THREE.TorusGeometry(15, 4, 12, 28), [0, 230, 0], [0, Math.PI / 2, 0]));

  const body = merged(geos);
  paint(body, (p) => {
    const rust = smoothstep(0.48, 0.7, fbm3(seed ^ 0x61, p.x * 0.08, p.y * 0.08, p.z * 0.08, 4));
    const pit = fbm3(seed ^ 0x62, p.x * 0.25, p.y * 0.25, p.z * 0.25, 2);
    const base = 0.04 + 0.06 * pit;
    return [lerp(base, 0.45 + 0.16 * pit, rust), lerp(base, 0.16, rust), lerp(base, 0.05, rust)];
  });
  const mesh = namedMesh('anchor-body', body, iron);
  g.add(mesh);
  g.rotation.x = -9 * DEG; // lean back slightly
  return g;
}

// ----------------------------------------------------------- 6. greek column
function buildGreekColumn(rng, seed) {
  const g = new THREE.Group();
  const marble = physical('column-marble', {
    color: 0xc4b89e,
    roughness: 0.65,
    vertexColors: true,
    side: THREE.DoubleSide,
  });

  const N_FLUTE = 20;
  const veinPaint = (p) => {
    // veins live only on the narrow loci where the fBm crosses its midline;
    // band must stay wide enough for ~5mm vertex spacing to sample it
    const vein = smoothstep(0.86, 0.98, ridge(fbm3(seed ^ 0x71, p.x * 0.02, p.y * 0.02, p.z * 0.02, 3)));
    const dust = fbm3(seed ^ 0x72, p.x * 0.05, p.y * 0.05, p.z * 0.05, 3);
    let k = 0.86 + 0.36 * (dust - 0.5);
    // shadow inside the flute grooves (cheap AO)
    const theta = Math.atan2(p.x, p.z);
    k *= 1 - 0.22 * Math.pow(0.5 + 0.5 * Math.cos(N_FLUTE * theta), 1.5);
    const v = vein * 0.55;
    const ground = smoothstep(48, 0, p.y) * 0.3; // dirt at the base
    return [
      k * (1 - v * 0.5) - ground,
      k * (1 - v * 0.42) - ground,
      k * (1 - v * 0.22) - ground * 0.6,
    ];
  };

  const fluteR = (R, theta) => R * (1 - 0.075 * Math.pow(0.5 + 0.5 * Math.cos(N_FLUTE * theta), 1.3));

  // --- standing broken shaft
  const R0 = 38;
  const H_TOP = 224;
  const topJag = (theta) => H_TOP - 26 * Math.pow(ridge(fbm3(seed ^ 0x73, Math.cos(theta) * 1.6 + 5, Math.sin(theta) * 1.6 + 5, 0, 3)), 1.3) - 6;
  const shaftGeos = [];
  shaftGeos.push(
    grid(44, 96, (u, v) => {
      const theta = v * Math.PI * 2;
      const yTop = topJag(theta);
      const y = 30 + u * (yTop - 30);
      const r = fluteR(R0 - 4 * (y / H_TOP), theta) * (1 + 0.012 * (fbm3(seed ^ 0x74, Math.cos(theta) * 3, y * 0.05, Math.sin(theta) * 3, 2) - 0.5));
      return [r * Math.sin(theta), y, r * Math.cos(theta)];
    }),
  );
  // rough break cap (fan to a low rubble-like center)
  shaftGeos.push(
    grid(5, 96, (u, v) => {
      const theta = v * Math.PI * 2;
      const rr = fluteR(R0 - 4 * (topJag(theta) / H_TOP), theta) * (1 - u);
      const y =
        lerp(topJag(theta), H_TOP - 22, u) +
        4 * u * (1 - u) +
        3 * u * (fbm3(seed ^ 0x75, Math.cos(theta) * 5, u * 6, Math.sin(theta) * 5, 3) - 0.5);
      return [rr * Math.sin(theta), y, rr * Math.cos(theta)];
    }),
  );
  const shaft = merged(shaftGeos);
  paint(shaft, veinPaint);
  const shaftMesh = namedMesh('shaft', shaft, marble);
  shaftMesh.position.x = -42;
  g.add(shaftMesh);

  // --- plinth (two steps + torus base molding)
  const plinthGeos = [];
  plinthGeos.push(place(new THREE.BoxGeometry(102, 16, 102), [0, 8, 0]));
  plinthGeos.push(place(new THREE.BoxGeometry(86, 12, 86), [0, 28 - 6, 0]));
  plinthGeos.push(place(new THREE.TorusGeometry(38, 7, 12, 48), [0, 31, 0], [Math.PI / 2, 0, 0]));
  const plinth = merged(plinthGeos);
  paint(plinth, veinPaint);
  const plinthMesh = namedMesh('plinth', plinth, marble);
  plinthMesh.position.x = -42;
  g.add(plinthMesh);

  // --- fallen drum segment lying beside the column
  const DR = 33;
  const DL = 64;
  const drumGeos = [];
  drumGeos.push(
    grid(16, 80, (u, v) => {
      const theta = v * Math.PI * 2;
      const r = fluteR(DR, theta);
      return [r * Math.sin(theta), lerp(-DL / 2, DL / 2, u) + 3 * (fbm3(seed ^ 0x76, Math.cos(theta) * 3, u * 4, Math.sin(theta) * 3, 2) - 0.5) * (u < 0.1 || u > 0.9 ? 1 : 0), r * Math.cos(theta)];
    }),
  );
  for (const se of [-1, 1]) {
    drumGeos.push(
      grid(3, 80, (u, v) => {
        const theta = v * Math.PI * 2;
        const r = fluteR(DR, theta) * (1 - u);
        const y = se * (DL / 2 + 4 * u * (1 - u) + 2.5 * u * fbm3(seed ^ (0x77 + se), Math.cos(theta) * 4, u * 3, Math.sin(theta) * 4, 2));
        return [r * Math.sin(theta), y, r * Math.cos(theta)];
      }),
    );
  }
  const drum = merged(drumGeos);
  paint(drum, veinPaint);
  // lathe axis was Y; lay it on its side along X with a random roll
  place(drum, [0, 0, 0], [0, 0.35, Math.PI / 2]);
  place(drum, [58, fluteR(DR, 0.4) - 1.5, 18], [0, 0, 0]);
  g.add(namedMesh('fallen-drum', drum, marble));

  return g;
}

// ------------------------------------------------------------------- 7. moai
function buildMoai(rng, seed) {
  const g = new THREE.Group();
  const basalt = physical('moai-basalt', {
    color: 0x57595c,
    roughness: 0.9,
    vertexColors: true,
  });
  const RX = 58;
  const RY = 116;
  const RZ = 52;
  const CY = 116;

  const gauss = (v, c, s) => Math.exp(-((v - c) ** 2) / (2 * s * s));
  const hollows = [];
  const head = sculptedSphere(80, 64, (d, i) => {
    let r = 1;
    const front = smoothstep(0.25, 0.65, d.z);
    // blocky cross-section: push the diagonals out (superellipse-ish)
    const c = Math.abs(d.z);
    const s = Math.abs(d.x);
    const horiz = Math.hypot(d.x, d.z);
    if (horiz > 0.01) {
      const cn = c / horiz;
      const sn = s / horiz;
      const sq = Math.pow(Math.pow(cn, 3.2) + Math.pow(sn, 3.2), -1 / 3.2);
      r *= lerp(1, sq, horiz * horiz);
    }
    // heavy straight brow shelf
    const brow = gauss(d.y, 0.42, 0.055) * gauss(d.x, 0, 0.5) * front;
    r += 0.13 * brow;
    // eye hollows directly under the brow
    let hol = 0;
    for (const sx of [-1, 1]) {
      const k = gauss(d.x, sx * 0.3, 0.13) * gauss(d.y, 0.3, 0.07) * front;
      r -= 0.13 * k;
      hol = Math.max(hol, k);
    }
    hollows[i] = hol;
    // long flat nose: ridge widening + rising toward the tip
    const noseProfile = smoothstep(0.48, 0.3, d.y) * smoothstep(-0.32, -0.1, d.y);
    const noseBand = gauss(d.x, 0, 0.1 + 0.04 * smoothstep(0.3, -0.15, d.y)) * front;
    r += 0.28 * noseBand * noseProfile * (1 + 0.7 * smoothstep(0.15, -0.12, d.y));
    // sharp creases flanking the nose
    for (const sx of [-1, 1]) r -= 0.05 * (gauss(d.x, sx * 0.2, 0.07) * gauss(d.y, 0, 0.18) * front);
    // nostril flares at the nose base
    for (const sx of [-1, 1]) r += 0.06 * gdir(d, sx * 0.15, -0.2, 0.97, 0.08);
    // philtrum recess between nose and mouth
    r -= 0.05 * (gauss(d.x, 0, 0.12) * gauss(d.y, -0.36, 0.06) * front);
    // thin pursed lips: two long narrow ridges
    r += 0.075 * gauss(d.y, -0.47, 0.035) * gauss(d.x, 0, 0.2) * front;
    r += 0.055 * gauss(d.y, -0.56, 0.03) * gauss(d.x, 0, 0.17) * front;
    // strong chin
    r += 0.08 * gdir(d, 0, -0.8, 0.55, 0.2);
    // flatten the back of the head
    r -= 0.1 * gdir(d, 0, 0.15, -1, 0.55);
    // surface pitting
    r += 0.016 * (fbm3(seed ^ 0x81, d.x * 6, d.y * 6, d.z * 6, 4) - 0.5);
    const p = new THREE.Vector3(d.x * RX * r, d.y * RY * r, d.z * RZ * r);
    // jaw narrows slightly
    p.x *= lerp(1, 0.86, smoothstep(-0.25, -0.95, d.y));
    p.y += CY;
    if (p.y < 14) p.y = 14 - (14 - p.y) * 0.18; // soft flat base
    const crown = CY + RY * 0.84;
    if (p.y > crown) p.y = crown + (p.y - crown) * 0.55; // flatten the crown
    return p;
  });
  const moaiPaint = (p, n, hol) => {
    const pit = smoothstep(0.62, 0.82, fbm3(seed ^ 0x82, p.x * 0.13, p.y * 0.13, p.z * 0.13, 4));
    const algae =
      smoothstep(0.25, 0.7, n.y) *
      smoothstep(0.42, 0.66, fbm3(seed ^ 0x83, p.x * 0.05, p.y * 0.05, p.z * 0.05, 3));
    let k = 0.85 + 0.4 * (fbm3(seed ^ 0x84, p.x * 0.03, p.y * 0.03, p.z * 0.03, 3) - 0.5) - 0.3 * pit;
    // shadow under the brow + under the nose ridge (carved-shadow read)
    k *= 1 - 0.35 * smoothstep(0.0, -0.7, n.y) * smoothstep(0.2, 0.6, p.z / RZ);
    // darken inside the eye hollows
    k *= 1 - 0.55 * smoothstep(0.2, 0.8, hol);
    return [k * (1 - 0.42 * algae), k * (1 + 0.16 * algae), k * (1 - 0.45 * algae)];
  };
  paint(head, (p, n, i) => moaiPaint(p, n, hollows[i] || 0));
  g.add(namedMesh('moai-head', head, basalt));

  // slab ears
  const earGeos = [];
  for (const sx of [-1, 1]) {
    const ear = new THREE.BoxGeometry(8, 64, 20, 1, 4, 2);
    place(ear, [sx * (RX - 2), CY + 2, -8], [0, 0, sx * 0.06]);
    earGeos.push(ear);
  }
  const ears = merged(earGeos);
  paint(ears, (p, n) => moaiPaint(p, n, 0));
  g.add(namedMesh('moai-ears', ears, basalt));

  g.rotation.x = -7 * DEG; // characteristic slight backward tilt
  return g;
}

// ----------------------------------------------------------------- 8. castle
function buildCastle(rng, seed) {
  const g = new THREE.Group();
  const stone = physical('castle-stone', {
    color: 0x847d70,
    roughness: 0.85,
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  const roofMat = physical('castle-roof', { color: 0x7c413a, roughness: 0.7, vertexColors: true });
  const darkMat = physical('castle-dark', { color: 0x101013, roughness: 0.95 });

  const blockPaint = (radius) => (p) => {
    const theta = Math.atan2(p.x, p.z);
    const row = Math.floor(p.y / 16);
    const col = Math.floor((theta * radius) / 24 + (row % 2) * 0.5);
    const tone = 0.72 + 0.4 * hash01((Math.imul(row, 73) ^ Math.imul(col, 131) ^ seed) >>> 0);
    const mortarY = Math.pow(ridge((p.y / 16) % 1), 6);
    const mortarC = Math.pow(ridge(((theta * radius) / 24 + (row % 2) * 0.5 + 1000) % 1), 6);
    const k = tone * (1 - 0.45 * Math.max(mortarY, mortarC)) * (0.88 + 0.24 * fbm3(seed ^ 0x91, p.x * 0.06, p.y * 0.06, p.z * 0.06, 3));
    return [k, k * 0.985, k * 0.95];
  };

  // --- main tower: cylindrical wall with arched door tunnels front + back
  const MAIN = { x: -25, z: 15, r: 62, h: 250 };
  const DOOR_HALF = 29 * DEG;
  const DOOR_TOP = 68;
  const ARCH = 26;
  const inDoor = (theta, y) => {
    // gaps centered at theta=0 (front, +Z) and theta=PI (back)
    let dt = Math.atan2(Math.sin(theta), Math.cos(theta)); // [-PI, PI], front gap
    let dtBack = Math.atan2(Math.sin(theta - Math.PI), Math.cos(theta - Math.PI));
    const half = (yy) =>
      yy < DOOR_TOP - ARCH ? DOOR_HALF : yy > DOOR_TOP ? -1 : DOOR_HALF * Math.sqrt(Math.max(0, 1 - ((yy - (DOOR_TOP - ARCH)) / ARCH) ** 2));
    const h = half(y);
    return h > 0 && (Math.abs(dt) < h || Math.abs(dtBack) < h);
  };
  const mainWall = grid(
    44,
    96,
    (u, v) => {
      const theta = v * Math.PI * 2;
      const y = u * MAIN.h;
      const r = MAIN.r * (1 + 0.012 * (fbm3(seed ^ 0x92, Math.cos(theta) * 4, y * 0.04, Math.sin(theta) * 4, 3) - 0.5));
      return [MAIN.x + r * Math.sin(theta), y, MAIN.z + r * Math.cos(theta)];
    },
    { skip: (u, v) => inDoor(v * Math.PI * 2, u * MAIN.h) },
  );
  {
    const pos = mainWall.getAttribute('position');
    const tmp = new THREE.Vector3();
    const recolor = blockPaint(MAIN.r);
    paint(mainWall, (p) => recolor(tmp.set(p.x - MAIN.x, p.y, p.z - MAIN.z)));
  }
  g.add(namedMesh('tower-main', mainWall, stone));

  // arched stone surround over the front door
  const doorArch = new THREE.TorusGeometry(MAIN.r * Math.sin(DOOR_HALF) + 4, 6, 10, 24, Math.PI);
  paint(doorArch, (p) => {
    const k = 0.7 + 0.3 * hash01(Math.floor((Math.atan2(p.y, p.x) / Math.PI) * 7) * 97 + (seed & 0xff));
    return [k, k * 0.97, k * 0.92];
  });
  place(doorArch, [MAIN.x, DOOR_TOP - ARCH, MAIN.z + MAIN.r * Math.cos(DOOR_HALF) + 1], [0, 0, 0], [1, 1.15, 1]);
  g.add(namedMesh('door-arch', doorArch, stone));

  // tower top floor
  const topCap = new THREE.CircleGeometry(MAIN.r - 1, 48);
  paint(topCap, () => [0.55, 0.55, 0.53]);
  place(topCap, [MAIN.x, MAIN.h - 2, MAIN.z], [-Math.PI / 2, 0, 0]);
  g.add(namedMesh('tower-floor', topCap, stone));

  // --- battlements: parapet ring + alternating merlons
  const batGeos = [];
  const ring = new THREE.CylinderGeometry(MAIN.r + 3, MAIN.r + 3, 10, 48, 1, true);
  place(ring, [MAIN.x, MAIN.h + 3, MAIN.z]);
  batGeos.push(ring);
  const N_MERLON = 10;
  for (let i = 0; i < N_MERLON; i++) {
    const a = (i / N_MERLON) * Math.PI * 2;
    const m = new THREE.BoxGeometry(26, 22, 11);
    place(m, [MAIN.x + (MAIN.r - 1) * Math.sin(a), MAIN.h + 17, MAIN.z + (MAIN.r - 1) * Math.cos(a)], [0, a, 0]);
    batGeos.push(m);
  }
  const bats = merged(batGeos);
  {
    const recolor = blockPaint(MAIN.r);
    const tmp = new THREE.Vector3();
    paint(bats, (p) => recolor(tmp.set(p.x - MAIN.x, p.y, p.z - MAIN.z)));
  }
  g.add(namedMesh('battlements', bats, stone));

  // --- side tower with conical roof
  const SIDE = { x: 70, z: -45, r: 36, h: 210 };
  const sideWall = grid(36, 64, (u, v) => {
    const theta = v * Math.PI * 2;
    const y = u * SIDE.h;
    const r = SIDE.r * (1 + 0.014 * (fbm3(seed ^ 0x93, Math.cos(theta) * 4, y * 0.04, Math.sin(theta) * 4, 3) - 0.5));
    return [SIDE.x + r * Math.sin(theta), y, SIDE.z + r * Math.cos(theta)];
  });
  {
    const recolor = blockPaint(SIDE.r);
    const tmp = new THREE.Vector3();
    paint(sideWall, (p) => recolor(tmp.set(p.x - SIDE.x, p.y, p.z - SIDE.z)));
  }
  g.add(namedMesh('tower-side', sideWall, stone));

  const roof = new THREE.ConeGeometry(SIDE.r + 8, 88, 24, 4, false);
  paint(roof, (p) => {
    const k = 0.85 + 0.3 * (fbm3(seed ^ 0x94, p.x * 0.08, p.y * 0.08, p.z * 0.08, 3) - 0.5);
    return [k, k, k];
  });
  place(roof, [SIDE.x, SIDE.h + 42, SIDE.z]);
  g.add(namedMesh('roof-cone', roof, roofMat));
  // small finial ball
  const finial = new THREE.SphereGeometry(5, 12, 10);
  paint(finial, () => [0.9, 0.9, 0.9]);
  place(finial, [SIDE.x, SIDE.h + 88, SIDE.z]);
  g.add(namedMesh('roof-finial', finial, roofMat));

  // --- dark window slits, embedded just proud of the walls
  const winGeos = [];
  const winsMain = [
    [30 * DEG, 120],
    [-35 * DEG, 165],
    [10 * DEG, 205],
    [160 * DEG, 140],
  ];
  for (const [a, y] of winsMain) {
    const w = new THREE.BoxGeometry(9, 26, 5);
    place(w, [MAIN.x + (MAIN.r - 1.5) * Math.sin(a), y, MAIN.z + (MAIN.r - 1.5) * Math.cos(a)], [0, a, 0]);
    winGeos.push(w);
  }
  for (const [a, y] of [
    [20 * DEG, 100],
    [-15 * DEG, 160],
  ]) {
    const w = new THREE.BoxGeometry(8, 22, 5);
    place(w, [SIDE.x + (SIDE.r - 1.5) * Math.sin(a), y, SIDE.z + (SIDE.r - 1.5) * Math.cos(a)], [0, a, 0]);
    winGeos.push(w);
  }
  g.add(namedMesh('windows', merged(winGeos), darkMat));

  return g;
}

// ---------------------------------------------------------------- 9. amphora
function buildAmphora(rng, seed) {
  const g = new THREE.Group();
  const terra = physical('amphora-terracotta', {
    color: 0x8e5232,
    roughness: 0.82,
    vertexColors: true,
    side: THREE.DoubleSide,
  });

  // Open lathe profile: outer wall up to the lip, back DOWN the inside of the
  // neck, and a cavity floor — the mouth shows a real interior (fish cave).
  const profile = [
    [2, 0],
    [5, 8],
    [8, 18],
    [11, 30],
    [24, 48],
    [40, 66],
    [50, 96],
    [52, 124],
    [47, 146],
    [34, 166],
    [25, 180],
    [23, 196],
    [25, 206],
    [33, 212],
    [34, 218],
    [29, 218],
    [21, 208],
    [18, 192],
    [19, 172],
    [28, 152],
    [36, 132],
    [30, 110],
    [0.5, 100],
  ].map(([r, y]) => new THREE.Vector2(r, y));
  const body = new THREE.LatheGeometry(profile, 56);
  // chipped rim: pull a sector of the lip down/in
  {
    const pos = body.getAttribute('position');
    const chips = [];
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      const z = pos.getZ(i);
      if (y > 204) {
        const a = Math.atan2(x, z);
        const chip = smoothstep(0.5, 0.05, Math.abs(a - 0.9)) * smoothstep(204, 218, y);
        if (chip > 0) {
          pos.setY(i, y - 9 * chip);
          chips[i] = chip;
        }
      }
    }
    body.computeVertexNormals();
    body.userData.chips = chips;
  }
  paint(body, (p, n, i) => {
    const rr = Math.hypot(p.x, p.z);
    const enc = smoothstep(0.44, 0.68, fbm3(seed ^ 0xa1, p.x * 0.045, p.y * 0.045, p.z * 0.045, 4));
    const grime = fbm3(seed ^ 0xa2, p.x * 0.12, p.y * 0.12, p.z * 0.12, 3);
    let k = 0.84 + 0.4 * (grime - 0.5);
    // interior darker (inner wall has small radius high up)
    const inner = rr < 30 && p.y > 100 && p.y < 215 ? 0.7 : 0;
    const chip = (body.userData.chips && body.userData.chips[i]) || 0;
    let c = [
      lerp(k, 0.5, enc * 0.85) - inner * 0.55,
      lerp(k * 0.92, 0.56, enc * 0.85) - inner * 0.58,
      lerp(k * 0.82, 0.46, enc * 0.85) - inner * 0.52,
    ];
    // raw clay at the chip (brighter, less weathered)
    return [lerp(c[0], 1.0, chip), lerp(c[1], 0.9, chip), lerp(c[2], 0.8, chip)];
  });

  // handles: torus arcs from shoulder to neck, sticking out +-X
  const handleGeos = [];
  for (const sx of [-1, 1]) {
    const h = new THREE.TorusGeometry(24, 6.5, 12, 28);
    // strap-like handle: squashed across Z, embedded into the shoulder
    place(h, [sx * 33, 158, 0], [0, 0, 0], [1, 1, 0.6]); // torus XY plane contains the lathe axis
    handleGeos.push(h);
  }
  const handles = merged(handleGeos);
  paint(handles, (p) => {
    const enc = smoothstep(0.44, 0.68, fbm3(seed ^ 0xa3, p.x * 0.05, p.y * 0.05, p.z * 0.05, 4));
    const k = 0.84 + 0.36 * (fbm3(seed ^ 0xa4, p.x * 0.1, p.y * 0.1, p.z * 0.1, 3) - 0.5);
    return [lerp(k, 0.5, enc * 0.85), lerp(k * 0.92, 0.56, enc * 0.85), lerp(k * 0.82, 0.46, enc * 0.85)];
  });

  g.add(namedMesh('amphora-body', body, terra));
  g.add(namedMesh('amphora-handles', handles, terra));

  // lie on its side: lathe +Y -> +Z (mouth toward +Z), slight roll for naturalism
  g.rotation.set(Math.PI / 2, 0, 0.1);
  return g;
}

// ----------------------------------------------------------------- 10. cannon
function buildCannon(rng, seed) {
  const g = new THREE.Group();
  const bronze = physical('cannon-bronze', {
    color: 0x6f5a2e,
    metalness: 1,
    roughness: 0.5,
    vertexColors: true,
  });
  const oak = physical('carriage-oak', { color: 0x4f3a20, roughness: 0.85, vertexColors: true });
  const ironBall = physical('cannonball-iron', {
    color: 0x2b2d30,
    metalness: 0.9,
    roughness: 0.55,
    vertexColors: true,
  });

  const oakPaint = (p) => {
    const grain = fbm3(seed ^ 0xb1, p.x * 0.08, p.y * 0.3, p.z * 0.3, 3);
    const k = 0.82 + 0.3 * (grain - 0.5);
    return [k, k * 0.92, k * 0.8];
  };

  // --- barrel: lathe along Y (breech at 0, muzzle at +Y), then axis -> +X
  const profile = [
    [0.6, 0],
    [5.5, 1.5],
    [8.5, 5],
    [8.5, 9],
    [5.5, 12],
    [6.5, 14],
    [17, 18],
    [18, 24],
    [16.5, 30],
    [12.5, 95],
    [11.5, 130],
    [12, 142],
    [15, 152],
    [15.5, 158],
    [14, 162],
    [7.5, 162],
    [7, 148],
    [0.5, 148],
  ].map(([r, y]) => new THREE.Vector2(r * 1.14, y));
  const barrelGeos = [stripUv(new THREE.LatheGeometry(profile, 40))];
  // reinforcing rings (local radius at y: from the taper segments)
  for (const [ry, rr] of [
    [40, 18.2],
    [75, 16.2],
    [110, 14.4],
  ]) {
    barrelGeos.push(place(new THREE.TorusGeometry(rr + 0.6, 1.7, 10, 32), [0, ry, 0], [Math.PI / 2, 0, 0]));
  }
  const barrel = merged(barrelGeos);
  paint(barrel, (p) => {
    const rr = Math.hypot(p.x, p.z);
    const patina = smoothstep(0.42, 0.68, fbm3(seed ^ 0xb2, p.x * 0.06, p.y * 0.06, p.z * 0.06, 4));
    const streak = smoothstep(0.58, 0.78, fbm3(seed ^ 0xb7, p.x * 0.25, p.y * 0.04, p.z * 0.25, 3));
    const k = 0.55 + 0.5 * fbm3(seed ^ 0xb3, p.x * 0.15, p.y * 0.15, p.z * 0.15, 3);
    // open dark bore at the muzzle
    const bore = rr < 9.2 && p.y > 146 ? 1 : 0;
    let c = [lerp(k, 0.3, patina), lerp(k, 0.46, patina), lerp(k * 0.95, 0.4, patina)];
    c = [lerp(c[0], 0.32, streak * 0.7), lerp(c[1], 0.5, streak * 0.7), lerp(c[2], 0.42, streak * 0.7)];
    return [lerp(c[0], 0.04, bore), lerp(c[1], 0.045, bore), lerp(c[2], 0.05, bore)];
  });
  const ELEV = 7 * DEG;
  place(barrel, [0, 0, 0], [0, 0, -Math.PI / 2 + ELEV]); // axis -> +X, slight elevation
  place(barrel, [-72, 88, 0]);
  // trunnions through the barrel at the balance point
  const trunnion = new THREE.CylinderGeometry(7, 7, 88, 14);
  paint(trunnion, (p) => {
    const k = 0.5 + 0.4 * fbm3(seed ^ 0xb4, p.x * 0.1, p.y * 0.1, p.z * 0.1, 3);
    return [k, k, k * 0.95];
  });
  place(trunnion, [-72 + 64 * Math.cos(ELEV), 88 + 64 * Math.sin(ELEV), 0], [Math.PI / 2, 0, 0]);
  g.add(namedMesh('barrel', merged([barrel, trunnion]), bronze));

  // --- carriage: base + stepped cheeks + transom
  const carGeos = [];
  const mkBox = (w, h, d, x, y, z) => {
    const b = new THREE.BoxGeometry(w, h, d, 4, 1, 1);
    paint(b, oakPaint);
    place(b, [x, y, z]);
    carGeos.push(b);
  };
  mkBox(150, 14, 56, -14, 29, 0); // base platform
  for (const sz of [-1, 1]) {
    // cheeks step DOWN toward the rear; top step carries the trunnion
    mkBox(124, 20, 12, -18, 46, sz * 27);
    mkBox(96, 20, 12, -10, 66, sz * 27);
    mkBox(64, 18, 12, -4, 84, sz * 27);
  }
  mkBox(16, 30, 42, -82, 50, 0); // rear transom
  mkBox(14, 22, 42, 40, 47, 0); // front transom
  g.add(namedMesh('carriage', merged(carGeos), oak));

  // --- wheels (trucks) + axles
  const wheelGeos = [];
  for (const sx of [-1, 1]) {
    const ax = sx > 0 ? 28 : -62;
    const axle = new THREE.CylinderGeometry(5, 5, 84, 10);
    paint(axle, oakPaint);
    place(axle, [ax, 22, 0], [Math.PI / 2, 0, 0]);
    wheelGeos.push(axle);
    for (const sz of [-1, 1]) {
      const w = new THREE.CylinderGeometry(22, 22, 11, 22);
      paint(w, (p) => {
        const k = 0.75 + 0.3 * (fbm3(seed ^ 0xb5, p.x * 0.2, p.y * 0.2, p.z * 0.2, 3) - 0.5);
        return [k, k * 0.9, k * 0.78];
      });
      place(w, [ax, 22, sz * 38], [Math.PI / 2, 0, 0]);
      wheelGeos.push(w);
      const hub = new THREE.CylinderGeometry(6, 6, 15, 12);
      paint(hub, () => [0.4, 0.38, 0.36]);
      place(hub, [ax, 22, sz * 38], [Math.PI / 2, 0, 0]);
      wheelGeos.push(hub);
    }
  }
  g.add(namedMesh('wheels', merged(wheelGeos), oak));

  // --- pyramid of 6 cannonballs beside the carriage
  const BR = 13.5;
  const ballGeos = [];
  const ballPaint = (p) => {
    const k = 0.8 + 0.4 * (fbm3(seed ^ 0xb6, p.x * 0.15, p.y * 0.15, p.z * 0.15, 3) - 0.5);
    return [k, k, k * 1.05];
  };
  const BX = 68; // beside the muzzle, clear of the wheels
  const BZ = 28;
  const base = [
    [BX, BR, BZ],
    [BX + BR * 2.02, BR, BZ],
    [BX + BR, BR, BZ - BR * 1.75],
  ];
  const mid = [
    [BX + BR, BR * 2.6, BZ - BR * 0.58],
    [BX + BR * 0.3, BR * 2.6, BZ - BR * 1.1],
  ];
  const top = [[BX + BR * 0.8, BR * 4.1, BZ - BR * 0.8]];
  for (const [x, y, z] of [...base, ...mid, ...top]) {
    const b = new THREE.SphereGeometry(BR, 20, 16);
    paint(b, ballPaint);
    place(b, [x, y, z]);
    ballGeos.push(b);
  }
  g.add(namedMesh('cannonballs', merged(ballGeos), ironBall));

  return g;
}

// ---------------------------------------------------------------------------
// Model registry — seeds are fixed forever (same discipline as textures).
// ---------------------------------------------------------------------------
const MODELS = [
  { id: 'treasure-chest', dims: [150, 120, 110], seed: 0xdec0d001, build: buildTreasureChest },
  { id: 'sunken-galleon', dims: [400, 250, 140], seed: 0xdec0d002, build: buildSunkenGalleon },
  { id: 'skull', dims: [180, 170, 210], seed: 0xdec0d003, build: buildSkull },
  { id: 'diver-helmet', dims: [140, 170, 140], seed: 0xdec0d004, build: buildDiverHelmet },
  { id: 'anchor', dims: [180, 260, 70], seed: 0xdec0d005, build: buildAnchor },
  { id: 'greek-column', dims: [200, 240, 130], seed: 0xdec0d006, build: buildGreekColumn },
  { id: 'moai', dims: [130, 250, 120], seed: 0xdec0d007, build: buildMoai },
  { id: 'castle', dims: [220, 330, 170], seed: 0xdec0d008, build: buildCastle },
  { id: 'amphora', dims: [130, 110, 230], seed: 0xdec0d009, build: buildAmphora },
  { id: 'cannon', dims: [210, 130, 100], seed: 0xdec0d00a, build: buildCannon },
];

// ---------------------------------------------------------------------------
// Finalize: bake world transforms, exact per-axis fit to dims, bottom-center
// origin. Returns { group, tris, aniso }.
// ---------------------------------------------------------------------------
function finalizeModel(rawGroup, [W, H, D], id) {
  rawGroup.updateMatrixWorld(true);
  const meshes = [];
  rawGroup.traverse((o) => {
    if (o.isMesh) meshes.push(o);
  });

  const flatGroup = new THREE.Group();
  flatGroup.name = id;
  const bb = new THREE.Box3();
  for (const m of meshes) {
    m.geometry.applyMatrix4(m.matrixWorld);
    m.geometry.computeBoundingBox();
    bb.union(m.geometry.boundingBox);
    const baked = new THREE.Mesh(m.geometry, m.material);
    baked.name = m.name;
    flatGroup.add(baked);
  }

  const size = bb.getSize(new THREE.Vector3());
  const sx = W / size.x;
  const sy = H / size.y;
  const sz = D / size.z;
  const cx = (bb.min.x + bb.max.x) / 2;
  const cz = (bb.min.z + bb.max.z) / 2;
  const fit = new THREE.Matrix4()
    .makeScale(sx, sy, sz)
    .multiply(new THREE.Matrix4().makeTranslation(-cx, -bb.min.y, -cz));

  let tris = 0;
  const check = new THREE.Box3();
  for (const m of flatGroup.children) {
    m.geometry.applyMatrix4(fit);
    m.geometry.computeBoundingBox();
    check.union(m.geometry.boundingBox);
    const index = m.geometry.getIndex();
    tris += (index ? index.count : m.geometry.getAttribute('position').count) / 3;
  }

  const TOL = 1; // mm, per the renderer geometry contract
  const errs = [
    Math.abs(check.max.x - check.min.x - W),
    Math.abs(check.max.y - check.min.y - H),
    Math.abs(check.max.z - check.min.z - D),
    Math.abs(check.min.y),
    Math.abs((check.min.x + check.max.x) / 2),
    Math.abs((check.min.z + check.max.z) / 2),
  ];
  if (errs.some((e) => e > TOL)) {
    throw new Error(`${id}: AABB contract violated (errors mm: ${errs.map((e) => e.toFixed(3)).join(', ')})`);
  }
  const scales = [sx, sy, sz];
  const aniso = Math.max(...scales) / Math.min(...scales);
  return { group: flatGroup, tris, aniso, scales };
}

// ---------------------------------------------------------------------------
// Export + verification
// ---------------------------------------------------------------------------
async function exportGlb(group) {
  const exporter = new GLTFExporter();
  const ab = await exporter.parseAsync(group, { binary: true });
  return Buffer.from(ab);
}

function parseGlbJson(buf) {
  if (buf.readUInt32LE(0) !== 0x46546c67) throw new Error('not a GLB (magic mismatch)');
  const jsonLen = buf.readUInt32LE(12);
  return JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
}

async function bakeModel(spec) {
  const rng = splitmix32(spec.seed);
  const raw = spec.build(rng, spec.seed);
  const fin = finalizeModel(raw, spec.dims, spec.id);
  const glb = await exportGlb(fin.group);
  return { ...fin, glb };
}

async function main() {
  const onlyArg = process.argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? new Set(onlyArg.slice(7).split(',')) : null;
  const list = MODELS.filter((m) => !only || only.has(m.id));
  if (list.length === 0) throw new Error(`--only matched nothing (ids: ${MODELS.map((m) => m.id).join(', ')})`);

  await mkdir(OUT_DIR, { recursive: true });
  console.log(`Baking ${list.length} decoration models → ${OUT_DIR}`);

  let totalBytes = 0;
  for (const spec of list) {
    // Determinism: build + export twice from scratch; bytes must be identical.
    const a = await bakeModel(spec);
    const b = await bakeModel(spec);
    if (!a.glb.equals(b.glb)) throw new Error(`${spec.id}: GLB bake is non-deterministic`);

    const json = parseGlbJson(a.glb);
    const ext = json.extensionsUsed || [];
    const file = `${spec.id}.glb`;
    await writeFile(join(OUT_DIR, file), a.glb);
    totalBytes += a.glb.length;

    console.log(
      `  ${file.padEnd(22)} ${(a.glb.length / 1024).toFixed(0).padStart(5)} KB  ${String(Math.round(a.tris)).padStart(6)} tris  ` +
        `fit=(${a.scales.map((s) => s.toFixed(2)).join(',')})${a.aniso > 1.25 ? ' ⚠ aniso' : ''}\n` +
        `      KHR: ${ext.length ? ext.map((e) => e.replace('KHR_materials_', '')).join(', ') : '(none)'}`,
    );
  }
  console.log(`Total: ${(totalBytes / 1024).toFixed(0)} KB (${(totalBytes / 1048576).toFixed(2)} MB)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
