// Player car: a 410 non-wing sprint car on dirt. Planar bicycle model with
// friction-circle rear tires (throttle steer), banking, cushion and walls.
// Pure JS so it can run in node for tuning.
import { G } from './track.js';

export const SPRINT_410 = {
  mass: 650,          // kg with driver (~1425 lb)
  Iz: 600,            // yaw inertia
  a: 1.17,            // CG -> front axle
  b: 0.96,            // CG -> rear axle
  h: 0.42,            // CG height
  power: 640000,      // W (~860 hp at the wheels)
  maxDrive: 12000,    // N, low-speed traction/torque cap
  CdA: 0.85,
  Crr: 0.024,
  maxSteer: 0.42,     // rad at the front wheels
  stagger: 0.012,     // rad of built-in left pull
  tireB: 7.0,
  tireC: 1.45,
  rearGrip: 1.05,
  halfWidth: 0.98,
  halfLength: 1.75,
  rpmPerMps: 172,     // direct drive: ~9000 rpm at 52 m/s
};

const EASY_GRIP = 0.9;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const tire = (al, B, C) => Math.sin(C * Math.atan(B * al));

export class Car {
  constructor(track, surface, params = SPRINT_410) {
    this.track = track;
    this.surface = surface;
    this.p = { ...params };
    this.assists = true;
    this.handling = 'sim'; // 'easy' = arcade throttle-steer model
    this.events = [];
    this._sm = {};
    this._pr = {};
    this.reset(0, 0, 0);
  }

  reset(s, d, speed = 0) {
    const t = this.track, sm = t.pos(s, d, {});
    this.x = sm.x; this.z = sm.z;
    this.th = Math.atan2(sm.tz, sm.tx);
    this.u = speed; this.v = 0; this.w = 0;
    this.ax = 0;
    this.delta = 0;
    this.idx = Math.round(t.wrap(s) / t.ds) % t.N;
    this.s = t.wrap(s); this.d = d;
    this.lap = 0;
    this.S = this.s;
    this.spin = 0; this.slip = 0; this.beta = 0;
    this._kyaw = 0; this._krate = 0; this._recover = false;
    this.rearWheelSpeed = speed;
    this.frontWheelSpeed = speed;
    this.rpm = 2500;
    this.flipped = false;
    this._spinT = 0;
    this.speedLimit = Infinity; // pace-lap governor
    this.flipSpeed = 17;
    this.flipCause = null;
    this.cushionTimer = 0;
    this.hookCooldown = 0;
    this.onCushion = 0;
    this.surfaceKind = 'track';
    this._pathRate = 0; this._lastAng = undefined; this._slide = 0; this.pushing = false;
  }

  get speed() { return Math.hypot(this.u, this.v); }

