import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { SatelliteRecord } from "./types";
import { MAX_TIME_OFFSET_MS, PLAYBACK_SPEEDS } from "./lib/time";
import { MOON_RECORD } from "./lib/moon";
import type { ObserverLocation } from "./lib/passPrediction";

export interface FocusRequest {
  id: number;
  nonce: number;
}

export type CameraMode = "fixed" | "free";

interface AppState {
  satellites: SatelliteRecord[];
  satelliteById: Map<number, SatelliteRecord>;
  loading: boolean;
  loadError: string | null;

  selectedId: number | null;
  hoveredId: number | null;
  hoveredPos: { x: number; y: number } | null;
  searchQuery: string;
  highlightedCategories: Set<string>;
  focusRequest: FocusRequest | null;
  // Offset from the real current time, in ms, driven by the timeline
  // scrubber. All orbital propagation reads `Date.now() + timeOffsetMs`
  // instead of the real clock, so satellites (and Earth's rotation) reflect
  // the scrubbed time while the underlying real clock keeps advancing.
  timeOffsetMs: number;
  // 0 = paused. Nonzero = actively playing, advancing timeOffsetMs at this
  // many simulated ms per real ms (e.g. 60 = 1 simulated minute/real second).
  playbackSpeed: number;
  // The speed to resume at when play is pressed; persists across pauses.
  speedPreset: number;
  // "fixed": camera stays locked onto the selected satellite (centered) as
  // it moves / the timeline is scrubbed. "free": tracking is disabled and
  // the user can navigate the scene normally.
  cameraMode: CameraMode;
  // Where pass predictions (src/lib/passPrediction.ts) are computed from.
  // Persisted across sessions (see the `persist` wrapper below) since it's a
  // device-level setting, not session state like everything else here.
  observerLocation: ObserverLocation | null;

  setCatalog: (satellites: SatelliteRecord[]) => void;
  setLoadError: (err: string) => void;
  selectSatellite: (id: number | null, focus?: boolean) => void;
  setHovered: (id: number | null, pos?: { x: number; y: number } | null) => void;
  setSearchQuery: (q: string) => void;
  toggleCategory: (category: string) => void;
  clearCategories: () => void;
  setTimeOffsetMs: (ms: number) => void;
  setCameraMode: (mode: CameraMode) => void;
  togglePlayback: () => void;
  setSpeedPreset: (speed: number) => void;
  pausePlayback: () => void;
  setObserverLocation: (loc: ObserverLocation | null) => void;
}

let focusNonce = 0;

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      satellites: [],
      satelliteById: new Map(),
      loading: true,
      loadError: null,

      selectedId: null,
      hoveredId: null,
      hoveredPos: null,
      searchQuery: "",
      highlightedCategories: new Set(),
      focusRequest: null,
      timeOffsetMs: 0,
      playbackSpeed: 0,
      speedPreset: PLAYBACK_SPEEDS[1],
      cameraMode: "free",
      observerLocation: null,

      setCatalog: (satellites) => {
        // The Moon is appended last, establishing an invariant Satellites.tsx
        // relies on: it's the one entry excluded from the bulk SGP4
        // propagation worker (which can't handle a non-TLE body), so it must
        // always be at a known, fixed position (the end) in this array.
        const withMoon = [...satellites, MOON_RECORD];
        set({
          satellites: withMoon,
          satelliteById: new Map(withMoon.map((s) => [s.id, s])),
          loading: false,
        });
      },
      setLoadError: (err) => set({ loadError: err, loading: false }),

      selectSatellite: (id, focus = false) =>
        set((state) => ({
          selectedId: id,
          // cameraMode is intentionally left as-is: the user's fixed/free choice
          // carries over to the next satellite they select. CameraRig only acts
          // on this focus request if the (possibly-still-free) mode is "fixed".
          focusRequest: focus && id != null ? { id, nonce: ++focusNonce } : state.focusRequest,
        })),
      setHovered: (id, pos = null) => set({ hoveredId: id, hoveredPos: id != null ? pos : null }),
      setSearchQuery: (q) => set({ searchQuery: q }),
      toggleCategory: (category) =>
        set((state) => {
          const next = new Set(state.highlightedCategories);
          if (next.has(category)) next.delete(category);
          else next.add(category);
          return { highlightedCategories: next };
        }),
      clearCategories: () => set({ highlightedCategories: new Set() }),
      setTimeOffsetMs: (ms) =>
        set({ timeOffsetMs: Math.max(-MAX_TIME_OFFSET_MS, Math.min(MAX_TIME_OFFSET_MS, ms)) }),
      togglePlayback: () =>
        set((state) => ({ playbackSpeed: state.playbackSpeed !== 0 ? 0 : state.speedPreset })),
      setSpeedPreset: (speed) =>
        set((state) => ({
          speedPreset: speed,
          // If already playing, changing speed takes effect immediately.
          playbackSpeed: state.playbackSpeed !== 0 ? speed : state.playbackSpeed,
        })),
      pausePlayback: () => set({ playbackSpeed: 0 }),
      setCameraMode: (mode) =>
        set((state) => ({
          cameraMode: mode,
          // Switching back to fixed re-triggers a fly-to so the camera smoothly
          // re-centers on whatever's currently selected.
          focusRequest:
            mode === "fixed" && state.selectedId != null
              ? { id: state.selectedId, nonce: ++focusNonce }
              : state.focusRequest,
        })),
      setObserverLocation: (loc) => set({ observerLocation: loc }),
    }),
    {
      name: "satellite-map-observer-location",
      // Only the observer location is a real device setting worth surviving
      // a reload — everything else here (catalog, selection, playback...) is
      // session state that should reset on refresh like it always has.
      partialize: (state) => ({ observerLocation: state.observerLocation }),
    },
  ),
);
