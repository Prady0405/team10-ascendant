// Deterministic rules engine. Pure functions only — no AI, no network, no randomness.
// Each rule scans the parsed telemetry array and returns detected events shaped as:
// { type, timestamp, description, evidence: { field, value, threshold } }

import { haversineDistanceMeters, headingDeltaDeg, centroid, secondsBetween } from './geo.js';

export const RULE_TYPES = [
  'signal_loss',
  'impact',
  'battery_anomaly',
  'erratic_flight',
  'loiter',
];

// Rule 1 — Signal loss: gps_satellites drops below 3 for more than 2 consecutive readings.
export function detectSignalLoss(rows) {
  const THRESHOLD = 3;
  const events = [];
  let runStart = -1;

  const flush = (endExclusive) => {
    const runLength = endExclusive - runStart;
    if (runStart !== -1 && runLength > 2) {
      events.push({
        type: 'signal_loss',
        timestamp: rows[runStart].timestamp,
        description: `Satellite count fell to ${rows[runStart].gps_satellites} and stayed below ${THRESHOLD} for ${runLength} consecutive readings`,
        evidence: {
          field: 'gps_satellites',
          value: rows[runStart].gps_satellites,
          threshold: THRESHOLD,
        },
      });
    }
  };

  for (let i = 0; i < rows.length; i++) {
    if (rows[i].gps_satellites < THRESHOLD) {
      if (runStart === -1) runStart = i;
    } else {
      flush(i);
      runStart = -1;
    }
  }
  flush(rows.length);

  return events;
}

// Rule 2 — Impact/crash: altitude drops to near 0 combined with a sudden speed change
// within a short window preceding it.
export function detectImpact(rows) {
  const ALTITUDE_THRESHOLD_M = 1.0;
  const SPEED_DELTA_THRESHOLD_MPS = 5;
  const WINDOW = 3;
  const events = [];
  let armed = true; // prevents re-firing while altitude stays low after the first hit

  for (let i = 0; i < rows.length; i++) {
    if (rows[i].altitude > ALTITUDE_THRESHOLD_M) {
      armed = true;
      continue;
    }
    if (!armed) continue;

    const start = Math.max(0, i - WINDOW);
    let maxDelta = 0;
    for (let j = start; j < i; j++) {
      maxDelta = Math.max(maxDelta, Math.abs(rows[j + 1].speed - rows[j].speed));
    }

    if (maxDelta >= SPEED_DELTA_THRESHOLD_MPS) {
      events.push({
        type: 'impact',
        timestamp: rows[i].timestamp,
        description: `Altitude reached ${rows[i].altitude.toFixed(1)}m alongside a sudden ${maxDelta.toFixed(1)} m/s speed change in the preceding readings`,
        evidence: {
          field: 'altitude',
          value: rows[i].altitude,
          threshold: ALTITUDE_THRESHOLD_M,
        },
      });
      armed = false;
    }
  }

  return events;
}

// Rule 3 — Battery anomaly: discharge rate over any window exceeds a normal-baseline
// threshold (the flight's own median discharge rate) by 2x or more.
export function detectBatteryAnomaly(rows) {
  const MULTIPLIER = 2;
  const events = [];
  if (rows.length < 2) return events;

  const rates = [];
  for (let i = 1; i < rows.length; i++) {
    const dt = secondsBetween(rows[i - 1].timestamp, rows[i].timestamp);
    if (dt <= 0) continue;
    const dischargeRate = (rows[i - 1].battery - rows[i].battery) / dt; // %/s, positive = draining
    rates.push({ index: i, rate: dischargeRate });
  }
  if (rates.length === 0) return events;

  const sortedRates = rates.map((r) => r.rate).slice().sort((a, b) => a - b);
  const median = sortedRates[Math.floor(sortedRates.length / 2)];
  const baseline = Math.max(median, 0.005); // floor avoids a zero baseline flagging noise
  const threshold = baseline * MULTIPLIER;

  let triggered = false;
  for (const { index, rate } of rates) {
    if (rate > threshold) {
      if (!triggered) {
        events.push({
          type: 'battery_anomaly',
          timestamp: rows[index].timestamp,
          description: `Battery discharged at ${rate.toFixed(3)}%/s — more than ${MULTIPLIER}x the flight's baseline rate of ${baseline.toFixed(3)}%/s`,
          evidence: {
            field: 'battery',
            value: rows[index].battery,
            threshold: Number(threshold.toFixed(4)),
          },
        });
        triggered = true;
      }
    } else {
      triggered = false;
    }
  }

  return events;
}

// Rule 4 — Erratic flight: heading or position changes exceed a plausible physical
// limit between consecutive readings (signature of GPS spoofing / flyaway / loss of control).
export function detectErraticFlight(rows) {
  const MAX_PLAUSIBLE_SPEED_MPS = 25; // generous ceiling for a consumer drone
  const IMPLIED_SPEED_MULTIPLIER = 3; // implied speed beyond this vs. plausible ceiling = a GPS jump, not real flight
  const MAX_HEADING_RATE_DEG_S = 150; // headingDeltaDeg caps at 180, so this must stay below it
  const events = [];
  let triggered = false;

  for (let i = 1; i < rows.length; i++) {
    const dt = secondsBetween(rows[i - 1].timestamp, rows[i].timestamp);
    if (dt <= 0) continue;

    const distance = haversineDistanceMeters(
      rows[i - 1].latitude,
      rows[i - 1].longitude,
      rows[i].latitude,
      rows[i].longitude
    );
    const impliedSpeed = distance / dt;
    const headingRate = headingDeltaDeg(rows[i - 1].yaw, rows[i].yaw) / dt;

    const speedImplausible = impliedSpeed > MAX_PLAUSIBLE_SPEED_MPS * IMPLIED_SPEED_MULTIPLIER;
    const headingImplausible = headingRate > MAX_HEADING_RATE_DEG_S;

    if (speedImplausible || headingImplausible) {
      if (!triggered) {
        const field = speedImplausible ? 'latitude' : 'yaw';
        const value = speedImplausible ? rows[i].latitude : rows[i].yaw;
        const threshold = speedImplausible
          ? MAX_PLAUSIBLE_SPEED_MPS * IMPLIED_SPEED_MULTIPLIER
          : MAX_HEADING_RATE_DEG_S;
        events.push({
          type: 'erratic_flight',
          timestamp: rows[i].timestamp,
          description: speedImplausible
            ? `Position jumped at an implied ${impliedSpeed.toFixed(1)} m/s, beyond any plausible flight speed`
            : `Heading spun at ${headingRate.toFixed(0)} deg/s, beyond any plausible turn rate`,
          evidence: { field, value, threshold },
        });
        triggered = true;
      }
    } else {
      triggered = false;
    }
  }

  return events;
}