  // inp: { steer -1..1 (right +), throttle 0..1, brake 0..1 }
  step(dt, inp) {
    if (this.flipped) return;
    const P = this.p, t = this.track, surf = this.surface;
    const m = P.mass, WB = P.a + P.b, W = t.W;

    // where are we on the track
    const pr = t.project(this.x, this.z, this.idx, this._pr);
    const prevS = this.s;
    this.idx = pr.i; this.s = pr.s; this.d = pr.d;
    if (this.s - prevS < -t.L / 2) this.lap++;
    else if (this.s - prevS > t.L / 2) this.lap--;
    this.S = this.lap * t.L + this.s;
    const sm = t.sample(this.s, this._sm);
    const dn = (this.d + W / 2) / W;
    this.dn = dn;

    // surface
    let mu, crr = P.Crr, bank = sm.bank, berm = 0, aOut = 0;
    const eOut = this.d - W / 2;
    // inside the inner edge: same banked clay right down to the berm / wall
    // (no flat apron); grass only if you get past the berm
    if (this.d < -W / 2 - (t.innerEdge || 1.2) - 0.3) { mu = 0.72; crr = 0.07; bank = 0; this.surfaceKind = 'grass'; }
    else if (this.d < -W / 2) { mu = surf.grip(0); this.surfaceKind = 'track'; }
    else if (eOut > 0.4) {
      // off the outside edge: grass and runoff. Only the hill in turns 1-2 pulls
      // the car away; everywhere else you can drive it back on.
      mu = 0.72; crr = 0.06; bank = 0; this.surfaceKind = 'offtrack';
      const drop = t.zones(this.s).kind === 'drop';
      if (drop) {
        const slope = (t.outsideY(this.s, eOut) - t.outsideY(this.s, eOut + 0.5)) / 0.5;
        aOut = 0.55 * G * Math.sin(Math.atan(Math.max(0, slope))); // a quick catch can still save it
      }
      if (drop && eOut > 3.2 && !this.flipped) {
        this.flipped = true;
        this.flipCause = 'bank';
        this.events.push({ type: 'flip', strength: this.speed, cause: 'bank' });
      }
    } else {
      mu = surf.grip(Math.min(dn, 1));
      berm = surf.berm(dn);
      this.surfaceKind = dn > surf.cPos + 0.02 ? 'marbles' : dn > surf.cPos - surf.cW ? 'cushion' : 'track';
    }
    this.mu = mu;

    const fx = Math.cos(this.th), fz = Math.sin(this.th);
    const rx = -fz, rz = fx;

    // external horizontal accelerations: banking slope + cushion berm, both push inward
    const aIn = G * Math.sin(bank) * Math.cos(bank) + berm - aOut;
    const gx = -sm.nx * aIn, gz = -sm.nz * aIn;
    const aExtF = gx * fx + gz * fz;
    const aExtR = gx * rx + gz * rz;

    if (this.handling === 'easy') return this._easy(dt, inp, sm, mu, crr, bank, aIn);

    let u = this.u, v = this.v, w = this.w;
    const uu = Math.max(Math.abs(u), 2);
    const beta = Math.atan2(v, uu);
    this.beta = beta;

    // vertical load: banking adds load when turning into it
    const turnIn = u > 0 && w < 0 ? -u * w : 0;
    const loadMul = clamp(Math.cos(bank) + turnIn * Math.sin(bank) / G, 0.6, 2.8); // high banks (Eldora) press the tires down hard
    const Fz = m * G * loadMul;
    const Fzf = clamp(Fz * P.b / WB - m * this.ax * P.h / WB, Fz * 0.15, Fz * 0.85);
    const Fzr = Fz - Fzf;

    // steering (slightly less lock at speed), stagger pulls left
    let delta = clamp(inp.steer, -1, 1) * P.maxSteer / (1 + Math.max(u, 0) / 70);
    if (this.assists && u > 4) delta += clamp(0.5 * beta, -0.22, 0.22); // countersteer help
    // the stagger pulls hardest on the gas; off the gas / braking it mostly lets go
    delta -= P.stagger * (0.35 + 0.65 * clamp(inp.throttle, 0, 1));
    delta = clamp(delta, -P.maxSteer, P.maxSteer);
    // steering rack has finite speed
    const maxRate = 4.0 * dt;
    this.delta += clamp(delta - this.delta, -maxRate, maxRate);
    delta = this.delta;

    const dir = u >= 0 ? 1 : -1;
    const af = Math.atan2(v + P.a * w, uu) - delta * dir;
    const ar = Math.atan2(v - P.b * w, uu);

    // brakes / drive
    const thr = clamp(inp.throttle, 0, 1), brk = clamp(inp.brake, 0, 1);
    const sgnU = clamp(u / 0.6, -1, 1);
    const Fbrake = brk * mu * Fz * 0.85;
    let Fd = thr * Math.min(P.maxDrive, P.power / Math.max(Math.abs(u), 4));
    if (Math.abs(u) > this.speedLimit) Fd = 0;
    const Crear = mu * P.rearGrip * Fzr;
    if (this.assists) Fd = Math.min(Fd, Crear * 1.25);
    // reverse when stopped and holding brake
    let Frev = 0;
    if (brk > 0.3 && thr < 0.05 && u < 0.6) Frev = -2200 * brk;

    // rear brakes can only use part of the rear grip, so hard braking from big
    // speed (Eldora's straights) doesn't lock the rears and swap ends
    let Fxr = Fd - Math.min(Fbrake * 0.55, Crear * 0.45) * sgnU + (u < 0.6 ? Frev : 0);
    let spin = 0;
    if (Math.abs(Fxr) > Crear) {
      spin = Math.abs(Fxr) / Crear - 1;
      Fxr = Math.sign(Fxr) * Crear * (spin > 0.35 ? 0.86 : 0.94);
    }
    const latFrac = Math.max(Math.sqrt(Math.max(0, 1 - (Fxr / Crear) ** 2)), this.assists ? 0.6 : 0.45);
    const Fyr = -Crear * latFrac * tire(ar, P.tireB, P.tireC);
    // front tires share their grip between braking and turning too
    const Cfront = mu * Fzf;
    const Fxf = -Math.min(Fbrake * 0.45, Cfront * 0.9) * sgnU;
    const Fyf = -Cfront * Math.sqrt(Math.max(0, 1 - (Fxf / Cfront) ** 2)) * tire(af, P.tireB, P.tireC);

    const drag = 0.5 * 1.2 * P.CdA * u * Math.abs(u);
    const roll = crr * m * G * sgnU;
    const cd = Math.cos(delta), sd = Math.sin(delta);
    const Fx = Fxr + Fxf * cd - Fyf * sd - drag - roll;
    const Fy = Fyf * cd + Fxf * sd + Fyr;
    let Mz = P.a * (Fyf * cd + Fxf * sd) - P.b * Fyr;

    // stability assist: stop the car from swapping ends
    if (this.assists && u > 3) {
      const lim = 0.5;
      if (Math.abs(beta) > lim) Mz += 9000 * (beta - Math.sign(beta) * lim);
    }

    const axB = Fx / m + aExtF;
    const ayB = Fy / m + aExtR;
    u += (axB + v * w) * dt;
    v += (ayB - u * w) * dt;
    w += (Mz / P.Iz) * dt;
    this.ax = this.ax + (Fx / m - this.ax) * Math.min(1, dt * 8);

    // low-speed settling
    if (Math.abs(u) < 3) {
      const k = 1 - Math.min(1, dt * (3 - Math.abs(u)) * 1.5);
      v *= k; w *= k;
    }
    if (thr < 0.02 && brk < 0.3 && Math.abs(u) < 0.25) u *= 1 - Math.min(1, dt * 4);

    // cushion: choppy conditions can hook the car
    this.hookCooldown = Math.max(0, this.hookCooldown - dt);
    const lumpy = surf.prep.lumpy;
    const vOut = (u * fx + v * rx) * sm.nx + (u * fz + v * rz) * sm.nz;
    this.onCushion = this.surfaceKind === 'cushion' ? 1 : 0;
    if (this.surfaceKind === 'cushion' || this.surfaceKind === 'marbles') {
      const lump = surf.lumps(this.s);
      w += lump * lumpy * surf.cush * 1.6 * dt * (Math.abs(u) / 30);
      if (vOut > 3.2 && this.hookCooldown <= 0 && lumpy > 0.5 && surf.cush > 0.4) {
        w += 0.35 * (vOut - 3.2) * lumpy;
        u *= 0.95;
        this.hookCooldown = 0.8;
        this.events.push({ type: 'hook', strength: vOut });
      }
    }
    if (this.surfaceKind === 'marbles') u -= Math.sign(u) * 1.2 * dt;

    this.u = u; this.v = v; this.w = w;
    this.spin = spin; this.slip = Math.abs(ar);
    this.th += w * dt;
    if (this.th > Math.PI) this.th -= 2 * Math.PI; else if (this.th < -Math.PI) this.th += 2 * Math.PI;

    const vx = u * Math.cos(this.th) - v * Math.sin(this.th);
    const vz = u * Math.sin(this.th) + v * Math.cos(this.th);
    this.x += vx * dt; this.z += vz * dt;

    this._walls(sm, vx, vz);

    // wheel speeds / rpm for audio + visuals
    const wheelTarget = u + (spin > 0 ? Math.min(spin, 1.5) * 9 + 4 : 0) * (Fd > 0 ? 1 : 0);
    this.rearWheelSpeed += (wheelTarget - this.rearWheelSpeed) * Math.min(1, dt * 10);
    this.frontWheelSpeed = u;
    const rpmT = clamp(Math.abs(this.rearWheelSpeed) * P.rpmPerMps, 2300, 9400);
    this.rpm += (rpmT - this.rpm) * Math.min(1, dt * 12);
    this.throttle = thr;
  }

