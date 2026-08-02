import { useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Stars } from "@react-three/drei";
import { EffectComposer, Bloom } from "@react-three/postprocessing";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";
import { Earth } from "./Earth";
import { Moon } from "./Moon";
import { Satellites } from "./Satellites";
import { HoverHitboxRing } from "./HoverHitboxRing";
import { ObserverMarker } from "./ObserverMarker";
import { OrbitPath } from "./OrbitPath";
import { NadirLine } from "./NadirLine";
import { CameraRig } from "./CameraRig";
import { Sun } from "./Sun";
import { useAppStore } from "../store";
import { CAMERA_MIN_DISTANCE, CAMERA_MAX_DISTANCE } from "../lib/constants";

export function Scene() {
  const satellites = useAppStore((s) => s.satellites);
  const selectedId = useAppStore((s) => s.selectedId);
  const satelliteById = useAppStore((s) => s.satelliteById);
  const controlsRef = useRef<OrbitControlsImpl | null>(null);

  const selectedSat = selectedId != null ? satelliteById.get(selectedId) : undefined;

  return (
    <Canvas
      camera={{ position: [0, 2, 4.6], fov: 45, near: 0.001, far: 1000 }}
      gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, toneMappingExposure: 1.1 }}
    >
      <color attach="background" args={["#000000"]} />
      <ambientLight intensity={0.18} color="#dfe8ff" />
      <hemisphereLight args={["#3a4a6b", "#05060a", 0.22]} />
      <Stars radius={160} depth={40} count={4000} factor={2} fade speed={0.4} />
      <Sun />

      <Earth />
      <Moon />
      <ObserverMarker />
      {satellites.length > 0 && <Satellites satellites={satellites} />}
      {satellites.length > 0 && <HoverHitboxRing />}
      {selectedSat && <OrbitPath satellite={selectedSat} />}
      {selectedSat && <NadirLine satellite={selectedSat} />}

      <OrbitControls
        ref={controlsRef}
        enablePan={false}
        minDistance={CAMERA_MIN_DISTANCE}
        maxDistance={CAMERA_MAX_DISTANCE}
        rotateSpeed={0.5}
        zoomSpeed={0.15}
      />
      <CameraRig controlsRef={controlsRef} />

      <EffectComposer>
        <Bloom
          intensity={0.7}
          luminanceThreshold={0.92}
          luminanceSmoothing={0.1}
          mipmapBlur
          radius={0.45}
        />
      </EffectComposer>
    </Canvas>
  );
}
