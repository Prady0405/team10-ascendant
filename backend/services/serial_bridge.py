"""Optional USB-serial hardware bridge for an ESP32 + MPU6050 plugged
directly into the machine running the backend (no WiFi needed).

This is an *alternative* ingestion path alongside the HTTP
`/live/{session_id}/ingest` endpoint used by a WiFi-connected ESP32 — both
funnel into the exact same `services.live_session` pipeline, so the rest
of the system (analytics, rules, statistics, narration) never knows or
cares which transport a packet arrived over.

Disabled by default. Set the `SERIAL_PORT` environment variable (e.g.
`SERIAL_PORT=COM3`) to enable it. If `pyserial` isn't installed, or the
port can't be opened, this logs a warning and the rest of the app keeps
working normally — a hardware demo prop failing to connect must never
take down the API.
"""

import logging
import threading
import time

from services import live_session
from utils import config

logger = logging.getLogger(__name__)


def _parse_live_data_line(line: str) -> dict | None:
    """Parses a `LIVE_DATA,ax,ay,az` line from firmware/blackbox_mpu6050.ino."""
    parts = line.strip().split(",")
    if len(parts) < 4 or parts[0] != "LIVE_DATA":
        return None
    try:
        return {
            "accel_x": float(parts[1]),
            "accel_y": float(parts[2]),
            "accel_z": float(parts[3]),
        }
    except ValueError:
        return None


def _run_serial_loop(port: str, baud_rate: int, session_id: str) -> None:
    try:
        import serial
    except ImportError:
        logger.warning("SERIAL_PORT is set but pyserial is not installed — run `pip install pyserial`")
        return

    live_session.start_session(session_id)
    logger.info("Serial bridge: watching %s for MPU6050 packets -> live session %r", port, session_id)

    while True:
        try:
            with serial.Serial(port, baud_rate, timeout=1) as connection:
                while True:
                    raw_line = connection.readline().decode("utf-8", errors="ignore")
                    packet = _parse_live_data_line(raw_line)
                    if packet is None:
                        continue
                    try:
                        live_session.ingest_packet(session_id, packet)
                    except ValueError:
                        continue
        except Exception as exc:  # port unplugged, permission error, etc. — never crash the app
            logger.warning("Serial bridge lost connection to %s (%s); retrying in 2s", port, exc)
            time.sleep(2.0)


def start_if_configured() -> None:
    """Starts the background serial-reader thread iff SERIAL_PORT is set."""
    if not config.SERIAL_PORT:
        return
    thread = threading.Thread(
        target=_run_serial_loop,
        args=(config.SERIAL_PORT, config.SERIAL_BAUD_RATE, config.SERIAL_SESSION_ID),
        daemon=True,
    )
    thread.start()
