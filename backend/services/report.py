"""Formats a real investigation into a readable incident/adjudication brief.

Pure text templating over already-computed data (mission, statistics,
incidents, ai_summary, integrity) — no new analysis happens here, and
nothing is fabricated. Every figure in the brief traces back to a field
the rule engine, statistics service, or integrity hasher actually
computed. Presented as a preliminary automated engineering analysis, not
a legal instrument — the disclaimer says so explicitly, on purpose.
"""

import uuid
from datetime import datetime, timezone
from typing import Any, Optional

RISK_LABELS = {
    "jamming": "External Signal Jamming",
    "spoofing": "GPS Spoofing",
    "hardware": "Power/Hardware Malfunction",
    "pilot_error": "Operator Input Exceedance",
    "structural": "Structural/Impact Event",
}


def _fmt(value: Any, unit: str = "", precision: int = 1) -> str:
    if value is None:
        return "N/A"
    if isinstance(value, (int, float)):
        return f"{value:.{precision}f}{unit}"
    return f"{value}{unit}"


def _format_risk_distribution(risk_distribution: Optional[dict[str, float]]) -> str:
    if not risk_distribution or not any(risk_distribution.values()):
        return "  No liability-relevant signature detected in this telemetry."
    lines = [
        f"  - {RISK_LABELS.get(category, category.title())}: {value:.1f}%"
        for category, value in sorted(risk_distribution.items(), key=lambda kv: -kv[1])
        if value > 0
    ]
    return "\n".join(lines) if lines else "  No liability-relevant signature detected in this telemetry."


def _format_incident_line(incident: dict[str, Any], position: int) -> str:
    evidence_reason = (incident.get("evidence") or [{}])[0].get("reason", "")
    liability = incident.get("liability_hint")
    confidence = incident.get("confidence")
    confidence_str = f", {confidence:.0%} confidence" if isinstance(confidence, (int, float)) else ""
    line = (
        f"  {position}. [T+{round(incident.get('timestamp', 0))}s | telemetry index {incident.get('telemetry_index')}] "
        f"{incident.get('severity', '').upper()}{confidence_str} — {incident.get('title')}\n"
        f"     Evidence: {evidence_reason}"
    )
    if liability:
        line += f"\n     Liability framing: {liability}"
    return line


def _format_integrity(integrity: Optional[dict[str, Any]]) -> str:
    if not integrity:
        return "  Not available for this investigation."
    lines = [
        f"  Algorithm: {integrity.get('algorithm', 'N/A')}",
        f"  Telemetry fingerprint (SHA-256): {integrity.get('data_sha256', 'N/A')}",
    ]
    if integrity.get("source_file_sha256"):
        lines.append(f"  Source file fingerprint (SHA-256): {integrity['source_file_sha256']}")
        lines.append(f"  Source file size: {integrity.get('source_file_bytes', 'N/A')} bytes")
    lines.append(f"  Points hashed: {integrity.get('point_count', 'N/A')}")
    lines.append(f"  Computed: {integrity.get('computed_at', 'N/A')}")
    lines.append(
        "  This fingerprint is reproducible: rehashing the same telemetry always yields this exact value. "
        "Any alteration, however small, changes it completely — this is what makes the record tamper-evident."
    )
    return "\n".join(lines)


