// Headless full-race check: node tools/race-test.mjs [track id, e.g. eldora]
import { buildTrack, Surface, TRACKS } from '../js/track.js';
import { autopilot } from '../js/physics.js';
import { Session } from '../js/session.js';
import { DRIVERS, PLAYER } from '../js/drivers.js';

const track = buildTrack(TRACKS[process.argv[2]] || undefined);
console.log(track.def.name);
for (const prep of ['dialed', 'heavy']) {
  const surface = new Surface(track, prep);
  const ses = new Session({ track, surface, mode: 'race', laps: 10, fieldSize: 22, difficulty: 'pro', startPos: 'middle', drivers: DRIVERS, player: PLAYER });
  let done = false; ses.onDone = () => (done = true);
  const log = [];
  const dt = 1 / 60; let steps = 0;
  while (!done && steps < 60 * 400) {
    const lane = -track.W * 0.235;
    const v = ses.phase === 'pace' ? 21 : ses.field.profile.speed(ses.car.s + 15, 0.25) * 0.9;
    ses.update(dt, autopilot(ses.car, track, lane, v));
    for (const m of ses.messages) if (m.t === 0 || (m.t < dt * 1.01)) log.push(`${ses.raceTime.toFixed(1)}s ${m.text}`);
    steps++;
  }
  const st = ses.standings();
  console.log(`\n== ${prep}: phase=${ses.phase} raceTime=${ses.raceTime.toFixed(1)}s player=${ses.playerStatus} P${ses.playerPosition()} best=${ses.bestLap.toFixed(3)}`);
  console.log([...new Set(log)].slice(0, 12).join('\n'));
  console.log(st.slice(0, 6).map((r, i) => `${i + 1}. #${r.number} ${r.name} best ${isFinite(r.best) ? r.best.toFixed(3) : '-'}`).join('\n'));
  const lanes = ses.field.cars.map((c) => ((c.d / track.W) + 0.5).toFixed(2));
  console.log('AI lanes at end:', lanes.join(' '), ' cushion at', surface.cPos.toFixed(2));
}
