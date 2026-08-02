import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { useAppStore } from "../store";
import { getScenePosition } from "../lib/orbits";
import { simulatedNow } from "../lib/time";
import { CAMERA_MIN_DISTANCE, CAMERA_MAX_DISTANCE } from "../lib/constants";

interface Props {
  controlsRef: React.RefObject<OrbitControlsImpl | null>;
}

const REFERENCE_DIR = new THREE.Vector3(0, 0, 1);

// Earth always stays centered in view (controls.target is always the
// origin) and the camera's "up" is never touched — it stays the default
// world-up at all times, so horizontal drags always orbit left/right around
// Earth the way users expect, and centering on a satellite never rolls or
// tilts the view. Selecting a satellite (with focus requested) always flies
// the camera to face that satellite at a distance scaled to its own orbital
// radius — zooming out for the Moon, back in for a LEO satellite — so it's
// framed and visible regardless of camera mode. After that fly-to settles,
// "fixed" camera mode keeps the camera orbiting Earth at that distance so
// the selected satellite stays perfectly aligned with Earth's center from
// the camera's point of view, re-asserted every frame so it holds as the
// satellite moves and the timeline is scrubbed. In "free" mode, continuous
// tracking is disabled and the user navigates normally after the initial
// fly-to.
export function CameraRig({ controlsRef }: Props) {
  const focusRequest = useAppStore((s) => s.focusRequest);
  const selectedId = useAppStore((s) => s.selectedId);
  const cameraMode = useAppStore((s) => s.cameraMode);
  const satelliteById = useAppStore((s) => s.satelliteById);
  const { camera } = useThree();
  const animRef = useRef<{
    fromQuat: THREE.Quaternion;
    toQuat: THREE.Quaternion;
    fromDistance: number;
    toDistance: number;
    t: number;
  } | null>(null);

  useEffect(() => {
    if (!focusRequest || !controlsRef.current) return;
    const sat = satelliteById.get(focusRequest.id);
    if (!sat) return;
    const pos = getScenePosition(sat, simulatedNow(useAppStore.getState().timeOffsetMs));
    if (!pos) return;
    const toVec = new THREE.Vector3(...pos);
    const objectDistance = toVec.length();
    const fromDir = camera.position.clone().normalize();
    const toDir = toVec.clone().normalize();
    // Framed relative to the selected object's own orbital radius — this is
    // what makes the fly-to zoom out for the Moon (~60 Er away) and back in
    // for a nearby LEO satellite (~1.1 Er away), rather than only ever
    // pulling back from wherever the camera already was.
    const toDistance = Math.min(CAMERA_MAX_DISTANCE, Math.max(CAMERA_MIN_DISTANCE, objectDistance * 1.3));
    animRef.current = {
      fromQuat: new THREE.Quaternion().setFromUnitVectors(REFERENCE_DIR, fromDir),
      toQuat: new THREE.Quaternion().setFromUnitVectors(REFERENCE_DIR, toDir),
      fromDistance: camera.position.length(),
      toDistance,
      t: 0,
    };
  }, [focusRequest, satelliteById, camera, controlsRef]);

  useFrame((_, delta) => {
    const controls = controlsRef.current;
    if (!controls) return;

    // The fly-to animation plays out regardless of camera mode — selecting a
    // satellite always zooms the scene to its scale. Only the continuous
    // per-frame tracking below (which keeps re-aligning as the satellite
    // moves) is gated to "fixed" mode.
    const anim = animRef.current;
    if (anim) {
      anim.t = Math.min(1, anim.t + delta / 1.2);
      const ease = 1 - Math.pow(1 - anim.t, 3);
      const quat = anim.fromQuat.clone().slerp(anim.toQuat, ease);
      const dir = REFERENCE_DIR.clone().applyQuaternion(quat);
      const distance = anim.fromDistance + (anim.toDistance - anim.fromDistance) * ease;
      controls.target.set(0, 0, 0);
      camera.position.copy(dir.multiplyScalar(distance));
      controls.update();
      if (anim.t >= 1) animRef.current = null;
      return;
    }

    if (cameraMode !== "fixed") return;
    if (selectedId == null) return;
    const sat = satelliteById.get(selectedId);
    if (!sat) return;
    const pos = getScenePosition(sat, simulatedNow(useAppStore.getState().timeOffsetMs));
    if (!pos) return;

    // Distance is read fresh from the camera's current position each frame
    // so the user's scroll-zoom is respected; only the viewing direction is
    // forced to stay aligned with the satellite.
    const distance = camera.position.length();
    const dir = new THREE.Vector3(...pos).normalize();
    controls.target.set(0, 0, 0);
    camera.position.copy(dir.multiplyScalar(distance));
    controls.update();
  });

  return null;
}
