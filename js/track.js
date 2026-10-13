// Track geometry + dirt surface model. Pure JS (no three.js) so it can be
// unit-tested in node.

export const G = 9.81;
const DEG = Math.PI / 180;

// Lincoln Park Speedway, Putnamville IN: 5/16-mile dirt oval.
// Lap record (sprint car): 12.276s, Brady Bacon, 2018.
export const LINCOLN_PARK = {
  id: 'lincoln-park',
  name: 'Lincoln Park Speedway',
  location: 'Putnamville, Indiana',
  lengthLabel: '5/16 mile',
  length: 502.92,       // meters of centerline
  straight: 72,         // each straightaway
  ramp: 22,             // spiral easement into / out of each turn
  width: 17,            // racing surface width
  bankTurn: 12 * DEG,
  bankStraight: 4 * DEG,
  recordLap: 12.276,
  recordBy: 'Brady Bacon, 2018',
  layout: 'lincoln',    // open turns (see zones()), clay berm around the infield
  inner: { apron: 1.6, edge: 2.6 },
  // clay colors: tacky, dry, cushion, marbles
  clay: [[116, 72, 46], [168, 128, 92], [96, 60, 38], [150, 112, 80]],
};

// Eldora Speedway, Rossburg OH: the high-banked 1/2-mile clay oval. Laid out from
// Ryan's in-car video: concrete wall with a catch fence all the way around, an
// inside wall with yellow pads, wide turns, gray-brown clay.
export const ELDORA = {
  id: 'eldora',
  name: 'Eldora Speedway',
  location: 'Rossburg, Ohio',
  lengthLabel: '1/2 mile',
  length: 804.67,
  straight: 90,         // short straights, big sweeping turns (~88 m radius), from the satellite view
  backBend: 0.26,       // the backstretch bows out a little instead of running dead straight
  ramp: 45,
  width: 24,
  bankTurn: 20 * DEG,
  bankStraight: 6 * DEG,
  recordLap: null,
  layout: 'walled',     // wall right at the edge all the way around
  inner: { apron: 2.4, edge: 2.9, wall: true },
  grip: 0.8,   // the big, fast banks are tuned down to sane lap times
  aiPace: 1.1,   // the AI's speed profile undersells these banks; this evens it up
  clay: [[104, 86, 70], [176, 158, 134], [88, 72, 58], [150, 134, 112]],
};

export const TRACKS = { [LINCOLN_PARK.id]: LINCOLN_PARK, [ELDORA.id]: ELDORA };

