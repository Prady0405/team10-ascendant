"""CSV upload endpoint and the bundled sample-data endpoint."""

from pathlib import Path
from typing import Any

from fastapi import APIRouter, File, HTTPException, UploadFile

from services import parser, summary
from utils.config import MAX_UPLOAD_SIZE_BYTES

router = APIRouter()

SAMPLE_DATA_DIR = Path(__file__).resolve().parent.parent / "sample_data"
DEFAULT_SAMPLE_FILE = "sample_flight_normal.csv"


@router.post("/upload")
async def upload_telemetry(file: UploadFile = File(...)) -> dict[str, Any]:
    """Upload a raw CSV telemetry log and receive a complete investigation."""
    if not file.filename or not file.filename.lower().endswith(".csv"):
        raise HTTPException(status_code=400, detail="Only .csv files are supported")

    file_bytes = await file.read()
    if len(file_bytes) > MAX_UPLOAD_SIZE_BYTES:
        raise HTTPException(status_code=400, detail="File exceeds maximum upload size")

    points = parser.parse_csv(file_bytes, source="csv")
    return summary.build_investigation(points, source="csv", source_file_bytes=file_bytes)


@router.get("/sample")
def sample_investigation(scenario: str = "normal") -> dict[str, Any]:
    """Returns a complete investigation for one of the bundled sample flights.

    `scenario` may be one of: normal, gps_loss, battery_failure, crash.
    """
    scenario_files = {
        "normal": "sample_flight_normal.csv",
        "gps_loss": "sample_gps_loss.csv",
        "battery_failure": "sample_battery_failure.csv",
        "crash": "sample_crash.csv",
    }
    filename = scenario_files.get(scenario)
    if filename is None:
        raise HTTPException(
            status_code=400,
            detail=f"Unknown scenario '{scenario}'. Choose one of: {', '.join(scenario_files)}",
        )

    sample_path = SAMPLE_DATA_DIR / filename
    if not sample_path.exists():
        raise HTTPException(status_code=500, detail=f"Sample file not found: {filename}")

    sample_bytes = sample_path.read_bytes()
    points = parser.parse_csv(sample_bytes, source="sample")
    return summary.build_investigation(points, source="sample", source_file_bytes=sample_bytes)
