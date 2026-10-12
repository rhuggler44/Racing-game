// 410 non-wing sprint car. Local axes: +Z forward, +Y up, +X = LEFT side.
//
// The body is UV-mapped straight onto a 2048x2048 paint atlas laid out like the
// iRacing paint file (see PAINT_REGIONS). The player's car uses the uploaded
// iRacing scheme as-is; AI cars get a generated atlas with the same layout.
import * as THREE from 'three';

const LEFT = 1, RIGHT = -1;
const ATLAS = 2048;

// Panel regions on the paint file (pixel rects x0,y0,x1,y1).
export const PAINT_REGIONS = {
  hoodTop:   [8, 8, 745, 672],        // big sunburst w/ center stripe
  tailTop:   [790, 8, 1344, 600],     // framed panel, RACO reads along the car
  namePlate: [1352, 105, 1430, 495],  // driver name strip (cage name plate)
  tailRear:  [1440, 8, 2006, 600],    // back of the tail tank
  cockpitL:  [1504, 612, 1734, 970],  // left cockpit side (rotated 90)
  cockpitR:  [1772, 612, 2020, 970],  // right cockpit side
  noseSideL: [1746, 1120, 2026, 1254],
  noseSideR: [1750, 1258, 2036, 1392],
  hoodSideL: [1298, 1400, 2040, 1636],
  hoodSideR: [1290, 1728, 2040, 1964],
  noseFront: [0, 1149, 540, 1384],    // gold fan with ring (radiator shell)
  tailSideL: [60, 1440, 800, 1846],   // curved tail side w/ big logo
  tailSideR: [430, 880, 1010, 1110],  // right tail side (laid out upside down)
  wheelRear: [1239, 1154, 1714, 1374],// sunburst mud cover (ellipse in UV)
  wheelFront:[1000, 1060, 1290, 1470],// fan mud cover
  chassis:   [100, 690, 860, 1050],   // chassis tubes (gold "bones")
};

// ---------------- helpers ----------------
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);

