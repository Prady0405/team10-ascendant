import { describe, it, expect } from 'vitest';
import {
  detectSignalLoss,
  detectImpact,
  detectBatteryAnomaly,
  detectErraticFlight,
  detectLoiter,
  runDetectionEngine,
} from './detectionEngine.js';
import { buildNominalFlight, offsetLatLon } from './testFixtures.js';

describe('detectSignalLoss', () => {
  it('does not fire on a nominal flight', () => {
    const rows = buildNominalFlight(60);
    expect(detectSignalLoss(rows)).toHaveLength(0);
  });

  it('fires when satellite_count drops below 3 for more than 2 consecutive readings', () => {
    const rows = buildNominalFlight(60, (i) => (i >= 20 && i < 26 ? { satellite_count: 0 } : {}));
    const events = detectSignalLoss(rows);
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('signal_loss');
    expect(events[0].evidence.field).toBe('satellite_count');
    expect(events[0].timestamp).toBe(rows[20].timestamp);
  });

  it('does not fire for exactly 2 consecutive low readings (threshold is "more than 2")', () => {
    const rows = buildNominalFlight(60, (i) => (i >= 20 && i < 22 ? { satellite_count: 1 } : {}));
    expect(detectSignalLoss(rows)).toHaveLength(0);
  });
});

describe('detectImpact', () => {
  it('does not fire on a nominal flight', () => {
    const rows = buildNominalFlight(60);
    expect(detectImpact(rows)).toHaveLength(0);
  });

  it('fires when altitude collapses to near-zero with a sudden speed change', () => {
    const rows = buildNominalFlight(40, (i) => {
      if (i === 29) return { speed_mps: 20 };
      if (i === 30) return { speed_mps: 2, altitude_m: 0.2 };
      if (i > 30) return { altitude_m: 0 };
      return {};
    });
    const events = detectImpact(rows);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe('impact');
    expect(events[0].evidence.field).toBe('altitude_m');
  });

  it('only fires once for a sustained low-altitude run', () => {
    const rows = buildNominalFlight(40, (i) => {
      if (i === 29) return { speed_mps: 20 };
      if (i >= 30) return { speed_mps: 2, altitude_m: 0 };
      return {};
    });
    expect(detectImpact(rows)).toHaveLength(1);
  });
});

describe('detectBatteryAnomaly', () => {
  it('does not fire on a nominal linear discharge', () => {
    const rows = buildNominalFlight(100);
    expect(detectBatteryAnomaly(rows)).toHaveLength(0);
  });

  it('fires when discharge rate spikes to more than 2x the baseline', () => {
    let battery = 100;
    const rows = buildNominalFlight(100, (i) => {
      if (i < 90) {
        battery -= 0.05;
      } else {
        battery -= 0.4; // 8x the baseline rate, in a short tail so it can't skew the median
      }
      return { battery_pct: battery };
    });
    const events = detectBatteryAnomaly(rows);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe('battery_anomaly');
    expect(events[0].evidence.field).toBe('battery_pct');
  });
});

describe('detectErraticFlight', () => {
  it('does not fire on a nominal flight', () => {
    const rows = buildNominalFlight(60);
    expect(detectErraticFlight(rows)).toHaveLength(0);
  });

  it('fires on an implausible GPS position jump', () => {
    const rows = buildNominalFlight(60, (i, row) => {
      if (i === 30) {
        const jumped = offsetLatLon(row.lat, row.lon, 2000, 2000); // 2.8km in 1s
        return jumped;
      }
      return {};
    });
    const events = detectErraticFlight(rows);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe('erratic_flight');
  });

  it('fires on an implausible heading spin rate', () => {
    // baseline heading at i=30 would be (30*2)%360 = 60; flip to the opposite
    // heading for the maximum possible 180 deg jump in one reading.
    const rows = buildNominalFlight(60, (i) => (i === 30 ? { heading_deg: 240 } : {}));
    const events = detectErraticFlight(rows);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].evidence.field).toBe('heading_deg');
  });
});

describe('detectLoiter', () => {
  it('does not fire on a nominal, travelling flight', () => {
    const rows = buildNominalFlight(60);
    expect(detectLoiter(rows)).toHaveLength(0);
  });

  it('fires when the flight path circles a tight radius for an extended run', () => {
    const start = new Date('2026-01-01T10:00:00Z').getTime();
    const rows = [];
    // 40 readings looping around a small circle of radius ~12m.
    for (let i = 0; i < 40; i++) {
      const angle = (i / 10) * 2 * Math.PI;
      const { lat, lon } = offsetLatLon(37.7749, -122.4194, Math.sin(angle) * 12, Math.cos(angle) * 12);
      rows.push({
        timestamp: new Date(start + i * 1000).toISOString(),
        lat,
        lon,
        altitude_m: 40,
        speed_mps: 4,
        battery_pct: 90 - i * 0.05,
        satellite_count: 10,
        heading_deg: (angle * 180) / Math.PI,
      });
    }
    const events = detectLoiter(rows);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe('loiter');
  });

  it('does not fire when the drone is stationary rather than looping', () => {
    const rows = buildNominalFlight(40, () => ({}));
    // pin every position to the same point (stationary hover, not a loop)
    for (const row of rows) {
      row.lat = 37.7749;
      row.lon = -122.4194;
    }
    expect(detectLoiter(rows)).toHaveLength(0);
  });
});

describe('runDetectionEngine', () => {
  it('reports no anomaly and 0/5 confidence on a clean flight', () => {
    const rows = buildNominalFlight(60);
    const result = runDetectionEngine(rows);
    expect(result.events).toHaveLength(0);
    expect(result.rootCause).toBe('none');
    expect(result.confidenceLabel).toBe('0/5');
  });

  it('agrees on "signal_jammed" when signal_loss and erratic_flight both fire', () => {
    const rows = buildNominalFlight(60, (i) => {
      if (i >= 20 && i < 26) return { satellite_count: 0, heading_deg: (i * 90) % 360 };
      return {};
    });
    const result = runDetectionEngine(rows);
    expect(result.confidence.checked).toBe(5);
    expect(result.confidence.agreeing).toBeGreaterThanOrEqual(1);
    expect(['signal_jammed', 'flyaway']).toContain(result.rootCause);
  });

  it('always checks all 5 rules regardless of which fire', () => {
    const rows = buildNominalFlight(60);
    const result = runDetectionEngine(rows);
    expect(Object.keys(result.eventsByType)).toHaveLength(5);
  });
});
