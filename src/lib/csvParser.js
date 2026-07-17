import Papa from 'papaparse';

const NUMERIC_FIELDS = ['lat', 'lon', 'altitude_m', 'speed_mps', 'battery_pct', 'satellite_count', 'heading_deg'];
export const REQUIRED_COLUMNS = ['timestamp', ...NUMERIC_FIELDS];

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

  return rows.map((row, i) => {
    const parsed = { timestamp: row.timestamp };
    for (const field of NUMERIC_FIELDS) {
      const value = Number(row[field]);
      if (Number.isNaN(value)) {
        throw new FlightLogParseError(`Row ${i + 1}: "${field}" is not a number (got "${row[field]}").`);
      }
      parsed[field] = value;
    }
    return parsed;
  });
}
