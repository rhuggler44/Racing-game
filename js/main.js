import * as THREE from 'three';
import { buildTrack, Surface, PREPS, LINCOLN_PARK } from './track.js';
import { Session } from './session.js';
import { DRIVERS, PLAYER } from './drivers.js';
import { Input } from './input.js';
import { Sound } from './audio.js';
import { TrackScene } from './render/scene.js';
import { buildSprintCar, poseCar } from './render/carModel.js';
import { Dust } from './render/effects.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

// ---------------- settings ----------------
const DEFAULTS = {
  controls: 'tilt', tiltRange: 25, invert: false, assists: true, handling: 'easy', camera: 'chase', quality: 'high', volume: 0.9,
  laps: 25, field: 22, difficulty: 'pro', startPos: 'random', prep: 'dialed', hotPrep: 'dialed', time: 'night',
};
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* private mode */ } },
};
const settings = { ...DEFAULTS, ...store.get('lps.settings', {}) };
const isTouch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
if (!isTouch && !store.get('lps.settings', null)) settings.controls = 'touch';
const saveSettings = () => store.set('lps.settings', settings);

// ---------------- renderer ----------------
const canvasEl = $('game');
const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, powerPreference: 'high-performance' });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
const scene = new THREE.Scene();
scene.background = new THREE.Color('#070a14');
scene.fog = new THREE.Fog('#0b0f1c', 140, 650);
const camera = new THREE.PerspectiveCamera(62, 1, 0.05, 2000);
const hemi = new THREE.HemisphereLight('#c9d6ff', '#3b2a1c', 0.9);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fff3dc', 1.7);
sun.position.set(40, 120, 30);
scene.add(sun);
scene.add(sun.target);
// shadows only around the player's car, so they stay cheap
sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 300 });
sun.shadow.bias = -0.0008;
sun.shadow.normalBias = 0.02;
const sunOffset = new THREE.Vector3(40, 120, 30);
const ambient = new THREE.AmbientLight('#ffffff', 0.25);
scene.add(ambient);
function applyTime() {
  const day = settings.time === 'day';
  trackScene.setTime(settings.time);
  scene.background.set(day ? '#9cc4ea' : '#070a14');
  scene.fog.color.set(day ? '#b9d3ea' : '#0b0f1c');
  scene.fog.near = day ? 220 : 140; scene.fog.far = day ? 1100 : 650;
  hemi.color.set(day ? '#dcebff' : '#c9d6ff'); hemi.intensity = day ? 1.1 : 0.9;
  sun.intensity = day ? 2.6 : 1.7; sunOffset.set(day ? 120 : 40, day ? 160 : 120, day ? -60 : 30);
  ambient.intensity = day ? 0.35 : 0.25;
}

function applyQuality() {
  const dpr = window.devicePixelRatio || 1;
  sun.castShadow = settings.quality !== 'low';
  renderer.setPixelRatio(settings.quality === 'low' ? Math.min(dpr, 1.25) : Math.min(dpr, 2));
}
function resize() {
  applyQuality();
  const w = window.innerWidth, h = window.innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  dust.setViewport(h * renderer.getPixelRatio());
  checkOrientation();
}

// ---------------- world ----------------
const track = buildTrack(LINCOLN_PARK);
const surface = new Surface(track, settings.prep);
const trackScene = new TrackScene(track, surface, settings.quality);
scene.add(trackScene.group);
applyTime();
const dust = new Dust(settings.quality === 'low' ? 500 : 900);
scene.add(dust.points);

const input = new Input(settings);
input.bindPedals($('pedal-gas'), $('pedal-brake'), $('steer-zone'));
const sound = new Sound();
sound.setVolume(settings.volume);

let playerMesh = null;
const aiMeshes = new Map(); // driver -> mesh
let session = null;
let paused = true;
let state = 'menu';
let camMode = settings.camera;
let lastSessionOpts = null;

