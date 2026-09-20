# csr-demo

Browser demo of a solo commute time-trial: drive A→B on real roads, beat your own best per time-of-day bucket, never exceed the posted limit. Static site on GitHub Pages, played in iPhone Safari.

## Hard rules
- **The repo is public.** Never commit real GPS traces, marker coordinates, or anything from `notes/` or `traces/` (both gitignored). Test fixtures are synthetic.
- **No framework, no build step, no runtime dependencies.** The folder is the site. Plain ES modules.
- `src/` is pure logic with no DOM or browser APIs, so it runs under Node tests. Browser code lives in `ui/` and `app.js`.
- Every threshold lives in `src/tunables.js` and is editable in the Tuning screen. No magic numbers elsewhere.
- **No synthesized voice.** Cues are plain tones only (owner's call after hearing the voice). Anything the driver must know beyond a tone goes on the summary screen.
- A false disqualification is the worst bug; false leniency is harmless. Ambiguity resolves to the higher limit.

## Commands
- `npm test` — engine tests (Node built-in runner)
- `npm run serve` — static server on http://localhost:5173 (localhost counts as a secure context, so geolocation works)
- Deploy: `git push` to `main`; GitHub Pages serves the repo root at https://kurrikoffj.github.io/csr-demo/

## Layout
- `src/tunables.js` defaults · `geo.js` distance/bearing/circle crossing · `buckets.js` time-of-day buckets
- `src/runEngine.js` idle → armed → running → finished/aborted · `compliance.js` warning/DQ clock
- `src/osm.js` Overpass parsing, maxspeed tiers, grid index · `matcher.js` fix → road
- `src/records.js` personal bests, standing vs. own history · `replay.js` drive a trace through the pipeline
- `ui/` setup (map), drive (HUD + audio), summary, history, tuning · `sw.js` network-first service worker

## Fix format
`{ t: ms epoch, lat, lon, speed: m/s|null, heading: deg|null, accuracy: m }` — same shape from live GPS, replay and tests.

## Guidance arrow
"Up" for the arrow comes from `Session.guideHeading`: a vehicle-speed GPS course (≥ `headingMinSpeedMs`, held `courseHoldS` through stops), else the phone compass (`ui/compass.js`, asked for inside the Arm tap), else north-up. The arrow follows fixes as rough as `guideMaxAccuracyM`; starting or stopping the clock still needs `maxAccuracyM`.

## Browser constraints (iOS Safari)
GPS only while the page is visible and the screen is on; audio must be unlocked by a tap (Arm); Wake Lock in Home Screen mode needs iOS 18.4+.

## Status (2026-09-20, after playtest 1)
Live at the Pages URL. Owner has driven it on an iPhone. Added from his notes: guidance arrow (to the start circle once armed, metre countdown over the last 200 m to the finish line), yellow tier (a little over the limit for a sustained time; warns only unless `yellowDqRate` > 0), multiple routes with a route + direction picker on Drive. Still unverified on the phone: cue audibility over music / ringer off, wake lock holding for a whole drive. Next: tune from exported traces; limit-drop heads-up, live splits vs. best, per-road limit overrides.

## Data model
Routes: `[{ id, rev, a, b }]`, marker `{ name, lat, lon, activationM, finalizationM }`. Road data is stored per route (`roads:<id>`). Runs carry `routeId`, `routeRev`, `direction`, `bucket`; a best is the fastest clean run for that key inside the record window. Traces are packed rows with a zone column (0 ok, 1 red, 2 yellow).
