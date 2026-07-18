"""Converts raw source formats into the standard `TelemetryPoint` list.

Today: CSV. The `HEADER_ALIASES` map and the isolated `parse_csv` entry
point are what make adding MAVLink / DJI / PX4 / ESP32 parsers later a
matter of writing a new `parse_*` function that returns the same
`list[TelemetryPoint]` — analytics, rules, and statistics never change.
"""

import io
import math
from typing import Any, Optional

import pandas as pd
from fastapi import HTTPException

from models.telemetry import TelemetryPoint
from utils.helpers import (
    is_valid_latitude,
    is_valid_longitude,
    parse_combined_coordinates,
    parse_datetime,
    parse_timestamp_to_seconds,
    safe_float,
    safe_int,
)

# Maps every alternate/lowercase header spelling we might see onto our
# canonical TelemetryPoint field name.
HEADER_ALIASES: dict[str, str] = {
    "timestamp": "timestamp",
    "time": "timestamp",
    "time_sec": "timestamp",
    "time_s": "timestamp",
    "time_ms": "timestamp",
    "timestamp_sec": "timestamp",
    "timestamp_s": "timestamp",
    "timestamp_ms": "timestamp",
    "elapsed": "timestamp",
    "elapsed_time": "timestamp",
    "elapsed_seconds": "timestamp",
    "date": "timestamp",
    "datetime": "timestamp",
    "date_time": "timestamp",
    "ts": "timestamp",
    "epoch": "timestamp",
    "unix_time": "timestamp",
    "unixtime": "timestamp",
    "sec": "timestamp",
    "seconds": "timestamp",
    "lat": "latitude",
    "latitude": "latitude",
    "lon": "longitude",
    "lng": "longitude",
    "long": "longitude",
    "longitude": "longitude",
    "alt": "altitude",
    "altitude": "altitude",
    "alt_m": "altitude",
    "altitude_m": "altitude",
    "relative_altitude": "altitude",
    "speed": "speed",
    "speed_mps": "speed",
    "groundspeed": "speed",
    "ground_speed": "speed",
    "velocity": "speed",
    "battery": "battery",
    "battery_pct": "battery",
    "battery_percent": "battery",
    "batt": "battery",
    "roll": "roll",
    "pitch": "pitch",
    "yaw": "yaw",
    "heading": "yaw",
    "heading_deg": "yaw",
    "satellites": "gps_satellites",
    "gps_satellites": "gps_satellites",
    "satellite_count": "gps_satellites",
    "satellites_used": "gps_satellites",
    "sats": "gps_satellites",
    "num_sats": "gps_satellites",
    "hdop": "hdop",
    "gps_hdop": "hdop",
    "signal": "signal_strength",
    "signal_strength": "signal_strength",
    "rssi": "signal_strength",
    "rc_rssi": "signal_strength",
    "accel_x": "acceleration_x",
    "acceleration_x": "acceleration_x",
    "ax": "acceleration_x",
    "accel_y": "acceleration_y",
    "acceleration_y": "acceleration_y",
    "ay": "acceleration_y",
    "accel_z": "acceleration_z",
    "acceleration_z": "acceleration_z",
    "az": "acceleration_z",
}

REQUIRED_FIELD: str = "timestamp"

# Headers (post-normalization) whose values are milliseconds, not seconds —
# common in flight-controller logs (e.g. PX4's time_boot_ms). Values from
# these columns get divided by 1000 after parsing so elapsed-seconds stays
# the one true unit everywhere downstream.
MILLISECOND_TIMESTAMP_HEADERS: set[str] = {"time_ms", "timestamp_ms"}

# Headers (post-normalization) carrying BOTH latitude and longitude in one
# cell, e.g. "35.6762,139.6503" — real-time drone telemetry (and plenty of
# GPS loggers) often emit a single combined field instead of separate lat/
# lon columns. Used as a fallback only: explicit latitude/longitude columns
# take priority if present. See utils.helpers.parse_combined_coordinates.
COMBINED_COORDINATE_HEADERS: set[str] = {
    "coordinates",
    "coordinate",
    "coords",
    "gps_coordinates",
    "gps_coordinate",
    "gps_position",
    "lat_lon",
    "latlon",
    "position",
}

INT_FIELDS = {"gps_satellites"}
FLOAT_FIELDS = {
    "altitude",
    "speed",
    "battery",
    "roll",
    "pitch",
    "yaw",
    "hdop",
    "signal_strength",
    "acceleration_x",
    "acceleration_y",
    "acceleration_z",
}


def _normalize_header(raw_header: str) -> str:
    normalized = raw_header.strip().lower().replace(" ", "_").replace("-", "_")
    # Strip stray decorator characters some exporters add (e.g. ROS bag CSV
    # exports headers like "%time"), so "%time" still matches "time".
    return normalized.strip("%#_") or normalized


