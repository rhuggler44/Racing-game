// 410 non-wing sprint car, modeled after iRacing's non-wing sprinter.
// Local axes: +Z forward, +Y up, +X = LEFT side.
//
// The body is UV-mapped onto a 2048x2048 paint atlas laid out like the iRacing
// paint file (see PAINT_REGIONS). The player's car uses the uploaded iRacing
// scheme; AI cars get a generated atlas with the same layout.
import * as THREE from 'three';

const LEFT = 1, RIGHT = -1;
const ATLAS = 2048;

// Panel regions on the paint file (pixel rects x0,y0,x1,y1).
export const PAINT_REGIONS = {
  hoodTop:   [8, 8, 745, 672],
  tailTop:   [790, 8, 1344, 600],
  namePlate: [1352, 105, 1430, 495],
  tailRear:  [1440, 8, 2006, 600],
  cockpitL:  [1504, 612, 1734, 970],
  cockpitR:  [1772, 612, 2020, 970],
  noseSideL: [1746, 1120, 2026, 1254],
  noseSideR: [1750, 1258, 2036, 1392],
  hoodSideL: [1298, 1400, 2040, 1636],
  hoodSideR: [1290, 1728, 2040, 1964],
  noseFront: [0, 1149, 540, 1384],
  tailSideL: [60, 1440, 800, 1846],
  tailSideR: [430, 880, 1010, 1110],
  wheelRear: [1239, 1154, 1714, 1374],
  wheelFront:[1000, 1060, 1290, 1470],
  chassis:   [100, 690, 860, 1050],
};

// ---------------- helpers ----------------
const lerp = (a, b, t) => a + (b - a) * t;
const ease = (t) => t * t * (3 - 2 * t);
const spow = (v, p) => Math.sign(v) * Math.pow(Math.abs(v), p);
function canvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

// grid surface: fn(u,v)->[x,y,z], map(u,v)->[a,b] fractions of rect (a = image x, b = image y from top)
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

const _Y = new THREE.Vector3(0, 1, 0);
function tube(a, b, r, seg = 8) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, A.distanceTo(B), seg, 1, true));
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(_Y, B.clone().sub(A).normalize());
  return m;
}
// smooth bent tube through points (Catmull-Rom), as a geometry
function pipe(points, r, closed = false, seg = 8) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(...p)), closed, 'centripetal');
  return new THREE.TubeGeometry(curve, Math.max(8, points.length * 8), r, seg, closed);
}
const mirror = (pts) => pts.map(([x, y, z]) => [-x, y, z]);

// ---------------- body shape ----------------
// Each section: z, bot (bottom edge of the side panel), top (crown height),
// wb/wt (half widths at bottom / at the shoulder), rr (shoulder rounding)
const NOSE = (t) => ({ z: lerp(1.64, 1.3, t), bot: 0.4, top: lerp(0.55, 0.6, t), wb: lerp(0.18, 0.215, t), wt: lerp(0.15, 0.185, t), rr: 0.07 });
const HOOD = (t) => ({ z: lerp(1.3, 0.1, t), bot: lerp(0.4, 0.5, t), top: 0.6 + 0.43 * ease(t), wb: lerp(0.215, 0.33, t), wt: lerp(0.185, 0.285, t), rr: lerp(0.07, 0.14, t) });
const COCK = (t) => ({ z: lerp(0.1, -0.62, t), bot: 0.34, top: lerp(1.02, 1.1, t), wb: 0.33, wt: 0.31 });
const TAIL = (t) => {
  // tall, narrow tail that rounds off at the back
  const k = t < 0.68 ? 0 : (t - 0.68) / 0.32;
  const top = lerp(1.36, 1.24, Math.min(t / 0.68, 1)) - (1.24 - 0.82) * (1 - Math.cos(k * Math.PI / 2));
  const bot = lerp(0.52, 0.66, t);
  return { z: lerp(-0.62, -1.62, t), bot, top, wb: lerp(0.3, 0.24, t), wt: lerp(0.17, 0.13, t) * (1 - 0.35 * k * k), rr: Math.min(0.12, (top - bot) * 0.45) };
};

const sideFn = (S, side) => (u, h) => { const s = S(u); return [side * lerp(s.wb, s.wt, h), lerp(s.bot, s.top - (s.rr || 0), h), s.z]; };
const topFn = (S) => (u, v) => {
  const s = S(u), a = (v * 2 - 1) * Math.PI / 2;
  return [-s.wt * spow(Math.sin(a), 0.55), s.top - s.rr + s.rr * Math.pow(Math.abs(Math.cos(a)), 0.55), s.z];
};
const capFn = (S, t, sideSign = 1) => (u, v) => {
  // cap a section: u = 0 at bottom edge .. 1 at the shoulder/crown outline
  const s = S(t), a = (v * 2 - 1) * Math.PI / 2;
  const xr = -s.wt * spow(Math.sin(a), 0.55), yr = s.top - s.rr + s.rr * Math.pow(Math.abs(Math.cos(a)), 0.55);
  const xb = -s.wb * Math.sign(Math.sin(a)) * Math.min(1, Math.abs(Math.sin(a)) * 3);
  return [lerp(xb, xr, u) * sideSign, lerp(s.bot, yr, u), s.z];
};

function buildBodyGeometry() {
  const R = PAINT_REGIONS, parts = [];
  // nose
  parts.push(panel(4, 3, sideFn(NOSE, LEFT), R.noseSideL, (u, h) => [u, 1 - h]));
  parts.push(panel(4, 3, sideFn(NOSE, RIGHT), R.noseSideR, (u, h) => [1 - u, 1 - h]));
  parts.push(panel(4, 10, topFn(NOSE), R.noseFront, (u, v) => [v, 0.1 + u * 0.35]));
  parts.push(panel(3, 10, capFn(NOSE, 0), R.noseFront, (u, v) => [v, 0.95 - u * 0.5]));
  // hood
  parts.push(panel(14, 4, sideFn(HOOD, LEFT), R.hoodSideL, (u, h) => [u, 1 - h]));
  parts.push(panel(14, 4, sideFn(HOOD, RIGHT), R.hoodSideR, (u, h) => [1 - u, 1 - h]));
  parts.push(panel(14, 12, topFn(HOOD), R.hoodTop, (u, v) => [u, v]));
  // hood bubble over the injectors
  parts.push(panel(10, 10, (u, v) => {
    const t = lerp(0.5, 1, u), s = HOOD(t), a = (v * 2 - 1) * Math.PI / 2;
    const rise = 0.085 * Math.sin(Math.min(1, u * 1.6) * Math.PI / 2);
    const hw = 0.13 * (0.6 + 0.4 * Math.sin(Math.min(1, u * 2) * Math.PI / 2));
    return [-hw * Math.sin(a), s.top + 0.004 + rise * Math.cos(a) ** 0.8, s.z];
  }, R.hoodTop, (u, v) => [0.55 + u * 0.4, 0.3 + v * 0.4]));
  // cockpit sides (paint panel is rotated 90 degrees)
  parts.push(panel(6, 4, sideFn(COCK, LEFT), R.cockpitL, (u, h) => [1 - h, 1 - u]));
  parts.push(panel(6, 4, sideFn(COCK, RIGHT), R.cockpitR, (u, h) => [1 - h, u]));
  // tail tank
  parts.push(panel(12, 4, sideFn(TAIL, LEFT), R.tailSideL, (u, h) => [0.12 + u * 0.8, 0.95 - h * 0.85]));
  parts.push(panel(12, 4, sideFn(TAIL, RIGHT), R.tailSideR, (u, h) => [u, h]));
  parts.push(panel(12, 10, topFn(TAIL), R.tailTop, (u, v) => [v, 1 - u]));
  parts.push(panel(3, 10, capFn(TAIL, 1, -1), R.tailRear, (u, v) => [v, 1 - u]));
  parts.push(panel(3, 10, capFn(TAIL, 0, -1), R.tailRear, (u, v) => [v, 1 - u]));
  // tail belly
  parts.push(panel(8, 2, (u, v) => { const s = TAIL(u); return [(v * 2 - 1) * s.wb, s.bot, s.z]; }, R.tailRear, () => [0.5, 0.95]));
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
  t.anisotropy = 8;
  return t;
}

