"""Generates synthetic drone telemetry CSVs for demoing/testing BlackBox.

Run directly to (re)generate the four bundled sample files:
    py generate_synthetic.py

Or import `generate_flight` to build custom synthetic missions for tests,
e.g. injecting an anomaly at an arbitrary time in an arbitrary flight
length. Every scenario shares the same base circular-flight generator so
adding a new anomaly scenario is just a new `inject_*` function.
"""

import csv
import math
import random
from pathlib import Path
from typing import Any, Callable, Optional

COLUMNS = [
    "timestamp",
    "latitude",
    "longitude",
    "altitude",
    "speed",
    "battery",
    "roll",
    "pitch",
    "yaw",
    "gps_satellites",
    "signal_strength",
    "acceleration_x",
    "acceleration_y",
    "acceleration_z",
]

RADIUS_M = 80.0
HZ = 2.0  # samples per second
METERS_PER_DEG_LAT = 111_320.0

# Each sample scenario gets its own real-world location purely for demo
# variety — the map isn't hardcoded to any one place, this is just where
# each mock mission happens to be set. An uploaded CSV renders wherever its
# own coordinates actually are.
SCENARIO_LOCATIONS: dict[str, tuple[float, float]] = {
    "normal": (37.7749, -122.4194),  # San Francisco, CA
    "gps_loss": (40.7128, -74.0060),  # New York, NY
    "battery_failure": (51.5074, -0.1278),  # London, UK
    "crash": (35.6762, 139.6503),  # Tokyo, Japan
}


def _circular_position(center_lat: float, center_lon: float, angle_rad: float) -> tuple[float, float]:
    delta_lat = (RADIUS_M * math.sin(angle_rad)) / METERS_PER_DEG_LAT
    meters_per_deg_lon = METERS_PER_DEG_LAT * math.cos(math.radians(center_lat))
    delta_lon = (RADIUS_M * math.cos(angle_rad)) / meters_per_deg_lon
    return center_lat + delta_lat, center_lon + delta_lon


def generate_flight(
    duration_sec: float,
    seed: int,
    inject: Optional[Callable[[float, dict[str, Any], dict[str, Any]], None]] = None,
    center: tuple[float, float] = (37.7749, -122.4194),
) -> list[dict[str, Any]]:
    """Build a baseline circular flight and optionally mutate each row in-place.

    `inject(t, row, state)` is called for every timestamp after baseline
    physics are computed, so an anomaly scenario only needs to override
    the fields it cares about. `state` persists across calls (dict) so an
    injector can implement "starting at t=X, drain battery for 3s".
    """
    rng = random.Random(seed)
    rows: list[dict[str, Any]] = []
    step = 1.0 / HZ
    total_steps = int(duration_sec * HZ)
    orbital_period_sec = 40.0
    state: dict[str, Any] = {}
    center_lat, center_lon = center

    battery = 100.0
    battery_drain_per_step = (100.0 - 65.0) / total_steps  # gentle baseline drain

    for step_index in range(total_steps + 1):
        t = round(step_index * step, 2)
        angle = 2 * math.pi * (t / orbital_period_sec)
        lat, lon = _circular_position(center_lat, center_lon, angle)

        altitude = 60.0 + 5.0 * math.sin(t / 7.0) + rng.uniform(-0.3, 0.3)
        speed = (2 * math.pi * RADIUS_M / orbital_period_sec) + rng.uniform(-0.4, 0.4)
        roll = 6.0 * math.sin(t / 5.0) + rng.uniform(-1.0, 1.0)
        pitch = 4.0 * math.cos(t / 6.0) + rng.uniform(-1.0, 1.0)
        yaw = (math.degrees(angle) + 90.0) % 360.0
        gps_satellites = 12 + rng.randint(-1, 2)
        signal_strength = 88.0 + rng.uniform(-4.0, 4.0)

        battery = max(0.0, battery - battery_drain_per_step)

        pitch_rad, roll_rad = math.radians(pitch), math.radians(roll)
        acceleration_x = math.sin(pitch_rad) + rng.uniform(-0.02, 0.02)
        acceleration_y = -math.sin(roll_rad) + rng.uniform(-0.02, 0.02)
        acceleration_z = math.cos(pitch_rad) * math.cos(roll_rad) + rng.uniform(-0.02, 0.02)

        row: dict[str, Any] = {
            "timestamp": t,
            "latitude": round(lat, 7),
            "longitude": round(lon, 7),
            "altitude": round(altitude, 2),
            "speed": round(max(0.0, speed), 2),
            "battery": round(battery, 2),
            "roll": round(roll, 2),
            "pitch": round(pitch, 2),
            "yaw": round(yaw, 2),
            "gps_satellites": max(0, gps_satellites),
            "signal_strength": round(max(0.0, min(100.0, signal_strength)), 2),
            "acceleration_x": round(acceleration_x, 3),
            "acceleration_y": round(acceleration_y, 3),
            "acceleration_z": round(acceleration_z, 3),
        }

        if inject is not None:
            inject(t, row, state)

        rows.append(row)

    return rows


