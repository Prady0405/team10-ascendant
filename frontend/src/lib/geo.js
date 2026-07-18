// Pure geometry helpers used by the detection engine. No side effects.

const EARTH_RADIUS_M = 6371000;

export function haversineDistanceMeters(lat1, lon1, lat2, lon2) {
  const toRad = (deg) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_M * c;
}

// Smallest absolute angular difference between two headings, in degrees, 0-180.
export function headingDeltaDeg(a, b) {
  let diff = Math.abs(a - b) % 360;
  if (diff > 180) diff = 360 - diff;
  return diff;
}

export function centroid(points) {
  const lat = points.reduce((sum, p) => sum + p.latitude, 0) / points.length;
  const lon = points.reduce((sum, p) => sum + p.longitude, 0) / points.length;
  return { lat, lon };
}

// Telemetry timestamps are always plain numbers — elapsed seconds since
// mission start — never wall-clock strings, so this is direct subtraction.
export function secondsBetween(tsA, tsB) {
  return tsB - tsA;
}
