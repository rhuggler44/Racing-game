// Highlight reel: records every car while you race, cuts clips around the big
// moments (passes, lead changes, contact, spins, crashes, the checkers) and plays
// them back after the race from TV camera spots around the track.
import * as THREE from 'three';

const HZ = 20;            // recorded frames per second
const KEEP = 16;          // seconds of history kept for cutting clips
const F = 11;             // floats per car per frame: pos 3, quat 4, visible, steer, rear wheel, front wheel
// seconds of lead-in / follow-through for each kind of moment
const WINDOW = {
  flip: [5, 4.5], spin: [4.5, 3.5], wall: [4, 2.5], contact: [4, 2.5],
  pass: [4.5, 2], lead: [4.5, 2.2], win: [4, 3],
};
const SLOWMO = { flip: 1, spin: 1, wall: 1, contact: 1 };
const MAX_CLIPS = 14;

export class Recorder {
  // keys[i] is 'player' or a driver object; meshes[i] is its car
  constructor(meshes, keys) {
    this.meshes = meshes; this.keys = keys; this.n = meshes.length;
    this.cap = Math.ceil(KEEP * HZ) + 2;
    this.times = new Float64Array(this.cap);
    this.data = new Float32Array(this.cap * this.n * F);
    this.head = 0; this.count = 0; this.lastT = -1e9;
    this.pending = []; this.clips = [];
    this.seen = 0; // highlights already taken from the session
  }

  // called every rendered frame after the cars are placed; t = session time
  capture(t) {
    if (t - this.lastT < 1 / HZ - 1e-6) return;
    this.lastT = t;
    const i = this.head;
    this.times[i] = t;
    let o = i * this.n * F;
    for (const m of this.meshes) {
      const ud = m.userData;
      this.data[o] = m.position.x; this.data[o + 1] = m.position.y; this.data[o + 2] = m.position.z;
      this.data[o + 3] = m.quaternion.x; this.data[o + 4] = m.quaternion.y; this.data[o + 5] = m.quaternion.z; this.data[o + 6] = m.quaternion.w;
      this.data[o + 7] = m.visible ? 1 : 0;
      this.data[o + 8] = ud.pd || 0; this.data[o + 9] = ud.pr || 0; this.data[o + 10] = ud.pf || 0;
      o += F;
    }
    this.head = (i + 1) % this.cap;
    this.count = Math.min(this.count + 1, this.cap);
  }

  // take new highlights from the session, and cut the clips that are complete
  update(t, highlights) {
    while (this.seen < highlights.length) this._mark(highlights[this.seen++]);
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const c = this.pending[i];
      if (t >= c.t1) { this.pending.splice(i, 1); this._cut(c); }
    }
  }

  // race over: cut whatever's still waiting with the frames we have
  finish(t, highlights) {
    this.update(t, highlights);
    for (const c of this.pending) { c.t1 = Math.min(c.t1, t); this._cut(c); }
    this.pending.length = 0;
  }

  _mark(h) {
    const [pre, post] = WINDOW[h.kind] || [4, 2.5];
    // the same moment from another angle (a pass right after contact): one clip
    for (const c of this.pending) {
      if (h.t <= c.t1 && h.t >= c.t0 && (c.focus === h.focus || h.kind === c.kind)) {
        if (h.pri > c.pri) { c.pri = h.pri; c.text = h.text; c.kind = h.kind; c.focus = h.focus; c.at = h.t; }
        c.t1 = Math.max(c.t1, h.t + post);
        return;
      }
    }
    this.pending.push({ ...h, at: h.t, t0: h.t - pre, t1: h.t + post });
  }

  _cut(c) {
    if (!this.count) return;
    const idx = [];
    for (let k = 0; k < this.count; k++) {
      const i = (this.head - this.count + k + this.cap) % this.cap;
      const tt = this.times[i];
      if (tt >= c.t0 - 0.06 && tt <= c.t1 + 0.06) idx.push(i);
    }
    if (idx.length < HZ) return; // under a second of it: not worth showing
    const block = this.n * F;
    const times = new Float64Array(idx.length), data = new Float32Array(idx.length * block);
    idx.forEach((i, k) => { times[k] = this.times[i]; data.set(this.data.subarray(i * block, (i + 1) * block), k * block); });
    const focus = this.keys.indexOf(c.focus);
    this.clips.push({ kind: c.kind, text: c.text, pri: c.pri, at: c.at, times, data, focus: focus < 0 ? 0 : focus });
    if (this.clips.length > MAX_CLIPS) {
      // drop the least interesting (never the finish)
      let lo = -1;
      this.clips.forEach((k, i) => { if (k.kind !== 'win' && (lo < 0 || k.pri < this.clips[lo].pri)) lo = i; });
      if (lo >= 0) this.clips.splice(lo, 1);
    }
  }

  // the reel: the best few in the order they happened, the checkered flag last
  reel(max = 5) {
    const win = this.clips.filter((c) => c.kind === 'win');
    const rest = this.clips.filter((c) => c.kind !== 'win').sort((a, b) => b.pri - a.pri).slice(0, max - Math.min(1, win.length));
    rest.sort((a, b) => a.at - b.at);
    return [...rest, ...win.slice(0, 1)];
  }
}