def inject_gps_loss(t: float, row: dict[str, Any], state: dict[str, Any]) -> None:
    """Satellites plunge from healthy to near-zero within 2s at t=60s, battery stays healthy."""
    onset, outage_duration, recovery_duration = 60.0, 10.0, 6.0
    if onset <= t < onset + 2.0:
        progress = (t - onset) / 2.0
        row["gps_satellites"] = max(1, round(13 - progress * 11))
        row["signal_strength"] = round(max(5.0, row["signal_strength"] - progress * 70), 2)
    elif onset + 2.0 <= t < onset + outage_duration:
        row["gps_satellites"] = 2
        row["signal_strength"] = round(min(row["signal_strength"], 15.0), 2)
    elif onset + outage_duration <= t < onset + outage_duration + recovery_duration:
        progress = (t - (onset + outage_duration)) / recovery_duration
        row["gps_satellites"] = max(2, round(2 + progress * 11))
        row["signal_strength"] = round(min(95.0, 15.0 + progress * 75), 2)


def inject_battery_failure(t: float, row: dict[str, Any], state: dict[str, Any]) -> None:
    """Battery healthy until t=70s, then collapses ~45% in 3s (physical power failure),
    followed by a powerless rapid descent and hard landing.
    """
    onset, drain_duration = 70.0, 2.0
    if "battery_at_onset" not in state and t >= onset:
        state["battery_at_onset"] = row["battery"]
    if onset <= t < onset + drain_duration:
        progress = (t - onset) / drain_duration
        row["battery"] = round(state["battery_at_onset"] * (1 - 0.5 * progress), 2)
    elif t >= onset + drain_duration:
        elapsed = t - (onset + drain_duration)
        row["battery"] = round(max(3.0, state["battery_at_onset"] * 0.5 - elapsed * 1.5), 2)
        descent_progress = min(1.0, elapsed / 8.0)
        row["altitude"] = round(max(0.0, row["altitude"] * (1 - descent_progress)), 2)
        row["speed"] = round(max(0.0, row["speed"] * (1 - descent_progress * 0.7)), 2)
        if descent_progress >= 1.0:
            row["altitude"] = 0.0
            row["speed"] = 0.0


def inject_crash(t: float, row: dict[str, Any], state: dict[str, Any]) -> None:
    """Sudden loss of control at t=50s: violent attitude excursion, impact within ~2.5s."""
    onset, impact_duration = 50.0, 2.5
    if "altitude_at_onset" not in state and t >= onset:
        state["altitude_at_onset"] = row["altitude"]
    if onset <= t < onset + impact_duration:
        progress = (t - onset) / impact_duration
        row["altitude"] = round(max(0.0, state["altitude_at_onset"] * (1 - progress ** 1.5)), 2)
        row["roll"] = round(row["roll"] + progress * 70 * (1 if int(t * 10) % 2 == 0 else -1), 2)
        row["pitch"] = round(row["pitch"] + progress * 55, 2)
        row["speed"] = round(row["speed"] * (1 + progress * 2), 2)
        row["acceleration_x"] = round(row["acceleration_x"] + progress * 1.5, 3)
        row["acceleration_z"] = round(row["acceleration_z"] + progress * 1.2, 3)
    elif t >= onset + impact_duration:
        if "impact_logged" not in state:
            row["altitude"] = 0.0
            row["speed"] = 0.0
            row["roll"] = round(random.Random(1).uniform(-15, 15), 2)
            row["pitch"] = round(random.Random(2).uniform(-15, 15), 2)
            row["acceleration_x"] = 3.2
            row["acceleration_y"] = 2.1
            row["acceleration_z"] = 3.6
            state["impact_logged"] = True
        else:
            row["altitude"] = 0.0
            row["speed"] = 0.0
            row["acceleration_x"] = 0.05
            row["acceleration_y"] = 0.02
            row["acceleration_z"] = 1.0


def write_csv(filename: Path, rows: list[dict[str, Any]]) -> None:
    with filename.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=COLUMNS)
        writer.writeheader()
        writer.writerows(rows)


def main() -> None:
    output_dir = Path(__file__).resolve().parent

    write_csv(
        output_dir / "sample_flight_normal.csv",
        generate_flight(120.0, seed=1, center=SCENARIO_LOCATIONS["normal"]),
    )
    write_csv(
        output_dir / "sample_gps_loss.csv",
        generate_flight(100.0, seed=2, inject=inject_gps_loss, center=SCENARIO_LOCATIONS["gps_loss"]),
    )
    write_csv(
        output_dir / "sample_battery_failure.csv",
        generate_flight(
            95.0, seed=3, inject=inject_battery_failure, center=SCENARIO_LOCATIONS["battery_failure"]
        ),
    )
    write_csv(
        output_dir / "sample_crash.csv",
        generate_flight(65.0, seed=4, inject=inject_crash, center=SCENARIO_LOCATIONS["crash"]),
    )

    print("Generated sample_flight_normal.csv, sample_gps_loss.csv, "
          "sample_battery_failure.csv, sample_crash.csv")


if __name__ == "__main__":
    main()