export function buildTrack(def = LINCOLN_PARK, N = 1000) {
  const L = def.length, S = def.straight, T = def.ramp;
  const A = (L - 2 * S) / 2 - 2 * T; // constant-radius arc per turn
  // def.backBend: the backstretch isn't dead straight; it bends gently left by
  // this many radians, and each turn gives up half of that
  const bend = def.backBend || 0;
  const kMax = (Math.PI - bend / 2) / (A + T);
  const segs = [
    [S / 2, 's'], [T, 'in'], [A, 'arc'], [T, 'out'],
    [S, 's'], [T, 'in'], [A, 'arc'], [T, 'out'], [S / 2, 's'],
  ];
  // Turn numbering for HUD / messages
  const turnZones = [];
  {
    let s0 = 0;
    for (const [len, kind] of segs) { turnZones.push({ s0, s1: s0 + len, kind }); s0 += len; }
  }
  function curv(s) {
    let s0 = 0;
    for (let si = 0; si < segs.length; si++) {
      const [len, kind] = segs[si];
      if (s < s0 + len) {
        const t = (s - s0) / len;
        if (kind === 's') return si === 4 && bend ? (bend / len) * 2 * Math.sin(Math.PI * t) ** 2 : 0;
        if (kind === 'arc') return kMax;
        if (kind === 'in') return kMax * t;
        return kMax * (1 - t);
      }
      s0 += len;
    }
    return 0;
  }

  const ds = L / N;
  const x = new Float64Array(N), z = new Float64Array(N), th = new Float64Array(N);
  const k = new Float64Array(N);
  // integrate heading; left turn => heading decreases (right-handed, y up)
  let cx = 0, cz = 0, ct = 0;
  const sub = 20;
  for (let i = 0; i < N; i++) {
    x[i] = cx; z[i] = cz; th[i] = ct; k[i] = curv(i * ds);
    for (let j = 0; j < sub; j++) {
      const s = i * ds + (j + 0.5) * ds / sub;
      const tm = ct - curv(s) * ds / sub / 2;
      cx += Math.cos(tm) * ds / sub;
      cz += Math.sin(tm) * ds / sub;
      ct -= curv(s) * ds / sub;
    }
  }
  // distribute closure error
  const ex = cx, ez = cz;
  let mx = 0, mz = 0;
  for (let i = 0; i < N; i++) { x[i] -= ex * i / N; z[i] -= ez * i / N; mx += x[i]; mz += z[i]; }
  mx /= N; mz /= N;
  for (let i = 0; i < N; i++) { x[i] -= mx; z[i] -= mz; }

  const tx = new Float64Array(N), tz = new Float64Array(N), nx = new Float64Array(N), nz = new Float64Array(N);
  const bank = new Float64Array(N);
  for (let i = 0; i < N; i++) {
    const a = (i + 1) % N, b = (i - 1 + N) % N;
    let dx = x[a] - x[b], dz = z[a] - z[b];
    const l = Math.hypot(dx, dz); dx /= l; dz /= l;
    tx[i] = dx; tz[i] = dz;
    nx[i] = -dz; nz[i] = dx; // outward (right of travel)
    bank[i] = def.bankStraight + (def.bankTurn - def.bankStraight) * (k[i] / kMax);
  }

  const W = def.width;
  const track = {
    def, L, N, ds, W, kMax, x, z, tx, tz, nx, nz, k, bank, turnZones,
    innerEdge: def.inner.edge, // how far inside the inner edge the berm / inside wall stops a car
    wrap(s) { s %= L; return s < 0 ? s + L : s; },
    // interpolated sample at arc length s
    sample(s, out = {}) {
      s = track.wrap(s);
      const f = s / ds, i = Math.floor(f) % N, j = (i + 1) % N, t = f - Math.floor(f);
      out.x = x[i] + (x[j] - x[i]) * t;
      out.z = z[i] + (z[j] - z[i]) * t;
      let ttx = tx[i] + (tx[j] - tx[i]) * t, ttz = tz[i] + (tz[j] - tz[i]) * t;
      const l = Math.hypot(ttx, ttz); ttx /= l; ttz /= l;
      out.tx = ttx; out.tz = ttz; out.nx = -ttz; out.nz = ttx;
      out.k = k[i] + (k[j] - k[i]) * t;
      out.bank = bank[i] + (bank[j] - bank[i]) * t;
      return out;
    },
    // world position of (s, d)
    pos(s, d, out = {}) {
      const p = track.sample(s, out);
      p.x += p.nx * d; p.z += p.nz * d;
      return p;
    },
    // surface height at lateral offset d (outward positive) on banked section
    height(s, d, surface) {
      const b = track.sample(s, _h).bank;
      const e = d + W / 2;
      let y;
      if (e <= 0) y = infieldY(-e, def.inner);
      else if (e <= W) y = e * Math.tan(b);
      else y = track.outsideY(s, e - W);
      if (surface && e > 0 && e < W) y += surface.ridge(e / W);
      return y;
    },
    // What's beyond the outside edge, by section of track (Lincoln Park):
    //  front stretch: wall right at the edge, grass bank + grandstands behind it
    //  turns 1-2:     no wall, the track drops off down a hill
    //  backstretch:   wall set well back with a short drop down to it
    //  turns 3-4:     no wall, flatter runoff where cars come on from the pits
    zones(s, out = _z) {
      if (def.layout === 'walled') { out.front = 1; out.drop = out.back = out.flat = 0; out.kind = 'front'; return out; }
      s = track.wrap(s);
      const f = (a, b, x) => clamp((x - a) / (b - a), 0, 1);
      // front <-> drop around turn 1 entry, drop <-> back at turn 2 exit,
      // back <-> flat at turn 3 entry, flat <-> front at turn 4 exit
      const t1 = f(48, 62, s), t2 = f(198, 212, s), t3 = f(292, 306, s), t4 = f(438, 452, s);
      out.front = (1 - t1) + t4;
      out.drop = t1 * (1 - t2);
      out.back = t2 * (1 - t3);
      out.flat = t3 * (1 - t4);
      out.kind = out.front >= 0.5 ? 'front' : out.drop >= 0.5 ? 'drop' : out.back >= 0.5 ? 'back' : 'flat';
      return out;
    },
    // distance past the outer edge where a wall is (Infinity = none)
    wallE(s) {
      const k = track.zones(s).kind;
      return k === 'front' ? 0.3 : k === 'back' ? 9 : k === 'flat' ? 26 : Infinity;
    },
    // terrain height e meters past the outer edge
    outsideY(s, e) {
      const z = track.zones(s, _z2);
      const h0 = W * Math.tan(track.sample(s, _h).bank);
      let y = 0;
      if (z.front) y += z.front * (h0 + (e < 0.6 ? 0 : 0.4 + Math.min(e - 0.6, 12) * 0.2));
      if (z.drop) y += z.drop * Math.max(-2.5, h0 - 0.05 * Math.min(e, 1.5) - Math.max(0, e - 1.5) * 0.62);
      if (z.back) y += z.back * (e < 9 ? h0 - 0.2 * e : h0 - 1.8);
      if (z.flat) y += z.flat * Math.max(h0 - 1.6, h0 - 0.06 * e);
      // everything settles to the surrounding ground far out
      const far = clamp((e - 30) / 40, 0, 1);
      return y + (-2.5 - y) * far * (z.front > 0.5 ? 0.3 : 1);
    },
    // project world point to (s, d); hint = last index for local search
    project(px, pz, hint = -1, out = {}) {
      let best = 0, bd = Infinity;
      if (hint < 0) {
        for (let i = 0; i < N; i++) {
          const dd = (px - x[i]) ** 2 + (pz - z[i]) ** 2;
          if (dd < bd) { bd = dd; best = i; }
        }
      } else {
        for (let o = -40; o <= 40; o++) {
          const i = (hint + o + N) % N;
          const dd = (px - x[i]) ** 2 + (pz - z[i]) ** 2;
          if (dd < bd) { bd = dd; best = i; }
        }
      }
      // refine along tangent
      const along = (px - x[best]) * tx[best] + (pz - z[best]) * tz[best];
      const s = track.wrap(best * ds + along);
      const sm = track.sample(s, _p);
      out.i = best;
      out.s = s;
      out.d = (px - sm.x) * sm.nx + (pz - sm.z) * sm.nz;
      return out;
    },
    turnAt(s) {
      s = track.wrap(s);
      // turns: 1-2 = first turn complex, 3-4 = second
      const z0 = turnZones;
      const t1 = z0[1].s0, t2mid = (z0[2].s0 + z0[2].s1) / 2, t2end = z0[3].s1;
      const t3 = z0[5].s0, t4mid = (z0[6].s0 + z0[6].s1) / 2, t4end = z0[7].s1;
      if (s >= t1 && s < t2mid) return 1;
      if (s >= t2mid && s < t2end) return 2;
      if (s >= t3 && s < t4mid) return 3;
      if (s >= t4mid && s < t4end) return 4;
      return 0;
    },
  };
  const _h = {}, _p = {}, _z = {}, _z2 = {};
  return track;
}

