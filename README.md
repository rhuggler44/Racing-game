# USAC Racing: Lincoln Park Speedway

A 410 non-wing sprint car racing game for your phone's browser, starting with
**Lincoln Park Speedway**, the 5/16-mile clay oval in Putnamville, Indiana.

## Play on your iPhone

1. Open the game link in **Safari**.
2. Tap **Share → Add to Home Screen**. It now launches full-screen like an app.
3. Turn the phone sideways. The first time, tap **I'm ready** and allow motion access so tilt steering works.

### Handling
- **Easy (default):** you drive it with the gas. Turn in, then get on the throttle: the stagger and wheelspin kick the rear out and the car slides left around the corner. Steer right to catch or hold the slide, and lift to straighten it up. Too much speed or gas and you push up the track toward the cushion, or over the bank in 1-2.
- **Realistic:** the full tire-physics model (Settings → Handling).
- **Going off the track:** in the infield grass or the runoff, the car stops sliding and goes where you point it, so you can steer it back on. The hill in turns 1-2 still pulls you over if you don't catch it quickly. Stuck off the track for a few seconds? Tap **Back to track**.

### Controls
- **Steer:** tilt the phone like a steering wheel. Re-center from the pause menu if it drifts.
- **Gas (right thumb) and brake (left thumb) are sliders:** thumb at the bottom of the bar = 0%, top = 100%, and the bar fills to show how much you're giving it. Slide up and down to feather, lift off to let go. Settings → Pedals → Buttons switches to full on/off.
- **Throttle assist** (part of Driving aids): eases the gas a little when you're spinning the tires so much you'd push up the track, or getting too sideways.
- Hold the brake while stopped to back up.
- **Contact:** cars have real weight. Rubbing and bump-drafting just knock both cars around, but a hard shot to someone's back bumper (or a hard side hit) spins them, or you. Lapped cars are solid too, so you have to get around them. The AI cars hold their line and only give you a little room.
- **Walls:** brush the wall and you bounce off and keep going; a big hit costs a lot of speed (and a hard enough one on the concrete flips you).
- **CAM:** switch between the chase cam and the in-cockpit view.
- **Sound plays** (Settings): *Always* plays the game sound even with the iPhone's silent switch on, but pauses your music. *With my music* mixes with Spotify / Apple Music, but the silent switch mutes the game. Sound **Off** never touches your music.
- Desktop testing: arrow keys / WASD, `C` switches camera, `P` pauses, `R` resets the car.

## Tracks
Pick the track on the main menu.
- **Lincoln Park Speedway** (Putnamville, IN): 5/16-mile clay oval, open turns, wall on the front stretch only (details below).
- **Eldora Speedway** (Rossburg, OH): the high-banked 1/2-mile, laid out from an in-car video. A concrete wall and catch fence all the way around, billboards along the fence in the turns, a backstretch with a gentle bend and a row of big billboards, an inside wall with yellow pads and its own fence, a concrete infield packed with haulers around the infield building, gray-brown clay, the big front-stretch grandstand, grandstands and the tower in turn 3, and hillside seating through turn 4. Banking and dimensions are approximate.

Best hot laps are saved separately for each track.

## What's in v1
- **Hot laps** with a saved best lap. The track record is 12.276 s (Brady Bacon, 2018).
- **Race Night**: a full USAC-style show. Qualify with 2 timed laps, then race your 8-lap heat (the field is dealt into heats by qualifying time, fastest few inverted), then the A-Main, lined up by heat finish with the top 6 inverted. The other heats are run in the background, and the track keeps wearing in through the night.
- **Feature race** against up to 21 AI cars (Rookie, Pro or Outlaw; Outlaw runs right with a near-perfect lap). Each race draws a fresh lineup and every car's pace is rolled fresh, so it's a different driver up front each night. Lapped cars are scored a lap down, in real running order., 10/15/25 laps, with a rolling two-wide start and green/white/checkered flags. Once you take the checkers your finish is locked in (even if you crash after), the computer drives your cool-down lap, and the race wraps up once everyone has taken the flag (15 seconds at most).
- **Track that changes through the night:** it starts tacky, the middle slicks off, and a cushion builds up top.
  - *Dialed In:* a solid bottom and a fast top, so both lines race well.
  - *After Heavy Rain:* tacky and fast early, but the cushion gets tall and choppy and can hook you.
  - *Dry Slick:* throttle control wins.
- **Lincoln Park layout, modeled on photos of the track:** a wall on the front stretch only, no wall in turns 1-2 (jump the cushion and you go over the bank), a backstretch wall set back off the track, flat runoff out to the pits in turns 3-4, and a clay berm ringing the infield. Night or day.
- **Driver select** (main menu): drive any of the real cars. When you're not in the #44, Ryan Huggler's #44 races against you.
- Your **#44 RACO Marketing** car. The iRacing paint file (`assets/paint/raco-44-iracing-scheme.jpg`) is mapped panel by panel onto the car (see `PAINT_REGIONS` in `js/render/carModel.js`), with a gold chassis and cage, painted left-side mud covers and the HUGGLER name plate.
- Real Indiana drivers' cars (painted from photos) plus a few placeholder drivers, in `js/drivers.js`. Liveries are in `CUSTOM_LIVERIES` in `js/render/carModel.js`.

## Project layout
| Path | What it does |
|---|---|
| `js/track.js` | Track definitions (Lincoln Park, Eldora), shape and banking, and the dirt surface model (grip, cushion, marbles) |
| `js/physics.js` | Player car physics: throttle steer, banking, cushion, walls, flips |
| `js/ai.js` | AI field: speed profiles per lane, groove choice, passing |
| `js/session.js` | Hot laps, qualifying and race flow: pace lap, flags, positions, contact |
| `js/night.js` | Race Night: qualifying, heats, A-Main lineup |
| `js/render/` | three.js track scene, car model/livery, dust and roost |
| `js/input.js`, `js/audio.js` | Tilt/touch controls, synthesized 410 engine sound |
| `tools/*.mjs` | Headless tuning tests (`node tools/sim-test.mjs`, `node tools/race-test.mjs [eldora]`, `node tools/night-test.mjs [eldora]`, `node tools/contact-test.mjs`, `node tools/rejoin-test.mjs` for getting back on the track) |

## Hosting with GitHub Pages
In the repo, go to **Settings → Pages**. Under *Build and deployment*, set *Source* to **Deploy from a branch**,
then pick the branch and the `/ (root)` folder. The game will be at
`https://<your-username>.github.io/<repo-name>/`. It's static files only, so any web host (including a VPS) works too.
