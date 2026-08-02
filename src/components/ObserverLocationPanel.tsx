import { useState } from "react";
import { MapPin } from "lucide-react";
import { useAppStore } from "../store";
import { requestBrowserLocation } from "../lib/geolocation";

// altKm is left at 0 (sea level) for geolocation and manual entry alike —
// observer altitude only shifts pass timing by fractions of a second at
// LEO ranges, far below the precision this UI displays.
function formatCoord(value: number, positiveLabel: string, negativeLabel: string): string {
  return `${Math.abs(value).toFixed(2)}°${value >= 0 ? positiveLabel : negativeLabel}`;
}

export function ObserverLocationPanel() {
  const observerLocation = useAppStore((s) => s.observerLocation);
  const setObserverLocation = useAppStore((s) => s.setObserverLocation);
  const [editing, setEditing] = useState(false);
  const [latInput, setLatInput] = useState("");
  const [lonInput, setLonInput] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [locating, setLocating] = useState(false);

  const useGeolocation = () => {
    setError(null);
    setLocating(true);
    requestBrowserLocation()
      .then((loc) => {
        setLocating(false);
        setObserverLocation(loc);
        setEditing(false);
      })
      .catch((err: Error) => {
        setLocating(false);
        setError(err.message);
      });
  };

  const submitManual = (e: React.FormEvent) => {
    e.preventDefault();
    const lat = Number(latInput);
    const lon = Number(lonInput);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      setError("Latitude must be between -90 and 90.");
      return;
    }
    if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
      setError("Longitude must be between -180 and 180.");
      return;
    }
    setError(null);
    setObserverLocation({ latDeg: lat, lonDeg: lon, altKm: 0 });
    setEditing(false);
  };

  return (
    <div className="panel location-panel">
      <div className="location-header">
        <span className="location-label">
          <MapPin size={14} strokeWidth={2.25} />
          Your location
        </span>
        {observerLocation && !editing && (
          <button
            className="clear-btn"
            onClick={() => {
              setObserverLocation(null);
              setEditing(false);
            }}
          >
            Clear
          </button>
        )}
      </div>

      {observerLocation && !editing ? (
        <div className="location-current">
          <span>
            {formatCoord(observerLocation.latDeg, "N", "S")}, {formatCoord(observerLocation.lonDeg, "E", "W")}
          </span>
          <button className="location-edit-btn" onClick={() => setEditing(true)}>
            Edit
          </button>
        </div>
      ) : (
        <>
          <button className="location-geo-btn" onClick={useGeolocation} disabled={locating}>
            {locating ? "Locating…" : "Use my location"}
          </button>
          <form className="location-manual" onSubmit={submitManual}>
            <input
              type="number"
              step="any"
              placeholder="Latitude"
              value={latInput}
              onChange={(e) => setLatInput(e.target.value)}
            />
            <input
              type="number"
              step="any"
              placeholder="Longitude"
              value={lonInput}
              onChange={(e) => setLonInput(e.target.value)}
            />
            <button type="submit">Set</button>
          </form>
          {editing && (
            <button className="location-cancel-btn" onClick={() => setEditing(false)}>
              Cancel
            </button>
          )}
        </>
      )}
      {error && <div className="location-error">{error}</div>}
      {!observerLocation && !editing && (
        <p className="location-hint">Set a location to see when satellites will be visible overhead.</p>
      )}
    </div>
  );
}