const GRIP_SCALE = 1.36;
// inside the track: apron, then a low clay berm ringing the infield, then grass
// (or, on a walled track, the apron runs to a concrete inside wall)
export const APRON = 1.6, BERM_IN = 2.0, BERM_OUT = 3.2;
function infieldY(x, inner) {
  if (inner && inner.wall) return -Math.min(x, inner.apron) * 0.05;
  if (x < APRON) return -x * 0.05;
  if (x < BERM_OUT) { const t = (x - APRON) / (BERM_OUT - APRON); return -APRON * 0.05 + Math.sin(t * Math.PI) * 0.45; }
  return -0.12;
}
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const smooth = (a, b, v) => { const t = clamp((v - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };

// Track preparations. "heavy" models the track after heavy rain: tacky and
// fast early, then a tall, choppy cushion that can bite.
export const PREPS = {
  dialed: { label: 'Dialed In', desc: 'Fast and racy. Good bottom, cushion comes in up top.', g0: 1.32, w0: 0.0, wearRate: 1 / 36, c0: 0.25, cushRate: 1 / 22, lumpy: 0.15, cushBonus: 0.06, berm: 2.4 },
  heavy:  { label: 'After Heavy Rain', desc: 'Tacky early. The cushion builds fast and gets treacherous.', g0: 1.37, w0: 0.0, wearRate: 1 / 48, c0: 0.5, cushRate: 1 / 12, lumpy: 1.0, cushBonus: 0.12, berm: 3.4 },
  slick:  { label: 'Dry Slick', desc: 'Black and slick. Throttle control wins.', g0: 1.16, w0: 0.55, wearRate: 1 / 70, c0: 0.2, cushRate: 1 / 40, lumpy: 0.1, cushBonus: 0.05, berm: 2.0 },
};

export class Surface {
  constructor(track, prepId = 'dialed') {
    this.track = track;
    this.setPrep(prepId);
  }
  setPrep(prepId) {
    this.prepId = PREPS[prepId] ? prepId : 'dialed';
    this.prep = PREPS[this.prepId];
    this.laps = 0;
    this.version = 0;
    this.update();
  }
  setLaps(n) {
    if (Math.abs(n - this.laps) < 0.05) return;
    this.laps = n;
    this.update();
  }
  update() {
    const p = this.prep;
    this.wear = clamp(p.w0 + this.laps * p.wearRate, 0, 1);
    this.cush = clamp(p.c0 + this.laps * p.cushRate, 0, 1);
    this.cPos = 0.935 - 0.085 * this.cush; // cushion center (0 = inside edge, 1 = wall)
    this.cW = 0.07;
    this.version++;
  }
  // grip coefficient at normalized lane dn (0 inside .. 1 wall).
  // Scaled so a hooked-up 410 can run near the 12.3s track record.
  grip(dn) { return this.rawGrip(dn) * GRIP_SCALE * (this.track.def.grip || 1); }
  rawGrip(dn) {
    const p = this.prep, w = this.wear, c = this.cush;
    const bottom = p.g0 - w * 0.15;
    const middle = p.g0 - w * 0.30;
    const upper = p.g0 - w * 0.21;
    const top = this.cPos - this.cW;
    let g;
    if (dn < 0.25) g = bottom;
    else if (dn < 0.45) g = bottom + (middle - bottom) * smooth(0.25, 0.45, dn);
    else if (dn < 0.6) g = middle;
    else g = middle + (upper - middle) * smooth(0.6, top, dn);
    // the cushion: lean on it and it's fast
    g += p.cushBonus * c * smooth(top, this.cPos - 0.01, dn);
    // over the cushion: marbles
    const marbles = p.g0 * 0.7 - 0.18 * c;
    g += (marbles - g) * smooth(this.cPos + 0.015, this.cPos + 0.05, dn);
    return g;
  }
  // inward acceleration (m/s^2) from leaning on the cushion
  berm(dn) {
    const c = this.cush;
    const on = smooth(this.cPos - this.cW, this.cPos, dn);
    const over = 1 - smooth(this.cPos + 0.03, this.cPos + 0.07, dn);
    return this.prep.berm * c * on * over;
  }
  // height of the cushion ridge (meters)
  ridge(dn) {
    const c = this.cush;
    const r = (dn - this.cPos) / 0.035;
    return c * 0.22 * Math.exp(-r * r) + c * 0.06 * smooth(this.cPos, this.cPos + 0.06, dn);
  }
  // choppiness along the track (-1..1)
  lumps(s) {
    return Math.sin(s * 0.41) * 0.5 + Math.sin(s * 1.13 + 1.7) * 0.3 + Math.sin(s * 2.9 + 0.3) * 0.2;
  }
  // Cosmetic color info for the track texture: 0 = tacky/dark, 1 = dry/slick
  dryness(dn) {
    const w = this.wear;
    const groove = Math.exp(-(((dn - 0.2) / 0.12) ** 2)) * 0.8 + Math.exp(-(((dn - 0.55) / 0.15) ** 2));
    return clamp(w * (0.35 + 0.65 * groove) * 1.2, 0, 1);
  }
}
