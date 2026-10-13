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
const clamp01 = (t) => (t < 0 ? 0 : t > 1 ? 1 : t);
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
// cockpit sides: low up front, then the tall arm-guard panels beside the driver
// rise toward the cage roof at the back (where the sponsor stacks go on real cars)
const COCK_TOP = 1.56;
const COCK = (t) => {
  const r = ease(clamp01((t - 0.45) / 0.3));
  return { z: lerp(0.1, -0.62, t), bot: 0.34, top: lerp(1.02, 1.06, t) + 0.5 * r, wb: 0.33, wt: lerp(0.31, 0.275, r) };
};
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
  // cockpit sides (paint panel is rotated 90 degrees). The paint maps by height
  // above the bottom edge, so lettering stays level where the panel rises: the
  // low front part shows the bottom of the paint, the tall back part all of it.
  const cockV = (u, h) => { const c = COCK(u); return (lerp(c.bot, c.top, h) - c.bot) / (COCK_TOP - c.bot); };
  parts.push(panel(16, 6, sideFn(COCK, LEFT), R.cockpitL, (u, h) => [1 - cockV(u, h), 1 - u]));
  parts.push(panel(16, 6, sideFn(COCK, RIGHT), R.cockpitR, (u, h) => [1 - cockV(u, h), u]));
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
  // #77 Todd Hobson: black carbon car with a big STIHL-orange panel and white
  // STIHL, gray slashes low, MBL Transport, Wingo; black wheels with white MB
  // logo mud covers on the left side
  hobson77(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const black = '#121315', carbon = '#1d1f23', orange = '#f37a1f', gray = '#5b6066', white = '#f6f6f4';
    x.fillStyle = carbon; x.fillRect(0, 0, S, S);
    // faint carbon weave
    x.strokeStyle = 'rgba(255,255,255,0.035)'; x.lineWidth = 2;
    for (let i = -S; i < S; i += 10) { x.beginPath(); x.moveTo(i, 0); x.lineTo(i + S, S); x.stroke(); }
    const txt = (t, px, py, size, color, opt = {}) => {
      x.font = `${opt.italic ? 'italic ' : ''}${opt.weight || 900} ${Math.floor(size)}px ${opt.font || '"Arial Black", Arial, sans-serif'}`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      if (opt.stroke) { x.lineWidth = size * (opt.sw || 0.16); x.strokeStyle = opt.stroke; x.strokeText(t, px, py, opt.maxW); }
      x.fillStyle = color; x.fillText(t, px, py, opt.maxW);
    };
    // hood sides: the orange STIHL panel with an angled front edge, gray slashes low
    const hoodSide = (w, h, rr) => {
      x.save(); if (!rr) { x.translate(w, 0); x.scale(-1, 1); }
      x.fillStyle = orange;
      x.beginPath(); x.moveTo(w * 0.22, h * 0.08); x.lineTo(w, h * 0.08); x.lineTo(w, h * 0.68); x.lineTo(w * 0.32, h * 0.68); x.lineTo(w * 0.12, h * 0.4); x.fill();
      x.fillStyle = gray;
      x.beginPath(); x.moveTo(w * 0.3, h * 0.98); x.lineTo(w * 0.55, h * 0.74); x.lineTo(w * 0.6, h * 0.74); x.lineTo(w * 0.36, h * 0.98); x.fill();
      x.beginPath(); x.moveTo(w * 0.4, h * 0.98); x.lineTo(w * 0.65, h * 0.74); x.lineTo(w * 0.68, h * 0.74); x.lineTo(w * 0.44, h * 0.98); x.fill();
      x.restore();
      txt('STIHL', rr ? w * 0.64 : w * 0.36, h * 0.38, h * 0.56, white, { italic: true, maxW: w * 0.66 });
      txt('WINGO', rr ? w * 0.78 : w * 0.22, h * 0.84, h * 0.09, white, { italic: true, maxW: w * 0.16 });
      txt('VANDER', rr ? w * 0.25 : w * 0.75, h * 0.86, h * 0.07, white, { italic: true, maxW: w * 0.14 });
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    const noseSide = (w, h) => { x.fillStyle = orange; x.fillRect(0, 0, w, h * 0.08); };
    P.flat(R.noseSideL, true, noseSide); P.flat(R.noseSideR, false, noseSide);
    // cockpit sides (x = 0 is the back): sponsor stack on the tall panel,
    // the orange panel carries on up front
    const cockSide = (w, h) => {
      x.fillStyle = orange; x.fillRect(w * 0.4, h * 0.5, w * 0.6, h * 0.38);
      x.fillStyle = black; x.fillRect(w * 0.4, h * 0.88, w * 0.6, h * 0.12);
      const list = [['WBR', 0.1], ['MUSTANG', 0.19], ['SUPPLY', 0.28], ['JST', 0.37], ['CSI', 0.46]];
      for (const [t, fy] of list) txt(t, w * 0.15, h * fy, h * 0.06, white, { italic: true, maxW: w * 0.26 });
      txt('HOBSON', w * 0.62, h * 0.43, h * 0.07, white, { italic: true, maxW: w * 0.4 });
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail sides: orange MBL Transport panel up front, white 77 outlined orange
    const tailSide = (w, h, rr) => {
      const fx = rr ? 0 : w * 0.62;
      x.fillStyle = orange; x.fillRect(fx, h * 0.2, w * 0.38, h * 0.18);
      txt('MBL TRANSPORT', fx + w * 0.19, h * 0.29, h * 0.09, white, { italic: true, maxW: w * 0.34 });
      txt('77', rr ? w * 0.6 : w * 0.48, h * 0.55, h * 0.42, white, { italic: true, stroke: orange, sw: 0.12, maxW: w * 0.32 });
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    P.flat(R.tailTop, true, (w, h) => { x.fillStyle = orange; x.fillRect(w * 0.45, 0, w * 0.1, h); });
    P.flat(R.hoodTop, true, (w, h) => { x.fillStyle = orange; x.fillRect(w * 0.55, 0, w * 0.45, h * 0.08); x.fillRect(w * 0.55, h * 0.92, w * 0.45, h * 0.08); });
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = orange; x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      txt('HOBSON', 0, 0, w * 0.6, white, { italic: true, maxW: h * 0.85 });
      x.restore();
    });
    // MB logo mud covers (left-side wheels)
    const cover = (r) => P.flat(r, true, (w, h) => {
      x.fillStyle = black; x.fillRect(0, 0, w, h);
      const cx = w / 2, cy = h / 2, s = Math.min(w, h) * 0.32;
      x.fillStyle = '#c9a646';
      for (let i = 0; i < 18; i++) { const a = (i / 18) * Math.PI * 2; x.beginPath(); x.arc(cx + Math.cos(a) * s * 1.35, cy + Math.sin(a) * s * 1.35, s * 0.05, 0, 7); x.fill(); }
      x.save(); x.translate(cx, cy); x.rotate(Math.PI); txt('MB', 0, 0, s * 0.95, white, { maxW: s * 1.8 }); x.restore(); // the cover disc maps upside down
    });
    cover(R.wheelRear); cover(R.wheelFront);
    return {
      canvas: c, chassis: '#141414', roof: black, rim: '#1c1c1c', rimColor: '#1a1a1a', helmet: orange, coverLeft: true,
      number: white, numberOutline: orange, numberShadow: black, paintedTailNumbers: true,
    };
  },

  // #41 Ricky Lewis: white over black with red and black slashes, Morris Farms
  // (with the tractor) on the hood, Mesilla Valley Transportation on the
  // cockpit, Freedom Roofing atop the tall panel, white 41 outlined red on the
  // black tail, black chassis and wheels
  lewis41(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const white = '#f4f4f2', black = '#131313', red = '#e0242c';
    x.fillStyle = white; x.fillRect(0, 0, S, S);
    const txt = (t, px, py, size, color, opt = {}) => {
      x.font = `${opt.italic ? 'italic ' : ''}${opt.weight || 900} ${Math.floor(size)}px ${opt.font || '"Arial Black", Arial, sans-serif'}`;
      x.textAlign = opt.align || 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      if (opt.stroke) { x.lineWidth = size * (opt.sw || 0.16); x.strokeStyle = opt.stroke; x.strokeText(t, px, py, opt.maxW); }
      x.fillStyle = color; x.fillText(t, px, py, opt.maxW);
    };
    const script = '"Snell Roundhand", "Brush Script MT", cursive';
    // simple tractor silhouette
    const tractor = (cx, cy, s) => {
      x.fillStyle = black;
      x.fillRect(cx - s * 0.5, cy - s * 0.25, s * 0.7, s * 0.25);
      x.fillRect(cx - s * 0.05, cy - s * 0.65, s * 0.35, s * 0.45);
      x.fillStyle = white; x.fillRect(cx + s * 0.02, cy - s * 0.58, s * 0.21, s * 0.2);
      x.fillStyle = black; x.fillRect(cx - s * 0.4, cy - s * 0.55, s * 0.05, s * 0.32);
      for (const [wx, wr] of [[-s * 0.36, s * 0.17], [s * 0.18, s * 0.28]]) {
        x.beginPath(); x.arc(cx + wx, cy + s * 0.05, wr, 0, 7); x.fill();
        x.fillStyle = white; x.beginPath(); x.arc(cx + wx, cy + s * 0.05, wr * 0.45, 0, 7); x.fill(); x.fillStyle = black;
      }
    };
    // hood sides: white top, black bottom, red/black slashes, Morris Farms
    const hoodSide = (w, h, rr) => {
      const f = (v) => (rr ? w * v : w * (1 - v));
      x.fillStyle = black; x.fillRect(0, h * 0.74, w, h * 0.26);
      x.fillStyle = black; x.beginPath(); x.moveTo(f(0.84), h * 0.74); x.lineTo(f(0.92), h * 0.5); x.lineTo(f(0.95), h * 0.5); x.lineTo(f(0.88), h * 0.74); x.fill();
      x.fillStyle = red; x.beginPath(); x.moveTo(f(0.9), h * 0.74); x.lineTo(f(0.98), h * 0.46); x.lineTo(f(1), h * 0.46); x.lineTo(f(0.93), h * 0.74); x.fill();
      txt('MORRIS', f(0.44), h * 0.22, h * 0.28, red, { stroke: black, sw: 0.07, maxW: w * 0.4 });
      txt('Farms', f(0.4), h * 0.52, h * 0.42, black, { italic: true, weight: 700, font: script, maxW: w * 0.36 });
      tractor(f(0.7), h * 0.5, h * 0.48);
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    const noseSide = (w, h) => { x.fillStyle = black; x.fillRect(0, h * 0.6, w, h * 0.4); };
    P.flat(R.noseSideL, true, noseSide); P.flat(R.noseSideR, false, noseSide);
    P.flat(R.noseFront, true, (w, h) => { x.fillStyle = black; x.fillRect(0, 0, w, h); });
    // cockpit sides (x = 0 is the back): tall panel with Freedom Roofing up top,
    // red/black stripe and the sponsor stack; Mesilla Valley up front
    const cockSide = (w, h) => {
      x.fillStyle = black; x.fillRect(0, h * 0.86, w, h * 0.14);
      x.fillStyle = red; x.beginPath(); x.moveTo(0, h * 0.3); x.lineTo(w * 0.32, h * 0.26); x.lineTo(w * 0.32, h * 0.31); x.lineTo(0, h * 0.35); x.fill();
      x.fillStyle = black; x.beginPath(); x.moveTo(0, h * 0.36); x.lineTo(w * 0.32, h * 0.32); x.lineTo(w * 0.32, h * 0.4); x.lineTo(0, h * 0.44); x.fill();
      txt('FREEDOM', w * 0.16, h * 0.08, h * 0.08, red, { stroke: black, sw: 0.1, maxW: w * 0.28 });
      txt('ROOFING', w * 0.16, h * 0.16, h * 0.05, black, { maxW: w * 0.24 });
      const list = [['DRC', 0.5], ['KEIZER', 0.58], ['SIDEWAZE', 0.66], ['P1', 0.74]];
      for (const [t, fy] of list) txt(t, w * 0.15, h * fy, h * 0.055, black, { italic: true, maxW: w * 0.26 });
      x.fillStyle = red; x.beginPath(); x.moveTo(w * 0.42, h * 0.5); x.lineTo(w * 0.5, h * 0.5); x.lineTo(w * 0.47, h * 0.8); x.lineTo(w * 0.39, h * 0.8); x.fill();
      txt('MESILLA', w * 0.53, h * 0.56, h * 0.07, black, { align: 'left', maxW: w * 0.4 });
      txt('VALLEY', w * 0.53, h * 0.65, h * 0.07, black, { align: 'left', maxW: w * 0.4 });
      txt('TRANSPORTATION', w * 0.45, h * 0.76, h * 0.065, black, { align: 'left', maxW: w * 0.52 });
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail: black, with the white 41 outlined red
    const tailSide = (w, h, rr) => {
      x.fillStyle = black; x.fillRect(0, 0, w, h);
      txt('41', rr ? w * 0.6 : w * 0.48, h * 0.5, h * 0.44, white, { italic: true, stroke: red, sw: 0.12, maxW: w * 0.3 });
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    P.flat(R.tailTop, true, (w, h) => { x.fillStyle = black; x.fillRect(0, 0, w, h); x.fillStyle = red; x.fillRect(w * 0.47, 0, w * 0.06, h); });
    P.flat(R.tailRear, true, (w, h) => { x.fillStyle = black; x.fillRect(0, 0, w, h); });
    P.flat(R.hoodTop, true, (w, h) => { x.fillStyle = black; x.fillRect(0, 0, w * 0.2, h); x.fillStyle = red; x.fillRect(w * 0.2, 0, w * 0.015, h); });
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = black; x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      txt('LEWIS', 0, 0, w * 0.6, white, { stroke: red, sw: 0.08, maxW: h * 0.85 });
      x.restore();
    });
    for (let i = 0; i < 350; i++) { x.fillStyle = `rgba(120,95,70,${0.05 + Math.random() * 0.12})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 3 + 0.4, 0, 7); x.fill(); }
    return {
      canvas: c, chassis: '#141414', roof: white, rim: '#1c1c1c', rimColor: '#1a1a1a', helmet: red, coverLeft: false,
      number: white, numberOutline: red, numberShadow: black, paintedTailNumbers: true,
    };
  },

  // #98 Saban Bibent: white car, royal blue over the top of the tail with an
  // orange slash, giant orange 98 outlined blue, orange Epoxy Systems
  // International, Bibent Lawn Care diamond badge on the tall cockpit panel
  bibent98(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const white = '#f3f3f1', blue = '#2b3fd1', orange = '#ff5a14', black = '#151515';
    x.fillStyle = white; x.fillRect(0, 0, S, S);
    const txt = (t, px, py, size, color, opt = {}) => {
      x.font = `${opt.italic ? 'italic ' : ''}${opt.weight || 900} ${Math.floor(size)}px ${opt.font || '"Arial Black", Arial, sans-serif'}`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      if (opt.stroke) { x.lineWidth = size * (opt.sw || 0.16); x.strokeStyle = opt.stroke; x.strokeText(t, px, py, opt.maxW); }
      x.fillStyle = color; x.fillText(t, px, py, opt.maxW);
    };
    // Bibent Lawn Care: blue diamond with an orange stripe
    const bibent = (cx, cy, s) => {
      x.save(); x.translate(cx, cy);
      x.fillStyle = blue; x.beginPath(); x.moveTo(0, -s); x.lineTo(s * 0.8, 0); x.lineTo(0, s); x.lineTo(-s * 0.8, 0); x.fill();
      x.fillStyle = orange; x.beginPath(); x.moveTo(-s * 0.55, -s * 0.31); x.lineTo(s * 0.55, -s * 0.31); x.lineTo(s * 0.45, -s * 0.2); x.lineTo(-s * 0.45, -s * 0.2); x.fill();
      txt('BIBENT', 0, s * 0.02, s * 0.32, white, { maxW: s * 1.25 });
      txt('LAWN CARE', 0, s * 0.3, s * 0.14, orange, { weight: 800, maxW: s * 0.9 });
      x.restore();
    };
    const epoxy = (cx, cy, s, maxW) => {
      txt('EPOXY', cx, cy, s, orange, { italic: true, stroke: blue, sw: 0.08, maxW });
      txt('SYSTEMS INTERNATIONAL', cx, cy + s * 0.7, s * 0.3, orange, { weight: 800, maxW });
    };
    const hoodSide = (w, h, rr) => {
      epoxy(rr ? w * 0.68 : w * 0.32, h * 0.38, h * 0.32, w * 0.42);
      const lows = [['K&N', 0.88], ['HOOSIER', 0.7], ['FLORACING', 0.5], ['NOS', 0.32]];
      for (const [t, f] of lows) txt(t, rr ? w * f : w * (1 - f), h * 0.86, h * 0.07, black, { weight: 800, maxW: w * 0.14 });
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    P.flat(R.noseSideL, true, () => {}); P.flat(R.noseSideR, false, () => {});
    // cockpit sides (x = 0 is the back): the tall panel with the sponsor stack
    const cockSide = (w, h) => {
      txt('SIGNS BY TREY', w * 0.14, h * 0.1, h * 0.05, blue, { maxW: w * 0.24 });
      txt('NATURE CALLS', w * 0.14, h * 0.19, h * 0.05, orange, { maxW: w * 0.24 });
      bibent(w * 0.18, h * 0.42, h * 0.16);
      epoxy(w * 0.66, h * 0.62, h * 0.12, w * 0.5);
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail sides: blue sweep over the top, orange slash, giant 98
    const tailSide = (w, h, rr) => {
      x.save(); if (!rr) { x.translate(w, 0); x.scale(-1, 1); }
      x.fillStyle = blue;
      x.beginPath(); x.moveTo(0, 0); x.lineTo(w, 0); x.lineTo(w, h * 0.55); x.quadraticCurveTo(w * 0.55, h * 0.3, 0, h * 0.42); x.fill();
      x.fillStyle = orange;
      x.beginPath(); x.moveTo(w * 0.15, 0); x.lineTo(w * 0.42, 0); x.quadraticCurveTo(w * 0.3, h * 0.2, w * 0.2, h * 0.38); x.lineTo(w * 0.05, h * 0.42); x.quadraticCurveTo(w * 0.12, h * 0.2, w * 0.15, 0); x.fill();
      x.restore();
      txt('98', rr ? w * 0.6 : w * 0.48, h * 0.5, h * 0.44, orange, { stroke: blue, sw: 0.14, maxW: w * 0.34 });
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    P.flat(R.tailTop, true, (w, h) => { x.fillStyle = blue; x.fillRect(0, 0, w, h); x.fillStyle = orange; x.fillRect(w * 0.42, 0, w * 0.16, h); });
    P.flat(R.tailRear, true, (w, h) => { x.fillStyle = blue; x.fillRect(0, 0, w, h * 0.45); });
    P.flat(R.hoodTop, true, (w, h) => { x.fillStyle = blue; x.fillRect(0, 0, w * 0.06, h); x.fillRect(w * 0.94, 0, w * 0.06, h); });
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = blue; x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      txt('BIBENT', 0, 0, w * 0.6, white, { stroke: orange, sw: 0.08, maxW: h * 0.85 });
      x.restore();
    });
    for (let i = 0; i < 500; i++) { x.fillStyle = `rgba(120,95,70,${0.06 + Math.random() * 0.14})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 3 + 0.4, 0, 7); x.fill(); }
    return {
      canvas: c, chassis: '#151515', roof: black, rim: '#1c1c1c', rimColor: '#1a1a1a', helmet: orange, coverLeft: false,
      number: orange, numberOutline: blue, numberShadow: white, paintedTailNumbers: true,
    };
  },

  // #34 Shane Cottle: white car with a maroon cage and chassis, double maroon
  // swoosh down the sides, maroon hood scoop, Lucas Oil Products badge, maroon
  // 34 outlined white on the nose, slate-blue COTTLE plate, black wheels
  cottle34(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const white = '#f4f3f0', maroon = '#8c1d3c', dark = '#5a1023', slate = '#3d5b87', black = '#151515';
    x.fillStyle = white; x.fillRect(0, 0, S, S);
    const txt = (t, px, py, size, color, opt = {}) => {
      x.font = `${opt.italic ? 'italic ' : ''}${opt.weight || 900} ${Math.floor(size)}px ${opt.font || '"Arial Black", Arial, sans-serif'}`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      if (opt.stroke) { x.lineWidth = size * (opt.sw || 0.16); x.strokeStyle = opt.stroke; x.strokeText(t, px, py, opt.maxW); }
      x.fillStyle = color; x.fillText(t, px, py, opt.maxW);
    };
    // Lucas Oil Products badge: white shield, blue banner
    const lucas = (cx, cy, s) => {
      x.fillStyle = slate; x.beginPath(); x.roundRect(cx - s, cy - s * 0.5, s * 2, s, s * 0.2); x.fill();
      x.fillStyle = white; x.beginPath(); x.roundRect(cx - s * 0.92, cy - s * 0.42, s * 1.84, s * 0.84, s * 0.16); x.fill();
      txt('LUCAS', cx, cy - s * 0.06, s * 0.42, slate, { italic: true, maxW: s * 1.6 });
      txt('OIL PRODUCTS INC.', cx, cy + s * 0.26, s * 0.15, slate, { weight: 800, maxW: s * 1.6 });
    };
    // two maroon swooshes sweeping down from the cockpit toward the nose
    const swoosh = (w, h, rr, y0) => {
      x.save(); if (!rr) { x.translate(w, 0); x.scale(-1, 1); }
      // high at the back (right), sweeping down toward the front
      for (const [off, col, th] of [[0, maroon, 0.11], [0.15, dark, 0.075]]) {
        x.strokeStyle = col; x.lineWidth = h * th; x.lineCap = 'round';
        x.beginPath(); x.moveTo(w * 1.02, h * (y0 + off)); x.quadraticCurveTo(w * 0.5, h * (y0 + off - 0.02), w * 0.12, h * (y0 + off + 0.52)); x.stroke();
      }
      x.restore();
    };
    const hoodSide = (w, h, rr) => {
      swoosh(w, h, rr, 0.16);
      lucas(rr ? w * 0.2 : w * 0.8, h * 0.3, h * 0.3);
      const lows = [['CHALKSTIX', 0.12], ['WIX', 0.42], ['HOOSIER', 0.62]];
      for (const [t, f] of lows) txt(t, rr ? w * f : w * (1 - f), h * 0.86, h * 0.07, black, { weight: 800, maxW: w * 0.14 });
      x.fillStyle = black; x.fillRect(0, h * 0.94, w, h * 0.06);
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    const noseSide = (w, h) => {
      txt('34', w * 0.5, h * 0.48, h * 0.72, maroon, { stroke: white, sw: 0.1, maxW: w * 0.6 });
    };
    P.flat(R.noseSideL, true, noseSide); P.flat(R.noseSideR, false, noseSide);
    // cockpit sides (x = 0 is the back): sponsor stack on the tall white panel, swoosh low
    const cockSide = (w, h) => {
      const list = [['SRI', 0.12, 0.1], ['SMITH', 0.24, 0.06], ['NOVIX', 0.33, 0.06], ['HOOSIER', 0.42, 0.06]];
      for (const [t, fy, sz] of list) txt(t, w * 0.15, h * fy, h * sz, black, { italic: true, maxW: w * 0.26 });
      x.strokeStyle = maroon; x.lineWidth = h * 0.05;
      x.beginPath(); x.moveTo(w * 0.3, h * 0.62); x.quadraticCurveTo(w * 0.65, h * 0.58, w, h * 0.66); x.stroke();
      x.strokeStyle = dark; x.lineWidth = h * 0.035;
      x.beginPath(); x.moveTo(w * 0.34, h * 0.72); x.quadraticCurveTo(w * 0.66, h * 0.68, w, h * 0.76); x.stroke();
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail sides: maroon 34 outlined white and dark maroon
    const tailSide = (w, h, rr) => {
      x.fillStyle = maroon; x.fillRect(0, 0, w, h * 0.05);
      txt('34', rr ? w * 0.6 : w * 0.48, h * 0.5, h * 0.42, maroon, { stroke: dark, sw: 0.12, maxW: w * 0.32 });
      txt('COTTLE', rr ? w * 0.2 : w * 0.8, h * 0.3, h * 0.08, maroon, { maxW: w * 0.22 });
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    P.flat(R.tailTop, true, (w, h) => { x.fillStyle = maroon; x.fillRect(w * 0.44, 0, w * 0.12, h); });
    // hood top: the maroon scoop panel over the injectors, white everywhere else
    P.flat(R.hoodTop, true, (w, h) => {
      x.fillStyle = maroon; x.beginPath(); x.moveTo(w * 0.58, h * 0.3); x.lineTo(w * 0.96, h * 0.25); x.lineTo(w * 0.96, h * 0.75); x.lineTo(w * 0.58, h * 0.7); x.fill();
      x.strokeStyle = slate; x.lineWidth = h * 0.015; x.stroke();
    });
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = slate; x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      txt('COTTLE', 0, 0, w * 0.6, white, { stroke: black, sw: 0.1, maxW: h * 0.85 });
      x.restore();
    });
    for (let i = 0; i < 450; i++) { x.fillStyle = `rgba(120,85,55,${0.06 + Math.random() * 0.14})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 3 + 0.4, 0, 7); x.fill(); }
    return {
      canvas: c, chassis: maroon, roof: maroon, rim: '#1c1c1c', rimColor: '#1a1a1a', helmet: slate, coverLeft: false,
      number: maroon, numberOutline: white, numberShadow: dark, paintedTailNumbers: true,
    };
  },

  // #23 Halle Richey: pink car, Alliance Bank as the main sponsor (white waving
  // flag logo and serif lettering on the bank's green), white 23 outlined green
  richey23(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const pink = '#f2559e', hot = '#d62b80', green = '#3f8f63', white = '#ffffff', black = '#151515';
    x.fillStyle = pink; x.fillRect(0, 0, S, S);
    const txt = (t, px, py, size, color, opt = {}) => {
      x.font = `${opt.italic ? 'italic ' : ''}${opt.weight || 900} ${Math.floor(size)}px ${opt.font || '"Arial Black", Arial, sans-serif'}`;
      x.textAlign = opt.align || 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      if (opt.stroke) { x.lineWidth = size * (opt.sw || 0.16); x.strokeStyle = opt.stroke; x.strokeText(t, px, py, opt.maxW); }
      x.fillStyle = color; x.fillText(t, px, py, opt.maxW);
    };
    const serif = 'Georgia, "Times New Roman", serif';
    // Alliance Bank logo: a white flag waving to the right (three swept bands)
    // over "Alliance", with "Bank" under the A. (cx, cy) = center, s = height.
    const alliance = (cx, cy, s, bg) => {
      if (bg) {
        x.fillStyle = green; x.beginPath(); x.roundRect(cx - s * 1.1, cy - s * 0.55, s * 2.2, s * 1.1, s * 0.12); x.fill();
        x.strokeStyle = white; x.lineWidth = s * 0.03; x.stroke();
      }
      const fx = cx - s * 0.78, fy = cy - s * 0.42, fw = s * 1.05, fh = s * 0.36;
      x.save(); x.translate(fx, fy);
      x.fillStyle = white;
      x.beginPath();
      x.moveTo(0, 0); x.quadraticCurveTo(fw * 0.45, fh * 0.1, fw, -fh * 0.12);
      x.quadraticCurveTo(fw * 0.62, fh * 0.35, fw * 0.32, fh); x.lineTo(fw * 0.12, fh);
      x.quadraticCurveTo(fw * 0.08, fh * 0.45, 0, 0); x.fill();
      // the swept stripes are cut into the flag in the background color
      x.strokeStyle = bg ? green : pink; x.lineWidth = fh * 0.07;
      for (let i = 1; i <= 3; i++) {
        const f = i / 4.2;
        x.beginPath(); x.moveTo(fw * (0.03 + f * 0.12), fh * f);
        x.quadraticCurveTo(fw * 0.55, fh * (f + 0.12), fw * (0.98 - f * 0.4), -fh * 0.12 + fh * f * 1.1); x.stroke();
      }
      x.restore();
      txt('Alliance', cx - s * 0.86, cy + s * 0.12, s * 0.48, white, { align: 'left', weight: 400, font: serif, maxW: s * 1.85 });
      txt('Bank', cx - s * 0.86, cy + s * 0.43, s * 0.2, white, { align: 'left', weight: 400, font: serif });
    };
    // hood sides: the big Alliance Bank panel, white/green pinstripes
    const hoodSide = (w, h, rr) => {
      x.fillStyle = white; x.fillRect(0, h * 0.06, w, h * 0.025);
      x.fillStyle = hot; x.fillRect(0, h * 0.8, w, h * 0.2);
      x.fillStyle = white; x.fillRect(0, h * 0.78, w, h * 0.02);
      alliance(w * 0.5, h * 0.43, h * 0.74, true);
      const lows = [['HOOSIER', 0.15], ['WELD', 0.85]];
      for (const [t, f] of lows) txt(t, w * f, h * 0.9, h * 0.07, white, { weight: 800, maxW: w * 0.14 });
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    const noseSide = (w, h) => { x.fillStyle = hot; x.fillRect(0, h * 0.75, w, h * 0.25); x.fillStyle = white; x.fillRect(0, h * 0.72, w, h * 0.04); };
    P.flat(R.noseSideL, true, noseSide); P.flat(R.noseSideR, false, noseSide);
    // cockpit sides (x = 0 is the back): tall panel at the back with the logo again
    const cockSide = (w, h) => {
      x.fillStyle = green; x.fillRect(0, 0, w * 0.45, h);
      x.fillStyle = white; x.fillRect(w * 0.45, 0, w * 0.015, h);
      alliance(w * 0.24, h * 0.32, w * 0.2, false);
      txt('RICHEY', w * 0.72, h * 0.5, h * 0.12, white, { stroke: hot, sw: 0.12, maxW: w * 0.46 });
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail sides: pink with a white sweep, white 23 outlined green, logo up front
    const tailSide = (w, h, rr) => {
      x.save(); if (!rr) { x.translate(w, 0); x.scale(-1, 1); }
      x.fillStyle = hot; x.beginPath(); x.moveTo(0, h); x.lineTo(0, h * 0.72); x.quadraticCurveTo(w * 0.5, h * 0.7, w, h * 0.35); x.lineTo(w, h); x.fill();
      x.strokeStyle = white; x.lineWidth = h * 0.025; x.beginPath(); x.moveTo(0, h * 0.7); x.quadraticCurveTo(w * 0.5, h * 0.68, w, h * 0.33); x.stroke();
      x.restore();
      alliance(rr ? w * 0.2 : w * 0.8, h * 0.32, h * 0.32, true);
      txt('23', rr ? w * 0.6 : w * 0.48, h * 0.5, h * 0.42, white, { italic: true, stroke: green, sw: 0.14, maxW: w * 0.32 });
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    P.flat(R.tailTop, true, (w, h) => { alliance(w * 0.5, h * 0.28, h * 0.3, true); });
    P.flat(R.tailRear, true, (w, h) => { x.fillStyle = hot; x.fillRect(0, h * 0.6, w, h * 0.4); });
    P.flat(R.hoodTop, true, (w, h) => { x.fillStyle = white; x.fillRect(w * 0.3, 0, w * 0.012, h); x.fillStyle = hot; x.fillRect(0, 0, w * 0.3, h); });
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = green; x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      txt('RICHEY', 0, 0, w * 0.6, white, { stroke: black, sw: 0.08, maxW: h * 0.85 });
      x.restore();
    });
    for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(120,95,70,${0.05 + Math.random() * 0.1})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 3 + 0.4, 0, 7); x.fill(); }
    return {
      canvas: c, chassis: '#e9e9e6', roof: pink, rim: '#cfd3d6', helmet: pink, coverLeft: false,
      number: white, numberOutline: green, numberShadow: hot, paintedTailNumbers: true,
    };
  },

  // #9Z Zack Pretorious: Monster Energy car, flat charcoal with a glowing green
  // eye and the claw on the cockpit sides, green BEAST graffiti on the hood,
  // white 9 in a green-outlined box with a green Z on the tail
  pretorious9z(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const char = '#26282a', black = '#0e0f10', green = '#57e62a', white = '#f4f5f6';
    x.fillStyle = char; x.fillRect(0, 0, S, S);
    const txt = (t, px, py, size, color, opt = {}) => {
      x.font = `${opt.italic ? 'italic ' : ''}${opt.weight || 900} ${Math.floor(size)}px ${opt.font || '"Arial Black", Arial, sans-serif'}`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      if (opt.stroke) { x.lineWidth = size * (opt.sw || 0.16); x.strokeStyle = opt.stroke; x.strokeText(t, px, py, opt.maxW); }
      x.fillStyle = color; x.fillText(t, px, py, opt.maxW);
    };
    // Monster claw: three jagged black slashes
    const claw = (cx, cy, s) => {
      x.fillStyle = black;
      for (const dx of [-0.32, 0, 0.32]) {
        x.beginPath();
        x.moveTo(cx + (dx - 0.08) * s, cy - 0.7 * s); x.lineTo(cx + (dx + 0.08) * s, cy - 0.7 * s);
        x.lineTo(cx + (dx + 0.03) * s, cy - 0.1 * s); x.lineTo(cx + (dx + 0.08) * s, cy - 0.05 * s);
        x.lineTo(cx + dx * s, cy + 0.75 * s); x.lineTo(cx + (dx - 0.05) * s, cy + 0.05 * s);
        x.lineTo(cx + (dx - 0.1) * s, cy); x.fill();
      }
    };
    // the green eye with the claw in it
    const eye = (cx, cy, rw, rh) => {
      const g = x.createRadialGradient(cx, cy, rh * 0.1, cx, cy, rw);
      g.addColorStop(0, '#eaff8a'); g.addColorStop(0.7, green); g.addColorStop(1, 'rgba(60,160,30,0.2)');
      x.fillStyle = g; x.beginPath(); x.ellipse(cx, cy, rw * 1.25, rh * 1.25, 0, 0, Math.PI * 2); x.fill();
      x.strokeStyle = green; x.lineWidth = rh * 0.06;
      x.beginPath(); x.ellipse(cx, cy, rw * 1.3, rh * 1.05, 0, Math.PI * 0.05, Math.PI * 0.95); x.stroke();
      claw(cx, cy, rh * 0.85);
    };
    // hood sides: BEAST graffiti
    const hoodSide = (w, h, rr) => {
      txt('BEAST', rr ? w * 0.55 : w * 0.45, h * 0.42, h * 0.48, green, { italic: true, font: '"Marker Felt", "Comic Sans MS", Impact, sans-serif', maxW: w * 0.6 });
      x.strokeStyle = green; x.lineWidth = h * 0.015;
      for (let i = 0; i < 6; i++) { const y = h * (0.15 + Math.random() * 0.6); x.beginPath(); x.moveTo(rr ? w * 0.05 : w * 0.95, y); x.lineTo(rr ? w * 0.25 : w * 0.75, y + h * 0.05); x.stroke(); }
      const lows = [['HOOSIER', 0.15], ['WELD', 0.32], ['DRC', 0.48]];
      for (const [t, f] of lows) txt(t, rr ? w * f : w * (1 - f), h * 0.85, h * 0.07, white, { weight: 800, maxW: w * 0.14 });
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    // cockpit sides (x = 0 is the back): sponsors at the back, the eye up front
    const cockSide = (w, h) => {
      x.fillStyle = green; x.fillRect(0, 0, w, h * 0.05);
      const list = [['PIZZA KING', 0.12], ['OAK MOTORS', 0.26], ['T.A. SMITH', 0.38], ['FK', 0.5]];
      for (const [t, fy] of list) txt(t, w * 0.2, h * fy, h * 0.07, white, { maxW: w * 0.32 });
      eye(w * 0.64, h * 0.5, w * 0.3, h * 0.36);
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail sides: white 9 in a rounded green-outlined box, green Z
    const tailSide = (w, h, rr) => {
      const cx = rr ? w * 0.58 : w * 0.48, cy = h * 0.5, bw = w * 0.26, bh = h * 0.56;
      const box = (pad, col) => { x.fillStyle = col; x.beginPath(); x.roundRect(cx - bw / 2 - pad, cy - bh / 2 - pad, bw + pad * 2, bh + pad * 2, h * 0.08); x.fill(); };
      box(h * 0.05, green); box(h * 0.025, white); box(0, black);
      txt('9', cx - bw * 0.1, cy - h * 0.03, bh * 0.8, white, { italic: true, maxW: bw * 0.8 });
      txt('Z', cx + bw * 0.3, cy + bh * 0.28, bh * 0.5, green, { italic: true, stroke: black, sw: 0.14 });
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    P.flat(R.tailTop, true, (w, h) => { claw(w * 0.5, h * 0.3, h * 0.14); });
    P.flat(R.hoodTop, true, (w, h) => { x.fillStyle = green; x.fillRect(w * 0.3, 0, w * 0.01, h); });
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = black; x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      txt('PRETORIOUS', 0, 0, w * 0.5, green, { maxW: h * 0.88 });
      x.restore();
    });
    for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(120,95,70,${0.05 + Math.random() * 0.1})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 3 + 0.4, 0, 7); x.fill(); }
    return {
      canvas: c, chassis: '#151515', roof: black, rim: '#1c1c1c', rimColor: '#1a1a1a', helmet: green, coverLeft: false,
      number: white, numberOutline: green, numberShadow: black, paintedTailNumbers: true,
    };
  },

  // #16 Harley Burns: black car with neon green, a big green BrittAero outlined
  // black on the hood sides, green sponsor panel at the back of the cockpit,
  // green pinstripes and a white 16 outlined green on the black tail
  burns16(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const black = '#111213', green = '#3ff23a', white = '#f4f5f6';
    x.fillStyle = black; x.fillRect(0, 0, S, S);
    const txt = (t, px, py, size, color, opt = {}) => {
      x.font = `${opt.italic ? 'italic ' : ''}${opt.weight || 900} ${Math.floor(size)}px ${opt.font || '"Arial Black", Arial, sans-serif'}`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      if (opt.stroke) { x.lineWidth = size * (opt.sw || 0.16); x.strokeStyle = opt.stroke; x.strokeText(t, px, py, opt.maxW); }
      x.fillStyle = color; x.fillText(t, px, py, opt.maxW);
    };
    // hood sides: green top edge sweeping down to the nose, giant BrittAero
    const hoodSide = (w, h, rr) => {
      x.save(); if (!rr) { x.translate(w, 0); x.scale(-1, 1); }
      x.fillStyle = green;
      x.beginPath(); x.moveTo(0, 0); x.lineTo(w, 0); x.lineTo(w, h * 0.16); x.lineTo(0, h * 0.34); x.fill();
      x.restore();
      txt('BRITTAERO', w * 0.5, h * 0.56, h * 0.44, green, { stroke: white, sw: 0.06, maxW: w * 0.86 });
      txt('A Division of Britt Tool Inc.', rr ? w * 0.7 : w * 0.3, h * 0.8, h * 0.06, white, { weight: 700, maxW: w * 0.3 });
      txt('theacecorp.com', rr ? w * 0.75 : w * 0.25, h * 0.24, h * 0.06, black, { weight: 800, maxW: w * 0.22 });
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    const noseSide = (w, h) => { x.fillStyle = green; x.fillRect(0, 0, w, h * 0.3); };
    P.flat(R.noseSideL, true, noseSide); P.flat(R.noseSideR, false, noseSide);
    // cockpit sides (x = 0 is the back): green sponsor panel at the back, black up front
    const cockSide = (w, h) => {
      x.fillStyle = green;
      x.beginPath(); x.moveTo(0, 0); x.lineTo(w * 0.62, 0); x.lineTo(w * 0.62, h * 0.12); x.lineTo(w * 0.42, h * 0.45); x.lineTo(w * 0.42, h); x.lineTo(0, h); x.fill();
      const list = [['JKR', 0.1], ['TIMBERLAND', 0.22], ["SMITH'S", 0.33], ['THE FLATS', 0.45], ['PDF SUPPLY', 0.57], ['bond', 0.7]];
      for (const [t, fy] of list) txt(t, w * 0.2, h * fy, h * 0.075, black, { maxW: w * 0.34 });
      x.fillStyle = white; x.fillRect(w * 0.05, h * 0.78, w * 0.3, h * 0.14);
      txt('AUTO REPAIR', w * 0.2, h * 0.85, h * 0.06, '#c8102e', { maxW: w * 0.27 });
      txt('COUNTRY', w * 0.52, h * 0.06, h * 0.06, black, { maxW: w * 0.16 });
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail sides: black with green pinstripes and the white 16 outlined green
    const tailSide = (w, h, rr) => {
      x.save(); if (!rr) { x.translate(w, 0); x.scale(-1, 1); }
      x.strokeStyle = green; x.lineWidth = h * 0.025;
      x.beginPath(); x.moveTo(w * 0.05, h * 0.95); x.quadraticCurveTo(w * 0.35, h * 0.2, w * 0.95, h * 0.08); x.stroke();
      x.beginPath(); x.moveTo(w * 0.35, h * 0.5); x.lineTo(w * 0.62, h * 0.22); x.stroke();
      x.restore();
      txt('16', rr ? w * 0.6 : w * 0.48, h * 0.52, h * 0.44, white, { italic: true, stroke: green, sw: 0.1, maxW: w * 0.32 });
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    P.flat(R.tailTop, true, (w, h) => { x.fillStyle = green; x.fillRect(0, h * 0.5, w, h * 0.04); });
    P.flat(R.hoodTop, true, (w, h) => { x.fillStyle = green; x.fillRect(0, 0, w * 0.12, h); x.fillRect(w * 0.88, 0, w * 0.12, h); });
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = green; x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      txt('BURNS', 0, 0, w * 0.6, black, { maxW: h * 0.85 });
      x.restore();
    });
    for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(120,95,70,${0.05 + Math.random() * 0.1})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 3 + 0.4, 0, 7); x.fill(); }
    return {
      canvas: c, chassis: '#2a2b2d', roof: green, rim: '#cfd3d6', helmet: green, coverLeft: false,
      number: white, numberOutline: green, numberShadow: black, paintedTailNumbers: true,
    };
  },

  // #57 Logan Seavey: navy blue car over black carbon, silver-white cockpit
  // panel with speed lines and the Mountain Mechanical Contractors oval, Indy
  // Powersports / Droplight / Composite Specialties, mint 57 outlined white,
  // SEAVEY plate, black chassis and wheels
  seavey57(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const navy = '#1c3168', carbon = '#15171b', silver = '#d9dde2', mint = '#7fe0c8', white = '#f5f6f7', blue = '#2a63c4';
    x.fillStyle = navy; x.fillRect(0, 0, S, S);
    const txt = (t, px, py, size, color, opt = {}) => {
      x.font = `${opt.italic ? 'italic ' : ''}${opt.weight || 900} ${Math.floor(size)}px ${opt.font || '"Arial Black", Arial, sans-serif'}`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      if (opt.stroke) { x.lineWidth = size * (opt.sw || 0.16); x.strokeStyle = opt.stroke; x.strokeText(t, px, py, opt.maxW); }
      x.fillStyle = color; x.fillText(t, px, py, opt.maxW);
    };
    // Mountain Mechanical oval
    const mtn = (cx, cy, rw, rh) => {
      x.fillStyle = navy; x.beginPath(); x.ellipse(cx, cy, rw, rh, -0.08, 0, Math.PI * 2); x.fill();
      x.fillStyle = white; x.beginPath(); x.ellipse(cx, cy, rw * 0.9, rh * 0.84, -0.08, 0, Math.PI * 2); x.fill();
      x.fillStyle = mint; x.beginPath(); x.moveTo(cx - rw * 0.6, cy - rh * 0.05); x.lineTo(cx - rw * 0.3, cy - rh * 0.6); x.lineTo(cx, cy - rh * 0.2); x.lineTo(cx + rw * 0.25, cy - rh * 0.5); x.lineTo(cx + rw * 0.55, cy - rh * 0.05); x.fill();
      txt('MOUNTAIN MECHANICAL', cx, cy + rh * 0.12, rh * 0.26, navy, { italic: true, maxW: rw * 1.5 });
      txt('CONTRACTORS, INC.', cx, cy + rh * 0.5, rh * 0.18, navy, { weight: 800, maxW: rw * 1.2 });
    };
    // hood sides: navy over black carbon, sponsors
    const hoodSide = (w, h, rr) => {
      x.fillStyle = carbon; x.fillRect(0, h * 0.62, w, h * 0.38);
      x.fillStyle = blue; x.fillRect(0, h * 0.6, w, h * 0.025);
      const f = (v) => (rr ? w * v : w * (1 - v));
      txt('INDY', f(0.18), h * 0.3, h * 0.2, white, { stroke: carbon, sw: 0.1, maxW: w * 0.16 });
      txt('POWERSPORTS', f(0.18), h * 0.45, h * 0.06, white, { weight: 800, maxW: w * 0.16 });
      txt('DROPLIGHT', f(0.45), h * 0.3, h * 0.09, white, { weight: 800, maxW: w * 0.2 });
      txt('COMPOSITE SPECIALTIES', f(0.72), h * 0.3, h * 0.07, white, { italic: true, maxW: w * 0.26 });
      const lows = [['AFD', 0.15], ['DH', 0.35], ['STANTON', 0.55], ['CRW', 0.78]];
      for (const [t, v] of lows) txt(t, f(v), h * 0.8, h * 0.09, white, { italic: true, maxW: w * 0.16 });
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    const noseSide = (w, h) => { x.fillStyle = carbon; x.fillRect(0, h * 0.55, w, h * 0.45); };
    P.flat(R.noseSideL, true, noseSide); P.flat(R.noseSideR, false, noseSide);
    P.flat(R.noseFront, true, (w, h) => { x.fillStyle = carbon; x.fillRect(0, 0, w, h); });
    // cockpit sides (x = 0 is the back): silver panel with white speed lines and the oval
    const cockSide = (w, h) => {
      x.fillStyle = silver;
      x.beginPath(); x.moveTo(0, h * 0.14); x.lineTo(w * 0.92, h * 0.24); x.lineTo(w, h * 0.5); x.lineTo(w * 0.85, h * 0.92); x.lineTo(0, h * 0.92); x.fill();
      x.strokeStyle = white; x.lineWidth = h * 0.012;
      for (let i = 0; i < 9; i++) { const y = h * (0.2 + i * 0.08); x.beginPath(); x.moveTo(0, y); x.lineTo(w * 0.35, y); x.stroke(); }
      x.fillStyle = navy; x.fillRect(0, h * 0.92, w, h * 0.08);
      mtn(w * 0.58, h * 0.52, w * 0.36, h * 0.26);
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail sides: navy with speed lines, big mint 57
    const tailSide = (w, h, rr) => {
      x.fillStyle = carbon; x.fillRect(0, h * 0.82, w, h * 0.18);
      x.strokeStyle = silver; x.lineWidth = h * 0.012;
      for (let i = 0; i < 6; i++) { const y = h * (0.2 + i * 0.09); x.beginPath(); x.moveTo(rr ? 0 : w * 0.7, y); x.lineTo(rr ? w * 0.3 : w, y); x.stroke(); }
      txt('57', rr ? w * 0.6 : w * 0.48, h * 0.5, h * 0.42, mint, { stroke: white, sw: 0.12, maxW: w * 0.32 });
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    P.flat(R.tailTop, true, (w, h) => { txt('DROPLIGHT', w * 0.5, h * 0.3, h * 0.12, white, { weight: 800, maxW: w * 0.6 }); });
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = silver; x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      txt('SEAVEY', 0, 0, w * 0.6, carbon, { italic: true, stroke: white, sw: 0.1, maxW: h * 0.85 });
      x.restore();
    });
    for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(120,95,70,${0.05 + Math.random() * 0.1})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 3 + 0.4, 0, 7); x.fill(); }
    return {
      canvas: c, chassis: '#141414', roof: silver, rim: '#1c1c1c', rimColor: '#1a1a1a', helmet: navy, coverLeft: false,
      number: mint, numberOutline: navy, numberShadow: white, paintedTailNumbers: true,
    };
  },

  // #92 Chase Stockon: white car, teal chassis and cage, purple band edged in
  // pink with teal stripes sweeping down the sides, Lucas Oil Center / Engler
  // on the white cockpit sides, big teal 92 outlined purple on the tail
  stockon92(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const white = '#f5f6f7', teal = '#3cc8c0', purple = '#3c3fb8', pink = '#ec2f93', black = '#111111';
    x.fillStyle = white; x.fillRect(0, 0, S, S);
    const txt = (t, px, py, size, color, opt = {}) => {
      x.font = `${opt.italic ? 'italic ' : ''}${opt.weight || 900} ${Math.floor(size)}px ${opt.font || '"Arial Black", Arial, sans-serif'}`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      if (opt.stroke) { x.lineWidth = size * (opt.sw || 0.16); x.strokeStyle = opt.stroke; x.strokeText(t, px, py, opt.maxW); }
      x.fillStyle = color; x.fillText(t, px, py, opt.maxW);
    };
    // the purple band: pink edges, a teal stripe through it, sweeping down toward the nose
    const band = (w, h, rr, y0, y1, drop) => {
      x.save(); if (!rr) { x.translate(w, 0); x.scale(-1, 1); }
      const poly = (a, b, col) => {
        x.fillStyle = col; x.beginPath();
        x.moveTo(0, h * (a + drop)); x.lineTo(w, h * a); x.lineTo(w, h * b); x.lineTo(0, h * (b + drop)); x.fill();
      };
      const t = y1 - y0;
      poly(y0 - 0.03, y1 + 0.03, pink);
      poly(y0, y1, purple);
      poly(y0 + t * 0.42, y0 + t * 0.58, teal);
      poly(y0 + t * 0.6, y0 + t * 0.64, pink);
      x.restore();
    };
    const hoodSide = (w, h, rr) => {
      band(w, h, rr, 0.3, 0.62, 0.12);
      const lows = [['SPRINTCARS.COM', 0.78, 0.2], ['RAVENS', 0.55, 0.12], ['CHALKSTIX', 0.32, 0.15]];
      for (const [t, f, mw] of lows) txt(t, rr ? w * f : w * (1 - f), h * 0.12, h * 0.08, purple, { weight: 800, maxW: w * mw });
      txt('MOOSE RACING', rr ? w * 0.2 : w * 0.8, h * 0.9, h * 0.08, teal, { stroke: purple, sw: 0.1, maxW: w * 0.24 });
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    const noseSide = (w, h) => { x.fillStyle = teal; x.fillRect(0, h * 0.7, w, h * 0.12); x.fillStyle = purple; x.fillRect(0, h * 0.82, w, h * 0.06); };
    P.flat(R.noseSideL, true, noseSide); P.flat(R.noseSideR, false, noseSide);
    // cockpit sides: white sponsor panel at the back, the band across the bottom
    const cockSide = (w, h) => {
      x.fillStyle = teal; x.fillRect(0, 0, w, h * 0.05);
      x.fillStyle = pink; x.fillRect(0, h * 0.64, w, h * 0.3);
      x.fillStyle = purple; x.fillRect(0, h * 0.67, w, h * 0.24);
      x.fillStyle = teal; x.fillRect(0, h * 0.76, w, h * 0.05);
      x.fillStyle = pink; x.fillRect(0, h * 0.815, w, h * 0.012);
      const top = [['ENGLER', 0.12], ['LUCAS OIL CENTER', 0.25], ['DEWIG MEATS', 0.38]];
      for (const [t, fy] of top) txt(t, w * 0.25, h * fy, h * 0.09, purple, { maxW: w * 0.42 });
      txt('S&C MACHINE', w * 0.72, h * 0.25, h * 0.07, purple, { maxW: w * 0.4 });
      txt('SUPERIOR', w * 0.72, h * 0.42, h * 0.08, black, { italic: true, maxW: w * 0.4 });
      txt('BROWN BROTHERS', w * 0.5, h * 0.87, h * 0.05, white, { maxW: w * 0.6 });
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail sides: white with the big teal 92 outlined purple
    const tailSide = (w, h, rr) => {
      x.fillStyle = teal; x.fillRect(0, 0, w, h * 0.06); x.fillStyle = pink; x.fillRect(0, h * 0.06, w, h * 0.015);
      txt('92', rr ? w * 0.6 : w * 0.48, h * 0.5, h * 0.42, teal, { italic: true, stroke: purple, sw: 0.12, maxW: w * 0.32 });
      txt('ENGLER', rr ? w * 0.18 : w * 0.82, h * 0.3, h * 0.07, purple, { maxW: w * 0.2 });
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    P.flat(R.tailTop, true, (w, h) => { x.fillStyle = teal; x.fillRect(0, 0, w * 0.1, h); x.fillRect(w * 0.9, 0, w * 0.1, h); });
    P.flat(R.hoodTop, true, (w, h) => {
      x.fillStyle = purple; x.fillRect(0, 0, w * 0.22, h);
      x.fillStyle = pink; x.fillRect(w * 0.22, 0, w * 0.015, h);
      x.fillStyle = teal; x.fillRect(w * 0.235, 0, w * 0.05, h);
    });
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = teal; x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      txt('STOCKON', 0, 0, w * 0.55, white, { stroke: purple, sw: 0.14, maxW: h * 0.85 });
      x.restore();
    });
    for (let i = 0; i < 350; i++) { x.fillStyle = `rgba(120,95,70,${0.05 + Math.random() * 0.1})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 3 + 0.4, 0, 7); x.fill(); }
    return {
      canvas: c, chassis: teal, roof: white, rim: '#1c1c1c', rimColor: '#1a1a1a', helmet: purple, coverLeft: false,
      number: teal, numberOutline: purple, numberShadow: white, paintedTailNumbers: true,
    };
  },

  // #30 CJ Leary: black car with a bright blue band, giant white LEARY
  // Construction outlined black, white sponsor stack on the cockpit sides,
  // white nose, huge white 30 outlined blue on the black tail, black wheels
  leary30(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const black = '#121214', blue = '#1f7fe6', white = '#f4f5f6';
    x.fillStyle = black; x.fillRect(0, 0, S, S);
    const txt = (t, px, py, size, color, opt = {}) => {
      x.font = `${opt.italic ? 'italic ' : ''}${opt.weight || 900} ${Math.floor(size)}px ${opt.font || '"Arial Black", Arial, sans-serif'}`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      if (opt.stroke) { x.lineWidth = size * (opt.sw || 0.16); x.strokeStyle = opt.stroke; x.strokeText(t, px, py, opt.maxW); }
      x.fillStyle = color; x.fillText(t, px, py, opt.maxW);
    };
    // hood sides: blue band with the giant LEARY / CONSTRUCTION, black below
    const hoodSide = (w, h, rr) => {
      x.fillStyle = blue;
      x.beginPath(); x.moveTo(0, 0); x.lineTo(w, 0); x.lineTo(w, rr ? h * 0.78 : h * 0.62); x.lineTo(0, rr ? h * 0.62 : h * 0.78); x.fill();
      txt('LEARY', w * 0.5, h * 0.27, h * 0.56, white, { stroke: black, sw: 0.1, maxW: w * 0.9 });
      txt('CONSTRUCTION', w * 0.5, h * 0.58, h * 0.16, white, { stroke: black, sw: 0.14, maxW: w * 0.8 });
      const lows = [['SPRINT CAR', 0.2], ['FLORACING', 0.42], ['HOOSIER', 0.62], ['K&N', 0.8]];
      for (const [t, f] of lows) txt(t, rr ? w * f : w * (1 - f), h * 0.88, h * 0.07, white, { weight: 800, maxW: w * 0.16 });
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    // nose: white with a small sponsor column
    const noseSide = (w, h) => {
      x.fillStyle = white; x.fillRect(0, 0, w, h);
      txt('DMI', w * 0.3, h * 0.35, h * 0.22, black, { maxW: w * 0.3 });
      txt('KRAMER', w * 0.7, h * 0.35, h * 0.16, black, { maxW: w * 0.3 });
      txt('ULTRA-SHIELD', w * 0.5, h * 0.7, h * 0.14, black, { maxW: w * 0.6 });
    };
    P.flat(R.noseSideL, true, noseSide); P.flat(R.noseSideR, false, noseSide);
    P.flat(R.noseFront, true, (w, h) => { x.fillStyle = white; x.fillRect(0, 0, w, h); });
    // cockpit sides: white sponsor stack at the back, blue up front with more sponsors
    const cockSide = (w, h) => {
      x.fillStyle = blue; x.fillRect(0, 0, w, h);
      x.fillStyle = white; x.fillRect(0, 0, w * 0.5, h);
      const top = [['FK ROD ENDS', 0.08], ['DRC CHASSIS', 0.18], ['SIMPSON', 0.28], ['wilwood', 0.37], ['ASC', 0.45]];
      for (const [t, fy] of top) txt(t, w * 0.25, h * (0.15 + fy * 1.4), h * 0.08, black, { maxW: w * 0.42 });
      const low = [['INDY', 0.57], ["MURRAY'S", 0.67], ['TRAVIS ESH', 0.77], ['KODIAK', 0.87]];
      for (const [t, fy] of low) txt(t, w * 0.72, h * (fy * 1.4 - 0.6), h * 0.08, white, { stroke: black, sw: 0.1, maxW: w * 0.4 });
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail sides: black with the huge 30 outlined in blue
    const tailSide = (w, h, rr) => {
      txt('30', rr ? w * 0.6 : w * 0.48, h * 0.5, h * 0.42, white, { stroke: blue, sw: 0.14, maxW: w * 0.32 });
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    P.flat(R.tailTop, true, (w, h) => { x.fillStyle = blue; x.fillRect(0, h * 0.5, w, h * 0.06); });
    P.flat(R.hoodTop, true, (w, h) => { x.fillStyle = blue; x.fillRect(w * 0.3, 0, w * 0.7, h); });
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = blue; x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      txt('LEARY', 0, 0, w * 0.6, white, { stroke: black, sw: 0.14, maxW: h * 0.85 });
      x.restore();
    });
    for (let i = 0; i < 350; i++) { x.fillStyle = `rgba(120,95,70,${0.05 + Math.random() * 0.1})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 3 + 0.4, 0, 7); x.fill(); }
    return {
      canvas: c, chassis: '#141414', roof: black, rim: '#1c1c1c', rimColor: '#1a1a1a', helmet: blue, coverLeft: false,
      number: white, numberOutline: blue, numberShadow: black, paintedTailNumbers: true,
    };
  },

  // #12 Robert Ballou: red car, white chassis and cage, white upper tail with
  // J.B. Hinchman Indianapolis, gold Suburban Subaru with the arrow, gold 12 on
  // a starred blue panel, BALLOU plate, Engler ovals, polished rims
  ballou12(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const red = '#d4202a', white = '#f4f4f1', gold = '#d9a93a', blue = '#1d3f9e', black = '#111111';
    x.fillStyle = red; x.fillRect(0, 0, S, S);
    const txt = (t, px, py, size, color, opt = {}) => {
      x.font = `${opt.italic ? 'italic ' : ''}${opt.weight || 900} ${Math.floor(size)}px ${opt.font || '"Arial Black", Arial, sans-serif'}`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      if (opt.stroke) { x.lineWidth = size * (opt.sw || 0.16); x.strokeStyle = opt.stroke; x.strokeText(t, px, py, opt.maxW); }
      x.fillStyle = color; x.fillText(t, px, py, opt.maxW);
    };
    const oval = (t, cx, cy, w, h) => {
      x.fillStyle = black; x.beginPath(); x.ellipse(cx, cy, w / 2, h / 2, 0, 0, Math.PI * 2); x.fill();
      x.strokeStyle = white; x.lineWidth = h * 0.1; x.beginPath(); x.ellipse(cx, cy, w / 2 - h * 0.08, h / 2 - h * 0.08, 0, 0, Math.PI * 2); x.stroke();
      txt(t, cx, cy, h * 0.42, white, { weight: 800, maxW: w * 0.78 });
    };
    // gold 12 on a blue panel with white stars
    const starPanel = (cx, cy, w, h) => {
      x.fillStyle = blue; x.fillRect(cx - w / 2, cy - h / 2, w, h);
      x.fillStyle = white;
      for (let i = 0; i < 5; i++) for (const sx of [-1, 1]) { x.beginPath(); x.arc(cx + sx * w * 0.43, cy - h * 0.4 + i * h * 0.2, h * 0.04, 0, 7); x.fill(); }
      txt('12', cx, cy, h * 0.85, gold, { italic: true, stroke: black, sw: 0.08, maxW: w * 0.78 });
    };
    // hood sides: Suburban Subaru with the gold arrow, small sponsors low
    const hoodSide = (w, h, rr) => {
      const cx = rr ? w * 0.42 : w * 0.58, d = rr ? 1 : -1;
      x.fillStyle = black; x.fillRect(cx - w * 0.2, h * 0.3, w * 0.4, h * 0.36);
      x.fillStyle = gold;
      x.beginPath(); x.moveTo(cx - d * w * 0.16, h * 0.36); x.lineTo(cx + d * w * 0.1, h * 0.36); x.lineTo(cx + d * w * 0.1, h * 0.3);
      x.lineTo(cx + d * w * 0.19, h * 0.4); x.lineTo(cx + d * w * 0.1, h * 0.5); x.lineTo(cx + d * w * 0.1, h * 0.44); x.lineTo(cx - d * w * 0.16, h * 0.44); x.fill();
      txt('SUBURBAN', cx - d * w * 0.02, h * 0.52, h * 0.11, gold, { maxW: w * 0.3 });
      txt('SUBARU', cx - d * w * 0.02, h * 0.61, h * 0.09, gold, { maxW: w * 0.26 });
      oval('ENGLER', rr ? w * 0.1 : w * 0.9, h * 0.3, w * 0.12, h * 0.14);
      const lows = [['HOOKER', 0.12], ['ENGLER', 0.3], ['HOOSIER', 0.62], ['CHALKSTIX', 0.82]];
      for (const [t, f] of lows) txt(t, rr ? w * f : w * (1 - f), h * 0.86, h * 0.08, white, { weight: 800, maxW: w * 0.15 });
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    const noseSide = (w, h) => {
      x.fillStyle = white; x.fillRect(0, h * 0.86, w, h * 0.05);
      txt("DEATON'S", w * 0.5, h * 0.4, h * 0.22, gold, { stroke: black, sw: 0.1, maxW: w * 0.6 });
    };
    P.flat(R.noseSideL, true, noseSide); P.flat(R.noseSideR, false, noseSide);
    // hood top: the starred 12 up front, Deaton's Waterproof Services behind it
    P.flat(R.hoodTop, true, (w, h) => {
      starPanel(w * 0.15, h * 0.5, w * 0.22, h * 0.5);
      x.save(); x.translate(w * 0.42, h * 0.5); x.rotate(-Math.PI / 2);
      txt("DEATON'S WATERPROOF", 0, 0, w * 0.05, gold, { stroke: black, sw: 0.12, maxW: h * 0.7 });
      x.restore();
    });
    // cockpit sides: red with a white upper edge, Engler oval
    const cockSide = (w, h) => {
      x.fillStyle = white; x.fillRect(0, 0, w, h * 0.12);
      oval('ENGLER', w * 0.5, h * 0.5, w * 0.5, h * 0.16);
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail sides: white upper tail with J.B. Hinchman, gold BU logo and Deaton's,
    // gold 12 outlined blue on the back
    const tailSide = (w, h, rr) => {
      x.fillStyle = white;
      x.beginPath(); x.moveTo(0, 0); x.lineTo(w, 0); x.lineTo(w, rr ? h * 0.42 : h * 0.3); x.lineTo(0, rr ? h * 0.3 : h * 0.42); x.fill();
      x.fillStyle = black; x.fillRect(0, h * 0.02, w, h * 0.012);
      const fx = rr ? w * 0.3 : w * 0.7;
      txt('J.B.Hinchman', fx, h * 0.14, h * 0.13, black, { italic: true, weight: 700, font: '"Snell Roundhand", "Brush Script MT", cursive', maxW: w * 0.36 });
      txt('INDIANAPOLIS', fx, h * 0.25, h * 0.05, black, { weight: 800, maxW: w * 0.22 });
      txt('BU', rr ? w * 0.14 : w * 0.86, h * 0.56, h * 0.16, gold, { italic: true, stroke: black, sw: 0.1 });
      txt("DEATON'S", rr ? w * 0.14 : w * 0.86, h * 0.72, h * 0.06, gold, { maxW: w * 0.18 });
      txt('12', rr ? w * 0.6 : w * 0.48, h * 0.5, h * 0.38, gold, { italic: true, stroke: blue, sw: 0.14, maxW: w * 0.3 });
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    P.flat(R.tailTop, true, (w, h) => {
      x.fillStyle = white; x.fillRect(0, 0, w, h * 0.55);
      txt('ZDDPLUS', w * 0.5, h * 0.3, h * 0.12, black, { maxW: w * 0.5 });
    });
    P.flat(R.tailRear, true, (w, h) => { x.fillStyle = white; x.fillRect(0, 0, w, h * 0.35); });
    P.flat(R.noseFront, true, (w, h) => { x.fillStyle = red; x.fillRect(0, 0, w, h); });
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = white; x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      txt('BALLOU', 0, 0, w * 0.6, gold, { stroke: black, sw: 0.14, maxW: h * 0.85 });
      x.restore();
    });
    for (let i = 0; i < 350; i++) { x.fillStyle = `rgba(120,95,70,${0.05 + Math.random() * 0.1})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 3 + 0.4, 0, 7); x.fill(); }
    return {
      canvas: c, chassis: '#e9e9e4', roof: white, rim: '#cfd3d6', helmet: '#d4202a', coverLeft: false,
      number: gold, numberOutline: blue, numberShadow: black, paintedTailNumbers: true,
    };
  },

  // #19AZ Mitchel Moles: white car, light-blue top edges and nose with black
  // arcs, big winged RDI Development logo, AME Electrical, MOLES plate,
  // sponsor stack on the tail, black wheels
  moles19az(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const white = '#f6f7f8', sky = '#33b6ea', black = '#111111';
    x.fillStyle = white; x.fillRect(0, 0, S, S);
    const txt = (t, px, py, size, color, opt = {}) => {
      x.font = `${opt.italic ? 'italic ' : ''}${opt.weight || 900} ${Math.floor(size)}px ${opt.font || '"Arial Black", Arial, sans-serif'}`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      if (opt.stroke) { x.lineWidth = size * (opt.sw || 0.16); x.strokeStyle = opt.stroke; x.strokeText(t, px, py, opt.maxW); }
      x.fillStyle = color; x.fillText(t, px, py, opt.maxW);
    };
    // winged RDI badge
    const rdi = (cx, cy, s) => {
      x.save(); x.translate(cx, cy);
      x.fillStyle = black;
      for (const d of [-1, 1]) {
        for (let i = 0; i < 4; i++) { x.fillRect(d > 0 ? s * 0.55 : -s * (0.55 + 0.6 - i * 0.12), -s * 0.22 + i * s * 0.13, s * (0.6 - i * 0.12), s * 0.08); }
      }
      x.beginPath(); x.ellipse(0, 0, s * 0.6, s * 0.36, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = white; x.beginPath(); x.ellipse(0, 0, s * 0.5, s * 0.27, 0, 0, Math.PI * 2); x.fill();
      x.fillStyle = black; x.beginPath(); x.ellipse(0, 0, s * 0.44, s * 0.22, 0, 0, Math.PI * 2); x.fill();
      txt('RDI', 0, -s * 0.02, s * 0.3, white, { weight: 900 });
      txt('DEVELOPMENT', 0, s * 0.3, s * 0.09, black, { weight: 800 });
      x.restore();
    };
    // big blue/black arc sweeping through the side panels
    const arc = (w, h, rr, cxF, cyF, rF) => {
      x.save(); if (!rr) { x.translate(w, 0); x.scale(-1, 1); }
      x.lineWidth = h * 0.06; x.strokeStyle = sky; x.beginPath(); x.arc(w * cxF, h * cyF, h * rF, Math.PI * 0.55, Math.PI * 1.6); x.stroke();
      x.lineWidth = h * 0.025; x.strokeStyle = black; x.beginPath(); x.arc(w * cxF, h * cyF, h * (rF - 0.07), Math.PI * 0.55, Math.PI * 1.6); x.stroke();
      x.restore();
    };
    const hoodSide = (w, h, rr) => {
      x.fillStyle = sky; x.fillRect(0, 0, w, h * 0.1); x.fillStyle = black; x.fillRect(0, h * 0.1, w, h * 0.025);
      arc(w, h, rr, 0.98, 0.55, 0.42);
      txt('AME', rr ? w * 0.35 : w * 0.65, h * 0.45, h * 0.3, sky, { stroke: black, sw: 0.05, maxW: w * 0.26 });
      txt('ELECTRICAL', rr ? w * 0.35 : w * 0.65, h * 0.66, h * 0.08, sky, { weight: 800, maxW: w * 0.24 });
      txt('WALKER', rr ? w * 0.12 : w * 0.88, h * 0.3, h * 0.08, black, { weight: 800, maxW: w * 0.16 });
      const lows = [['QUICKCAR', 0.66], ['NEWLIN', 0.82], ['KEIZER', 0.5]];
      for (const [t, f] of lows) txt(t, rr ? w * f : w * (1 - f), h * 0.86, h * 0.08, black, { weight: 800, maxW: w * 0.16 });
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    // nose: light blue with the white 19
    const noseSide = (w, h) => {
      x.fillStyle = sky; x.fillRect(0, 0, w, h);
      x.fillStyle = black; x.fillRect(0, h * 0.86, w, h * 0.06);
      txt('19', w * 0.5, h * 0.5, h * 0.78, white, { italic: true, stroke: black, sw: 0.12, maxW: w * 0.6 });
    };
    P.flat(R.noseSideL, true, noseSide); P.flat(R.noseSideR, false, noseSide);
    P.flat(R.noseFront, true, (w, h) => { x.fillStyle = sky; x.fillRect(0, 0, w, h); });
    // cockpit sides: the RDI badge inside the arc
    const cockSide = (w, h, rr) => {
      x.fillStyle = sky; x.fillRect(0, 0, w, h * 0.08);
      x.lineWidth = h * 0.05; x.strokeStyle = sky; x.beginPath(); x.arc(w * 0.5, h * 0.55, h * 0.4, 0, Math.PI * 2); x.stroke();
      x.lineWidth = h * 0.02; x.strokeStyle = black; x.beginPath(); x.arc(w * 0.5, h * 0.55, h * 0.34, 0, Math.PI * 2); x.stroke();
      rdi(w * 0.5, h * 0.55, h * 0.42);
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail sides: blue top edge, sponsor column, 19AZ toward the back
    const tailSide = (w, h, rr) => {
      x.fillStyle = sky; x.fillRect(0, 0, w, h * 0.09); x.fillStyle = black; x.fillRect(0, h * 0.09, w, h * 0.02);
      const cx = rr ? w * 0.25 : w * 0.75;
      const items = [['STANTON', 0.2, 0.07], ['FK', 0.31, 0.09], ['DMI', 0.43, 0.08], ['INDY', 0.55, 0.08], ['SMITH TI', 0.67, 0.065], ['FLYING A', 0.78, 0.055]];
      for (const [t, fy, sz] of items) txt(t, cx, h * fy, h * sz, black, { italic: true, maxW: w * 0.32 });
      txt('19', rr ? w * 0.6 : w * 0.48, h * 0.44, h * 0.38, sky, { italic: true, stroke: black, sw: 0.14, maxW: w * 0.28 });
      txt('AZ', rr ? w * 0.6 : w * 0.48, h * 0.66, h * 0.12, black, { italic: true });
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    P.flat(R.tailTop, true, (w, h) => { x.fillStyle = sky; x.fillRect(0, 0, w * 0.12, h); x.fillRect(w * 0.88, 0, w * 0.12, h); });
    P.flat(R.tailRear, true, (w, h) => { x.fillStyle = sky; x.fillRect(0, h * 0.8, w, h * 0.2); });
    P.flat(R.hoodTop, true, (w, h) => { x.fillStyle = sky; x.fillRect(0, 0, w * 0.3, h); x.fillStyle = black; x.fillRect(w * 0.3, 0, w * 0.015, h); });
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = sky; x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      txt('MOLES', 0, 0, w * 0.62, white, { italic: true, stroke: black, sw: 0.14, maxW: h * 0.85 });
      x.restore();
    });
    for (let i = 0; i < 350; i++) { x.fillStyle = `rgba(120,95,70,${0.05 + Math.random() * 0.1})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 3 + 0.4, 0, 7); x.fill(); }
    return {
      canvas: c, chassis: '#141414', roof: black, rim: '#1c1c1c', rimColor: '#1a1a1a', helmet: '#e8eef2', coverLeft: false,
      number: white, numberOutline: black, numberShadow: sky, paintedTailNumbers: true,
    };
  },

  // #63 Cale Coons: black car with red and white slash pinstripes, CURB Records
  // in white, Kalitta / Mechanical Advantage sponsor stack on the tail, big
  // silver-white 63 outlined black and red on the back of the tail
  coons63(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const black = '#121214', red = '#d0202e', white = '#f4f4f2', silver = '#d9dbde';
    x.fillStyle = black; x.fillRect(0, 0, S, S);
    const txt = (t, px, py, size, color, opt = {}) => {
      x.font = `${opt.italic ? 'italic ' : ''}${opt.weight || 900} ${Math.floor(size)}px ${opt.font || '"Arial Black", Arial, sans-serif'}`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      if (opt.stroke2) { x.lineWidth = size * (opt.sw2 || 0.3); x.strokeStyle = opt.stroke2; x.strokeText(t, px, py, opt.maxW); }
      if (opt.stroke) { x.lineWidth = size * (opt.sw || 0.16); x.strokeStyle = opt.stroke; x.strokeText(t, px, py, opt.maxW); }
      x.fillStyle = color; x.fillText(t, px, py, opt.maxW);
    };
    // thin red + white slashes sweeping back
    const slashes = (w, h, rr, n = 4, y0 = 0.55) => {
      x.save(); if (!rr) { x.translate(w, 0); x.scale(-1, 1); }
      for (let i = 0; i < n; i++) {
        x.strokeStyle = i % 2 ? white : red; x.lineWidth = h * (i % 2 ? 0.012 : 0.022);
        x.beginPath(); x.moveTo(w * (0.05 + i * 0.06), h * (y0 + 0.4)); x.quadraticCurveTo(w * 0.45, h * (y0 + 0.1 - i * 0.04), w, h * (y0 - 0.35 - i * 0.05)); x.stroke();
      }
      x.restore();
    };
    const hoodSide = (w, h, rr) => {
      slashes(w, h, rr, 4, 0.6);
      x.fillStyle = white; const bx = rr ? w * 0.56 : w * 0.14;
      x.fillRect(bx, h * 0.18, w * 0.3, h * 0.03); x.fillRect(bx, h * 0.72, w * 0.3, h * 0.03);
      txt('CURB', bx + w * 0.15, h * 0.42, h * 0.38, white, { maxW: w * 0.28 });
      txt('RECORDS', bx + w * 0.15, h * 0.63, h * 0.1, white, { weight: 800, maxW: w * 0.24 });
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    const noseSide = (w, h, rr) => slashes(w, h, rr, 2, 0.7);
    P.flat(R.noseSideL, true, noseSide); P.flat(R.noseSideR, false, noseSide);
    const cockSide = (w, h, rr) => {
      x.strokeStyle = red; x.lineWidth = h * 0.02; x.beginPath(); x.moveTo(0, h * 0.9); x.lineTo(w, h * 0.55); x.stroke();
      x.strokeStyle = white; x.lineWidth = h * 0.01; x.beginPath(); x.moveTo(0, h * 0.95); x.lineTo(w, h * 0.6); x.stroke();
      txt('CC', w * 0.5, h * 0.25, h * 0.1, white, { italic: true });
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail sides: sponsor stack up front, 63 on the back half
    const tailSide = (w, h, rr) => {
      slashes(w, h, rr, 3, 0.75);
      const cx = rr ? w * 0.27 : w * 0.73;
      x.strokeStyle = white; x.lineWidth = h * 0.012; x.beginPath(); x.ellipse(cx, h * 0.16, w * 0.17, h * 0.11, -0.1, 0, Math.PI * 2); x.stroke();
      txt('Kalitta', cx, h * 0.15, h * 0.09, red, { stroke: white, sw: 0.18, maxW: w * 0.3 });
      txt('MECHANICAL', cx, h * 0.33, h * 0.05, white, { weight: 800, maxW: w * 0.36 });
      txt('ADVANTAGE', cx, h * 0.39, h * 0.05, white, { weight: 800, maxW: w * 0.36 });
      x.fillStyle = red; x.beginPath(); x.arc(cx - w * 0.08, h * 0.52, h * 0.05, 0, 7); x.fill();
      txt('TJ', cx - w * 0.08, h * 0.52, h * 0.05, white);
      txt('FK', cx + w * 0.08, h * 0.52, h * 0.06, white, { stroke: black, sw: 0.1 });
      txt('Gateway Paintball', cx, h * 0.64, h * 0.04, white, { weight: 700, maxW: w * 0.38 });
      txt('IMPACT', cx, h * 0.72, h * 0.05, white, { italic: true, maxW: w * 0.3 });
      txt('63', rr ? w * 0.62 : w * 0.48, h * 0.44, h * 0.38, silver, { stroke: black, sw: 0.12, stroke2: red, sw2: 0.24, maxW: w * 0.3 });
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    P.flat(R.tailTop, true, (w, h) => { x.fillStyle = red; x.fillRect(w * 0.46, 0, w * 0.03, h); x.fillStyle = white; x.fillRect(w * 0.51, 0, w * 0.015, h); });
    P.flat(R.tailRear, true, (w, h) => { x.fillStyle = red; x.fillRect(0, h * 0.7, w, h * 0.3); });
    P.flat(R.hoodTop, true, (w, h) => { x.fillStyle = red; x.fillRect(0, h * 0.47, w, h * 0.03); x.fillStyle = white; x.fillRect(0, h * 0.52, w, h * 0.015); });
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = black; x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      txt('COONS', 0, 0, w * 0.6, white, { italic: true, stroke: red, sw: 0.1, maxW: h * 0.85 });
      x.restore();
    });
    for (let i = 0; i < 350; i++) { x.fillStyle = `rgba(190,150,110,${0.05 + Math.random() * 0.1})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 3 + 0.4, 0, 7); x.fill(); }
    return {
      canvas: c, chassis: '#141414', roof: black, rim: '#dfe3e6', helmet: '#e8e8e8', coverLeft: false,
      number: silver, numberOutline: black, numberShadow: red, paintedTailNumbers: true,
    };
  },

  // #14 Jadon Rogers: white car, giant black Beasley's script with the train
  // logo and "Railcar Repair Corp" on the hood sides, black tail top with Lucky
  // Seven / Parallax, big white 14 outlined black and red on the tail
  rogers14(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const white = '#f5f5f2', black = '#111111', red = '#d42a2a';
    x.fillStyle = white; x.fillRect(0, 0, S, S);
    const txt = (t, px, py, size, color, opt = {}) => {
      x.font = `${opt.italic ? 'italic ' : ''}${opt.weight || 900} ${Math.floor(size)}px ${opt.font || '"Arial Black", Arial, sans-serif'}`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      if (opt.stroke2) { x.lineWidth = size * (opt.sw2 || 0.3); x.strokeStyle = opt.stroke2; x.strokeText(t, px, py, opt.maxW); }
      if (opt.stroke) { x.lineWidth = size * (opt.sw || 0.16); x.strokeStyle = opt.stroke; x.strokeText(t, px, py, opt.maxW); }
      x.fillStyle = color; x.fillText(t, px, py, opt.maxW);
    };
    const script = '"Brush Script MT", "Segoe Script", "Snell Roundhand", cursive';
    // a simple steam-locomotive badge
    const train = (cx, cy, s, faceRight) => {
      x.save(); x.translate(cx, cy); if (!faceRight) x.scale(-1, 1);
      x.fillStyle = black;
      x.fillRect(-s * 0.6, -s * 0.25, s * 0.9, s * 0.4);           // boiler
      x.fillRect(-s * 0.75, -s * 0.5, s * 0.35, s * 0.65);          // cab
      x.fillRect(s * 0.05, -s * 0.5, s * 0.12, s * 0.25);           // stack
      x.beginPath(); x.moveTo(s * 0.3, s * 0.15); x.lineTo(s * 0.55, s * 0.32); x.lineTo(s * 0.3, s * 0.32); x.fill(); // cowcatcher
      x.fillStyle = white;
      for (const wx of [-0.5, -0.2, 0.1]) { x.beginPath(); x.arc(wx * s, s * 0.22, s * 0.11, 0, 7); x.fill(); }
      x.fillStyle = black;
      for (const wx of [-0.5, -0.2, 0.1]) { x.beginPath(); x.arc(wx * s, s * 0.22, s * 0.06, 0, 7); x.fill(); }
      x.restore();
    };
    // hood sides
    const hoodSide = (w, h, rr) => {
      const back = (f) => (rr ? w * (1 - f) : w * f); // f measured from the cockpit end
      txt("Beasley's", back(0.38), h * 0.42, h * 0.74, black, { font: script, weight: 700, stroke: white, sw: 0.08, stroke2: black, sw2: 0.16, maxW: w * 0.72 });
      train(back(0.8), h * 0.32, h * 0.32, !rr);
      txt('Railcar', back(0.8), h * 0.6, h * 0.1, black, { weight: 700, font: 'Arial, sans-serif' });
      txt('Repair Corp', back(0.8), h * 0.71, h * 0.1, black, { weight: 700, font: 'Arial, sans-serif', maxW: w * 0.2 });
      const lows = [['K1', 0.85, 0.88], ['NOS', 0.62, 0.88], ['HOOSIER', 0.44, 0.88], ['MIDWEST', 0.25, 0.88]];
      for (const [t, f, fy] of lows) txt(t, back(f), h * fy, h * 0.08, black, { weight: 800, maxW: w * 0.16 });
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    // cockpit sides: the tail of the script swash + driver name
    const cockSide = (w, h) => {
      x.fillStyle = black; x.fillRect(0, 0, w, h * 0.12);
      txt('ROGERS', w * 0.5, h * 0.24, h * 0.07, white, { weight: 800, stroke: black, sw: 0.4 });
      txt('K1', w * 0.5, h * 0.52, h * 0.18, black, { italic: true });
      txt('AMSOIL', w * 0.5, h * 0.7, h * 0.07, black, { weight: 800 });
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail sides: white with black top strip, big 14 toward the back
    const tailSide = (w, h, rr) => {
      x.fillStyle = black; x.fillRect(0, 0, w, h * 0.18);
      txt('PARALLAX', rr ? w * 0.3 : w * 0.7, h * 0.09, h * 0.08, white, { font: 'Georgia, serif', maxW: w * 0.4 });
      txt('14', rr ? w * 0.56 : w * 0.5, h * 0.52, h * 0.46, white, { italic: true, stroke: black, sw: 0.14, stroke2: red, sw2: 0.26, maxW: w * 0.4 });
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    // tail top: black with the Lucky Seven logo
    P.flat(R.tailTop, true, (w, h) => {
      x.fillStyle = black; x.fillRect(0, h * 0.3, w, h * 0.7);
      x.save(); x.translate(w * 0.5, h * 0.62); x.rotate(-Math.PI / 2);
      x.fillStyle = red; x.fillRect(-h * 0.25, -w * 0.14, h * 0.1, w * 0.12);
      txt('LUCKY SEVEN', h * 0.05, -w * 0.08, w * 0.11, white, { italic: true, maxW: h * 0.5 });
      txt('TECHNOLOGIES', h * 0.05, w * 0.08, w * 0.06, white, { weight: 800, maxW: h * 0.45 });
      x.restore();
    });
    P.flat(R.tailRear, true, (w, h) => { x.fillStyle = black; x.fillRect(0, 0, w, h * 0.25); });
    P.flat(R.hoodTop, true, (w, h) => { x.fillStyle = black; x.fillRect(w * 0.8, 0, w * 0.2, h); });
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = black; x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      txt('ROGERS', 0, 0, w * 0.6, white, { italic: true, maxW: h * 0.85 });
      x.restore();
    });
    for (let i = 0; i < 450; i++) { x.fillStyle = `rgba(120,95,70,${0.05 + Math.random() * 0.12})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 3 + 0.4, 0, 7); x.fill(); }
    return {
      canvas: c, chassis: '#141414', roof: black, rim: '#2a2a2a', rimColor: '#262626', helmet: '#f5f5f2', coverLeft: false,
      number: white, numberOutline: black, numberShadow: red, paintedTailNumbers: true,
    };
  },

  // #39 Briggs Danner: black up top, sky blue down low split by yellow
  // pinstripes, yellow KEYSTONE CAP on the hood sides, yellow Apache Transport
  // panel on the tail top, sponsors on black tail sides, yellow 39 on blue
  danner39(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const black = '#121212', sky = '#2f9be8', blue = '#1b67d4', yellow = '#ffe11a', white = '#ffffff';
    x.fillStyle = black; x.fillRect(0, 0, S, S);
    const txt = (t, px, py, size, color, opt = {}) => {
      x.font = `${opt.italic ? 'italic ' : ''}${opt.weight || 900} ${Math.floor(size)}px ${opt.font || '"Arial Black", Arial, sans-serif'}`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      if (opt.stroke) { x.lineWidth = size * (opt.sw || 0.16); x.strokeStyle = opt.stroke; x.strokeText(t, px, py, opt.maxW); }
      x.fillStyle = color; x.fillText(t, px, py, opt.maxW);
    };
    // sky blue lower body rising toward the front, with yellow and blue pinstripes
    const lower = (w, h, rr, yRear = 0.62, yFront = 0.45) => {
      x.save(); if (!rr) { x.translate(w, 0); x.scale(-1, 1); } // rear on the right
      x.fillStyle = sky; x.beginPath(); x.moveTo(0, h * yFront); x.lineTo(w, h * yRear); x.lineTo(w, h); x.lineTo(0, h); x.fill();
      x.strokeStyle = yellow; x.lineWidth = h * 0.025; x.beginPath(); x.moveTo(0, h * (yFront - 0.05)); x.lineTo(w, h * (yRear - 0.05)); x.stroke();
      x.strokeStyle = blue; x.lineWidth = h * 0.02; x.beginPath(); x.moveTo(0, h * (yFront - 0.1)); x.lineTo(w, h * (yRear - 0.1)); x.stroke();
      x.restore();
    };
    const hoodSide = (w, h, rr) => {
      lower(w, h, rr, 0.78, 0.6);
      txt('KEYSTONE CAP', w * 0.5, h * 0.3, h * 0.28, yellow, { stroke: black, sw: 0.1, maxW: w * 0.82 });
      txt('Your Handy Cap Company', w * 0.5, h * 0.55, h * 0.13, yellow, { italic: true, weight: 800, font: 'Georgia, serif', maxW: w * 0.7 });
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    const noseSide = (w, h, rr) => lower(w, h, rr, 0.5, 0.35);
    P.flat(R.noseSideL, true, noseSide); P.flat(R.noseSideR, false, noseSide);
    P.flat(R.noseFront, true, (w, h) => { x.fillStyle = sky; x.fillRect(0, 0, w, h); });
    const cockSide = (w, h) => {
      x.fillStyle = sky; x.fillRect(0, h * 0.62, w, h * 0.38);
      x.fillStyle = yellow; x.fillRect(0, h * 0.58, w, h * 0.025);
      txt('BRIGGS DANNER', w * 0.5, h * 0.2, h * 0.07, sky, { italic: true, weight: 800, maxW: w * 0.8 });
      txt('NOS', w * 0.3, h * 0.74, h * 0.08, black); txt('HOOSIER', w * 0.7, h * 0.74, h * 0.07, black, { italic: true });
      txt('ALLSTAR', w * 0.5, h * 0.88, h * 0.07, black, { weight: 800 });
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail sides: black with the sponsor stack, blue lower rear with the yellow 39
    const tailSide = (w, h, rr) => {
      x.save(); if (!rr) { x.translate(w, 0); x.scale(-1, 1); }
      x.fillStyle = sky; x.beginPath(); x.moveTo(w * 0.35, h); x.quadraticCurveTo(w * 0.6, h * 0.62, w, h * 0.5); x.lineTo(w, h); x.fill();
      x.strokeStyle = yellow; x.lineWidth = h * 0.02; x.beginPath(); x.moveTo(0, h * 0.42); x.lineTo(w, h * 0.32); x.stroke();
      x.fillStyle = yellow; x.fillRect(0, 0, w, h * 0.08);
      x.restore();
      const cx = rr ? w * 0.3 : w * 0.7;
      txt('MOOSE', cx, h * 0.16, h * 0.08, white, { maxW: w * 0.36 });
      txt('PRODUCTIONS', cx, h * 0.23, h * 0.04, white, { weight: 800, maxW: w * 0.36 });
      txt('Boulevard', cx, h * 0.36, h * 0.09, yellow, { italic: true, maxW: w * 0.4 });
      txt('TRUCK REPAIR', cx, h * 0.44, h * 0.045, yellow, { weight: 800, maxW: w * 0.4 });
      txt('E. SCHNEIDER', cx, h * 0.56, h * 0.065, white, { stroke: '#5a3fa0', sw: 0.12, maxW: w * 0.42 });
      txt('POWER   VP', cx, h * 0.68, h * 0.06, white, { weight: 800, maxW: w * 0.4 });
      txt('39', rr ? w * 0.6 : w * 0.5, h * 0.44, h * 0.36, yellow, { italic: true, stroke: black, sw: 0.16, maxW: w * 0.3 });
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    // tail top: the yellow Apache Transport panel
    P.flat(R.tailTop, true, (w, h) => {
      x.fillStyle = yellow; x.fillRect(0, h * 0.45, w, h * 0.55);
      x.save(); x.translate(w * 0.5, h * 0.72); x.rotate(-Math.PI / 2);
      txt('APACHE', 0, -w * 0.1, w * 0.16, black, { maxW: h * 0.5 });
      txt('TRANSPORT', 0, w * 0.1, w * 0.12, black, { maxW: h * 0.5 });
      x.restore();
    });
    P.flat(R.tailRear, true, (w, h) => { x.fillStyle = sky; x.fillRect(0, h * 0.4, w, h * 0.6); x.fillStyle = yellow; x.fillRect(0, h * 0.36, w, h * 0.04); });
    P.flat(R.hoodTop, true, (w, h) => { x.fillStyle = yellow; x.fillRect(0, h * 0.06, w, h * 0.02); x.fillRect(0, h * 0.92, w, h * 0.02); });
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = yellow; x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      txt('DANNER', 0, 0, w * 0.6, black, { italic: true, maxW: h * 0.85 });
      x.restore();
    });
    for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(200,170,90,${0.05 + Math.random() * 0.1})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 3 + 0.4, 0, 7); x.fill(); }
    return {
      canvas: c, chassis: '#141414', roof: black, rim: '#1c1c1c', rimColor: '#1a1a1a', helmet: yellow, coverLeft: false,
      number: yellow, numberOutline: black, numberShadow: sky, paintedTailNumbers: true,
    };
  },

  // #5G Gunnar Setser: black and white. White diagonal panel on the hood sides
  // with SETSER Fabricating, ATC on black, black tail front with sponsor stack and
  // "In Memory of Trevor Perry", white tail back with a big black 5G, raw-steel cage
  setser5g(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const white = '#f4f4f1', black = '#121212', grey = '#9a9da1';
    x.fillStyle = white; x.fillRect(0, 0, S, S);
    const txt = (t, px, py, size, color, opt = {}) => {
      x.font = `${opt.italic ? 'italic ' : ''}${opt.weight || 900} ${Math.floor(size)}px ${opt.font || '"Arial Black", Arial, sans-serif'}`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      if (opt.stroke) { x.lineWidth = size * (opt.sw || 0.16); x.strokeStyle = opt.stroke; x.strokeText(t, px, py, opt.maxW); }
      x.fillStyle = color; x.fillText(t, px, py, opt.maxW);
    };
    // hood sides: black body, white slanted panel with SETSER Fabricating, small sponsors low
    const hoodSide = (w, h, rr) => {
      x.fillStyle = black; x.fillRect(0, 0, w, h);
      x.save(); if (!rr) { x.translate(w, 0); x.scale(-1, 1); } // rear on the right
      x.fillStyle = white;
      x.beginPath(); x.moveTo(w * 0.12, h * 0.72); x.lineTo(w * 0.42, h * 0.08); x.lineTo(w * 0.98, h * 0.08); x.lineTo(w * 0.98, h * 0.72); x.fill();
      x.fillStyle = grey; x.fillRect(w * 0.12, h * 0.72, w * 0.86, h * 0.02);
      x.restore();
      txt('SETSER', rr ? w * 0.62 : w * 0.38, h * 0.32, h * 0.32, black, { italic: true, stroke: white, sw: 0.06, maxW: w * 0.5 });
      txt('Fabricating', rr ? w * 0.64 : w * 0.36, h * 0.56, h * 0.17, black, { italic: true, weight: 700, font: 'Georgia, serif', maxW: w * 0.42 });
      const lows = [['LYNCH', 0.62], ['K&N', 0.42], ["ROB & JO'S", 0.82], ['NOS', 0.28]];
      for (const [t, f] of lows) txt(t, rr ? w * f : w * (1 - f), h * 0.86, h * 0.09, white, { weight: 800, maxW: w * 0.18 });
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    const noseSide = (w, h) => { x.fillStyle = black; x.fillRect(0, 0, w, h); };
    P.flat(R.noseSideL, true, noseSide); P.flat(R.noseSideR, false, noseSide);
    P.flat(R.noseFront, true, (w, h) => { x.fillStyle = black; x.fillRect(0, 0, w, h); });
    // cockpit sides: black with the ATC logo
    const cockSide = (w, h) => {
      x.fillStyle = black; x.fillRect(0, 0, w, h);
      txt('ATC', w * 0.5, h * 0.42, h * 0.22, white, { italic: true, maxW: w * 0.7 });
      txt('Aviation Tax Consultants', w * 0.5, h * 0.58, h * 0.055, white, { weight: 700, maxW: w * 0.8 });
      txt('GUNNAR SETSER', w * 0.5, h * 0.16, h * 0.06, white, { weight: 800, maxW: w * 0.7 });
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail sides: black sponsor panel up front, white behind with a big black 5G
    const tailSide = (w, h, rr) => {
      const fx = rr ? 0 : w * 0.5;
      x.fillStyle = black; x.fillRect(fx, 0, w * 0.5, h);
      const cx = fx + w * 0.25;
      txt('INDY', cx, h * 0.12, h * 0.11, white, { italic: true, maxW: w * 0.42 });
      txt('RACE PARTS', cx, h * 0.2, h * 0.045, white, { weight: 800, maxW: w * 0.4 });
      txt('DVY STEWART RACING', cx, h * 0.3, h * 0.045, white, { weight: 800, maxW: w * 0.44 });
      x.strokeStyle = white; x.lineWidth = h * 0.01; x.strokeRect(fx + w * 0.08, h * 0.37, w * 0.34, h * 0.22);
      txt('THE CURE', cx, h * 0.43, h * 0.05, white, { weight: 800, maxW: w * 0.3 });
      txt('STARTS NOW', cx, h * 0.5, h * 0.05, white, { weight: 800, maxW: w * 0.3 });
      txt('In Memory of', cx, h * 0.67, h * 0.05, white, { weight: 700, font: 'Arial, sans-serif', maxW: w * 0.42 });
      txt('Trevor Perry', cx, h * 0.76, h * 0.065, white, { weight: 700, font: 'Arial, sans-serif', maxW: w * 0.44 });
      // 5G: black block number with a thin white keyline
      txt('5G', rr ? w * 0.66 : w * 0.46, h * 0.56, h * 0.5, black, { stroke: white, sw: 0.06, maxW: w * 0.36 });
      x.fillStyle = black; x.fillRect(rr ? w * 0.5 : w * 0.12, h * 0.9, w * 0.38, h * 0.04);
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    // tail top: white with MTM / RH Excavating, black up front
    P.flat(R.tailTop, true, (w, h) => {
      x.fillStyle = black; x.fillRect(0, h * 0.75, w, h * 0.25);
      x.save(); x.translate(w * 0.5, h * 0.45); x.rotate(-Math.PI / 2);
      txt('MTM', 0, -w * 0.12, w * 0.14, black, { maxW: h * 0.3 });
      txt('RH EXCAVATING', 0, w * 0.1, w * 0.08, black, { maxW: h * 0.5 });
      x.restore();
    });
    P.flat(R.tailRear, true, (w, h) => { x.fillStyle = black; x.fillRect(0, h * 0.86, w, h * 0.14); });
    P.flat(R.hoodTop, true, (w, h) => { x.fillStyle = black; x.fillRect(0, 0, w, h); x.fillStyle = white; x.fillRect(w * 0.55, h * 0.47, w * 0.45, h * 0.06); });
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = white; x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      txt('SETSER', 0, 0, w * 0.6, black, { italic: true, maxW: h * 0.85 });
      x.restore();
    });
    for (let i = 0; i < 500; i++) { x.fillStyle = `rgba(110,85,60,${0.06 + Math.random() * 0.14})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 3 + 0.4, 0, 7); x.fill(); }
    return {
      canvas: c, chassis: '#8c9095', roof: black, rim: '#dfe3e6', helmet: '#f4f4f1', coverLeft: false,
      number: black, numberOutline: white, numberShadow: black, paintedTailNumbers: true,
    };
  },

  // #69 Brady Bacon: white car with red/blue sweeping stripes, Concord American
  // Flagpole on the hood sides, blue eagle on the tail, blue lower tail, BACON plate
  bacon69(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const white = '#f7f7f5', red = '#e0242f', blue = '#1d3f9e', sky = '#3f8de0', black = '#111111';
    x.fillStyle = white; x.fillRect(0, 0, S, S);
    const txt = (t, px, py, size, color, opt = {}) => {
      x.font = `${opt.italic ? 'italic ' : ''}${opt.weight || 900} ${Math.floor(size)}px ${opt.font || '"Arial Black", Arial, sans-serif'}`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      if (opt.stroke) { x.lineWidth = size * (opt.sw || 0.16); x.strokeStyle = opt.stroke; x.strokeText(t, px, py, opt.maxW); }
      x.fillStyle = color; x.fillText(t, px, py, opt.maxW);
    };
    // red + blue stripes sweeping from low at the front up toward the rear
    const sweep = (w, h, rr, y0 = 0.92, y1 = 0.55) => {
      x.save(); if (!rr) { x.translate(w, 0); x.scale(-1, 1); }
      const band = (off, thick, col) => {
        x.fillStyle = col; x.beginPath();
        x.moveTo(0, h * (y0 + off)); x.quadraticCurveTo(w * 0.55, h * (y0 + off - 0.1), w, h * (y1 + off));
        x.lineTo(w, h * (y1 + off + thick)); x.quadraticCurveTo(w * 0.55, h * (y0 + off - 0.1 + thick), 0, h * (y0 + off + thick)); x.fill();
      };
      band(-0.06, 0.035, red); band(0.0, 0.03, sky); band(0.045, 0.06, blue);
      x.restore();
    };
    // hood sides: CONCORD AMERICAN in red, FLAGPOLE spaced out in blue
    const hoodSide = (w, h, rr) => {
      sweep(w, h, rr, 0.98, 0.72);
      x.save(); x.translate(w * 0.56, h * 0.42); x.rotate(rr ? -0.12 : 0.12);
      txt('CONCORD', 0, -h * 0.2, h * 0.28, red, { maxW: w * 0.62 });
      txt('AMERICAN', 0, h * 0.08, h * 0.28, red, { maxW: w * 0.7 });
      x.font = `700 ${Math.floor(h * 0.15)}px Arial, sans-serif`; x.fillStyle = blue; x.textAlign = 'center';
      x.fillText('F  L  A  G  P  O  L  E', 0, h * 0.32, w * 0.66);
      x.restore();
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    const noseSide = (w, h, rr) => { sweep(w, h, rr, 1.0, 0.8); };
    P.flat(R.noseSideL, true, noseSide); P.flat(R.noseSideR, false, noseSide);
    // cockpit sides: stripes continue, a few small sponsors
    const cockSide = (w, h) => {
      x.fillStyle = blue; x.fillRect(0, h * 0.86, w, h * 0.14);
      x.fillStyle = sky; x.fillRect(0, h * 0.82, w, h * 0.04);
      x.fillStyle = red; x.fillRect(0, h * 0.77, w, h * 0.04);
      txt('REO', w * 0.3, h * 0.55, h * 0.1, black);
      txt('JAMES', w * 0.7, h * 0.55, h * 0.08, red, { italic: true });
      txt('PENSKE', w * 0.5, h * 0.68, h * 0.06, black, { weight: 800 });
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail sides: blue eagle up front, red/blue stripe, blue lower rear with the number
    const eagle = (cx, cy, s, flip) => {
      x.save(); x.translate(cx, cy); if (flip) x.scale(-1, 1); x.fillStyle = sky;
      // wings
      for (let i = 0; i < 6; i++) { x.beginPath(); x.moveTo(-s * 0.1, -s * 0.1); x.lineTo(-s * (0.3 + i * 0.12), -s * (0.85 - i * 0.1)); x.lineTo(-s * (0.2 + i * 0.12), -s * (0.75 - i * 0.12)); x.fill(); }
      // body + head
      x.beginPath(); x.ellipse(0, s * 0.1, s * 0.16, s * 0.34, -0.3, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.arc(s * 0.12, -s * 0.25, s * 0.1, 0, Math.PI * 2); x.fill();
      x.beginPath(); x.moveTo(s * 0.2, -s * 0.27); x.lineTo(s * 0.32, -s * 0.22); x.lineTo(s * 0.2, -s * 0.18); x.fill();
      // tail feathers
      x.beginPath(); x.moveTo(-s * 0.1, s * 0.4); x.lineTo(-s * 0.3, s * 0.7); x.lineTo(s * 0.05, s * 0.5); x.fill();
      x.restore();
    };
    const tailSide = (w, h, rr) => {
      x.save(); if (!rr) { x.translate(w, 0); x.scale(-1, 1); }
      x.fillStyle = blue; x.beginPath(); x.moveTo(w * 0.45, h); x.quadraticCurveTo(w * 0.7, h * 0.5, w, h * 0.3); x.lineTo(w, h); x.fill();
      x.fillStyle = red; x.beginPath(); x.moveTo(w * 0.05, h * 0.92); x.quadraticCurveTo(w * 0.55, h * 0.62, w, h * 0.12); x.lineTo(w, h * 0.18); x.quadraticCurveTo(w * 0.55, h * 0.7, w * 0.05, h * 0.97); x.fill();
      x.restore();
      eagle(rr ? w * 0.28 : w * 0.72, h * 0.44, h * 0.5, !rr);
      txt('69', rr ? w * 0.66 : w * 0.46, h * 0.6, h * 0.4, white, { italic: true, stroke: black, sw: 0.2, maxW: w * 0.26 });
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    P.flat(R.tailTop, true, (w, h) => { x.fillStyle = blue; x.fillRect(0, 0, w, h * 0.35); x.fillStyle = red; x.fillRect(0, h * 0.35, w, h * 0.04); });
    P.flat(R.tailRear, true, (w, h) => { x.fillStyle = blue; x.fillRect(0, 0, w, h); });
    // hood top: white with the red R Racer box toward the front
    P.flat(R.hoodTop, true, (w, h) => {
      x.save(); x.translate(w * 0.32, h * 0.5); x.rotate(Math.PI / 2);
      x.fillStyle = red; x.fillRect(-h * 0.12, -w * 0.07, h * 0.24, w * 0.14);
      txt('R', 0, -w * 0.01, w * 0.1, white, { italic: true });
      x.restore();
    });
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = black; x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      txt('BACON', 0, 0, w * 0.6, white, { italic: true, stroke: red, sw: 0.1, maxW: h * 0.85 });
      x.restore();
    });
    for (let i = 0; i < 400; i++) { x.fillStyle = `rgba(140,100,70,${0.06 + Math.random() * 0.12})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 3 + 0.4, 0, 7); x.fill(); }
    return {
      canvas: c, chassis: '#141414', roof: black, rim: '#dfe3e6', helmet: '#cfe6ff', coverLeft: false,
      number: white, numberOutline: black, numberShadow: white, paintedTailNumbers: true,
    };
  },

  // #4 Justin Grant: black carbon on top, blue below with orange pinstripes,
  // big white NOS Energy Drink on the hood sides, white 4 on the blue nose,
  // Topp / MPV / Hemelgarn stack on the tail, GRANT plate, black wheels
  grant4(drv) {
    const S = 1024, k = S / ATLAS;
    const c = canvas(S, S), x = c.getContext('2d');
    const P = sidePainter(x, k), R = P.R;
    const carbon = '#16181c', blue = '#1f6fe0', orange = '#ff6a1a', white = '#ffffff', black = '#0b0b0b';
    // carbon weave as the base
    x.fillStyle = carbon; x.fillRect(0, 0, S, S);
    for (let yy = 0; yy < S; yy += 4) for (let xx = (yy / 4) % 2 ? 0 : 4; xx < S; xx += 8) { x.fillStyle = 'rgba(255,255,255,0.035)'; x.fillRect(xx, yy, 4, 4); }
    const txt = (t, px, py, size, color, opt = {}) => {
      x.font = `${opt.italic ? 'italic ' : ''}${opt.weight || 900} ${Math.floor(size)}px ${opt.font || '"Arial Black", Arial, sans-serif'}`;
      x.textAlign = 'center'; x.textBaseline = 'middle'; x.lineJoin = 'round';
      if (opt.stroke) { x.lineWidth = size * (opt.sw || 0.16); x.strokeStyle = opt.stroke; x.strokeText(t, px, py, opt.maxW); }
      x.fillStyle = color; x.fillText(t, px, py, opt.maxW);
    };
    // lower body: blue sweeping up toward the front, outlined in orange
    const blueSweep = (w, h, rr, lowAtRear = 0.62, highAtFront = 0.2) => {
      x.save(); if (!rr) { x.translate(w, 0); x.scale(-1, 1); } // shapes drawn with the rear on the right
      x.fillStyle = blue;
      x.beginPath(); x.moveTo(0, h * highAtFront); x.quadraticCurveTo(w * 0.35, h * (highAtFront + 0.05), w, h * lowAtRear); x.lineTo(w, h); x.lineTo(0, h); x.fill();
      x.strokeStyle = orange; x.lineWidth = h * 0.035;
      x.beginPath(); x.moveTo(0, h * (highAtFront - 0.04)); x.quadraticCurveTo(w * 0.35, h * (highAtFront + 0.01), w, h * (lowAtRear - 0.04)); x.stroke();
      x.restore();
    };
    // hood sides: carbon up top, blue low, big NOS Energy Drink with the arrow
    const hoodSide = (w, h, rr) => {
      blueSweep(w, h, rr, 0.78, 0.62);
      const cx = w * 0.5;
      txt('NOS', rr ? w * 0.32 : w * 0.68, h * 0.47, h * 0.66, white, { italic: true, stroke: orange, sw: 0.07, maxW: w * 0.44 });
      txt('ENERGY', rr ? w * 0.74 : w * 0.26, h * 0.33, h * 0.3, white, { maxW: w * 0.4 });
      txt('DRINK', rr ? w * 0.74 : w * 0.26, h * 0.62, h * 0.3, white, { maxW: w * 0.4 });
      // the arrow over NOS
      x.fillStyle = white; const ax = rr ? w * 0.16 : w * 0.84, dir = rr ? 1 : -1;
      x.fillRect(Math.min(ax, ax + dir * w * 0.3), h * 0.16, w * 0.3, h * 0.05);
      x.beginPath(); x.moveTo(ax + dir * w * 0.34, h * 0.185); x.lineTo(ax + dir * w * 0.29, h * 0.1); x.lineTo(ax + dir * w * 0.29, h * 0.27); x.fill();
    };
    P.flat(R.hoodSideL, true, hoodSide);
    P.flat(R.hoodSideR, false, hoodSide);
    // nose: blue with a big white 4
    const noseSide = (w, h) => {
      x.fillStyle = blue; x.fillRect(0, 0, w, h);
      x.strokeStyle = orange; x.lineWidth = h * 0.05; x.strokeRect(0, h * 0.04, w, h * 0.92);
      txt('4', w * 0.5, h * 0.52, h * 0.9, white, { italic: true, stroke: black, sw: 0.14, maxW: w * 0.6 });
    };
    P.flat(R.noseSideL, true, noseSide); P.flat(R.noseSideR, false, noseSide);
    P.flat(R.noseFront, true, (w, h) => { x.fillStyle = blue; x.fillRect(0, 0, w, h); });
    // cockpit sides: carbon with a blue lower panel full of small sponsors
    const cockSide = (w, h) => {
      x.fillStyle = blue; x.fillRect(0, h * 0.5, w, h * 0.5);
      x.fillStyle = orange; x.fillRect(0, h * 0.47, w, h * 0.03);
      txt('GRANT', w * 0.5, h * 0.2, h * 0.08, white, { weight: 800 });
      const items = [['HINCHMAN', 0.3, 0.6], ['MAXIM', 0.74, 0.6], ['BELL', 0.3, 0.74], ['ULTRA SHIELD', 0.72, 0.74], ['FK', 0.3, 0.88], ['HOOSIER', 0.72, 0.88]];
      for (const [t, fx, fy] of items) txt(t, w * fx, h * fy, h * 0.07, white, { weight: 800, maxW: w * 0.42 });
    };
    P.rot90(R.cockpitL, true, cockSide); P.rot90(R.cockpitR, false, cockSide);
    // tail sides: carbon with orange edge, sponsor stack in white
    const tailSide = (w, h, rr) => {
      x.fillStyle = blue; x.fillRect(0, h * 0.82, w, h * 0.18);
      x.fillStyle = orange; x.fillRect(rr ? w * 0.94 : 0, 0, w * 0.06, h * 0.82);
      const cx = w * 0.5;
      txt('TOPP', cx, h * 0.14, h * 0.13, white, { italic: true, maxW: w * 0.6 });
      txt('MOTORSPORTS', cx, h * 0.25, h * 0.06, white, { weight: 800, maxW: w * 0.6 });
      txt('TOPP', cx, h * 0.39, h * 0.11, white, { font: 'Georgia, serif', maxW: w * 0.6 });
      txt('INDUSTRIES INC.', cx, h * 0.48, h * 0.05, white, { weight: 700, maxW: w * 0.6 });
      txt('MPV', cx, h * 0.6, h * 0.12, white, { italic: true, maxW: w * 0.5 });
      txt('LOGISTICS', cx, h * 0.69, h * 0.05, white, { weight: 800, maxW: w * 0.5 });
      x.fillStyle = white; x.fillRect(w * 0.2, h * 0.74, w * 0.6, h * 0.07);
      txt('HEMELGARN', cx, h * 0.775, h * 0.055, black, { maxW: w * 0.56 });
    };
    P.flat(R.tailSideL, true, tailSide); P.rot180(R.tailSideR, false, tailSide);
    // hood top: carbon with stacked NOS / TOPP / MPV logos
    P.flat(R.hoodTop, true, (w, h) => {
      const at = [['NOS', 0.62, 0.17], ['TOPP', 0.44, 0.1], ['MPV', 0.3, 0.1], ['TOPP INC', 0.18, 0.08]];
      for (const [t, u, sz] of at) { x.save(); x.translate(w * u, h * 0.5); x.rotate(Math.PI / 2); txt(t, 0, 0, w * sz, white, { italic: true, maxW: h * 0.6 }); x.restore(); }
      x.fillStyle = blue; x.fillRect(0, 0, w * 0.12, h);
    });
    P.flat(R.tailTop, true, (w, h) => { x.fillStyle = blue; x.fillRect(0, 0, w * 0.12, h); x.fillRect(w * 0.88, 0, w * 0.12, h); });
    P.flat(R.tailRear, true, (w, h) => { x.fillStyle = blue; x.fillRect(0, h * 0.6, w, h * 0.4); });
    // cage plate: GRANT
    P.flat(R.namePlate, true, (w, h) => {
      x.fillStyle = blue; x.fillRect(0, 0, w, h);
      x.save(); x.translate(w / 2, h / 2); x.rotate(-Math.PI / 2);
      txt('GRANT', 0, 0, w * 0.62, black, { italic: true, maxW: h * 0.85 });
      x.restore();
    });
    for (let i = 0; i < 300; i++) { x.fillStyle = `rgba(160,90,45,${0.06 + Math.random() * 0.12})`; x.beginPath(); x.arc(Math.random() * S, Math.random() * S, Math.random() * 3 + 0.4, 0, 7); x.fill(); }
    return {
      canvas: c, chassis: '#121212', roof: blue, rim: '#1c1c1c', rimColor: '#1a1a1a', helmet: '#151515', coverLeft: false,
      number: white, numberOutline: black, numberShadow: blue, paintedTailNumbers: true,
    };
  },

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
      const nx = rr ? w * 0.7 : w * 0.46;
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
      x.strokeText('3P', rr ? w * 0.66 : w * 0.46, h * 0.48, w * 0.4);
      txt('3P', rr ? w * 0.66 : w * 0.46, h * 0.48, h * 0.55, red, 900, w * 0.4, black);
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
  // black Hoosiers: white lettering on the sidewalls, clay packed into the tread
  const c = canvas(1024, 128), x = c.getContext('2d');
  x.fillStyle = '#1f1d1c'; x.fillRect(0, 0, 1024, 128);           // rubber
  x.fillStyle = '#4b3a2e'; x.fillRect(0, 22, 1024, 84);           // tread with clay in it
  x.strokeStyle = 'rgba(20,16,13,0.9)'; x.lineWidth = 2;           // tread blocks
  for (let y = 26; y < 104; y += 6) { x.beginPath(); x.moveTo(0, y); x.lineTo(1024, y); x.stroke(); }
  for (let u = 0; u < 1024; u += 9) { x.beginPath(); x.moveTo(u, 22); x.lineTo(u, 106); x.stroke(); }
  for (let i = 0; i < 1400; i++) {
    x.fillStyle = `rgba(${150 + Math.random() * 50},${90 + Math.random() * 35},${50 + Math.random() * 20},${0.08 + Math.random() * 0.22})`;
    x.fillRect(Math.random() * 1024, 18 + Math.random() * 92, 2 + Math.random() * 10, 1 + Math.random() * 3);
  }
  // sidewalls: the lathe profile runs inner edge -> tread -> inner edge, so each
  // sidewall is a thin band at the top and bottom of the texture
  x.fillStyle = '#ecebe6'; x.textAlign = 'center'; x.textBaseline = 'middle';
  x.font = 'italic 900 15px Georgia, "Times New Roman", serif';
  for (const [y, flip] of [[9, false], [119, true]]) {
    for (let i = 0; i < 2; i++) {
      x.save(); x.translate(256 + i * 512, y); if (flip) x.scale(-1, -1);
      x.scale(3.2, 1); x.fillText('Hoosier', 0, 0); x.restore();
    }
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.anisotropy = 4;
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

const _rimMatsByColor = {};
function rimMatFor(color) {
  return _rimMatsByColor[color] || (_rimMatsByColor[color] = new THREE.MeshPhongMaterial({ color, shininess: 90, specular: '#666666', side: THREE.DoubleSide }));
}
function wheel(R, Ri, w, side, atlasMat, coverRect, rimColor) {
  const g = new THREE.Group();
  const tire = new THREE.Mesh(tireGeo(R, Ri, w), tireMat());
  if (side === LEFT) tire.rotation.y = Math.PI; // so the Hoosier lettering reads right on both sides
  g.add(tire);
  let [rimM, darkM] = rimMats();
  if (rimColor) rimM = rimMatFor(rimColor); // painted / black wheels
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
  wheels.fl = wheel(0.3, 0.19, 0.2, LEFT, atlasMat, liv.coverLeft ? PAINT_REGIONS.wheelFront : null, liv.rimColor); fl.add(wheels.fl);
  wheels.fr = wheel(0.3, 0.19, 0.22, RIGHT, atlasMat, null, liv.rimColor); fr.add(wheels.fr);
  car.add(fl, fr);
  wheels.rl = wheel(0.43, 0.2, 0.36, LEFT, atlasMat, liv.coverLeft ? PAINT_REGIONS.wheelRear : null, liv.rimColor); wheels.rl.position.set(LEFT * 0.82, 0.43, -1.06);
  wheels.rr = wheel(0.455, 0.2, 0.44, RIGHT, atlasMat, null, liv.rimColor); wheels.rr.position.set(RIGHT * 0.88, 0.455, -1.06);
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