def _detect_numeric_timestamp_scale(first_value: float) -> tuple[float, float]:
    """Returns (divisor, baseline_in_divided_units) to normalize a numeric
    timestamp column into elapsed seconds.

    Real-world logs mix conventions: a small counter (0, 1, 2, ...) is
    already elapsed seconds (or elapsed-milliseconds if the header says so
    — see MILLISECOND_TIMESTAMP_HEADERS). But sensor/ROS exports often use
    an *absolute* epoch timestamp, and not always in seconds — ROS bag CSV
    exports (header "%time") are nanoseconds since epoch, for example.
    Magnitude alone reliably distinguishes these: any modern epoch value
    (year 2001+) is >= 1e9 in seconds, >= 1e11 in milliseconds, >= 1e14 in
    microseconds, >= 1e17 in nanoseconds — all far larger than any
    realistic relative mission counter.
    """
    magnitude = abs(first_value)
    if magnitude >= 1e17:
        divisor = 1e9
    elif magnitude >= 1e14:
        divisor = 1e6
    elif magnitude >= 1e11:
        divisor = 1e3
    elif magnitude >= 1e8:
        divisor = 1.0
    else:
        return 1.0, 0.0  # already a small relative counter — leave as-is
    return divisor, first_value / divisor


def _build_column_map(columns: list[str]) -> dict[str, str]:
    """Map raw CSV column names to canonical telemetry fields, best-effort."""
    column_map: dict[str, str] = {}
    for raw in columns:
        normalized = _normalize_header(str(raw))
        canonical = HEADER_ALIASES.get(normalized)
        if canonical and canonical not in column_map.values():
            column_map[raw] = canonical
    return column_map


def parse_csv(file_bytes: bytes, source: str = "csv") -> list[TelemetryPoint]:
    """Parse an uploaded CSV file into normalized telemetry points.

    Raises HTTPException(400) for empty files, missing timestamp data, or
    files pandas cannot read as CSV at all. Any other missing column or
    malformed cell is tolerated and becomes `None` on the point.
    """
    if not file_bytes:
        raise HTTPException(status_code=400, detail="Uploaded file is empty")

    try:
        dataframe = pd.read_csv(io.BytesIO(file_bytes))
    except Exception as exc:  # pandas raises many different error types
        raise HTTPException(status_code=400, detail=f"Could not parse CSV: {exc}") from exc

    if dataframe.empty:
        raise HTTPException(status_code=400, detail="CSV contains no data rows")

    column_map = _build_column_map(list(dataframe.columns))
    if not any(canonical == REQUIRED_FIELD for canonical in column_map.values()):
        raise HTTPException(
            status_code=400,
            detail=(
                "CSV is missing a timestamp column (accepted: timestamp, time, date, datetime, "
                "elapsed, ts, sec, seconds, epoch, or a *_ms/*_s variant of these)"
            ),
        )

    timestamp_raw_col = next(col for col, canonical in column_map.items() if canonical == "timestamp")
    timestamp_header_says_ms = _normalize_header(str(timestamp_raw_col)) in MILLISECOND_TIMESTAMP_HEADERS

    combined_coord_raw_col = next(
        (col for col in dataframe.columns if _normalize_header(str(col)) in COMBINED_COORDINATE_HEADERS),
        None,
    )

    mission_start = None
    numeric_divisor, numeric_baseline = 1.0, 0.0
    first_numeric_value = next(
        (v for v in (safe_float(raw) for raw in dataframe[timestamp_raw_col]) if v is not None), None
    )
    if first_numeric_value is not None:
        numeric_divisor, numeric_baseline = _detect_numeric_timestamp_scale(first_numeric_value)
        if numeric_divisor == 1.0 and numeric_baseline == 0.0 and timestamp_header_says_ms:
            # No epoch magnitude detected, but the header itself says
            # milliseconds (e.g. PX4's time_boot_ms) — a small relative
            # counter in ms, not seconds.
            numeric_divisor = 1000.0
    else:
        for raw_value in dataframe[timestamp_raw_col]:
            if pd.isna(raw_value):
                continue
            mission_start = parse_datetime(raw_value)
            break

    points: list[TelemetryPoint] = []
    dropped_invalid_coords = 0

    for row_index, row in dataframe.iterrows():
        mapped: dict[str, Any] = {}
        extra: dict[str, Any] = {}
        for raw_col, value in row.items():
            canonical = column_map.get(raw_col)
            if canonical is None:
                if pd.notna(value):
                    extra[str(raw_col)] = value
                continue
            mapped[canonical] = value

        elapsed_seconds = parse_timestamp_to_seconds(mapped.get("timestamp"), mission_start)
        if elapsed_seconds is None:
            # Row has no usable timestamp; skip it rather than corrupting ordering.
            continue
        if first_numeric_value is not None:
            elapsed_seconds = elapsed_seconds / numeric_divisor - numeric_baseline

        latitude = safe_float(mapped.get("latitude"))
        longitude = safe_float(mapped.get("longitude"))
        if latitude is not None and not is_valid_latitude(latitude):
            latitude = None
            dropped_invalid_coords += 1
        if longitude is not None and not is_valid_longitude(longitude):
            longitude = None
            dropped_invalid_coords += 1

        if (latitude is None or longitude is None) and combined_coord_raw_col is not None:
            combined = parse_combined_coordinates(row.get(combined_coord_raw_col))
            if combined is not None:
                combined_lat, combined_lon = combined
                if latitude is None and is_valid_latitude(combined_lat):
                    latitude = combined_lat
                if longitude is None and is_valid_longitude(combined_lon):
                    longitude = combined_lon

        point_kwargs: dict[str, Any] = {
            "timestamp": elapsed_seconds,
            "latitude": latitude,
            "longitude": longitude,
            "source": source,
            "extra": extra,
        }
        for field in FLOAT_FIELDS:
            point_kwargs[field] = safe_float(mapped.get(field))
        for field in INT_FIELDS:
            point_kwargs[field] = safe_int(mapped.get(field))

        _derive_tilt_from_accel(point_kwargs)

        points.append(TelemetryPoint(**point_kwargs))

    if not points:
        raise HTTPException(status_code=400, detail="No rows had a valid, parseable timestamp")

    points.sort(key=lambda p: p.timestamp)
    return points


