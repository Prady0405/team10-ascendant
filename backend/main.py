"""BlackBox backend entry point.

Run with: uvicorn main:app --reload
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routes import analyze, health, live, report, upload
from services import serial_bridge

app = FastAPI(
    title="BlackBox",
    description="Explainable drone flight log diagnostics and incident investigation engine.",
    version="0.1.0",
)


@app.on_event("startup")
def _start_optional_hardware_bridge() -> None:
    serial_bridge.start_if_configured()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health.router)
app.include_router(upload.router)
app.include_router(analyze.router)
app.include_router(live.router)
app.include_router(report.router)
