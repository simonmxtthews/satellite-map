import { useRef } from "react";
import { useFrame } from "@react-three/fiber";
import { Billboard } from "@react-three/drei";
import * as THREE from "three";
import { useAppStore } from "../store";
import { getScenePosition } from "../lib/orbits";
import { simulatedNow } from "../lib/time";
import {
  HIGHLIGHT_COLOR,
  HOVER_EMISSIVE_INTENSITY,
  SATELLITE_HITBOX_MULTIPLIER,
  SATELLITE_MARKER_RADIUS_HIGHLIGHT,
} from "../lib/constants";

// A hovered satellite is always rendered at the highlighted marker radius
// (see Satellites.tsx's `emphasized` logic), so this is the exact radius its
// hitbox mesh is currently using — same multiplier, same base radius.
const RING_RADIUS = SATELLITE_MARKER_RADIUS_HIGHLIGHT * SATELLITE_HITBOX_MULTIPLIER;
const RING_THICKNESS = RING_RADIUS * 0.18;

const ringColor = new THREE.Color(HIGHLIGHT_COLOR).multiplyScalar(HOVER_EMISSIVE_INTENSITY);

// A visual echo of the (otherwise invisible) hitbox mesh in Satellites.tsx —
// shown only while hovering, at the exact size of the clickable area, so
// "how close do I need to be to click this" is never a guessing game.
export function HoverHitboxRing() {
  const groupRef = useRef<THREE.Group>(null);
  const hoveredId = useAppStore((s) => s.hoveredId);
  const satelliteById = useAppStore((s) => s.satelliteById);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const sat = hoveredId != null ? satelliteById.get(hoveredId) : undefined;
    const pos = sat ? getScenePosition(sat, simulatedNow(useAppStore.getState().timeOffsetMs)) : null;
    if (!pos) {
      group.visible = false;
      return;
    }
    group.visible = true;
    group.position.set(...pos);
  });

  return (
    <group ref={groupRef} visible={false}>
      <Billboard>
        <mesh>
          <ringGeometry args={[RING_RADIUS - RING_THICKNESS, RING_RADIUS, 48]} />
          <meshBasicMaterial color={ringColor} transparent opacity={0.9} side={THREE.DoubleSide} />
        </mesh>
      </Billboard>
    </group>
  );
}
