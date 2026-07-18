"""The deterministic rule engine.

NO AI HERE. Every function below is a pure comparison of analytics.py
output against fixed thresholds from utils/config.py. Each detector
returns zero or more `Incident` objects, always carrying structured
`Evidence` — never bare text.

Two placeholder rules (`detect_return_to_home_failure`,
`detect_geofence_breach`) are included per the architecture spec but
always return an empty list: generic open-telemetry logs don't carry an
RTH-triggered flag or a geofence polygon, so there is nothing deterministic
to check yet. They exist so a future parser that *does* supply that data
only needs to fill in the body.
"""

from typing import Callable

from models.incident import Evidence, Incident
from models.telemetry import TelemetryPoint
from services import forensics
from services.analytics import AnalyticsPoint, rolling_delta
from utils import config
from utils.helpers import clamp, haversine_distance_m

TYPE_TITLES: dict[str, str] = {
    "battery_rapid_drain": "Rapid Battery Drain",
    "power_failure": "Physical Power Failure",
    "battery_warning": "Battery Below Warning Threshold",
    "battery_critical": "Battery Below Critical Threshold",
    "rapid_descent": "Rapid Descent",
    "crash": "Crash Detected",
    "hard_landing": "Hard Landing",
    "gps_degradation": "GPS Signal Degradation",
    "gps_loss": "GPS Signal Loss",
    "external_signal_interference": "External Signal Interference / Jamming",
    "gps_spoofing": "GPS Spoofing Detected",
    "excessive_roll": "Excessive Roll",
    "excessive_pitch": "Excessive Pitch",
    "orientation_flip": "Orientation Flip (Inverted)",
    "possible_collision": "Possible Collision / Sudden Stop",
    "free_fall": "Free Fall Detected",
    "excessive_speed": "Excessive Speed",
    "hover_anomaly": "Unstable Hover",
    "signal_loss": "Telemetry Signal Loss",
    "signal_degradation": "Telemetry Signal Degradation",
    "sudden_acceleration": "Sudden Acceleration Spike",
    "stationary_hovering": "Extended Stationary Hover",
    "loiter_pattern": "Loiter Pattern Detected",
    "return_to_home_failure": "Return-to-Home Failure",
    "geofence_breach": "Geofence Breach",
}

# Deterministic liability framing per incident type — (category, hint).
# This is rule-driven, never guessed by the AI layer: the narrative engine
# (services/gemini.py) may reference these hints but is never allowed to
# invent its own. `liability_category` also drives the frontend's risk
# distribution breakdown (jamming / spoofing / hardware / pilot_error /
# structural). Types with no entry (informational rules like loiter) have
# no liability implication and are left as None.
TYPE_LIABILITY: dict[str, tuple[str, str]] = {
    "external_signal_interference": ("jamming", "Exonerates operator — verifiable third-party signal disruption"),
    "gps_loss": ("jamming", "Exonerates operator — GPS lock lost alongside other degraded telemetry"),
    "gps_degradation": ("jamming", "Monitor — signal quality degraded, insufficient alone for attribution"),
    "signal_loss": ("jamming", "Monitor — telemetry link degraded, insufficient alone for attribution"),
    "signal_degradation": ("jamming", "Monitor — telemetry link degraded, insufficient alone for attribution"),
    "gps_spoofing": ("spoofing", "Exonerates operator — GPS position data spoofed by an external source"),
    "power_failure": ("hardware", "Warranty claim candidate — abrupt power system malfunction"),
    "battery_rapid_drain": ("hardware", "Warranty claim candidate — abnormal battery discharge rate"),
    "battery_critical": ("hardware", "Warranty claim candidate — battery system reached critical depletion"),
    "battery_warning": ("hardware", "Monitor — battery depletion below warning threshold"),
    "excessive_roll": ("pilot_error", "Review operator input — roll threshold exceedance"),
    "excessive_pitch": ("pilot_error", "Review operator input — pitch threshold exceedance"),
    "excessive_speed": ("pilot_error", "Review operator input — speed threshold exceedance"),
    "hover_anomaly": ("pilot_error", "Review operator input — unstable hover control"),
    "sudden_acceleration": ("structural", "Root cause requires correlation with surrounding incidents"),
    "rapid_descent": ("structural", "Root cause requires correlation with surrounding incidents"),
    "crash": ("structural", "Structural loss event — root cause requires correlation with preceding incidents"),
    "hard_landing": ("structural", "Possible structural damage — root cause requires correlation with preceding incidents"),
    "possible_collision": ("structural", "Structural shock event — root cause requires correlation with preceding incidents"),
    "free_fall": ("structural", "Uncontrolled fall event — root cause requires correlation with preceding incidents"),
    "orientation_flip": ("structural", "Loss of control event — root cause requires correlation with preceding incidents"),
}


