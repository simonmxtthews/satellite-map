// Visual pass prediction: for a ground location, find upcoming windows where
// a satellite rises above the horizon, is itself lit by the Sun, and the
// observer's sky is dark enough to see it against — the same "when can I
// see it" computation sites like Heavens-Above / N2YO provide. Everything
// needed (topocentric look angles, frame transforms) comes from satellite.js,
// which already backs every other orbital calculation in this app.
import * as satellite from "satellite.js";
import { getSatrec } from "./orbits";
import { getSunEciDirection } from "./sun";
import { EARTH_RADIUS_KM } from "./constants";
import type { SatelliteRecord } from "../types";

export interface ObserverLocation {
  latDeg: number;
  lonDeg: number;
  altKm: number;
}

export interface Pass {
  riseTime: Date;
  riseAzimuthDeg: number;
  maxTime: Date;
  maxElevationDeg: number;
  maxAzimuthDeg: number;
  setTime: Date;
  setAzimuthDeg: number;
  // Satellite is sunlit AND the observer's sky is dark enough (sun below
  // civil twilight) at the pass's highest point — the condition under which
  // a pass is actually visible to the naked eye, as opposed to merely being
  // geometrically above the horizon.
  visible: boolean;
}

export interface PassPredictionOptions {
  startDate?: Date;
  windowHours?: number;
  stepSeconds?: number;
  minElevationDeg?: number;
  // Sun elevation at/below which the sky is dark enough to spot a satellite
  // (civil twilight, the threshold real pass predictors use).
  darknessSolarElevationDeg?: number;
  maxPasses?: number;
}

interface LookResult {
  elevationDeg: number;
  azimuthDeg: number;
  posEci: { x: number; y: number; z: number };
}

const INVALID_LOOK: LookResult = { elevationDeg: -90, azimuthDeg: 0, posEci: { x: 0, y: 0, z: 0 } };

function lookAnglesAt(
  rec: satellite.SatRec,
  observerGeodetic: satellite.GeodeticLocation,
  date: Date,
): LookResult {
  const result = satellite.propagate(rec, date);
  const posEci = result?.position;
  // Treated as "definitely below threshold" rather than thrown — a satellite
  // whose SGP4 propagation breaks down (e.g. decayed) simply contributes no
  // passes instead of aborting the whole scan.
  if (!posEci || typeof posEci === "boolean") return INVALID_LOOK;
  const gmst = satellite.gstime(date);
  const posEcf = satellite.eciToEcf(posEci, gmst);
  const look = satellite.ecfToLookAngles(observerGeodetic, posEcf);
  return {
    elevationDeg: satellite.radiansToDegrees(look.elevation),
    azimuthDeg: satellite.radiansToDegrees(look.azimuth),
    posEci,
  };
}

// Standard cylindrical Earth-shadow model: the satellite is eclipsed only
// when it's on the night side of Earth's center (relative to the Sun) AND
// its distance from the Earth-Sun line is less than Earth's radius. Ignores
// the penumbra/atmospheric refraction real umbra geometry has — negligible
// next to the other approximations already inherent in "dark enough to see
// a satellite" as a concept.
function isSunlit(satPosEci: { x: number; y: number; z: number }, sunDirEci: { x: number; y: number; z: number }): boolean {
  const s = satPosEci.x * sunDirEci.x + satPosEci.y * sunDirEci.y + satPosEci.z * sunDirEci.z;
  if (s > 0) return true;
  const distSq = satPosEci.x ** 2 + satPosEci.y ** 2 + satPosEci.z ** 2;
  const perpSq = distSq - s * s;
  return perpSq > EARTH_RADIUS_KM * EARTH_RADIUS_KM;
}

// Sun's elevation above the observer's local horizon. eciToEcf is a pure
// GMST rotation (no translation), so it's valid to feed it the Sun's unit
// *direction* the same way it's normally fed a position — the result is the
// Sun's direction in ECF, and its angle from the observer's zenith gives
// elevation without needing the Sun's (practically irrelevant at this
// distance) true range.
function observerSolarElevationDeg(observerGeodetic: satellite.GeodeticLocation, date: Date): number {
  const sunDirEci = getSunEciDirection(date);
  const gmst = satellite.gstime(date);
  const sunDirEcf = satellite.eciToEcf(sunDirEci, gmst);
  const { latitude, longitude } = observerGeodetic;
  const zenith = {
    x: Math.cos(latitude) * Math.cos(longitude),
    y: Math.cos(latitude) * Math.sin(longitude),
    z: Math.sin(latitude),
  };
  const dot = sunDirEcf.x * zenith.x + sunDirEcf.y * zenith.y + sunDirEcf.z * zenith.z;
  return satellite.radiansToDegrees(Math.asin(Math.max(-1, Math.min(1, dot))));
}

