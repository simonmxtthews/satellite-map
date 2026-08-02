import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { useAppStore } from "../store";
import { getObserverScenePosition } from "../lib/orbits";
import { simulatedNow } from "../lib/time";
import { OBSERVER_MARKER_COLOR, OBSERVER_MARKER_RADIUS } from "../lib/constants";

// How far outward (as a multiple of Earth's radius) the little "beacon"
// stick above the pin extends, and the min/max radii the pulsing ping ring
// cycles through — all relative to OBSERVER_MARKER_RADIUS so the whole
// marker scales together if that constant ever changes.
const BEACON_TIP_SCALE = 1.055;
// Just enough lift off the literal surface to avoid z-fighting with Earth's
// mesh — the ring is meant to read as lying flat on the ground, not
// hovering, so this stays tiny.
const RING_SURFACE_LIFT = 1.003;
const RING_MIN_RADIUS = OBSERVER_MARKER_RADIUS * 1.4;
const RING_MAX_RADIUS = OBSERVER_MARKER_RADIUS * 5;
const PING_PERIOD_SEC = 2.2;

const markerColor = new THREE.Color(OBSERVER_MARKER_COLOR);
const emissiveColor = markerColor.clone().multiplyScalar(2.2);
const surfaceVec = new THREE.Vector3();
const tipVec = new THREE.Vector3();
const normalVec = new THREE.Vector3();
// RingGeometry lies flat in the local XY plane (face normal +Z) — aligning
// that +Z with the surface's outward normal (see below) is what makes the
// ring lie flat against Earth's curvature instead of facing the camera.
const RING_LOCAL_NORMAL = new THREE.Vector3(0, 0, 1);

// A small "you are here" beacon at the observer location set in
// ObserverLocationPanel — a ground point, not a satellite, so unlike
// everything else in the scene it's fixed to Earth's rotating surface
// rather than the inertial ECI frame (see getObserverScenePosition).
// Nothing to click/hover here (there's no satellite record behind it), so
// this is purely visual, unlike Satellites.tsx/Moon.tsx's markers.
export function ObserverMarker() {
  const groupRef = useRef<THREE.Group>(null);
  const pinRef = useRef<THREE.Mesh>(null);
  // Positioned AND oriented every frame (see useFrame) — its quaternion is
  // set to align with the local surface normal so it lies flat against
  // Earth's curvature at that specific point, rather than facing the
  // camera like a typical billboarded UI ring.
  const ringAnchorRef = useRef<THREE.Group>(null);
  const ringMeshRef = useRef<THREE.Mesh>(null);
  const ringMaterialRef = useRef<THREE.MeshBasicMaterial>(null);

  const beaconLine = useMemo(() => {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array(6), 3));
    const material = new THREE.LineBasicMaterial({ color: markerColor, transparent: true, opacity: 0.7 });
    return new THREE.Line(geometry, material);
  }, []);

  useFrame((state) => {
    const group = groupRef.current;
    if (!group) return;
    const { observerLocation, timeOffsetMs } = useAppStore.getState();
    if (!observerLocation) {
      group.visible = false;
      return;
    }
    group.visible = true;

    const [x, y, z] = getObserverScenePosition(
      observerLocation.latDeg,
      observerLocation.lonDeg,
      observerLocation.altKm,
      simulatedNow(timeOffsetMs),
    );
    surfaceVec.set(x, y, z);
    tipVec.copy(surfaceVec).multiplyScalar(BEACON_TIP_SCALE);

    pinRef.current?.position.copy(surfaceVec);

    if (ringAnchorRef.current) {
      ringAnchorRef.current.position.copy(surfaceVec).multiplyScalar(RING_SURFACE_LIFT);
      normalVec.copy(surfaceVec).normalize();
      ringAnchorRef.current.quaternion.setFromUnitVectors(RING_LOCAL_NORMAL, normalVec);
    }

    const posAttr = beaconLine.geometry.getAttribute("position") as THREE.BufferAttribute;
    posAttr.setXYZ(0, surfaceVec.x, surfaceVec.y, surfaceVec.z);
    posAttr.setXYZ(1, tipVec.x, tipVec.y, tipVec.z);
    posAttr.needsUpdate = true;

    // A slow, looping radar-ping: the ring expands outward across the
    // ground from the pin and fades out, then resets — continuous, ambient
    // motion that helps a single small marker catch the eye among
    // thousands of satellites without being distracting.
    const t = (state.clock.elapsedTime % PING_PERIOD_SEC) / PING_PERIOD_SEC;
    const ringRadius = RING_MIN_RADIUS + (RING_MAX_RADIUS - RING_MIN_RADIUS) * t;
    ringMeshRef.current?.scale.setScalar(ringRadius);
    if (ringMaterialRef.current) ringMaterialRef.current.opacity = 0.8 * (1 - t);
  });

  return (
    <group ref={groupRef} visible={false}>
      <mesh ref={pinRef}>
        <sphereGeometry args={[OBSERVER_MARKER_RADIUS, 16, 12]} />
        <meshBasicMaterial color={emissiveColor} toneMapped={false} />
      </mesh>
      <primitive object={beaconLine} />
      <group ref={ringAnchorRef}>
        <mesh ref={ringMeshRef}>
          <ringGeometry args={[0.72, 1, 40]} />
          <meshBasicMaterial
            ref={ringMaterialRef}
            color={emissiveColor}
            transparent
            opacity={0.8}
            side={THREE.DoubleSide}
            toneMapped={false}
            depthWrite={false}
          />
        </mesh>
      </group>
    </group>
  );
}
