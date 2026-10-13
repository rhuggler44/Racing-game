// A full race night: qualifying -> heat races -> feature, like a USAC show.
// Pure logic (no rendering) so it can be tested in node.
//
//  - Qualifying: you run 2 timed laps by yourself; everybody else gets a time
//    from their skill (plus a little luck).
//  - Heats: the field is dealt into heats by qualifying time (fastest to heat 1,
//    2nd fastest to heat 2, ...). Each heat lines up by time with the fastest
//    few inverted, so the fast cars have to come through. You drive your heat;
//    the others are run in the background.
//  - Feature: lines up by heat finish (all the heat winners first, fastest
//    qualifier ahead, then all the 2nd places, ...), with the top 6 inverted.
//  - The track keeps changing through the night: tacky for qualifying, it slicks
//    off through the heats, and the feature starts on a worked-in surface.
import { DIFFICULTY, SpeedProfile } from './ai.js';

export const NIGHT = {
  heatLaps: 8,
  heatInvert: 4,      // fastest N qualifiers in each heat start behind the rest
  featureInvert: 6,
  surface: { qualifying: 0, heats: 5, feature: 10 }, // laps of wear when each part of the night starts
};

const gauss = (r) => { let s = 0; for (let i = 0; i < 6; i++) s += r(); return (s - 3) / Math.sqrt(0.5); };

export class RaceNight {
  constructor({ track, surface, drivers, player, difficulty = 'pro', featureLaps = 25, fieldSize = 22, rng = Math.random }) {
    this.track = track; this.surface = surface; this.player = player;
    this.difficulty = difficulty; this.featureLaps = featureLaps;
    this.rng = rng;
    const D = DIFFICULTY[difficulty] || DIFFICULTY.pro;
    // the AI cars keep the same skill all night
    this.cars = drivers.slice(0, Math.max(1, fieldSize - 1)).map((drv) => ({
      driver: drv,
      skill: (D.pace + (rng() - 0.5) * 2 * D.spread + (drv.rating || 0) * 0.01) * (track.def.aiPace || 1),
    }));
    this.entries = [{ driver: player, isPlayer: true }, ...this.cars];
    this.stage = 'qualifying'; // qualifying -> heat -> feature -> done
    this.qual = null;    // [{ entry, time }] fastest first
    this.heats = null;   // [{ lineup: [entry], result: [entry] | null }]
    this.playerHeat = -1;
    this.featureGrid = null;
    this.featureResult = null;
  }

  surfaceLaps(stage = this.stage) { return NIGHT.surface[stage === 'heat' ? 'heats' : stage] ?? NIGHT.surface.feature; }

  // ---- qualifying ----
  // a car's qualifying lap: its speed-profile lap at the best lane, scaled by skill
  _aiQualTime(car) {
    const pf = this._profile || (this._profile = new SpeedProfile(this.track, this.surface));
    pf.update();
    let best = Infinity;
    for (let i = 0; i < pf.lapTime.length; i++) best = Math.min(best, pf.lapTime[i]);
    // qualifying is alone on a fresh track: a bit quicker than a race lap
    return (best / car.skill) * (1 + 0.004 * gauss(this.rng)) * 0.99;
  }

  recordQualifying(playerTime) {
    this.surface.setLaps(this.surfaceLaps('qualifying'));
    const rows = this.cars.map((c) => ({ entry: c, time: this._aiQualTime(c) }));
    rows.push({ entry: this.entries[0], time: isFinite(playerTime) ? playerTime : Infinity });
    rows.sort((a, b) => a.time - b.time);
    this.qual = rows;
    this._makeHeats();
    this.stage = 'heat';
  }

  _makeHeats() {
    const n = this.qual.length;
    const nh = n <= 10 ? 1 : n <= 18 ? 2 : 3;
    const heats = Array.from({ length: nh }, () => []);
    this.qual.forEach((q, i) => heats[i % nh].push(q.entry)); // dealt out fastest-first
    this.heats = heats.map((h) => ({ lineup: invertTop(h, Math.min(NIGHT.heatInvert, h.length)), result: null }));
    this.playerHeat = this.heats.findIndex((h) => h.lineup.some((e) => e.isPlayer));
  }

  qualRank(entry) { return this.qual.findIndex((q) => q.entry === entry); }

  // heats the player isn't in are simulated from skill, starting spot and luck
  _simulate(lineup, laps) {
    const field = lineup.map((e, i) => {
      const skill = e.isPlayer ? 1 : e.skill;
      // each spot back costs a little; the longer the race, the less it matters
      const perf = skill * (1 + 0.012 * gauss(this.rng)) - i * 0.006 * (8 / laps);
      return { e, perf };
    });
    field.sort((a, b) => b.perf - a.perf);
    return field.map((f) => f.e);
  }

  // finishing order of the player's heat (entries), from the real race
  recordPlayerHeat(order) {
    this.heats.forEach((h, i) => { h.result = i === this.playerHeat ? order : this._simulate(h.lineup, NIGHT.heatLaps); });
    this._makeFeature();
    this.stage = 'feature';
  }

  _makeFeature() {
    const byPos = [];
    const maxLen = Math.max(...this.heats.map((h) => h.result.length));
    for (let p = 0; p < maxLen; p++) {
      const row = this.heats.map((h) => h.result[p]).filter(Boolean);
      row.sort((a, b) => this.qualRank(a) - this.qualRank(b)); // same finish: faster qualifier first
      byPos.push(...row);
    }
    this.featureGrid = invertTop(byPos, Math.min(NIGHT.featureInvert, byPos.length));
  }

  recordFeature(order) {
    this.featureResult = order;
    this.stage = 'done';
  }

  // what the player drives next, and how
  next() {
    if (this.stage === 'qualifying') return { kind: 'qual', title: 'Qualifying', laps: 2, surfaceLaps: this.surfaceLaps('qualifying') };
    if (this.stage === 'heat') {
      const lineup = this.heats[this.playerHeat].lineup;
      return { kind: 'race', title: `Heat ${this.playerHeat + 1}`, laps: NIGHT.heatLaps, grid: lineup, surfaceLaps: this.surfaceLaps('heat') };
    }
    if (this.stage === 'feature') return { kind: 'race', title: 'A-Main Feature', laps: this.featureLaps, grid: this.featureGrid, surfaceLaps: this.surfaceLaps('feature') };
    return null;
  }
}

// the first n start in reverse order (pole sitter of the top n starts nth)
function invertTop(list, n) {
  return [...list.slice(0, n).reverse(), ...list.slice(n)];
}