function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// grid surface: fn(u,v)->[x,y,z], map(u,v)->[a,b] (fractions inside rect, a=image x, b=image y from top)
function panel(nu, nv, fn, rect, map) {
  const pos = [], uv = [], idx = [];
  const [x0, y0, x1, y1] = rect;
  for (let i = 0; i <= nu; i++) {
    for (let j = 0; j <= nv; j++) {
      const u = i / nu, v = j / nv;
      pos.push(...fn(u, v));
      const [a, b] = map(u, v);
      uv.push((x0 + a * (x1 - x0)) / ATLAS, 1 - (y0 + b * (y1 - y0)) / ATLAS);
      if (i < nu && j < nv) {
        const k = i * (nv + 1) + j;
        idx.push(k, k + nv + 1, k + 1, k + 1, k + nv + 1, k + nv + 2);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// merge geometries (bakes mesh transforms); keeps position/normal/uv
function merge(list) {
  const geos = list.map((it) => {
    const g0 = it.isBufferGeometry ? it : it.geometry;
    const g = g0.index ? g0.toNonIndexed() : g0.clone();
    if (!it.isBufferGeometry) { it.updateMatrix(); g.applyMatrix4(it.matrix); }
    if (!g.attributes.normal) g.computeVertexNormals();
    return g;
  });
  let n = 0; geos.forEach((g) => (n += g.attributes.position.count));
  const P = new Float32Array(n * 3), N = new Float32Array(n * 3), U = new Float32Array(n * 2);
  let o = 0;
  for (const g of geos) {
    const c = g.attributes.position.count;
    P.set(g.attributes.position.array, o * 3);
    N.set(g.attributes.normal.array, o * 3);
    if (g.attributes.uv) U.set(g.attributes.uv.array, o * 2);
    o += c;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(P, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(N, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(U, 2));
  return out;
}

// tube between two points (as a positioned mesh, for merging)
const _Y = new THREE.Vector3(0, 1, 0);
function tube(a, b, r, seg = 6) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(B), seg, 1, true));
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(_Y, B.clone().sub(A).normalize());
  return m;
}
function bent(points, r) {
  const out = [];
  for (let i = 0; i < points.length - 1; i++) out.push(tube(points[i], points[i + 1], r));
  return out;
}

// ---------------- body shape ----------------
// nose (radiator shell) z 1.66 -> 1.30
const NOSE = (t) => ({ z: lerp(1.66, 1.3, t), top: lerp(0.58, 0.64, t), bot: 0.3, wt: lerp(0.12, 0.14, t), wb: lerp(0.16, 0.2, t) });
// hood z 1.30 -> 0.12, rising toward the cockpit
const HOOD = (t) => ({ z: lerp(1.3, 0.12, t), top: 0.64 + 0.31 * ease(t), bot: 0.3, wt: lerp(0.14, 0.215, t), wb: lerp(0.2, 0.285, t) });
// cockpit sides z 0.12 -> -0.64
const COCK = (t) => ({ z: lerp(0.12, -0.64, t), top: lerp(0.98, 1.02, t), bot: 0.3, wt: 0.305, wb: 0.34 });
// tail tank z -0.64 -> -1.62
const TAIL = (t) => ({ z: lerp(-0.64, -1.62, t), top: lerp(1.08, 0.9, t) - 0.03 * t * t, bot: lerp(0.5, 0.66, t), wt: lerp(0.29, 0.21, t), wb: lerp(0.335, 0.25, t) });

function sideFn(S, side) {
  return (u, h) => { const s = S(u); return [side * lerp(s.wb, s.wt, h), lerp(s.bot, s.top, h), s.z]; };
}
function topFn(S, crown) {
  return (u, v) => { const s = S(u), sx = v * 2 - 1; return [-sx * s.wt, s.top + crown * (1 - sx * sx), s.z]; };
}
const DARK = [1990, 1990, 2040, 2040];

function buildBodyGeometry() {
  const R = PAINT_REGIONS, parts = [];
  // nose
  parts.push(panel(4, 3, sideFn(NOSE, LEFT), R.noseSideL, (u, h) => [u, 1 - h]));
  parts.push(panel(4, 3, sideFn(NOSE, RIGHT), R.noseSideR, (u, h) => [1 - u, 1 - h]));
  parts.push(panel(4, 6, topFn(NOSE, 0.03), R.noseFront, (u, v) => [v, 0.15 + u * 0.3]));
  parts.push(panel(1, 6, (u, v) => { const s = NOSE(0), sx = v * 2 - 1; const top = s.top + 0.03 * (1 - sx * sx); return [-sx * lerp(s.wb, s.wt, u), lerp(s.bot, top, u), s.z]; },
    R.noseFront, (u, v) => [v, 1 - u * 0.6]));
  // hood
  parts.push(panel(10, 3, sideFn(HOOD, LEFT), R.hoodSideL, (u, h) => [u, 1 - h]));
  parts.push(panel(10, 3, sideFn(HOOD, RIGHT), R.hoodSideR, (u, h) => [1 - u, 1 - h]));
  parts.push(panel(10, 8, topFn(HOOD, 0.04), R.hoodTop, (u, v) => [u, v]));
  // cockpit sides (the paint panel is rotated 90 degrees)
  parts.push(panel(6, 4, sideFn(COCK, LEFT), R.cockpitL, (u, h) => [1 - h, 1 - u]));
  parts.push(panel(6, 4, sideFn(COCK, RIGHT), R.cockpitR, (u, h) => [1 - h, u]));
  // tail tank
  parts.push(panel(8, 4, sideFn(TAIL, LEFT), R.tailSideL, (u, h) => [0.12 + u * 0.8, 0.95 - h * 0.85]));
  parts.push(panel(8, 4, sideFn(TAIL, RIGHT), R.tailSideR, (u, h) => [u, h]));
  parts.push(panel(8, 8, topFn(TAIL, 0.05), R.tailTop, (u, v) => [v, 1 - u]));
  parts.push(panel(3, 6, (u, v) => { const s = TAIL(1), sx = v * 2 - 1; const top = s.top + 0.05 * (1 - sx * sx); return [sx * lerp(s.wb, s.wt, u), lerp(s.bot, top, u), s.z]; },
    R.tailRear, (u, v) => [v, 1 - u]));
  parts.push(panel(6, 2, (u, v) => { const s = TAIL(u); return [(v * 2 - 1) * s.wb, s.bot, s.z]; }, DARK, () => [0.5, 0.5]));
  parts.push(panel(2, 4, (u, v) => { const s = TAIL(0), sx = v * 2 - 1; return [sx * lerp(s.wb, s.wt, u), lerp(s.bot, s.top, u), s.z]; }, DARK, () => [0.5, 0.5]));
  return merge(parts);
}

// ---------------- liveries ----------------
const imgCache = {};
function loadImg(src) {
  return imgCache[src] || (imgCache[src] = new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  }));
}

function atlasTexture(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

// Generated paint for AI cars, using the same layout (drawn at 1/4 size).
function aiAtlas(drv) {
  const S = 512, k = S / ATLAS;
  const c = canvas(S, S), x = c.getContext('2d');
  const [body, accent, numCol] = drv.colors;
  x.fillStyle = body; x.fillRect(0, 0, S, S);
  const R = PAINT_REGIONS;
  const rect = (r, fn) => { x.save(); x.translate(r[0] * k, r[1] * k); fn((r[2] - r[0]) * k, (r[3] - r[1]) * k); x.restore(); };
  const swoosh = (r) => rect(r, (w, h) => {
    x.fillStyle = accent;
    x.beginPath(); x.moveTo(0, h * 0.78); x.lineTo(w, h * 0.42); x.lineTo(w, h * 0.6); x.lineTo(0, h * 0.96); x.fill();
  });
  swoosh(R.hoodSideL); swoosh(R.hoodSideR); swoosh(R.noseSideL); swoosh(R.noseSideR);
  rect(R.hoodTop, (w, h) => { x.fillStyle = accent; x.fillRect(0, h * 0.44, w, h * 0.12); });
  rect(R.tailSideL, (w, h) => { x.fillStyle = accent; x.fillRect(0, h * 0.8, w, h * 0.1); });
  rect(R.tailSideR, (w, h) => { x.fillStyle = accent; x.fillRect(0, h * 0.1, w, h * 0.1); });
  rect(R.tailRear, (w, h) => { x.fillStyle = accent; x.fillRect(0, 0, w, h * 0.18); });
  rect(R.cockpitL, (w, h) => { x.fillStyle = accent; x.fillRect(w * 0.75, 0, w * 0.1, h); });
  rect(R.cockpitR, (w, h) => { x.fillStyle = accent; x.fillRect(w * 0.75, 0, w * 0.1, h); });
  rect(R.tailTop, (w, h) => { x.fillStyle = accent; x.fillRect(w * 0.1, 0, w * 0.08, h); x.fillRect(w * 0.82, 0, w * 0.08, h); });
  for (const r of [R.wheelRear, R.wheelFront]) rect(r, (w, h) => {
    x.fillStyle = accent; x.fillRect(0, 0, w, h);
    x.strokeStyle = body; x.lineWidth = 6; x.beginPath(); x.ellipse(w / 2, h / 2, w * 0.3, h * 0.3, 0, 0, 7); x.stroke();
  });
  rect(R.namePlate, (w, h) => {
    x.fillStyle = accent; x.fillRect(0, 0, w, h);
    x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
    x.fillStyle = body; x.font = `800 ${Math.floor(w * 0.6)}px "Arial Black", Arial, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(drv.name.split(' ').slice(-1)[0].toUpperCase(), 0, 0, h * 0.92);
    x.restore();
  });
  // clay splatter
  x.fillStyle = 'rgba(160,85,40,0.2)';
  for (let i = 0; i < 160; i++) { x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 3 + 0.5, 0, 7); x.fill(); }
  return { canvas: c, chassis: drv.chassis || pickChassis(drv), rim: accent, number: numCol, body, accent };
}
function pickChassis(drv) {
  const opts = ['#e8e8e8', '#1c1c1c', drv.colors[1], '#b0b0b0'];
  let h = 0; for (const ch of drv.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return opts[h % opts.length];
}

async function playerAtlas() {
  const img = await loadImg('assets/paint/raco-44-iracing-scheme.jpg');
  const c = canvas(ATLAS, ATLAS), x = c.getContext('2d');
  x.fillStyle = '#0b0b0e'; x.fillRect(0, 0, ATLAS, ATLAS);
  if (img) x.drawImage(img, 0, 0, ATLAS, ATLAS);
  // the name plate ("HUGGLER") is part of the paint; the chassis takes the gold of the tube panels
  return { canvas: c, chassis: '#f0c975', rim: '#f2cf7e', number: '#ffffff', numberOutline: '#d9b25f', body: '#0b0b0e', accent: '#f2cf7e' };
}

// number decals (like iRacing's number layer): one texture on several planes
function numberTexture(num, fill, outline) {
  const c = canvas(256, 160), x = c.getContext('2d');
  x.font = 'italic 900 132px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
  x.lineWidth = 16; x.strokeStyle = outline; x.strokeText(num, 128, 84, 240);
  x.fillStyle = fill; x.fillText(num, 128, 84, 240);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
function numberPlanes() {
  const parts = [];
  // hood sides, between the wheels (where real non-wing cars carry the number)
  const hm = HOOD(0.56), hh = 0.62;
  const sideX = lerp(hm.wb, hm.wt, hh) + 0.008;
  const yMid = lerp(hm.bot, hm.top, hh);
  const tilt = Math.atan2(hm.wb - hm.wt, hm.top - hm.bot);
  const mk = (w, h, pos, rot) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h));
    m.rotation.order = 'YXZ';
    m.rotation.set(...rot); m.position.set(...pos);
    return m;
  };
  parts.push(mk(0.44, 0.27, [LEFT * sideX, yMid, hm.z], [-tilt, Math.PI / 2, 0]));
  parts.push(mk(0.44, 0.27, [RIGHT * sideX, yMid, hm.z], [-tilt, -Math.PI / 2, 0]));
  const n = NOSE(0.3);
  parts.push(mk(0.22, 0.14, [0, n.top + 0.034, n.z], [-Math.PI / 2 + 0.2, 0, 0]));
  const tt = TAIL(0.78);
  parts.push(mk(0.32, 0.2, [0, tt.top + 0.054, tt.z], [-Math.PI / 2 + 0.22, Math.PI, 0]));
  return merge(parts);
}

// ---------------- chassis / cage ----------------
function cageAndChassis(liv) {
  const r = 0.021, parts = [];
  const yTop = 1.5, zf = 0.06, zr = -0.6, xb = 0.3, xt = 0.26;
  for (const s of [LEFT, RIGHT]) {
    parts.push(...bent([[s * xb, 0.72, zf + 0.05], [s * xt, yTop - 0.08, zf - 0.05], [s * xt * 0.95, yTop, zf - 0.18]], r));
    parts.push(...bent([[s * xb, 0.92, zr], [s * xt, yTop - 0.02, zr + 0.04]], r));
    parts.push(tube([s * xt * 0.95, yTop, zf - 0.18], [s * xt, yTop - 0.02, zr + 0.04], r));
    parts.push(tube([s * xb, 0.92, zr], [s * xt, yTop - 0.08, zf - 0.05], r * 0.85));
    parts.push(tube([s * xb, 1.1, zf - 0.02], [s * xb, 1.12, zr + 0.02], r * 0.85));
    // frame rails
    parts.push(tube([s * 0.22, 0.3, 1.62], [s * 0.3, 0.3, -0.2], r * 1.2));
    parts.push(tube([s * 0.3, 0.3, -0.2], [s * 0.3, 0.5, -1.55], r * 1.2));
    // nerf bars
    parts.push(...bent([[s * 0.28, 0.34, 0.75], [s * 0.72, 0.36, 0.55], [s * 0.9, 0.38, 0.3], [s * 0.9, 0.42, -0.35], [s * 0.72, 0.4, -0.58], [s * 0.3, 0.36, -0.7]], r * 1.1));
    parts.push(tube([s * 0.9, 0.38, 0.3], [s * 0.9, 0.2, 0.05], r * 0.9));
    // front radius rods + shock
    parts.push(tube([s * 0.22, 0.42, 0.62], [s * 0.66, 0.32, 1.07], r * 0.7));
    parts.push(tube([s * 0.22, 0.3, 0.62], [s * 0.66, 0.3, 1.07], r * 0.7));
    parts.push(tube([s * 0.2, 0.62, 1.12], [s * 0.6, 0.34, 1.07], r * 1.4));
    // rear radius rods + shock
    parts.push(tube([s * 0.3, 0.45, -0.75], [s * 0.62, 0.43, -1.06], r * 0.7));
    parts.push(tube([s * 0.3, 0.6, -1.0], [s * 0.6, 0.45, -1.06], r * 1.4));
  }
  parts.push(tube([xt * 0.95, yTop, zf - 0.18], [-xt * 0.95, yTop, zf - 0.18], r));
  parts.push(tube([xt, yTop - 0.02, zr + 0.04], [-xt, yTop - 0.02, zr + 0.04], r));
  parts.push(tube([xb, 0.92, zr], [-xb, 0.92, zr], r));
  parts.push(tube([0.66, 0.32, 1.07], [-0.66, 0.32, 1.07], r * 1.6));  // front axle
  parts.push(tube([0.58, 0.45, -1.06], [-0.58, 0.45, -1.06], r * 2.2)); // rear axle housing
  parts.push(tube([0.24, 0.48, 1.3], [-0.24, 0.48, 1.3], r * 1.5));    // front torsion tube
  parts.push(tube([0.3, 0.55, -1.0], [-0.3, 0.55, -1.0], r * 1.5));    // rear torsion tube
  parts.push(...bent([[0.2, 0.3, 1.66], [0.2, 0.36, 1.86], [-0.2, 0.36, 1.86], [-0.2, 0.3, 1.66]], r));       // front bumper
  parts.push(...bent([[0.3, 0.55, -1.5], [0.34, 0.7, -1.82], [-0.34, 0.7, -1.82], [-0.3, 0.55, -1.5]], r));  // rear bumper
  parts.push(tube([0.34, 0.7, -1.82], [0.3, 0.92, -1.72], r * 0.8));
  parts.push(tube([-0.34, 0.7, -1.82], [-0.3, 0.92, -1.72], r * 0.8));
  return new THREE.Mesh(merge(parts), new THREE.MeshPhongMaterial({ color: liv.chassis, shininess: 50 }));
}

// arm-restraint screens, seat, driver
let _screenMat;
function cockpitInterior(helmetColor) {
  const g = new THREE.Group();
  if (!_screenMat) {
    const c = canvas(32, 32), x = c.getContext('2d');
    x.strokeStyle = '#141414'; x.lineWidth = 3;
    for (let i = 0; i <= 32; i += 8) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i, 32); x.moveTo(0, i); x.lineTo(32, i); x.stroke(); }
    const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(5, 4);
    _screenMat = new THREE.MeshBasicMaterial({ map: t, transparent: true, alphaTest: 0.3, side: THREE.DoubleSide });
  }
  for (const s of [LEFT, RIGHT]) {
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.36), _screenMat);
    scr.position.set(s * 0.292, 1.24, -0.24); scr.rotation.y = Math.PI / 2;
    g.add(scr);
  }
  const dark = new THREE.MeshLambertMaterial({ color: '#141414' });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.7, 0.08), dark);
  seat.position.set(0, 0.85, -0.6); seat.rotation.x = 0.2; g.add(seat);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.05, 0.76), dark);
  floor.position.set(0, 0.32, -0.26); g.add(floor);
  const suit = new THREE.MeshLambertMaterial({ color: '#1d1d1d' });
  const torso = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.38, 0.26), suit);
  torso.position.set(0, 0.95, -0.45); torso.rotation.x = 0.25; g.add(torso);
  for (const s of [LEFT, RIGHT]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.42, 6), suit);
    arm.position.set(s * 0.17, 0.98, -0.22); arm.rotation.x = Math.PI / 2 - 0.3; g.add(arm);
  }
  const helmet = new THREE.Group();
  helmet.add(new THREE.Mesh(new THREE.SphereGeometry(0.145, 14, 10), new THREE.MeshPhongMaterial({ color: helmetColor, shininess: 80 })));
  helmet.add(new THREE.Mesh(new THREE.SphereGeometry(0.148, 12, 6, Math.PI / 2 - 0.85, 1.7, 1.25, 0.55), new THREE.MeshPhongMaterial({ color: '#0a0a0a', shininess: 120 })));
  helmet.position.set(0, 1.24, -0.4);
  g.add(helmet);
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.016, 6, 18), dark);
  sw.position.set(0, 1.0, -0.06); sw.rotation.x = -0.45; g.add(sw);
  return { group: g, helmet, torso };
}

// ---------------- wheels ----------------
let _tireMat, _sidewallMat;
function tireMat() {
  if (_tireMat) return _tireMat;
  const c = canvas(256, 64), x = c.getContext('2d');
  x.fillStyle = '#2b2420'; x.fillRect(0, 0, 256, 64);
  x.fillStyle = '#191513';
  for (let i = 0; i < 256; i += 8) { x.fillRect(i, 4, 3, 26); x.fillRect(i + 4, 34, 3, 26); }
  for (let i = 0; i < 500; i++) {
    x.fillStyle = `rgba(${150 + Math.random() * 40},${80 + Math.random() * 30},${40 + Math.random() * 20},${0.15 + Math.random() * 0.3})`;
    x.fillRect(Math.random() * 256, Math.random() * 64, 2 + Math.random() * 6, 1 + Math.random() * 3);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return (_tireMat = new THREE.MeshLambertMaterial({ map: t }));
}
function sidewallMat() {
  if (_sidewallMat) return _sidewallMat;
  const c = canvas(128, 128), x = c.getContext('2d');
  x.fillStyle = '#231e1b'; x.fillRect(0, 0, 128, 128);
  for (let i = 0; i < 200; i++) { x.fillStyle = `rgba(150,85,45,${Math.random() * 0.3})`; x.fillRect(Math.random() * 128, Math.random() * 128, 3, 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (_sidewallMat = new THREE.MeshLambertMaterial({ map: t, side: THREE.DoubleSide }));
}

// disc whose UVs sample a region of the atlas
function coverDisc(radius, rect) {
  const g = new THREE.CircleGeometry(radius, 24);
  const uv = g.attributes.uv;
  const [x0, y0, x1, y1] = rect;
  for (let i = 0; i < uv.count; i++) {
    const a = uv.getX(i), b = 1 - uv.getY(i);
    uv.setXY(i, (x0 + a * (x1 - x0)) / ATLAS, 1 - (y0 + b * (y1 - y0)) / ATLAS);
  }
  return g;
}

function wheel(radius, width, side, liv, atlasMat, coverRect) {
  const g = new THREE.Group();
  const tread = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 22, 1, true), tireMat());
  tread.rotation.z = Math.PI / 2;
  g.add(tread);
  for (const s of [-1, 1]) {
    const sw = new THREE.Mesh(new THREE.RingGeometry(radius * 0.62, radius, 22), sidewallMat());
    sw.position.x = s * width / 2; sw.rotation.y = s * Math.PI / 2;
    g.add(sw);
  }
  if (side === LEFT && coverRect) {
    // painted mud cover on the left-side wheels
    const cov = new THREE.Mesh(coverDisc(radius * 0.66, coverRect), atlasMat);
    cov.position.x = side * (width / 2 + 0.006); cov.rotation.y = side * Math.PI / 2;
    g.add(cov);
  } else {
    const rimM = new THREE.MeshPhongMaterial({ color: liv.rim, shininess: 60, side: THREE.DoubleSide });
    const rim = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.63, 20), rimM);
    rim.position.x = side * (width / 2 - 0.03); rim.rotation.y = side * Math.PI / 2;
    g.add(rim);
    const bead = new THREE.Mesh(new THREE.RingGeometry(radius * 0.55, radius * 0.64, 20), new THREE.MeshPhongMaterial({ color: '#a0a0a0', shininess: 80, side: THREE.DoubleSide }));
    bead.position.x = side * (width / 2 - 0.02); bead.rotation.y = side * Math.PI / 2;
    g.add(bead);
    const hub = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.16, radius * 0.16, 0.08, 10), new THREE.MeshPhongMaterial({ color: '#777777' }));
    hub.rotation.z = Math.PI / 2; hub.position.x = side * (width / 2 - 0.05);
    g.add(hub);
  }
  return g;
}

// ---------------- assemble ----------------
let _bodyGeo, _numGeo;
export async function buildSprintCar(drv) {
  const liv = drv.isPlayer ? await playerAtlas() : aiAtlas(drv);
  const atlasMat = new THREE.MeshPhongMaterial({ map: atlasTexture(liv.canvas), side: THREE.DoubleSide, shininess: 70, specular: '#333333' });

  const car = new THREE.Group();
  const body = new THREE.Group();
  car.add(body);
  _bodyGeo = _bodyGeo || buildBodyGeometry();
  body.add(new THREE.Mesh(_bodyGeo, atlasMat));

  _numGeo = _numGeo || numberPlanes();
  const outline = liv.numberOutline || (drv.colors[2].toLowerCase() === '#ffffff' ? '#111111' : '#ffffff');
  body.add(new THREE.Mesh(_numGeo, new THREE.MeshLambertMaterial({
    map: numberTexture(drv.number, liv.number || drv.colors[2], outline),
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  })));

  body.add(cageAndChassis(liv));
  // driver name plate across the front of the cage
  body.add(new THREE.Mesh(panel(1, 1, (u, v) => [(v * 2 - 1) * 0.25, 1.43 + u * 0.1, -0.07 - u * 0.04], PAINT_REGIONS.namePlate, (u, v) => [1 - u, 1 - v]), atlasMat));
  const interior = cockpitInterior(drv.isPlayer ? '#f2cf7e' : liv.accent);
  body.add(interior.group);

  // headers out the right side
  const hdr = [];
  for (let i = 0; i < 4; i++) {
    const z0 = 0.9 - i * 0.16;
    hdr.push(...bent([[RIGHT * 0.22, 0.6, z0], [RIGHT * 0.36, 0.58 - i * 0.02, z0 - 0.1], [RIGHT * 0.44, 0.5, z0 - 0.45]], 0.026));
  }
  hdr.push(...bent([[RIGHT * 0.44, 0.48, 0.0], [RIGHT * 0.46, 0.48, -0.5], [RIGHT * 0.5, 0.46, -0.85]], 0.055));
  body.add(new THREE.Mesh(merge(hdr), new THREE.MeshPhongMaterial({ color: '#a8a39a', shininess: 90 })));

  // wheels
  const wheels = {};
  const fl = new THREE.Group(), fr = new THREE.Group();
  fl.position.set(LEFT * 0.78, 0.31, 1.07);
  fr.position.set(RIGHT * 0.78, 0.31, 1.07);
  wheels.fl = wheel(0.31, 0.22, LEFT, liv, atlasMat, PAINT_REGIONS.wheelFront); fl.add(wheels.fl);
  wheels.fr = wheel(0.31, 0.24, RIGHT, liv, atlasMat, null); fr.add(wheels.fr);
  car.add(fl, fr);
  wheels.rl = wheel(0.43, 0.38, LEFT, liv, atlasMat, PAINT_REGIONS.wheelRear); wheels.rl.position.set(LEFT * 0.8, 0.44, -1.06);
  wheels.rr = wheel(0.455, 0.46, RIGHT, liv, atlasMat, null); wheels.rr.position.set(RIGHT * 0.86, 0.455, -1.06);
  car.add(wheels.rl, wheels.rr);

  const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 4.2), shadowMat());
  sh.rotation.x = -Math.PI / 2;
  sh.position.y = 0.03;
  sh.renderOrder = 1;
  car.add(sh);

  car.userData = { wheels, steerL: fl, steerR: fr, helmet: interior.helmet, shoulders: interior.torso, body };
  return car;
}

let _shadowMat;
function shadowMat() {
  if (_shadowMat) return _shadowMat;
  const c = canvas(64, 128), x = c.getContext('2d');
  const g = x.createRadialGradient(32, 64, 4, 32, 64, 60);
  g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 128);
  _shadowMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
  return _shadowMat;
}

// animate wheels/steering on a built car
export function poseCar(car, steer, wheelSpinRear, wheelSpinFront) {
  const u = car.userData;
  u.steerL.rotation.y = -steer;
  u.steerR.rotation.y = -steer;
  u.wheels.fl.rotation.x = wheelSpinFront;
  u.wheels.fr.rotation.x = wheelSpinFront;
  u.wheels.rl.rotation.x = wheelSpinRear;
  u.wheels.rr.rotation.x = wheelSpinRear * 0.95;
}
