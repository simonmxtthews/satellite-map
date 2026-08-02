import * as THREE from "three";

// Real photographic imagery (a USGS/Clementine-derived lunar photomap),
// same rationale as Earth's textures (see earthTexture.ts) — the Moon had
// been rendered as a flat, untextured gray marker sharing Earth's generic
// InstancedMesh satellite material; a dedicated textured sphere (see
// components/Moon.tsx) is what actually shows its surface.
export function createMoonTexture(): THREE.Texture {
  const loader = new THREE.TextureLoader();
  const base = import.meta.env.BASE_URL;

  const map = loader.load(`${base}textures/moon.jpg`);
  map.colorSpace = THREE.SRGBColorSpace;
  map.anisotropy = 8;

  return map;
}