// Bisects the single threshold crossing bracketed by [tA, tB] (in either
// direction — rising or falling) down to ~millisecond precision.
function bisectCrossing(
  rec: satellite.SatRec,
  observerGeodetic: satellite.GeodeticLocation,
  tA: number,
  tB: number,
  thresholdDeg: number,
): number {
  let lo = tA;
  let hi = tB;
  let loSign = Math.sign(lookAnglesAt(rec, observerGeodetic, new Date(lo)).elevationDeg - thresholdDeg);
  for (let i = 0; i < 20; i++) {
    const mid = (lo + hi) / 2;
    const midEl = lookAnglesAt(rec, observerGeodetic, new Date(mid)).elevationDeg;
    const midSign = Math.sign(midEl - thresholdDeg);
    if (midSign === loSign) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return (lo + hi) / 2;
}

// Golden-section search for the elevation maximum between a pass's rise and
// set — elevation is unimodal (rises then falls) across a single pass, so
// this converges cleanly without needing a derivative.
function goldenSectionMaxElevation(
  rec: satellite.SatRec,
  observerGeodetic: satellite.GeodeticLocation,
  tStart: number,
  tEnd: number,
): number {
  const invPhi = (Math.sqrt(5) - 1) / 2;
  let a = tStart;
  let b = tEnd;
  let c = b - invPhi * (b - a);
  let d = a + invPhi * (b - a);
  let fc = lookAnglesAt(rec, observerGeodetic, new Date(c)).elevationDeg;
  let fd = lookAnglesAt(rec, observerGeodetic, new Date(d)).elevationDeg;
  for (let i = 0; i < 25; i++) {
    if (fc > fd) {
      b = d;
      d = c;
      fd = fc;
      c = b - invPhi * (b - a);
      fc = lookAnglesAt(rec, observerGeodetic, new Date(c)).elevationDeg;
    } else {
      a = c;
      c = d;
      fc = fd;
      d = a + invPhi * (b - a);
      fd = lookAnglesAt(rec, observerGeodetic, new Date(d)).elevationDeg;
    }
  }
  return (a + b) / 2;
}

// Scans forward from `startDate` in coarse steps looking for elevation
// crossing `minElevationDeg`, then refines each rise/set/max with the
// bisection/golden-section helpers above. Cheap enough (a few thousand SGP4
// propagations for a multi-day window) to run synchronously on the main
// thread for a single selected satellite.
export function computePasses(
  sat: SatelliteRecord,
  observer: ObserverLocation,
  options: PassPredictionOptions = {},
): Pass[] {
  if (sat.bodyType === "moon") return [];

  const {
    startDate = new Date(),
    windowHours = 72,
    stepSeconds = 60,
    minElevationDeg = 10,
    darknessSolarElevationDeg = -6,
    maxPasses = 10,
  } = options;

  const rec = getSatrec(sat);
  const observerGeodetic: satellite.GeodeticLocation = {
    longitude: satellite.degreesToRadians(observer.lonDeg),
    latitude: satellite.degreesToRadians(observer.latDeg),
    height: observer.altKm,
  };

  const passes: Pass[] = [];
  const startMs = startDate.getTime();
  const endMs = startMs + windowHours * 3600 * 1000;
  const stepMs = stepSeconds * 1000;

  let prevT = startMs;
  let prevEl = lookAnglesAt(rec, observerGeodetic, new Date(prevT)).elevationDeg;
  // If the window opens mid-pass, there's no real rise time to report —
  // that partial pass is simply skipped in favor of the next full one.
  let riseTimeMs: number | null = null;
  let riseAzimuthDeg = 0;

  for (let t = startMs + stepMs; t <= endMs && passes.length < maxPasses; t += stepMs) {
    const el = lookAnglesAt(rec, observerGeodetic, new Date(t)).elevationDeg;

    if (riseTimeMs == null && prevEl < minElevationDeg && el >= minElevationDeg) {
      riseTimeMs = bisectCrossing(rec, observerGeodetic, prevT, t, minElevationDeg);
      riseAzimuthDeg = lookAnglesAt(rec, observerGeodetic, new Date(riseTimeMs)).azimuthDeg;
    } else if (riseTimeMs != null && prevEl >= minElevationDeg && el < minElevationDeg) {
      const setTimeMs = bisectCrossing(rec, observerGeodetic, prevT, t, minElevationDeg);
      const maxTimeMs = goldenSectionMaxElevation(rec, observerGeodetic, riseTimeMs, setTimeMs);
      const maxLook = lookAnglesAt(rec, observerGeodetic, new Date(maxTimeMs));
      const setLook = lookAnglesAt(rec, observerGeodetic, new Date(setTimeMs));
      const maxDate = new Date(maxTimeMs);
      const visible =
        isSunlit(maxLook.posEci, getSunEciDirection(maxDate)) &&
        observerSolarElevationDeg(observerGeodetic, maxDate) <= darknessSolarElevationDeg;

      passes.push({
        riseTime: new Date(riseTimeMs),
        riseAzimuthDeg,
        maxTime: maxDate,
        maxElevationDeg: maxLook.elevationDeg,
        maxAzimuthDeg: maxLook.azimuthDeg,
        setTime: new Date(setTimeMs),
        setAzimuthDeg: setLook.azimuthDeg,
        visible,
      });

      riseTimeMs = null;
    }

    prevT = t;
    prevEl = el;
  }

  return passes;
}

const COMPASS_POINTS = [
  "N", "NNE", "NE", "ENE", "E", "ESE", "SE", "SSE",
  "S", "SSW", "SW", "WSW", "W", "WNW", "NW", "NNW",
];

export function compassDirection(azimuthDeg: number): string {
  const normalized = ((azimuthDeg % 360) + 360) % 360;
  return COMPASS_POINTS[Math.round(normalized / 22.5) % 16];
}
