// AI field. Each AI car moves along the track in (S, d) coordinates following
// a speed profile built from the same grip/banking model the player drives on.
// Cheap enough to run 20+ cars on a phone.
import { G } from './track.js';
import { SPRINT_410 } from './physics.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const DIFFICULTY = {
  // pace is a multiple of the track's speed profile. A perfect Easy-handling lap
  // runs about 1.1-1.2x, so Outlaw is right there with a fast player.
  rookie: { label: 'Rookie', pace: 0.92, spread: 0.035 },
  pro:    { label: 'Pro',    pace: 1.0, spread: 0.03 },
  outlaw: { label: 'Outlaw', pace: 1.07, spread: 0.02 },
};

const LANES = 11; // dn 0.05 .. 0.95
const laneDn = (i) => 0.05 + 0.09 * i;

export class SpeedProfile {
  constructor(track, surface) {
    this.track = track; this.surface = surface;
    this.M = Math.round(track.L / 2);
    this.ds = track.L / this.M;
    this.v = Array.from({ length: LANES }, () => new Float32Array(this.M));
    this.lapTime = new Float32Array(LANES);
    this.version = -1;
  }
  update() {
    if (this.version === this.surface.version) return;
    this.version = this.surface.version;
    const t = this.track, P = SPRINT_410, sm = {};
    for (let li = 0; li < LANES; li++) {
      const dn = laneDn(li), d = (dn - 0.5) * t.W;
      const mu = this.surface.grip(dn), berm = this.surface.berm(dn);
      const v = this.v[li], M = this.M;
      const fac = new Float32Array(M);
      for (let i = 0; i < M; i++) {
        t.sample(i * this.ds, sm);
        const kl = sm.k / (1 + sm.k * d);
        fac[i] = 1 + sm.k * d;
        // same load model as the player car: banking adds tire load
        const sb = Math.sin(sm.bank), cb = Math.cos(sm.bank);
        let aLat = (mu * G * cb + G * sb * cb + berm) / Math.max(0.35, 1 - mu * sb);
        aLat = Math.min(aLat, mu * G * 1.8 + G * sb * cb + berm);
        v[i] = kl > 1e-4 ? Math.sqrt(aLat / kl) * 0.9 : 70;
      }
      // accel / brake passes (two laps so it wraps)
      for (let pass = 0; pass < 2; pass++) {
        for (let n = 0; n < M * 2; n++) {
          const i = n % M, j = (i + 1) % M, vi = v[i];
          const acc = Math.min(mu * G * 0.62, P.power / (P.mass * Math.max(vi, 4))) - (0.5 * 1.2 * P.CdA * vi * vi) / P.mass - P.Crr * G;
          const lim = Math.sqrt(vi * vi + 2 * Math.max(acc, 0) * this.ds * fac[i]);
          if (v[j] > lim) v[j] = lim;
        }
        for (let n = M * 2; n > 0; n--) {
          const i = n % M, j = (i - 1 + M) % M;
          const dec = mu * G * 0.55;
          const lim = Math.sqrt(v[i] * v[i] + 2 * dec * this.ds * fac[j]);
          if (v[j] > lim) v[j] = lim;
        }
      }
      let T = 0;
      for (let i = 0; i < M; i++) T += (this.ds * fac[i]) / v[i];
      this.lapTime[li] = T;
    }
    // best grooves
    let bb = 0, bt = 0;
    for (let li = 1; li < LANES; li++) {
      if (li <= 4 && this.lapTime[li] < this.lapTime[bb]) bb = li;
      if (li >= 6 && (bt === 0 || this.lapTime[li] < this.lapTime[bt])) bt = li;
    }
    this.bottomLane = bb < 1 ? 1 : bb; this.topLane = bt;
  }
  speed(s, dn) {
    const f = clamp((dn - 0.05) / 0.09, 0, LANES - 1);
    const li = Math.floor(f), lj = Math.min(li + 1, LANES - 1), lt = f - li;
    const x = this.track.wrap(s) / this.ds;
    const i = Math.floor(x) % this.M, j = (i + 1) % this.M, t = x - Math.floor(x);
    const a = this.v[li][i] + (this.v[li][j] - this.v[li][i]) * t;
    const b = this.v[lj][i] + (this.v[lj][j] - this.v[lj][i]) * t;
    return a + (b - a) * lt;
  }
  laneTime(dn) {
    const f = clamp((dn - 0.05) / 0.09, 0, LANES - 1);
    return this.lapTime[Math.round(f)];
  }
}

export class AICar {
  constructor(driver, skill, groovePref) {
    this.driver = driver;
    this.skill = skill;           // multiplier on profile speed
    this.groovePref = groovePref; // -1 bottom, +1 top, 0 either
    this.S = 0; this.d = 0; this.v = 0;
    this.dTarget = 0; this.dVel = 0;
    this.slide = 0; this.heading = 0;
    this.wheelRot = 0;
    this.finished = false; this.finishTime = 0;
    this.lapStart = 0; this.bestLap = Infinity; this.lastLap = 0;
    this.laneTimer = Math.random() * 2;
    this.wobble = Math.random() * 100;
    this.rpm = 3000;
    this.laneOffset = Math.random();
    this.slideStyle = 0.8 + Math.random() * 0.4;
  }
}

export class AIField {
  constructor(track, surface, drivers, difficulty = 'pro') {
    this.track = track; this.surface = surface;
    this.profile = new SpeedProfile(track, surface);
    this.cars = [];
    const D = DIFFICULTY[difficulty] || DIFFICULTY.pro;
    drivers.forEach((drv, i) => {
      const skill = (D.pace + (Math.random() - 0.5) * 2 * D.spread + (drv.rating || 0) * 0.01) * (track.def.aiPace || 1);
      const pref = drv.groove ?? (i % 3 === 0 ? 1 : i % 3 === 1 ? -1 : 0);
      this.cars.push(new AICar(drv, skill, pref));
    });
    this._sm = {};
  }

