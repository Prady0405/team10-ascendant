import { describe, it, expect } from 'vitest';
import { parseFlightLogCSV, FlightLogParseError } from './csvParser.js';

const HEADER_FULL = 'timestamp,lat,lon,altitude_m,speed_mps,battery_pct,satellite_count,heading_deg';
const ROW_FULL = '2026-01-01T00:00:00Z,37.77,-122.42,50,8,90,10,180';

describe('parseFlightLogCSV', () => {
  it('parses a full-schema CSV with every optional field available', () => {
    const { rows, availableFields } = parseFlightLogCSV(`${HEADER_FULL}\n${ROW_FULL}\n`);
    expect(rows).toHaveLength(1);
    expect(availableFields.sort()).toEqual(
      ['altitude_m', 'battery_pct', 'heading_deg', 'satellite_count', 'speed_mps'].sort()
    );
    expect(rows[0]).toMatchObject({ lat: 37.77, lon: -122.42, altitude_m: 50 });
  });

  it('parses a minimal CSV with only timestamp, lat, lon', () => {
    const { rows, availableFields } = parseFlightLogCSV(
      'timestamp,lat,lon\n2026-01-01T00:00:00Z,37.77,-122.42\n'
    );
    expect(rows).toHaveLength(1);
    expect(availableFields).toEqual([]);
    expect(rows[0]).toEqual({ timestamp: '2026-01-01T00:00:00Z', lat: 37.77, lon: -122.42 });
  });

  it('only reports the optional fields that are actually present as columns', () => {
    const { availableFields } = parseFlightLogCSV(
      'timestamp,lat,lon,altitude_m,speed_mps\n2026-01-01T00:00:00Z,37.77,-122.42,50,8\n'
    );
    expect(availableFields.sort()).toEqual(['altitude_m', 'speed_mps'].sort());
  });

  it('throws when a required column is missing', () => {
    expect(() => parseFlightLogCSV('timestamp,lat\n2026-01-01T00:00:00Z,37.77\n')).toThrow(FlightLogParseError);
  });

  it('throws when a present optional field has a non-numeric value', () => {
    expect(() =>
      parseFlightLogCSV('timestamp,lat,lon,altitude_m\n2026-01-01T00:00:00Z,37.77,-122.42,not-a-number\n')
    ).toThrow(FlightLogParseError);
  });

  it('throws on an empty CSV', () => {
    expect(() => parseFlightLogCSV('timestamp,lat,lon\n')).toThrow(FlightLogParseError);
  });
});
