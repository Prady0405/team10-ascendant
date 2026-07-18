"""In-memory buffer for live telemetry sessions (e.g. an ESP32 streaming
IMU packets over HTTP).

This is intentionally not a database — the project is local-first and a
live session only needs to survive for the duration of a demo run. A
session is just an ordered list of `TelemetryPoint`s that the exact same
analytics/rules/statistics/summary pipeline used for CSV uploads can run
over, so a live ESP32 flight produces the identical investigation JSON
shape as an uploaded file.
"""

import threading
import time
import uuid
from dataclasses import dataclass, field

from models.telemetry import TelemetryPoint
from services.parser import esp32_packet_to_point

_lock = threading.Lock()


@dataclass
class LiveSession:
    session_id: str
    started_at_monotonic: float
    points: list[TelemetryPoint] = field(default_factory=list)


_sessions: dict[str, LiveSession] = {}


def start_session(session_id: str | None = None) -> str:
    """Create a fresh, empty session and return its id. Reusing an
    existing id resets that session's buffer.
    """
    resolved_id = session_id or uuid.uuid4().hex[:12]
    with _lock:
        _sessions[resolved_id] = LiveSession(session_id=resolved_id, started_at_monotonic=time.monotonic())
    return resolved_id


def ingest_packet(session_id: str, packet: dict) -> TelemetryPoint:
    """Normalize and append one packet. Auto-creates the session if this
    is the first packet received for an id the caller didn't explicitly
    start — convenient for an ESP32 that just starts POSTing on power-up.
    """
    with _lock:
        session = _sessions.get(session_id)
        if session is None:
            session = LiveSession(session_id=session_id, started_at_monotonic=time.monotonic())
            _sessions[session_id] = session
        fallback_timestamp = time.monotonic() - session.started_at_monotonic

    point = esp32_packet_to_point(packet, source="esp32", fallback_timestamp=fallback_timestamp)
    if point is None:
        raise ValueError("Packet could not be normalized into a telemetry point")

    with _lock:
        session.points.append(point)
    return point


def get_points(session_id: str) -> list[TelemetryPoint]:
    with _lock:
        session = _sessions.get(session_id)
        if session is None:
            raise KeyError(session_id)
        return list(session.points)


def clear_session(session_id: str) -> None:
    with _lock:
        _sessions.pop(session_id, None)


def list_sessions() -> list[dict]:
    with _lock:
        return [
            {"session_id": s.session_id, "point_count": len(s.points), "started_at_monotonic": s.started_at_monotonic}
            for s in _sessions.values()
        ]