// Generated iRacing-style paint for AI cars (same layout, 1/4 size).
function aiAtlas(drv) {
  if (drv.livery && CUSTOM_LIVERIES[drv.livery]) return CUSTOM_LIVERIES[drv.livery](drv);
  const S = 512, k = S / ATLAS;
  const c = canvas(S, S), x = c.getContext('2d');
  const [body, accent, numCol] = drv.colors;
  // most AI cars: white base with the team color sweeping back, like real liveries
  const base = drv.base || (['#ffffff', '#ffffff', body][drv.name.length % 3]);
  x.fillStyle = base; x.fillRect(0, 0, S, S);
  const R = PAINT_REGIONS;
  const rect = (r, fn) => { x.save(); x.translate(r[0] * k, r[1] * k); fn((r[2] - r[0]) * k, (r[3] - r[1]) * k); x.restore(); };
  const sweep = (r, flip) => rect(r, (w, h) => {
    x.save(); if (flip) { x.translate(w, 0); x.scale(-1, 1); }
    x.fillStyle = body;
    x.beginPath(); x.moveTo(0, h); x.lineTo(0, h * 0.62); x.quadraticCurveTo(w * 0.55, h * 0.55, w, h * 0.05); x.lineTo(w, h); x.fill();
    x.fillStyle = accent;
    x.beginPath(); x.moveTo(0, h * 0.62); x.quadraticCurveTo(w * 0.55, h * 0.55, w, h * 0.05); x.lineTo(w, h * 0.16); x.quadraticCurveTo(w * 0.55, h * 0.68, 0, h * 0.74); x.fill();
    x.restore();
  });
  sweep(R.hoodSideL); sweep(R.hoodSideR, true); sweep(R.noseSideL); sweep(R.noseSideR, true);
  // sponsor-style name on the hood sides
  const word = drv.sponsor || drv.name.split(' ').slice(-1)[0].toUpperCase();
  const label = (r, flip) => rect(r, (w, h) => {
    x.save(); x.translate(flip ? w * 0.38 : w * 0.62, h * 0.36); x.rotate(-0.06);
    x.font = `italic 900 ${Math.floor(h * 0.34)}px "Arial Black", Arial, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
    x.lineWidth = h * 0.06; x.strokeStyle = base === '#ffffff' ? body : '#ffffff'; x.strokeText(word, 0, 0, w * 0.62);
    x.fillStyle = base === '#ffffff' ? '#ffffff' : accent; x.fillText(word, 0, 0, w * 0.62);
    x.restore();
  });
  label(R.hoodSideL); label(R.hoodSideR, true);
  rect(R.hoodTop, (w, h) => { x.fillStyle = body; x.fillRect(w * 0.7, 0, w * 0.3, h); x.fillStyle = accent; x.fillRect(w * 0.66, 0, w * 0.04, h); });
  rect(R.tailSideL, (w, h) => { x.fillStyle = body; x.beginPath(); x.moveTo(0, h); x.lineTo(w, h * 0.2); x.lineTo(w, h); x.fill(); });
  rect(R.tailSideR, (w, h) => { x.fillStyle = body; x.beginPath(); x.moveTo(w, 0); x.lineTo(0, h * 0.8); x.lineTo(0, 0); x.fill(); });
  rect(R.tailRear, (w, h) => { x.fillStyle = body; x.fillRect(0, h * 0.5, w, h * 0.5); });
  rect(R.tailTop, (w, h) => { x.fillStyle = body; x.fillRect(0, h * 0.6, w, h * 0.4); x.fillStyle = accent; x.fillRect(0, h * 0.56, w, h * 0.05); });
  rect(R.cockpitL, (w, h) => { x.fillStyle = body; x.fillRect(w * 0.55, 0, w * 0.45, h); });
  rect(R.cockpitR, (w, h) => { x.fillStyle = body; x.fillRect(w * 0.55, 0, w * 0.45, h); });
  rect(R.noseFront, (w, h) => { x.fillStyle = base; x.fillRect(0, 0, w, h); });
  rect(R.namePlate, (w, h) => {
    x.fillStyle = '#111'; x.fillRect(0, 0, w, h);
    x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
    x.fillStyle = '#fff'; x.font = `800 ${Math.floor(w * 0.55)}px "Arial Black", Arial, sans-serif`;
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText(drv.name.toUpperCase(), 0, 0, h * 0.92);
    x.restore();
  });
  // a little clay on everything
  for (let i = 0; i < 220; i++) { x.fillStyle = `rgba(150,85,45,${0.1 + Math.random() * 0.15})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 2.5 + 0.4, 0, 7); x.fill(); }
  return { canvas: c, chassis: '#151515', roof: body, rim: '#cfd3d6', number: numCol === '#ffffff' && base === '#ffffff' ? '#111111' : numCol, numberOutline: base === '#ffffff' ? '#ffffff' : '#111111', helmet: accent, coverLeft: false };
}

