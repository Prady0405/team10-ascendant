"""Formats an already-computed investigation into a readable text brief."""

from typing import Any

from fastapi import APIRouter, HTTPException

from services.report import build_insurance_brief

router = APIRouter(prefix="/report", tags=["report"])


@router.post("/brief")
def generate_brief(investigation: dict[str, Any]) -> dict[str, str]:
    """Accepts a full investigation payload (whatever /upload, /sample,
    /analyze, or /live/{id}/investigation returned) and formats it into a
    plain-text incident brief. Does not re-run any analysis.
    """
    if not investigation:
        raise HTTPException(status_code=400, detail="No investigation payload supplied")
    return {"report_text": build_insurance_brief(investigation)}