  grooveD(dn) { return (dn - 0.5) * this.track.W; }

  // pick a preferred lane for this car given the current track
  preferredD(c) {
    const pf = this.profile, surf = this.surface;
    const topDn = Math.min(surf.cPos - 0.05, laneDn(pf.topLane));
    const botDn = laneDn(pf.bottomLane);
    const tTop = pf.laneTime(topDn), tBot = pf.laneTime(botDn);
    const bias = (tBot - tTop) * 3 + c.groovePref * 0.5 + (Math.random() - 0.5) * 0.4; // >0 favors top
    // each driver has their own version of the line
    return this.grooveD(bias > 0 ? topDn - c.laneOffset * 0.06 : botDn + c.laneOffset * 0.08);
  }

  // others: array of {S, d, v} including the player
  step(dt, others, mode) {
    const t = this.track, W = t.W, pf = this.profile;
    pf.update();
    const all = others;
    for (const c of this.cars) {
      // racing logic
      c.laneTimer -= dt;
      const sNow = t.wrap(c.S);
      const dn = (c.d + W / 2) / W;
      let vT = pf.speed(sNow, dn) * c.skill;

      if (mode.phase === 'pace') {
        const slot = mode.slots.get(c);
        vT = mode.paceSpeed + clamp((slot.S - c.S) * 0.6, -6, 6);
        c.dTarget = slot.d;
      } else if (c.finished || mode.phase === 'cooldown') {
        vT = Math.min(vT, 18);
      } else {
        if (c.laneTimer <= 0) {
          c.dTarget = this.preferredD(c);
          c.laneTimer = 3 + Math.random() * 4;
        }
        // traffic
        let ahead = null, gapA = 1e9;
        for (const o of all) {
          if (o === c) continue;
          const g = o.S - c.S;
          if (g > 0 && g < 16 && Math.abs(o.d - c.d) < 2.3 && g < gapA) { gapA = g; ahead = o; }
        }
        if (ahead && c.v > ahead.v - 0.5) {
          // try to go around: pick the other groove if it's clear
          const options = [this.grooveD(0.2), this.grooveD(0.5), this.grooveD(Math.min(this.surface.cPos - 0.05, 0.85))];
          let best = null, bestScore = -1e9;
          for (const od of options) {
            if (Math.abs(od - ahead.d) < 2.6) continue;
            let clear = true;
            for (const o of all) {
              if (o === c) continue;
              const g = o.S - c.S;
              if (g > -6 && g < 9 && Math.abs(o.d - od) < 2.2 && Math.abs(o.d - c.d) > 0.5) { clear = false; break; }
            }
            if (!clear) continue;
            const score = -Math.abs(od - c.d) * 0.2 + pf.speed(sNow + 20, (od + W / 2) / W);
            if (score > bestScore) { bestScore = score; best = od; }
          }
          if (best !== null && c.laneTimer < 2.5) { c.dTarget = best; c.laneTimer = 2.5; }
          if (Math.abs(ahead.d - c.d) < 2.1) vT = Math.min(vT, ahead.v + (gapA - 5.5) * 0.9);
        }
        // natural line wander
        c.dTarget += 0;
      }

      // lateral motion
      const wander = mode.phase === 'pace' ? 0 : Math.sin(c.S * 0.035 + c.wobble) * 0.5;
      const dGoal = clamp(c.dTarget + wander, -W / 2 + 1.1, W / 2 - 1.2);
      const dErr = dGoal - c.d;
      const latMax = 3.2;
      c.dVel += (clamp(dErr * 1.6, -latMax, latMax) - c.dVel) * Math.min(1, dt * 3);

      // side-by-side spacing
      for (const o of all) {
        if (o === c) continue;
        const g = o.S - c.S, dd = c.d - o.d;
        if (Math.abs(g) < 4.2 && Math.abs(dd) < 2.15) {
          const push = (2.15 - Math.abs(dd)) * (dd >= 0 ? 1 : -1);
          c.dVel += push * 6 * dt * 10;
          if (Math.abs(g) < 3.6 && g > 0) vT = Math.min(vT, o.v - 0.5);
        }
      }
      c.d = clamp(c.d + c.dVel * dt, -W / 2 + 0.9, W / 2 - 1.0);

      // speed
      const dv = vT - c.v;
      const acc = dv > 0 ? Math.min(dv * 2.2, 9 - c.v * 0.06) : Math.max(dv * 3, -11);
      c.v = Math.max(0, c.v + acc * dt);

      const sm = t.sample(c.S, this._sm);
      const fac = 1 + sm.k * c.d;
      c.S += (c.v / fac) * dt;

      // visual slide angle: nose points to the inside in the corners
      const latAcc = c.v * c.v * sm.k / Math.max(0.2, fac);
      // sprint cars run the corners sideways: nose to the inside, more on corner exit
      const exitGas = sm.k > 0.002 && c.v < vT ? 0.08 : 0;
      const slideT = (clamp(latAcc / 62, 0, 0.55) + exitGas) * (0.8 + 0.2 * Math.sin(c.S * 0.07 + c.wobble)) * (c.slideStyle || 1);
      c.slide += (slideT - c.slide) * Math.min(1, dt * 3);
      c.heading = Math.atan2(sm.tz, sm.tx) + Math.atan2(c.dVel, Math.max(c.v, 3)) - c.slide;
      c.rpm += (clamp(c.v * 172 + (acc > 0 ? 700 : 0), 2600, 9200) - c.rpm) * Math.min(1, dt * 6);
      c.wheelRot += (c.v / 0.45) * dt;
    }
  }
}