  // Easy handling: arcade-style, driven with the throttle.
  //  - the path the car travels turns from the steering plus the slide angle:
  //    gas in a corner kicks the rear out (stagger + wheelspin), the nose swings
  //    left, and that slide turns the car left
  //  - steering right counteracts it (countersteer), lifting lets it straighten up
  //  - all of it is capped by the grip of the clay: carry too much speed or gas
  //    and the car pushes up the track toward the cushion
  _easy(dt, inp, sm, mu, crr, bank, aIn) {
    const P = this.p, surf = this.surface;
    let thr = clamp(inp.throttle, 0, 1);
    const brk = clamp(inp.brake, 0, 1), steer = clamp(inp.steer, -1, 1);
    const wrap = (a) => (a > Math.PI ? a - 2 * Math.PI : a < -Math.PI ? a + 2 * Math.PI : a);
    // throttle assist (with driving aids on): only steps in when the car is about to
    // get away from you. The gas is yours: it never backs you off in a normal slide.
    if (this.assists) {
      const over = Math.max(0, Math.abs(this._slide || 0) - 0.64) * 2.5;
      this._tcCut = (this._tcCut || 0) + (clamp(over, 0, 0.3) - (this._tcCut || 0)) * Math.min(1, dt * 6);
      thr *= 1 - this._tcCut;
    }
    let c = Math.cos(this.th), s = Math.sin(this.th);
    if (this._spinT > 0) return this._spinning(dt, sm, c, s, wrap);
    let vx = this.u * c - this.v * s, vz = this.u * s + this.v * c;
    const sp = Math.hypot(vx, vz);
    const fwd = this.u;
    let ang = sp > 0.5 ? Math.atan2(vz, vx) : this.th;
    const sf = clamp((sp - 4) / 10, 0, 1);

    // ---- slide angle (nose left of the direction of travel) ----
    // off the track (infield grass or the runoff) there's no banking or cushion to
    // slide against: the car just goes where you point it so you can get back on
    const off = this.surfaceKind === 'grass' || this.surfaceKind === 'offtrack';
    const loose = clamp(1.95 - mu / 1.3, 0.6, 1.15);          // slicker clay = steps out easier
    // Stagger only takes over in the turns. Like a real car with the wheel offset,
    // centered steering goes straight down the straightaways; the stagger builds as
    // you enter the corner and is at full strength mid-turn, the same spot every lap.
    // the turns only: Eldora's gently curved backstretch still drives like a straightaway
    const cornering = this.track.kMax && !off ? clamp((sm.tk ?? sm.k) / this.track.kMax, 0, 1) : 0;
    // The wheel sets how sideways it is, in proportion: a little left gets it a little
    // sideways, a lot whips it around; easing off / turning right straightens it back
    // up. Works from just before the turn (it looks a little ahead) so you can throw
    // it in at the end of the straight.
    const ahead = this.track.kMax && !off ? clamp((this.track.sample(this.s + 8 + sp * 0.35, this._smA || (this._smA = {})).tk) / this.track.kMax, 0, 1) : 0;
    const zone = Math.max(cornering, ahead) * clamp((sp - 12) / 15, 0, 1);
    const steerIn = -steer * 0.62 * zone;                      // + left: rear out, - right: tuck it back in
    // thrown in: turning in hard on the way into the corner (the slide scrubs speed for a bit)
    if (steerIn > 0.12 && ahead > cornering + 0.05) this._thrown = 1.2;
    else this._thrown = Math.max(0, (this._thrown || 0) - dt);
    let slideT = thr * 0.94 * cornering * loose                 // gas: rear steps out in the turns
      + steerIn
      - Math.max(0, steer) * 0.3 * (1 - zone);                   // countersteer catches it on the straights
    slideT = off ? 0 : clamp(slideT, -0.12, this.assists ? 0.7 : 0.95) * sf;
    // one smooth motion, quicker the harder you turn it
    const build = slideT > (this._slide || 0) ? 2.2 + Math.abs(steer) * 2.2 : 3.2;
    this._slide = (this._slide || 0) + (slideT - (this._slide || 0)) * Math.min(1, dt * build);
    const slide = this._slide;

    // ---- knocked around (car contact) ----
    // A hit sets the car rotating; the tires and your hands try to catch it. Steer
    // against it (countersteer) and it comes back; steer with it or have the car
    // already loose and it gets away from you and spins.
    let kyaw = this._kyaw || 0;
    if (kyaw || this._krate) {
      const sgn = Math.sign(kyaw || this._krate);
      const catchIt = clamp(-steer * sgn, 0, 1), makeWorse = clamp(steer * sgn, 0, 1);
      const kp = (off ? 14 : 9) + 18 * catchIt - 6 * makeWorse + (this.assists ? 4 : 0);
      const kd = 4.5 + 4 * catchIt;
      this._krate += (-kp * kyaw - kd * this._krate) * dt;
      kyaw = this._kyaw = kyaw + this._krate * dt;
      const crit = (this.assists ? 1.1 : 0.98) - 0.3 * clamp(Math.abs(slide) / 0.7, 0, 1);
      if (this._recover) { if (Math.abs(kyaw) < 0.25) this._recover = false; }
      else if (Math.abs(kyaw) > crit && sp > 6) {
        // gone: it spins the way the hit sent it, as hard as the hit sent it
        const rate = Math.sign(this._krate || kyaw) * clamp(Math.abs(this._krate) * 1.4 + 2, 2.5, 8.5);
        this._kyaw = 0; this._krate = 0;
        this.th = wrap(this.th);
        this._spinT = 1.0 + Math.min(1.2, sp * 0.03) + Math.random() * 0.4;
        this._spinRate = rate;
        this.events.push({ type: 'spun', strength: Math.abs(rate) });
      }
      if (Math.abs(kyaw) < 0.004 && Math.abs(this._krate) < 0.02) { this._kyaw = 0; this._krate = 0; kyaw = 0; }
    }

    // ---- how fast the path turns ----
    const steerRate = steer * (off ? 1.1 + 0.7 * clamp(1 - sp / 25, 0, 1) : 0.85 + 0.55 * clamp(1 - sp / 35, 0, 1));
    let turn = steerRate - slide * 1.85 + kyaw * 1.6 * sf - 0.06 * sf * cornering;   // + right, - left (stagger pulls left in turns); a knocked car goes where its nose points
    if (fwd < 0) turn = -steer * 0.8;
    const loadMul = clamp(Math.cos(bank) + Math.max(0, -turn * sp) * Math.sin(bank) / G, 0.6, 2.8); // high banks (Eldora) press the tires down hard
    let aDrive = thr * Math.min(mu * G * 0.62, P.power / (P.mass * Math.max(sp, 4)));
    if (sp > this.speedLimit) aDrive = 0;
    // grip of the clay, minus what wheelspin is using up
    // Easy handling: a slick track still has less bite, but not so much less that you crawl
    const muTurn = off ? Math.max(mu, 0.95) : mu + Math.max(0, 1.25 - mu) * 0.3;
    // EASY_GRIP keeps a perfect Easy lap near the real track record (12.276 at Lincoln Park)
    const aCap = Math.sqrt(Math.max(0.1, (muTurn * G * loadMul * (off ? 1 : EASY_GRIP)) ** 2 - (aDrive * 0.55) ** 2));
    const want = sp * Math.abs(turn);
    this.pushing = want > aCap;
    // throwing it in way sideways on entry, asking for more turn than the tires have:
    // the slide scrubs the extra off as speed (that's how you slow it for the corner).
    // Once you're in the turn it doesn't: on the gas you keep your speed.
    let scrub = 0;
    if (this.pushing && sp > 1) {
      if (!off && this._thrown > 0) scrub = Math.min((want - aCap) * 0.25, mu * G * 0.6) * clamp((Math.abs(slide) - 0.28) / 0.2, 0, 1) * Math.min(1, this._thrown);
      turn = Math.sign(turn) * aCap / sp;
      // the tires are all used up holding the car in the turn: on the gas the rears
      // just spin (the engine stays wound up) instead of driving the car any faster
      if (!off) aDrive *= clamp(1 - ((want - aCap) / aCap) * 0.9, 0.2, 1);
    }
    if (off) { if (sp < 1.2) turn *= sp / 1.2; } else if (sp < 3) turn *= sp / 3;
    ang = wrap(ang + turn * dt);

    // ---- speed ----
    let speed = fwd < 0 ? -sp : sp;
    speed += aDrive * Math.cos(slide) * dt;
    const drag = (0.5 * 1.2 * P.CdA * sp * sp) / P.mass + crr * G + 2.2 * Math.abs(Math.sin(slide)) + 5 * Math.abs(Math.sin(kyaw))
      + brk * mu * G * 0.8 + (this.surfaceKind === 'marbles' ? 1.2 : 0) + scrub;
    if (speed > 0) speed = Math.max(0, speed - drag * dt);
    else speed = Math.min(0, speed + drag * dt);
    if (brk > 0.3 && thr < 0.05 && speed < 0.8) speed = Math.max(speed - 3 * dt, -4); // back up
    vx = Math.cos(ang) * Math.abs(speed) * Math.sign(speed || 1);
    vz = Math.sin(ang) * Math.abs(speed) * Math.sign(speed || 1);
    if (speed < 0) { vx = -Math.cos(this.th) * -speed; vz = -Math.sin(this.th) * -speed; }

    // banking + cushion push the car down the track; on the straights the tires hold
    // against the little bit of banking, so centered steering stays straight
    const aBank = G * Math.sin(bank) * Math.cos(bank);
    const aSide = aIn - aBank * (1 - cornering);
    vx += -sm.nx * aSide * dt; vz += -sm.nz * aSide * dt;

    // cushion: choppy conditions can still hook you
    this.hookCooldown = Math.max(0, this.hookCooldown - dt);
    const lumpy = surf.prep.lumpy;
    const vOut = vx * sm.nx + vz * sm.nz;
    this.onCushion = this.surfaceKind === 'cushion' ? 1 : 0;
    if ((this.surfaceKind === 'cushion' || this.surfaceKind === 'marbles') && lumpy > 0.5 && surf.cush > 0.4 && vOut > 3.6 && this.hookCooldown <= 0) {
      this._slide -= 0.18 * (vOut - 3.6) * lumpy; // the cushion snaps the car straight / to the right
      vx *= 0.96; vz *= 0.96;
      this.hookCooldown = 1.0;
      this.events.push({ type: 'hook', strength: vOut });
    }

    // ---- heading follows the path, minus the slide ----
    const newAng = Math.hypot(vx, vz) > 0.5 ? Math.atan2(vz, vx) : ang;
    const prevTh = this.th;
    this.th = speed >= 0 ? wrap(newAng - this._slide + kyaw) : this.th + turn * dt;
    this.w = wrap(this.th - prevTh) / dt;
    this._pathRate = this._lastAng !== undefined && sp > 2 ? clamp(wrap(newAng - this._lastAng) / dt, -3, 3) : 0;
    this._lastAng = newAng;
    c = Math.cos(this.th); s = Math.sin(this.th);
    this.u = vx * c + vz * s;
    this.v = -vx * s + vz * c;
    this.beta = this._slide;
    this.spin = clamp((thr - 0.3) * loose * 2.2 + this._slide, 0, 1.5) * sf;
    this.slip = Math.abs(this._slide);
    // front wheels: driver input plus the countersteer you see in a slide
    this.delta += (clamp(steer * 0.3 + this._slide * 0.75, -0.42, 0.42) - this.delta) * Math.min(1, dt * 10);

    this.x += vx * dt; this.z += vz * dt;
    this._walls(sm, vx, vz);

    const wheelTarget = this.u + this.spin * 9;
    this.rearWheelSpeed += (wheelTarget - this.rearWheelSpeed) * Math.min(1, dt * 10);
    this.frontWheelSpeed = this.u;
    const rpmT = clamp(Math.abs(this.rearWheelSpeed) * P.rpmPerMps, 2300, 9400);
    this.rpm += (rpmT - this.rpm) * Math.min(1, dt * 12);
    this.throttle = thr;
  }

