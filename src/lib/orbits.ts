import * as satellite from "satellite.js";
import { EARTH_RADIUS_KM } from "./constants";
import { getMoonEciPosition, MOON_SIDEREAL_PERIOD_MIN } from "./moon";
import type { LiveSatelliteInfo, SatelliteRecord } from "../types";

const satrecCache = new Map<number, satellite.SatRec>();

// Exported so other modules needing raw SGP4 propagation (currently
// src/lib/passPrediction.ts) share this cache instead of re-parsing the same
// TLE into a new SatRec.
export function getSatrec(sat: SatelliteRecord): satellite.SatRec {
  let rec = satrecCache.get(sat.id);
  if (!rec) {
    rec = satellite.twoline2satrec(sat.line1 ?? "", sat.line2 ?? "");
    satrecCache.set(sat.id, rec);
  }
  return rec;
}

// The Moon isn't a TLE/SGP4 object (see src/lib/moon.ts) — every function
// below branches on this before touching satrecs, so every caller
// (DetailPanel, CameraRig, OrbitPath, Satellites' per-frame overrides) can
// keep treating a SatelliteRecord uniformly regardless of which body it is.
function isMoon(sat: SatelliteRecord): boolean {
  return sat.bodyType === "moon";
}

const EARTH_RADIUS_SCALE = 1 / EARTH_RADIUS_KM;

export function eciToScene(x: number, y: number, z: number): [number, number, number] {
  return [x * EARTH_RADIUS_SCALE, z * EARTH_RADIUS_SCALE, -y * EARTH_RADIUS_SCALE];
}

export function getLiveInfo(sat: SatelliteRecord, date: Date): LiveSatelliteInfo | null {
  if (isMoon(sat)) {
    const pos = getMoonEciPosition(date);
    const gmst = satellite.gstime(date);
    const geo = satellite.eciToGeodetic(pos, gmst);
    // No analytic velocity from the low-precision ephemeris — approximate
    // via a symmetric finite difference (the Moon's speed barely changes
    // over a 2-second window, so this is effectively exact).
    const dtSec = 1;
    const before = getMoonEciPosition(new Date(date.getTime() - dtSec * 1000));
    const after = getMoonEciPosition(new Date(date.getTime() + dtSec * 1000));
    const speedKmS =
      Math.sqrt(
        (after.x - before.x) ** 2 + (after.y - before.y) ** 2 + (after.z - before.z) ** 2,
      ) /
      (2 * dtSec);
    return {
      id: sat.id,
      latDeg: satellite.degreesLat(geo.latitude),
      lonDeg: satellite.degreesLong(geo.longitude),
      altKm: geo.height,
      speedKmS,
    };
  }

  const rec = getSatrec(sat);
  const result = satellite.propagate(rec, date);
  if (!result) return null;
  const pos = result.position;
  const vel = result.velocity;
  if (!pos || typeof pos === "boolean") return null;
  const gmst = satellite.gstime(date);
  const geo = satellite.eciToGeodetic(pos, gmst);
  const speedKmS =
    vel && typeof vel !== "boolean"
      ? Math.sqrt(vel.x * vel.x + vel.y * vel.y + vel.z * vel.z)
      : 0;
  return {
    id: sat.id,
    latDeg: satellite.degreesLat(geo.latitude),
    lonDeg: satellite.degreesLong(geo.longitude),
    altKm: geo.height,
    speedKmS,
  };
}

export function getScenePosition(sat: SatelliteRecord, date: Date): [number, number, number] | null {
  if (isMoon(sat)) {
    const pos = getMoonEciPosition(date);
    return eciToScene(pos.x, pos.y, pos.z);
  }
  const rec = getSatrec(sat);
  const result = satellite.propagate(rec, date);
  if (!result) return null;
  const pos = result.position;
  if (!pos || typeof pos === "boolean") return null;
  return eciToScene(pos.x, pos.y, pos.z);
}

// Full orbit ground path in scene space, sampled evenly across one period
// starting at `startDate` (defaults to real now).
export function computeOrbitPath(
  sat: SatelliteRecord,
  startDate: Date = new Date(),
  samples = 180,
): [number, number, number][] {
  const start = startDate.getTime();
  if (isMoon(sat)) {
    const periodMs = MOON_SIDEREAL_PERIOD_MIN * 60 * 1000;
    const points: [number, number, number][] = [];
    for (let i = 0; i <= samples; i++) {
      const pos = getMoonEciPosition(new Date(start + (periodMs * i) / samples));
      points.push(eciToScene(pos.x, pos.y, pos.z));
    }
    return points;
  }

  const rec = getSatrec(sat);
  const periodMs = sat.periodMin * 60 * 1000;
  const points: [number, number, number][] = [];
  for (let i = 0; i <= samples; i++) {
    const t = new Date(start + (periodMs * i) / samples);
    const result = satellite.propagate(rec, t);
    if (!result) continue;
    const pos = result.position;
    if (!pos || typeof pos === "boolean") continue;
    points.push(eciToScene(pos.x, pos.y, pos.z));
  }
  return points;
}

export function gmstAngle(date: Date): number {
  return satellite.gstime(date);
}
