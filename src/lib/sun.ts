// Real-time solar position, reusing satellite.js's own sunPos() (the
// low-precision Vallado geocentric-equatorial solar formula, valid
// 1950-2050 to ~0.01°) — the same trusted source already used for every
// other orbital calculation in this app, rather than reimplementing solar
// ephemeris math from scratch. Its output is in the same ECI-equatorial
// frame (x/y in the equatorial plane, z toward the pole) that
// eciToScene/getMoonEciPosition already use, so a single consistent axis
// convention drives Earth's rotation, the Moon, satellites, and now the Sun.
import * as satellite from "satellite.js";

export function getSunEciDirection(date: Date): { x: number; y: number; z: number } {
  const { rsun } = satellite.sunPos(satellite.jday(date));
  const mag = Math.sqrt(rsun.x * rsun.x + rsun.y * rsun.y + rsun.z * rsun.z);
  return { x: rsun.x / mag, y: rsun.y / mag, z: rsun.z / mag };
}

// Same ECI -> scene axis remap eciToScene uses (x, z, -y), applied to a
// unit direction rather than a physical position — this is what both
// Earth's day/night terminator shader and the visible Sun's placement key
// off of, so the lit hemisphere and the rendered Sun position can never
// disagree with each other.
export function getSunSceneDirection(date: Date): [number, number, number] {
  const { x, y, z } = getSunEciDirection(date);
  return [x, z, -y];
}

// The Sun's real distance (~23,455 Earth radii) is far beyond this scene's
// practical bounds (camera far plane, OrbitControls range, the decorative
// star field) — like every other "keep direction/geometry accurate,
// compress distance for practicality" choice already in this app
// (exaggerated satellite marker size; the Moon's real distance stretching
// the camera range as far as it reasonably can), the Sun is placed at a
// fixed stylized distance in its correct real direction instead of its
// true (unusable) distance.
export const SUN_DISPLAY_DISTANCE = 140;

export function getSunScenePosition(date: Date): [number, number, number] {
  const [dx, dy, dz] = getSunSceneDirection(date);
  return [dx * SUN_DISPLAY_DISTANCE, dy * SUN_DISPLAY_DISTANCE, dz * SUN_DISPLAY_DISTANCE];
}

// The Sun's real radius (696,000 km) and real distance (1 AU) are both
// compressed here, but by the SAME factor — so although neither is the true
// value, their ratio (and therefore the Sun's real apparent angular size as
// seen from Earth, ~0.5°) is preserved exactly. That's what "to scale"
// means once you've already had to compress distance for practicality: a
// physically arbitrary radius (the old fixed 2.4-unit disk) would make the
// Sun look either like a toy marble or an oversized backdrop depending on
// camera distance, whereas this stays correctly tiny-and-brilliant the way
// the real Sun actually looks from Earth orbit.
const SUN_RADIUS_KM = 696_000;
const AU_KM = 149_597_870;
export const SUN_RADIUS_SCENE = SUN_DISPLAY_DISTANCE * (SUN_RADIUS_KM / AU_KM);
