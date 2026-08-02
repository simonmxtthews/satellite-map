#!/usr/bin/env node
// Fetches real photographic planet textures into public/textures: a
// cloud-free NASA Blue Marble Earth day map, NASA's Black Marble night-lights
// composite (real city-light data, not a synthetic approximation), and a
// USGS/Clementine-derived lunar photomap for the Moon. Falls back to the
// bundled seed copies if the network is unavailable.

import { writeFile, copyFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.join(__dirname, "..", "public", "textures");

const TARGETS = [
  {
    url: "https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg",
    out: path.join(OUT_DIR, "earth-day.jpg"),
    seed: path.join(__dirname, "earth-day.seed.jpg"),
  },
  {
    url: "https://threejs.org/examples/textures/planets/earth_lights_2048.png",
    out: path.join(OUT_DIR, "earth-night.png"),
    seed: path.join(__dirname, "earth-night.seed.png"),
  },
  {
    url: "https://threejs.org/examples/textures/planets/moon_1024.jpg",
    out: path.join(OUT_DIR, "moon.jpg"),
    seed: path.join(__dirname, "moon.seed.jpg"),
  },
];

async function fetchOne({ url, out, seed }) {
  try {
    console.log(`Fetching ${url} ...`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    await writeFile(out, buf);
    console.log(`Wrote ${buf.length} bytes to ${out}`);
  } catch (err) {
    console.warn(`Live fetch failed (${err.message}); using bundled seed file.`);
    await copyFile(seed, out);
  }
}

async function main() {
  for (const target of TARGETS) await fetchOne(target);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