// ---------------- TV cameras ----------------
// spots around the track like a broadcast. They sit on the infield side, up on
// poles, looking out across the racing surface at the wall and the crowd (so the
// banners read the right way), plus one high in the middle of the infield.
export function tvCameras(track) {
  const Z = track.turnZones, W = track.W;
  const cams = [];
  const add = (s, back, h, name, bias = 1) => {
    const d = -W / 2 - back;
    const p = track.pos(s, d, {});
    cams.push({ pos: new THREE.Vector3(p.x, track.height(s, -W / 2) + h, p.z), name, bias });
  };
  const mid = (z) => (z.s0 + z.s1) / 2;
  add(0, 7, 9, 'start/finish');
  add(Z[1].s0 + 10, 12, 11, 'turn 1');
  add(mid(Z[2]) + 22, 14, 12, 'turn 2');
  add((Z[3].s1 + Z[5].s0) / 2, 7, 9, 'backstretch');
  add(Z[5].s0 + 10, 12, 11, 'turn 3');
  add(mid(Z[6]) + 22, 14, 12, 'turn 4');
  let cx = 0, cz = 0;
  for (let i = 0; i < track.N; i++) { cx += track.x[i]; cz += track.z[i]; }
  cams.push({ pos: new THREE.Vector3(cx / track.N, 26, cz / track.N), name: 'infield', bias: 1.5 });
  return cams;
}

// ---------------- playback ----------------
const _qa = new THREE.Quaternion(), _qb = new THREE.Quaternion();
const _look = new THREE.Vector3(), _tgt = new THREE.Vector3(), _vel = new THREE.Vector3();

export class Reel {
  // poseCar(mesh, steer, rear, front) applies wheel angles
  constructor({ clips, meshes, cams, camera, poseCar, onClip, onDone, onCar }) {
    this.clips = clips; this.meshes = meshes; this.cams = cams; this.camera = camera; this.onCar = onCar;
    this.poseCar = poseCar; this.onClip = onClip; this.onDone = onDone;
    this.i = -1; this.done = false;
    this._next();
  }

  skip() { this._next(); }
  stop() { this.done = true; }

  _next() {
    this.i++;
    if (this.i >= this.clips.length) { this.done = true; this.onDone && this.onDone(); return; }
    const c = this.clips[this.i];
    this.c = c; this.t = c.times[0]; this.k = 0;
    this.cam = -1; this.cutT = 0; this.snap = true;
    this.onClip && this.onClip(c, this.i, this.clips.length);
  }

  // world position of the focus car at the current time
  focusPos(out) {
    const m = this.meshes[this.c.focus];
    return out.copy(m.position);
  }