  // knocked into a spin by contact: dir +1 / -1 = which way it rotates
  // car contact: a yaw kick (rad/s, + = nose to the right)
  knock(dw) {
    if (this.handling !== 'easy') { this.w += dw; return; }
    if (this._spinT > 0) { this._spinRate += dw; return; }
    this._krate = (this._krate || 0) + dw;
  }

  spinOut(dir, strength) {
    if (this.handling === 'easy') {
      if (this._spinT > 0) return;
      this._spinT = 1.2 + Math.min(1.2, strength * 0.06);
      this._spinRate = dir * (3.5 + Math.min(4, strength * 0.3));
    } else {
      this.w += dir * (1.5 + Math.min(4, strength * 0.3)); // the physics takes it from there
    }
  }

  // Easy handling, mid-spin: no control; the car rotates and scrubs off speed
  // along the way it was going, then you get it back
  _spinning(dt, sm, c, s, wrap) {
    this._spinT -= dt;
    let vx = this.u * c - this.v * s, vz = this.u * s + this.v * c;
    const sp = Math.hypot(vx, vz);
    const k = sp > 0.1 ? Math.max(0, sp - 11 * dt) / sp : 0;
    vx *= k; vz *= k;
    this.th = wrap(this.th + this._spinRate * dt);
    this.w = this._spinRate;
    this._spinRate *= 1 - Math.min(1, dt * 0.8);
    c = Math.cos(this.th); s = Math.sin(this.th);
    this.u = vx * c + vz * s;
    this.v = -vx * s + vz * c;
    this.x += vx * dt; this.z += vz * dt;
    this._walls(sm, vx, vz);
    this._slide = 0; this._lastAng = undefined; this._pathRate = 0;
    this.beta = Math.atan2(this.v, Math.max(Math.abs(this.u), 1));
    this.slip = 1; this.spin = 0.6; this.delta *= 0.9; this.pushing = false;
    this.rearWheelSpeed += (this.u - this.rearWheelSpeed) * Math.min(1, dt * 4);
    this.frontWheelSpeed = this.u;
    this.rpm += (2600 - this.rpm) * Math.min(1, dt * 3);
    this.throttle = 0;
    if (this._spinT <= 0) {
      // done spinning: you get it back pointed however it ended up, and the car
      // comes around to the direction it's rolling (no snapping straight)
      this._spinT = 0;
      const sp2 = Math.hypot(vx, vz);
      if (sp2 > 0.5) {
        const va = Math.atan2(vz, vx);
        const k = clamp(wrap(this.th - va), -1.1, 1.1);   // way around backwards: you've already gathered it up to here
        this.th = wrap(va + k);
        const c2 = Math.cos(this.th), s2 = Math.sin(this.th);
        this.u = vx * c2 + vz * s2; this.v = -vx * s2 + vz * c2;
        this._kyaw = k; this._krate = 0; this._recover = true;
      }
    }
  }