def _derive_tilt_from_accel(point_kwargs: dict[str, Any]) -> None:
    """Fill in roll/pitch from raw accelerometer g-components when the
    device didn't compute its own orientation (e.g. a bare IMU on an
    ESP32 with no onboard sensor fusion).

    Standard accelerometer-tilt formulas, accurate when the sensor isn't
    also undergoing strong linear acceleration. Yaw cannot be derived this
    way (no magnetometer) and is left as whatever the source provided.
    """
    ax, ay, az = point_kwargs.get("acceleration_x"), point_kwargs.get("acceleration_y"), point_kwargs.get("acceleration_z")
    if point_kwargs.get("roll") is None and ay is not None and az is not None and (ay, az) != (0, 0):
        point_kwargs["roll"] = math.degrees(math.atan2(ay, az))
    if point_kwargs.get("pitch") is None and None not in (ax, ay, az):
        point_kwargs["pitch"] = math.degrees(math.atan2(-ax, math.sqrt(ay ** 2 + az ** 2)))


def esp32_packet_to_point(
    packet: dict[str, Any], source: str = "esp32", fallback_timestamp: Optional[float] = None
) -> Optional[TelemetryPoint]:
    """Normalize a single decoded ESP32/IMU telemetry packet.

    Mapped through the same `HEADER_ALIASES` table used for CSV so the
    rest of the pipeline (analytics, rules, statistics) is completely
    agnostic to whether a point came from a CSV row or a live packet.

    If the packet has no timestamp field (common for bare IMU firmware
    that only sends sensor values), `fallback_timestamp` — typically the
    session's elapsed wall-clock time at receipt — is used instead.
    """
    mapped: dict[str, Any] = {}
    extra: dict[str, Any] = {}
    for raw_key, value in packet.items():
        canonical = HEADER_ALIASES.get(_normalize_header(raw_key))
        if canonical is None:
            extra[raw_key] = value
        else:
            mapped[canonical] = value

    elapsed_seconds = parse_timestamp_to_seconds(mapped.get("timestamp"))
    if elapsed_seconds is None:
        elapsed_seconds = fallback_timestamp
    if elapsed_seconds is None:
        return None

    latitude = safe_float(mapped.get("latitude"))
    longitude = safe_float(mapped.get("longitude"))
    if latitude is not None and not is_valid_latitude(latitude):
        latitude = None
    if longitude is not None and not is_valid_longitude(longitude):
        longitude = None

    point_kwargs: dict[str, Any] = {
        "timestamp": elapsed_seconds,
        "latitude": latitude,
        "longitude": longitude,
        "source": source,
        "extra": extra,
    }
    for field in FLOAT_FIELDS:
        point_kwargs[field] = safe_float(mapped.get(field))
    for field in INT_FIELDS:
        point_kwargs[field] = safe_int(mapped.get(field))

    _derive_tilt_from_accel(point_kwargs)

    return TelemetryPoint(**point_kwargs)