// ---------------- custom liveries for real cars ----------------
// Paint in "viewer space" for each side panel: (0,0) is the top-left of the panel
// as you see it standing beside the car, w x h is its size; rearRight tells you
// which end is the back of the car.
function sidePainter(x, k) {
  const R = PAINT_REGIONS;
  const at = (r) => [r[0] * k, r[1] * k, (r[2] - r[0]) * k, (r[3] - r[1]) * k];
  return {
    // hood / nose / left tail sides read straight across the image
    flat(r, rearRight, fn) { const [x0, y0, w, h] = at(r); x.save(); x.translate(x0, y0); x.beginPath(); x.rect(0, 0, w, h); x.clip(); fn(w, h, rearRight); x.restore(); },
    // cockpit side panels are laid out rotated 90 degrees
    rot90(r, rearRight, fn) { const [x0, y0, w, h] = at(r); x.save(); x.translate(x0, y0 + h); x.rotate(-Math.PI / 2); x.beginPath(); x.rect(0, 0, h, w); x.clip(); fn(h, w, rearRight); x.restore(); },
    // the right tail side is laid out upside down
    rot180(r, rearRight, fn) { const [x0, y0, w, h] = at(r); x.save(); x.translate(x0 + w, y0 + h); x.rotate(Math.PI); x.beginPath(); x.rect(0, 0, w, h); x.clip(); fn(w, h, rearRight); x.restore(); },
    R,
  };
}

