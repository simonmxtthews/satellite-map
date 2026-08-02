import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useAppStore } from "../store";
import { getScenePosition } from "../lib/orbits";
import { simulatedNow } from "../lib/time";
import { createMoonTexture } from "../lib/moonTexture";
import { MOON_ID, MOON_RECORD } from "../lib/moon";
import { MOON_RADIUS_SCENE } from "../lib/constants";

// Pointer movement (in CSS pixels) beyond which a pointerdown->click is
// treated as a camera drag rather than an intentional click — same
// threshold/rationale as Satellites.tsx's identical check.
const CLICK_DRAG_THRESHOLD_PX = 6;

// The Moon used to be just another (untextured, flat-colored) instance in
// Satellites.tsx's shared InstancedMesh — cheap, but it meant the one body
// in the scene a real photographic texture would actually read clearly on
// was rendered identically to a 4cm CubeSat marker. It's pulled out into
// its own textured, properly-lit mesh here; Satellites.tsx now force-hides
// its (still-present, for search/filter/selection bookkeeping) instance
// slot instead of drawing it. A MeshStandardMaterial (not Basic, like the
// satellite markers) is deliberate: lit by the scene's real Sun
// directionalLight, the Moon shows an actual day/night phase consistent
// with real solar geometry, instead of a flat unshaded gray ball.
export function Moon() {
  const groupRef = useRef<THREE.Group>(null);
  const texture = useMemo(() => createMoonTexture(), []);
  const selectSatellite = useAppStore((s) => s.selectSatellite);
  const setHovered = useAppStore((s) => s.setHovered);

  useFrame(() => {
    const group = groupRef.current;
    if (!group) return;
    const pos = getScenePosition(MOON_RECORD, simulatedNow(useAppStore.getState().timeOffsetMs));
    if (!pos) return;
    group.position.set(...pos);
    // Real tidal locking: the same hemisphere always faces Earth. Whichever
    // texture longitude happens to map to the sphere's local +Z is what
    // ends up Earth-facing — a possible fixed offset from the true near
    // side, but what actually reads as "correct" here is the *behavior*
    // (a stable face, not one that spins as the Moon orbits), which lookAt
    // guarantees regardless of that offset.
    group.lookAt(0, 0, 0);
  });

  // Mirrors Satellites.tsx's pointerdown-position tracking so a camera drag
  // that happens to end over the Moon doesn't register as a click-to-select.
  const pointerDownPos = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      pointerDownPos.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener("pointerdown", onDown);
    return () => window.removeEventListener("pointerdown", onDown);
  }, []);

  const handleClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const start = pointerDownPos.current;
    if (start) {
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      if (dx * dx + dy * dy > CLICK_DRAG_THRESHOLD_PX * CLICK_DRAG_THRESHOLD_PX) return;
    }
    selectSatellite(MOON_ID, false);
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    setHovered(MOON_ID, { x: e.clientX, y: e.clientY });
    document.body.style.cursor = "pointer";
  };

  const handlePointerOut = () => {
    setHovered(null);
    document.body.style.cursor = "auto";
  };

  return (
    <group ref={groupRef}>
      <mesh
        onClick={handleClick}
        onPointerMove={handlePointerMove}
        onPointerOut={handlePointerOut}
      >
        <sphereGeometry args={[MOON_RADIUS_SCENE, 48, 32]} />
        <meshStandardMaterial map={texture} roughness={1} metalness={0} />
      </mesh>
    </group>
  );
}
