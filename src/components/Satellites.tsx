import { useEffect, useMemo, useRef } from "react";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import * as THREE from "three";
import { useAppStore } from "../store";
import { usePropagationWorker } from "../hooks/usePropagationWorker";
import { getScenePosition } from "../lib/orbits";
import { simulatedNow } from "../lib/time";
import {
  BASE_EMISSIVE_INTENSITY,
  CATEGORY_COLORS,
  DIMMED_OPACITY,
  GM_SCENE,
  HIGHLIGHT_COLOR,
  HIGHLIGHT_EMISSIVE_INTENSITY,
  HOVER_EMISSIVE_INTENSITY,
  SATELLITE_HITBOX_MULTIPLIER,
  SATELLITE_MARKER_RADIUS,
  SATELLITE_MARKER_RADIUS_HIGHLIGHT,
  SELECTED_COLOR,
  SELECTED_EMISSIVE_INTENSITY,
  WORKER_UPDATE_THROTTLE_MS,
} from "../lib/constants";
import type { SatelliteRecord } from "../types";
import type { PropagationBuffer } from "../hooks/usePropagationWorker";

// GPU shader math is 32-bit float, which only has ~7 significant decimal
// digits of precision. Raw epoch milliseconds (~1.7 trillion) blow way past
// that — a time subtraction done in the shader using absolute epoch-based
// values silently collapses to ~0 (accurate only to +/-~2 minutes at that
// magnitude), which is what was actually causing the "stationary, then
// instant jump" motion: the velocity-based smoothing term was rounding
// away to nothing every frame. Rebasing every GPU-bound timestamp relative
// to this fixed origin keeps the numbers small (single/double-digit
// thousands of seconds even after a day of uptime), where float32 is
// precise well beyond what's visually perceptible.
const TIME_ORIGIN_MS = Date.now();

const dummy = new THREE.Object3D();
const color = new THREE.Color();
const baseColorCache = new Map<string, THREE.Color>();
const dimColorCache = new Map<string, THREE.Color>();
const highlightColor = new THREE.Color(HIGHLIGHT_COLOR).multiplyScalar(HIGHLIGHT_EMISSIVE_INTENSITY);
const selectedColor = new THREE.Color(SELECTED_COLOR).multiplyScalar(SELECTED_EMISSIVE_INTENSITY);
const hoverColor = new THREE.Color(HIGHLIGHT_COLOR).multiplyScalar(HOVER_EMISSIVE_INTENSITY);

// Full instanceMatrix/color/velocity refreshes are spread across several
// frames (a "chunk" of satellites at a time) instead of processing all 16k+
// in one synchronous pass. Touching everything at once — even though it's
// cheap per-satellite — adds up to a multi-millisecond hitch on the main
// thread every time the worker delivers new data, which is what actually
// read as "jitter": the per-frame motion math was already smooth (GPU
// extrapolation, see the material below), but the periodic hitch from this
// loop was stalling the whole render loop for a frame every ~150-500ms.
const CHUNKS_PER_CYCLE = 8;

// The GPU extrapolation window (uMaxDt, below) has to cover the worst-case
// simulated-time gap between worker snapshots, which scales with playback
// speed: at speed S the worker refreshes every ~WORKER_UPDATE_THROTTLE_MS of
// REAL time, i.e. every S * WORKER_UPDATE_THROTTLE_MS/1000 SIMULATED
// seconds. A fixed clamp (the old +/-5s) was fine at 1x but at fast-forward
// speeds it cut extrapolation off long before the next snapshot arrived,
// which is what read as "choppy": satellites would freeze mid-gap and then
// snap forward once the new snapshot landed. MIN_MAX_DT_SEC keeps 1x
// playback and paused/live viewing behaving exactly as before; the
// safety factor gives headroom for a snapshot arriving a bit late (a busy
// main thread, a delayed postMessage) without truncating early.
const MIN_MAX_DT_SEC = 5;
const MAX_DT_SAFETY_FACTOR = 3;