// ---------------- car meshes ----------------
async function ensureCars(drivers) {
  if (!playerMesh) { playerMesh = await buildSprintCar(PLAYER); scene.add(playerMesh); }
  const need = drivers.filter((d) => !aiMeshes.has(d));
  const built = await Promise.all(need.map((d) => buildSprintCar(d)));
  need.forEach((d, i) => { aiMeshes.set(d, built[i]); scene.add(built[i]); });
  for (const [d, m] of aiMeshes) m.visible = drivers.includes(d);
}

const _up = new THREE.Vector3(), _f = new THREE.Vector3(), _l = new THREE.Vector3(), _m = new THREE.Matrix4();
const _sm = {};
function placeCar(mesh, x, z, heading, s, d, roll = 0) {
  const W = track.W;
  const onTrack = d > -W / 2 && d < W / 2 + 0.5;
  const sm = track.sample(s, _sm);
  const b = onTrack ? sm.bank : 0;
  _up.set(-sm.nx * Math.sin(b), Math.cos(b), -sm.nz * Math.sin(b)).normalize();
  _f.set(Math.cos(heading), 0, Math.sin(heading));
  _l.crossVectors(_up, _f).normalize();
  _f.crossVectors(_l, _up).normalize();
  if (roll) { _up.applyAxisAngle(_f, roll); _l.crossVectors(_up, _f).normalize(); }
  _m.makeBasis(_l, _up, _f);
  mesh.quaternion.setFromRotationMatrix(_m);
  mesh.position.set(x, track.height(s, Math.min(d, W / 2), surface), z);
}

// ---------------- session control ----------------
async function startSession(mode) {
  state = 'loading';
  show('loading');
  const isRace = mode === 'race';
  const prep = isRace ? settings.prep : settings.hotPrep;
  surface.setPrep(prep);
  const drivers = isRace ? DRIVERS.slice(0, settings.field - 1) : [];
  await ensureCars(drivers);
  session = new Session({
    track, surface, mode, laps: settings.laps, fieldSize: settings.field, difficulty: settings.difficulty,
    startPos: settings.startPos, drivers: DRIVERS, player: PLAYER, assists: settings.assists, handling: settings.handling,
  });
  if (!isRace) session.bestLap = store.get(`lps.best.${prep}`, Infinity) || Infinity;
  session.hotPrep = prep;
  session.onLap = (lt, pb) => {
    sound.beep(pb ? 1320 : 990, 0.12);
    if (pb) store.set(`lps.best.${prep}`, lt);
  };
  session.onGreen = () => { sound.beep(1200, 0.4); input.recenter(); };
  session.onDone = () => setTimeout(showResults, 1500);
  session.onContact = (s) => sound.hit(s * 0.6);
  lastSessionOpts = mode;
  applyTime();
  trackScene.updateSurface(true);
  playerMesh.userData.flipT = 0;
  hideAll();
  $('hud').classList.remove('hidden');
  document.body.classList.toggle('touch-steer', settings.controls === 'touch');
  $('tower').classList.toggle('hidden', !isRace);
  setCam(settings.camera);
  camInit = true;
  paused = false;
  state = 'playing';
  setTimeout(() => input.recenter(), 400);
  checkOrientation();
}

function setCam(m) {
  camMode = m;
  if (playerMesh) {
    playerMesh.userData.helmet.visible = m !== 'cockpit';
    playerMesh.userData.shoulders.visible = m !== 'cockpit';
  }
  camera.fov = m === 'cockpit' ? 74 : 62;
  camera.updateProjectionMatrix();
}

// ---------------- UI wiring ----------------
const screens = ['menu', 'race-setup', 'settings', 'pause', 'results', 'tilt-prompt', 'rotate', 'loading'];
function hideAll() { screens.forEach((s) => $(s).classList.add('hidden')); }
function show(id) { hideAll(); $(id).classList.remove('hidden'); if (id === 'menu') refreshMenu(); }

