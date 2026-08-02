import { useEffect, useState } from "react";
import { Radar } from "lucide-react";
import { useAppStore } from "../store";
import { computePasses, compassDirection, type Pass } from "../lib/passPrediction";
import { formatDurationShort } from "../lib/time";
import { requestBrowserLocation } from "../lib/geolocation";
import type { SatelliteRecord } from "../types";

const passTimeFormatter = new Intl.DateTimeFormat(undefined, {
  weekday: "short",
  hour: "numeric",
  minute: "2-digit",
});

interface Props {
  sat: SatelliteRecord;
}

// Only passes classified `visible` (sunlit satellite + dark observer sky,
// see passPrediction.ts) are shown — matching how every real pass predictor
// scopes this, since a geometrically-above-the-horizon pass in broad
// daylight isn't something a user can actually go outside and see.
export function PassList({ sat }: Props) {
  const observerLocation = useAppStore((s) => s.observerLocation);
  const setObserverLocation = useAppStore((s) => s.setObserverLocation);
  const [passes, setPasses] = useState<Pass[] | null>(null);
  const [locating, setLocating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Recomputes only when the selected satellite or observer location
  // changes — not on every timeOffsetMs tick, since passes are relative to
  // real "now" (a forward-looking prediction), not the scrubbed scene time.
  useEffect(() => {
    if (!observerLocation) {
      setPasses(null);
      return;
    }
    setPasses(computePasses(sat, observerLocation));
  }, [sat, observerLocation]);

  if (sat.bodyType === "moon") return null;

  const useGeolocation = () => {
    setError(null);
    setLocating(true);
    requestBrowserLocation()
      .then((loc) => {
        setLocating(false);
        setObserverLocation(loc);
      })
      .catch((err: Error) => {
        setLocating(false);
        setError(err.message);
      });
  };

  return (
    <div className="pass-list">
      <div className="pass-list-header">
        <Radar size={12} strokeWidth={2.5} />
        Upcoming passes
      </div>

      {!observerLocation ? (
        <>
          <p className="pass-list-hint">Set your location to see when this satellite will be visible overhead.</p>
          <button className="location-geo-btn" onClick={useGeolocation} disabled={locating}>
            {locating ? "Locating…" : "Use my location"}
          </button>
          {error && <div className="location-error">{error}</div>}
        </>
      ) : (
        <PassResults passes={passes} />
      )}
    </div>
  );
}

function PassResults({ passes }: { passes: Pass[] | null }) {
  if (passes == null) return <p className="pass-list-hint">Calculating…</p>;

  const visible = passes.filter((p) => p.visible).slice(0, 5);
  if (visible.length === 0) {
    return <p className="pass-list-hint">No visible passes in the next 3 days from your location.</p>;
  }

  return (
    <ul className="pass-items">
      {visible.map((p) => (
        <li key={p.riseTime.getTime()} className="pass-item">
          <div className="pass-item-main">
            <span className="pass-item-time">{passTimeFormatter.format(p.riseTime)}</span>
            <span className="pass-item-elev">{Math.round(p.maxElevationDeg)}° max</span>
          </div>
          <div className="pass-item-sub">
            <span>
              {compassDirection(p.riseAzimuthDeg)} → {compassDirection(p.setAzimuthDeg)}
            </span>
            <span>{formatDurationShort(p.setTime.getTime() - p.riseTime.getTime())}</span>
          </div>
        </li>
      ))}
    </ul>
  );
}
