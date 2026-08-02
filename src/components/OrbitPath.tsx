import { useMemo } from "react";
import { Line } from "@react-three/drei";
import { computeOrbitPath } from "../lib/orbits";
import type { SatelliteRecord } from "../types";

interface Props {
  satellite: SatelliteRecord;
}

// The path traces one full orbit as a closed loop, so which instant it
// starts sampling from doesn't change its visual shape — recomputing it
// only when the satellite changes (rather than on every timeOffsetMs tick,
// which fires every animation frame during scrubbing/playback and made
// this a major jank source re-running 180 SGP4 propagations per frame).
export function OrbitPath({ satellite }: Props) {
  const points = useMemo(() => computeOrbitPath(satellite), [satellite]);
  if (points.length < 2) return null;
  return <Line points={points} color="#ffe066" lineWidth={2} transparent opacity={0.8} />;
}
