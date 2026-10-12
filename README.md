# Indiana Sprints: Lincoln Park Speedway

A 410 non-wing sprint car racing game for your phone's browser, starting with
**Lincoln Park Speedway**, the 5/16-mile clay oval in Putnamville, Indiana.

## Play on your iPhone

1. Open the game link in **Safari**.
2. Tap **Share → Add to Home Screen**. It now launches full-screen like an app.
3. Turn the phone sideways. The first time, tap **I'm ready** and allow motion access so tilt steering works.

### Controls
- **Steer:** tilt the phone like a steering wheel. Re-center from the pause menu if it drifts.
- **Gas (right thumb):** the higher your thumb sits on the pedal, the more throttle. Feather it off the corners or you'll spin the rear tires and get sideways.
- **Brake (left thumb):** hold it while stopped to back up.
- **CAM:** switch between the chase cam and the in-cockpit view.
- Desktop testing: arrow keys / WASD, `C` switches camera, `P` pauses, `R` resets the car.

## What's in v1
- **Hot laps** with a saved best lap. The track record is 12.276 s (Brady Bacon, 2018).
- **Feature race** against up to 21 AI cars, 10/15/25 laps, with a rolling two-wide start and green/white/checkered flags.
- **Track that changes through the night:** it starts tacky, the middle slicks off, and a cushion builds up top.
  - *Dialed In:* a solid bottom and a fast top, so both lines race well.
  - *After Heavy Rain:* tacky and fast early, but the cushion gets tall and choppy and can hook you.
  - *Dry Slick:* throttle control wins.
- Your **#44 RACO Marketing** car, built from your iRacing paint file (`assets/paint/`).
- Placeholder drivers in `js/drivers.js`. Edit names, numbers and colors there.

## Project layout
| Path | What it does |
|---|---|
| `js/track.js` | Track shape (5/16 mi, banking) and the dirt surface model (grip, cushion, marbles) |
| `js/physics.js` | Player car physics: throttle steer, banking, cushion, walls, flips |
| `js/ai.js` | AI field: speed profiles per lane, groove choice, passing |
| `js/session.js` | Hot laps and race flow: pace lap, flags, positions, contact |
| `js/render/` | three.js track scene, car model/livery, dust and roost |
| `js/input.js`, `js/audio.js` | Tilt/touch controls, synthesized 410 engine sound |
| `tools/*.mjs` | Headless tuning tests (`node tools/sim-test.mjs`, `node tools/race-test.mjs`) |

## Hosting with GitHub Pages
In the repo, go to **Settings → Pages**. Under *Build and deployment*, set *Source* to **Deploy from a branch**,
then pick the branch and the `/ (root)` folder. The game will be at
`https://<your-username>.github.io/<repo-name>/`. It's static files only, so any web host (including a VPS) works too.