  update(dt) {
    if (this.done) return;
    const c = this.c;
    // a bit of slow motion right around a crash
    const slow = SLOWMO[c.kind] && this.t > c.at - 0.7 && this.t < c.at + 1.8 ? 0.45 : 1;
    this.t += dt * slow;
    const T = c.times;
    if (this.t >= T[T.length - 1]) { this._next(); if (this.done) return; return this.update(0); }
    while (this.k < T.length - 2 && T[this.k + 1] <= this.t) this.k++;
    const a = this.k, b = Math.min(a + 1, T.length - 1);
    const f = b > a ? Math.min(1, Math.max(0, (this.t - T[a]) / (T[b] - T[a]))) : 0;
    const n = this.meshes.length, block = n * F, D = c.data;
    for (let j = 0; j < n; j++) {
      const m = this.meshes[j];
      const oa = a * block + j * F, ob = b * block + j * F;
      m.visible = D[oa + 7] > 0.5;
      if (!m.visible) continue;
      m.position.set(D[oa] + (D[ob] - D[oa]) * f, D[oa + 1] + (D[ob + 1] - D[oa + 1]) * f, D[oa + 2] + (D[ob + 2] - D[oa + 2]) * f);
      _qa.set(D[oa + 3], D[oa + 4], D[oa + 5], D[oa + 6]);
      _qb.set(D[ob + 3], D[ob + 4], D[ob + 5], D[ob + 6]);
      m.quaternion.slerpQuaternions(_qa, _qb, f);
      this.poseCar(m, D[oa + 8] + (D[ob + 8] - D[oa + 8]) * f, D[oa + 9] + (D[ob + 9] - D[oa + 9]) * f, D[oa + 10] + (D[ob + 10] - D[oa + 10]) * f);
      if (this.onCar && b > a) this.onCar(m, (D[ob] - D[oa]) / (T[b] - T[a]), (D[ob + 2] - D[oa + 2]) / (T[b] - T[a]), slow);
    }
    // where the focus car is headed (for a little lead in the shot)
    const fo = c.focus * F;
    const ia = a * block + fo, ib = b * block + fo;
    _vel.set(D[ib] - D[ia], 0, D[ib + 2] - D[ia + 2]).multiplyScalar(b > a ? 1 / (T[b] - T[a]) : 0);
    this.speed = _vel.length();
    this._shoot(dt * slow, dt);
  }

  _shoot(dtGame, dt) {
    const cam = this.camera;
    this.focusPos(_tgt);
    _tgt.y += 0.7;
    // the closest camera; cut to another only when it's clearly better (and not too often)
    let best = 0, bestD = Infinity;
    this.cams.forEach((k, i) => { const d = k.pos.distanceTo(_tgt) * k.bias; if (d < bestD) { bestD = d; best = i; } });
    this.cutT += dt;
    if (this.cam < 0) this.cam = best;
    else if (best !== this.cam && this.cutT > 1.6 && this.cams[this.cam].pos.distanceTo(_tgt) * this.cams[this.cam].bias > bestD * 1.3) {
      this.cam = best; this.snap = true;
    }
    if (this.snap) this.cutT = 0;
    const k = this.cams[this.cam];
    cam.position.copy(k.pos);
    // aim a touch ahead of the car, like a camera operator leading the shot
    _look.copy(_tgt).addScaledVector(_vel, 0.18);
    if (this.snap || !this.aim) this.aim = _look.clone();
    else this.aim.lerp(_look, 1 - Math.exp(-dt * 6));
    cam.lookAt(this.aim);
    // zoom so the car fills about the same part of the frame
    const dist = k.pos.distanceTo(_tgt);
    const width = this.c.kind === 'pass' || this.c.kind === 'lead' || this.c.kind === 'win' ? 30 : 22;
    // width is across the screen; the camera's fov is vertical
    const fov = THREE.MathUtils.clamp(2 * Math.atan(width / 2 / dist / Math.max(1, cam.aspect)) * 180 / Math.PI, 4, 50);
    cam.fov = this.snap ? fov : cam.fov + (fov - cam.fov) * (1 - Math.exp(-dt * 3));
    cam.updateProjectionMatrix();
    this.snap = false;
  }
}
