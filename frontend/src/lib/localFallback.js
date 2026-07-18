// Builds a pseudo-investigation with the exact same shape as a backend
// response (raw_data / incidents / ai_summary / health_score), but computed
// entirely client-side via the deterministic rules engine in
// detectionEngine.js. Used only when the FastAPI backend is unreachable —
// same resilience philosophy as the backend's own Gemini fallback
// (services/gemini.py's `_fallback_summary`): never invent a cause, and
// never let the UI break just because one layer is down.

import { runDetectionEngine } from './detectionEngine.js';

const SEVERITY_BY_TYPE = {
  impact: 'critical',
  battery_anomaly: 'critical',
  signal_loss: 'warning',
  erratic_flight: 'warning',
  loiter: 'normal',
};

const TITLE_BY_TYPE = {
  impact: 'Impact / Crash',
  battery_anomaly: 'Battery Anomaly',
  signal_loss: 'GPS Signal Loss',
  erratic_flight: 'Erratic Flight',
  loiter: 'Loiter Pattern Detected',
};

// Mirrors the backend's deterministic TYPE_LIABILITY mapping
// (backend/services/rules.py) so the offline fallback's risk distribution
// uses the same categories/framing as the real pipeline.
const LIABILITY_BY_TYPE = {
  impact: ['structural', 'Structural loss event — root cause requires correlation with preceding incidents'],
  battery_anomaly: ['hardware', 'Warranty claim candidate — abnormal battery discharge rate'],
  signal_loss: ['jamming', 'Exonerates operator — GPS lock lost alongside other degraded telemetry'],
  erratic_flight: ['pilot_error', 'Review operator input — implausible position/heading change'],
};

const RISK_CATEGORIES = ['jamming', 'spoofing', 'hardware', 'pilot_error', 'structural'];

function findTelemetryIndex(rows, timestamp) {
  const index = rows.findIndex((r) => r.timestamp === timestamp);
  return index === -1 ? 0 : index;
}

function toIncident(event, rows, index) {
  const [liabilityCategory, liabilityHint] = LIABILITY_BY_TYPE[event.type] ?? [null, null];
  return {
    id: `local-${index}`,
    type: event.type,
    title: TITLE_BY_TYPE[event.type] ?? event.type,
    severity: SEVERITY_BY_TYPE[event.type] ?? 'warning',
    confidence: 0.75,
    timestamp: event.timestamp,
    telemetry_index: findTelemetryIndex(rows, event.timestamp),
    evidence: [
      {
        parameter: event.evidence.field,
        after_value: event.evidence.value,
        threshold: event.evidence.threshold,
        reason: event.description,
      },
    ],
    liability_category: liabilityCategory,
    liability_hint: liabilityHint,
  };
}

function riskDistributionFor(incidents) {
  const weights = Object.fromEntries(RISK_CATEGORIES.map((c) => [c, 0]));
  for (const incident of incidents) {
    if (incident.liability_category in weights) {
      weights[incident.liability_category] += incident.confidence ?? 0;
    }
  }
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  if (total === 0) return weights;
  return Object.fromEntries(RISK_CATEGORIES.map((c) => [c, Math.round((weights[c] / total) * 1000) / 10]));
}

function healthScoreFor(detection) {
  if (detection.rootCause === 'none') return 100;
  const deduction = detection.events.length * 15 + detection.confidence.agreeing * 10;
  return Math.max(0, Math.min(100, 100 - deduction));
}

export function buildLocalInvestigation(rows, sourceLabel) {
  const detection = runDetectionEngine(rows);
  const incidents = detection.events.map((event, i) => toIncident(event, rows, i));

  const aiSummary = {
    verdict: detection.rootCause === 'none' ? 'No anomaly detected — telemetry is consistent with a nominal flight.' : `${detection.rootCauseLabel}.`,
    chronological_summary: detection.events.map((e) => e.description).join(' '),
    probable_cause:
      detection.rootCause === 'none'
        ? 'No anomalies were found in the telemetry; no cause analysis is needed.'
        : detection.rootCauseLabel,
    recommended_actions: detection.events.length > 0 ? ['Review the incidents and evidence list below for details.'] : [],
    confidence: detection.confidence.checked > 0 ? detection.confidence.agreeing / detection.confidence.checked : 0,
    ai_available: false,
    fallback_reason: 'Backend unreachable — showing client-side deterministic analysis only.',
  };

  return {
    mission: { source: sourceLabel },
    statistics: { risk_distribution: riskDistributionFor(incidents) },
    flight_path: null,
    graphs: null,
    incidents,
    timeline: incidents.map((incident) => ({
      timestamp: incident.timestamp,
      title: incident.title,
      severity: incident.severity,
      linked_incident: incident.id,
    })),
    health_score: healthScoreFor(detection),
    ai_summary: aiSummary,
    raw_data: rows,
    ran_locally: true,
  };
}