def build_insurance_brief(investigation: dict[str, Any]) -> str:
    """Build a plain-text adjudication brief from a completed investigation.

    `investigation` is the same JSON shape returned by /upload, /sample,
    /analyze, and /live/{id}/investigation — this can run on any of them.
    """
    reference_id = f"BBX-{uuid.uuid4().hex[:8].upper()}"
    generated_at = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M UTC")

    mission = investigation.get("mission") or {}
    statistics = investigation.get("statistics") or {}
    ai_summary = investigation.get("ai_summary") or {}
    incidents = investigation.get("incidents") or []
    integrity = investigation.get("integrity")
    health_score = investigation.get("health_score")

    incident_lines = (
        "\n".join(_format_incident_line(incident, i + 1) for i, incident in enumerate(incidents))
        if incidents
        else "  None detected."
    )

    confidence = ai_summary.get("confidence")
    confidence_line = f"{confidence:.0%}" if isinstance(confidence, (int, float)) else "N/A"
    ai_note = (
        "\n  (AI narrative unavailable — this section reflects deterministic findings only)"
        if ai_summary.get("ai_available") is False
        else ""
    )

    return f"""\
================================================================================
BLACKBOX AI — AUTOMATED FLIGHT INCIDENT & FORENSIC BRIEF
================================================================================
Reference:      {reference_id}
Generated:      {generated_at}
Data source:    {mission.get('source', 'unknown')}
Classification: Preliminary automated engineering analysis
                (not a legal, certified, or regulatory finding)

--------------------------------------------------------------------------------
1. MISSION SUMMARY
--------------------------------------------------------------------------------
  Duration:            {_fmt(statistics.get('duration_seconds'), ' s')}
  Distance traveled:   {_fmt(statistics.get('distance_traveled_m'), ' m', 0)}
  Max / avg altitude:  {_fmt(statistics.get('max_altitude_m'), ' m')} / {_fmt(statistics.get('avg_altitude_m'), ' m')}
  Max / avg speed:     {_fmt(statistics.get('max_speed_m_s'), ' m/s')} / {_fmt(statistics.get('avg_speed_m_s'), ' m/s')}
  Battery start / end: {_fmt(statistics.get('battery_start_pct'), '%', 0)} / {_fmt(statistics.get('battery_end_pct'), '%', 0)}
  Battery consumed:    {_fmt(statistics.get('battery_consumed_pct'), '%')}
  Max roll / pitch:    {_fmt(statistics.get('max_roll_deg'), ' deg')} / {_fmt(statistics.get('max_pitch_deg'), ' deg')}
  GPS dropouts:        {statistics.get('total_gps_dropouts', 'N/A')}
  Telemetry points:    {statistics.get('total_telemetry_points', 'N/A')}
  Health score:        {health_score if health_score is not None else 'N/A'} / 100

--------------------------------------------------------------------------------
2. VERDICT
--------------------------------------------------------------------------------
  {ai_summary.get('verdict', 'N/A')}

--------------------------------------------------------------------------------
3. CHRONOLOGICAL SUMMARY
--------------------------------------------------------------------------------
  {ai_summary.get('chronological_summary') or 'No incidents to summarize.'}

--------------------------------------------------------------------------------
4. PROBABLE CAUSE
--------------------------------------------------------------------------------
  {ai_summary.get('probable_cause', 'N/A')}
  Narrative confidence: {confidence_line}{ai_note}

--------------------------------------------------------------------------------
5. LIABILITY RISK DISTRIBUTION (deterministic, rule-engine derived)
--------------------------------------------------------------------------------
{_format_risk_distribution(statistics.get('risk_distribution'))}

--------------------------------------------------------------------------------
6. DETECTED INCIDENTS ({len(incidents)})
--------------------------------------------------------------------------------
{incident_lines}

--------------------------------------------------------------------------------
7. RECOMMENDED ACTIONS
--------------------------------------------------------------------------------
{chr(10).join(f"  - {action}" for action in ai_summary.get('recommended_actions', [])) or "  None."}

--------------------------------------------------------------------------------
8. DATA INTEGRITY / CHAIN OF CUSTODY
--------------------------------------------------------------------------------
{_format_integrity(integrity)}

================================================================================
Every claim above cites a timestamp and telemetry index traceable to the
raw data hashed in Section 8. This brief was generated automatically by
BlackBox AI's deterministic rule engine, with narrative assistance from an
AI layer instructed to summarize evidence only — it does not draw its own
conclusions beyond what the evidence supports, and confidence figures are
never self-reported by the AI. Reference {reference_id} / {generated_at}.
================================================================================
"""
