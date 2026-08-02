import { useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { createEarthTextures } from "../lib/earthTexture";
import { gmstAngle } from "../lib/orbits";
import { getSunSceneDirection } from "../lib/sun";
import { simulatedNow } from "../lib/time";
import { useAppStore } from "../store";

const atmosphereVertex = /* glsl */ `
varying vec3 vNormal;
void main() {
  vNormal = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const atmosphereFragment = /* glsl */ `
varying vec3 vNormal;
void main() {
  float rim = pow(0.62 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 3.0);
  vec3 glow = mix(vec3(0.25, 0.45, 0.9), vec3(0.5, 0.75, 1.0), rim);
  gl_FragColor = vec4(glow, clamp(rim, 0.0, 1.0) * 0.55);
}
`;

export function Earth() {
  const earthRef = useRef<THREE.Mesh>(null);
  const shaderRef = useRef<{ uniforms: { uSunDirection: { value: THREE.Vector3 } } } | null>(null);
  const { map, nightMap } = useMemo(() => createEarthTextures(), []);

  useFrame(() => {
    const offsetMs = useAppStore.getState().timeOffsetMs;
    const date = simulatedNow(offsetMs);

    if (earthRef.current) {
      // Earth spin axis (ECI Z) maps to scene Y; rotate mesh by GMST so the
      // (arbitrary, hand-drawn) surface tracks real sidereal rotation, at
      // the timeline scrubber's simulated time rather than the real clock.
      earthRef.current.rotation.y = gmstAngle(date);
    }

    // Real solar direction for this same instant — this is what actually
    // makes the daylit hemisphere face the Sun and encodes the season
    // (Earth's fixed axial tilt shows up as the Sun's declination varying
    // through the year, which is exactly what getSunSceneDirection
    // computes; nothing about Earth's mesh itself needs to visually "lean,"
    // since its rotation axis already IS the scene's fixed up axis).
    if (shaderRef.current) {
      const [sx, sy, sz] = getSunSceneDirection(date);
      shaderRef.current.uniforms.uSunDirection.value.set(sx, sy, sz);
    }
  });

  const material = useMemo(() => {
    // flatShading is off (unlike the old hand-painted texture, which used it
    // deliberately) because the real photographic map has continuous detail
    // — flat per-facet normals would show as visible faceting across the
    // smooth day/night terminator and lit hemisphere.
    const m = new THREE.MeshStandardMaterial({ map, roughness: 1, metalness: 0 });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uNightMap = { value: nightMap };
      shader.uniforms.uSunDirection = { value: new THREE.Vector3(1, 0, 0) };
      shaderRef.current = shader as unknown as { uniforms: { uSunDirection: { value: THREE.Vector3 } } };
      shader.vertexShader =
        "varying vec3 vWorldNormal;\n" +
        shader.vertexShader.replace(
          "#include <begin_vertex>",
          `#include <begin_vertex>
vWorldNormal = normalize( ( modelMatrix * vec4( normal, 0.0 ) ).xyz );`,
        );
      shader.fragmentShader =
        "uniform sampler2D uNightMap;\nuniform vec3 uSunDirection;\nvarying vec3 vWorldNormal;\n" +
        shader.fragmentShader.replace(
          "#include <emissivemap_fragment>",
          `#include <emissivemap_fragment>
  float sunFacing = dot( normalize( vWorldNormal ), uSunDirection );
  float nightMix = smoothstep( 0.18, -0.12, sunFacing );
  vec3 cityLights = texture2D( uNightMap, vMapUv ).rgb;
  totalEmissiveRadiance += cityLights * nightMix * 1.8;`,
        );
    };
    return m;
  }, [map, nightMap]);

  return (
    <group>
      <mesh ref={earthRef} material={material}>
        <sphereGeometry args={[1, 96, 64]} />
      </mesh>
      <mesh scale={1.05}>
        <sphereGeometry args={[1, 48, 32]} />
        <shaderMaterial
          vertexShader={atmosphereVertex}
          fragmentShader={atmosphereFragment}
          transparent
          depthWrite={false}
          side={THREE.BackSide}
        />
      </mesh>
    </group>
  );
}