def _confidence(margin_ratio: float) -> float:
    """Map how far a value exceeds its threshold (as a ratio) to a
    confidence score. Comfortably over threshold -> high confidence.
    """
    return clamp(0.6 + margin_ratio * 0.4, 0.6, 0.99)


def _make_incident(
    incident_type: str,
    severity: str,
    confidence: float,
    point_index: int,
    timestamp: float,
    evidence: list[Evidence],
) -> Incident:
    liability_category, liability_hint = TYPE_LIABILITY.get(incident_type, (None, None))
    return Incident(
        id=f"pending-{point_index}-{incident_type}",
        type=incident_type,
        title=TYPE_TITLES.get(incident_type, incident_type.replace("_", " ").title()),
        severity=severity,
        confidence=round(confidence, 2),
        timestamp=timestamp,
        telemetry_index=point_index,
        evidence=evidence,
        liability_category=liability_category,
        liability_hint=liability_hint,
    )


def _rising_edges(flags: list[bool]) -> list[int]:
    """Indices where the condition goes from False (or start) to True."""
    edges = []
    previous = False
    for index, flag in enumerate(flags):
        if flag and not previous:
            edges.append(index)
        previous = flag
    return edges


def detect_rapid_battery_drain(points: list[TelemetryPoint]) -> list[Incident]:
    """Scenario A style detection: battery falling fast within a short window."""
    incidents: list[Incident] = []
    in_power_failure = False
    in_rapid_drain = False

    for index in range(len(points)):
        failure_window = rolling_delta(points, "battery", index, config.BATTERY_POWER_FAILURE_WINDOW_SEC)
        is_power_failure = bool(
            failure_window and (failure_window[0] - failure_window[1]) >= config.BATTERY_POWER_FAILURE_PCT
        )
        if is_power_failure and not in_power_failure:
            before, after, span = failure_window
            drop = before - after
            incidents.append(
                _make_incident(
                    "power_failure",
                    "critical",
                    _confidence(drop / config.BATTERY_POWER_FAILURE_PCT - 1),
                    index,
                    points[index].timestamp,
                    [
                        Evidence(
                            parameter="battery",
                            before_value=before,
                            after_value=after,
                            threshold=config.BATTERY_POWER_FAILURE_PCT,
                            unit="percent",
                            window_seconds=span,
                            reason=(
                                f"Battery dropped {drop:.1f}% within {span:.1f}s "
                                f"(threshold {config.BATTERY_POWER_FAILURE_PCT}% in "
                                f"{config.BATTERY_POWER_FAILURE_WINDOW_SEC}s) — consistent with physical power failure"
                            ),
                        )
                    ],
                )
            )
        in_power_failure = is_power_failure

        drain_window = rolling_delta(points, "battery", index, config.BATTERY_RAPID_DRAIN_WINDOW_SEC)
        is_rapid_drain = bool(
            drain_window and (drain_window[0] - drain_window[1]) >= config.BATTERY_RAPID_DRAIN_PCT
        )
        if is_rapid_drain and not in_rapid_drain and not is_power_failure:
            before, after, span = drain_window
            drop = before - after
            incidents.append(
                _make_incident(
                    "battery_rapid_drain",
                    "warning",
                    _confidence(drop / config.BATTERY_RAPID_DRAIN_PCT - 1),
                    index,
                    points[index].timestamp,
                    [
                        Evidence(
                            parameter="battery",
                            before_value=before,
                            after_value=after,
                            threshold=config.BATTERY_RAPID_DRAIN_PCT,
                            unit="percent",
                            window_seconds=span,
                            reason=f"Battery dropped {drop:.1f}% within {span:.1f}s",
                        )
                    ],
                )
            )
        in_rapid_drain = is_rapid_drain

    return incidents


