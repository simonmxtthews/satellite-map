# Satellite Map

An interactive 3D globe tracking every cataloged active satellite in real time, built with React, Three.js (react-three-fiber), and [satellite.js](https://github.com/shashwatak/satellite-js) for SGP4 orbital propagation.

- **Real orbital telemetry**: TLE data sourced from [CelesTrak](https://celestrak.org)'s active-satellite catalog (~16,000 objects).
- **Accurate to scale**: inclination, apogee, and perigee are rendered at true scale relative to Earth's radius. Only the satellite *markers* are exaggerated in size so they're visible.
- **Real-time propagation**: every satellite's position is computed continuously via SGP4 in a Web Worker (updated twice a second), not just replayed from a snapshot.
- **Search**: find any satellite by name or NORAD ID; selecting a result highlights it and pans the camera toward it.
- **Click to inspect**: click any satellite directly in the 3D view to select it and see its live details (lat/lon, altitude, speed, inclination, apogee/perigee, orbital period).
- **Bulk highlighting**: toggle whole categories (Starlink, OneWeb, GPS, GLONASS, Galileo, BeiDou, Iridium, ISS/Stations, etc.) to highlight them as a group.
- **Ambient background music**: soft, looping ambient track, muteable via the speaker icon in the bottom-right corner.

## Audio attribution

`public/audio/ambient.mp3` is *"Meditation Impromptu 01"* by Kevin MacLeod ([incompetech.com](https://incompetech.com)), licensed under [Creative Commons BY 4.0](https://creativecommons.org/licenses/by/4.0/).

## Getting started

```bash
npm install
npm run fetch:tle   # refresh public/data/tle.json from CelesTrak (data updates ~every 2h)
npm run dev
```

## Refreshing satellite data

`npm run fetch:tle` re-downloads the current active-satellite catalog and re-tags categories. CelesTrak rate-limits repeat requests for unchanged data; if a fetch is throttled, the script falls back to the bundled seed snapshot in `scripts/active.tle.seed.txt`.

`npm run fetch:land` re-downloads world coastlines (Natural Earth 1:110m land polygons, public domain) into `public/data/land.geojson`, falling back to the bundled seed copy in `scripts/land110.geojson.seed.json` if offline. This rarely needs re-running since coastlines don't change.

## Architecture

- `scripts/fetch-tle.mjs` — Node script that fetches/parses TLEs into `public/data/tle.json` (done server-side since CelesTrak doesn't send CORS headers).
- `scripts/fetch-land.mjs` — Node script that fetches world coastline polygons into `public/data/land.geojson`.
- `src/workers/propagation.worker.ts` — runs SGP4 propagation for all satellites off the main thread.
- `src/lib/orbits.ts` — single-satellite propagation helpers (used for the detail panel and orbit path line).
- `src/lib/earthTexture.ts` — rasterizes the real coastline data onto a canvas texture, mapped onto a flat-shaded low-poly sphere (no external image assets).
- `src/components/Satellites.tsx` — a single `InstancedMesh` rendering all satellites, updated from the worker's position buffer each frame.