function refreshMenu() {
  const b = store.get(`lps.best.${settings.hotPrep}`, null);
  $('menu-best').textContent = b ? `Your best hot lap (${PREPS[settings.hotPrep].label}): ${b.toFixed(3)}s · Track record 12.276s` : 'Track record: 12.276s (Brady Bacon, 2018)';
}

const segRefreshers = [];
function initSegs() {
  document.querySelectorAll('.seg').forEach((seg) => {
    const key = seg.dataset.key;
    const vals = seg.dataset.vals.split(',');
    const labels = seg.dataset.labels.split(',');
    const parse = (v) => (v === 'true' ? true : v === 'false' ? false : isNaN(+v) ? v : +v);
    seg.innerHTML = '';
    vals.forEach((v, i) => {
      const b = document.createElement('button');
      b.textContent = labels[i] || v;
      const pv = parse(v);
      const refresh = () => seg.querySelectorAll('button').forEach((x, j) => x.classList.toggle('on', parse(vals[j]) === settings[key]));
      b.addEventListener('click', () => {
        settings[key] = pv; saveSettings(); segRefreshers.forEach((f) => f());
        if (key === 'volume') sound.setVolume(pv);
        if (key === 'quality') resize();
        if (key === 'prep') $('prep-desc').textContent = PREPS[pv].desc;
        if (key === 'hotPrep') refreshMenu();
        if (key === 'time') applyTime();
      });
      seg.appendChild(b);
      refresh();
      segRefreshers.push(refresh);
    });
  });
  $('prep-desc').textContent = PREPS[settings.prep].desc;
}

let tiltExplained = false;
function begin(mode) {
  // runs inside the tap handler: unlock audio + motion sensors (iPhone)
  sound.start();
  if (settings.controls === 'tilt' && isTouch && !tiltExplained) {
    pendingMode = mode;
    show('tilt-prompt');
    return;
  }
  if (settings.controls === 'tilt') input.enableTilt();
  startSession(mode);
}
let pendingMode = null;

document.addEventListener('click', (e) => {
  const go = e.target.closest('[data-go]');
  const act = e.target.closest('[data-act]');
  if (go) {
    const t = go.dataset.go;
    if (t === 'hotlaps') begin('hotlaps');
    else if (t === 'race') begin('race');
    else show(t);
  }
  if (act) {
    const a = act.dataset.act;
    if (a === 'tilt-go') {
      tiltExplained = true;
      input.enableTilt();
      sound.start();
      startSession(pendingMode || 'hotlaps');
    } else if (a === 'resume') resume();
    else if (a === 'recenter') { input.recenter(); resume(); }
    else if (a === 'reset-car') { session && session.resetPlayer(); resume(); }
    else if (a === 'restart') { sound.start(); startSession(lastSessionOpts || 'hotlaps'); }
    else if (a === 'quit') quit();
  }
});
$('btn-pause').addEventListener('click', () => pause());
$('btn-cam').addEventListener('click', () => { setCam(camMode === 'chase' ? 'cockpit' : 'chase'); camInit = true; });
$('btn-reset').addEventListener('click', () => session && session.resetPlayer());
['touchstart', 'mousedown'].forEach((ev) => {
  $('pedal-gas').addEventListener(ev, () => $('pedal-gas').classList.add('active'));
  $('pedal-brake').addEventListener(ev, () => $('pedal-brake').classList.add('active'));
});
['touchend', 'touchcancel', 'mouseup'].forEach((ev) => window.addEventListener(ev, () => {
  if (!input.gasTouch) $('pedal-gas').classList.remove('active');
  if (!input.brakeTouch) $('pedal-brake').classList.remove('active');
}));
window.addEventListener('keydown', (e) => {
  if (e.key === 'c') { setCam(camMode === 'chase' ? 'cockpit' : 'chase'); camInit = true; }
  if (e.key === 'Escape' || e.key === 'p') (paused ? resume() : pause());
  if (e.key === 'r' && session) session.resetPlayer();
});