def detect_battery_thresholds(points: list[TelemetryPoint]) -> list[Incident]:
    incidents: list[Incident] = []
    for tier_type, threshold, severity in (
        ("battery_warning", config.BATTERY_WARNING_PCT, "warning"),
        ("battery_critical", config.BATTERY_CRITICAL_PCT, "critical"),
    ):
        flags = [p.battery is not None and p.battery <= threshold for p in points]
        for index in _rising_edges(flags):
            point = points[index]
            incidents.append(
                _make_incident(
                    tier_type,
                    severity,
                    _confidence((threshold - point.battery) / threshold),
                    index,
                    point.timestamp,
                    [
                        Evidence(
                            parameter="battery",
                            after_value=point.battery,
                            threshold=threshold,
                            unit="percent",
                            reason=f"Battery reached {point.battery:.1f}%, at or below the {threshold}% {severity} threshold",
                        )
                    ],
                )
            )
    return incidents


def detect_descent_events(points: list[TelemetryPoint], analytics: list[AnalyticsPoint]) -> list[Incident]:
    incidents: list[Incident] = []
    rapid_flags = [
        a.vertical_speed_m_s is not None and a.vertical_speed_m_s <= -config.RAPID_DESCENT_RATE_M_S
        for a in analytics
    ]
    for index in _rising_edges(rapid_flags):
        point, entry = points[index], analytics[index]
        incidents.append(
            _make_incident(
                "rapid_descent",
                "warning",
                _confidence(abs(entry.vertical_speed_m_s) / config.RAPID_DESCENT_RATE_M_S - 1),
                index,
                point.timestamp,
                [
                    Evidence(
                        parameter="vertical_speed",
                        after_value=round(entry.vertical_speed_m_s, 2),
                        threshold=-config.RAPID_DESCENT_RATE_M_S,
                        unit="m/s",
                        reason=f"Descending at {abs(entry.vertical_speed_m_s):.1f} m/s, exceeding rapid-descent threshold",
                    )
                ],
            )
        )

    for index, (point, entry) in enumerate(zip(points, analytics)):
        if entry.vertical_speed_m_s is None or point.altitude is None:
            continue
        descent_rate = abs(entry.vertical_speed_m_s)
        if entry.vertical_speed_m_s >= 0:
            continue
        if point.altitude <= config.CRASH_FINAL_ALTITUDE_M and descent_rate >= config.CRASH_DESCENT_RATE_M_S:
            incidents.append(
                _make_incident(
                    "crash",
                    "critical",
                    _confidence(descent_rate / config.CRASH_DESCENT_RATE_M_S - 1),
                    index,
                    point.timestamp,
                    [
                        Evidence(
                            parameter="altitude",
                            after_value=point.altitude,
                            threshold=config.CRASH_FINAL_ALTITUDE_M,
                            unit="m",
                            reason=(
                                f"Altitude reached {point.altitude:.1f}m while descending at "
                                f"{descent_rate:.1f} m/s — consistent with ground impact"
                            ),
                        )
                    ],
                )
            )
        elif (
            point.altitude <= config.HARD_LANDING_MAX_ALTITUDE_M
            and config.HARD_LANDING_VERTICAL_SPEED_M_S <= descent_rate < config.CRASH_DESCENT_RATE_M_S
        ):
            incidents.append(
                _make_incident(
                    "hard_landing",
                    "warning",
                    _confidence(descent_rate / config.HARD_LANDING_VERTICAL_SPEED_M_S - 1),
                    index,
                    point.timestamp,
                    [
                        Evidence(
                            parameter="altitude",
                            after_value=point.altitude,
                            threshold=config.HARD_LANDING_MAX_ALTITUDE_M,
                            unit="m",
                            reason=f"Touched down at {descent_rate:.1f} m/s descent rate near ground level",
                        )
                    ],
                )
            )

    return incidents


