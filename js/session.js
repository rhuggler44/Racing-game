// Game session: hot laps or a feature race (rolling 2-wide start, green /
// white / checkered, positions, lap times, car contact). No rendering here.
import { Car, autopilot } from './physics.js';
import { AIField, SpeedProfile } from './ai.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const shuffle = (list) => { const a = [...list]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };

export class Session {
  constructor(opts) {
    const { track, surface, mode, laps = 10, fieldSize = 22, difficulty = 'pro', startPos = 'random', drivers = [], player, assists = true } = opts;
    this.track = track; this.surface = surface; this.mode = mode;
    this.laps = laps; this.player = player;
    this.car = new Car(track, surface);
    this.car.assists = assists;
    this.car.handling = opts.handling || 'easy';
    this.time = 0; this.raceTime = 0;
    this.messages = [];
    // moments worth a replay: { t (session time), kind, focus ('player' or a driver), text, pri }
    this.highlights = [];
    this.playerLaps = []; this.bestLap = Infinity; this.lastLap = 0;
    this.playerStatus = 'running'; // running | finished | dnf
    this.flag = 'green';
    this._pw = { x: 0, z: 0 };
    // race night: the track is already worn in by earlier events
    this.surfaceLaps = opts.surfaceLaps || 0;
    this.qualLaps = opts.qualLaps || 2;

    if (mode === 'race') {
      // opts.grid: a set starting order ({ driver, isPlayer } / { driver, skill })
      const grid = opts.grid;
      const aiEntries = grid ? grid.filter((e) => !e.isPlayer) : null;
      const n = grid ? grid.length : clamp(fieldSize, 2, drivers.length + 1);
      // a plain feature: the lineup is drawn fresh every race
      const aiDrivers = aiEntries ? aiEntries.map((e) => e.driver) : shuffle(drivers.slice(0, n - 1));
      const skills = aiEntries ? new Map(aiEntries.map((e) => [e.driver, e.skill])) : null;
      this.field = new AIField(track, surface, aiDrivers, difficulty, skills);
      this.phase = 'pace';
      this.flag = 'none';
      this.paceSpeed = 21;
      this._setupGrid(grid ? grid.findIndex((e) => e.isPlayer) : startPos, n);
    } else {
      this.phase = 'running';
      this.car.reset(track.L * 0.55, -2, 18);
      this.profile = new SpeedProfile(track, surface);
      this.message('Out lap: the car drives itself. You take over at the line.', 4);
      this.lapStartTime = null;
      surface.setLaps(this.surfaceLaps);
      if (mode === 'qual') this.message(`Qualifying: ${this.qualLaps} timed laps. The car drives itself until the line.`, 4);
    }
  }

  _setupGrid(startPos, n) {
    const t = this.track;
    let k = typeof startPos === 'number' ? startPos : startPos === 'front' ? 0 : startPos === 'back' ? n - 1 : startPos === 'middle' ? Math.floor(n / 2) : Math.floor(Math.random() * n);
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
    this.surface.setLaps(this.surfaceLaps);
    this.message('Pace lap: the car drives itself. You take over at the green.', 4);
  }

  message(text, dur = 2.5, big = false) { this.messages.push({ text, dur, big, t: 0 }); }
  highlight(kind, focus, text, pri) {
    if (this.mode !== 'race') return;
    // once you've finished (or you're out), only the big stuff counts
    if (kind !== 'win' && kind !== 'flip' && this.playerStatus !== 'running') return;
    this.highlights.push({ t: this.time, kind, focus, text, pri });
  }
  _where(s) {
    const n = this.track.turnAt(s);
    if (n) return `in turn ${n}`;
    const z = this.track.turnZones, w = this.track.wrap(s);
    return w > z[3].s1 && w < z[5].s0 ? 'down the backstretch' : 'on the front stretch';
  }
  _last(name) { return name.split(' ').slice(-1)[0]; }

  playerWorld() { return this.car; }

