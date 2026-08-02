import { useEffect, useRef } from "react";
import { PROPAGATION_INTERVAL_MS, WORKER_UPDATE_THROTTLE_MS } from "../lib/constants";
import { useAppStore } from "../store";
import type { SatelliteRecord } from "../types";

export interface PropagationBuffer {
  ids: number[];
  idIndex: Map<number, number>;
  positions: Float32Array;
  velocities: Float32Array;
  valid: Uint8Array;
  dirty: boolean;
  // Absolute simulated time (ms) this snapshot was computed at — the
  // baseline for client-side velocity extrapolation each frame.
  simTime: number;
}

export function usePropagationWorker(satellites: SatelliteRecord[]) {
  const bufferRef = useRef<PropagationBuffer>({
    ids: [],
    idIndex: new Map(),
    positions: new Float32Array(0),
    velocities: new Float32Array(0),
    valid: new Uint8Array(0),
    dirty: false,
    simTime: Date.now(),
  });
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    if (satellites.length === 0) return;

    const worker = new Worker(new URL("../workers/propagation.worker.ts", import.meta.url), {
      type: "module",
    });
    workerRef.current = worker;

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;
      if (msg.type === "ready") {
        const idIndex = new Map<number, number>();
        (msg.ids as number[]).forEach((id, i) => idIndex.set(id, i));
        bufferRef.current.ids = msg.ids;
        bufferRef.current.idIndex = idIndex;
      } else if (msg.type === "positions") {
        bufferRef.current.positions = msg.positions;
        bufferRef.current.velocities = msg.velocities;
        bufferRef.current.valid = msg.valid;
        bufferRef.current.simTime = msg.time;
        bufferRef.current.dirty = true;
      }
    };

    worker.postMessage({
      type: "init",
      satellites: satellites.map((s) => ({ id: s.id, line1: s.line1, line2: s.line2 })),
      intervalMs: PROPAGATION_INTERVAL_MS,
    });

    return () => {
      worker.terminate();
      workerRef.current = null;
    };
  }, [satellites]);

  // Push scrubber/playback changes to the worker so it recomputes for the
  // new time context, throttled so rapid changes (dragging, high-speed
  // playback) don't flood it with a full-catalog recompute every animation
  // frame. This polls the store directly on a persistent interval (set up
  // once, on mount) rather than reacting to a timeOffsetMs prop — an
  // effect keyed on a value that changes every animation frame during
  // playback would have its own cleanup cancel-and-reschedule the pending
  // send on every single frame, so the throttled send would never actually
  // fire once playback started.
  useEffect(() => {
    let lastSent: number | null = null;
    const send = () => {
      const offset = useAppStore.getState().timeOffsetMs;
      if (offset === lastSent) return;
      lastSent = offset;
      workerRef.current?.postMessage({ type: "setOffset", offsetMs: offset });
    };
    send();
    const interval = setInterval(send, WORKER_UPDATE_THROTTLE_MS);
    return () => clearInterval(interval);
  }, []);

  return bufferRef;
}