def detect_gps_events(points: list[TelemetryPoint], analytics: list[AnalyticsPoint]) -> list[Incident]:
    incidents: list[Incident] = []
    in_loss = False
    in_degraded = False

    for index in range(len(points)):
        window = rolling_delta(points, "gps_satellites", index, config.GPS_LOSS_WINDOW_SEC)
        point = points[index]

        is_loss = bool(
            window
            and (window[0] - window[1]) >= config.GPS_LOSS_DROP_COUNT
            and window[1] <= config.GPS_LOSS_SATELLITE_COUNT
        )
        if is_loss and not in_loss:
            before, after, span = window
            healthy_battery = point.battery is None or point.battery >= 50.0
            incident_type = "external_signal_interference" if healthy_battery else "gps_loss"

            disruption_probability = forensics.signal_disruption_probability(
                delta_satellites=before - after,
                hdop=point.hdop,
                kinetic_jitter_variance=analytics[index].kinetic_jitter_variance,
            )
            evidence = [
                Evidence(
                    parameter="gps_satellites",
                    before_value=before,
                    after_value=after,
                    threshold=config.GPS_LOSS_SATELLITE_COUNT,
                    unit="satellites",
                    window_seconds=span,
                    reason=(
                        f"Satellite count fell from {before} to {after} within {span:.1f}s while battery "
                        + ("remained healthy" if healthy_battery else "was also degraded")
                    ),
                ),
                Evidence(
                    parameter="signal_disruption_probability",
                    after_value=round(disruption_probability, 3),
                    threshold=config.SIGNAL_DISRUPTION_PROBABILITY_THRESHOLD,
                    reason=(
                        f"Statistical model (satellite drop"
                        + (", HDOP" if point.hdop is not None else "")
                        + (", kinetic jitter" if analytics[index].kinetic_jitter_variance is not None else "")
                        + f") estimates a {disruption_probability:.0%} probability of localized signal disruption"
                    ),
                ),
            ]
            incidents.append(
                _make_incident(
                    incident_type,
                    "critical",
                    max(disruption_probability, _confidence((before - after) / config.GPS_LOSS_DROP_COUNT - 1)),
                    index,
                    point.timestamp,
                    evidence,
                )
            )
        in_loss = is_loss

        is_degraded = bool(
            point.gps_satellites is not None
            and config.GPS_LOSS_SATELLITE_COUNT < point.gps_satellites <= config.GPS_DEGRADATION_SATELLITE_COUNT
        )
        if is_degraded and not in_degraded and not is_loss:
            incidents.append(
                _make_incident(
                    "gps_degradation",
                    "warning",
                    _confidence(1 - point.gps_satellites / config.GPS_DEGRADATION_SATELLITE_COUNT),
                    index,
                    point.timestamp,
                    [
                        Evidence(
                            parameter="gps_satellites",
                            after_value=point.gps_satellites,
                            threshold=config.GPS_DEGRADATION_SATELLITE_COUNT,
                            unit="satellites",
                            reason=f"Satellite count dropped to {point.gps_satellites}, below the healthy-lock threshold",
                        )
                    ],
                )
            )
        in_degraded = is_degraded

    return incidents


def detect_gps_spoofing(points: list[TelemetryPoint], analytics: list[AnalyticsPoint]) -> list[Incident]:
    """Cross-validates the GPS track against the IMU.

    Constant-velocity cruise flight reads as ~1g on the accelerometer too
    (Newton's first law — no net force, no net acceleration), so "moving
    fast with a calm IMU" alone would flag every ordinary flight. The real
    tell is a *sudden, implausible jump* in GPS-implied speed — a step
    change a real airframe's inertia cannot produce — with no
    corresponding spike in *measured* acceleration. A real speed change
    always shows up on the accelerometer; a spoofed position track can
    only fake the GPS output, not the physics the IMU actually feels.
    """
    incidents: list[Incident] = []
    in_spoofing = False

    for index, entry in enumerate(analytics):
        is_spoofing = bool(
            entry.gps_implied_acceleration_m_s2 is not None
            and entry.acceleration_magnitude_g is not None
            and abs(entry.gps_implied_acceleration_m_s2) >= config.SPOOFING_GPS_JUMP_ACCEL_M_S2
            and entry.acceleration_magnitude_g <= config.SPOOFING_MAX_ACCEL_MAGNITUDE_G
        )

        if is_spoofing and not in_spoofing:
            point = points[index]
            incidents.append(
                _make_incident(
                    "gps_spoofing",
                    "critical",
                    _confidence(abs(entry.gps_implied_acceleration_m_s2) / config.SPOOFING_GPS_JUMP_ACCEL_M_S2 - 1),
                    index,
                    point.timestamp,
                    [
                        Evidence(
                            parameter="gps_implied_acceleration_vs_measured_acceleration",
                            before_value=round(entry.acceleration_magnitude_g, 3),
                            after_value=round(entry.gps_implied_acceleration_m_s2, 2),
                            threshold=config.SPOOFING_GPS_JUMP_ACCEL_M_S2,
                            unit="m/s^2 vs g",
                            reason=(
                                f"GPS track implied a {entry.gps_implied_acceleration_m_s2:.1f} m/s^2 speed change "
                                f"while the accelerometer read only {entry.acceleration_magnitude_g:.2f}g — no real "
                                "airframe could change speed that fast without the IMU feeling it, so the GPS "
                                "position track itself is likely spoofed"
                            ),
                        )
                    ],
                )
            )
        in_spoofing = is_spoofing

    return incidents