  // ordering list for HUD / results
  standings() {
    if (this.mode !== 'race') return [];
    const L = this.track.L;
    const rows = this.field.cars.map((c) => ({
      name: c.driver.name, number: c.driver.number, colors: c.driver.colors,
      dist: c.S - L, finished: c.finished, finishOrder: c.finishOrder ?? 999, best: c.bestLap, isPlayer: false, ref: c,
      dnf: false, laps: c.finished ? c.finishLaps : Math.floor((c.S - L) / L), lineTime: c.lineTime ?? 0,
    }));
    rows.push({
      name: this.player.name, number: this.player.number, colors: this.player.colors,
      dist: this.car.S - L, finished: this.playerStatus === 'finished', finishOrder: this.playerFinishOrder ?? 999,
      best: this.bestLap, isPlayer: true, dnf: this.playerStatus === 'dnf',
      laps: this.playerStatus === 'finished' ? this.playerFinishLaps : Math.floor((this.car.S - L) / L), lineTime: this._pLine ?? 0,
    });
    // real running order: laps completed first (a lapped car stays a lap down,
    // even if it takes the checkers ahead of the leader), then who got there first
    const scoredAtLine = this.phase === 'checkered' || this.phase === 'done';
    rows.sort((a, b) => {
      if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
      if (a.laps !== b.laps) return b.laps - a.laps;
      if (a.finished && b.finished) return a.finishOrder - b.finishOrder;
      // once the checkers are out, it's scored at the line: same laps, whoever
      // crossed first is ahead. Before that, it's where you are on the track.
      if (scoredAtLine) return a.lineTime - b.lineTime;
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
    let inp = this.playerStatus === 'dnf' ? { steer: 0, throttle: 0, brake: 1 } : input;
    // the computer drives the pace lap / out lap; you get the car at the green / the line
    // and takes it back for the cool-down once you've taken the checkered flag
    this.autoDriving = !car.flipped && (this.mode === 'race' ? this.phase === 'pace' || this.playerStatus === 'finished' : (this.lapStartTime == null && !this._handedOver) || this.playerStatus === 'finished');
    if (this.autoDriving) inp = this._autoInput();
    const sub = 2, h = dt / sub;
    for (let i = 0; i < sub; i++) car.step(h, inp);

    for (const e of car.events) {
      if (e.type === 'flip') {
        const what = e.cause === 'bank' ? `OVER THE BANK IN TURN ${this.track.turnAt(car.s) || 2}!` : 'FLIPPED!';
        if (this.mode === 'race') this.highlight('flip', 'player', e.cause === 'bank' ? `${this._last(this.player.name)} goes over the bank ${this._where(car.s)}!` : `${this._last(this.player.name)} flips ${this._where(car.s)}!`, 100);
        if (this.mode === 'race' && this.playerStatus === 'running') {
          this.playerStatus = 'dnf';
          this.message(`${what} Your night is over.`, 4, true);
        } else if (this.mode === 'race') {
          // after the checkers your finish already counts
          this.message(`${what} Good thing you already took the checkers.`, 3, true);
        } else {
          this.message(what, 2.5, true);
          this._flipReset = 2.5;
        }
      } else if (e.type === 'wall' && e.strength > 9 && this.mode === 'race' && this.phase !== 'pace') {
        this.highlight('wall', 'player', `${this._last(this.player.name)} pounds the wall ${this._where(car.s)}`, 45);
      } else if (e.type === 'spun' && this.mode === 'race') {
        const h = this._playerHitBy && this.time - this._playerHitBy.t < 3 ? this._playerHitBy : null;
        this.message(h ? `${this._last(h.name)} turned you around!` : 'You lost it!', 2.2, true);
        this.highlight('spin', 'player', `${this._last(this.player.name)} gets turned around ${this._where(car.s)}${h ? ' by ' + this._last(h.name) : ''}`, 70);
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

  _autoInput() {
    const t = this.track, car = this.car;
    if (this.playerStatus === 'finished') {
      // cool-down: ease off and roll around down low
      const v = Math.max(18, car.u - 6);
      return autopilot(car, t, -t.W * 0.3, v);
    }
    if (this.mode === 'race') {
      const slotS = this.paceLeadS - this.playerSlot.row * 8.5;
      const v = this.paceSpeed + clamp((slotS - car.S) * 0.6, -6, 6);
      return autopilot(car, t, this.playerSlot.d, v);
    }
    // out lap: a brisk lap down low so you hit the line at speed
    this.profile.update();
    let v = 99;
    for (let o = 4; o < 45; o += 3) { const vp = this.profile.speed(car.s + o, 0.22) * 0.85; v = Math.min(v, Math.sqrt(vp * vp + 2 * 9 * Math.max(0, o - 8))); }
    return autopilot(car, t, -4.5, v);
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
        if (this.mode === 'qual' && this.playerLaps.length >= this.qualLaps && this.playerStatus === 'running') {
          this.playerStatus = 'finished';
          this.phase = 'done';
          this.message(`Qualified: ${this.bestLap.toFixed(3)}`, 4, true);
          this.onDone && this.onDone();
        }
      } else {
        this.message('GO! You have the car.', 1.8, true);
        this._handedOver = true;
        this.onHandover && this.onHandover();
      }
      this.lapStartTime = this.playerStatus === 'running' ? this.time : null;
      this.surface.setLaps(this.surfaceLaps + this.playerLaps.length * 1.0);
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
    if (this.phase !== 'pace') this.surface.setLaps(this.surfaceLaps + Math.floor(ll * 4) / 4);

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
        // once the checkers are out everyone finishes the next time by; the race
        // wraps up when they all have, or 15 s after you took the flag
        const allDone = field.cars.every((c) => c.finished) && this.playerStatus !== 'running';
        const sinceYou = this._playerFinishAt != null ? this.raceTime - this._playerFinishAt : 0;
        if (allDone || sinceYou > 15 || (this.playerStatus !== 'running' && this.raceTime - (this._checkeredAt ?? (this._checkeredAt = this.raceTime)) > 25)) {
          this.phase = 'done';
          this.onDone && this.onDone();
        }
      }
      if (this.playerStatus === 'dnf' && this.phase !== 'done') {
        this._dnfTimer = (this._dnfTimer || 0) + dt;
        if (this._dnfTimer > 4) { this.phase = 'done'; this.onDone && this.onDone(); }
      }
    }

    if (this._playerFinishAt != null && !this._coolSaid && !this.car.flipped && this.raceTime - this._playerFinishAt > 4.2) {
      this._coolSaid = true;
      this.message('Cool-down lap: the computer has the car.', 5);
    }

    // ---- contact between player and AI ----
    this._contact(dt);
    this._spinNews();
    this._watchOrder(dt);
  }

  // passes for position and lead changes, for the highlights
  _watchOrder(dt) {
    if (this.phase === 'pace' || this.phase === 'done') { this._order = null; return; }
    this._orderT = (this._orderT || 0) - dt;
    if (this._orderT > 0) return;
    this._orderT = 0.25;
    const st = this.standings();
    const me = st.findIndex((r) => r.isPlayer);
    const leader = st[0].isPlayer ? 'player' : st[0].ref.driver;
    const prev = this._order;
    this._order = { me, leader, behind: st[me + 1] };
    if (!prev || this.raceTime < 4) return; // the start shuffles everyone
    const name = this._last(this.player.name);
    if (me < prev.me && this.playerStatus === 'running' && !this.car.flipped) {
      const passed = st[me + 1];
      const who = passed ? (passed.isPlayer ? '' : this._last(passed.name)) : '';
      if (me === 0) this.highlight('lead', 'player', `${name} takes the lead${who ? ' from ' + who : ''} ${this._where(this.car.s)}!`, 90);
      else this.highlight('pass', 'player', `${name} gets by ${who} for P${me + 1}`, 30 + (this.field.cars.length - me) * 1.5 + (this.flag === 'white' ? 25 : 0));
    } else if (leader !== prev.leader && leader !== 'player' && prev.leader !== 'player') {
      this.highlight('lead', leader, `Lead change! ${leader.name} takes over ${this._where(st[0].ref.S)}`, 45);
    }
  }

  _finish(c) {
    c.finished = true;
    c.finishLaps = Math.floor((c.S - this.track.L) / this.track.L);
    this._finishCount = (this._finishCount || 0) + 1;
    c.finishOrder = this._finishCount;
    if (this.standings()[0].ref === c && !this._winnerSaid) {
      this._winnerSaid = true; this.message(`${c.driver.name} wins!`, 3, true);
      this.highlight('win', c.driver, `Checkered flag: ${c.driver.name} wins it!`, 200);
    }
  }
  _finishPlayer() {
    this.playerStatus = 'finished';
    this.playerFinishLaps = Math.floor((this.car.S - this.track.L) / this.track.L);
    this._finishCount = (this._finishCount || 0) + 1;
    this.playerFinishOrder = this._finishCount;
    this._playerFinishAt = this.raceTime;
    const pos = this.playerPosition();
    if (pos === 1) this._winnerSaid = true;
    this.message(pos === 1 ? 'YOU WIN!' : `Finished P${pos}`, 4, true);
    if (pos === 1) this.highlight('win', 'player', `Checkered flag: ${this.player.name} wins it!`, 200);
  }

  // Car-to-car contact (you vs the AI cars), with lapped cars too. Both cars are
  // the same weight: the closing speed is shared out between them, so you
  // can't plow through people. Rubbing just bumps; a hard hit spins the car
  // that took it (a shot to the rear or a hard side hit), but no flips.
  // ---- car contact ----
  // Every car is a body with two circles (nose and tail). When two touch, the hit
  // is worked out at the point of contact: it shoves both cars and twists them
  // (a tap on someone's right rear swings their tail around; your nose taking the
  // same hit barely turns you). Each driver then has to catch it: the AI by
  // skill, you by countersteering. If it can't be caught, it spins, as hard and
  // whichever way the hit sent it.
  _bodies() {
    const t = this.track, car = this.car;
    const out = this._bodyList || (this._bodyList = []);
    out.length = 0;
    if (!car.flipped) {
      const c = Math.cos(car.th), s = Math.sin(car.th);
      out.push({ isPlayer: true, S: car.S, d: car.d, x: car.x, z: car.z, th: car.th,
        vx: car.u * c - car.v * s, vz: car.u * s + car.v * c, name: this.player.name });
    }
    for (const c of this.field.cars) {
      const sm = t.pos(c.S, c.d, {});
      const vx = c.v * sm.tx + c.dVel * sm.nx, vz = c.v * sm.tz + c.dVel * sm.nz;
      out.push({ ai: c, S: c.S, d: c.d, x: sm.x, z: sm.z, th: c.heading, vx, vz, tx: sm.tx, tz: sm.tz, nx: sm.nx, nz: sm.nz, name: c.driver.name });
    }
    return out;
  }

  _contact(dt) {
    const L = this.track.L;
    const B = this._bodies();
    for (let i = 0; i < B.length; i++) for (let j = i + 1; j < B.length; j++) {
      const a = B[i], b = B[j];
      let dS = (b.S - a.S) % L;
      if (dS > L / 2) dS -= L; else if (dS < -L / 2) dS += L;
      if (Math.abs(dS) > 6 || Math.abs(b.d - a.d) > 4) continue;
      this._hit(a, b);
    }
    if (this._bang) { this._bang -= dt; if (this._bang <= 0) this._bang = 0; }
  }

  _hit(A, Bd) {
    // each car is a box (nerf bars to nerf bars): 1.75 m half length, 0.95 m half width
    const HL = 1.75, HW = 0.95, K = 1.38; // K: yaw inertia / mass (m²)
    const fa = [Math.cos(A.th), Math.sin(A.th)], fb = [Math.cos(Bd.th), Math.sin(Bd.th)];
    const la = [-fa[1], fa[0]], lb = [-fb[1], fb[0]];
    const dx0 = A.x - Bd.x, dz0 = A.z - Bd.z;
    // separating axes: the boxes touch only if they overlap along all four; the
    // push-out goes along the one with the least overlap
    let best = null;
    for (const u of [fa, la, fb, lb]) {
      const r = HL * (Math.abs(fa[0] * u[0] + fa[1] * u[1]) + Math.abs(fb[0] * u[0] + fb[1] * u[1]))
        + HW * (Math.abs(la[0] * u[0] + la[1] * u[1]) + Math.abs(lb[0] * u[0] + lb[1] * u[1]));
      const dd = dx0 * u[0] + dz0 * u[1];
      const ov = r - Math.abs(dd);
      if (ov <= 0) return;
      if (!best || ov < best.pen) best = { pen: ov, nx: u[0] * Math.sign(dd || 1), nz: u[1] * Math.sign(dd || 1) };
    }
    // where they touch: the corners that ended up inside the other car
    let px = 0, pz = 0, n = 0;
    const inside = (P, fp, lp, Q, fq, lq) => {
      for (let i = -1; i <= 1; i += 2) for (let k = -1; k <= 1; k += 2) {
        const cx = P.x + fp[0] * HL * i + lp[0] * HW * k, cz = P.z + fp[1] * HL * i + lp[1] * HW * k;
        const rx = cx - Q.x, rz = cz - Q.z;
        if (Math.abs(rx * fq[0] + rz * fq[1]) <= HL + 0.05 && Math.abs(rx * lq[0] + rz * lq[1]) <= HW + 0.05) { px += cx; pz += cz; n++; }
      }
    };
    inside(A, fa, la, Bd, fb, lb); inside(Bd, fb, lb, A, fa, la);
    const hit = n ? { nx: best.nx, nz: best.nz, px: px / n, pz: pz / n } : { nx: best.nx, nz: best.nz, px: (A.x + Bd.x) / 2, pz: (A.z + Bd.z) / 2 };
    const { nx, nz } = hit, pen = Math.min(best.pen, 0.6);
    // separate them, half each
    this._apply(A, nx * pen * 0.5, nz * pen * 0.5, 0, 0, 0);
    this._apply(Bd, -nx * pen * 0.5, -nz * pen * 0.5, 0, 0, 0);
    const rvx = A.vx - Bd.vx, rvz = A.vz - Bd.vz;
    const rel = rvx * nx + rvz * nz; // < 0: closing
    if (rel >= 0) return;
    // impulse at the contact point (equal masses, a little bounce, some rubbing friction)
    const rax = hit.px - A.x, raz = hit.pz - A.z, rbx = hit.px - Bd.x, rbz = hit.pz - Bd.z;
    const cross = (rx, rz, jx, jz) => rx * jz - rz * jx;
    const ran = cross(rax, raz, nx, nz), rbn = cross(rbx, rbz, nx, nz);
    const jn = (-rel * 1.25) / (2 + (ran * ran + rbn * rbn) / K);
    const tx = -nz, tz = nx, relT = rvx * tx + rvz * tz;
    const rat = cross(rax, raz, tx, tz), rbt = cross(rbx, rbz, tx, tz);
    const jt = clamp(-relT / (2 + (rat * rat + rbt * rbt) / K), -0.35 * jn, 0.35 * jn);
    const Jx = jn * nx + jt * tx, Jz = jn * nz + jt * tz;
    // the twist: hit behind the middle and the tail gets knocked out (the rear tires
    // can't hold it); hit up front and the rear tires keep it pointed straight
    const yaw = (body, rx, rz, jx, jz, f) => {
      const along = (rx * f[0] + rz * f[1]) / HL; // -1 tail .. +1 nose
      return (cross(rx, rz, jx, jz) / K) * (along < -0.25 ? 3.4 : along > 0.25 ? 0.5 : 1.1);
    };
    const pace = this.phase === 'pace';
    // leaning on someone (bump drafting, rubbing side by side) shoves; it takes a real hit to twist
    const twist = pace ? 0 : clamp((-rel - 1.5) / 2.5, 0, 1);
    const wa = twist * yaw(A, rax, raz, Jx, Jz, fa), wb = twist * yaw(Bd, rbx, rbz, -Jx, -Jz, fb);
    this._apply(A, 0, 0, Jx, Jz, wa, Bd);
    this._apply(Bd, 0, 0, -Jx, -Jz, wb, A);
    const strength = -rel;
    const withPlayer = A.isPlayer || Bd.isPlayer;
    if (withPlayer && strength > 2.5 && !this._bang) {
      this._bang = 0.35; this.onContact && this.onContact(strength);
      const other = A.isPlayer ? Bd : A;
      if (strength > 5 && !pace) this.highlight('contact', 'player', `Contact! ${this._last(this.player.name)} and ${this._last(other.name)} ${this._where(this.car.s)}`, 35);
    }
  }

  // move / shove / twist one body (world frame)
  _apply(b, dx, dz, dvx, dvz, dw, by = null) {
    if (b.isPlayer) {
      this.car.push(dx, dz, dvx, dvz);
      if (dw) this.car.knock(dw);
      if (by) this._playerHitBy = { name: by.name, t: this.time };
      return;
    }
    const c = b.ai;
    if (dx || dz) { c.d += dx * b.nx + dz * b.nz; c.S += dx * b.tx + dz * b.tz; }
    if (dvx || dvz || dw) this.field.knock(c, dvx * b.tx + dvz * b.tz, dvx * b.nx + dvz * b.nz, dw);
    if (by) c.hitBy = { name: by.name, isPlayer: !!by.isPlayer, t: this.time };
    // keep the snapshot current for the next pair this step
    b.S = c.S; b.d = c.d;
  }

  // who just lost it (called each step after the cars move)
  _spinNews() {
    for (const c of this.field.spunOut) {
      const h = c.hitBy && this.time - c.hitBy.t < 3 ? c.hitBy : null;
      this.message(`${c.driver.name} spins!`, 2);
      if (h && (h.isPlayer || this.playerStatus === 'running')) {
        this.highlight('spin', c.driver, h.isPlayer ? `${c.driver.name} spins ${this._where(c.S)} after contact with ${this._last(this.player.name)}` : `${c.driver.name} spins ${this._where(c.S)} after contact with ${this._last(h.name)}`, h.isPlayer ? 60 : 45);
      }
    }
    this.field.spunOut.length = 0;
  }


}
