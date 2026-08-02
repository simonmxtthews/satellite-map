import { useEffect, useRef } from "react";
import { Pause, Play } from "lucide-react";
import { useAppStore } from "../store";
import {
  MAX_TIME_OFFSET_MS,
  PLAYBACK_SPEEDS,
  formatDateTime,
  formatOffset,
  simulatedNow,
} from "../lib/time";

const SPEED_LABELS: Record<number, string> = {
  1: "1×",
  60: "1m/s",
  300: "5m/s",
  1800: "30m/s"
};

export function TimelineScrubber() {
  const playbackSpeed = useAppStore((s) => s.playbackSpeed);
  const speedPreset = useAppStore((s) => s.speedPreset);
  const togglePlayback = useAppStore((s) => s.togglePlayback);
  const setSpeedPreset = useAppStore((s) => s.setSpeedPreset);
  const pausePlayback = useAppStore((s) => s.pausePlayback);

  // The slider position and the offset/date readout are driven imperatively
  // from the rAF loop below rather than through reactive store subscriptions
  // — during playback timeOffsetMs changes every frame, and re-rendering
  // this component (plus re-running formatDateTime's Intl.DateTimeFormat
  // call, which isn't cheap) at 60+fps was stealing main-thread time from
  // the R3F render loop, which is exactly the kind of stutter this timeline
  // exists to let you watch smoothly. Only occasional, user-driven changes
  // (speed preset, play/pause) go through React state.
  const sliderRef = useRef<HTMLInputElement>(null);
  const nowBtnRef = useRef<HTMLButtonElement>(null);
  const offsetTextRef = useRef<HTMLSpanElement>(null);
  const dateTextRef = useRef<HTMLSpanElement>(null);
  const lastBucketRef = useRef<number | null>(null);

  // Playback loop: advances timeOffsetMs at `playbackSpeed` simulated
  // ms-per-real-ms, every animation frame (so Earth's rotation and the
  // camera — both of which re-read the offset fresh each frame — animate
  // smoothly), and auto-pauses at the scrubber's bounds. Satellite marker
  // positions are smoothed separately via client-side velocity
  // extrapolation (see usePropagationWorker/Satellites) rather than by
  // recomputing the full catalog every frame, which would be far too slow.
  // The same loop also pushes the DOM updates described above, throttled to
  // once per displayed minute for the text (the slider thumb still moves
  // every frame — that's a cheap style-only DOM write, not a React render).
  useEffect(() => {
    let raf: number;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = now - last;
      last = now;
      const state = useAppStore.getState();
      if (state.playbackSpeed !== 0) {
        const next = state.timeOffsetMs + dt * state.playbackSpeed;
        if (next >= MAX_TIME_OFFSET_MS) {
          state.setTimeOffsetMs(MAX_TIME_OFFSET_MS);
          state.pausePlayback();
        } else if (next <= -MAX_TIME_OFFSET_MS) {
          state.setTimeOffsetMs(-MAX_TIME_OFFSET_MS);
          state.pausePlayback();
        } else {
          state.setTimeOffsetMs(next);
        }
      }

      const offsetMs = useAppStore.getState().timeOffsetMs;
      if (sliderRef.current) sliderRef.current.value = String(offsetMs);

      const isLive = Math.abs(offsetMs) < 60000;
      if (nowBtnRef.current) {
        nowBtnRef.current.disabled = isLive;
        nowBtnRef.current.textContent = isLive ? "Live" : "Go Live";
      }

      // formatDateTime/formatOffset are minute-resolution — only recompute
      // (and touch the DOM) when the displayed minute actually changes.
      const bucket = Math.floor((Date.now() + offsetMs) / 60000);
      if (bucket !== lastBucketRef.current) {
        lastBucketRef.current = bucket;
        if (offsetTextRef.current) offsetTextRef.current.textContent = formatOffset(offsetMs);
        if (dateTextRef.current) dateTextRef.current.textContent = formatDateTime(simulatedNow(offsetMs));
      }

      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  const isPlaying = playbackSpeed !== 0;

  return (
    <div className="panel timeline-panel">
      <div className="timeline-row">
        <button
          ref={nowBtnRef}
          className="timeline-now-btn"
          onClick={() => {
            pausePlayback();
            useAppStore.getState().setTimeOffsetMs(0);
            lastBucketRef.current = null;
          }}
          disabled={Math.abs(useAppStore.getState().timeOffsetMs) < 60000}
          title="Jump back to real-time"
        >
          {Math.abs(useAppStore.getState().timeOffsetMs) < 60000 ? "Live" : "Go Live"}
        </button>
        <input
          ref={sliderRef}
          className="timeline-slider"
          type="range"
          min={-MAX_TIME_OFFSET_MS}
          max={MAX_TIME_OFFSET_MS}
          step={60000}
          defaultValue={useAppStore.getState().timeOffsetMs}
          onChange={(e) => {
            pausePlayback();
            useAppStore.getState().setTimeOffsetMs(Number(e.target.value));
            lastBucketRef.current = null;
          }}
        />
        <div className="timeline-readout">
          <span ref={offsetTextRef} className="timeline-offset">
            {formatOffset(useAppStore.getState().timeOffsetMs)}
          </span>
          <span ref={dateTextRef} className="timeline-date">
            {formatDateTime(simulatedNow(useAppStore.getState().timeOffsetMs))}
          </span>
        </div>
      </div>
      <div className="timeline-row playback-row">
        <button
          className="playback-btn"
          onClick={togglePlayback}
          aria-label={isPlaying ? "Pause" : "Play"}
          title={isPlaying ? "Pause playback" : "Play simulation forward from the current time"}
        >
          {isPlaying ? <Pause size={12} fill="currentColor" /> : <Play size={12} fill="currentColor" />}
        </button>
        <div className="speed-presets" role="group" aria-label="Playback speed">
          {PLAYBACK_SPEEDS.map((speed) => (
            <button
              key={speed}
              className={speedPreset === speed ? "active" : ""}
              onClick={() => setSpeedPreset(speed)}
            >
              {SPEED_LABELS[speed] ?? `${speed}×`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
