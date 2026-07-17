import { haversineDistanceMeters, secondsBetween } from './geo.js';

function formatDuration(seconds) {
  if (seconds < 60) return `${seconds.toFixed(0)}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return `${minutes}m ${remainingSeconds}s`;
}

// Builds a single plain-English paragraph summarizing the whole flight —
// duration, ground track, whatever telemetry fields this file actually has,
// and the deterministic verdict. Every number here is read straight off the
// parsed rows or the rules engine's own result; nothing is invented.
export function buildFlightSummary(rows, detection, { availableFields, hasPosition, positionSource }) {
  if (!rows || rows.length === 0) return '';

  const first = rows[0];
  const last = rows[rows.length - 1];
  const durationS = secondsBetween(first.timestamp, last.timestamp);

  let opening = `This flight log spans ${formatDuration(durationS)} across ${rows.length.toLocaleString()} telemetry readings`;

  if (hasPosition) {
    let distance = 0;
    for (let i = 1; i < rows.length; i++) {
      distance += haversineDistanceMeters(rows[i - 1].lat, rows[i - 1].lon, rows[i].lat, rows[i].lon);
    }
    const sourceNote = positionSource === 'local' ? ' (plotted from a local position frame, not GPS)' : '';
    opening += `, covering roughly ${distance.toFixed(0)}m of ground track${sourceNote}`;
  } else {
    opening += ', with no position data to plot';
  }
  opening += '.';

  const fieldSentences = [];
  if (availableFields.includes('altitude_m')) {
    const alts = rows.map((r) => r.altitude_m);
    fieldSentences.push(`altitude ranged from ${Math.min(...alts).toFixed(1)}m to ${Math.max(...alts).toFixed(1)}m`);
  }
  if (availableFields.includes('speed_mps')) {
    const speeds = rows.map((r) => r.speed_mps);
    fieldSentences.push(`speed ranged from ${Math.min(...speeds).toFixed(1)} to ${Math.max(...speeds).toFixed(1)} m/s`);
  }
  if (availableFields.includes('battery_pct')) {
    fieldSentences.push(`battery went from ${first.battery_pct.toFixed(0)}% to ${last.battery_pct.toFixed(0)}%`);
  }
  if (availableFields.includes('satellite_count')) {
    const sats = rows.map((r) => r.satellite_count);
    fieldSentences.push(`satellite lock ranged from ${Math.min(...sats)} to ${Math.max(...sats)} satellites`);
  }
  if (availableFields.includes('accel_mps2')) {
    const accels = rows.map((r) => r.accel_mps2);
    fieldSentences.push(`peak acceleration reached ${Math.max(...accels).toFixed(2)} m/s²`);
  }
  if (availableFields.includes('yaw_rate_dps')) {
    const yawRates = rows.map((r) => Math.abs(r.yaw_rate_dps));
    fieldSentences.push(`peak yaw rate reached ${Math.max(...yawRates).toFixed(1)} deg/s`);
  }

  const middle = fieldSentences.length > 0 ? `${capitalize(fieldSentences.join(', '))}.` : '';

  let verdictSentence;
  if (detection.rootCause === 'none') {
    const ruleWord = detection.confidence.checked === 1 ? 'signal' : 'signals';
    verdictSentence = `The deterministic rules engine checked ${detection.confidence.checked} applicable ${ruleWord} against this telemetry and found no anomaly — the flight is consistent with nominal operation.`;
  } else {
    verdictSentence = `The deterministic rules engine's verdict is: ${detection.rootCauseLabel}. ${detection.confidence.agreeing} of ${detection.confidence.checked} applicable signals agree on this cause, derived entirely from the telemetry in this file — never a guess.`;
  }

  let unavailableSentence = '';
  if (detection.fieldsUnavailable.length > 0) {
    unavailableSentence = `Not present in this file, and so not analyzed: ${detection.fieldsUnavailable.join(', ')}.`;
  }

  return [opening, middle, verdictSentence, unavailableSentence].filter(Boolean).join(' ');
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