def _detect_field_threshold(
    points: list[TelemetryPoint],
    field: str,
    threshold: float,
    incident_type: str,
    severity: str,
    unit: str,
    comparator: Callable[[float, float], bool] = lambda value, threshold: abs(value) > threshold,
) -> list[Incident]:
    flags = [
        getattr(p, field) is not None and comparator(getattr(p, field), threshold) for p in points
    ]
    incidents: list[Incident] = []
    for index in _rising_edges(flags):
        point = points[index]
        value = getattr(point, field)
        incidents.append(
            _make_incident(
                incident_type,
                severity,
                _confidence(abs(abs(value) - threshold) / threshold),
                index,
                point.timestamp,
                [
                    Evidence(
                        parameter=field,
                        after_value=round(value, 2),
                        threshold=threshold,
                        unit=unit,
                        reason=f"{field} reached {value:.1f}{unit}, exceeding the {threshold}{unit} threshold",
                    )
                ],
            )
        )
    return incidents


def detect_excessive_attitude(points: list[TelemetryPoint]) -> list[Incident]:
    return _detect_field_threshold(
        points, "roll", config.EXCESSIVE_ROLL_DEG, "excessive_roll", "warning", "deg"
    ) + _detect_field_threshold(
        points, "pitch", config.EXCESSIVE_PITCH_DEG, "excessive_pitch", "warning", "deg"
    )


def detect_excessive_speed(points: list[TelemetryPoint]) -> list[Incident]:
    return _detect_field_threshold(
        points,
        "speed",
        config.EXCESSIVE_SPEED_M_S,
        "excessive_speed",
        "warning",
        "m/s",
        comparator=lambda value, threshold: value > threshold,
    )


def detect_orientation_flip(points: list[TelemetryPoint]) -> list[Incident]:
    """Detects the vehicle going fully inverted — roll or pitch swinging past
    the flip threshold. Primarily aimed at IMU-only sources (e.g. an ESP32
    standing in for a drone) where attitude is the main signal available.
    """
    flags = [
        (p.roll is not None and abs(p.roll) > config.FLIP_ROLL_DEG)
        or (p.pitch is not None and abs(p.pitch) > config.FLIP_PITCH_DEG)
        for p in points
    ]
    incidents: list[Incident] = []
    for index in _rising_edges(flags):
        point = points[index]
        margin = max(
            abs(point.roll) - config.FLIP_ROLL_DEG if point.roll is not None else 0.0,
            abs(point.pitch) - config.FLIP_PITCH_DEG if point.pitch is not None else 0.0,
        )
        evidence = [
            Evidence(
                parameter="roll",
                after_value=point.roll,
                threshold=config.FLIP_ROLL_DEG,
                unit="deg",
                reason=f"Roll reached {point.roll:.1f} deg" if point.roll is not None else "Roll unavailable",
            ),
            Evidence(
                parameter="pitch",
                after_value=point.pitch,
                threshold=config.FLIP_PITCH_DEG,
                unit="deg",
                reason=f"Pitch reached {point.pitch:.1f} deg" if point.pitch is not None else "Pitch unavailable",
            ),
        ]
        if point.acceleration_z is not None:
            evidence.append(
                Evidence(
                    parameter="acceleration_z",
                    after_value=point.acceleration_z,
                    unit="g",
                    reason=(
                        f"Z-axis acceleration read {point.acceleration_z:.2f}g "
                        "(negative indicates gravity pulling the opposite way — consistent with being upside down)"
                    ),
                )
            )
        incidents.append(
            _make_incident(
                "orientation_flip",
                "critical",
                _confidence(margin / config.FLIP_ROLL_DEG),
                index,
                point.timestamp,
                evidence,
            )
        )
    return incidents


