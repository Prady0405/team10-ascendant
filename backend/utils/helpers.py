"""Small stateless math and parsing helpers shared across services."""

import math
import re
from datetime import datetime
from typing import Any, Optional

# Matches a signed decimal number optionally wrapped by a compass letter
# (N/S/E/W) on either side and an optional degree symbol, e.g. "35.6762",
# "-122.4194", "35.6762N", "N 35.6762", "18.5204° N". Two of these found in
# a string, in order, are treated as (latitude, longitude) — this is what
# lets a single "coordinates" column work regardless of separator style
# (comma, space, semicolon, parentheses) and regardless of hemisphere.
_COORDINATE_TOKEN_PATTERN = re.compile(r"([NSEWnsew]?)\s*(-?\d+\.?\d*)\s*°?\s*([NSEWnsew]?)")


def safe_float(value: Any) -> Optional[float]:
    """Convert a value to float, returning None instead of raising."""
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    try:
        result = float(value)
    except (TypeError, ValueError):
        return None
    if math.isnan(result) or math.isinf(result):
        return None
    return result


def safe_int(value: Any) -> Optional[int]:
    """Convert a value to int, returning None instead of raising."""
    as_float = safe_float(value)
    if as_float is None:
        return None
    return int(round(as_float))


def haversine_distance_m(
    lat1: Optional[float], lon1: Optional[float], lat2: Optional[float], lon2: Optional[float]
) -> Optional[float]:
    """Great-circle distance in meters between two lat/lon points."""
    if None in (lat1, lon1, lat2, lon2):
        return None
    radius_earth_m = 6371000.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    return radius_earth_m * c


def is_valid_latitude(value: Optional[float]) -> bool:
    return value is not None and -90.0 <= value <= 90.0


def is_valid_longitude(value: Optional[float]) -> bool:
    return value is not None and -180.0 <= value <= 180.0


def parse_datetime(value: Any) -> Optional[datetime]:
    """Best-effort parse of a raw cell into a datetime, or None."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None

    for candidate in (text, text.replace("Z", "+00:00")):
        try:
            return datetime.fromisoformat(candidate)
        except ValueError:
            continue

    known_formats = (
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d %H:%M:%S.%f",
        "%m/%d/%Y %H:%M:%S",
    )
    for fmt in known_formats:
        try:
            return datetime.strptime(text, fmt)
        except ValueError:
            continue
    return None


def parse_timestamp_to_seconds(value: Any, mission_start: Optional[datetime] = None) -> Optional[float]:
    """Best-effort conversion of a raw timestamp cell into elapsed seconds.

    Accepts plain numbers (already elapsed seconds) or datetime strings.
    When the cell is a datetime string, `mission_start` (the mission's
    first timestamp, itself resolved via `parse_datetime`) must be
    supplied so elapsed seconds are relative to the start of the flight.
    Returns None if the value is unparseable as either.
    """
    if value is None:
        return None

    numeric = safe_float(value)
    if numeric is not None:
        return numeric

    parsed_dt = parse_datetime(value)
    if parsed_dt is None:
        return None
    if mission_start is None:
        return 0.0
    return (parsed_dt - mission_start).total_seconds()


def clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def parse_combined_coordinates(value: Any) -> Optional[tuple[float, float]]:
    """Extracts (latitude, longitude) from a single combined-coordinates
    cell, e.g. "35.6762,139.6503", "(18.5204, 73.8567)", "35.6762 -122.4194",
    or "35.6892° N, 51.3890° E" — works for any location on Earth, in any
    hemisphere, since a leading/trailing N/S/E/W (or its absence, i.e. a
    plain signed number) is what determines the sign.
    """
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None

    numbers: list[float] = []
    for prefix, number_str, suffix in _COORDINATE_TOKEN_PATTERN.findall(text):
        if not number_str:
            continue
        try:
            number = float(number_str)
        except ValueError:
            continue
        direction = (prefix or suffix).upper()
        if direction in ("S", "W"):
            number = -abs(number)
        elif direction in ("N", "E"):
            number = abs(number)
        numbers.append(number)
        if len(numbers) == 2:
            break

    if len(numbers) < 2:
        return None
    return numbers[0], numbers[1]
