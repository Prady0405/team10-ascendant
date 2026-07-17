import Papa from 'papaparse';

// Every flight log must have a position and a time — that's the only fixed
// schema. Everything else is analyzed if the column is present and skipped
// if it isn't, since real-world logs don't all carry the same instruments.
const REQUIRED_COLUMNS = ['timestamp', 'lat', 'lon'];
export const OPTIONAL_NUMERIC_FIELDS = ['altitude_m', 'speed_mps', 'battery_pct', 'satellite_count', 'heading_deg'];

export class FlightLogParseError extends Error {}

// Parses raw CSV text into { rows, availableFields }. `availableFields` is the
// subset of OPTIONAL_NUMERIC_FIELDS actually present as columns in this file —
// the detection engine and UI use it to only analyze/display what's really there.
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
  const missing = REQUIRED_COLUMNS.filter((c) => !columns.includes(c));
  if (missing.length > 0) {
    throw new FlightLogParseError(
      `CSV is missing required column(s): ${missing.join(', ')}. Every flight log needs at least timestamp, lat, and lon.`
    );
  }

  const availableFields = OPTIONAL_NUMERIC_FIELDS.filter((f) => columns.includes(f));
  const fieldsToParse = ['lat', 'lon', ...availableFields];

  const rows = data.map((row, i) => {
    const parsed = { timestamp: row.timestamp };
    for (const field of fieldsToParse) {
      const value = Number(row[field]);
      if (Number.isNaN(value)) {
        throw new FlightLogParseError(`Row ${i + 1}: "${field}" is not a number (got "${row[field]}").`);
      }
      parsed[field] = value;
    }
    return parsed;
  });

  return { rows, availableFields };
}
