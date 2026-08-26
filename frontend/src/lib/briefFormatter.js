// Client-side mirror of the backend's services/report.py, used only when
// the backend is unreachable so the "Compile Insurance Brief" button still
// works against a locally-analyzed flight (see localFallback.js).

const RISK_LABELS = {
  jamming: 'External Signal Jamming',
  spoofing: 'GPS Spoofing',
  hardware: 'Power/Hardware Malfunction',
  pilot_error: 'Operator Input Exceedance',
  structural: 'Structural/Impact Event',
};

function fmt(value, unit = '', precision = 1) {
  if (value == null) return 'N/A';
  if (typeof value === 'number') return `${value.toFixed(precision)}${unit}`;
  return `${value}${unit}`;
}

function formatRiskDistribution(distribution) {
  if (!distribution || !Object.values(distribution).some((v) => v > 0)) {
    return '  No liability-relevant signature detected in this telemetry.';
  }
  const lines = Object.entries(distribution)
    .filter(([, value]) => value > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([category, value]) => `  - ${RISK_LABELS[category] ?? category}: ${value.toFixed(1)}%`);
  return lines.join('\n');
}

function formatIncidentLine(incident, position) {
  const reason = incident.evidence?.[0]?.reason ?? '';
  const confidence = typeof incident.confidence === 'number' ? `, ${Math.round(incident.confidence * 100)}% confidence` : '';
  let line =
    `  ${position}. [T+${Math.round(incident.timestamp)}s | telemetry index ${incident.telemetry_index}] ` +
    `${incident.severity?.toUpperCase()}${confidence} — ${incident.title}\n` +
    `     Evidence: ${reason}`;
  if (incident.liability_hint) {
    line += `\n     Liability framing: ${incident.liability_hint}`;
  }
  return line;
}

function formatIntegrity(integrity) {
  if (!integrity) return '  Not available for this investigation.';
  const lines = [
    `  Algorithm: ${integrity.algorithm ?? 'N/A'}`,
    `  Telemetry fingerprint (SHA-256): ${integrity.data_sha256 ?? 'N/A'}`,
  ];
  if (integrity.source_file_sha256) {
    lines.push(`  Source file fingerprint (SHA-256): ${integrity.source_file_sha256}`);
    lines.push(`  Source file size: ${integrity.source_file_bytes ?? 'N/A'} bytes`);
  }
  lines.push(`  Points hashed: ${integrity.point_count ?? 'N/A'}`);
  lines.push(`  Computed: ${integrity.computed_at ?? 'N/A'}`);
  lines.push(
    '  This fingerprint is reproducible: rehashing the same telemetry always yields this exact value. ' +
      'Any alteration, however small, changes it completely — this is what makes the record tamper-evident.'
  );
  return lines.join('\n');
}

export function formatBriefLocally(investigation) {
  const referenceId = `BBX-${Math.random().toString(16).slice(2, 10).toUpperCase()}`;
  const generatedAt = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

  const mission = investigation.mission ?? {};
  const statistics = investigation.statistics ?? {};
  const aiSummary = investigation.ai_summary ?? {};
  const incidents = investigation.incidents ?? [];
  const integrity = investigation.integrity;
  const healthScore = investigation.health_score;

  const incidentLines = incidents.length
    ? incidents.map((incident, i) => formatIncidentLine(incident, i + 1)).join('\n')
    : '  None detected.';
  const confidence = typeof aiSummary.confidence === 'number' ? `${Math.round(aiSummary.confidence * 100)}%` : 'N/A';
  const aiNote =
    aiSummary.ai_available === false
      ? '\n  (AI narrative unavailable — this section reflects deterministic findings only)'
      : '';

  return `\
================================================================================
BLACKBOX AI — AUTOMATED FLIGHT INCIDENT & FORENSIC BRIEF (generated offline)
================================================================================
Reference:      ${referenceId}
Generated:      ${generatedAt}
Data source:    ${mission.source ?? 'unknown'}
Classification: Preliminary automated engineering analysis
                (not a legal, certified, or regulatory finding)

--------------------------------------------------------------------------------
1. MISSION SUMMARY
--------------------------------------------------------------------------------
  Duration:            ${fmt(statistics.duration_seconds, ' s')}
  Distance traveled:   ${fmt(statistics.distance_traveled_m, ' m', 0)}
  Max / avg altitude:  ${fmt(statistics.max_altitude_m, ' m')} / ${fmt(statistics.avg_altitude_m, ' m')}
  Max / avg speed:     ${fmt(statistics.max_speed_m_s, ' m/s')} / ${fmt(statistics.avg_speed_m_s, ' m/s')}
  Battery start / end: ${fmt(statistics.battery_start_pct, '%', 0)} / ${fmt(statistics.battery_end_pct, '%', 0)}
  Battery consumed:    ${fmt(statistics.battery_consumed_pct, '%')}
  Max roll / pitch:    ${fmt(statistics.max_roll_deg, ' deg')} / ${fmt(statistics.max_pitch_deg, ' deg')}
  GPS dropouts:        ${statistics.total_gps_dropouts ?? 'N/A'}
  Telemetry points:    ${statistics.total_telemetry_points ?? 'N/A'}
  Health score:        ${healthScore ?? 'N/A'} / 100

--------------------------------------------------------------------------------
2. VERDICT
--------------------------------------------------------------------------------
  ${aiSummary.verdict ?? 'N/A'}

--------------------------------------------------------------------------------
3. CHRONOLOGICAL SUMMARY
--------------------------------------------------------------------------------
  ${aiSummary.chronological_summary || 'No incidents to summarize.'}

--------------------------------------------------------------------------------
4. PROBABLE CAUSE
--------------------------------------------------------------------------------
  ${aiSummary.probable_cause ?? 'N/A'}
  Narrative confidence: ${confidence}${aiNote}

--------------------------------------------------------------------------------
5. LIABILITY RISK DISTRIBUTION (deterministic, rule-engine derived)
--------------------------------------------------------------------------------
${formatRiskDistribution(statistics.risk_distribution)}

--------------------------------------------------------------------------------
6. DETECTED INCIDENTS (${incidents.length})
--------------------------------------------------------------------------------
${incidentLines}

--------------------------------------------------------------------------------
7. RECOMMENDED ACTIONS
--------------------------------------------------------------------------------
${(aiSummary.recommended_actions ?? []).map((a) => `  - ${a}`).join('\n') || '  None.'}

--------------------------------------------------------------------------------
8. DATA INTEGRITY / CHAIN OF CUSTODY
--------------------------------------------------------------------------------
${formatIntegrity(integrity)}

================================================================================
Every claim above cites a timestamp and telemetry index traceable to the
raw data referenced in Section 8. This brief was generated automatically by
BlackBox's deterministic rule engine, with narrative assistance from an
AI layer instructed to summarize evidence only. Reference ${referenceId} / ${generatedAt}.
================================================================================
`;
}
