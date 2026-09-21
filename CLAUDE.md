# csr-demo

Browser demo of a solo commute time-trial: drive A→B on real roads, beat your own best per time-of-day bucket, never exceed the posted limit. Static site on GitHub Pages, played in iPhone Safari.

## Hard rules
- **The repo is public.** Never commit real GPS traces, marker coordinates, export files (`csr-demo-*.json`), or anything from `notes/`, `traces/` or `marketing/` (all gitignored). Test fixtures are synthetic. `test/repo.test.js` fails if a tracked file holds a pair of precise coordinates or sits in a private folder; it asks git, so a new file is checked before it is even added.
- **No framework, no build step, no runtime dependencies.** The folder is the site. Plain ES modules.
- `src/` is pure logic with no DOM or browser APIs, so it runs under Node tests. Browser code lives in `ui/` and `app.js`.
- Every threshold lives in `src/tunables.js` and is editable in the Tuning screen. No magic numbers elsewhere.
- **No synthesized voice.** Cues are plain tones only (owner's call after hearing the voice). Anything the driver must know beyond a tone goes on the summary screen.
- A false disqualification is the worst bug; false leniency is harmless. Ambiguity resolves to the higher limit.
- **km/h and metres inside, always.** Miles exist only in `src/units.js` and on screen. Anything converted rounds in the driver's favour.
- **Presentation mode changes only what is drawn**, never what is stored or judged. Every screen that shows a place name, a pin, a street name or a map must ask `app.presenting` (helpers in `src/privacy.js`).

## Commands
- `npm test` — engine tests (Node built-in runner)
- `npm run serve` — static server on http://localhost:5173 (localhost counts as a secure context, so geolocation works)
- Deploy: `git push` to `main`; GitHub Pages serves the repo root at https://kurrikoffj.github.io/csr-demo/

## Layout
- `src/tunables.js` defaults · `geo.js` distance/bearing/circle crossing · `buckets.js` time-of-day buckets
- `src/runEngine.js` idle → armed → running → finished/aborted · `compliance.js` warning/DQ clock
- `src/osm.js` Overpass parsing, maxspeed tiers, grid index · `matcher.js` fix → road
- `src/records.js` personal bests, standing vs. own history · `replay.js` drive a trace through the pipeline
- `src/units.js` km/h ↔ mph, the whole numbers on the HUD and the roundel, default unit · `privacy.js` private places, names for Presentation mode, trimming a file for sending
- `src/demo.js` a made-up drive over the player's own roads ("Try it from the sofa") · `guide.js` the getting-started steps
- `ui/` welcome (front door), guide (step list and card), drive (HUD + audio), summary, history, routes + route (editor), tuning, feedback · `sw.js` network-first service worker

## Fix format
`{ t: ms epoch, lat, lon, speed: m/s|null, heading: deg|null, accuracy: m }` — same shape from live GPS, replay and tests.

## Units and judging
The speed unit is a per-phone setting (`settings.speedUnit`, default from `defaultUnit`: mph only where the phone's language region is US or GB and its time zone agrees). The driver is judged on the whole number on the speed digits against the whole number on the roundel, in that unit, so the screen and the verdict never disagree. A sign in its own unit is itself (30 mph reads 30; limits keep `mph` next to the exact `kmh`). A converted limit rounds up (50 km/h reads ~32 mph) and the yellow band is whole mph rounded up (3 km/h → 2 mph): nobody is flagged at or under the sign. Long distances follow the unit; guidance distances and marker circles stay in metres.

## Privacy
- Markers carry `private` (on unless unticked for a public landmark). Presentation mode (`settings.presentation`, per phone) shows a private place as A or B, hides its pin and circle, street names, and the map tiles under a drive. The route editor keeps its map. A strip across the top says the mode is on, in every screen and state colour.
- Send feedback can attach routes and runs; "Hide where I start and finish" (on by default) runs `trimForSharing`: no GPS point within `shareTrimM` of a private marker, private markers lose name and position, the file and its runs are marked `trimmed`. Trimmed runs cannot be replayed (no start or finish line) and `planImport` never lets a trimmed file replace a full copy or settings. A route whose markers have no position cannot be armed.
- What leaves the phone: the route's bounding box to an Overpass server, map tile requests to openstreetmap.org, and whatever the player shares. The welcome screen says exactly this (`PRIVACY_TEXT`); keep it true.

## Getting started
A new player is guided, not shown a demo drive (owner's call, 2026-09-21). The welcome screen explains the game in three steps above the name field. After that `gettingStarted` (`src/guide.js`) works out the next step from what exists (a player, a route with markers, a finished real run) and Drive shows it as a card (`ui/guide.js`): place your two markers, then arm and drive. The route editor names the step, and the first finished run's summary says what a time to beat is. The card goes away after the first finish, never shows for an imported player, and can be hidden per player (`settings.guideHidden`, brought back from Tuning). Replays from the sofa do not count as a drive.

## Guidance arrow
"Up" for the arrow comes from `Session.guideHeading`: a vehicle-speed GPS course (≥ `headingMinSpeedMs`, held `courseHoldS` through stops), else the phone compass (`ui/compass.js`, asked for inside the Arm tap), else north-up. The arrow follows fixes as rough as `guideMaxAccuracyM`; starting or stopping the clock still needs `maxAccuracyM`.

## Browser constraints (iOS Safari)
GPS only while the page is visible and the screen is on; audio must be unlocked by a tap (Arm); Wake Lock in Home Screen mode needs iOS 18.4+.

## Status (2026-09-21)
Live at the Pages URL is build `2026-09-21.1`; build `2026-09-21.2` (this working tree, not yet committed or deployed) adds getting-started guidance for new players, Presentation mode and private places, safer feedback files, the repo guard, and mph. The owner has driven it twice and is playtesting. Built so far: run engine, OSM limits with tiers, yellow/red/disqualified (judged on the whole number the HUD shows; yellow seconds add up on a leaky clock), guidance arrow (GPS course in the car, compass on foot), multiple routes, name-only players with feedback and import of a friend's file. Not yet verified on an iPhone: cue audibility over music, wake lock for a whole drive, compass after permission, share sheet with a file. The working notes live in `notes/` on the owner's machine (gitignored): start with `notes/handoff.md`.

## Data model
Players: `[{ id, name, createdAt, imported? }]`, a name and nothing else (no server, no password). Routes and runs carry `playerId`; `app.routes` / `app.runs` are already filtered to the active player. Export files are per player; `planImport` in `src/profile.js` decides whether a file is your own backup or another player to add.
Routes: `[{ id, rev, playerId, a, b, trimmed? }]`, marker `{ name, lat, lon, activationM, finalizationM, private }` (`lat`/`lon` are null on a route that came in a trimmed file). Settings hold `speedUnit`, `presentation`, tunables and sound mode; unit and Presentation mode stay with the phone when a backup is imported. Runs also carry `unit` (the unit they were judged in) and `trimmed`. Road data is stored per route (`roads:<id>`). Runs carry `routeId`, `routeRev`, `direction`, `bucket`; a best is the fastest clean run for that key inside the record window. Traces are packed rows with a zone column (0 ok, 1 red, 2 yellow).