def detect_collision(points: list[TelemetryPoint], analytics: list[AnalyticsPoint]) -> list[Incident]:
    """Detects a sudden shock to the IMU: a sharp spike in acceleration
    magnitude over a very short time. This covers both an impact (collision)
    and an abrupt stop — both look identical to an accelerometer, so the
    evidence is reported as "possible" and left for a human/AI to interpret
    alongside surrounding context (e.g. altitude, speed).
    """
    flags = [
        a.acceleration_jerk_g_s is not None and a.acceleration_jerk_g_s > config.COLLISION_JERK_G_PER_S
        for a in analytics
    ]
    incidents: list[Incident] = []
    for index in _rising_edges(flags):
        point, entry = points[index], analytics[index]
        previous_magnitude = analytics[index - 1].acceleration_magnitude_g if index > 0 else None
        incidents.append(
            _make_incident(
                "possible_collision",
                "critical",
                _confidence(entry.acceleration_jerk_g_s / config.COLLISION_JERK_G_PER_S - 1),
                index,
                point.timestamp,
                [
                    Evidence(
                        parameter="acceleration_jerk",
                        before_value=round(previous_magnitude, 2) if previous_magnitude is not None else None,
                        after_value=round(entry.acceleration_magnitude_g, 2),
                        threshold=config.COLLISION_JERK_G_PER_S,
                        unit="g/s",
                        window_seconds=entry.dt,
                        reason=(
                            f"Acceleration magnitude changed by {entry.acceleration_jerk_g_s:.1f}g/s — "
                            "a shock consistent with a collision or a sudden stop"
                        ),
                    )
                ],
            )
        )
    return incidents


def detect_free_fall(points: list[TelemetryPoint], analytics: list[AnalyticsPoint]) -> list[Incident]:
    """Detects free fall: acceleration magnitude near 0g on every axis.

    An accelerometer measures deviation from free fall, not gravity
    itself — a level, stationary device reads ~1g (fighting gravity), but
    a device actually falling reads ~0g on every axis, since nothing is
    pushing back against it yet. This is a distinct physical signature
    from a collision (a magnitude *spike*, the moment it stops falling)
    and a flip (an attitude angle) — a real drop shows free-fall first,
    then a collision spike on impact, in sequence.
    """
    flags = [a.acceleration_magnitude_g is not None and a.acceleration_magnitude_g <= config.FREE_FALL_MAX_ACCEL_G for a in analytics]
    incidents: list[Incident] = []
    for index in _rising_edges(flags):
        point, entry = points[index], analytics[index]
        incidents.append(
            _make_incident(
                "free_fall",
                "critical",
                _confidence(1 - entry.acceleration_magnitude_g / config.FREE_FALL_MAX_ACCEL_G),
                index,
                point.timestamp,
                [
                    Evidence(
                        parameter="acceleration_magnitude",
                        after_value=round(entry.acceleration_magnitude_g, 3),
                        threshold=config.FREE_FALL_MAX_ACCEL_G,
                        unit="g",
                        reason=(
                            f"Acceleration magnitude dropped to {entry.acceleration_magnitude_g:.2f}g — "
                            "near-zero on every axis, consistent with unconstrained free fall rather than "
                            "normal handling or flight (which reads close to 1g)"
                        ),
                    )
                ],
            )
        )
    return incidents


def detect_signal_events(points: list[TelemetryPoint]) -> list[Incident]:
    incidents = _detect_field_threshold(
        points,
        "signal_strength",
        config.SIGNAL_LOSS_THRESHOLD_PCT,
        "signal_loss",
        "critical",
        "%",
        comparator=lambda value, threshold: value <= threshold,
    )

    in_degradation = False
    for index in range(len(points)):
        window = rolling_delta(points, "signal_strength", index, config.SIGNAL_DEGRADATION_WINDOW_SEC)
        is_degradation = bool(
            window and (window[0] - window[1]) >= config.SIGNAL_DEGRADATION_DROP_PCT
        )
        if is_degradation and not in_degradation:
            before, after, span = window
            incidents.append(
                _make_incident(
                    "signal_degradation",
                    "warning",
                    _confidence((before - after) / config.SIGNAL_DEGRADATION_DROP_PCT - 1),
                    index,
                    points[index].timestamp,
                    [
                        Evidence(
                            parameter="signal_strength",
                            before_value=before,
                            after_value=after,
                            threshold=config.SIGNAL_DEGRADATION_DROP_PCT,
                            unit="%",
                            window_seconds=span,
                            reason=f"Signal strength dropped {before - after:.1f}% within {span:.1f}s",
                        )
                    ],
                )
            )
        in_degradation = is_degradation

    return incidents


