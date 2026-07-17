import { describe, it, expect } from 'vitest';
import {
  detectSignalLoss,
  detectImpact,
  detectBatteryAnomaly,
  detectErraticFlight,
  detectLoiter,
  detectAltitudeLoss,
  runDetectionEngine,
} from './detectionEngine.js';
import { buildNominalFlight, offsetLatLon } from './testFixtures.js';

// Builds `count` readings `intervalS` seconds apart (rather than the fixed
// 1s of buildNominalFlight) so rules can be checked at other sample rates —
// a real MAVROS setpoint stream is commonly ~50Hz, versus this app's ~1Hz
// synthetic samples.
function buildFlightAtRate(count, intervalS, overrides = () => ({})) {
  const start = new Date('2026-01-01T10:00:00Z').getTime();
  const rows = [];
  let lat = 37.7749;
  let lon = -122.4194;
  for (let i = 0; i < count; i++) {
    const row = {
      timestamp: new Date(start + i * intervalS * 1000).toISOString(),
      lat,
      lon,
      altitude_m: 50,
      speed_mps: 8,
      satellite_count: 10,
      heading_deg: 0,
    };
    Object.assign(row, overrides(i, row));
    rows.push(row);
  }
  return rows;
}

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

  it('does not fire on a quantized/staged position stream sampled much faster than it updates', () => {
    // Mirrors a real commanded-setpoint log: the target position only steps
    // every ~10 readings while the log itself samples at 50Hz, so most
    // consecutive rows repeat the same value and then jump by a small,
    // physically real step. A naive single-row delta divides that step by a
    // near-zero dt and looks like hundreds of m/s; this must not fire.
    const rows = buildFlightAtRate(1000, 0.02, (i) => {
      const step = Math.floor(i / 10); // one 1.6m step every 10 readings (~0.2s)
      const moved = offsetLatLon(37.7749, -122.4194, 0, step * 1.6);
      return { lat: moved.lat, lon: moved.lon };
    });
    expect(detectErraticFlight(rows)).toHaveLength(0);
  });

  it('does not misfire from too little elapsed time at the very start of a fast-sampled log', () => {
    // The first few readings of a 50Hz log haven't accumulated a full
    // smoothing window yet; a tiny real position change should not be judged
    // implausible just because dt is still small.
    const rows = buildFlightAtRate(50, 0.02, (i, row) => {
      const moved = offsetLatLon(row.lat, row.lon, 0, 0.05); // 2.5 m/s, entirely plausible
      return moved;
    });
    expect(detectErraticFlight(rows)).toHaveLength(0);
  });

  it('still fires on a genuine large jump sustained over a full second, even at 50Hz', () => {
    const rows = buildFlightAtRate(200, 0.02, (i, row) => {
      if (i === 100) {
        const jumped = offsetLatLon(row.lat, row.lon, 0, 400); // 400m in one row
        return jumped;
      }
      return {};
    });
    const events = detectErraticFlight(rows);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe('erratic_flight');
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
  it('reports no anomaly and 0/6 confidence on a clean flight', () => {
    const rows = buildNominalFlight(60);
    const result = runDetectionEngine(rows);
    expect(result.events).toHaveLength(0);
    expect(result.rootCause).toBe('none');
    expect(result.confidenceLabel).toBe('0/6');
  });

  it('agrees on "signal_jammed" when signal_loss and erratic_flight both fire', () => {
    const rows = buildNominalFlight(60, (i) => {
      if (i >= 20 && i < 26) return { satellite_count: 0, heading_deg: (i * 90) % 360 };
      return {};
    });
    const result = runDetectionEngine(rows);
    expect(result.confidence.checked).toBe(6);
    expect(result.confidence.agreeing).toBeGreaterThanOrEqual(1);
    expect(['signal_jammed', 'flyaway']).toContain(result.rootCause);
  });

  it('always checks all 6 rules regardless of which fire', () => {
    const rows = buildNominalFlight(60);
    const result = runDetectionEngine(rows);
    expect(Object.keys(result.eventsByType)).toHaveLength(6);
  });
});

describe('runDetectionEngine with a restricted field set', () => {
  it('only checks rules whose fields are present when a CSV lacks most columns', () => {
    // position-only log: satellite_count, altitude_m, speed_mps, battery_pct, heading_deg all absent
    const rows = buildNominalFlight(60).map(({ lat, lon, timestamp }) => ({ lat, lon, timestamp }));
    const result = runDetectionEngine(rows, []);
    expect(result.applicableRules.sort()).toEqual(['erratic_flight', 'loiter'].sort());
    expect(result.skippedRules.sort()).toEqual(
      ['altitude_loss', 'battery_anomaly', 'impact', 'signal_loss'].sort()
    );
    expect(result.confidence.checked).toBe(2);
    expect(result.fieldsUnavailable.sort()).toEqual(
      ['accel_mps2', 'altitude_m', 'battery_pct', 'heading_deg', 'satellite_count', 'speed_mps', 'yaw_rate_dps'].sort()
    );
  });

  it('only runs battery_anomaly (plus the always-on rules) when only battery_pct is present', () => {
    let battery = 100;
    const rows = buildNominalFlight(100, (i) => {
      battery -= i < 90 ? 0.05 : 0.4;
      return { battery_pct: battery };
    }).map(({ lat, lon, timestamp, battery_pct }) => ({ lat, lon, timestamp, battery_pct }));

    const result = runDetectionEngine(rows, ['battery_pct']);
    expect(result.applicableRules.sort()).toEqual(['battery_anomaly', 'erratic_flight', 'loiter'].sort());
    expect(result.confidence.checked).toBe(3);
    expect(result.eventsByType.battery_anomaly.length).toBeGreaterThanOrEqual(1);
    expect(result.eventsByType.signal_loss).toBeUndefined();
    expect(result.rootCause).toBe('battery_failure');
  });

  it('defaults to checking every rule when availableFields is omitted', () => {
    const rows = buildNominalFlight(60);
    const result = runDetectionEngine(rows);
    expect(result.applicableRules).toHaveLength(6);
    expect(result.skippedRules).toHaveLength(0);
    expect(result.fieldsUnavailable).toHaveLength(0);
  });
});

