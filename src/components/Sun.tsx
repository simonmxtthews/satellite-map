import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getSunScenePosition, SUN_RADIUS_SCENE } from "../lib/sun";
import { simulatedNow } from "../lib/time";
import { useAppStore } from "../store";

// Pushed well above 1 (HDR) so the Bloom pass (see Scene.tsx) blows it out
// into a glow, the same "emissive intensity" trick used for
// selected/highlighted satellites.
const SUN_COLOR = new THREE.Color("#fff2d0").multiplyScalar(6);

// A true-to-scale Sun disk (~0.65 scene units, see SUN_RADIUS_SCENE) reads
// as a brilliant pinpoint under Bloom, which is realistic but reads as
// "small" up close — real sun glare has soft light bleeding well past the
// disk's geometric edge (atmospheric/lens scatter) rather than a hard bloom
// falloff. This billboarded, additively-blended radial-gradient sprite
// (procedural canvas texture, not a photo — a corona has no fixed surface
// detail to photograph) sits several times wider than the disk and fades
// to fully transparent at its edge, so it adds that soft glow without
// faking the disk's actual apparent size.
function createCoronaTexture(): THREE.Texture {
  const size = 256;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const gradient = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  gradient.addColorStop(0, "rgba(255, 246, 224, 0.9)");
  gradient.addColorStop(0.25, "rgba(255, 238, 200, 0.45)");
  gradient.addColorStop(0.6, "rgba(255, 220, 160, 0.12)");
  gradient.addColorStop(1, "rgba(255, 220, 160, 0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

// Both the light and the visible disk are driven by the same real,
// live-updated solar direction Earth.tsx's day/night terminator uses (see
// src/lib/sun.ts) — so the lit hemisphere of Earth and the rendered
// position of the Sun in the sky can never disagree with each other.
export function Sun() {
  const lightRef = useRef<THREE.DirectionalLight>(null);
  const groupRef = useRef<THREE.Group>(null);
  const coronaTexture = useMemo(() => createCoronaTexture(), []);

  useFrame(() => {
    const offsetMs = useAppStore.getState().timeOffsetMs;
    const pos = getSunScenePosition(simulatedNow(offsetMs));
    lightRef.current?.position.set(...pos);
    groupRef.current?.position.set(...pos);
  });

  return (
    <group>
      <directionalLight ref={lightRef} intensity={2.2} color="#fff6e8" />
      <group ref={groupRef}>
        <mesh>
          <sphereGeometry args={[SUN_RADIUS_SCENE, 24, 16]} />
          <meshBasicMaterial color={SUN_COLOR} toneMapped={false} />
        </mesh>
        <sprite scale={[SUN_RADIUS_SCENE * 9, SUN_RADIUS_SCENE * 9, 1]}>
          <spriteMaterial
            map={coronaTexture}
            color={SUN_COLOR}
            transparent
            depthWrite={false}
            toneMapped={false}
            blending={THREE.AdditiveBlending}
          />
        </sprite>
      </group>
    </group>
  );
}