const CUSTOM_LIVERIES = {
  // #5T Jake Swanson: white car with red/black stripes along the top edges,
  // SNAKE Enterprises + Inland Rigging on the hood sides, black sponsor panel on
  // the front of the tail, big black 5T outlined in red on the back of the tail
  swanson5t(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const white = '#f6f6f3', red = '#d61f2c', black = '#111111';
    x.fillStyle = white; x.fillRect(0, 0, S, S);
    const txt = (t, px, py, size, color, opt = {}) => {
      x.font = `${opt.italic ? 'italic ' : ''}${opt.weight || 900} ${Math.floor(size)}px ${opt.font || '"Arial Black", Arial, sans-serif'}`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      if (opt.stroke) { x.lineWidth = size * (opt.sw || 0.16); x.strokeStyle = opt.stroke; x.strokeText(t, px, py, opt.maxW); }
      x.fillStyle = color; x.fillText(t, px, py, opt.maxW);
    };
    const topStripes = (w, h, at = 0.06) => {
      x.fillStyle = black; x.fillRect(0, 0, w, h * at);
      x.fillStyle = red; x.fillRect(0, h * at, w, h * 0.06);
    };
    // hood sides: Inland Rigging toward the front, SNAKE Enterprises toward the cockpit
    const hoodSide = (w, h, rr) => {
      topStripes(w, h, 0.05);
      x.fillStyle = red; x.fillRect(0, h * 0.9, w, h * 0.1);
      const front = (f) => (rr ? w * f : w * (1 - f)); // f measured from the front of the car
      txt('INLAND', front(0.24), h * 0.3, h * 0.2, black, { maxW: w * 0.3 });
      txt('RIGGING', front(0.24), h * 0.5, h * 0.2, black, { maxW: w * 0.32 });
      txt('Machinery Moving & Warehousing', front(0.24), h * 0.68, h * 0.07, black, { italic: true, weight: 700, maxW: w * 0.34 });
      txt('SNAKE', front(0.66), h * 0.42, h * 0.4, black, { italic: true, maxW: w * 0.42 });
      txt('ENTERPRISES', front(0.68), h * 0.72, h * 0.1, black, { weight: 700, maxW: w * 0.32 });
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    const noseSide = (w, h) => { topStripes(w, h, 0.08); x.fillStyle = red; x.fillRect(0, h * 0.86, w, h * 0.14); txt('CSI', w * 0.5, h * 0.5, h * 0.26, black, { maxW: w * 0.5 }); };
    P.flat(R.noseSideL, true, noseSide); P.flat(R.noseSideR, false, noseSide);
    // cockpit sides: a cluster of small sponsors
    const cockSide = (w, h) => {
      topStripes(w, h, 0.07);
      const items = [['DIRTROOTS', 0.25, 0.3], ['BURRIS', 0.72, 0.3], ['APACHE', 0.25, 0.46], ['DRIVE-IN', 0.72, 0.46], ['LOCKE', 0.22, 0.62], ['JST', 0.5, 0.62], ['RedDriver', 0.78, 0.62], ['CK ENTERPRISES', 0.5, 0.78]];
      for (const [t, fx, fy] of items) txt(t, w * fx, h * fy, h * 0.075, black, { weight: 800, maxW: w * 0.42 });
      x.fillStyle = red; x.fillRect(0, h * 0.9, w, h * 0.1);
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail sides: black sponsor panel up front, 5T on the back half
    const tailSide = (w, h, rr) => {
      const fx = rr ? 0 : w * 0.52;
      x.fillStyle = black; x.fillRect(fx, 0, w * 0.48, h * 0.86);
      x.fillStyle = red; x.fillRect(fx, h * 0.86, w * 0.48, h * 0.06);
      x.beginPath(); x.moveTo(fx, h * 0.12); x.lineTo(fx + w * 0.48, 0); x.lineTo(fx + w * 0.48, h * 0.04); x.lineTo(fx, h * 0.16); x.fill();
      const cx = fx + w * 0.24;
      x.strokeStyle = white; x.lineWidth = h * 0.012; x.save(); x.translate(cx, h * 0.3); x.rotate(Math.PI / 4); x.strokeRect(-h * 0.08, -h * 0.08, h * 0.16, h * 0.16); x.restore();
      txt('ROLLS', cx, h * 0.28, h * 0.04, white, { weight: 800 });
      txt('SCAFFOLD', cx, h * 0.32, h * 0.04, white, { weight: 800 });
      txt('DOUGHBOYZ', cx, h * 0.48, h * 0.075, white, { maxW: w * 0.42 });
      txt('FINE LINE', cx, h * 0.62, h * 0.085, white, { maxW: w * 0.42 });
      txt('DRAFTING', cx, h * 0.74, h * 0.085, white, { weight: 700, maxW: w * 0.42 });
      // the number on the back of the tail: black with a red outline
      const nx = rr ? w * 0.7 : w * 0.3;
      x.font = `italic 900 ${Math.floor(h * 0.56)}px "Arial Black", Arial, sans-serif`;
      x.lineWidth = h * 0.1; x.strokeStyle = red; x.strokeText('5T', nx, h * 0.5, w * 0.4);
      x.lineWidth = h * 0.04; x.strokeStyle = white; x.strokeText('5T', nx, h * 0.5, w * 0.4);
      x.fillStyle = black; x.fillText('5T', nx, h * 0.5, w * 0.4);
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    // tail top: black up front with the red stripe, white behind
    P.flat(R.tailTop, true, (w, h) => { x.fillStyle = black; x.fillRect(0, h * 0.55, w, h * 0.45); x.fillStyle = red; x.fillRect(0, h * 0.5, w, h * 0.05); });
    P.flat(R.tailRear, true, (w, h) => { x.fillStyle = red; x.fillRect(0, h * 0.82, w, h * 0.08); });
    P.flat(R.hoodTop, true, (w, h) => { x.fillStyle = black; x.fillRect(w * 0.72, 0, w * 0.28, h); x.fillStyle = red; x.fillRect(w * 0.68, 0, w * 0.04, h); });
    // cage plate: DOUGHERTY
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = white; x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      txt('DOUGHERTY', 0, 0, w * 0.55, black, { italic: true, maxW: h * 0.9 });
      x.restore();
    });
    for (let i = 0; i < 500; i++) { x.fillStyle = `rgba(40,30,25,${0.06 + Math.random() * 0.12})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 3 + 0.4, 0, 7); x.fill(); }
    return {
      canvas: c, chassis: '#141414', roof: black, rim: '#dfe3e6', helmet: '#f6f6f3', coverLeft: false,
      number: black, numberOutline: red, numberShadow: white, paintedTailNumbers: true,
    };
  },

  // #3P Kyle Cummins: white car, giant red AVANTI over a black arrow on the hood
  // sides, red tail front with the sponsor stack, red roof, 3P on the tail
  cummins3p(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const white = '#f6f6f3', red = '#d7192d', black = '#111111';
    x.fillStyle = white; x.fillRect(0, 0, S, S);
    const txt = (t, px, py, size, color, weight = 900, maxW, stroke) => {
      x.font = `italic ${weight} ${Math.floor(size)}px "Arial Black", Arial, sans-serif`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      if (stroke) { x.lineWidth = size * 0.16; x.strokeStyle = stroke; x.strokeText(t, px, py, maxW); }
      x.fillStyle = color; x.fillText(t, px, py, maxW);
    };
    // hood sides: black arrow pointing forward, huge AVANTI, red/black stripes low at the front
    const hoodSide = (w, h, rr) => {
      x.save(); if (!rr) { x.translate(w, 0); x.scale(-1, 1); } // shapes drawn with the rear on the right
      x.fillStyle = black;
      x.beginPath(); x.moveTo(w * 0.98, h * 0.3); x.lineTo(w * 0.2, h * 0.3); x.lineTo(w * 0.1, h * 0.5); x.lineTo(w * 0.2, h * 0.7); x.lineTo(w * 0.98, h * 0.7); x.fill();
      x.fillStyle = red; x.beginPath(); x.moveTo(0, h); x.lineTo(w * 0.1, h * 0.78); x.lineTo(w * 0.3, h * 0.78); x.lineTo(w * 0.2, h); x.fill();
      x.fillStyle = black; x.beginPath(); x.moveTo(w * 0.22, h); x.lineTo(w * 0.32, h * 0.78); x.lineTo(w * 0.38, h * 0.78); x.lineTo(w * 0.28, h); x.fill();
      x.restore();
      txt('AVANTI', w * 0.55, h * 0.5, h * 0.62, red, 900, w * 0.8, black);
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    const noseSide = (w, h, rr) => {
      x.save(); if (!rr) { x.translate(w, 0); x.scale(-1, 1); }
      x.fillStyle = red; x.beginPath(); x.moveTo(w * 0.4, h); x.lineTo(w * 0.7, 0); x.lineTo(w, 0); x.lineTo(w * 0.7, h); x.fill();
      x.fillStyle = black; x.beginPath(); x.moveTo(w * 0.72, h); x.lineTo(w, h * 0.1); x.lineTo(w, h * 0.4); x.lineTo(w * 0.88, h); x.fill();
      x.restore();
    };
    P.flat(R.noseSideL, true, noseSide); P.flat(R.noseSideR, false, noseSide);
    // cockpit sides: white with a red lower edge and a small sponsor
    const cockSide = (w, h) => {
      x.fillStyle = red; x.fillRect(0, h * 0.82, w, h * 0.18);
      x.fillStyle = black; x.fillRect(0, h * 0.78, w, h * 0.04);
      txt('Kyle Cummins', w * 0.5, h * 0.2, h * 0.09, black, 700, w * 0.8);
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail sides: red sponsor panel up front, white behind for the number
    const tailSide = (w, h, rr) => {
      const front = rr ? 0 : w * 0.55;
      x.fillStyle = red; x.fillRect(front, 0, w * 0.45, h);
      x.fillStyle = black; x.fillRect(rr ? w * 0.45 : w * 0.53, 0, w * 0.02, h);
      const cx = front + w * 0.225;
      x.fillStyle = white; x.fillRect(front + w * 0.03, h * 0.08, w * 0.39, h * 0.12);
      txt('LIFESTYLE HOMES', cx, h * 0.14, h * 0.07, red, 900, w * 0.36);
      txt('APACHE TRANSPORT', cx, h * 0.34, h * 0.09, white, 900, w * 0.4);
      txt('LUCAS OIL CENTER', cx, h * 0.52, h * 0.085, white, 900, w * 0.4);
      txt('NOVIX', cx, h * 0.7, h * 0.12, white, 900, w * 0.4);
      txt('TREE STANDS', cx, h * 0.82, h * 0.06, white, 800, w * 0.4);
      // the number lives on the back half of the tail
      x.lineWidth = h * 0.16; x.strokeStyle = white; x.lineJoin = 'round';
      x.font = `italic 900 ${Math.floor(h * 0.55)}px "Arial Black", Arial, sans-serif`;
      x.strokeText('3P', rr ? w * 0.66 : w * 0.3, h * 0.48, w * 0.4);
      txt('3P', rr ? w * 0.66 : w * 0.3, h * 0.48, h * 0.55, red, 900, w * 0.4, black);
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    // tail top: red at the front (behind the driver) with Premier Recycling
    P.flat(R.tailTop, true, (w, h) => {
      x.fillStyle = red; x.fillRect(0, h * 0.55, w, h * 0.45);
      x.save(); x.translate(w / 2, h * 0.78); x.rotate(-Math.PI / 2);
      txt('PREMIER', 0, -w * 0.08, w * 0.12, white, 900, h * 0.42);
      txt('RECYCLING', 0, w * 0.08, w * 0.09, white, 900, h * 0.42);
      x.restore();
    });
    P.flat(R.tailRear, true, (w, h) => { x.fillStyle = red; x.fillRect(0, h * 0.7, w, h * 0.3); });
    // hood top: white with a red/black stripe toward the cockpit
    P.flat(R.hoodTop, true, (w, h) => { x.fillStyle = red; x.fillRect(w * 0.7, h * 0.44, w * 0.3, h * 0.12); x.fillStyle = black; x.fillRect(w * 0.7, h * 0.41, w * 0.3, h * 0.03); });
    // cage name plate
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = white; x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      txt('JUGO SUPER FOODS', 0, 0, w * 0.5, black, 900, h * 0.9);
      x.restore();
    });
    for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(160,90,45,${0.08 + Math.random() * 0.14})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 4 + 0.5, 0, 7); x.fill(); }
    return {
      canvas: c, chassis: '#141414', roof: red, rim: '#dfe3e6', helmet: red, coverLeft: false,
      number: red, numberOutline: black, numberShadow: white, paintedTailNumbers: true,
    };
  },

  // #6T Trey Osborne: white car, orange-to-yellow fade up top and on the tail,
  // red-orange sweep on the hood sides with the IHI / Industrial Hydraulics logo
  osborne6t(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const white = '#f7f7f4', red = '#e8401c', orange = '#ff7a1a', yellow = '#ffc21a', black = '#151515';
    x.fillStyle = white; x.fillRect(0, 0, S, S);
    const fade = (w, h, vertical) => {
      const g = vertical ? x.createLinearGradient(0, h, 0, 0) : x.createLinearGradient(0, 0, w, 0);
      g.addColorStop(0, yellow); g.addColorStop(0.55, orange); g.addColorStop(1, red);
      return g;
    };
    // hood sides: red-orange sweep rising toward the cockpit, IHI logo, sponsor text
    const hoodSide = (w, h, rr) => {
      x.save(); if (!rr) { x.translate(w, 0); x.scale(-1, 1); } // draw with the rear on the right
      const g = x.createLinearGradient(w * 0.3, h, w, 0); g.addColorStop(0, orange); g.addColorStop(1, red);
      x.fillStyle = g;
      x.beginPath(); x.moveTo(w * 0.22, h); x.quadraticCurveTo(w * 0.62, h * 0.55, w, h * 0.02); x.lineTo(w, h * 0.5); x.quadraticCurveTo(w * 0.7, h * 0.85, w * 0.48, h); x.fill();
      x.fillStyle = black; // black stripe by the cockpit
      x.beginPath(); x.moveTo(w * 0.86, 0); x.lineTo(w * 0.92, 0); x.lineTo(w * 0.8, h); x.lineTo(w * 0.74, h); x.fill();
      x.fillStyle = '#ffd400'; x.fillRect(0, h * 0.94, w, h * 0.06);
      x.restore();
      // IHI oval and lettering (always drawn readable)
      const cx = rr ? w * 0.56 : w * 0.44, cy = h * 0.33;
      x.fillStyle = white; x.strokeStyle = red; x.lineWidth = h * 0.05;
      x.beginPath(); x.ellipse(cx, cy, w * 0.17, h * 0.27, 0, 0, Math.PI * 2); x.fill(); x.stroke();
      x.fillStyle = red; x.font = `900 ${Math.floor(h * 0.38)}px "Times New Roman", Georgia, serif`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('IHI', cx, cy + h * 0.01);
      x.fillStyle = black; x.font = `800 ${Math.floor(h * 0.17)}px Arial, sans-serif`;
      x.fillText('Industrial', rr ? w * 0.6 : w * 0.4, h * 0.68);
      x.fillText('Hydraulics, Inc.', rr ? w * 0.6 : w * 0.4, h * 0.86);
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    const noseSide = (w, h, rr) => {
      x.fillStyle = orange; x.fillRect(0, h * 0.82, w, h * 0.18);
      x.fillStyle = black; x.font = `800 ${Math.floor(h * 0.2)}px Arial, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('IHI', w * 0.5, h * 0.45);
    };
    P.flat(R.noseSideL, true, noseSide); P.flat(R.noseSideR, false, noseSide);
    // cockpit sides: orange fade up top, black stripe, small sponsors
    const cockSide = (w, h, rr) => {
      x.fillStyle = fade(w, h, true); x.fillRect(0, 0, w, h * 0.3);
      x.fillStyle = black;
      x.beginPath(); x.moveTo(rr ? w * 0.08 : w * 0.82, h * 0.3); x.lineTo(rr ? w * 0.2 : w * 0.94, h * 0.3); x.lineTo(rr ? w * 0.34 : w * 0.66, h); x.lineTo(rr ? w * 0.22 : w * 0.54, h); x.fill();
      x.font = `900 ${Math.floor(h * 0.1)}px Arial, sans-serif`; x.textAlign = 'center'; x.textBaseline = 'middle';
      x.fillText('HHH', w * 0.55, h * 0.42);
      x.font = `800 ${Math.floor(h * 0.075)}px Arial, sans-serif`;
      x.fillText("SHOEMAKER'S", w * 0.55, h * 0.56);
      x.fillStyle = red; x.fillText('RACING', w * 0.55, h * 0.68);
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail sides: orange-to-yellow fade on the lower tail
    const tailSide = (w, h) => {
      const g = x.createLinearGradient(0, h * 0.3, 0, h); g.addColorStop(0, 'rgba(255,194,26,0)'); g.addColorStop(0.45, yellow); g.addColorStop(1, orange);
      x.fillStyle = g; x.fillRect(0, 0, w, h);
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    // tail top + rear: orange fade
    P.flat(R.tailTop, true, (w, h) => { const g = x.createLinearGradient(0, h, 0, 0); g.addColorStop(0, yellow); g.addColorStop(0.6, orange); g.addColorStop(1, red); x.fillStyle = g; x.fillRect(0, 0, w, h); });
    P.flat(R.tailRear, true, (w, h) => { x.fillStyle = fade(w, h, true); x.fillRect(0, 0, w, h); });
    // hood top: white, orange sweep near the cockpit
    P.flat(R.hoodTop, true, (w, h) => { const g = x.createLinearGradient(w * 0.55, 0, w, 0); g.addColorStop(0, 'rgba(255,122,26,0)'); g.addColorStop(0.5, orange); g.addColorStop(1, red); x.fillStyle = g; x.fillRect(0, 0, w, h); });
    // cage name plate: "TALL"
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = fade(w, h, true); x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      x.fillStyle = black; x.font = `900 ${Math.floor(w * 0.62)}px "Arial Black", Arial, sans-serif`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.fillText('TALL', 0, 0, h * 0.8);
      x.restore();
    });
    // a little clay on everything
    for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(160,90,45,${0.08 + Math.random() * 0.14})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 4 + 0.5, 0, 7); x.fill(); }
    return {
      canvas: c, chassis: '#8f969c', roof: orange, rim: '#f2f2ee', helmet: '#f7f7f4', coverLeft: false,
      number: orange, numberOutline: black, numberDisc: [yellow, black],
    };
  },
};

