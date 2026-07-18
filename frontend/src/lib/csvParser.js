import Papa from 'papaparse';

// Maps the flight-log CSV schema onto the backend's native telemetry field
// names, so a row parsed client-side (offline fallback) looks identical to
// a row that came from the backend's `raw_data`. Every display component
// only ever has to know one shape.
const FIELD_MAP = {
  lat: 'latitude',
  lon: 'longitude',
  altitude_m: 'altitude',
  speed_mps: 'speed',
  battery_pct: 'battery',
  satellite_count: 'gps_satellites',
  heading_deg: 'yaw',
};
// lat/lon are handled separately below (a "coordinates" combined column is
// an accepted alternative to them) — every other field is still required,
// same offline-fallback contract as before.
const NUMERIC_FIELDS = Object.keys(FIELD_MAP).filter((f) => f !== 'lat' && f !== 'lon');
export const REQUIRED_COLUMNS = ['timestamp', ...NUMERIC_FIELDS];

const COMBINED_COORDINATE_COLUMNS = [
  'coordinates',
  'coordinate',
  'coords',
  'gps_coordinates',
  'gps_coordinate',
  'gps_position',
  'lat_lon',
  'latlon',
  'position',
];

// Same tolerant token pattern as the backend's parse_combined_coordinates
// (services/utils/helpers.py) — a signed number optionally flanked by a
// compass letter (N/S/E/W) and/or a degree symbol. Two matches, in order,
// are (latitude, longitude); works for any hemisphere.
const COORDINATE_TOKEN_PATTERN = /([NSEWnsew]?)\s*(-?\d+\.?\d*)\s*°?\s*([NSEWnsew]?)/g;

function parseCombinedCoordinates(value) {
  if (value == null) return null;
  const text = String(value).trim();
  if (!text) return null;

  const numbers = [];
  for (const match of text.matchAll(COORDINATE_TOKEN_PATTERN)) {
    const [, prefix, numberStr, suffix] = match;
    if (!numberStr) continue;
    let number = Number(numberStr);
    if (Number.isNaN(number)) continue;
    const direction = (prefix || suffix).toUpperCase();
    if (direction === 'S' || direction === 'W') number = -Math.abs(number);
    else if (direction === 'N' || direction === 'E') number = Math.abs(number);
    numbers.push(number);
    if (numbers.length === 2) break;
  }
  return numbers.length === 2 ? [numbers[0], numbers[1]] : null;
}

export class FlightLogParseError extends Error {}

// Parses raw CSV text into an array of telemetry rows, validating the schema.
// Throws FlightLogParseError with a human-readable message on malformed input.
export function parseFlightLogCSV(csvText) {
  const result = Papa.parse(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (result.errors.length > 0) {
    throw new FlightLogParseError(`CSV parse error: ${result.errors[0].message}`);
  }

  const rows = result.data;
  if (rows.length === 0) {
    throw new FlightLogParseError('CSV contains no data rows.');
  }

  const columns = Object.keys(rows[0]);
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length > 0) {
    throw new FlightLogParseError(`CSV is missing required column(s): ${missing.join(', ')}`);
  }

  const hasSeparateLatLon = columns.includes('lat') && columns.includes('lon');
  const combinedCoordColumn = COMBINED_COORDINATE_COLUMNS.find((c) => columns.includes(c));
  if (!hasSeparateLatLon && !combinedCoordColumn) {
    throw new FlightLogParseError('CSV is missing required column(s): lat, lon (or a combined "coordinates" column)');
  }

  // Timestamps are normalized to elapsed seconds since mission start — same
  // convention the backend uses — so a plain number or an ISO datetime
  // string both work, and every row downstream sees one consistent unit.
  const firstRaw = rows[0].timestamp;
  const firstAsNumber = Number(firstRaw);
  const missionStartMs = Number.isNaN(firstAsNumber) ? new Date(firstRaw).getTime() : null;

  return rows.map((row, i) => {
    const parsed = { source: 'csv-local' };
    const rawTimestamp = row.timestamp;
    const asNumber = Number(rawTimestamp);
    if (!Number.isNaN(asNumber)) {
      parsed.timestamp = asNumber;
    } else {
      const ms = new Date(rawTimestamp).getTime();
      if (Number.isNaN(ms)) {
        throw new FlightLogParseError(`Row ${i + 1}: "timestamp" is not a number or date (got "${rawTimestamp}").`);
      }
      parsed.timestamp = (ms - missionStartMs) / 1000;
    }

    if (hasSeparateLatLon) {
      const lat = Number(row.lat);
      const lon = Number(row.lon);
      if (Number.isNaN(lat) || Number.isNaN(lon)) {
        throw new FlightLogParseError(`Row ${i + 1}: "lat"/"lon" is not a number (got "${row.lat}", "${row.lon}").`);
      }
      parsed.latitude = lat;
      parsed.longitude = lon;
    } else {
      const combined = parseCombinedCoordinates(row[combinedCoordColumn]);
      if (!combined) {
        throw new FlightLogParseError(
          `Row ${i + 1}: could not extract two coordinates from "${combinedCoordColumn}" (got "${row[combinedCoordColumn]}").`
        );
      }
      [parsed.latitude, parsed.longitude] = combined;
    }

    for (const field of NUMERIC_FIELDS) {
      const value = Number(row[field]);
      if (Number.isNaN(value)) {
        throw new FlightLogParseError(`Row ${i + 1}: "${field}" is not a number (got "${row[field]}").`);
      }
      parsed[FIELD_MAP[field]] = value;
    }
    return parsed;
  });
}
