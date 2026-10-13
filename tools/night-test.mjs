// Whole race night, headless: node tools/night-test.mjs [track id] [difficulty]
// Qualifying (2 timed laps) -> your heat (8 laps) -> the feature, with a
// simple autopilot driving the player car.
import { buildTrack, Surface, TRACKS } from '../js/track.js';
import { autopilot } from '../js/physics.js';
import { Session } from '../js/session.js';
import { RaceNight } from '../js/night.js';
import { DRIVERS, PLAYER } from '../js/drivers.js';

const track = buildTrack(TRACKS[process.argv[2]] || undefined);
const surface = new Surface(track, 'dialed');
const night = new RaceNight({ track, surface, drivers: DRIVERS, player: PLAYER, difficulty: process.argv[3] || 'pro', featureLaps: 10 });
const name = (e) => `#${e.driver.number} ${e.driver.name}`;

function drive(ev) {
  const ses = new Session({ track, surface, mode: ev.kind, laps: ev.laps, grid: ev.grid, qualLaps: ev.laps, surfaceLaps: ev.surfaceLaps, difficulty: night.difficulty, player: PLAYER, handling: 'easy' });
  let done = false; ses.onDone = () => (done = true);
  const dt = 1 / 60; let steps = 0;
  while (!done && steps < 60 * 600) {
    const lane = -track.W * 0.25;
    const pf = ses.field ? ses.field.profile : ses.profile;
    pf.update();
    const v = ses.phase === 'pace' ? 21 : pf.speed(ses.car.s + 15, 0.25) * 1.05;
    ses.update(dt, autopilot(ses.car, track, lane, v));
    steps++;
  }
  return ses;
}

// qualifying
let ev = night.next();
let ses = drive(ev);
console.log(`${ev.title}: your best ${ses.bestLap.toFixed(3)} (${ses.playerLaps.length} timed laps), surface laps ${surface.laps}`);
night.recordQualifying(ses.bestLap);
console.log('Top 5 qualifiers: ' + night.qual.slice(0, 5).map((q) => `${name(q.entry)} ${q.time.toFixed(3)}`).join(', '));
console.log(`You qualified P${night.qualRank(night.entries[0]) + 1}. ${night.heats.length} heats: ` + night.heats.map((h, i) => `H${i + 1} ${h.lineup.length} cars`).join(', '));

// your heat
ev = night.next();
console.log(`${ev.title} lineup: ` + ev.grid.map(name).join(', '));
ses = drive(ev);
const st = ses.standings();
// map standings back to night entries
const byDriver = new Map(night.entries.map((e) => [e.driver, e]));
const order = st.map((r) => (r.isPlayer ? night.entries[0] : byDriver.get(r.ref.driver)));
console.log(`${ev.title} result: ` + order.map(name).join(', '));
night.recordPlayerHeat(order);
night.heats.forEach((h, i) => { if (i !== night.playerHeat) console.log(`Heat ${i + 1} (simulated): ` + h.result.slice(0, 4).map(name).join(', ') + ' ...'); });

// feature
ev = night.next();
console.log(`Feature grid (${ev.grid.length}): ` + ev.grid.slice(0, 8).map(name).join(', ') + ' ...  you start P' + (ev.grid.findIndex((e) => e.isPlayer) + 1));
ses = drive(ev);
const fst = ses.standings();
console.log(`${ev.title}: ${ses.phase} after ${ses.raceTime.toFixed(1)}s, you P${ses.playerPosition()}; winner ${fst[0].isPlayer ? 'YOU' : fst[0].name}; surface laps ${surface.laps}`);
night.recordFeature(fst);
console.log('night stage:', night.stage);
