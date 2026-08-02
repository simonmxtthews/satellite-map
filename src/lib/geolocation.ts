import type { ObserverLocation } from "./passPrediction";

// Promise wrapper around the callback-based Geolocation API, shared by
// ObserverLocationPanel (the main location control) and PassList (an inline
// "use my location" shortcut when a satellite is selected but no location
// is set yet) so both surfaces stay in sync on error message wording.
export function requestBrowserLocation(): Promise<ObserverLocation> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error("Geolocation isn't available in this browser."));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ latDeg: pos.coords.latitude, lonDeg: pos.coords.longitude, altKm: 0 }),
      (err) => {
        reject(
          new Error(
            err.code === err.PERMISSION_DENIED ? "Location permission denied." : "Couldn't get your location.",
          ),
        );
      },
      { enableHighAccuracy: false, timeout: 10000 },
    );
  });
}