describe('runDetectionEngine with hasPosition=false', () => {
  it('skips erratic_flight and loiter (they need lat/lon) but still checks field-based rules', () => {
    let battery = 100;
    const rows = buildNominalFlight(100, (i) => {
      battery -= i < 90 ? 0.05 : 0.4;
      return { battery_pct: battery, satellite_count: 10 };
    });
    const result = runDetectionEngine(rows, ['battery_pct', 'satellite_count'], false);
    expect(result.applicableRules.sort()).toEqual(['battery_anomaly', 'signal_loss'].sort());
    expect(result.skippedRules.sort()).toEqual(['altitude_loss', 'erratic_flight', 'impact', 'loiter'].sort());
    expect(result.confidence.checked).toBe(2);
  });

  it('defaults hasPosition to true so existing callers keep checking every applicable rule', () => {
    const rows = buildNominalFlight(60);
    const result = runDetectionEngine(rows, undefined);
    expect(result.applicableRules).toContain('erratic_flight');
    expect(result.applicableRules).toContain('loiter');
  });
});

describe('detectAltitudeLoss', () => {
  it('does not fire on a flight holding steady altitude', () => {
    const rows = buildNominalFlight(60);
    expect(detectAltitudeLoss(rows)).toHaveLength(0);
  });

  it('fires on a sustained descent even when it never reaches near-ground altitude', () => {
    // mirrors the real engine-failure dataset this rule was built for: altitude
    // holds at 50m, then descends to ~31m over the final ~16s without recovering
    // or ever reaching near-zero.
    const rows = buildNominalFlight(120, (i) => {
      if (i < 100) return {};
      const t = i - 100;
      return { altitude_m: Math.max(31, 50 - t * 1.2) };
    });
    const events = detectAltitudeLoss(rows);
    expect(events.length).toBeGreaterThanOrEqual(1);
    expect(events[0].type).toBe('altitude_loss');
    expect(events[0].evidence.field).toBe('altitude_m');
  });

  it('does not fire on gentle sinusoidal altitude wobble', () => {
    const rows = buildNominalFlight(120); // altitude_m = 50 + sin(i/10)*2, well under the 8m/8s threshold
    expect(detectAltitudeLoss(rows)).toHaveLength(0);
  });

  it('only fires once for a single sustained descent, not once per reading', () => {
    const rows = buildNominalFlight(120, (i) => {
      if (i < 100) return {};
      const t = i - 100;
      return { altitude_m: Math.max(10, 50 - t * 2) };
    });
    expect(detectAltitudeLoss(rows)).toHaveLength(1);
  });
});

describe('detection rules at a real-world sample rate (~50Hz, not this app\'s 1Hz synthetic data)', () => {
  const INTERVAL_S = 0.02; // 50Hz, matching a typical MAVROS setpoint stream

  it('detectSignalLoss requires 2 real seconds of low satellite_count, not 2 readings', () => {
    // 2 readings at 50Hz is 40ms — nowhere near a real signal loss.
    const rows = buildFlightAtRate(500, INTERVAL_S, (i) =>
      i >= 100 && i < 102 ? { satellite_count: 0 } : { satellite_count: 10 }
    );
    expect(detectSignalLoss(rows)).toHaveLength(0);
  });

  it('detectSignalLoss still fires when satellite_count is actually low for multiple real seconds', () => {
    // 200 readings at 50Hz = 4 real seconds.
    const rows = buildFlightAtRate(500, INTERVAL_S, (i) =>
      i >= 100 && i < 300 ? { satellite_count: 0 } : { satellite_count: 10 }
    );
    const events = detectSignalLoss(rows);
    expect(events.length).toBeGreaterThanOrEqual(1);
  });

  it('detectImpact only looks a few real seconds back for the speed spike, not 3 readings', () => {
    // speed spike 5 real seconds before the near-zero-altitude moment is well
    // outside the 3-second lookback window and should not count; speed is
    // flat (no delta) right at the altitude drop itself.
    const rows = buildFlightAtRate(500, INTERVAL_S, (i) => {
      if (i === 0) return { speed_mps: 20 };
      if (i === 1) return { speed_mps: 8 };
      if (i >= 250) return { altitude_m: 0.5 };
      return {};
    });
    expect(detectImpact(rows)).toHaveLength(0);
  });

  it('detectLoiter requires 15 real seconds circling, not 15 readings (0.3s)', () => {
    const start = new Date('2026-01-01T10:00:00Z').getTime();
    const rows = [];
    // 20 readings at 50Hz spanning only 0.4s — a real loiter takes far longer.
    for (let i = 0; i < 20; i++) {
      const angle = (i / 10) * 2 * Math.PI;
      const { lat, lon } = offsetLatLon(37.7749, -122.4194, Math.sin(angle) * 12, Math.cos(angle) * 12);
      rows.push({
        timestamp: new Date(start + i * INTERVAL_S * 1000).toISOString(),
        lat,
        lon,
        altitude_m: 40,
        speed_mps: 4,
        heading_deg: 0,
      });
    }
    expect(detectLoiter(rows)).toHaveLength(0);
  });
});
