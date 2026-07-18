"""Standard internal telemetry representation.

Every parser (CSV today, MAVLink / DJI / PX4 / ESP32 later) must convert its
source format into a list of `TelemetryPoint`. Downstream analytics, the
rule engine, and statistics never know or care where the data came from.
"""

from typing import Any, Optional

from pydantic import BaseModel, Field


class TelemetryPoint(BaseModel):
    """A single normalized telemetry sample.

    All fields except `timestamp` and `source` are optional because
    real-world logs frequently omit sensors. Missing values must never
    crash the pipeline — they are simply excluded from calculations that
    need them.
    """

    timestamp: float = Field(..., description="Elapsed seconds since mission start")
    latitude: Optional[float] = None
    longitude: Optional[float] = None
    altitude: Optional[float] = Field(None, description="Meters above ground/home")
    speed: Optional[float] = Field(None, description="Meters per second")
    battery: Optional[float] = Field(None, description="Percent, 0-100")
    roll: Optional[float] = Field(None, description="Degrees")
    pitch: Optional[float] = Field(None, description="Degrees")
    yaw: Optional[float] = Field(None, description="Degrees")
    gps_satellites: Optional[int] = None
    hdop: Optional[float] = Field(None, description="GPS horizontal dilution of precision; lower is better")
    signal_strength: Optional[float] = Field(None, description="Percent, 0-100")
    acceleration_x: Optional[float] = None
    acceleration_y: Optional[float] = None
    acceleration_z: Optional[float] = None
    source: str = "unknown"
    extra: dict[str, Any] = Field(default_factory=dict, description="Unmapped source columns")


class NormalizedTelemetry(BaseModel):
    """A full, ordered mission telemetry stream."""

    points: list[TelemetryPoint]
    source: str = "unknown"
