import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getScenePosition } from "../lib/orbits";
import { simulatedNow } from "../lib/time";
import { useAppStore } from "../store";
import { HIGHLIGHT_COLOR } from "../lib/constants";
import type { SatelliteRecord } from "../types";

interface Props {
  satellite: SatelliteRecord;
}

const tmpDir = new THREE.Vector3();

// A straight line from the selected satellite down to its sub-satellite
// point — where the satellite-to-Earth-center line meets the surface (Earth
// is a unit sphere in scene units, so that point is simply the satellite's
// direction from the origin, normalized). Built imperatively (THREE.Line
// mounted via <primitive>, not JSX's `<line>` — which collides with the SVG
// element of the same name — nor drei's fat-line <Line> used for
// OrbitPath) and updated every frame, since unlike the static orbit trace
// this genuinely needs to move with the satellite.
export function NadirLine({ satellite }: Props) {
  const positions = useRef(new Float32Array(6));

  const line = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(positions.current, 3));
    const material = new THREE.LineBasicMaterial({ color: HIGHLIGHT_COLOR, transparent: true, opacity: 0.45 });
    return new THREE.Line(geometry, material);
  }, []);

  useFrame(() => {
    const pos = getScenePosition(satellite, simulatedNow(useAppStore.getState().timeOffsetMs));
    if (!pos) {
      line.visible = false;
      return;
    }
    line.visible = true;
    tmpDir.set(pos[0], pos[1], pos[2]).normalize();

    const arr = positions.current;
    arr[0] = tmpDir.x;
    arr[1] = tmpDir.y;
    arr[2] = tmpDir.z;
    arr[3] = pos[0];
    arr[4] = pos[1];
    arr[5] = pos[2];

    const attr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    attr.needsUpdate = true;
  });

  return <primitive object={line} />;
}
