"""Structured incident and evidence models produced by the rule engine.

The rule engine (services/rules.py) is the only thing allowed to create
these. The AI layer only reads them — it never invents an incident.
"""

from typing import Any, Literal, Optional

from pydantic import BaseModel, Field

Severity = Literal["normal", "warning", "critical"]


class Evidence(BaseModel):
    """The concrete numbers that justify an incident, not prose."""

    parameter: str = Field(..., description="Telemetry field the rule inspected, e.g. gps_satellites")
    before_value: Optional[Any] = None
    after_value: Optional[Any] = None
    threshold: Optional[Any] = None
    unit: Optional[str] = None
    window_seconds: Optional[float] = None
    reason: str = Field(..., description="Human-readable statement of why this evidence triggered the rule")


class Incident(BaseModel):
    """A single deterministically detected anomaly."""

    id: str
    type: str = Field(..., description="Machine-readable incident type, e.g. gps_loss")
    title: str = Field(..., description="Short human-readable label, e.g. 'GPS Signal Loss'")
    severity: Severity
    confidence: float = Field(..., ge=0.0, le=1.0)
    timestamp: float = Field(..., description="Elapsed seconds since mission start")
    telemetry_index: int = Field(..., description="Index into the normalized telemetry list")
    evidence: list[Evidence]
    implemented: bool = True
    liability_category: Optional[str] = Field(
        None, description="Deterministic liability bucket, e.g. jamming/spoofing/hardware/pilot_error/structural"
    )
    liability_hint: Optional[str] = Field(
        None, description="Deterministic, rule-driven liability framing — never AI-generated"
    )
