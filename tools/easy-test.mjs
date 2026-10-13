// Easy-handling checks: node tools/easy-test.mjs
import { buildTrack, Surface } from '../js/track.js';
import { Car, autopilot } from '../js/physics.js';
import { SpeedProfile } from '../js/ai.js';
const track = buildTrack();
const deg = (r) => (r * 57.3).toFixed(0);

// 1) enter turn 1 at speed, hold a fixed throttle, no steering: gas alone should turn the car left
for (const prep of ['dialed', 'slick']) {
  for (const thr of [0.2, 0.5, 0.8, 1.0]) {
    const surf = new Surface(track, prep), car = new Car(track, surf);
    car.handling = 'easy';
    car.reset(track.turnZones[1].s0 - 5, -2, 30);
    let maxB = 0, sumB = 0, n = 0;
    for (let i = 0; i < 120 * 3; i++) {
      car.step(1 / 120, { steer: i < 70 ? -0.5 : 0, throttle: thr, brake: 0 }); // turn in, then drive it on the gas
      maxB = Math.max(maxB, car.beta); sumB += car.beta; n++;
      if (car.flipped) break;
    }
    console.log(`${prep} throttle ${thr}: after 3s d=${car.d.toFixed(1)} speed=${car.speed.toFixed(1)} slide avg ${deg(sumB / n)}° max ${deg(maxB)}° ${car.flipped ? 'OVER THE BANK' : ''}`);
  }
}

// 1b) straightaway, wheel centered, any throttle: the car should go straight
for (const thr of [0.5, 1.0]) {
  const surf = new Surface(track, 'slick'), car = new Car(track, surf);
  car.handling = 'easy';
  car.reset(track.turnZones[4].s0 + 2, 0, 25);   // start of the backstretch
  for (let i = 0; i < 120 * 1.6; i++) car.step(1 / 120, { steer: 0, throttle: thr, brake: 0 });
  console.log(`straightaway, wheel centered, throttle ${thr}: drifted ${car.d.toFixed(2)} m sideways over ${(car.s - track.turnZones[4].s0 - 2).toFixed(0)} m`);
}

// 2) "human-ish" driver: steer to hold a lane, throttle to hit a target speed
function drive(prep, dn, factor, laps = 4) {
  const surf = new Surface(track, prep), car = new Car(track, surf);
  car.handling = 'easy';
  const pf = new SpeedProfile(track, surf); pf.update();
  const d = (dn - 0.5) * track.W;
  car.reset(0, d, 25);
  let tm = 0, last = 0, lapStart = 0, maxB = 0, walls = 0; const times = [];
  while (times.length < laps && tm < 120) {
    let vT = 99;
    for (let o = 4; o < 45; o += 3) { const vp = pf.speed(car.s + o, dn) * factor; vT = Math.min(vT, Math.sqrt(vp * vp + 2 * 9 * Math.max(0, o - 8))); }
    const inp = autopilot(car, track, d, vT);
    car.step(1 / 120, inp);
    for (const e of car.events) if (e.type === 'wall') walls++;
    car.events.length = 0;
    tm += 1 / 120; maxB = Math.max(maxB, Math.abs(car.beta));
    if (car.lap > last) { times.push(tm - lapStart); lapStart = tm; last = car.lap; }
    if (car.flipped) break;
  }
  return `${prep} lane ${dn} x${factor}: laps ${times.map((t) => t.toFixed(2)).join(' ')} maxSlide ${deg(maxB)}° walls ${walls}${car.flipped ? ' FLIPPED' : ''}`;
}
for (const prep of ['dialed', 'heavy', 'slick']) for (const dn of [0.2, 0.75]) for (const f of [1.0, 1.08]) console.log(drive(prep, dn, f));
