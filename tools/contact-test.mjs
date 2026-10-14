// Car contact: node tools/contact-test.mjs
// Puts your car right behind / beside an AI car with a speed difference and
// reports what happened: speeds after, and who (if anyone) spun.
import { buildTrack, Surface } from '../js/track.js';
import { Session } from '../js/session.js';
import { DRIVERS, PLAYER } from '../js/drivers.js';
const track = buildTrack(), L = track.L;

function run(label, { dS, dd, you, them, lapped = false, steer = 0 }) {
  const ses = new Session({ track, surface: new Surface(track, 'dialed'), mode: 'race', laps: 30, fieldSize: 2, difficulty: 'pro', startPos: 'front', drivers: DRIVERS, player: PLAYER, handling: 'easy' });
  ses.phase = 'green'; ses.flag = 'green'; ses.car.speedLimit = Infinity; ses.raceTime = 10;
  const c = ses.field.cars[0];
  const s0 = L * 2 + 20; // front stretch, lap 2
  ses.car.reset(s0 % L, -2, you); ses.car.S = s0; ses.car.lap = Math.floor(s0 / L);
  c.S = s0 + dS + (lapped ? -L : 0); c.d = -2 + dd; c.dTarget = c.d; c.v = them; c.lapsDone = Math.floor((c.S - L) / L); c.laneTimer = 9;
  ses.field.profile.update(); c.skill = them / 45; // keeps roughly its speed on the straight
  let minGap = 99, contact = 0;
  const v0 = [you, them];
  let hardest = 0;
  ses.onContact = (st) => { contact++; hardest = Math.max(hardest, st); };
  const said = [];
  let kMe = 0, kThem = 0;
  for (let i = 0; i < 60 * 3; i++) {
    ses.update(1 / 60, { steer, throttle: 0.6, brake: 0 });
    kMe = Math.max(kMe, Math.abs(ses.car._kyaw || 0)); kThem = Math.max(kThem, Math.abs(c.kyaw || 0));
    for (const m of ses.messages) if (m.t < 1 / 59) said.push(m.text);
  }
  const spun = said.filter((t) => /spin|turned/.test(t));
  console.log(`${label.padEnd(44)} hit ${hardest.toFixed(1)} m/s · you ${v0[0]}→${ses.car.speed.toFixed(1)} · them ${v0[1]}→${c.v.toFixed(1)} · knocked you ${(kMe * 57.3).toFixed(0)}° them ${(kThem * 57.3).toFixed(0)}° · ${spun.length ? spun.join(', ') : 'no spin'}`);
}
run('light rub: 1 m/s faster, offset 0.6 m', { dS: 3.7, dd: 0.6, you: 30, them: 29 });
run('bump-draft: 4 m/s faster, dead center', { dS: 3.7, dd: 0, you: 33, them: 29 });
run('hard rear hit: 9 m/s faster, offset 0.8 m', { dS: 3.7, dd: 0.8, you: 36, them: 27 });
run('lapped car: 8 m/s faster, offset 0.7 m', { dS: 3.7, dd: 0.7, you: 36, them: 28, lapped: true });
run('your nose into their right rear, 6 m/s', { dS: 3.7, dd: -1.3, you: 34, them: 28 });
run('your nose into their right rear, 10 m/s', { dS: 3.7, dd: -1.3, you: 38, them: 28 });
run('they hit your right rear, 8 m/s', { dS: -3.7, dd: 1.3, you: 28, them: 36 });
run('...and you countersteer (right) to catch it', { dS: -3.7, dd: 1.3, you: 28, them: 36, steer: 0.7 });
run('...and you steer the wrong way (left)', { dS: -3.7, dd: 1.3, you: 28, them: 36, steer: -0.7 });
run('side by side, you shove right hard', { dS: 0.2, dd: 1.95, you: 30, them: 30, steer: 1 });
