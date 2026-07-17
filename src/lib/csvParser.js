import Papa from 'papaparse';

// A time column is the only fixed requirement. Position and every other
// field are analyzed if a recognized column is present and skipped if it
// isn't, since real-world logs (this app's own sample schema, MAVROS/ROS
// bag CSV exports, etc.) don't all carry the same columns or units.
export const OPTIONAL_NUMERIC_FIELDS = ['altitude_m', 'speed_mps', 'battery_pct', 'satellite_count', 'heading_deg'];

// A reference origin used only to plot a *local*-frame flight (position.x/y
// in meters, common in ROS PositionTarget-style logs with no GPS) onto the
// map. The absolute location is arbitrary — the path's shape and distances
// are what the detection engine and map actually care about.
const LOCAL_ORIGIN_LAT = 37.8199;
const LOCAL_ORIGIN_LON = -122.4783;
const METERS_PER_DEG_LAT = 111320;

// Column-name aliases for each canonical field, checked in priority order.
// Covers this app's own schema plus common MAVROS/ROS bag CSV export names
// (e.g. a mavros_msgs/PositionTarget topic dumped with `rostopic echo -p`).
const COLUMN_ALIASES = {
  timestamp: ['timestamp', '%time', 'time', 'field.header.stamp'],
  lat: ['lat', 'latitude', 'field.latitude', 'field.lat', 'gps_lat', 'gps_latitude'],
  lon: [
    'lon',
    'lng',
    'long',
    'longitude',
    'field.longitude',
    'field.lon',
    'gps_lon',
    'gps_lng',
    'gps_longitude',
  ],
  altitude_m: ['altitude_m', 'altitude', 'alt', 'field.altitude'],
  battery_pct: ['battery_pct', 'battery', 'battery_percent', 'battery_percentage', 'field.battery_remaining'],
  satellite_count: ['satellite_count', 'satellites', 'num_satellites', 'sats', 'field.satellites_visible'],
  heading_deg: ['heading_deg', 'heading', 'field.heading'],
  speed_mps: ['speed_mps', 'speed', 'ground_speed', 'groundspeed'],
};

// Component columns for fields this app can derive when there's no direct
// column for them — a 3-axis velocity vector implies a scalar speed, a yaw
// angle in radians implies a heading in degrees, and a local x/y position
// (meters from an arbitrary origin, no GPS) implies a plottable lat/lon.
const VELOCITY_COMPONENT_ALIASES = {
  x: ['field.velocity.x', 'velocity_x', 'velocity.x', 'vel_x'],
  y: ['field.velocity.y', 'velocity_y', 'velocity.y', 'vel_y'],
  z: ['field.velocity.z', 'velocity_z', 'velocity.z', 'vel_z'],
};
const LOCAL_POSITION_COMPONENT_ALIASES = {
  x: ['field.position.x', 'position.x', 'position_x', 'local_x', 'pos_x'],
  y: ['field.position.y', 'position.y', 'position_y', 'local_y', 'pos_y'],
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

// Converts local ENU meters (x = east, y = north) into a lat/lon near the
// arbitrary reference origin, purely so a GPS-less local-frame log still has
// something real to plot: the shape and scale of the derived path are exact,
// only its placement on the globe is arbitrary.
function localXYToLatLon(x, y) {
  const lat = LOCAL_ORIGIN_LAT + y / METERS_PER_DEG_LAT;
  const lon = LOCAL_ORIGIN_LON + x / (METERS_PER_DEG_LAT * Math.cos((LOCAL_ORIGIN_LAT * Math.PI) / 180));
  return { lat, lon };
}

// Parses raw CSV text into { rows, availableFields, hasPosition, positionSource }.
// `availableFields` is the subset of OPTIONAL_NUMERIC_FIELDS this file
// provides — directly or derived — which the detection engine and UI use to
// only analyze/display what's really there. `positionSource` is 'gps' when
// real lat/lon columns were found, 'local' when position was derived from a
// local x/y frame, or null when the log has no position data at all.
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
  if (!timestampCol) {
    throw new FlightLogParseError(
      'CSV is missing a required column: timestamp. Every flight log needs at least a time column.'
    );
  }

  const latCol = resolveColumn(columns, COLUMN_ALIASES.lat);
  const lonCol = resolveColumn(columns, COLUMN_ALIASES.lon);
  const hasGpsPosition = Boolean(latCol && lonCol);

  const localXCol = !hasGpsPosition ? resolveColumn(columns, LOCAL_POSITION_COMPONENT_ALIASES.x) : null;
  const localYCol = !hasGpsPosition ? resolveColumn(columns, LOCAL_POSITION_COMPONENT_ALIASES.y) : null;
  const hasLocalPosition = !hasGpsPosition && Boolean(localXCol && localYCol);

  const positionSource = hasGpsPosition ? 'gps' : hasLocalPosition ? 'local' : null;

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

    if (hasGpsPosition) {
      parsed.lat = readNumber(row, latCol, 'lat', i);
      parsed.lon = readNumber(row, lonCol, 'lon', i);
    } else if (hasLocalPosition) {
      const x = readNumber(row, localXCol, 'position.x', i);
      const y = readNumber(row, localYCol, 'position.y', i);
      const derived = localXYToLatLon(x, y);
      parsed.lat = derived.lat;
      parsed.lon = derived.lon;
    }

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

  return { rows, availableFields, hasPosition: positionSource !== null, positionSource };
}
