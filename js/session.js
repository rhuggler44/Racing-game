// Game session: hot laps or a feature race (rolling 2-wide start, green /
// white / checkered, positions, lap times, car contact). No rendering here.
import { Car } from './physics.js';
import { AIField } from './ai.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class Session {
  constructor(opts) {
    const { track, surface, mode, laps = 10, fieldSize = 22, difficulty = 'pro', startPos = 'random', drivers = [], player, assists = true } = opts;
    this.track = track; this.surface = surface; this.mode = mode;
    this.laps = laps; this.player = player;
    this.car = new Car(track, surface);
    this.car.assists = assists;
    this.time = 0; this.raceTime = 0;
    this.messages = [];
    this.playerLaps = []; this.bestLap = Infinity; this.lastLap = 0;
    this.playerStatus = 'running'; // running | finished | dnf
    this.flag = 'green';
    this._pw = { x: 0, z: 0 };

    if (mode === 'race') {
      const n = clamp(fieldSize, 2, drivers.length + 1);
      this.field = new AIField(track, surface, drivers.slice(0, n - 1), difficulty);
      this.phase = 'pace';
      this.flag = 'none';
      this.paceSpeed = 21;
      this._setupGrid(startPos, n);
    } else {
      this.phase = 'running';
      this.car.reset(track.L * 0.55, -2, 18);
      this.lapStartTime = null;
      surface.setLaps(0);
    }
  }

  _setupGrid(startPos, n) {
    const t = this.track;
    let k = startPos === 'front' ? 0 : startPos === 'back' ? n - 1 : startPos === 'middle' ? Math.floor(n / 2) : Math.floor(Math.random() * n);
    this.playerGridSlot = k;
    this.gridLeadS = t.L * 0.5 + 12;
    this.slots = new Map();
    const slotOf = (i) => ({ row: Math.floor(i / 2), col: i % 2 });
    let ai = 0;
    for (let i = 0; i < n; i++) {
      const { row, col } = slotOf(i);
      const S = this.gridLeadS - row * 8.5;
      const d = col === 0 ? -3.0 : 2.0;
      if (i === k) {
        this.car.reset(S, d, this.paceSpeed);
        this.car.lap = 0; this.car.S = S;
        this.playerSlot = { row, d };
      } else {
        const c = this.field.cars[ai++];
        c.S = S; c.d = d; c.dTarget = d; c.v = this.paceSpeed;
        c.row = row; c.slotD = d;
        c.raceDist = S - t.L; c.lapsDone = 0;
        this.slots.set(c, { S, d });
      }
    }
    this.car.speedLimit = this.paceSpeed + 1.5;
    this.paceLeadS = this.gridLeadS;
    this.surface.setLaps(0);
    this.message('Pace lap: two by two. Hold your spot.', 4);
  }

  message(text, dur = 2.5, big = false) { this.messages.push({ text, dur, big, t: 0 }); }

  playerWorld() { return this.car; }

  // ordering list for HUD / results
  standings() {
    if (this.mode !== 'race') return [];
    const L = this.track.L;
    const rows = this.field.cars.map((c) => ({
      name: c.driver.name, number: c.driver.number, colors: c.driver.colors,
      dist: c.S - L, finished: c.finished, finishOrder: c.finishOrder ?? 999, best: c.bestLap, isPlayer: false, ref: c,
      dnf: false,
    }));
    rows.push({
      name: this.player.name, number: this.player.number, colors: this.player.colors,
      dist: this.car.S - L, finished: this.playerStatus === 'finished', finishOrder: this.playerFinishOrder ?? 999,
      best: this.bestLap, isPlayer: true, dnf: this.playerStatus === 'dnf',
    });
    rows.sort((a, b) => {
      if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
      if (a.finished && b.finished) return a.finishOrder - b.finishOrder;
      if (a.finished !== b.finished) return a.finished ? -1 : 1;
      return b.dist - a.dist;
    });
    return rows;
  }

  playerPosition() {
    const st = this.standings();
    return st.findIndex((r) => r.isPlayer) + 1;
  }

  leaderLaps() {
    if (this.mode !== 'race') return 0;
    let best = -1e9;
    for (const c of this.field.cars) best = Math.max(best, c.S);
    best = Math.max(best, this.car.S);
    return Math.max(0, (best - this.track.L) / this.track.L);
  }

  resetPlayer() {
    if (this.car.flipped && this.mode === 'race') return;
    const t = this.track, c = this.car;
    const lap = c.lap;
    c.reset(c.s, -t.W / 2 + 2.2, 0);
    c.lap = lap; c.S = lap * t.L + c.s;
    if (this.phase === 'pace') c.speedLimit = this.paceSpeed + 1.5;
  }

  update(dt, input) {
    this.time += dt;
    const t = this.track, L = t.L, car = this.car;
    const prevS = car.S;

    // ---- player physics (fixed substeps) ----
    const inp = this.playerStatus === 'dnf' ? { steer: 0, throttle: 0, brake: 1 } : input;
    const sub = 2, h = dt / sub;
    for (let i = 0; i < sub; i++) car.step(h, inp);

    for (const e of car.events) {
      if (e.type === 'flip') {
        const what = e.cause === 'bank' ? `OVER THE BANK IN TURN ${this.track.turnAt(car.s) || 2}!` : 'FLIPPED!';
        if (this.mode === 'race') {
          this.playerStatus = 'dnf';
          this.message(`${what} Your night is over.`, 4, true);
        } else {
          this.message(what, 2.5, true);
          this._flipReset = 2.5;
        }
      } else if (e.type === 'hook') {
        this.message('The cushion bit you!', 1.5);
      }
    }
    car.events.length = 0;
    if (this._flipReset !== undefined) {
      this._flipReset -= dt;
      if (this._flipReset <= 0) { this._flipReset = undefined; car.flipped = false; this.resetPlayer(); }
    }

    if (this.mode === 'race') this._raceUpdate(dt, prevS);
    else this._hotlapUpdate(dt, prevS);

    for (const m of this.messages) m.t += dt;
    this.messages = this.messages.filter((m) => m.t < m.dur);
  }

  _hotlapUpdate(dt, prevS) {
    const L = this.track.L, car = this.car;
    if (Math.floor(car.S / L) > Math.floor(prevS / L)) {
      if (this.lapStartTime != null) {
        const lt = this.time - this.lapStartTime;
        this.lastLap = lt;
        this.playerLaps.push(lt);
        const pb = lt < this.bestLap;
        if (pb) this.bestLap = lt;
        this.message(`${lt.toFixed(3)}${pb ? '  BEST' : ''}`, 3, true);
        this.onLap && this.onLap(lt, pb);
      } else {
        this.message('Hot lap: GO!', 1.5);
      }
      this.lapStartTime = this.time;
      this.surface.setLaps(this.playerLaps.length * 1.0);
    }
    if (Math.floor(car.S / L) < Math.floor(prevS / L)) this.lapStartTime = null; // went backwards
  }

  _raceUpdate(dt, prevS) {
    const t = this.track, L = t.L, car = this.car, field = this.field;

    // ---- phases ----
    if (this.phase === 'pace') {
      this.paceLeadS += this.paceSpeed * dt;
      for (const c of field.cars) this.slots.get(c).S = this.paceLeadS - c.row * 8.5;
      const toGreen = L - this.paceLeadS;
      if (toGreen < 90 && !this._warned) { this._warned = true; this.message('Get ready…', 2); }
      if (this.paceLeadS >= L) {
        this.phase = 'green';
        this.flag = 'green';
        car.speedLimit = Infinity;
        this.raceTime = 0;
        this.message('GREEN! GREEN! GREEN!', 2.5, true);
        this.onGreen && this.onGreen();
      }
    } else {
      this.raceTime += dt;
    }

    // ---- AI ----
    const others = this._others || (this._others = []);
    others.length = 0;
    for (const c of field.cars) others.push(c);
    const pv = { S: car.S, d: car.d, v: Math.max(0, car.u), isPlayer: true };
    others.push(pv);
    const mode = { phase: this.phase === 'pace' ? 'pace' : this.phase === 'done' ? 'cooldown' : 'race', slots: this.slots, paceSpeed: this.paceSpeed };
    field.step(dt, others, mode);

    // ---- surface evolves with the leader's laps ----
    const ll = this.leaderLaps();
    if (this.phase !== 'pace') this.surface.setLaps(Math.floor(ll * 4) / 4);

    // ---- lap counting / flags ----
    if (this.phase !== 'pace') {
      for (const c of field.cars) {
        const done = Math.floor((c.S - L) / L);
        if (c.lapsDone === undefined) c.lapsDone = 0;
        if (c.S >= L && done + 1 > c.lapsDone && c.S - L >= 0) {
          // crossed the line
          const now = this.raceTime;
          if (c.lineTime !== undefined && done >= 1) {
            const lt = now - c.lineTime;
            c.lastLap = lt;
            if (lt < c.bestLap) c.bestLap = lt;
          }
          c.lineTime = now;
          c.lapsDone = done + 1;
          if (!c.finished && (done >= this.laps || this.phase === 'checkered')) {
            if (done >= this.laps || this.flag === 'checkered') this._finish(c);
          }
        }
      }
      // player line crossings
      const pDone = Math.floor((car.S - L) / L);
      const prevDone = Math.floor((prevS - L) / L);
      if (pDone > prevDone && car.S >= L) {
        if (this._pLine !== undefined) {
          const lt = this.raceTime - this._pLine;
          this.lastLap = lt; this.playerLaps.push(lt);
          if (lt < this.bestLap) this.bestLap = lt;
        }
        this._pLine = this.raceTime;
        if (this.playerStatus === 'running' && (pDone >= this.laps || this.flag === 'checkered') && pDone >= 1) {
          this._finishPlayer();
        }
      }
      // flags from the leader
      const leaderDone = Math.floor(ll + 1e-6);
      if (this.flag === 'green' && leaderDone >= this.laps - 1 && this.laps > 1) { this.flag = 'white'; this.message('White flag, one to go!', 2.5, true); }
      if (this.flag !== 'checkered' && leaderDone >= this.laps) {
        this.flag = 'checkered';
        this.phase = 'checkered';
      }
      if (this.phase === 'checkered') {
        const allDone = field.cars.every((c) => c.finished) && this.playerStatus !== 'running';
        if (allDone || (this.playerStatus !== 'running' && this.raceTime - (this._checkeredAt ?? (this._checkeredAt = this.raceTime)) > 25)) {
          this.phase = 'done';
          this.onDone && this.onDone();
        }
      }
      if (this.playerStatus === 'dnf' && this.phase !== 'done') {
        this._dnfTimer = (this._dnfTimer || 0) + dt;
        if (this._dnfTimer > 4) { this.phase = 'done'; this.onDone && this.onDone(); }
      }
    }

    // ---- contact between player and AI ----
    this._contact(dt);
  }

  _finish(c) {
    c.finished = true;
    this._finishCount = (this._finishCount || 0) + 1;
    c.finishOrder = this._finishCount;
    if (this._finishCount === 1) this.message(`${c.driver.name} wins!`, 3, true);
  }
  _finishPlayer() {
    this.playerStatus = 'finished';
    this._finishCount = (this._finishCount || 0) + 1;
    this.playerFinishOrder = this._finishCount;
    const pos = this.playerPosition();
    this.message(pos === 1 ? 'YOU WIN!' : `Finished P${pos}`, 4, true);
  }

  _contact(dt) {
    const t = this.track, car = this.car;
    if (car.flipped) return;
    const sm = {};
    const pf = [Math.cos(car.th), Math.sin(car.th)];
    const pc = [[car.x + pf[0] * 0.9, car.z + pf[1] * 0.9], [car.x - pf[0] * 0.9, car.z - pf[1] * 0.9]];
    const R = 1.0;
    for (const c of this.field.cars) {
      const dS = c.S - car.S;
      if (Math.abs(dS) > 6 || Math.abs(c.d - car.d) > 4) continue;
      t.pos(c.S, c.d, sm);
      const cf = [Math.cos(c.heading), Math.sin(c.heading)];
      const cc = [[sm.x + cf[0] * 0.9, sm.z + cf[1] * 0.9], [sm.x - cf[0] * 0.9, sm.z - cf[1] * 0.9]];
      for (const a of pc) for (const b of cc) {
        const dx = a[0] - b[0], dz = a[1] - b[1];
        const dist = Math.hypot(dx, dz);
        if (dist < 2 * R && dist > 1e-3) {
          const nx = dx / dist, nz = dz / dist, pen = 2 * R - dist;
          // relative velocity along normal
          const pvx = car.u * pf[0] - car.v * pf[1], pvz = car.u * pf[1] + car.v * pf[0];
          const cvx = c.v * sm.tx + c.dVel * sm.nx, cvz = c.v * sm.tz + c.dVel * sm.nz;
          const rel = (pvx - cvx) * nx + (pvz - cvz) * nz;
          let jx = 0, jz = 0;
          if (rel < 0) { const j = -rel * 0.6; jx = nx * j; jz = nz * j; }
          car.push(nx * pen * 0.55, nz * pen * 0.55, jx, jz);
          // AI gets pushed in track coords
          const pushD = -(nx * sm.nx + nz * sm.nz) * pen * 0.45;
          const pushS = -(nx * sm.tx + nz * sm.tz);
          c.d += pushD; c.dVel += pushD * 4;
          c.v = Math.max(0, c.v + pushS * (rel < 0 ? -rel * 0.5 : 0));
          if (rel < -3 && !this._bang) { this._bang = 0.4; this.onContact && this.onContact(-rel); }
        }
      }
    }
    if (this._bang) { this._bang -= dt; if (this._bang <= 0) this._bang = 0; }
  }
}
