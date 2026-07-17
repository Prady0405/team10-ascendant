import Papa from 'papaparse';

// Every flight log must have a position and a time — that's the only fixed
// requirement. Everything else is analyzed if a recognized column is present
// and skipped if it isn't, since real-world logs (this app's own sample
// schema, MAVROS/ROS bag CSV exports, etc.) don't all carry the same columns
// or units.
export const OPTIONAL_NUMERIC_FIELDS = ['altitude_m', 'speed_mps', 'battery_pct', 'satellite_count', 'heading_deg'];

// Column-name aliases for each canonical field, checked in priority order.
// Covers this app's own schema plus common MAVROS/ROS bag CSV export names
// (e.g. a mavros_msgs/PositionTarget topic dumped with `rostopic echo -p`).
const COLUMN_ALIASES = {
  timestamp: ['timestamp', '%time', 'time', 'field.header.stamp'],
  lat: ['lat', 'latitude', 'field.latitude'],
  lon: ['lon', 'lng', 'longitude', 'field.longitude'],
  altitude_m: ['altitude_m', 'altitude', 'alt', 'field.altitude'],
  battery_pct: ['battery_pct', 'battery', 'battery_percent', 'battery_percentage', 'field.battery_remaining'],
  satellite_count: ['satellite_count', 'satellites', 'num_satellites', 'sats', 'field.satellites_visible'],
  heading_deg: ['heading_deg', 'heading', 'field.heading'],
  speed_mps: ['speed_mps', 'speed', 'ground_speed', 'groundspeed'],
};

// Component columns for fields this app can derive when there's no direct
// column for them — a 3-axis velocity vector implies a scalar speed, and a
// yaw angle in radians implies a heading in degrees.
const VELOCITY_COMPONENT_ALIASES = {
  x: ['field.velocity.x', 'velocity_x', 'velocity.x', 'vel_x'],
  y: ['field.velocity.y', 'velocity_y', 'velocity.y', 'vel_y'],
  z: ['field.velocity.z', 'velocity_z', 'velocity.z', 'vel_z'],
};
const YAW_ALIASES = ['field.yaw', 'yaw', 'yaw_rad'];

export class FlightLogParseError extends Error {}

function resolveColumn(columns, candidates) {
  const lower = columns.map((c) => c.toLowerCase());
  for (const candidate of candidates) {
    const idx = lower.indexOf(candidate.toLowerCase());
    if (idx !== -1) return columns[idx];
  }
  return null;
}

// Converts a raw timestamp cell into an ISO8601 string. Handles this app's
// own ISO timestamps as well as ROS bag CSV's `%time` column, which is
// commonly nanoseconds-since-epoch, seconds-since-epoch, or seconds with a
// fractional (nanosecond) remainder depending on the export tool.
function normalizeTimestamp(raw) {
  const str = String(raw).trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(str)) return str;

  const num = Number(str);
  if (Number.isNaN(num)) return str;

  let ms;
  if (str.includes('.')) {
    ms = num * 1000; // seconds.fractional-seconds
  } else if (str.length >= 17) {
    ms = num / 1e6; // nanoseconds since epoch
  } else if (str.length >= 12) {
    ms = num; // already milliseconds since epoch
  } else {
    ms = num * 1000; // seconds since epoch
  }

  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? str : date.toISOString();
}

// Parses raw CSV text into { rows, availableFields }. `availableFields` is the
// subset of OPTIONAL_NUMERIC_FIELDS this file actually provides — directly or
// derived (speed from a velocity vector, heading from a yaw angle) — which the
// detection engine and UI use to only analyze/display what's really there.
export function parseFlightLogCSV(csvText) {
  const result = Papa.parse(csvText.trim(), {
    header: true,
    skipEmptyLines: true,
    dynamicTyping: false,
  });

  if (result.errors.length > 0) {
    throw new FlightLogParseError(`CSV parse error: ${result.errors[0].message}`);
  }

  const data = result.data;
  if (data.length === 0) {
    throw new FlightLogParseError('CSV contains no data rows.');
  }

  const columns = Object.keys(data[0]);

  const timestampCol = resolveColumn(columns, COLUMN_ALIASES.timestamp);
  const latCol = resolveColumn(columns, COLUMN_ALIASES.lat);
  const lonCol = resolveColumn(columns, COLUMN_ALIASES.lon);

  const missing = [];
  if (!timestampCol) missing.push('timestamp');
  if (!latCol) missing.push('lat');
  if (!lonCol) missing.push('lon');
  if (missing.length > 0) {
    throw new FlightLogParseError(
      `CSV is missing required column(s): ${missing.join(', ')}. Every flight log needs at least a timestamp, latitude, and longitude column.`
    );
  }

  const altCol = resolveColumn(columns, COLUMN_ALIASES.altitude_m);
  const battCol = resolveColumn(columns, COLUMN_ALIASES.battery_pct);
  const satCol = resolveColumn(columns, COLUMN_ALIASES.satellite_count);
  const headingCol = resolveColumn(columns, COLUMN_ALIASES.heading_deg);
  const speedCol = resolveColumn(columns, COLUMN_ALIASES.speed_mps);

  const velocityCols = {
    x: resolveColumn(columns, VELOCITY_COMPONENT_ALIASES.x),
    y: resolveColumn(columns, VELOCITY_COMPONENT_ALIASES.y),
    z: resolveColumn(columns, VELOCITY_COMPONENT_ALIASES.z),
  };
  const canDeriveSpeed = !speedCol && velocityCols.x && velocityCols.y && velocityCols.z;

  const yawCol = !headingCol ? resolveColumn(columns, YAW_ALIASES) : null;

  const availableFields = [];
  if (altCol) availableFields.push('altitude_m');
  if (battCol) availableFields.push('battery_pct');
  if (satCol) availableFields.push('satellite_count');
  if (headingCol || yawCol) availableFields.push('heading_deg');
  if (speedCol || canDeriveSpeed) availableFields.push('speed_mps');

  const readNumber = (row, col, label, rowIndex) => {
    const value = Number(row[col]);
    if (Number.isNaN(value)) {
      throw new FlightLogParseError(`Row ${rowIndex + 1}: "${label}" is not a number (got "${row[col]}").`);
    }
    return value;
  };

  const rows = data.map((row, i) => {
    const parsed = { timestamp: normalizeTimestamp(row[timestampCol]) };

    parsed.lat = readNumber(row, latCol, 'lat', i);
    parsed.lon = readNumber(row, lonCol, 'lon', i);
    if (altCol) parsed.altitude_m = readNumber(row, altCol, 'altitude_m', i);
    if (battCol) parsed.battery_pct = readNumber(row, battCol, 'battery_pct', i);
    if (satCol) parsed.satellite_count = readNumber(row, satCol, 'satellite_count', i);

    if (headingCol) {
      parsed.heading_deg = readNumber(row, headingCol, 'heading_deg', i);
    } else if (yawCol) {
      const yawRad = readNumber(row, yawCol, 'yaw', i);
      parsed.heading_deg = ((yawRad * 180) / Math.PI + 360) % 360;
    }

    if (speedCol) {
      parsed.speed_mps = readNumber(row, speedCol, 'speed_mps', i);
    } else if (canDeriveSpeed) {
      const vx = readNumber(row, velocityCols.x, 'velocity.x', i);
      const vy = readNumber(row, velocityCols.y, 'velocity.y', i);
      const vz = readNumber(row, velocityCols.z, 'velocity.z', i);
      parsed.speed_mps = Math.sqrt(vx * vx + vy * vy + vz * vz);
    }

    return parsed;
  });

  return { rows, availableFields };
}
