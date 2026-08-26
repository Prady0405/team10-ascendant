// Converts a backend investigation payload (see BlackBox's
// services/summary.py) into the flat `rows` array the replay UI drives
// off of. `raw_data` already uses the backend's native telemetry field
// names (latitude, longitude, altitude, speed, battery, roll, pitch, yaw,
// gps_satellites, signal_strength, acceleration_*), and every other
// component in this app now speaks those same names — this function's
// only real job is computing the couple of derived flags the UI needs
// (whether GPS is present at all, acceleration magnitude for the IMU strip).

export function investigationToRows(investigation) {
  const rawData = investigation?.raw_data ?? [];
  return rawData.map((point) => ({
    ...point,
    acceleration_magnitude:
      point.acceleration_x != null && point.acceleration_y != null && point.acceleration_z != null
        ? Math.sqrt(point.acceleration_x ** 2 + point.acceleration_y ** 2 + point.acceleration_z ** 2)
        : null,
  }));
}

export function hasGpsTrack(rows) {
  return rows.some((r) => r.latitude != null && r.longitude != null);
}

// Formats elapsed-seconds (the backend's timestamp unit — every telemetry
// point is normalized to seconds since mission start, never wall-clock)
// as mm:ss for display.
export function formatElapsed(seconds) {
  if (seconds == null || Number.isNaN(seconds)) return '--:--';
  const total = Math.max(0, Math.round(seconds));
  const mm = Math.floor(total / 60);
  const ss = total % 60;
  return `${String(mm).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