async function playerAtlas() {
  const img = await loadImg('assets/paint/raco-44-iracing-scheme.jpg');
  const c = canvas(ATLAS, ATLAS), x = c.getContext('2d');
  x.fillStyle = '#0b0b0e'; x.fillRect(0, 0, ATLAS, ATLAS);
  if (img) x.drawImage(img, 0, 0, ATLAS, ATLAS);
  return { canvas: c, chassis: '#e2b862', roof: '#0e0e10', rim: '#d9dde0', number: '#ffffff', numberOutline: '#0b0b0e', numberShadow: '#e2b862', helmet: '#f2cf7e', coverLeft: true };
}

// number decals (like iRacing's number layer)
function numberTexture(num, fill, outline, shadow, disc) {
  const c = canvas(320, 180), x = c.getContext('2d');
  if (disc) {
    x.fillStyle = disc[0]; x.strokeStyle = disc[1] || '#111'; x.lineWidth = 8;
    x.beginPath(); x.ellipse(160, 90, 150, 84, 0, 0, Math.PI * 2); x.fill(); x.stroke();
  }
  x.font = 'italic 900 140px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif';
  x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
  if (shadow) { x.lineWidth = 30; x.strokeStyle = shadow; x.strokeText(num, 166, 96, 290); }
  x.lineWidth = 16; x.strokeStyle = outline; x.strokeText(num, 160, 92, 290);
  x.fillStyle = fill; x.fillText(num, 160, 92, 290);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
function numberPlanes(tailSides = true) {
  const parts = [];
  const mk = (w, h, pos, rot) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h));
    m.rotation.order = 'YXZ';
    m.rotation.set(...rot); m.position.set(...pos);
    return m;
  };
  // big number on the nose, readable from the front (like iRacing)
  const n = HOOD(0.12);
  const slope = Math.atan2(HOOD(0.2).top - HOOD(0.04).top, HOOD(0.04).z - HOOD(0.2).z);
  parts.push(mk(0.4, 0.23, [0, n.top + 0.006, n.z], [-Math.PI / 2 + slope, 0, 0]));
  // tail sides, high up where they clear the rear tires
  const tm = TAIL(0.42), hh = 0.62;
  const sx = lerp(tm.wb, tm.wt, hh) + 0.006, y = lerp(tm.bot, tm.top - tm.rr, hh);
  const tilt = Math.atan2(tm.wb - tm.wt, tm.top - tm.rr - tm.bot);
  if (tailSides) {
    parts.push(mk(0.46, 0.26, [LEFT * sx, y, tm.z], [-tilt, Math.PI / 2, 0]));
    parts.push(mk(0.46, 0.26, [RIGHT * sx, y, tm.z], [-tilt, -Math.PI / 2, 0]));
  }
  // top of the tail, readable from behind
  const tt = TAIL(0.5);
  parts.push(mk(0.26, 0.15, [0, tt.top + 0.004, tt.z], [-Math.PI / 2 + 0.12, Math.PI, 0]));
  return merge(parts);
}