function pause() {
  if (state !== 'playing') return;
  paused = true; state = 'paused';
  show('pause');
}
function resume() {
  if (!session) return;
  hideAll();
  paused = false; state = 'playing';
  sound.resume();
  checkOrientation();
}
function quit() {
  session = null; paused = true; state = 'menu';
  $('hud').classList.add('hidden');
  sound.update({ paused: true });
  show('menu');
}

function showResults() {
  if (!session || session.mode !== 'race') return;
  state = 'results';
  const st = session.standings();
  const pos = st.findIndex((r) => r.isPlayer) + 1;
  const me = st[pos - 1];
  $('results-title').textContent = me.dnf ? 'DNF: flipped' : pos === 1 ? 'Victory Lane! You won!' : `You finished P${pos}`;
  const L = track.L, leaderDist = st[0].dist;
  $('results-list').innerHTML = st.map((r, i) => {
    const down = Math.floor((leaderDist - r.dist) / L + 0.02);
    const status = r.dnf ? 'DNF' : isFinite(r.best) ? r.best.toFixed(3) : '-';
    const lapsDown = !r.dnf && down >= 1 && !r.finished ? ` (-${down})` : '';
    return `<div class="r ${r.isPlayer ? 'me' : ''}"><span>${i + 1}</span><span class="num" style="background:${r.colors[0]};color:${r.colors[2]};border:1px solid ${r.colors[1]}">${r.number}</span><span>${r.name}${lapsDown}</span><span class="mono">${status}</span></div>`;
  }).join('');
  show('results');
  paused = true;
}

// ---------------- orientation ----------------
function checkOrientation() {
  const portrait = window.innerHeight > window.innerWidth * 1.05 && isTouch;
  $('rotate').classList.toggle('hidden', !(portrait && (state === 'playing' || state === 'paused')));
  if (portrait && state === 'playing') { paused = true; state = 'paused'; $('pause').classList.add('hidden'); }
  else if (!portrait && state === 'paused' && $('pause').classList.contains('hidden') && $('rotate').classList.contains('hidden')) { resume(); }
}
window.addEventListener('resize', resize);
window.addEventListener('orientationchange', () => setTimeout(resize, 200));
document.addEventListener('visibilitychange', () => { if (document.hidden) { pause(); sound.suspend(); } });

// ---------------- HUD ----------------
const mini = $('minimap').getContext('2d');
const miniPath = (() => {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let i = 0; i < track.N; i++) { minX = Math.min(minX, track.x[i]); maxX = Math.max(maxX, track.x[i]); minZ = Math.min(minZ, track.z[i]); maxZ = Math.max(maxZ, track.z[i]); }
  const sc = Math.min(130 / (maxX - minX), 80 / (maxZ - minZ));
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  return { map: (x, z) => [75 + (x - cx) * sc, 50 - (z - cz) * sc] };
})();
function drawMinimap() {
  mini.clearRect(0, 0, 150, 100);
  mini.lineWidth = 9; mini.strokeStyle = 'rgba(80,55,38,0.75)';
  mini.beginPath();
  for (let i = 0; i <= track.N; i += 10) {
    const [x, y] = miniPath.map(track.x[i % track.N], track.z[i % track.N]);
    i ? mini.lineTo(x, y) : mini.moveTo(x, y);
  }
  mini.closePath(); mini.stroke();
  // start/finish
  const [sx, sy] = miniPath.map(track.x[0], track.z[0]);
  mini.fillStyle = '#fff'; mini.fillRect(sx - 1, sy - 6, 2, 12);
  if (session && session.field) {
    const p = {};
    for (const c of session.field.cars) {
      track.pos(c.S, c.d, p);
      const [x, y] = miniPath.map(p.x, p.z);
      mini.fillStyle = c.driver.colors[0];
      mini.beginPath(); mini.arc(x, y, 2.6, 0, 7); mini.fill();
    }
  }
  if (session) {
    const [x, y] = miniPath.map(session.car.x, session.car.z);
    mini.fillStyle = '#f2cf7e'; mini.strokeStyle = '#000'; mini.lineWidth = 1.5;
    mini.beginPath(); mini.arc(x, y, 4, 0, 7); mini.fill(); mini.stroke();
  }
}

