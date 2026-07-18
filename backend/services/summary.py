"""Assembles the single large output JSON returned by every endpoint.

Orchestration only: calls analytics -> rules -> statistics -> gemini and
shapes their outputs into the frontend contract (mission, statistics,
flight_path, graphs, incidents, timeline, health_score, ai_summary,
raw_data). The backend never renders anything — this is pure data.
"""

from typing import Any, Optional

from models.incident import Incident
from models.telemetry import TelemetryPoint
from services import gemini
from services.analytics import compute_analytics
from services.integrity import build_integrity_block
from services.rules import run_rule_engine
from services.statistics import compute_mission_statistics
from utils.config import HEALTH_SCORE_WEIGHTS
from utils.helpers import clamp

GRAPH_FIELDS = ["battery", "altitude", "speed", "gps_satellites", "signal_strength", "roll", "pitch"]
GRAPH_KEY_OVERRIDES = {"gps_satellites": "satellites"}


def _build_flight_path(points: list[TelemetryPoint]) -> list[dict[str, Any]]:
    return [
        {
            "timestamp": point.timestamp,
            "latitude": point.latitude,
            "longitude": point.longitude,
            "altitude": point.altitude,
        }
        for point in points
        if point.latitude is not None and point.longitude is not None
    ]


def _build_graphs(points: list[TelemetryPoint]) -> dict[str, list[dict[str, Any]]]:
    graphs: dict[str, list[dict[str, Any]]] = {}
    for field in GRAPH_FIELDS:
        key = GRAPH_KEY_OVERRIDES.get(field, field)
        graphs[key] = [
            {"timestamp": point.timestamp, "value": getattr(point, field)}
            for point in points
            if getattr(point, field) is not None
        ]
    return graphs


def _build_timeline(incidents: list[Incident]) -> list[dict[str, Any]]:
    return [
        {
            "timestamp": incident.timestamp,
            "title": incident.title,
            "severity": incident.severity,
            "linked_incident": incident.id,
        }
        for incident in incidents
    ]


def _compute_health_score(incidents: list[Incident]) -> int:
    deduction = sum(HEALTH_SCORE_WEIGHTS.get(incident.severity, 0) for incident in incidents)
    return int(clamp(100 - deduction, 0, 100))


def build_investigation(
    points: list[TelemetryPoint], source: str = "csv", source_file_bytes: Optional[bytes] = None
) -> dict[str, Any]:
    """Run the full pipeline over normalized telemetry and return the
    complete investigation payload described in the PRD's OUTPUT JSON.

    `source_file_bytes`, when given (i.e. a direct CSV upload), lets the
    integrity block include a hash of the original file as received, on
    top of the hash of the normalized data every source gets.
    """
    analytics = compute_analytics(points)
    incidents = run_rule_engine(points, analytics)
    statistics = compute_mission_statistics(points, analytics, incidents)

    incident_dicts = [incident.model_dump() for incident in incidents]
    ai_summary = gemini.generate_mission_summary(statistics, incident_dicts)
    raw_data = [point.model_dump() for point in points]

    mission = {
        "source": source,
        "duration_seconds": statistics.get("duration_seconds"),
        "distance_m": statistics.get("distance_traveled_m"),
        "battery_used_pct": statistics.get("battery_consumed_pct"),
        "max_altitude_m": statistics.get("max_altitude_m"),
        "max_speed_m_s": statistics.get("max_speed_m_s"),
    }

    return {
        "mission": mission,
        "statistics": statistics,
        "flight_path": _build_flight_path(points),
        "graphs": _build_graphs(points),
        "incidents": incident_dicts,
        "timeline": _build_timeline(incidents),
        "health_score": _compute_health_score(incidents),
        "ai_summary": ai_summary,
        "integrity": build_integrity_block(raw_data, source_file_bytes),
        "raw_data": raw_data,
    }
