"""Accepts already-normalized telemetry (e.g. from a database or another parser)."""

from typing import Any

from fastapi import APIRouter, HTTPException

from models.telemetry import NormalizedTelemetry
from services import summary

router = APIRouter()


@router.post("/analyze")
def analyze_telemetry(payload: NormalizedTelemetry) -> dict[str, Any]:
    """Run the full pipeline over telemetry that is already in our normalized format."""
    if not payload.points:
        raise HTTPException(status_code=400, detail="No telemetry points supplied")
    return summary.build_investigation(payload.points, source=payload.source)