// Pointer movement (in CSS pixels) beyond which a pointerdown->click is
// treated as a camera drag rather than an intentional click. See
// pointerDownPos below.
const CLICK_DRAG_THRESHOLD_PX = 6;

function baseColorFor(category: string): THREE.Color {
  let c = baseColorCache.get(category);
  if (!c) {
    c = new THREE.Color(CATEGORY_COLORS[category] ?? CATEGORY_COLORS.Other).multiplyScalar(
      BASE_EMISSIVE_INTENSITY,
    );
    baseColorCache.set(category, c);
  }
  return c;
}

function dimColorFor(category: string): THREE.Color {
  let c = dimColorCache.get(category);
  if (!c) {
    c = baseColorFor(category).clone().multiplyScalar(DIMMED_OPACITY);
    dimColorCache.set(category, c);
  }
  return c;
}

const raycastInverseMatrix = new THREE.Matrix4();
const raycastLocalRay = new THREE.Ray();
const raycastCenter = new THREE.Vector3();
const raycastPoint = new THREE.Vector3();
const raycastSphere = new THREE.Sphere();

// Replaces THREE.InstancedMesh's default (triangle-precise) raycast with a
// cheap manual sphere test at SATELLITE_HITBOX_MULTIPLIER times each
// instance's actual radius — a small visible marker is very hard to land a
// click on otherwise. Reads position/scale directly out of the raw
// instanceMatrix float array (dummy is never rotated, so the diagonal is
// exactly the uniform scale — no need for a full matrix decompose per
// instance), which is also simply less work than the default's per-face
// intersection tests, so this isn't just bigger, it's cheaper too.
function raycastHitbox(this: THREE.InstancedMesh, raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) {
  // Same aggregate-bounding-sphere early-out the default raycast does, so a
  // pointer move far from every satellite (e.g. off into the starfield)
  // still skips the per-instance loop entirely.
  if (this.boundingSphere === null) this.computeBoundingSphere();
  // computeBoundingSphere() always assigns this.boundingSphere — TS just
  // can't narrow a `this.` property across the intervening method call.
  raycastSphere.copy(this.boundingSphere!).applyMatrix4(this.matrixWorld);
  if (!raycaster.ray.intersectsSphere(raycastSphere)) return;

  const count = this.count;
  const arr = this.instanceMatrix.array;

  raycastInverseMatrix.copy(this.matrixWorld).invert();
  raycastLocalRay.copy(raycaster.ray).applyMatrix4(raycastInverseMatrix);

  for (let i = 0; i < count; i++) {
    const o = i * 16;
    const scale = arr[o];
    if (scale <= 0) continue; // culled/invalid instances are scaled to 0
    const radius = scale * SATELLITE_HITBOX_MULTIPLIER;
    raycastCenter.set(arr[o + 12], arr[o + 13], arr[o + 14]);
    const perpDistSq = raycastLocalRay.distanceSqToPoint(raycastCenter);
    if (perpDistSq > radius * radius) continue;

    const distanceAlongRay = raycastCenter.clone().sub(raycastLocalRay.origin).dot(raycastLocalRay.direction);
    if (distanceAlongRay < 0) continue; // sphere is behind the ray origin
    raycastPoint.copy(raycastLocalRay.direction).multiplyScalar(distanceAlongRay).add(raycastLocalRay.origin);
    const worldPoint = raycastPoint.clone().applyMatrix4(this.matrixWorld);

    // THREE.Raycaster sorts all intersections by `distance` ascending and
    // (since handleClick calls stopPropagation) only the first one is ever
    // delivered — so `distance` here isn't really "depth," it's "which
    // candidate wins." With generously oversized hitboxes deliberately
    // overlapping in dense clusters, depth-to-camera is the wrong tiebreak
    // (it'd pick whichever satellite happens to be nearer the viewer, not
    // whichever the cursor is actually most precisely over). Perpendicular
    // distance to the ray — i.e. how dead-on the click was — is what a user
    // actually expects "closest" to mean here.
    intersects.push({
      distance: Math.sqrt(perpDistSq),
      point: worldPoint,
      instanceId: i,
      object: this,
    });
  }
}