  _walls(sm, vx, vz) {
    const t = this.track, W = t.W, P = this.p;
    const pr = t.project(this.x, this.z, this.idx, this._pr);
    const tsm = t.sample(pr.s, this._sm);
    const psi = this.th - Math.atan2(tsm.tz, tsm.tx);
    const ext = P.halfWidth * Math.abs(Math.cos(psi)) + P.halfLength * Math.abs(Math.sin(psi));
    // outer wall depends on the section of track; inside is the infield berm
    const outer = W / 2 + t.wallE(pr.s), inner = -W / 2 - (t.innerEdge || 2.6);
    let pen = 0, nSign = 0;
    if (pr.d + ext > outer) { pen = pr.d + ext - outer; nSign = 1; }
    else if (pr.d - ext < inner) { pen = inner - (pr.d - ext); nSign = -1; }
    if (!pen) return;
    const nx = tsm.nx * nSign, nz = tsm.nz * nSign;
    this.x -= nx * pen; this.z -= nz * pen;
    const vn = vx * nx + vz * nz;
    if (vn <= 0) return;
    // impact
    const tvx = vx - vn * nx, tvz = vz - vn * nz;
    const soft = nSign < 0 || t.zones(pr.s).kind === 'flat'; // clay berm inside, pit fence past 3-4
    // bounce: the car comes back off the wall (always at least a little, so it
    // separates instead of grinding along it)
    const rest = soft ? 0.15 : 0.32;
    const vBack = Math.max(rest * vn, soft ? 0.6 : 1.2);
    // scrape: friction takes speed in proportion to how hard you hit, so a
    // brush costs a little and a big hit costs a lot
    const vt = Math.hypot(tvx, tvz);
    const loss = Math.min(vt, (soft ? 0.25 : 0.4) * (vn + vBack) + (vn > 8 ? (vn - 8) * 0.6 : 0));
    const keep = vt > 1e-6 ? (vt - loss) / vt : 0;
    const nvx = tvx * keep - vBack * nx, nvz = tvz * keep - vBack * nz;
    // wall straightens the car out (heading only; the velocity stays as computed)
    const along = Math.atan2(tvz, tvx);
    let dth = along - this.th;
    while (dth > Math.PI) dth -= 2 * Math.PI;
    while (dth < -Math.PI) dth += 2 * Math.PI;
    if (Math.abs(dth) < Math.PI / 2) this.th += dth * 0.35;
    const c = Math.cos(this.th), s = Math.sin(this.th);
    this.u = nvx * c + nvz * s;
    this.v = -nvx * s + nvz * c;
    this.w *= 0.4;
    if (this._slide) this._slide *= 0.6; // knocks the slide out of it (Easy handling)
    this.events.push({ type: 'wall', strength: vn, outer: nSign > 0 });
    if (nSign > 0 && !soft && vn > this.flipSpeed) {
      this.flipped = true;
      this.events.push({ type: 'flip', strength: vn });
    }
  }

  // collision impulse from another car (world-space push + velocity change)
  push(dx, dz, dvx, dvz) {
    this.x += dx; this.z += dz;
    const c = Math.cos(this.th), s = Math.sin(this.th);
    this.u += dvx * c + dvz * s;
    this.v += -dvx * s + dvz * c;
  }
}

// Simple autopilot used for headless tuning tests and attract mode.
export function autopilot(car, track, laneD, vTarget, look = 9) {
  const sm = track.pos(car.s + look, laneD, {});
  const dx = sm.x - car.x, dz = sm.z - car.z;
  const ang = Math.atan2(dz, dx);
  let err = ang - (car.th + Math.atan2(car.v, Math.max(car.u, 2)) * 0.8);
  while (err > Math.PI) err -= 2 * Math.PI;
  while (err < -Math.PI) err += 2 * Math.PI;
  const steer = clamp(err * 2.4, -1, 1);
  const dv = vTarget - car.u;
  const feather = clamp(1 - (Math.abs(car.beta) - 0.14) * 4, 0.2, 1);
  return { steer, throttle: clamp(0.25 + dv * 0.35, 0, 1) * feather, brake: clamp(-dv * 0.25 - 0.3, 0, 1) };
}
