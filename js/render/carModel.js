// Low-poly 410 non-wing sprint car. Local axes: +Z forward, +Y up, +X = LEFT side.
import * as THREE from 'three';

const RIGHT = -1, LEFT = 1;

const geoCache = {};
function cyl(r, len, seg = 10) {
  const k = `c${r}_${len}_${seg}`;
  return geoCache[k] || (geoCache[k] = new THREE.CylinderGeometry(r, r, len, seg));
}
const tubeMatCache = {};
function tubeMat(color) {
  return tubeMatCache[color] || (tubeMatCache[color] = new THREE.MeshLambertMaterial({ color }));
}

// tube between two points
function tube(a, b, r, mat) {
  const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
  const len = A.distanceTo(B);
  const m = new THREE.Mesh(cyl(r, len, 6), mat);
  m.position.copy(A).add(B).multiplyScalar(0.5);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize());
  return m;
}

function mergeInto(meshes, mat) {
  // bake transforms then merge into one geometry (one draw call)
  const geos = meshes.map((m) => { m.updateMatrix(); const g = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone(); g.applyMatrix4(m.matrix); return g; });
  let count = 0; geos.forEach((g) => (count += g.attributes.position.count));
  const pos = new Float32Array(count * 3), nor = new Float32Array(count * 3);
  let o = 0;
  for (const g of geos) {
    pos.set(g.attributes.position.array, o * 3);
    nor.set(g.attributes.normal.array, o * 3);
    o += g.attributes.position.count;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return new THREE.Mesh(geo, mat);
}

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}
function tex(c) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function drawNumber(ctx, num, x, y, size, fill, stroke, strokeW = size * 0.09) {
  ctx.font = `italic 900 ${size}px "Arial Black", Impact, "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineJoin = 'round';
  ctx.lineWidth = strokeW * 2;
  ctx.strokeStyle = stroke;
  ctx.strokeText(num, x, y);
  ctx.fillStyle = fill;
  ctx.fillText(num, x, y);
}

// ---------- liveries ----------
// Returns { tailSide, tailTop, hoodSide, hoodTop, cockpitSide, nose, body, chassis } textures/colors.
function aiLivery(drv) {
  const [body, accent, numCol] = drv.colors;
  const outline = numCol.toLowerCase() === '#ffffff' || numCol.toLowerCase() === '#ffd100' ? '#111' : '#fff';

  const tail = canvas(320, 200), c1 = tail.getContext('2d');
  c1.fillStyle = body; c1.fillRect(0, 0, 320, 200);
  c1.fillStyle = accent;
  c1.beginPath(); c1.moveTo(0, 150); c1.lineTo(320, 110); c1.lineTo(320, 135); c1.lineTo(0, 175); c1.fill();
  drawNumber(c1, drv.number, 160, 92, 128, numCol, outline);

  const top = canvas(200, 240), c2 = top.getContext('2d');
  c2.fillStyle = body; c2.fillRect(0, 0, 200, 240);
  c2.fillStyle = accent; c2.fillRect(0, 0, 200, 22); c2.fillRect(0, 218, 200, 22);
  drawNumber(c2, drv.number, 100, 122, 110, numCol, outline);

  const hood = canvas(384, 128), c3 = hood.getContext('2d');
  c3.fillStyle = body; c3.fillRect(0, 0, 384, 128);
  c3.fillStyle = accent;
  c3.beginPath(); c3.moveTo(0, 128); c3.lineTo(150, 0); c3.lineTo(190, 0); c3.lineTo(40, 128); c3.fill();
  c3.font = 'italic 800 38px "Arial Black", Arial, sans-serif';
  c3.fillStyle = numCol; c3.textAlign = 'center'; c3.textBaseline = 'middle';
  c3.strokeStyle = outline; c3.lineWidth = 5; c3.lineJoin = 'round';
  const last = drv.name.split(' ').slice(-1)[0].toUpperCase();
  c3.strokeText(last, 260, 66); c3.fillText(last, 260, 66);

  const hoodTop = canvas(128, 160), c4 = hoodTop.getContext('2d');
  c4.fillStyle = body; c4.fillRect(0, 0, 128, 160);
  c4.fillStyle = accent; c4.fillRect(50, 0, 28, 160);

  const cock = canvas(160, 128), c5 = cock.getContext('2d');
  c5.fillStyle = body; c5.fillRect(0, 0, 160, 128);
  c5.fillStyle = accent; c5.fillRect(0, 96, 160, 14);

  return {
    tailSide: tex(tail), tailTop: tex(top), hoodSide: tex(hood), hoodTop: tex(hoodTop),
    cockpitSide: tex(cock), nose: null, body, chassis: drv.chassis || '#d9d9d9', rim: accent,
  };
}

const imgCache = {};
function loadImg(src) {
  return imgCache[src] || (imgCache[src] = new Promise((res) => {
    const im = new Image();
    im.onload = () => res(im);
    im.onerror = () => res(null);
    im.src = src;
  }));
}

// Player car: RACO Marketing black & gold scheme, #44, built from the iRacing paint file panels.
async function playerLivery(drv, base = 'assets/paint/') {
  const [banner, hoodImg, burst] = await Promise.all([
    loadImg(base + 'raco-banner.jpg'), loadImg(base + 'raco-hood.jpg'), loadImg(base + 'raco-burst.jpg'),
  ]);
  const gold = '#f2cf7e', black = '#0b0b0e';
  const fillBurst = (ctx, w, h) => {
    ctx.fillStyle = black; ctx.fillRect(0, 0, w, h);
    if (burst) {
      const s = Math.max(w / burst.width, h / burst.height);
      ctx.drawImage(burst, (w - burst.width * s) / 2, (h - burst.height * s) / 2, burst.width * s, burst.height * s);
    }
  };

  const tail = canvas(512, 320), c1 = tail.getContext('2d');
  fillBurst(c1, 512, 320);
  c1.fillStyle = gold; c1.fillRect(0, 0, 512, 14); c1.fillRect(0, 300, 512, 20);
  drawNumber(c1, drv.number, 256, 158, 230, '#ffffff', gold, 12);

  const top = canvas(256, 300), c2 = top.getContext('2d');
  fillBurst(c2, 256, 300);
  c2.fillStyle = gold; c2.fillRect(0, 0, 256, 12); c2.fillRect(0, 288, 256, 12);
  drawNumber(c2, drv.number, 128, 152, 150, '#ffffff', gold, 9);

  const hood = canvas(768, 250), c3 = hood.getContext('2d');
  if (banner) c3.drawImage(banner, 0, 0, 768, 250); else { c3.fillStyle = black; c3.fillRect(0, 0, 768, 250); }

  const hoodTop = canvas(432, 512), c4 = hoodTop.getContext('2d');
  if (hoodImg) c4.drawImage(hoodImg, 0, 0, 432, 512); else fillBurst(c4, 432, 512);

  const cock = canvas(400, 320), c5 = cock.getContext('2d');
  fillBurst(c5, 400, 320);
  if (banner) c5.drawImage(banner, 170, 0, 598, 250, 0, 60, 400, 167);
  c5.fillStyle = gold; c5.fillRect(0, 290, 400, 16);

  const nose = canvas(256, 256), c6 = nose.getContext('2d');
  fillBurst(c6, 256, 256);

  return {
    tailSide: tex(tail), tailTop: tex(top), hoodSide: tex(hood), hoodTop: tex(hoodTop),
    cockpitSide: tex(cock), nose: tex(nose), body: black, chassis: '#1c1c1c', rim: gold,
  };
}

function decal(w, h, texture, pos, rot, order) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshLambertMaterial({ map: texture }));
  m.position.set(...pos);
  if (order) m.rotation.order = order;
  m.rotation.set(...rot);
  return m;
}

function wheel(radius, width, rimColor, side) {
  const g = new THREE.Group();
  const tireM = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, width, 18, 1), tubeMat('#1b1917'));
  tireM.rotation.z = Math.PI / 2;
  g.add(tireM);
  // rim face on the outside + tread marks so rotation reads
  const rim = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.62, 16), new THREE.MeshLambertMaterial({ color: rimColor }));
  rim.position.x = side * (width / 2 + 0.003);
  rim.rotation.y = side * Math.PI / 2;
  g.add(rim);
  const hub = new THREE.Mesh(new THREE.CircleGeometry(radius * 0.18, 8), tubeMat('#888'));
  hub.position.x = side * (width / 2 + 0.006);
  hub.rotation.y = side * Math.PI / 2;
  g.add(hub);
  const spoke = new THREE.Mesh(new THREE.BoxGeometry(0.01, radius * 1.1, 0.05), tubeMat('#333'));
  spoke.position.x = side * (width / 2 + 0.008);
  g.add(spoke);
  return g;
}

export async function buildSprintCar(drv) {
  const liv = drv.isPlayer ? await playerLivery(drv) : aiLivery(drv);
  const car = new THREE.Group();
  const body = new THREE.Group();
  car.add(body);
  const bodyMat = new THREE.MeshLambertMaterial({ color: liv.body });
  const chassis = tubeMat(liv.chassis);

  // ---- body panels ----
  const hood = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.42, 1.2), bodyMat);
  hood.position.set(0, 0.61, 0.6);
  body.add(hood);
  body.add(decal(1.18, 0.38, liv.hoodSide, [LEFT * 0.282, 0.62, 0.6], [0, Math.PI / 2, 0]));
  body.add(decal(1.18, 0.38, liv.hoodSide, [RIGHT * 0.282, 0.62, 0.6], [0, -Math.PI / 2, 0]));
  body.add(decal(0.52, 0.62, liv.hoodTop, [0, 0.822, 0.82], [-Math.PI / 2, Math.PI, 0], 'YXZ'));

  const nose = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.4, 0.5), bodyMat);
  nose.position.set(0, 0.56, 1.42);
  body.add(nose);
  const grille = new THREE.Mesh(new THREE.PlaneGeometry(0.4, 0.32), new THREE.MeshLambertMaterial({ color: '#222', map: liv.nose || null }));
  grille.position.set(0, 0.56, 1.672);
  body.add(grille);

  const cockpit = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.5, 0.78), bodyMat);
  cockpit.position.set(0, 0.6, -0.37);
  body.add(cockpit);
  body.add(decal(0.76, 0.5, liv.cockpitSide, [LEFT * 0.392, 0.62, -0.37], [0, Math.PI / 2, 0]));
  body.add(decal(0.76, 0.5, liv.cockpitSide, [RIGHT * 0.392, 0.62, -0.37], [0, -Math.PI / 2, 0]));

  // tail tank: front taller than back
  const tailG = new THREE.BoxGeometry(0.72, 0.6, 0.92);
  const tp = tailG.attributes.position;
  for (let i = 0; i < tp.count; i++) {
    if (tp.getY(i) > 0 && tp.getZ(i) < 0) tp.setY(i, tp.getY(i) - 0.16);
    if (tp.getZ(i) < 0) tp.setX(i, tp.getX(i) * 0.85);
  }
  tailG.computeVertexNormals();
  const tail = new THREE.Mesh(tailG, bodyMat);
  tail.position.set(0, 1.0, -1.2);
  body.add(tail);
  body.add(decal(0.8, 0.42, liv.tailSide, [LEFT * 0.345, 1.0, -1.17], [0, Math.PI / 2 - 0.03, 0]));
  body.add(decal(0.8, 0.42, liv.tailSide, [RIGHT * 0.345, 1.0, -1.17], [0, -Math.PI / 2 + 0.03, 0]));
  const topD = decal(0.6, 0.78, liv.tailTop, [0, 1.225, -1.2], [-Math.PI / 2 + 0.17, Math.PI, 0], 'YXZ');
  body.add(topD);

  // ---- driver ----
  const helmet = new THREE.Group();
  const shell = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 10), new THREE.MeshLambertMaterial({ color: drv.isPlayer ? '#f2cf7e' : liv.rim }));
  helmet.add(shell);
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.152, 10, 6, Math.PI / 2 - 0.9, 1.8, 1.2, 0.6), new THREE.MeshLambertMaterial({ color: '#111' }));
  visor.rotation.y = 0;
  helmet.add(visor);
  helmet.position.set(0, 1.12, -0.48);
  body.add(helmet);
  const shoulders = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.22, 0.28), tubeMat('#1b1b1b'));
  shoulders.position.set(0, 0.92, -0.5);
  body.add(shoulders);

  // steering wheel (for cockpit cam)
  const sw = new THREE.Mesh(new THREE.TorusGeometry(0.15, 0.018, 6, 18), tubeMat('#111'));
  sw.position.set(0, 0.9, -0.1);
  sw.rotation.x = -0.35;
  body.add(sw);

  // ---- cage + chassis tubes (merged) ----
  const tubes = [];
  const r = 0.022;
  const yTop = 1.42, zf = 0.05, zr = -0.78, xw = 0.36, xt = 0.3;
  for (const sx of [-1, 1]) {
    tubes.push(tube([sx * xw, 0.82, zf], [sx * xt, yTop, zf - 0.1], r, chassis));     // front hoop legs
    tubes.push(tube([sx * xw, 0.82, zr], [sx * xt, yTop, zr + 0.06], r, chassis));    // rear hoop legs
    tubes.push(tube([sx * xt, yTop, zf - 0.1], [sx * xt, yTop, zr + 0.06], r, chassis)); // top rails
    tubes.push(tube([sx * xw, 0.82, zr], [sx * xt, yTop, zf - 0.1], r * 0.8, chassis)); // diagonals
    // nerf bars
    tubes.push(tube([sx * 0.42, 0.36, 0.7], [sx * 0.88, 0.36, 0.45], r, chassis));
    tubes.push(tube([sx * 0.88, 0.36, 0.45], [sx * 0.88, 0.36, -0.62], r, chassis));
    tubes.push(tube([sx * 0.88, 0.36, -0.62], [sx * 0.42, 0.36, -0.82], r, chassis));
    // front radius rods
    tubes.push(tube([sx * 0.25, 0.42, 0.75], [sx * 0.7, 0.33, 1.07], r * 0.7, chassis));
  }
  tubes.push(tube([xt, yTop, zf - 0.1], [-xt, yTop, zf - 0.1], r, chassis));
  tubes.push(tube([xt, yTop, zr + 0.06], [-xt, yTop, zr + 0.06], r, chassis));
  tubes.push(tube([0.78, 0.33, 1.07], [-0.78, 0.33, 1.07], r * 1.3, chassis)); // front axle
  tubes.push(tube([0.6, 0.45, -1.06], [-0.6, 0.45, -1.06], r * 1.6, chassis)); // rear axle housing
  tubes.push(tube([0.3, 0.45, 1.88], [-0.3, 0.45, 1.88], r, chassis));       // front bumper
  tubes.push(tube([0.3, 0.45, 1.88], [0.22, 0.45, 1.65], r, chassis));
  tubes.push(tube([-0.3, 0.45, 1.88], [-0.22, 0.45, 1.65], r, chassis));
  tubes.push(tube([0.42, 0.62, -1.85], [-0.42, 0.62, -1.85], r, chassis));   // rear bumper
  tubes.push(tube([0.42, 0.62, -1.85], [0.3, 0.62, -1.62], r, chassis));
  tubes.push(tube([-0.42, 0.62, -1.85], [-0.3, 0.62, -1.62], r, chassis));
  tubes.push(tube([0.25, 0.35, 0.6], [-0.25, 0.35, 0.6], r, chassis));
  body.add(mergeInto(tubes, chassis));

  // headers out the right side
  const hdr = [];
  const hdrMat = tubeMat('#9a9a9a');
  for (let i = 0; i < 4; i++) {
    const z0 = 0.95 - i * 0.2;
    hdr.push(tube([RIGHT * 0.26, 0.66, z0], [RIGHT * 0.5, 0.74 - i * 0.02, z0 - 0.5], 0.03, hdrMat));
  }
  hdr.push(tube([RIGHT * 0.5, 0.7, 0.0], [RIGHT * 0.55, 0.68, -0.95], 0.06, hdrMat));
  body.add(mergeInto(hdr, hdrMat));

  // ---- wheels ----
  const rim = liv.rim;
  const wheels = {};
  const fl = new THREE.Group(), fr = new THREE.Group();
  fl.position.set(LEFT * 0.8, 0.33, 1.07);
  fr.position.set(RIGHT * 0.8, 0.33, 1.07);
  wheels.fl = wheel(0.33, 0.22, rim, LEFT); fl.add(wheels.fl);
  wheels.fr = wheel(0.33, 0.24, rim, RIGHT); fr.add(wheels.fr);
  car.add(fl, fr);
  wheels.rl = wheel(0.43, 0.36, rim, LEFT); wheels.rl.position.set(LEFT * 0.78, 0.43, -1.06);
  wheels.rr = wheel(0.46, 0.44, rim, RIGHT); wheels.rr.position.set(RIGHT * 0.86, 0.46, -1.06);
  car.add(wheels.rl, wheels.rr);

  // blob shadow
  const sh = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 4.2), shadowMat());
  sh.rotation.x = -Math.PI / 2;
  sh.position.y = 0.03;
  sh.renderOrder = 1;
  car.add(sh);

  car.userData = { wheels, steerL: fl, steerR: fr, helmet, shoulders, body };
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