// ---------------- chassis, cage, running gear ----------------
function chassisParts(liv) {
  const black = [], chrome = [], r = 0.022;
  // cage: tall, with long front bars leaning forward onto the hood
  const yTf = 1.58, yTr = 1.64, zTf = -0.02, zTr = -0.64, xt = 0.25;
  for (const s of [LEFT, RIGHT]) {
    black.push(pipe([[s * 0.29, 0.9, 0.62], [s * 0.27, 1.25, 0.27], [s * xt, yTf - 0.04, zTf + 0.06], [s * xt * 0.96, yTf, zTf - 0.06]], r));
    black.push(pipe([[s * 0.31, 1.04, 0.1], [s * 0.29, 1.3, 0.04], [s * xt, yTf - 0.02, zTf]], r * 0.9));
    black.push(pipe([[s * xt * 0.96, yTf, zTf - 0.06], [s * xt, yTr - 0.01, zTr + 0.12], [s * xt, yTr - 0.06, zTr], [s * 0.27, 1.3, zTr - 0.04], [s * 0.29, 1.05, zTr - 0.02]], r));
    black.push(tube([s * 0.3, 1.12, zTr], [s * 0.31, 1.06, 0.1], r * 0.85)); // arm bar
    black.push(tube([s * 0.29, 1.2, zTr], [s * 0.27, 1.4, 0.0], r * 0.8));  // diagonal
    // frame rails
    black.push(pipe([[s * 0.17, 0.3, 1.62], [s * 0.26, 0.3, 0.9], [s * 0.3, 0.31, 0.1], [s * 0.3, 0.38, -0.7], [s * 0.26, 0.55, -1.5]], r * 1.25));
    // front torsion arms + shock
    black.push(tube([s * 0.2, 0.34, 1.3], [s * 0.66, 0.31, 1.07], r * 0.9));
    black.push(tube([s * 0.2, 0.48, 1.3], [s * 0.6, 0.36, 1.07], r * 0.7));
    black.push(tube([s * 0.24, 0.66, 1.2], [s * 0.36, 0.32, 1.12], r * 1.6));
    // rear torsion arms + shocks
    black.push(tube([s * 0.28, 0.42, -0.62], [s * 0.6, 0.45, -1.06], r * 0.9));
    black.push(tube([s * 0.28, 0.66, -0.95], [s * 0.5, 0.46, -1.06], r * 1.6));
    // chrome nerf bars: two-tier loop between the wheels
    chrome.push(pipe([[s * 0.3, 0.33, 0.66], [s * 0.7, 0.36, 0.52], [s * 0.98, 0.4, 0.28], [s * 1.0, 0.43, -0.3], [s * 0.82, 0.42, -0.56], [s * 0.32, 0.4, -0.66]], r * 1.15));
    chrome.push(pipe([[s * 0.62, 0.36, 0.48], [s * 0.86, 0.56, 0.18], [s * 0.88, 0.58, -0.3], [s * 0.7, 0.42, -0.54]], r));
    chrome.push(tube([s * 0.98, 0.4, 0.06], [s * 0.87, 0.57, 0.0], r * 0.8));
  }
  black.push(tube([xt * 0.96, yTf, zTf - 0.06], [-xt * 0.96, yTf, zTf - 0.06], r));
  black.push(tube([xt, yTr - 0.06, zTr], [-xt, yTr - 0.06, zTr], r));
  black.push(tube([0.29, 1.05, zTr - 0.02], [-0.29, 1.05, zTr - 0.02], r));
  black.push(tube([0.72, 0.31, 1.07], [-0.72, 0.31, 1.07], r * 1.7));    // front axle
  black.push(tube([0.24, 0.48, 1.3], [-0.24, 0.48, 1.3], r * 1.6));      // front torsion tube
  black.push(tube([0.6, 0.45, -1.06], [-0.6, 0.45, -1.06], r * 2.6));    // rear axle housing
  black.push(tube([0.32, 0.6, -0.95], [-0.32, 0.6, -0.95], r * 1.6));    // rear torsion tube
  // chrome front bumper and rear bumper
  chrome.push(pipe([[0.16, 0.32, 1.6], [0.22, 0.38, 1.85], [0.12, 0.44, 1.95], [-0.12, 0.44, 1.95], [-0.22, 0.38, 1.85], [-0.16, 0.32, 1.6]], r));
  chrome.push(pipe([[0.26, 0.56, -1.5], [0.36, 0.62, -1.76], [0.2, 0.7, -1.88], [-0.2, 0.7, -1.88], [-0.36, 0.62, -1.76], [-0.26, 0.56, -1.5]], r));
  chrome.push(pipe([[0.36, 0.62, -1.76], [0.33, 0.86, -1.7], [0.2, 0.92, -1.63]], r * 0.9));
  chrome.push(pipe(mirror([[0.36, 0.62, -1.76], [0.33, 0.86, -1.7], [0.2, 0.92, -1.63]]), r * 0.9));
  // headers: four pipes out of the right side of the block, along the frame to a collector
  for (let i = 0; i < 4; i++) {
    const z0 = 1.0 - i * 0.13;
    chrome.push(pipe([[RIGHT * 0.2, 0.55, z0], [RIGHT * 0.34, 0.52, z0 - 0.06], [RIGHT * 0.42, 0.44, z0 - 0.3], [RIGHT * 0.42, 0.41, 0.1 - i * 0.02]], 0.026, false, 6));
  }
  chrome.push(pipe([[RIGHT * 0.42, 0.41, 0.12], [RIGHT * 0.42, 0.4, -0.4], [RIGHT * 0.46, 0.42, -0.8]], 0.06));
  // roof panel over the cage (seen across the top of the in-car view)
  const roofGeo = panel(6, 6, (u, v) => {
    const z = lerp(0.06, -0.7, u), sx = v * 2 - 1;
    const y = lerp(1.6, 1.665, u) + 0.03 * (1 - sx * sx) - (u < 0.1 ? (0.1 - u) * 0.6 : 0);
    return [-sx * lerp(0.28, 0.27, u), y, z];
  }, [0, 0, 1, 1], () => [0, 0]);
  const roof = new THREE.Mesh(roofGeo, new THREE.MeshPhongMaterial({ color: liv.roof, shininess: 60, side: THREE.DoubleSide }));
  const blackMat = new THREE.MeshPhongMaterial({ color: liv.chassis, shininess: 40, specular: '#444444' });
  const chromeMat = new THREE.MeshPhongMaterial({ color: '#c9ced3', shininess: 120, specular: '#ffffff' });
  return [new THREE.Mesh(merge(black), blackMat), new THREE.Mesh(merge(chrome), chromeMat), roof];
}

