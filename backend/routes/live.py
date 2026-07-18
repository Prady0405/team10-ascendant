"""Live telemetry ingestion — e.g. an ESP32 + IMU streaming packets over
HTTP while standing in for a drone.

A session buffers normalized points in memory (services/live_session.py).
`GET /live/{session_id}/investigation` runs the exact same
analytics -> rules -> statistics -> gemini -> summary pipeline used for
CSV uploads, so a live ESP32 session and an uploaded flight log produce
identically shaped JSON — the frontend can render both with one component.
"""

from typing import Any, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from services import live_session, summary
from services.analytics import compute_analytics
from services.rules import run_rule_engine

router = APIRouter(prefix="/live", tags=["live"])


class StartSessionRequest(BaseModel):
    session_id: Optional[str] = None


@router.post("/start")
def start_live_session(request: StartSessionRequest = StartSessionRequest()) -> dict[str, str]:
    """Begin (or reset) a live session. The ESP32 doesn't need to call this
    first — POSTing straight to /live/{session_id}/ingest auto-creates the
    session — but calling it explicitly guarantees a clean buffer, which
    matters if you're re-running the same demo session id.
    """
    session_id = live_session.start_session(request.session_id)
    return {"session_id": session_id}


@router.get("/sessions")
def list_live_sessions() -> list[dict[str, Any]]:
    return live_session.list_sessions()


@router.post("/{session_id}/ingest")
def ingest_live_packet(session_id: str, packet: dict[str, Any]) -> dict[str, Any]:
    """Accept one decoded IMU/telemetry packet from the device.

    Returns the normalized point plus any incidents newly triggered by
    this exact sample (flip, collision, threshold crossings) — enough for
    a live HUD to flash a warning the instant it happens, using the same
    rule engine that powers the full investigation.
    """
    try:
        point = live_session.ingest_packet(session_id, packet)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    points = live_session.get_points(session_id)
    analytics = compute_analytics(points)
    incidents = run_rule_engine(points, analytics)
    latest_index = len(points) - 1
    instant_alerts = [incident.model_dump() for incident in incidents if incident.telemetry_index == latest_index]

    return {
        "point": point.model_dump(),
        "point_count": len(points),
        "instant_alerts": instant_alerts,
    }


@router.get("/{session_id}/investigation")
def get_live_investigation(session_id: str) -> dict[str, Any]:
    """Run the full investigation pipeline over everything buffered so far
    for this session — same JSON shape as POST /upload and GET /sample.
    """
    try:
        points = live_session.get_points(session_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail=f"Unknown live session: {session_id}") from exc

    return summary.build_investigation(points, source="esp32")


@router.delete("/{session_id}")
def clear_live_session(session_id: str) -> dict[str, bool]:
    live_session.clear_session(session_id)
    return {"cleared": True}
