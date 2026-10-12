// The computer should drive the pace lap / out lap no matter what the phone says.
// node tools/handover-test.mjs
import { buildTrack, Surface } from '../js/track.js';
import { Session } from '../js/session.js';
import { DRIVERS, PLAYER } from '../js/drivers.js';
const track = buildTrack();
const junk = { steer: 1, throttle: 1, brake: 0 }; // phone at a weird angle, thumb on the gas

for (const startPos of ['front', 'middle', 'back']) {
  const ses = new Session({ track, surface: new Surface(track, 'dialed'), mode: 'race', laps: 10, fieldSize: 22, startPos, drivers: DRIVERS, player: PLAYER });
  let t = 0;
  while (ses.phase === 'pace' && t < 60) { ses.update(1 / 60, junk); t += 1 / 60; }
  const slotS = ses.paceLeadS - ses.playerSlot.row * 8.5;
  console.log(`race start ${startPos}: green after ${t.toFixed(1)}s, gap to slot ${(ses.car.S - slotS).toFixed(1)}m, lane d=${ses.car.d.toFixed(1)} (slot ${ses.playerSlot.d}), speed ${ses.car.speed.toFixed(1)}, flipped=${ses.car.flipped}`);
}
{
  const ses = new Session({ track, surface: new Surface(track, 'dialed'), mode: 'hotlaps', player: PLAYER, drivers: [] });
  let t = 0, handed = false;
  ses.onHandover = () => (handed = true);
  while (!handed && t < 40) { ses.update(1 / 60, junk); t += 1 / 60; }
  console.log(`hot laps: handed over after ${t.toFixed(1)}s at ${ses.car.speed.toFixed(1)} m/s, d=${ses.car.d.toFixed(1)}, flipped=${ses.car.flipped}`);
}