function engine() {
  const g = new THREE.Group();
  const m = new THREE.MeshPhongMaterial({ color: '#3a3d40', shininess: 50 });
  const block = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.3, 0.68), m);
  block.position.set(0, 0.48, 0.75); g.add(block);
  const valve = new THREE.MeshPhongMaterial({ color: '#8c9196', shininess: 90 });
  for (const s of [LEFT, RIGHT]) {
    const v = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.08, 0.6), valve);
    v.position.set(s * 0.15, 0.66, 0.75); v.rotation.z = -s * 0.5; g.add(v);
  }
  const pan = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.1, 0.6), m);
  pan.position.set(0, 0.3, 0.72); g.add(pan);
  return g;
}

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
  const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.52, 0.32), _screenMat);
  scr.position.set(LEFT * 0.295, 1.3, -0.3); scr.rotation.y = Math.PI / 2;
  g.add(scr);
  const alu = new THREE.MeshPhongMaterial({ color: '#b9bec2', shininess: 70 });
  const seat = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.62, 0.06), alu);
  seat.position.set(0, 1.0, -0.6); seat.rotation.x = 0.18; g.add(seat);
  const head = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.22, 0.2), alu);
  head.position.set(RIGHT * 0.16, 1.33, -0.5); g.add(head);
  const floor = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.04, 0.74), new THREE.MeshLambertMaterial({ color: '#202020' }));
  floor.position.set(0, 0.34, -0.26); g.add(floor);
  // driver's body (hidden in the cockpit view so it doesn't block the screen)
  const suit = new THREE.MeshPhongMaterial({ color: '#e9e9e9', shininess: 20 });
  const torso = new THREE.Group();
  g.add(torso);
  const chest = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.18, 0.4, 10), suit);
  chest.position.set(0, 1.04, -0.47); chest.rotation.x = 0.2; torso.add(chest);
  for (const s of [LEFT, RIGHT]) {
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.04, 0.42, 6), suit);
    arm.position.set(s * 0.16, 1.02, -0.26); arm.rotation.x = Math.PI / 2 - 0.5; torso.add(arm);
  }
  const helmet = new THREE.Group();
  helmet.add(new THREE.Mesh(new THREE.SphereGeometry(0.142, 18, 14), new THREE.MeshPhongMaterial({ color: helmetColor, shininess: 110, specular: '#888888' })));
  helmet.add(new THREE.Mesh(new THREE.SphereGeometry(0.146, 16, 8, Math.PI / 2 - 0.8, 1.6, 1.3, 0.5), new THREE.MeshPhongMaterial({ color: '#0b0b0b', shininess: 140, specular: '#ffffff' })));
  helmet.position.set(0, 1.33, -0.38);
  g.add(helmet);
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.016, 6, 18), new THREE.MeshLambertMaterial({ color: '#141414' }));
  sw.position.set(0, 0.97, -0.1); sw.rotation.x = -0.55; g.add(sw);
  return { group: g, helmet, torso };
}

