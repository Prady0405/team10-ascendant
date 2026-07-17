// Shared helpers for building synthetic telemetry rows in tests.

const BASE_LAT = 37.7749;
const BASE_LON = -122.4194;
const METERS_PER_DEG_LAT = 111320;

export function offsetLatLon(lat, lon, dNorthM, dEastM) {
  const dLat = dNorthM / METERS_PER_DEG_LAT;
  const dLon = dEastM / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lon: lon + dLon };
}

// Builds `count` one-second-apart rows with steady, plausible values, optionally
// overridden per-index via `overrides(i, row)`.
export function buildNominalFlight(count, overrides = () => ({})) {
  const start = new Date('2026-01-01T10:00:00Z').getTime();
  const rows = [];
  let { lat, lon } = { lat: BASE_LAT, lon: BASE_LON };

  for (let i = 0; i < count; i++) {
    const { lat: nLat, lon: nLon } = offsetLatLon(lat, lon, 3, 1); // ~3.2 m/s drift, plausible
    lat = nLat;
    lon = nLon;

    const row = {
      timestamp: new Date(start + i * 1000).toISOString(),
      lat,
      lon,
      altitude_m: 50 + Math.sin(i / 10) * 2,
      speed_mps: 8 + Math.sin(i / 8),
      battery_pct: 100 - i * 0.05,
      satellite_count: 10,
      heading_deg: (i * 2) % 360,
    };
    Object.assign(row, overrides(i, row));
    rows.push(row);
  }
  return rows;
}
