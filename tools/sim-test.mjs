// Headless tuning check: node tools/sim-test.mjs
import { buildTrack, Surface, PREPS } from '../js/track.js';
import { Car, autopilot } from '../js/physics.js';
import { SpeedProfile } from '../js/ai.js';

const track = buildTrack();
console.log(`track L=${track.L.toFixed(1)} minR=${(1 / track.kMax).toFixed(1)}m`);
for (const prep of Object.keys(PREPS)) {
  const surf = new Surface(track, prep);
  for (const laps of [0, 12, 25]) {
    surf.setLaps(laps);
    const pf = new SpeedProfile(track, surf);
    pf.update();
    const times = Array.from(pf.lapTime).map((t) => t.toFixed(2)).join(' ');
    console.log(`${prep.padEnd(6)} lap${String(laps).padStart(2)} profile lap times by lane: ${times}`);
  }
}

// Player physics following a lane at profile speed * factor
function drive(prep, dn, factor, laps = 4, assists = true) {
  const surf = new Surface(track, prep);
  const pf = new SpeedProfile(track, surf); pf.update();
  const car = new Car(track, surf);
  car.assists = assists;
  const d = (dn - 0.5) * track.W;
  car.reset(0, d, 25);
  const dt = 1 / 120;
  let tm = 0, lastLap = 0, lapStart = 0; const times = []; let maxBeta = 0, walls = 0;
  while (times.length < laps && tm < 120) {
    let vT = 99;
    for (let o = 4; o < 45; o += 3) {
      const vp = pf.speed(car.s + o, dn) * factor;
      vT = Math.min(vT, Math.sqrt(vp * vp + 2 * 9 * Math.max(0, o - 8)));
    }
    const inp = autopilot(car, track, d, vT);
    car.step(dt, inp);
    for (const e of car.events) if (e.type === 'wall') walls++;
    car.events.length = 0;
    tm += dt;
    maxBeta = Math.max(maxBeta, Math.abs(car.beta));
    if (car.lap > lastLap) { times.push(tm - lapStart); lapStart = tm; lastLap = car.lap; }
    if (car.flipped) break;
  }
  return { times: times.map((t) => t.toFixed(2)), crashAt: car.flipped ? `${car.s.toFixed(0)}m dn${car.dn.toFixed(2)} ${car.surfaceKind}` : '', maxBeta: (maxBeta * 57.3).toFixed(0), walls, flipped: car.flipped, dEnd: car.d.toFixed(1) };
}

for (const prep of ['dialed', 'heavy', 'slick']) {
  for (const dn of [0.2, 0.5, 0.8]) {
    for (const f of [1.0, 1.04]) {
      console.log(prep, dn, f, JSON.stringify(drive(prep, dn, f)));
    }
  }
}

// full throttle in a corner with no assists should get loose
{
  const surf = new Surface(track, 'dialed');
  const car = new Car(track, surf); car.assists = false;
  car.reset(track.turnZones[2].s0, 0, 30);
  let maxB = 0;
  for (let i = 0; i < 240; i++) { car.step(1 / 120, { steer: -0.6, throttle: 1, brake: 0 }); maxB = Math.max(maxB, Math.abs(car.beta)); }
  console.log('full throttle mid-turn no assists: max slide deg', (maxB * 57.3).toFixed(0));
}
