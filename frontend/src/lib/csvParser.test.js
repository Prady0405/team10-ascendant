import { describe, it, expect } from 'vitest';
import { parseFlightLogCSV, FlightLogParseError } from './csvParser.js';

const BASE_COLUMNS = 'altitude_m,speed_mps,battery_pct,satellite_count,heading_deg';

describe('parseFlightLogCSV — combined coordinates column', () => {
  it('parses a comma-separated coordinates column', () => {
    const csv = `timestamp,coordinates,${BASE_COLUMNS}\n0,"35.6762,139.6503",50,5,100,10,90\n`;
    const rows = parseFlightLogCSV(csv);
    expect(rows[0].latitude).toBeCloseTo(35.6762);
    expect(rows[0].longitude).toBeCloseTo(139.6503);
  });

  it('parses compass-suffixed coordinates (Tehran, Iran)', () => {
    const csv = `timestamp,coordinates,${BASE_COLUMNS}\n0,"35.6892° N, 51.3890° E",50,5,100,10,90\n`;
    const rows = parseFlightLogCSV(csv);
    expect(rows[0].latitude).toBeCloseTo(35.6892);
    expect(rows[0].longitude).toBeCloseTo(51.389);
  });

  it('parses southern/eastern hemisphere coordinates (Sydney, Australia)', () => {
    const csv = `timestamp,coordinates,${BASE_COLUMNS}\n0,"33.8688S,151.2093E",50,5,100,10,90\n`;
    const rows = parseFlightLogCSV(csv);
    expect(rows[0].latitude).toBeCloseTo(-33.8688);
    expect(rows[0].longitude).toBeCloseTo(151.2093);
  });

  it('prefers explicit lat/lon columns over a coordinates column when both exist', () => {
    const csv = `timestamp,lat,lon,coordinates,${BASE_COLUMNS}\n0,10.0,20.0,"99.0,99.0",50,5,100,10,90\n`;
    const rows = parseFlightLogCSV(csv);
    expect(rows[0].latitude).toBe(10.0);
    expect(rows[0].longitude).toBe(20.0);
  });

  it('throws a clear error when neither lat/lon nor coordinates are present', () => {
    const csv = `timestamp,${BASE_COLUMNS}\n0,50,5,100,10,90\n`;
    expect(() => parseFlightLogCSV(csv)).toThrow(FlightLogParseError);
  });
});
