from models.telemetry import TelemetryPoint
from services.analytics import compute_analytics
from services.rules import run_rule_engine


def _point(t: float, **overrides) -> TelemetryPoint:
    defaults = dict(
        latitude=37.0,
        longitude=-122.0,
        altitude=50.0,
        speed=5.0,
        battery=100.0,
        roll=0.0,
        pitch=0.0,
        yaw=0.0,
        gps_satellites=12,
        signal_strength=90.0,
        acceleration_x=0.0,
        acceleration_y=0.0,
        acceleration_z=1.0,
        source="test",
    )
    defaults.update(overrides)
    return TelemetryPoint(timestamp=t, **defaults)


def test_battery_power_failure_detected():
    points = [_point(0.0, battery=90.0), _point(1.0, battery=88.0), _point(2.0, battery=50.0)]
    analytics = compute_analytics(points)
    incidents = run_rule_engine(points, analytics)
    types = [i.type for i in incidents]
    assert "power_failure" in types


def test_gps_loss_labeled_as_interference_when_battery_healthy():
    points = [
        _point(0.0, gps_satellites=13, battery=90.0),
        _point(1.0, gps_satellites=12, battery=90.0),
        _point(2.0, gps_satellites=2, battery=90.0),
    ]
    analytics = compute_analytics(points)
    incidents = run_rule_engine(points, analytics)
    types = [i.type for i in incidents]
    assert "external_signal_interference" in types


def test_crash_detected_from_rapid_descent_near_ground():
    points = [_point(0.0, altitude=50.0), _point(1.0, altitude=40.0), _point(2.0, altitude=0.5)]
    analytics = compute_analytics(points)
    incidents = run_rule_engine(points, analytics)
    types = [i.type for i in incidents]
    assert "crash" in types


def test_no_incidents_on_clean_flight():
    points = [_point(float(t)) for t in range(10)]
    analytics = compute_analytics(points)
    incidents = run_rule_engine(points, analytics)
    assert incidents == []


def test_excessive_roll_detected():
    points = [_point(0.0, roll=0.0), _point(1.0, roll=60.0), _point(2.0, roll=60.0)]
    analytics = compute_analytics(points)
    incidents = run_rule_engine(points, analytics)
    types = [i.type for i in incidents]
    assert "excessive_roll" in types
    # Only one incident for the sustained excursion, not one per sample.
    assert types.count("excessive_roll") == 1


def test_gps_spoofing_detected_on_sudden_position_teleport():
    # Stationary, then an instantaneous ~1.1km "teleport" with no accelerometer
    # signature (accel stays at the default level ~1g) — a real airframe
    # cannot change speed that fast without the IMU feeling it.
    points = [
        _point(0.0, latitude=37.7749, longitude=-122.4194),
        _point(1.0, latitude=37.7749, longitude=-122.4194),
        _point(2.0, latitude=37.7849, longitude=-122.4194),
        _point(3.0, latitude=37.7849, longitude=-122.4194),
    ]
    analytics = compute_analytics(points)
    incidents = run_rule_engine(points, analytics)
    spoofing = [i for i in incidents if i.type == "gps_spoofing"]
    assert len(spoofing) == 1  # one teleport event -> one incident, not a duplicate per sample
    assert spoofing[0].liability_category == "spoofing"


def test_gps_spoofing_does_not_fire_on_ordinary_constant_velocity_cruise():
    # Steady real-world cruise: constant GPS speed, calm accelerometer.
    # This must NOT be flagged — a drone flying at constant velocity feels
    # no net acceleration (Newton's first law), same as spoofed-while-parked,
    # so the rule must key on a *sudden jump*, not just "fast with calm IMU".
    lat = 37.7749
    points = []
    for i in range(10):
        lat += 0.0001  # ~11 m/s steady, real cruise speed
        points.append(_point(float(i), latitude=lat, longitude=-122.4194))
    analytics = compute_analytics(points)
    incidents = run_rule_engine(points, analytics)
    assert "gps_spoofing" not in [i.type for i in incidents]


def test_sustained_stationary_hover_fires_once_not_repeatedly():
    points = [_point(float(t), speed=0.1) for t in range(40)]
    analytics = compute_analytics(points)
    incidents = run_rule_engine(points, analytics)
    hovering = [i for i in incidents if i.type == "stationary_hovering"]
    assert len(hovering) == 1


def test_crash_has_structural_liability_hint():
    points = [_point(0.0, altitude=50.0), _point(1.0, altitude=40.0), _point(2.0, altitude=0.5)]
    analytics = compute_analytics(points)
    incidents = run_rule_engine(points, analytics)
    crash = next(i for i in incidents if i.type == "crash")
    assert crash.liability_category == "structural"
    assert crash.liability_hint is not None
