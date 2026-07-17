import { describe, it, expect } from 'vitest';
import { parseFlightLogCSV, FlightLogParseError } from './csvParser.js';

const HEADER_FULL = 'timestamp,lat,lon,altitude_m,speed_mps,battery_pct,satellite_count,heading_deg';
const ROW_FULL = '2026-01-01T00:00:00Z,37.77,-122.42,50,8,90,10,180';

describe('parseFlightLogCSV', () => {
  it('parses a full-schema CSV with every optional field available', () => {
    const { rows, availableFields, hasPosition, positionSource } = parseFlightLogCSV(`${HEADER_FULL}\n${ROW_FULL}\n`);
    expect(rows).toHaveLength(1);
    expect(hasPosition).toBe(true);
    expect(positionSource).toBe('gps');
    expect(availableFields.sort()).toEqual(
      ['altitude_m', 'battery_pct', 'heading_deg', 'satellite_count', 'speed_mps'].sort()
    );
    expect(rows[0]).toMatchObject({ lat: 37.77, lon: -122.42, altitude_m: 50 });
  });

  it('parses a minimal CSV with only timestamp, lat, lon', () => {
    const { rows, availableFields, hasPosition, positionSource } = parseFlightLogCSV(
      'timestamp,lat,lon\n2026-01-01T00:00:00Z,37.77,-122.42\n'
    );
    expect(rows).toHaveLength(1);
    expect(hasPosition).toBe(true);
    expect(positionSource).toBe('gps');
    expect(availableFields).toEqual([]);
    expect(rows[0]).toEqual({ timestamp: '2026-01-01T00:00:00Z', lat: 37.77, lon: -122.42 });
  });

  it('parses a CSV with only a timestamp — position and everything else absent', () => {
    const { rows, availableFields, hasPosition, positionSource } = parseFlightLogCSV(
      'timestamp,note\n2026-01-01T00:00:00Z,liftoff\n'
    );
    expect(rows).toHaveLength(1);
    expect(hasPosition).toBe(false);
    expect(positionSource).toBeNull();
    expect(availableFields).toEqual([]);
    expect(rows[0]).toEqual({ timestamp: '2026-01-01T00:00:00Z' });
  });

  it('does not throw when only one of lat/lon is present — just leaves position unavailable', () => {
    const { hasPosition, positionSource } = parseFlightLogCSV('timestamp,lat\n2026-01-01T00:00:00Z,37.77\n');
    expect(hasPosition).toBe(false);
    expect(positionSource).toBeNull();
  });

  it('derives lat/lon from a local x/y position frame when there is no GPS column', () => {
    const { rows, hasPosition, positionSource } = parseFlightLogCSV(
      'timestamp,position.x,position.y\n2026-01-01T00:00:00Z,100,200\n'
    );
    expect(hasPosition).toBe(true);
    expect(positionSource).toBe('local');
    // exact placement is arbitrary, but should be a small, real offset near the local origin
    expect(rows[0].lat).toBeGreaterThan(37);
    expect(rows[0].lat).toBeLessThan(38);
    expect(rows[0].lon).toBeGreaterThan(-123);
    expect(rows[0].lon).toBeLessThan(-122);
  });

  it('only reports the optional fields that are actually present as columns', () => {
    const { availableFields } = parseFlightLogCSV(
      'timestamp,lat,lon,altitude_m,speed_mps\n2026-01-01T00:00:00Z,37.77,-122.42,50,8\n'
    );
    expect(availableFields.sort()).toEqual(['altitude_m', 'speed_mps'].sort());
  });

  it('throws when the timestamp column is missing', () => {
    expect(() => parseFlightLogCSV('lat,lon\n37.77,-122.42\n')).toThrow(FlightLogParseError);
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

describe('parseFlightLogCSV with a MAVROS/ROS bag CSV export', () => {
  const ROS_HEADER = [
    '%time',
    'field.header.seq',
    'field.header.stamp',
    'field.header.frame_id',
    'field.coordinate_frame',
    'field.type_mask',
    'field.latitude',
    'field.longitude',
    'field.altitude',
    'field.velocity.x',
    'field.velocity.y',
    'field.velocity.z',
    'field.acceleration_or_force.x',
    'field.acceleration_or_force.y',
    'field.acceleration_or_force.z',
    'field.yaw',
    'field.yaw_rate',
  ].join(',');

  // %time as nanoseconds since epoch, velocity as a 3-4-0 vector (magnitude 5),
  // yaw as pi/2 radians (== 90 degrees heading).
  const ROS_ROW = [
    '1712345678901234567',
    '1',
    '1712345678901234567',
    'map',
    '1',
    '0',
    '37.77',
    '-122.42',
    '55.5',
    '3',
    '4',
    '0',
    '0.1',
    '0.1',
    '0.1',
    (Math.PI / 2).toString(),
    '0.01',
  ].join(',');

  it('recognizes latitude/longitude/altitude columns and reports no battery or satellite data', () => {
    const { rows, availableFields, hasPosition, positionSource } = parseFlightLogCSV(`${ROS_HEADER}\n${ROS_ROW}\n`);
    expect(rows).toHaveLength(1);
    expect(hasPosition).toBe(true);
    expect(positionSource).toBe('gps');
    expect(rows[0].lat).toBe(37.77);
    expect(rows[0].lon).toBe(-122.42);
    expect(rows[0].altitude_m).toBe(55.5);
    expect(availableFields).not.toContain('battery_pct');
    expect(availableFields).not.toContain('satellite_count');
  });

  it('derives speed_mps from the velocity.x/y/z vector', () => {
    const { rows, availableFields } = parseFlightLogCSV(`${ROS_HEADER}\n${ROS_ROW}\n`);
    expect(availableFields).toContain('speed_mps');
    expect(rows[0].speed_mps).toBeCloseTo(5, 5); // sqrt(3^2 + 4^2 + 0^2)
  });

  it('derives heading_deg from yaw in radians', () => {
    const { rows, availableFields } = parseFlightLogCSV(`${ROS_HEADER}\n${ROS_ROW}\n`);
    expect(availableFields).toContain('heading_deg');
    expect(rows[0].heading_deg).toBeCloseTo(90, 5);
  });

  it('converts the nanosecond %time column into a valid, sortable ISO timestamp', () => {
    const { rows } = parseFlightLogCSV(`${ROS_HEADER}\n${ROS_ROW}\n`);
    const parsedDate = new Date(rows[0].timestamp);
    expect(Number.isNaN(parsedDate.getTime())).toBe(false);
    expect(parsedDate.getFullYear()).toBe(2024); // 1712345678901234567 ns -> April 2024
  });
});

describe('parseFlightLogCSV with a local-frame PositionTarget CSV (no GPS)', () => {
  const LOCAL_HEADER = [
    '%time',
    'field.header.seq',
    'field.coordinate_frame',
    'field.position.x',
    'field.position.y',
    'field.position.z',
    'field.velocity.x',
    'field.velocity.y',
    'field.velocity.z',
    'field.yaw',
  ].join(',');
  const LOCAL_ROW = ['1712345678000000000', '1', '1', '10', '20', '5', '1', '0', '0', '0'].join(',');

  it('falls back to the local position.x/y frame and still produces a plottable path', () => {
    const { rows, hasPosition, positionSource, availableFields } = parseFlightLogCSV(`${LOCAL_HEADER}\n${LOCAL_ROW}\n`);
    expect(hasPosition).toBe(true);
    expect(positionSource).toBe('local');
    expect(typeof rows[0].lat).toBe('number');
    expect(typeof rows[0].lon).toBe('number');
    expect(availableFields).toContain('speed_mps');
  });
});