def detect_sudden_acceleration(points: list[TelemetryPoint], analytics: list[AnalyticsPoint]) -> list[Incident]:
    incidents: list[Incident] = []
    flags = [
        a.acceleration_magnitude_g is not None and a.acceleration_magnitude_g > config.SUDDEN_ACCELERATION_G
        for a in analytics
    ]
    for index in _rising_edges(flags):
        point, entry = points[index], analytics[index]
        incidents.append(
            _make_incident(
                "sudden_acceleration",
                "warning",
                _confidence(entry.acceleration_magnitude_g / config.SUDDEN_ACCELERATION_G - 1),
                index,
                point.timestamp,
                [
                    Evidence(
                        parameter="acceleration_magnitude",
                        after_value=round(entry.acceleration_magnitude_g, 2),
                        threshold=config.SUDDEN_ACCELERATION_G,
                        unit="g",
                        reason=f"Acceleration magnitude spiked to {entry.acceleration_magnitude_g:.1f}g",
                    )
                ],
            )
        )
    return incidents


def detect_motion_patterns(points: list[TelemetryPoint], analytics: list[AnalyticsPoint]) -> list[Incident]:
    """Stationary-hover and loiter detection over sliding windows.

    Both are informational (severity=normal) — they describe expected
    flight behavior rather than anomalies, but are useful mission context.
    """
    incidents: list[Incident] = []
    if not points:
        return incidents

    window_start = 0
    in_stationary = False
    for index in range(len(points)):
        while points[index].timestamp - points[window_start].timestamp > config.STATIONARY_MIN_DURATION_SEC:
            window_start += 1
        speeds = [
            (points[i].speed if points[i].speed is not None else analytics[i].horizontal_speed_m_s)
            for i in range(window_start, index + 1)
        ]
        speeds = [s for s in speeds if s is not None]
        duration = points[index].timestamp - points[window_start].timestamp
        is_stationary = bool(
            duration >= config.STATIONARY_MIN_DURATION_SEC
            and speeds
            and all(s <= config.STATIONARY_SPEED_THRESHOLD_M_S for s in speeds)
        )
        if is_stationary and not in_stationary:
            incidents.append(
                _make_incident(
                    "stationary_hovering",
                    "normal",
                    0.8,
                    window_start,
                    points[window_start].timestamp,
                    [
                        Evidence(
                            parameter="speed",
                            after_value=round(max(speeds), 2),
                            threshold=config.STATIONARY_SPEED_THRESHOLD_M_S,
                            unit="m/s",
                            window_seconds=duration,
                            reason=f"Speed stayed at or below {config.STATIONARY_SPEED_THRESHOLD_M_S} m/s for {duration:.1f}s",
                        )
                    ],
                )
            )
        in_stationary = is_stationary

    hover_window_start = 0
    in_hover_anomaly = False
    for index in range(len(points)):
        while (
            points[index].timestamp - points[hover_window_start].timestamp
            > config.HOVER_MIN_DURATION_SEC
        ):
            hover_window_start += 1
        window_indices = range(hover_window_start, index + 1)
        altitudes = [points[i].altitude for i in window_indices if points[i].altitude is not None]
        speeds = [
            (points[i].speed if points[i].speed is not None else analytics[i].horizontal_speed_m_s)
            for i in window_indices
        ]
        speeds = [s for s in speeds if s is not None]
        is_hovering = bool(speeds) and all(s <= config.STATIONARY_SPEED_THRESHOLD_M_S for s in speeds)
        duration = points[index].timestamp - points[hover_window_start].timestamp
        jitter = max(altitudes) - min(altitudes) if altitudes else 0.0
        is_hover_anomaly = bool(
            altitudes and is_hovering and duration >= config.HOVER_MIN_DURATION_SEC
            and jitter >= config.HOVER_ALTITUDE_JITTER_M
        )
        if is_hover_anomaly and not in_hover_anomaly:
            incidents.append(
                _make_incident(
                    "hover_anomaly",
                    "warning",
                    _confidence(jitter / config.HOVER_ALTITUDE_JITTER_M - 1),
                    hover_window_start,
                    points[hover_window_start].timestamp,
                    [
                        Evidence(
                            parameter="altitude",
                            before_value=round(min(altitudes), 2),
                            after_value=round(max(altitudes), 2),
                            threshold=config.HOVER_ALTITUDE_JITTER_M,
                            unit="m",
                            window_seconds=duration,
                            reason=f"Altitude oscillated by {jitter:.1f}m during a low-speed hover window",
                        )
                    ],
                )
            )
        in_hover_anomaly = is_hover_anomaly

    return incidents


