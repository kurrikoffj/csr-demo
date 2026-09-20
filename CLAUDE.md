# csr-demo

Browser demo of a solo commute time-trial: drive A→B on real roads, beat your own best per time-of-day bucket, never exceed the posted limit. Static site on GitHub Pages, played in iPhone Safari.

## Hard rules
- **The repo is public.** Never commit real GPS traces, marker coordinates, or anything from `notes/` or `traces/` (both gitignored). Test fixtures are synthetic.
- **No framework, no build step, no runtime dependencies.** The folder is the site. Plain ES modules.
- `src/` is pure logic with no DOM or browser APIs, so it runs under Node tests. Browser code lives in `ui/` and `app.js`.
- Every threshold lives in `src/tunables.js` and is editable in the Tuning screen. No magic numbers elsewhere.
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

## Browser constraints (iOS Safari)
GPS only while the page is visible and the screen is on; audio must be unlocked by a tap (Arm); Wake Lock in Home Screen mode needs iOS 18.4+.
