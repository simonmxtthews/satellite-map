export const EARTH_RADIUS_KM = 6378.137;

// 1 scene unit = 1 Earth radius. All orbital altitudes/inclinations are
// rendered to this same scale, so relative geometry (LEO vs GEO shells,
// inclination angles) is physically accurate.
export const SCENE_SCALE = 1 / EARTH_RADIUS_KM;

// Satellites themselves are rendered many orders of magnitude larger than
// their true physical size (meters) so they're visible against a planet
// rendered at ~6,378 km radius. Only the marker size is exaggerated —
// position, inclination, apogee/perigee remain to-scale.
export const SATELLITE_MARKER_RADIUS = 0.004;
export const SATELLITE_MARKER_RADIUS_HIGHLIGHT = 0.006;

// A visible dot this small is very hard to land a click on, so clicking and
// hovering test against a separate, larger invisible geometry instead (see
// Satellites.tsx) — this is how many world units bigger than the current
// marker radius that hitbox is, applied proportionally to whichever radius
// (normal or highlighted) is currently in effect.
export const SATELLITE_HITBOX_MULTIPLIER = 2;

// Unlike every other satellite marker (deliberately exaggerated so tiny
// objects are visible), the Moon is rendered at its true-to-scale radius:
// 1737.4 km / 6378.137 km (Earth's radius, i.e. 1 scene unit) ≈ 0.2724.
export const MOON_RADIUS_SCENE = 1737.4 / EARTH_RADIUS_KM;

export const PROPAGATION_INTERVAL_MS = 500;

// Minimum real-ms between "setOffset" messages sent to the worker while the
// offset is changing rapidly (playback, fast scrubbing). Shared with
// Satellites.tsx, which needs the same value to size its GPU extrapolation
// window (see uMaxDt in the vertex shader) to the worst-case gap between
// worker snapshots at any given playback speed.
export const WORKER_UPDATE_THROTTLE_MS = 150;

// Standard gravitational parameter (mu, km^3/s^2) for Earth, rescaled into
// scene units (1 unit = 1 Earth radius) so it can drive a two-body
// (Kepler) acceleration term directly from a scene-space position: physical
// accel = -mu * r_km / |r_km|^3, and since scene_r = r_km / EARTH_RADIUS_KM,
// scene_accel = accel_km / EARTH_RADIUS_KM = -GM_SCENE * scene_r / |scene_r|^3
// with GM_SCENE = mu / EARTH_RADIUS_KM^3.
export const GM_SCENE = 398600.4418 / EARTH_RADIUS_KM ** 3;

// Shared camera distance bounds: OrbitControls' scroll-zoom limits (Scene.tsx)
// and CameraRig's fly-to targets must agree, or a fly-to animation can land
// outside the range the user is then allowed to scroll-zoom within.
// CAMERA_MIN_DISTANCE keeps the camera from clipping through Earth on
// close-in LEO satellites; CAMERA_MAX_DISTANCE is beyond a satellite's normal
// range (up to GEO, ~6.6 Earth radii) so it can also fit the Moon's true
// orbital distance (~60.3 Er).
export const CAMERA_MIN_DISTANCE = 2;
export const CAMERA_MAX_DISTANCE = 120;

export const CATEGORY_COLORS: Record<string, string> = {
  Moon: "#c9c9c9",
  "ISS / Stations": "#ff6b6b",
  Starlink: "#4dabf7",
  OneWeb: "#9775fa",
  Iridium: "#ffa94d",
  GPS: "#51cf66",
  GLONASS: "#ff8787",
  Galileo: "#ffd43b",
  BeiDou: "#e64980",
  "Planet / Earth Observation": "#20c997",
  Weather: "#74c0fc",
  "Science / Astronomy": "#f783ac",
  Communications: "#a9e34b",
  "Amateur / CubeSat": "#fab005",
  Other: "#adb5bd",
};

export const CATEGORY_ORDER = Object.keys(CATEGORY_COLORS);

export const HIGHLIGHT_COLOR = "#ffe066";
export const SELECTED_COLOR = "#ffffff";
export const DIMMED_OPACITY = 0.12;

// Base satellite colors are kept at normal (<=1) intensity so the bloom pass
// doesn't catch the whole swarm. Selected/highlighted instances are pushed
// well above 1 (HDR) so they blow out and bloom hard against the black sky —
// this is what makes the highlight read as a glow rather than just "bigger".
export const BASE_EMISSIVE_INTENSITY = 0.85;
export const HOVER_EMISSIVE_INTENSITY = 2.4;
export const HIGHLIGHT_EMISSIVE_INTENSITY = 2.2;
export const SELECTED_EMISSIVE_INTENSITY = 8;