interface Props {
  satellites: SatelliteRecord[];
}

export function Satellites({ satellites }: Props) {
  const meshRef = useRef<THREE.InstancedMesh>(null);
  const shaderRef = useRef<{
    uniforms: { uNowSec: { value: number }; uMaxDt: { value: number } };
  } | null>(null);
  // The Moon (always the last entry — see store.ts's setCatalog) isn't a
  // TLE/SGP4 body, so it's excluded from the bulk propagation worker and
  // positioned directly within updateRange below instead.
  const tleSatellites = useMemo(() => satellites.slice(0, -1), [satellites]);
  const bufferRef = usePropagationWorker(tleSatellites);
  const selectedId = useAppStore((s) => s.selectedId);
  const hoveredId = useAppStore((s) => s.hoveredId);
  const highlightedCategories = useAppStore((s) => s.highlightedCategories);
  const searchQuery = useAppStore((s) => s.searchQuery);
  const selectSatellite = useAppStore((s) => s.selectSatellite);
  const setHovered = useAppStore((s) => s.setHovered);

  const searchMatchIds = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (q.length < 2) return null;
    const set = new Set<number>();
    for (const s of satellites) {
      if (s.name.toLowerCase().includes(q) || String(s.id) === q) set.add(s.id);
    }
    return set;
  }, [satellites, searchQuery]);

  // O(1) lookup for the per-frame exact-position override below.
  const satelliteByIdLocal = useMemo(() => {
    const map = new Map<number, SatelliteRecord>();
    for (const s of satellites) map.set(s.id, s);
    return map;
  }, [satellites]);

  // Geometry carries per-instance velocity AND base-time attributes
  // alongside the standard instanceMatrix, so the vertex shader can
  // extrapolate motion every frame on the GPU — see material below. Base
  // time (not a single shared "elapsed" value) matters because updates are
  // chunked across several frames (see below): each satellite's velocity
  // and position are only ever extrapolated relative to the timestamp its
  // OWN data actually corresponds to, so a satellite whose chunk hasn't
  // been refreshed yet keeps extrapolating correctly from where it was
  // instead of snapping to a mismatched global clock.
  const geometry = useMemo(() => {
    const g = new THREE.IcosahedronGeometry(1, 0);
    g.setAttribute(
      "instanceVelocity",
      new THREE.InstancedBufferAttribute(new Float32Array(satellites.length * 3), 3),
    );
    g.setAttribute(
      "instanceBaseTime",
      new THREE.InstancedBufferAttribute(new Float32Array(satellites.length), 1),
    );
    return g;
  }, [satellites.length]);

  // A second full-catalog InstancedMesh purely for a bigger raycast target
  // was tried and dropped — even fully invisible (opacity 0), a duplicate
  // 16k+-instance draw call every frame was measurably too expensive.
  // Instead, `raycast` on the existing visible mesh is overridden below
  // with a cheap manual sphere test (see attachHitboxRaycast) that treats
  // each instance as SATELLITE_HITBOX_MULTIPLIER times its actual rendered
  // radius — no extra geometry, no extra draw call, and actually less work
  // per instance than THREE's default triangle-precise InstancedMesh
  // raycast it replaces.
  const material = useMemo(() => {
    const m = new THREE.MeshBasicMaterial({ toneMapped: true });
    m.onBeforeCompile = (shader) => {
      shader.uniforms.uNowSec = { value: 0 };
      shader.uniforms.uMaxDt = { value: MIN_MAX_DT_SEC };
      shader.vertexShader =
        "attribute vec3 instanceVelocity;\nattribute float instanceBaseTime;\nuniform float uNowSec;\nuniform float uMaxDt;\n" +
        shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        `vec4 mvPosition = vec4( transformed, 1.0 );
#ifdef USE_INSTANCING
	mvPosition = instanceMatrix * mvPosition;
	float dt = clamp( uNowSec - instanceBaseTime, -uMaxDt, uMaxDt );
	// Second-order (two-body/Kepler) extrapolation instead of a straight
	// velocity*dt tangent line: a plain linear projection only stays close
	// to the real SGP4 track for a second or two before visibly cutting the
	// curve of the orbit, which is what forced the old fixed +/-5s clamp.
	// Adding gravitational acceleration (toward Earth's center, from this
	// instance's own current position) bends the extrapolated path to
	// match the true orbit's curvature, which is accurate to well within a
	// marker-width for the many-minutes-long gaps fast playback produces
	// between worker snapshots (see uMaxDt above).
	float rlen = max( length( mvPosition.xyz ), 1e-4 );
	vec3 accel = -${GM_SCENE.toExponential(10)} * mvPosition.xyz / ( rlen * rlen * rlen );
	mvPosition.xyz += instanceVelocity * dt + 0.5 * accel * dt * dt;
#endif
mvPosition = modelViewMatrix * mvPosition;
gl_Position = projectionMatrix * mvPosition;`,
      );
      shaderRef.current = shader as unknown as {
        uniforms: { uNowSec: { value: number }; uMaxDt: { value: number } };
      };
    };
    return m;
  }, []);

  // Per-instance marker scale, recomputed only when selection/highlight
  // state changes (styleDirty) rather than every frame.
  const scaleCache = useRef<Float32Array>(new Float32Array(0));
  if (scaleCache.current.length !== satellites.length) {
    scaleCache.current = new Float32Array(satellites.length).fill(SATELLITE_MARKER_RADIUS);
  }

  const styleDirty = useRef(true);
  useEffect(() => {
    styleDirty.current = true;
  }, [selectedId, hoveredId, highlightedCategories, searchMatchIds]);

  const cursorRef = useRef(0);
  const lastBoundingSphereAtRef = useRef(0);

  function updateRange(
    mesh: THREE.InstancedMesh,
    buf: PropagationBuffer,
    velocityAttr: THREE.InstancedBufferAttribute,
    baseTimeAttr: THREE.InstancedBufferAttribute,
    start: number,
    end: number,
  ) {
    const hasHighlight = highlightedCategories.size > 0;
    const hasSearch = !!searchMatchIds;
    const scales = scaleCache.current;
    const baseTimeSec = (buf.simTime - TIME_ORIGIN_MS) / 1000;

    for (let i = start; i < end; i++) {
      const sat = satellites[i];
      const isSelected = sat.id === selectedId;
      const isHovered = sat.id === hoveredId;
      const isSearchMatch = hasSearch && searchMatchIds!.has(sat.id);
      const isCategoryHighlighted = hasHighlight && highlightedCategories.has(sat.category);
      const emphasized = isSelected || isSearchMatch || isCategoryHighlighted || isHovered;
      const isMoon = sat.bodyType === "moon";
      scales[i] = isMoon
        ? 0
        : emphasized
          ? SATELLITE_MARKER_RADIUS_HIGHLIGHT
          : SATELLITE_MARKER_RADIUS;

      const i3 = i * 3;
      if (isMoon) {
        // Rendered by its own dedicated, properly-lit, textured mesh
        // instead (see components/Moon.tsx) — this instance is kept at
        // zero scale (invisible, and skipped by raycastHitbox's `scale <=
        // 0` check below) purely so the Moon can stay a normal entry in
        // `satellites` for search/category-count/selection bookkeeping.
        dummy.position.set(0, 0, 0);
        dummy.scale.setScalar(0);
        velocityAttr.setXYZ(i, 0, 0, 0);
      } else {
        const isValid = buf.valid.length > i ? buf.valid[i] === 1 : false;
        if (!isValid) {
          dummy.position.set(0, 0, 0);
          dummy.scale.setScalar(0);
          velocityAttr.setXYZ(i, 0, 0, 0);
        } else {
          dummy.position.set(buf.positions[i3], buf.positions[i3 + 1], buf.positions[i3 + 2]);
          dummy.scale.setScalar(scales[i]);
          velocityAttr.setXYZ(i, buf.velocities[i3], buf.velocities[i3 + 1], buf.velocities[i3 + 2]);
        }
      }
      // This satellite's own data is only ever "as of" whatever buf.simTime
      // was at the moment ITS chunk got processed — not whatever the
      // latest global snapshot is by the time all chunks finish. Recording
      // that per-instance is what keeps a not-yet-refreshed satellite
      // extrapolating smoothly forward instead of snapping backward the
      // instant a newer (but not-yet-applied-to-it) snapshot arrives.
      baseTimeAttr.setX(i, baseTimeSec);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);

      if (isSelected) {
        color.copy(selectedColor);
      } else if (isSearchMatch || isCategoryHighlighted) {
        color.copy(highlightColor);
      } else if (isHovered) {
        color.copy(hoverColor);
      } else if (hasHighlight || hasSearch) {
        color.copy(dimColorFor(sat.category));
      } else {
        color.copy(baseColorFor(sat.category));
      }
      mesh.setColorAt(i, color);
    }

    const count = end - start;
    mesh.instanceMatrix.addUpdateRange(start * 16, count * 16);
    mesh.instanceMatrix.needsUpdate = true;
    velocityAttr.addUpdateRange(start * 3, count * 3);
    velocityAttr.needsUpdate = true;
    baseTimeAttr.addUpdateRange(start, count);
    baseTimeAttr.needsUpdate = true;
    if (mesh.instanceColor) {
      mesh.instanceColor.addUpdateRange(start * 3, count * 3);
      mesh.instanceColor.needsUpdate = true;
    }
  }

  useFrame((state) => {
    const mesh = meshRef.current;
    const buf = bufferRef.current;
    if (!mesh) return;
    const velocityAttr = geometry.getAttribute("instanceVelocity") as THREE.InstancedBufferAttribute;
    const baseTimeAttr = geometry.getAttribute("instanceBaseTime") as THREE.InstancedBufferAttribute;
    const n = satellites.length;

    if (styleDirty.current) {
      // Selection/highlight changed: a deliberate, infrequent user action,
      // so a single one-time full pass (not spread out) is fine — and
      // keeps the visual response to clicking instant.
      updateRange(mesh, buf, velocityAttr, baseTimeAttr, 0, n);
      styleDirty.current = false;
      buf.dirty = false;
      cursorRef.current = 0;
    } else if (buf.dirty) {
      const chunkSize = Math.ceil(n / CHUNKS_PER_CYCLE);
      const start = cursorRef.current;
      const end = Math.min(start + chunkSize, n);
      updateRange(mesh, buf, velocityAttr, baseTimeAttr, start, end);
      if (end >= n) {
        buf.dirty = false;
        cursorRef.current = 0;
      } else {
        cursorRef.current = end;
      }
    }

    // InstancedMesh caches an aggregate boundingSphere the first time it's
    // raycast against and never invalidates it as instances move. Recompute
    // periodically (not every update) — it's an O(n) pass itself, and the
    // aggregate envelope barely shifts second to second.
    const now = state.clock.elapsedTime;
    if (now - lastBoundingSphereAtRef.current > 2) {
      mesh.computeBoundingSphere();
      lastBoundingSphereAtRef.current = now;
    }
  });

  // Every frame: advance the shader uniforms that drive GPU-side
  // extrapolation — the current absolute simulated time, and how far a
  // satellite is allowed to extrapolate from its last worker snapshot. This
  // is the only per-frame cost for smooth motion — no per-instance JS loop,
  // no buffer re-upload. Each instance computes its own elapsed time against
  // uNowSec using its own instanceBaseTime (set in updateRange above), so
  // staggered/chunked data refreshes can't cause a mismatch. uMaxDt tracks
  // playbackSpeed so the extrapolation window always covers the worst-case
  // simulated-time gap between worker snapshots at the current speed (see
  // MIN_MAX_DT_SEC/MAX_DT_SAFETY_FACTOR above) instead of truncating it.
  useFrame(() => {
    const shader = shaderRef.current;
    if (!shader) return;
    const { timeOffsetMs, playbackSpeed } = useAppStore.getState();
    const nowMs = Date.now() + timeOffsetMs;
    shader.uniforms.uNowSec.value = (nowMs - TIME_ORIGIN_MS) / 1000;
    const speedDtSec = (Math.abs(playbackSpeed) * WORKER_UPDATE_THROTTLE_MS * MAX_DT_SAFETY_FACTOR) / 1000;
    shader.uniforms.uMaxDt.value = Math.max(MIN_MAX_DT_SEC, speedDtSec);
  });

  // Every frame: pin the selected satellite's rendered marker to the exact
  // same SGP4 computation the camera uses to track it (see CameraRig).
  // Everything else is fine reading from the worker's periodically-
  // refreshed, GPU-extrapolated buffer — but for the one satellite the
  // camera is centering on, any tiny divergence between "where the camera
  // thinks it is" and "where its marker is drawn" reads as a visible
  // wobble, since it's the one thing sitting still on screen to compare
  // against. This is a single-instance update, effectively free.
  useFrame(() => {
    const mesh = meshRef.current;
    if (!mesh || selectedId == null) return;
    const buf = bufferRef.current;
    const index = buf.idIndex.get(selectedId);
    if (index == null) return;
    const sat = satelliteByIdLocal.get(selectedId);
    if (!sat) return;
    const pos = getScenePosition(sat, simulatedNow(useAppStore.getState().timeOffsetMs));
    if (!pos) return;

    mesh.getMatrixAt(index, dummy.matrix);
    dummy.matrix.decompose(dummy.position, dummy.quaternion, dummy.scale);
    dummy.position.set(...pos);
    dummy.updateMatrix();
    mesh.setMatrixAt(index, dummy.matrix);
    mesh.instanceMatrix.addUpdateRange(index * 16, 16);
    mesh.instanceMatrix.needsUpdate = true;

    // The shader still adds instanceVelocity * uElapsedSec on top of
    // whatever's in the instance matrix — zero this instance's velocity so
    // it doesn't double up on top of the exact position set above (the
    // regular chunked pass restores its real velocity once deselected).
    const velocityAttr = geometry.getAttribute("instanceVelocity") as THREE.InstancedBufferAttribute;
    velocityAttr.setXYZ(index, 0, 0, 0);
    velocityAttr.addUpdateRange(index * 3, 3);
    velocityAttr.needsUpdate = true;
  });

  // The browser fires a native "click" after pointerdown+pointerup on the
  // same element regardless of how far the pointer moved in between —
  // OrbitControls doesn't suppress it — so panning the camera (drag,
  // release) was firing this handler exactly like a real click wherever the
  // pointer happened to end up. Tracked at the window level (not on the
  // mesh) so it captures every gesture, including ones that started off any
  // satellite's hitbox; comparing start vs. release position is what tells
  // an actual click apart from a drag that happened to end over a satellite.
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
      if (dx * dx + dy * dy > CLICK_DRAG_THRESHOLD_PX * CLICK_DRAG_THRESHOLD_PX) return; // was a drag, not a click
    }
    if (e.instanceId == null) return;
    const sat = satellites[e.instanceId];
    if (sat) selectSatellite(sat.id, false);
  };

  const handlePointerMove = (e: ThreeEvent<PointerEvent>) => {
    if (e.instanceId == null) return;
    const sat = satellites[e.instanceId];
    if (sat) {
      setHovered(sat.id, { x: e.clientX, y: e.clientY });
      document.body.style.cursor = "pointer";
    }
  };

  const handlePointerOut = () => {
    setHovered(null);
    document.body.style.cursor = "auto";
  };

  // Installed once per mesh instance (recreated only if satellites.length
  // changes) rather than as a `raycast` prop — r3f doesn't have one, and
  // this only needs to run once, not on every render.
  useEffect(() => {
    const mesh = meshRef.current;
    if (!mesh) return;
    mesh.raycast = raycastHitbox;
  }, [satellites.length]);

  return (
    <instancedMesh
      ref={meshRef}
      args={[geometry, material, satellites.length]}
      onClick={handleClick}
      onPointerMove={handlePointerMove}
      onPointerOut={handlePointerOut}
    />
  );
}
