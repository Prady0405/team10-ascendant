"""The deterministic math engine.

Pure functions over `TelemetryPoint` lists. No AI, no guessing — every
value here is a direct calculation (deltas, rates, magnitudes) that the
rule engine and statistics service consume. This module is the only place
that computes derived physics; rules.py only compares those numbers to
thresholds.
"""

from dataclasses import dataclass
from typing import Optional

from models.telemetry import TelemetryPoint
from utils.config import KINETIC_JITTER_WINDOW_SEC
from utils.helpers import haversine_distance_m


def _variance(values: list[float]) -> float:
    """Population variance: mean(x^2) - mean(x)^2."""
    mean = sum(values) / len(values)
    return sum(v ** 2 for v in values) / len(values) - mean ** 2


def _kinetic_jitter_variance(points: list[TelemetryPoint], index: int, window_seconds: float) -> Optional[float]:
    """Var(ax) + Var(ay) + Var(az) over samples within `window_seconds` trailing `index`.

    This is the sigma^2_K term in the signal-disruption probability model
    (services/forensics.py): a physically struggling airframe (fighting to
    hold position while blind) shows high-frequency accelerometer jitter,
    distinct from a calm, controlled flight.
    """
    latest_timestamp = points[index].timestamp
    ax_values, ay_values, az_values = [], [], []
    for lookback in range(index, -1, -1):
        if latest_timestamp - points[lookback].timestamp > window_seconds:
            break
        point = points[lookback]
        if None not in (point.acceleration_x, point.acceleration_y, point.acceleration_z):
            ax_values.append(point.acceleration_x)
            ay_values.append(point.acceleration_y)
            az_values.append(point.acceleration_z)

    if len(ax_values) < 3:
        return None
    return _variance(ax_values) + _variance(ay_values) + _variance(az_values)


@dataclass
class AnalyticsPoint:
    """Derived, per-sample metrics paired 1:1 with a TelemetryPoint."""

    index: int
    dt: Optional[float] = None  # seconds since previous point
    distance_m: Optional[float] = None  # horizontal distance since previous point
    cumulative_distance_m: float = 0.0
    horizontal_speed_m_s: Optional[float] = None  # computed from distance/dt, fallback for missing `speed`
    vertical_speed_m_s: Optional[float] = None  # positive = climbing, negative = descending
    battery_delta_pct: Optional[float] = None  # change since previous point
    battery_drain_rate_pct_s: Optional[float] = None
    gps_satellite_delta: Optional[int] = None
    signal_delta_pct: Optional[float] = None
    acceleration_magnitude_g: Optional[float] = None
    acceleration_jerk_g_s: Optional[float] = None  # rate of change of acceleration magnitude
    kinetic_jitter_variance: Optional[float] = None  # Var(ax) + Var(ay) + Var(az) over a trailing window
    gps_implied_acceleration_m_s2: Optional[float] = None  # d(horizontal_speed)/dt — a GPS-only "felt" acceleration
    distance_from_origin_m: Optional[float] = None


def compute_analytics(points: list[TelemetryPoint]) -> list[AnalyticsPoint]:
    """Compute derived metrics for every telemetry point.

    The first point always has zero/None deltas since there is no
    previous sample to diff against.
    """
    analytics: list[AnalyticsPoint] = []
    cumulative_distance = 0.0
    origin_lat: Optional[float] = points[0].latitude if points else None
    origin_lon: Optional[float] = points[0].longitude if points else None

    previous: Optional[TelemetryPoint] = None
    for index, point in enumerate(points):
        entry = AnalyticsPoint(index=index)

        if previous is not None:
            dt = point.timestamp - previous.timestamp
            entry.dt = dt if dt > 0 else None

            distance = haversine_distance_m(
                previous.latitude, previous.longitude, point.latitude, point.longitude
            )
            if distance is not None:
                entry.distance_m = distance
                cumulative_distance += distance
                if entry.dt:
                    entry.horizontal_speed_m_s = distance / entry.dt
                    previous_speed = analytics[-1].horizontal_speed_m_s if analytics else None
                    if previous_speed is not None:
                        entry.gps_implied_acceleration_m_s2 = (entry.horizontal_speed_m_s - previous_speed) / entry.dt

            if point.altitude is not None and previous.altitude is not None and entry.dt:
                entry.vertical_speed_m_s = (point.altitude - previous.altitude) / entry.dt

            if point.battery is not None and previous.battery is not None:
                entry.battery_delta_pct = point.battery - previous.battery
                if entry.dt:
                    entry.battery_drain_rate_pct_s = entry.battery_delta_pct / entry.dt

            if point.gps_satellites is not None and previous.gps_satellites is not None:
                entry.gps_satellite_delta = point.gps_satellites - previous.gps_satellites

            if point.signal_strength is not None and previous.signal_strength is not None:
                entry.signal_delta_pct = point.signal_strength - previous.signal_strength

        entry.cumulative_distance_m = cumulative_distance

        accel_components = [
            value
            for value in (point.acceleration_x, point.acceleration_y, point.acceleration_z)
            if value is not None
        ]
        if len(accel_components) == 3:
            entry.acceleration_magnitude_g = sum(c ** 2 for c in accel_components) ** 0.5

        if entry.acceleration_magnitude_g is not None and entry.dt and analytics:
            previous_magnitude = analytics[-1].acceleration_magnitude_g
            if previous_magnitude is not None:
                entry.acceleration_jerk_g_s = abs(entry.acceleration_magnitude_g - previous_magnitude) / entry.dt

        entry.kinetic_jitter_variance = _kinetic_jitter_variance(points, index, KINETIC_JITTER_WINDOW_SEC)

        entry.distance_from_origin_m = haversine_distance_m(
            origin_lat, origin_lon, point.latitude, point.longitude
        )

        analytics.append(entry)
        previous = point

    return analytics


def rolling_delta(
    points: list[TelemetryPoint],
    field: str,
    index: int,
    window_seconds: float,
) -> Optional[tuple[float, float, int]]:
    """Look back from `index` within `window_seconds` and return
    (earliest_value, latest_value, span_seconds) for `field`, or None if
    there isn't enough data in the window.
    """
    latest_point = points[index]
    latest_value = getattr(latest_point, field, None)
    if latest_value is None:
        return None

    earliest_index = index
    for lookback in range(index, -1, -1):
        if latest_point.timestamp - points[lookback].timestamp > window_seconds:
            break
        if getattr(points[lookback], field, None) is not None:
            earliest_index = lookback

    earliest_point = points[earliest_index]
    earliest_value = getattr(earliest_point, field, None)
    if earliest_value is None or earliest_index == index:
        return None

    span = latest_point.timestamp - earliest_point.timestamp
    return earliest_value, latest_value, span
