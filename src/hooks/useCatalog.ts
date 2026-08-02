import { useEffect } from "react";
import { useAppStore } from "../store";
import type { SatelliteCatalog } from "../types";

export function useCatalog() {
  const setCatalog = useAppStore((s) => s.setCatalog);
  const setLoadError = useAppStore((s) => s.setLoadError);

  useEffect(() => {
    let cancelled = false;
    fetch(`${import.meta.env.BASE_URL}data/tle.json`)
      .then((res) => {
        if (!res.ok) throw new Error(`Failed to load catalog: HTTP ${res.status}`);
        return res.json() as Promise<SatelliteCatalog>;
      })
      .then((data) => {
        if (!cancelled) setCatalog(data.satellites);
      })
      .catch((err) => {
        if (!cancelled) setLoadError(String(err.message ?? err));
      });
    return () => {
      cancelled = true;
    };
  }, [setCatalog, setLoadError]);
}