// Rule 5 — Loiter pattern: the flight path revisits a small radius repeatedly for an
// extended run of readings (tight loop/circle), as opposed to travelling through.
export function detectLoiter(rows) {
  const RADIUS_M = 20;
  const MIN_READINGS = 15;
  const MIN_PATH_LENGTH_M = RADIUS_M * 2; // must actually move around, not just sit still
  const MERGE_GAP = MIN_READINGS; // runs this close together are one anomaly, split by a skewed boundary window
  const runs = [];

  let i = 0;
  while (i < rows.length - MIN_READINGS) {
    const window = rows.slice(i, i + MIN_READINGS);
    const center = centroid(window);
    const maxDist = Math.max(
      ...window.map((r) => haversineDistanceMeters(center.lat, center.lon, r.latitude, r.longitude))
    );
    let pathLength = 0;
    for (let j = 1; j < window.length; j++) {
      pathLength += haversineDistanceMeters(
        window[j - 1].latitude,
        window[j - 1].longitude,
        window[j].latitude,
        window[j].longitude
      );
    }

    if (maxDist <= RADIUS_M && pathLength >= MIN_PATH_LENGTH_M) {
      let end = i + MIN_READINGS;
      while (
        end < rows.length &&
        haversineDistanceMeters(center.lat, center.lon, rows[end].latitude, rows[end].longitude) <= RADIUS_M
      ) {
        end++;
      }
      runs.push({ start: i, end });
      i = end;
    } else {
      i++;
    }
  }

  const merged = [];
  for (const run of runs) {
    const prev = merged[merged.length - 1];
    if (prev && run.start - prev.end <= MERGE_GAP) {
      prev.end = run.end;
    } else {
      merged.push({ ...run });
    }
  }

  return merged.map(({ start, end }) => ({
    type: 'loiter',
    timestamp: rows[start].timestamp,
    description: `Flight path circled within a ${RADIUS_M}m radius for ${end - start} consecutive readings instead of continuing on course`,
    evidence: { field: 'latitude', value: `${end - start} readings`, threshold: `${MIN_READINGS} readings within ${RADIUS_M}m` },
  }));
}

const RULES = {
  signal_loss: detectSignalLoss,
  impact: detectImpact,
  battery_anomaly: detectBatteryAnomaly,
  erratic_flight: detectErraticFlight,
  loiter: detectLoiter,
};

// Maps each rule type to the root cause(s) it is evidence for. Used to compute the
// confidence fraction: how many independent rules agree on the same root cause.
const ROOT_CAUSE_SUPPORT = {
  signal_loss: ['signal_jammed', 'flyaway'],
  erratic_flight: ['flyaway', 'signal_jammed'],
  impact: ['crash', 'battery_failure'],
  battery_anomaly: ['battery_failure'],
  loiter: ['suspicious_loitering'],
};

export const ROOT_CAUSE_LABELS = {
  signal_jammed: 'GPS signal was jammed or lost',
  flyaway: 'Flyaway — the drone stopped responding to commands',
  crash: 'Impact / crash',
  battery_failure: 'Battery failure led to a forced descent',
  suspicious_loitering: 'Suspicious loitering over a fixed area',
  none: 'No anomaly detected — flight nominal',
};

// Runs every rule against the telemetry and derives a root cause + confidence fraction.
export function runDetectionEngine(rows) {
  const eventsByType = {};
  for (const type of RULE_TYPES) {
    eventsByType[type] = RULES[type](rows);
  }

  const firedTypes = RULE_TYPES.filter((type) => eventsByType[type].length > 0);

  const causeVotes = {};
  for (const type of firedTypes) {
    for (const cause of ROOT_CAUSE_SUPPORT[type]) {
      causeVotes[cause] = (causeVotes[cause] || 0) + 1;
    }
  }

  let rootCause = 'none';
  let agreeingRules = 0;
  for (const [cause, votes] of Object.entries(causeVotes)) {
    if (votes > agreeingRules) {
      rootCause = cause;
      agreeingRules = votes;
    }
  }

  const rulesChecked = RULE_TYPES.length;
  const allEvents = RULE_TYPES.flatMap((type) => eventsByType[type]).sort(
    (a, b) => new Date(a.timestamp) - new Date(b.timestamp)
  );

  return {
    events: allEvents,
    eventsByType,
    rootCause,
    rootCauseLabel: ROOT_CAUSE_LABELS[rootCause],
    confidence: { agreeing: agreeingRules, checked: rulesChecked },
    confidenceLabel: `${agreeingRules}/${rulesChecked}`,
  };
}
