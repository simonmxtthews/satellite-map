#!/usr/bin/env node
// Fetches the full active-satellite catalog from CelesTrak (open-source TLE telemetry),
// tags each object with a category by name pattern, and writes a compact JSON
// snapshot to public/data/tle.json for the app to load and propagate client-side.
//
// CelesTrak does not send CORS headers, and rate-limits repeat requests for the
// same (unchanged) dataset, so this fetch happens here (Node, server-side) rather
// than in the browser. Re-run this script periodically (data updates ~every 2h)
// to refresh the snapshot: `npm run fetch:tle`.

import { writeFile, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_PATH = path.join(__dirname, "..", "public", "data", "tle.json");
const SEED_PATH = path.join(__dirname, "active.tle.seed.txt");
const SOURCE_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=active&FORMAT=tle";

// Ordered so more specific patterns win when a name could match multiple.
const CATEGORY_RULES = [
  ["ISS / Stations", /^(ISS|ZARYA|TIANGONG|CSS|POISK|NAUKA|PROGRESS|SOYUZ|CREW DRAGON|TIANHE)/i],
  ["Starlink", /^STARLINK/i],
  ["OneWeb", /^ONEWEB/i],
  ["Iridium", /^IRIDIUM/i],
  ["GPS", /^(GPS|NAVSTAR)/i],
  ["GLONASS", /^(COSMOS.*GLONASS|GLONASS)/i],
  ["Galileo", /^GALILEO/i],
  ["BeiDou", /^(BEIDOU|BDS)/i],
  ["Planet / Earth Observation", /^(FLOCK|SKYSAT|PLANETSCOPE|LANDSAT|SENTINEL|WORLDVIEW|SPOT|PLEIADES)/i],
  ["Weather", /^(NOAA|GOES|METEOSAT|METOP|FENGYUN|HIMAWARI)/i],
  ["Science / Astronomy", /^(HUBBLE|HST|JWST|CHANDRA|SWIFT|SPEKTR|TESS)/i],
  ["Communications", /^(INTELSAT|EUTELSAT|SES|TELESAT|INMARSAT|ECHOSTAR|VIASAT|THURAYA|O3B)/i],
  ["Amateur / CubeSat", /^(CUBESAT|AMATEUR|OSCAR|CAS-|FUNCUBE|SO-)/i],
];

function categorize(name) {
  for (const [category, pattern] of CATEGORY_RULES) {
    if (pattern.test(name)) return category;
  }
  return "Other";
}

function parseTLE(text) {
  const lines = text.split("\n").map((l) => l.replace(/\r$/, ""));
  const sats = [];
  for (let i = 0; i + 2 < lines.length; i += 3) {
    const name = lines[i]?.trim();
    const line1 = lines[i + 1];
    const line2 = lines[i + 2];
    if (!name || !line1?.startsWith("1 ") || !line2?.startsWith("2 ")) continue;
    const noradId = parseInt(line1.substring(2, 7), 10);
    const inclinationDeg = parseFloat(line2.substring(8, 16));
    const eccentricity = parseFloat(`0.${line2.substring(26, 33).trim()}`);
    const meanMotion = parseFloat(line2.substring(52, 63)); // revs/day
    const periodMin = 1440 / meanMotion;

    // semi-major axis from mean motion (Kepler's third law), km
    const MU = 398600.4418; // km^3/s^2, Earth gravitational parameter
    const n = (meanMotion * 2 * Math.PI) / 86400; // rad/s
    const semiMajorAxisKm = Math.cbrt(MU / (n * n));
    const apogeeKm = semiMajorAxisKm * (1 + eccentricity) - 6378.137;
    const perigeeKm = semiMajorAxisKm * (1 - eccentricity) - 6378.137;

    sats.push({
      id: noradId,
      name,
      category: categorize(name),
      line1,
      line2,
      inclinationDeg,
      apogeeKm: Math.round(apogeeKm),
      perigeeKm: Math.round(perigeeKm),
      periodMin: Math.round(periodMin * 10) / 10,
    });
  }
  return sats;
}

async function main() {
  let text;
  try {
    console.log(`Fetching ${SOURCE_URL} ...`);
    const res = await fetch(SOURCE_URL, { headers: { "User-Agent": "satellite-map/1.0" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    text = await res.text();
    if (text.includes("has not updated since") || text.length < 1000) {
      throw new Error("CelesTrak returned a rate-limit / no-update notice, falling back to seed");
    }
  } catch (err) {
    console.warn(`Live fetch failed (${err.message}); using bundled seed file.`);
    text = await readFile(SEED_PATH, "utf-8");
  }

  const satellites = parseTLE(text);
  const categoryCounts = {};
  for (const s of satellites) {
    categoryCounts[s.category] = (categoryCounts[s.category] ?? 0) + 1;
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    count: satellites.length,
    categoryCounts,
    satellites,
  };

  await writeFile(OUT_PATH, JSON.stringify(payload));
  console.log(`Wrote ${satellites.length} satellites to ${OUT_PATH}`);
  console.table(categoryCounts);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
