// Low-precision lunar ephemeris. SGP4 (used for every other body in this
// app) is only valid for objects in Earth orbit propagated from a TLE — it
// doesn't apply to the Moon. This is a standard, widely-reproduced compact
// formula (geocentric ecliptic longitude/latitude + horizontal parallax as
// short Fourier series in time, converted to equatorial coordinates via the
// mean obliquity of the ecliptic) accurate to roughly a few arcminutes in
// angle and a few hundred km in distance — not JPL-ephemeris precision, but
// far tighter than this visualization's scale (1 scene unit = 1 Earth
// radius, ~6,378 km) can even distinguish.
import { EARTH_RADIUS_KM } from "./constants";
import type { SatelliteRecord } from "../types";

const DEG2RAD = Math.PI / 180;
const OBLIQUITY_DEG = 23.4393;

function julianCenturiesSinceJ2000(date: Date): number {
  const JD = date.getTime() / 86400000 + 2440587.5;
  return (JD - 2451545.0) / 36525;
}

interface EclipticPosition {
  lonDeg: number;
  latDeg: number;
  distanceKm: number;
}

function moonEclipticPosition(date: Date): EclipticPosition {
  const T = julianCenturiesSinceJ2000(date);
  const sinDeg = (deg: number) => Math.sin(deg * DEG2RAD);
  const cosDeg = (deg: number) => Math.cos(deg * DEG2RAD);

  const lonDeg =
    218.32 +
    481267.881 * T +
    6.29 * sinDeg(477198.87 * T + 135.0) -
    1.27 * sinDeg(413335.35 * T + 259.3) +
    0.66 * sinDeg(890534.22 * T + 235.7) +
    0.21 * sinDeg(954397.74 * T + 269.9) -
    0.19 * sinDeg(35999.05 * T + 357.5) -
    0.11 * sinDeg(966404.03 * T + 186.6);

  const latDeg =
    5.13 * sinDeg(483202.02 * T + 93.3) +
    0.28 * sinDeg(960400.89 * T + 228.2) -
    0.28 * sinDeg(6003.15 * T + 318.3) -
    0.17 * sinDeg(407332.21 * T + 217.6);

  const parallaxDeg =
    0.9508 +
    0.0518 * cosDeg(477198.87 * T + 135.0) +
    0.0095 * cosDeg(413335.35 * T + 259.3) +
    0.0078 * cosDeg(890534.22 * T + 235.7) +
    0.0028 * cosDeg(954397.74 * T + 269.9);

  const distanceEarthRadii = 1 / Math.sin(parallaxDeg * DEG2RAD);

  return {
    lonDeg: ((lonDeg % 360) + 360) % 360,
    latDeg,
    distanceKm: distanceEarthRadii * EARTH_RADIUS_KM,
  };
}

// Geocentric equatorial (ECI-frame) position, in km — the same shape
// satellite.propagate()'s `.position` returns, which is what lets
// src/lib/orbits.ts feed it straight into the existing eciToScene /
// eciToGeodetic pipeline used for every other body.
export function getMoonEciPosition(date: Date): { x: number; y: number; z: number } {
  const { lonDeg, latDeg, distanceKm } = moonEclipticPosition(date);
  const lon = lonDeg * DEG2RAD;
  const lat = latDeg * DEG2RAD;
  const eps = OBLIQUITY_DEG * DEG2RAD;

  const sinLon = Math.sin(lon);
  const cosLon = Math.cos(lon);
  const sinLat = Math.sin(lat);
  const cosLat = Math.cos(lat);
  const sinEps = Math.sin(eps);
  const cosEps = Math.cos(eps);

  const ra = Math.atan2(sinLon * cosEps - Math.tan(lat) * sinEps, cosLon);
  const dec = Math.asin(sinLat * cosEps + cosLat * sinEps * sinLon);

  return {
    x: distanceKm * Math.cos(dec) * Math.cos(ra),
    y: distanceKm * Math.cos(dec) * Math.sin(ra),
    z: distanceKm * Math.sin(dec),
  };
}

// Real physical/orbital constants for the Moon, used to populate its
// SatelliteRecord fields (displayed in the same detail-panel grid as any
// other satellite's inclination/apogee/perigee/period).
export const MOON_INCLINATION_DEG = 5.145; // to the ecliptic
export const MOON_APOGEE_KM = 405500;
export const MOON_PERIGEE_KM = 363300;
export const MOON_SIDEREAL_PERIOD_MIN = 27.321661 * 24 * 60;
export const MOON_RADIUS_KM = 1737.4;

// A sentinel id well outside the range of real NORAD catalog numbers used
// by the fetched TLE catalog, so it can never collide.
export const MOON_ID = -1;

// The Moon, packaged as a regular SatelliteRecord so it can live in the
// same `satellites` store array and flow through every existing
// search/filter/select/detail-panel/orbit-path code path unmodified.
export const MOON_RECORD: SatelliteRecord = {
  id: MOON_ID,
  name: "Moon",
  category: "Moon",
  inclinationDeg: MOON_INCLINATION_DEG,
  apogeeKm: MOON_APOGEE_KM,
  perigeeKm: MOON_PERIGEE_KM,
  periodMin: MOON_SIDEREAL_PERIOD_MIN,
  bodyType: "moon",
};