def detect_loiter_pattern(points: list[TelemetryPoint]) -> list[Incident]:
    incidents: list[Incident] = []
    window_start = 0
    in_loiter = False
    for index in range(len(points)):
        while points[index].timestamp - points[window_start].timestamp > config.LOITER_MIN_DURATION_SEC:
            window_start += 1
        segment = points[window_start : index + 1]
        lats = [p.latitude for p in segment if p.latitude is not None]
        lons = [p.longitude for p in segment if p.longitude is not None]
        duration = points[index].timestamp - points[window_start].timestamp

        if len(lats) < 2 or duration < config.LOITER_MIN_DURATION_SEC:
            in_loiter = False
            continue

        centroid_lat, centroid_lon = sum(lats) / len(lats), sum(lons) / len(lons)
        max_radius = max(
            haversine_distance_m(centroid_lat, centroid_lon, lat, lon) or 0.0
            for lat, lon in zip(lats, lons)
        )
        is_loitering = max_radius <= config.LOITER_RADIUS_M
        if is_loitering and not in_loiter:
            incidents.append(
                _make_incident(
                    "loiter_pattern",
                    "normal",
                    0.75,
                    window_start,
                    points[window_start].timestamp,
                    [
                        Evidence(
                            parameter="position",
                            after_value=round(max_radius, 1),
                            threshold=config.LOITER_RADIUS_M,
                            unit="m",
                            window_seconds=duration,
                            reason=f"Position stayed within a {max_radius:.1f}m radius for {duration:.1f}s",
                        )
                    ],
                )
            )
        in_loiter = is_loitering
    return incidents


def detect_return_to_home_failure(points: list[TelemetryPoint]) -> list[Incident]:
    """Placeholder: requires an RTH-triggered flag not present in generic telemetry."""
    return []


def detect_geofence_breach(points: list[TelemetryPoint]) -> list[Incident]:
    """Placeholder: requires a configured geofence polygon not present in generic telemetry."""
    return []


def run_rule_engine(points: list[TelemetryPoint], analytics: list[AnalyticsPoint]) -> list[Incident]:
    """Run every deterministic rule and return incidents sorted chronologically with stable ids."""
    all_incidents: list[Incident] = []
    all_incidents += detect_rapid_battery_drain(points)
    all_incidents += detect_battery_thresholds(points)
    all_incidents += detect_descent_events(points, analytics)
    all_incidents += detect_gps_events(points, analytics)
    all_incidents += detect_gps_spoofing(points, analytics)
    all_incidents += detect_excessive_attitude(points)
    all_incidents += detect_excessive_speed(points)
    all_incidents += detect_orientation_flip(points)
    all_incidents += detect_collision(points, analytics)
    all_incidents += detect_free_fall(points, analytics)
    all_incidents += detect_signal_events(points)
    all_incidents += detect_sudden_acceleration(points, analytics)
    all_incidents += detect_motion_patterns(points, analytics)
    all_incidents += detect_loiter_pattern(points)
    all_incidents += detect_return_to_home_failure(points)
    all_incidents += detect_geofence_breach(points)

    all_incidents.sort(key=lambda incident: incident.timestamp)
    for position, incident in enumerate(all_incidents):
        incident.id = f"inc-{position:04d}"
    return all_incidents