// ---------------- wheels ----------------
let _tireMat;
function tireMat() {
  if (_tireMat) return _tireMat;
  // u = around the tire, v = across the profile (sidewall -> tread -> sidewall)
  const c = canvas(512, 128), x = c.getContext('2d');
  x.fillStyle = '#76604f'; x.fillRect(0, 0, 512, 128);           // clay-dusted rubber
  x.fillStyle = '#6a4f3c'; x.fillRect(0, 38, 512, 52);           // tread band
  x.strokeStyle = 'rgba(30,22,17,0.85)'; x.lineWidth = 1.5;        // circumferential grooves
  for (let y = 42; y < 88; y += 4.5) { x.beginPath(); x.moveTo(0, y); x.lineTo(512, y); x.stroke(); }
  for (let i = 0; i < 900; i++) {
    x.fillStyle = `rgba(${150 + Math.random() * 50},${90 + Math.random() * 35},${50 + Math.random() * 20},${0.1 + Math.random() * 0.25})`;
    x.fillRect(Math.random() * 512, Math.random() * 128, 2 + Math.random() * 8, 1 + Math.random() * 3);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping;
  return (_tireMat = new THREE.MeshLambertMaterial({ map: t }));
}
let _rimMat, _rimDark;
function rimMats() {
  if (!_rimMat) {
    _rimMat = new THREE.MeshPhongMaterial({ color: '#d4d8dc', shininess: 130, specular: '#ffffff', side: THREE.DoubleSide });
    _rimDark = new THREE.MeshPhongMaterial({ color: '#2a2a2a', shininess: 60, side: THREE.DoubleSide });
  }
  return [_rimMat, _rimDark];
}

const _wheelGeo = {};
function tireGeo(R, Ri, w) {
  const k = `${R}_${Ri}_${w}`;
  if (_wheelGeo[k]) return _wheelGeo[k];
  const sh = Math.min(0.06, w * 0.18);
  const prof = [];
  const add = (r, y) => prof.push(new THREE.Vector2(r, y));
  add(Ri, -w / 2 + 0.01);
  add(Ri + (R - Ri) * 0.55, -w / 2 - 0.012);
  for (let i = 0; i <= 4; i++) { const a = (i / 4) * Math.PI / 2; add(R - sh + Math.sin(a) * sh, -w / 2 + sh - Math.cos(a) * sh); }
  for (let i = 0; i <= 4; i++) { const a = (i / 4) * Math.PI / 2; add(R - sh + Math.cos(a) * sh, w / 2 - sh + Math.sin(a) * sh); }
  add(Ri + (R - Ri) * 0.55, w / 2 + 0.012);
  add(Ri, w / 2 - 0.01);
  const g = new THREE.LatheGeometry(prof, 28);
  g.rotateZ(Math.PI / 2);
  return (_wheelGeo[k] = g);
}
function rimGeo(Ri, w, dish) {
  const k = `rim_${Ri}_${w}_${dish}`;
  if (_wheelGeo[k]) return _wheelGeo[k];
  const prof = [
    new THREE.Vector2(0.001, dish), new THREE.Vector2(Ri * 0.3, dish), new THREE.Vector2(Ri * 0.45, dish * 0.6),
    new THREE.Vector2(Ri * 0.8, -w * 0.1), new THREE.Vector2(Ri * 0.98, -w * 0.42), new THREE.Vector2(Ri * 1.05, -w / 2),
    new THREE.Vector2(Ri, w / 2 - 0.01), new THREE.Vector2(Ri * 1.06, w / 2),
  ];
  const g = new THREE.LatheGeometry(prof, 24);
  g.rotateZ(Math.PI / 2);
  return (_wheelGeo[k] = g);
}

function coverDisc(radius, rect) {
  const g = new THREE.CircleGeometry(radius, 28);
  const uv = g.attributes.uv;
  const [x0, y0, x1, y1] = rect;
  for (let i = 0; i < uv.count; i++) {
    const a = uv.getX(i), b = 1 - uv.getY(i);
    uv.setXY(i, (x0 + a * (x1 - x0)) / ATLAS, 1 - (y0 + b * (y1 - y0)) / ATLAS);
  }
  return g;
}

function wheel(R, Ri, w, side, atlasMat, coverRect) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(tireGeo(R, Ri, w), tireMat());
  g.add(tire);
  const [rimM, darkM] = rimMats();
  // rim: the outside face is dished; side = +1 left, -1 right
  const rim = new THREE.Mesh(rimGeo(Ri, w, -0.04), rimM);
  rim.scale.x = side; // dish faces outward on either side
  g.add(rim);
  const hub = new THREE.Mesh(new THREE.CylinderGeometry(Ri * 0.22, Ri * 0.22, 0.1, 10), darkM);
  hub.rotation.z = Math.PI / 2; hub.position.x = side * 0.0;
  g.add(hub);
  if (coverRect) {
    const cov = new THREE.Mesh(coverDisc(Ri * 1.02, coverRect), atlasMat);
    cov.position.x = side * (w / 2 + 0.004); cov.rotation.y = side * Math.PI / 2;
    g.add(cov);
  }
  return g;
}

// ---------------- assemble ----------------
let _bodyGeo, _numGeo, _numGeoNoTail;
export async function buildSprintCar(drv) {
  const liv = drv.isPlayer ? await playerAtlas() : aiAtlas(drv);
  const atlasMat = new THREE.MeshPhongMaterial({ map: atlasTexture(liv.canvas), side: THREE.DoubleSide, shininess: 90, specular: '#444444' });

  const car = new THREE.Group();
  const body = new THREE.Group();
  car.add(body);
  _bodyGeo = _bodyGeo || buildBodyGeometry();
  body.add(new THREE.Mesh(_bodyGeo, atlasMat));

  _numGeo = _numGeo || numberPlanes();
  _numGeoNoTail = _numGeoNoTail || numberPlanes(false);
  body.add(new THREE.Mesh(liv.paintedTailNumbers ? _numGeoNoTail : _numGeo, new THREE.MeshPhongMaterial({
    map: numberTexture(drv.number, liv.number, liv.numberOutline, liv.numberShadow, liv.numberDisc), shininess: 90,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2,
  })));

  chassisParts(liv).forEach((m) => body.add(m));
  body.add(engine());
  // name plate across the front of the cage
  body.add(new THREE.Mesh(panel(1, 1, (u, v) => [(v * 2 - 1) * 0.23, 1.52 + u * 0.08, 0.0 - u * 0.04], PAINT_REGIONS.namePlate, (u, v) => [1 - u, 1 - v]), atlasMat));
  const interior = cockpitInterior(liv.helmet);
  body.add(interior.group);

  // wheels: big staggered rears, narrow fronts
  const wheels = {};
  const fl = new THREE.Group(), fr = new THREE.Group();
  fl.position.set(LEFT * 0.8, 0.3, 1.07);
  fr.position.set(RIGHT * 0.8, 0.3, 1.07);
  wheels.fl = wheel(0.3, 0.19, 0.2, LEFT, atlasMat, liv.coverLeft ? PAINT_REGIONS.wheelFront : null); fl.add(wheels.fl);
  wheels.fr = wheel(0.3, 0.19, 0.22, RIGHT, atlasMat, null); fr.add(wheels.fr);
  car.add(fl, fr);
  wheels.rl = wheel(0.43, 0.2, 0.36, LEFT, atlasMat, liv.coverLeft ? PAINT_REGIONS.wheelRear : null); wheels.rl.position.set(LEFT * 0.82, 0.43, -1.06);
  wheels.rr = wheel(0.455, 0.2, 0.44, RIGHT, atlasMat, null); wheels.rr.position.set(RIGHT * 0.88, 0.455, -1.06);
  car.add(wheels.rl, wheels.rr);

  car.traverse((o) => { if (o.isMesh) o.castShadow = true; });

  const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 4.3), shadowMat());
  sh.rotation.x = -Math.PI / 2;
  sh.position.y = 0.03;
  sh.renderOrder = 1;
  sh.castShadow = false;
  car.add(sh);

  car.userData = { wheels, steerL: fl, steerR: fr, helmet: interior.helmet, shoulders: interior.torso, body };
  return car;
}

let _shadowMat;
function shadowMat() {
  if (_shadowMat) return _shadowMat;
  const c = canvas(64, 128), x = c.getContext('2d');
  const g = x.createRadialGradient(32, 64, 4, 32, 64, 60);
  g.addColorStop(0, 'rgba(0,0,0,0.45)'); g.addColorStop(1, 'rgba(0,0,0,0)');
  x.fillStyle = g; x.fillRect(0, 0, 64, 128);
  _shadowMat = new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(c), transparent: true, depthWrite: false });
  return _shadowMat;
}

export function poseCar(car, steer, wheelSpinRear, wheelSpinFront) {
  const u = car.userData;
  u.steerL.rotation.y = -steer;
  u.steerR.rotation.y = -steer;
  u.wheels.fl.rotation.x = wheelSpinFront;
  u.wheels.fr.rotation.x = wheelSpinFront;
  u.wheels.rl.rotation.x = wheelSpinRear;
  u.wheels.rr.rotation.x = wheelSpinRear * 0.95;
}
