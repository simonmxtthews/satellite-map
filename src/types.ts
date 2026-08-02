export interface SatelliteRecord {
  id: number;
  name: string;
  category: string;
  // Absent/undefined for non-TLE bodies (currently just the Moon — see
  // bodyType below), whose position comes from a dedicated ephemeris
  // instead of SGP4.
  line1?: string;
  line2?: string;
  inclinationDeg: number;
  apogeeKm: number;
  perigeeKm: number;
  periodMin: number;
  // Present only for bodies whose position isn't computed via SGP4/TLE.
  // Currently just "moon" — see src/lib/moon.ts and the branches in
  // src/lib/orbits.ts.
  bodyType?: "moon";
}

export interface SatelliteCatalog {
  generatedAt: string;
  count: number;
  categoryCounts: Record<string, number>;
  satellites: SatelliteRecord[];
}

export interface LiveSatelliteInfo {
  id: number;
  latDeg: number;
  lonDeg: number;
  altKm: number;
  speedKmS: number;
}