let hudTimer = 0, msgKey = '';
const fmt = (t) => (isFinite(t) && t > 0 ? t.toFixed(3) : '--.---');
function updateHud(dt) {
  hudTimer -= dt;
  if (hudTimer > 0) return;
  hudTimer = 0.1;
  const s = session, car = s.car;
  const mph = Math.round(car.speed * 2.237);
  $('hud-speed').innerHTML = `${mph}<small> MPH</small>`;
  const wear = surface.wear;
  const cond = wear < 0.2 ? 'Tacky' : wear < 0.5 ? 'Drying' : 'Slick';
  const where = car.surfaceKind === 'cushion' ? ' · ON THE CUSHION' : car.surfaceKind === 'marbles' ? ' · IN THE MARBLES' : car.surfaceKind === 'grass' ? ' · INFIELD' : car.surfaceKind === 'offtrack' ? ' · OFF THE TRACK' : '';
  $('hud-track').textContent = `${PREPS[surface.prepId].label} · ${cond}${where}`;
  if (s.mode === 'race') {
    const pos = s.playerPosition();
    $('hud-pos').innerHTML = `P${pos}<small>/${s.field.cars.length + 1}</small>`;
    const lap = s.phase === 'pace' ? 'PACE LAP' : `LAP ${clamp(Math.floor((car.S - track.L) / track.L) + 1, 1, s.laps)}/${s.laps}`;
    $('hud-lap').textContent = s.playerStatus === 'finished' ? 'FINISHED' : s.playerStatus === 'dnf' ? 'DNF' : lap;
    $('hud-time').textContent = s.phase === 'pace' ? '' : s.raceTime.toFixed(1);
    $('hud-best').textContent = `Last ${fmt(s.lastLap)} · Best ${fmt(s.bestLap)}`;
    $('hud-flag').className = `flag ${s.flag}`;
    trackScene.setFlag(s.phase === 'pace' ? 'none' : s.flag);
    // running order
    const st = s.standings();
    const me = st.findIndex((r) => r.isPlayer);
    const rows = [];
    for (let i = 0; i < Math.min(5, st.length); i++) rows.push(i);
    if (me >= 5) rows.push(me);
    $('tower').innerHTML = rows.map((i) => {
      const r = st[i];
      return `<div class="row ${r.isPlayer ? 'me' : ''}"><span>${i + 1}</span><span class="num" style="background:${r.colors[0]};color:${r.colors[2]}">${r.number}</span><span>${r.isPlayer ? 'YOU' : r.name.split(' ').slice(-1)[0]}</span></div>`;
    }).join('');
  } else {
    $('hud-pos').innerHTML = 'HOT LAPS';
    $('hud-lap').textContent = `Laps ${s.playerLaps.length}`;
    $('hud-time').textContent = s.lapStartTime != null ? (s.time - s.lapStartTime).toFixed(2) : 'out lap';
    $('hud-best').textContent = `Last ${fmt(s.lastLap)} · Best ${fmt(s.bestLap)} · Record 12.276`;
    $('hud-flag').className = 'flag green';
    trackScene.setFlag('green');
  }
  const m = s.messages[s.messages.length - 1];
  const key = m ? m.text : '';
  if (key !== msgKey) {
    msgKey = key;
    $('hud-msg').innerHTML = m ? `<div class="${m.big ? 'big' : ''}">${m.text}</div>` : '';
  }
  drawMinimap();
}

