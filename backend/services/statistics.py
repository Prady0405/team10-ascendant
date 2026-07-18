"""Mission-level aggregate statistics.

Pure aggregation over the telemetry stream, the analytics engine's output,
and the rule engine's incidents — no thresholds or judgment calls live
here, just sums, maxes, and averages.
"""

from typing import Any, Optional

from models.incident import Incident
from models.telemetry import TelemetryPoint
from services.analytics import AnalyticsPoint
from utils.config import GPS_DEGRADATION_SATELLITE_COUNT


def _avg(values: list[float]) -> Optional[float]:
    return round(sum(values) / len(values), 2) if values else None


def _max(values: list[float]) -> Optional[float]:
    return round(max(values), 2) if values else None


LIABILITY_CATEGORIES = ["jamming", "spoofing", "hardware", "pilot_error", "structural"]


def compute_risk_distribution(incidents: list[Incident]) -> dict[str, float]:
    """Aggregate incidents into liability-category percentages.

    Purely a rollup of the rule engine's own deterministic
    `liability_category`/`confidence` fields (see services/rules.py's
    TYPE_LIABILITY) — no AI, no new judgment calls, just weighted shares.
    All zero when nothing detected has a liability implication.
    """
    weights = {category: 0.0 for category in LIABILITY_CATEGORIES}
    for incident in incidents:
        if incident.liability_category in weights:
            weights[incident.liability_category] += incident.confidence

    total = sum(weights.values())
    if total == 0:
        return weights
    return {category: round(weight / total * 100, 1) for category, weight in weights.items()}


def compute_mission_statistics(
    points: list[TelemetryPoint],
    analytics: list[AnalyticsPoint],
    incidents: list[Incident],
) -> dict[str, Any]:
    """Compute the MISSION STATISTICS block of the output JSON."""
    if not points:
        return {}

    duration_sec = points[-1].timestamp - points[0].timestamp
    distance_m = analytics[-1].cumulative_distance_m if analytics else 0.0

    altitudes = [p.altitude for p in points if p.altitude is not None]
    speeds = [p.speed for p in points if p.speed is not None]
    rolls = [abs(p.roll) for p in points if p.roll is not None]
    pitches = [abs(p.pitch) for p in points if p.pitch is not None]
    batteries = [p.battery for p in points if p.battery is not None]

    gps_dropouts = sum(
        1
        for point in points
        if point.gps_satellites is not None and point.gps_satellites <= GPS_DEGRADATION_SATELLITE_COUNT
    )
    battery_consumed = round(batteries[0] - batteries[-1], 2) if len(batteries) >= 2 else None

    return {
        "duration_seconds": round(duration_sec, 2),
        "distance_traveled_m": round(distance_m, 2),
        "max_altitude_m": _max(altitudes),
        "avg_altitude_m": _avg(altitudes),
        "max_speed_m_s": _max(speeds),
        "avg_speed_m_s": _avg(speeds),
        "battery_start_pct": batteries[0] if batteries else None,
        "battery_end_pct": batteries[-1] if batteries else None,
        "battery_consumed_pct": battery_consumed,
        "max_roll_deg": _max(rolls),
        "max_pitch_deg": _max(pitches),
        "total_gps_dropouts": gps_dropouts,
        "total_anomalies_detected": len(incidents),
        "total_telemetry_points": len(points),
        "risk_distribution": compute_risk_distribution(incidents),
    }
