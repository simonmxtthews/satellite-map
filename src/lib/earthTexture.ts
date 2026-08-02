import * as THREE from "three";

export interface EarthTextures {
  map: THREE.Texture;
  nightMap: THREE.Texture;
}

// Real photographic imagery rather than a procedural approximation: a
// cloud-free NASA Blue Marble day map, and NASA's Black Marble night-lights
// composite — actual satellite-observed city-light data (dark background,
// bright only where real settlements are), not synthetic dots. Both are
// standard equirectangular whole-Earth maps, so they share UVs with no
// extra alignment work.
export function createEarthTextures(): EarthTextures {
  const loader = new THREE.TextureLoader();
  const base = import.meta.env.BASE_URL;

  const map = loader.load(`${base}textures/earth-day.jpg`);
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.anisotropy = 8;

  const nightMap = loader.load(`${base}textures/earth-night.png`);
  nightMap.colorSpace = THREE.SRGBColorSpace;
  nightMap.wrapS = THREE.RepeatWrapping;
  nightMap.anisotropy = 8;

  return { map, nightMap };
}
