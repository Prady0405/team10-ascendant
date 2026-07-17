import { describe, it, expect } from 'vitest';
import { buildFlightSummary } from './flightSummary.js';
import { runDetectionEngine } from './detectionEngine.js';
import { buildNominalFlight } from './testFixtures.js';

describe('buildFlightSummary', () => {
  it('returns an empty string for an empty flight', () => {
    expect(buildFlightSummary([], null, { availableFields: [], hasPosition: false, positionSource: null })).toBe('');
  });

  it('mentions duration, ground track, and a nominal verdict for a clean flight', () => {
    const rows = buildNominalFlight(60);
    const detection = runDetectionEngine(rows);
    const text = buildFlightSummary(rows, detection, {
      availableFields: ['altitude_m', 'speed_mps', 'battery_pct', 'satellite_count', 'heading_deg'],
      hasPosition: true,
      positionSource: 'gps',
    });
    expect(text).toContain('59s'); // 60 readings, 1s apart -> 59s between first and last
    expect(text).toContain('ground track');
    expect(text).toContain('Altitude ranged from');
    expect(text).toContain('no anomaly');
  });

  it('notes when position came from a local frame, not GPS', () => {
    const rows = buildNominalFlight(30);
    const detection = runDetectionEngine(rows);
    const text = buildFlightSummary(rows, detection, {
      availableFields: [],
      hasPosition: true,
      positionSource: 'local',
    });
    expect(text).toContain('not GPS');
  });

  it('notes when there is no position data at all', () => {
    const rows = buildNominalFlight(30).map(({ timestamp, battery_pct }) => ({ timestamp, battery_pct }));
    const detection = runDetectionEngine(rows, ['battery_pct'], false);
    const text = buildFlightSummary(rows, detection, {
      availableFields: ['battery_pct'],
      hasPosition: false,
      positionSource: null,
    });
    expect(text).toContain('no position data');
  });

  it('states the verdict and confidence fraction when an anomaly is detected', () => {
    const rows = buildNominalFlight(60, (i) => (i >= 20 && i < 26 ? { satellite_count: 0 } : {}));
    const detection = runDetectionEngine(rows);
    const text = buildFlightSummary(rows, detection, {
      availableFields: ['altitude_m', 'speed_mps', 'battery_pct', 'satellite_count', 'heading_deg'],
      hasPosition: true,
      positionSource: 'gps',
    });
    expect(text).toContain(detection.rootCauseLabel);
    expect(text).toContain(`${detection.confidence.agreeing} of ${detection.confidence.checked}`);
  });

  it('lists fields that were absent and not analyzed', () => {
    const rows = buildNominalFlight(30).map(({ timestamp, lat, lon, altitude_m }) => ({
      timestamp,
      lat,
      lon,
      altitude_m,
    }));
    const detection = runDetectionEngine(rows, ['altitude_m'], true);
    const text = buildFlightSummary(rows, detection, {
      availableFields: ['altitude_m'],
      hasPosition: true,
      positionSource: 'gps',
    });
    expect(text).toContain('Not present in this file');
    expect(text).toContain('battery_pct');
  });
});