// ---------------- camera ----------------
let camInit = true;
const camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camDir = new THREE.Vector3(1, 0, 0);
const _v = new THREE.Vector3(), _tgt = new THREE.Vector3();
function updateCamera(dt) {
  const car = session.car, mesh = playerMesh;
  if (camMode === 'cockpit') {
    mesh.updateMatrixWorld();
    _v.set(0, 1.3, -0.36); mesh.localToWorld(_v);
    const shake = Math.min(1, car.speed / 40) * 0.012;
    _v.y += (Math.random() - 0.5) * shake;
    camera.position.copy(_v);
    _tgt.set(0, 0.95, 12); mesh.localToWorld(_tgt);
    camera.lookAt(_tgt);
    return;
  }
  // chase: follow mostly the direction of travel so the slide angle shows
  const sp = car.speed;
  const hx = Math.cos(car.th), hz = Math.sin(car.th);
  let vx = car.u * hx - car.v * hz, vz = car.u * hz + car.v * hx;
  const vl = Math.hypot(vx, vz);
  let dx = hx, dz = hz;
  if (vl > 4 && car.u > 0) { const k = 0.65; dx = hx * (1 - k) + (vx / vl) * k; dz = hz * (1 - k) + (vz / vl) * k; }
  const dl = Math.hypot(dx, dz); dx /= dl; dz /= dl;
  const a = camInit ? 1 : 1 - Math.exp(-dt * 4.5);
  camDir.x += (dx - camDir.x) * a; camDir.z += (dz - camDir.z) * a;
  const cl = Math.hypot(camDir.x, camDir.z); camDir.x /= cl; camDir.z /= cl;
  const back = 6.4 + Math.min(sp, 45) * 0.03, up = 2.5;
  _tgt.set(mesh.position.x - camDir.x * back, mesh.position.y + up, mesh.position.z - camDir.z * back);
  if (camInit) camPos.copy(_tgt); else camPos.lerp(_tgt, 1 - Math.exp(-dt * 10));
  camera.position.copy(camPos);
  camLook.set(mesh.position.x + camDir.x * 5, mesh.position.y + 0.9, mesh.position.z + camDir.z * 5);
  camera.lookAt(camLook);
  camInit = false;
}

// ---------------- main loop ----------------
let last = performance.now(), stuckT = 0, attractT = 0;
function frame(now) {
  requestAnimationFrame(frame);
  let dt = (now - last) / 1000; last = now;
  dt = Math.min(dt, 1 / 20);
  if (session) {
    const inp = input.update(dt);
    if (!paused) {
      session.update(dt, inp);
      for (const e of session.car.events) { if (e.type === 'wall') sound.hit(e.strength); }
    }
    renderSession(dt);
    updateHud(dt);
  } else {
    attract(dt);
  }
  dust.update(paused ? 0 : dt);
  renderer.render(scene, camera);
}

