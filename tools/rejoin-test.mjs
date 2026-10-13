// Off-track recovery: node tools/rejoin-test.mjs
// Drops the car off the track (infield, backstretch runoff, turns 3-4 runoff),
// pointed different ways, and drives it back like a player would: steer toward
// the racing surface, moderate gas. Reports how long it takes to be back on the
// track and pointed the right way.
import { buildTrack, Surface } from '../js/track.js';
import { Car } from '../js/physics.js';
const track = buildTrack();
const W = track.W;
const handling = process.argv[2] || 'easy';

// lag = how late the "player" reacts (tilt steering on a phone isn't instant)
const lag = Number(process.argv[3] || 0.3);
function rejoin(label, s, d, headOff, speed, thrLevel) {
  const buf = [];
  const surf = new Surface(track, 'dialed'), car = new Car(track, surf);
  car.handling = handling;
  car.reset(s, d, 0);
  car.th += headOff;
  car.u = speed;
  let tm = 0, ok = 0;
  while (tm < 15) {
    // aim at the middle of the track a bit ahead
    const tgt = track.pos(car.s + 14, 0, {});
    let err = Math.atan2(tgt.z - car.z, tgt.x - car.x) - car.th;
    while (err > Math.PI) err -= 2 * Math.PI;
    while (err < -Math.PI) err += 2 * Math.PI;
    const steer = Math.max(-1, Math.min(1, err * 2.2));
    // pointed backwards: back up while turning
    const back = Math.abs(err) > 2.2 && car.u < 2;
    buf.push(back ? { steer: -steer, throttle: 0, brake: 1 } : { steer, throttle: thrLevel, brake: 0 });
    const inp = buf.length > lag * 120 ? buf.shift() : { steer: 0, throttle: thrLevel, brake: 0 };
    car.step(1 / 120, inp);
    car.events.length = 0;
    tm += 1 / 120;
    const sm = track.sample(car.s, {});
    let hd = car.th - Math.atan2(sm.tz, sm.tx);
    while (hd > Math.PI) hd -= 2 * Math.PI;
    while (hd < -Math.PI) hd += 2 * Math.PI;
    const on = Math.abs(car.d) < W / 2 - 0.5 && Math.abs(hd) < 0.35 && car.u > 4;
    ok = on ? ok + 1 / 120 : 0;
    if (ok > 0.5 || car.flipped) break;
  }
  return `${label.padEnd(34)} ${car.flipped ? 'FLIPPED' : ok > 0.5 ? `back on in ${(tm - 0.5).toFixed(1)}s` : 'STUCK (15s)'}  d=${car.d.toFixed(1)}`;
}

const tz = track.turnZones;
const spots = [
  ['infield, front stretch', 20, -W / 2 - 2.2],
  ['infield, turn 2', (tz[1].s0 + tz[2].s1) / 2 + 30, -W / 2 - 2.2],
  ['backstretch runoff', 255, W / 2 + 5],
  ['turn 3-4 runoff', 370, W / 2 + 8],
  ['turn 3-4 runoff, far', 380, W / 2 + 18],
];
for (const [name, s, d] of spots) {
  for (const [hn, h] of [['along', 0], ['45 away', d > 0 ? -0.8 : 0.8], ['90 away', d > 0 ? -1.57 : 1.57], ['backwards', 3.1]]) {
    for (const thr of [0.4, 1.0]) console.log(rejoin(`${name} / ${hn} / gas ${thr}`, s, d, h, 3, thr));
  }
}
