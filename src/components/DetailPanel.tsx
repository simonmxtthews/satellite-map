import { useEffect, useState } from "react";
import { Camera, Crosshair, ExternalLink, Move, X } from "lucide-react";
import { useAppStore } from "../store";
import { getLiveInfo } from "../lib/orbits";
import { simulatedNow } from "../lib/time";
import { CATEGORY_COLORS } from "../lib/constants";
import { PassList } from "./PassList";
import type { LiveSatelliteInfo } from "../types";

export function DetailPanel() {
  const selectedId = useAppStore((s) => s.selectedId);
  const satelliteById = useAppStore((s) => s.satelliteById);
  const selectSatellite = useAppStore((s) => s.selectSatellite);
  const cameraMode = useAppStore((s) => s.cameraMode);
  const setCameraMode = useAppStore((s) => s.setCameraMode);
  const [live, setLive] = useState<LiveSatelliteInfo | null>(null);

  const sat = selectedId != null ? satelliteById.get(selectedId) : undefined;

  // Deliberately doesn't depend on timeOffsetMs: during playback that value
  // changes every animation frame, and re-keying this effect on it would
  // tear down and rebuild the interval (plus force a state update) 60
  // times a second. The offset is instead read fresh inside the tick.
  useEffect(() => {
    if (!sat) {
      setLive(null);
      return;
    }
    const update = () => setLive(getLiveInfo(sat, simulatedNow(useAppStore.getState().timeOffsetMs)));
    update();
    // 400ms rather than 1s so the readout still feels responsive while
    // scrubbing/playing, without re-subscribing to every offset tick.
    const timer = setInterval(update, 400);
    return () => clearInterval(timer);
  }, [sat]);

  useEffect(() => {
    if (!sat) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") selectSatellite(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [sat, selectSatellite]);

  if (!sat) return null;

  // The Moon's `id` is a sentinel far outside the real NORAD catalog range
  // (see MOON_RECORD in lib/moon.ts) — it has no CelesTrak/N2YO entry, so
  // these external lookups only make sense for actual tracked satellites.
  const isRealSatellite = sat.bodyType !== "moon";
  const celestrakUrl = `https://celestrak.org/NORAD/elements/gp.php?CATNR=${sat.id}&FORMAT=TLE`;
  const n2yoUrl = `https://www.n2yo.com/satellite/?s=${sat.id}`;

  return (
    <div className="panel detail-panel">
      <button className="close-btn" onClick={() => selectSatellite(null)} aria-label="Close">
        <X size={15} />
      </button>
      <div className="detail-header">
        <span
          className="dot dot-lg"
          style={{ background: CATEGORY_COLORS[sat.category] ?? CATEGORY_COLORS.Other }}
        />
        <h2>{sat.name}</h2>
      </div>
      <div className="detail-category">{sat.category}</div>
      <div className="camera-mode-field">
        <span className="camera-mode-label">
          <Camera size={12} strokeWidth={2.5} />
          Camera
        </span>
        <div className="camera-mode-toggle" role="group" aria-label="Camera mode">
          <button
            className={cameraMode === "fixed" ? "active" : ""}
            onClick={() => setCameraMode("fixed")}
            title="Camera stays locked on this satellite"
          >
            <Crosshair size={13} strokeWidth={2.25} /> Track
          </button>
          <button
            className={cameraMode === "free" ? "active" : ""}
            onClick={() => setCameraMode("free")}
            title="Navigate freely; camera stops tracking this satellite"
          >
            <Move size={13} strokeWidth={2.25} /> Free
          </button>
        </div>
      </div>
      <dl className="detail-grid">
        <dt>NORAD ID</dt>
        <dd>
          {isRealSatellite ? (
            <a
              href={celestrakUrl}
              target="_blank"
              rel="noopener noreferrer"
              title="View this satellite's current orbital elements on CelesTrak"
            >
              {sat.id} <ExternalLink size={11} strokeWidth={2.25} />
            </a>
          ) : (
            sat.id
          )}
        </dd>
        <dt>Inclination</dt>
        <dd>{sat.inclinationDeg.toFixed(2)}°</dd>
        <dt>Apogee</dt>
        <dd>{sat.apogeeKm.toLocaleString()} km</dd>
        <dt>Perigee</dt>
        <dd>{sat.perigeeKm.toLocaleString()} km</dd>
        <dt>Orbital period</dt>
        <dd>{sat.periodMin.toFixed(1)} min</dd>
        {live && (
          <>
            <dt>Latitude</dt>
            <dd>{live.latDeg.toFixed(2)}°</dd>
            <dt>Longitude</dt>
            <dd>{live.lonDeg.toFixed(2)}°</dd>
            <dt>Altitude</dt>
            <dd>{live.altKm.toFixed(0)} km</dd>
            <dt>Speed</dt>
            <dd>{live.speedKmS.toFixed(2)} km/s</dd>
          </>
        )}
      </dl>
      {isRealSatellite && (
        <div className="detail-links">
          <a href={celestrakUrl} target="_blank" rel="noopener noreferrer">
            CelesTrak catalog <ExternalLink size={11} strokeWidth={2.25} />
          </a>
          <a href={n2yoUrl} target="_blank" rel="noopener noreferrer">
            Track on N2YO <ExternalLink size={11} strokeWidth={2.25} />
          </a>
        </div>
      )}
      <PassList sat={sat} />
    </div>
  );
}
