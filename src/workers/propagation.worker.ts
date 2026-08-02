/// <reference lib="webworker" />
import * as satellite from "satellite.js";
import { EARTH_RADIUS_KM } from "../lib/constants";

// Runs SGP4 propagation for every cataloged satellite off the main thread,
// on an interval, and posts back transferable Float32Arrays of scene-space
// positions AND velocities. Keeping this out of the render loop is what
// makes 16k+ satellites feasible at interactive frame rates. Velocity is
// included so the main thread can smoothly extrapolate positions every
// animation frame between these (comparatively infrequent) full recomputes,
// instead of satellites visibly jumping each tick.

interface InitMessage {
  type: "init";
  satellites: { id: number; line1: string; line2: string }[];
  intervalMs: number;
}

interface SetOffsetMessage {
  type: "setOffset";
  offsetMs: number;
}

let satrecs: satellite.SatRec[] = [];
let ids: number[] = [];
let timer: ReturnType<typeof setInterval> | null = null;
// Offset from the real clock driven by the timeline scrubber (see store.ts).
let offsetMs = 0;

const SCALE = 1 / EARTH_RADIUS_KM;

function tick() {
  const now = new Date(Date.now() + offsetMs);
  const n = satrecs.length;
  const positions = new Float32Array(n * 3);
  const velocities = new Float32Array(n * 3);
  const valid = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    const result = satellite.propagate(satrecs[i], now);
    const pos = result?.position;
    const vel = result?.velocity;
    if (!pos || typeof pos === "boolean") {
      valid[i] = 0;
      continue;
    }
    // TEME/ECI km -> scene units. Map ECI (x,y,z; z = toward north pole)
    // so that z becomes scene "up" (three.js Y axis): (x, z, -y).
    positions[i * 3] = pos.x * SCALE;
    positions[i * 3 + 1] = pos.z * SCALE;
    positions[i * 3 + 2] = -pos.y * SCALE;
    if (vel && typeof vel !== "boolean") {
      // Scene units per simulated second — dimensionally consistent with
      // extrapolating against elapsed *simulated* time on the main thread,
      // so it stays correct at any playback speed without needing to know
      // that speed here.
      velocities[i * 3] = vel.x * SCALE;
      velocities[i * 3 + 1] = vel.z * SCALE;
      velocities[i * 3 + 2] = -vel.y * SCALE;
    }
    valid[i] = 1;
  }

  (self as unknown as Worker).postMessage(
    { type: "positions", positions, velocities, valid, time: now.getTime() },
    { transfer: [positions.buffer, velocities.buffer, valid.buffer] },
  );
}

self.onmessage = (e: MessageEvent<InitMessage | SetOffsetMessage>) => {
  const msg = e.data;
  if (msg.type === "init") {
    ids = msg.satellites.map((s) => s.id);
    satrecs = msg.satellites.map((s) => satellite.twoline2satrec(s.line1, s.line2));
    (self as unknown as Worker).postMessage({ type: "ready", ids });
    if (timer) clearInterval(timer);
    timer = setInterval(tick, msg.intervalMs);
    tick();
  } else if (msg.type === "setOffset") {
    offsetMs = msg.offsetMs;
    tick();
  }
};
