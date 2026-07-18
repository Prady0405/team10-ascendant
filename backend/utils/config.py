"""Central configuration and rule-engine thresholds for BlackBox AI.

All magic numbers used by the deterministic rule engine live here so they
can be tuned without touching detection logic.
"""

import os
from pathlib import Path
from typing import Final

from dotenv import load_dotenv

# Loads backend/.env if present (gitignored — never commit real keys here).
# Environment variables set another way (shell, systemd, Docker, etc.) still
# take priority: load_dotenv defaults to not overriding existing env vars.
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# --- Gemini -----------------------------------------------------------------

GEMINI_API_KEY: Final[str | None] = os.environ.get("GEMINI_API_KEY")
GEMINI_MODEL: Final[str] = os.environ.get("GEMINI_MODEL", "gemini-flash-latest")

# --- General ------------------------------------------------------------------

MAX_UPLOAD_SIZE_BYTES: Final[int] = 25 * 1024 * 1024  # 25 MB

# --- USB-serial hardware bridge (e.g. an ESP32 + MPU6050 plugged into the
# same machine running the backend) — opt-in, disabled unless SERIAL_PORT
# is set. See services/serial_bridge.py.

SERIAL_PORT: Final[str | None] = os.environ.get("SERIAL_PORT")
SERIAL_BAUD_RATE: Final[int] = int(os.environ.get("SERIAL_BAUD_RATE", "115200"))
SERIAL_SESSION_ID: Final[str] = os.environ.get("SERIAL_SESSION_ID", "esp32-serial")

# --- Battery ------------------------------------------------------------------

BATTERY_CRITICAL_PCT: Final[float] = 15.0
BATTERY_WARNING_PCT: Final[float] = 30.0
BATTERY_RAPID_DRAIN_PCT: Final[float] = 20.0
BATTERY_RAPID_DRAIN_WINDOW_SEC: Final[float] = 5.0
BATTERY_POWER_FAILURE_PCT: Final[float] = 35.0
BATTERY_POWER_FAILURE_WINDOW_SEC: Final[float] = 3.0

# --- Altitude / descent ---------------------------------------------------

RAPID_DESCENT_RATE_M_S: Final[float] = 4.0
CRASH_DESCENT_RATE_M_S: Final[float] = 8.0
CRASH_FINAL_ALTITUDE_M: Final[float] = 2.0
HARD_LANDING_VERTICAL_SPEED_M_S: Final[float] = 3.0
HARD_LANDING_MAX_ALTITUDE_M: Final[float] = 3.0

# --- GPS ------------------------------------------------------------------

GPS_DEGRADATION_SATELLITE_COUNT: Final[int] = 6
GPS_LOSS_SATELLITE_COUNT: Final[int] = 4
GPS_LOSS_DROP_COUNT: Final[int] = 6
GPS_LOSS_WINDOW_SEC: Final[float] = 2.0

# --- Attitude ---------------------------------------------------------------

EXCESSIVE_ROLL_DEG: Final[float] = 45.0
EXCESSIVE_PITCH_DEG: Final[float] = 45.0

# --- Speed / motion ---------------------------------------------------------

EXCESSIVE_SPEED_M_S: Final[float] = 25.0
SUDDEN_ACCELERATION_G: Final[float] = 2.0
STATIONARY_SPEED_THRESHOLD_M_S: Final[float] = 0.5
STATIONARY_MIN_DURATION_SEC: Final[float] = 15.0
HOVER_ALTITUDE_JITTER_M: Final[float] = 3.0
HOVER_MIN_DURATION_SEC: Final[float] = 10.0

# --- Signal -----------------------------------------------------------------

SIGNAL_LOSS_THRESHOLD_PCT: Final[float] = 20.0
SIGNAL_DEGRADATION_DROP_PCT: Final[float] = 40.0
SIGNAL_DEGRADATION_WINDOW_SEC: Final[float] = 3.0

# --- Orientation / impact (IMU-driven, e.g. ESP32 live sessions) ------------

FLIP_ROLL_DEG: Final[float] = 120.0
FLIP_PITCH_DEG: Final[float] = 120.0
COLLISION_JERK_G_PER_S: Final[float] = 8.0
KINETIC_JITTER_WINDOW_SEC: Final[float] = 3.0

# Free fall: an accelerometer measures proper acceleration (deviation from
# free fall), not gravity itself — so a device falling freely reads close
# to 0g on every axis, not 1g. This is a distinct signature from a
# collision (a magnitude spike) and a flip (an attitude angle) — dropping
# something shows all three in sequence: free-fall, then flip/tumble, then
# collision on impact.
FREE_FALL_MAX_ACCEL_G: Final[float] = 0.35

# --- Signal-disruption probability model -------------------------------------
# P(J | S_t, D_t, sigma^2_K) = sigmoid(beta * (w1*dS + w2*D_t + w3*sigma^2_K - theta))
# See services/forensics.py for the full model.

SIGNAL_DISRUPTION_BETA: Final[float] = 1.0
SIGNAL_DISRUPTION_WEIGHT_SATELLITE_DROP: Final[float] = 0.6
SIGNAL_DISRUPTION_WEIGHT_HDOP: Final[float] = 0.4
SIGNAL_DISRUPTION_WEIGHT_JITTER: Final[float] = 0.15
SIGNAL_DISRUPTION_THETA: Final[float] = 4.0
SIGNAL_DISRUPTION_PROBABILITY_THRESHOLD: Final[float] = 0.85
SIGNAL_DISRUPTION_BASELINE_SATELLITES: Final[float] = 12.0

# --- GPS spoofing (IMU-vs-GPS cross-validation) ------------------------------
# A real drone accelerating/decelerating produces real accelerometer g-force;
# a spoofed GPS track can jump speed/position instantly with nothing felt by
# the IMU. So the signature is a large GPS-*implied* acceleration (a jump in
# GPS-derived speed) with no corresponding spike in *measured* acceleration —
# NOT merely "moving fast with a calm IMU", which also describes ordinary
# constant-velocity cruise flight and would false-positive on every mission.

SPOOFING_GPS_JUMP_ACCEL_M_S2: Final[float] = 8.0  # implausible GPS-implied acceleration
SPOOFING_MAX_ACCEL_MAGNITUDE_G: Final[float] = 1.3  # ceiling for "IMU felt nothing unusual"

# --- Loiter -------------------------------------------------------------------

LOITER_RADIUS_M: Final[float] = 15.0
LOITER_MIN_DURATION_SEC: Final[float] = 20.0

# --- Health score weights ---------------------------------------------------

HEALTH_SCORE_WEIGHTS: Final[dict[str, int]] = {
    "critical": 25,
    "warning": 10,
    "normal": 2,
}