function renderSession(dt) {
  const s = session, car = s.car;
  trackScene.updateSurface(false);
  // player
  let roll = 0;
  const ud = playerMesh.userData;
  if (car.flipped) {
    ud.flipT = (ud.flipT || 0) + (paused ? 0 : dt);
    const t = Math.min(ud.flipT / 1.4, 1);
    roll = t * Math.PI * 3;
  } else ud.flipT = 0;
  if (car.flipped && car.flipCause === 'bank') {
    // tumbling down the hill past turns 1-2
    const k = Math.min(ud.flipT / 2.2, 1);
    const sm2 = track.sample(car.s, {});
    const dd = car.d + k * 9;
    const px = car.x + sm2.nx * k * 9, pz = car.z + sm2.nz * k * 9;
    placeCar(playerMesh, px, pz, car.th + k * 1.5, car.s, dd, k * Math.PI * 4);
    playerMesh.position.y = track.height(car.s, dd) + 1.0 + Math.abs(Math.sin(k * Math.PI * 4)) * 0.8;
  } else {
    placeCar(playerMesh, car.x, car.z, car.th, car.s, car.d, roll);
    if (car.flipped) playerMesh.position.y += Math.sin(Math.min(ud.flipT / 1.4, 1) * Math.PI) * 2.6 + (ud.flipT > 1.4 ? 1.1 : 0);
  }
  ud.rearRot = (ud.rearRot || 0) + (car.rearWheelSpeed / 0.45) * dt * (paused ? 0 : 1);
  ud.frontRot = (ud.frontRot || 0) + (car.frontWheelSpeed / 0.33) * dt * (paused ? 0 : 1);
  poseCar(playerMesh, car.delta, ud.rearRot, ud.frontRot);
  const fx = Math.cos(car.th), fz = Math.sin(car.th);
  if (!paused && !car.flipped) {
    const mul = car.surfaceKind === 'marbles' || car.surfaceKind === 'cushion' ? 1.6 : car.surfaceKind === 'grass' ? 0.3 : 1;
    dust.roost(car.x, playerMesh.position.y, car.z, fx, fz, -fz, fx, car.speed, Math.abs(car.beta), Math.min(1, car.spin), mul);
  }

  // AI
  let nearest = 1e9, nearRpm = 6000;
  if (s.field) {
    const p = {};
    for (const c of s.field.cars) {
      const mesh = aiMeshes.get(c.driver);
      if (!mesh) continue;
      track.pos(c.S, c.d, p);
      placeCar(mesh, p.x, p.z, c.heading, c.S, c.d);
      const w = c.wheelRot;
      poseCar(mesh, c.slide * 0.7, w, w * 1.35); // countersteer
      const dd = Math.hypot(p.x - car.x, p.z - car.z);
      if (dd < nearest) { nearest = dd; nearRpm = c.rpm; }
      if (!paused && dd < 90) {
        const hx = Math.cos(c.heading), hz = Math.sin(c.heading);
        dust.roost(p.x, mesh.position.y, p.z, hx, hz, -hz, hx, c.v, c.slide, c.slide * 1.5, 0.5);
      }
    }
  }
  updateCamera(dt);
  sun.target.position.copy(playerMesh.position);
  sun.position.copy(playerMesh.position).add(sunOffset);
  if (window.__spec) { // debug: spectator view at track position [s, d, height]
    const [ss, dd, hh] = window.__spec; const p0 = track.pos(ss, dd, {});
    camera.position.set(p0.x, track.height(ss, dd) + hh, p0.z);
    const tgt = track.pos(ss + 25, 0, {}); camera.lookAt(tgt.x, 1, tgt.z);
  }
  if (window.__freecam) { // debug: orbit view of the player's car
    _v.set(...window.__freecam); playerMesh.localToWorld(_v);
    camera.position.copy(_v); _tgt.set(0, 0.65, 0); playerMesh.localToWorld(_tgt); camera.lookAt(_tgt);
  }

  // stuck / wrong way
  const sm = track.sample(car.s, _sm);
  const dirDot = Math.cos(car.th) * sm.tx + Math.sin(car.th) * sm.tz;
  if (!paused && s.playerStatus === 'running' && s.phase !== 'pace' && (car.speed < 1.5 || dirDot < -0.2)) stuckT += dt; else stuckT = 0;
  $('btn-reset').classList.toggle('hidden', stuckT < 2);

  sound.update({
    rpm: car.flipped ? 2500 : car.rpm, throttle: input.throttle, slip: Math.abs(car.beta) + car.spin * 0.3, speed: car.speed,
    packRpm: nearRpm, packDist: nearest, surface: car.surfaceKind, paused: paused || s.playerStatus === 'dnf',
  });
}

// slow orbit behind the menus
function attract(dt) {
  attractT += dt * 0.05;
  const r = 120;
  camera.position.set(Math.cos(attractT) * r * 1.2, 34, Math.sin(attractT) * r);
  camera.lookAt(0, 0, 0);
}

// ---------------- boot ----------------
initSegs();
resize();
show('menu');
refreshMenu();
requestAnimationFrame(frame);
// build the player's car early so the first start is quick
ensureCars([]).then(() => {
  // park it on the front stretch for the menu backdrop
  placeCar(playerMesh, track.x[0], track.z[0], 0, 0, -3);
});
window.__lps = { renderer, track, surface, get session() { return session; }, settings, startSession, setCam };
