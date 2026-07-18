from models.telemetry import TelemetryPoint
from services import live_session
from services.analytics import compute_analytics
from services.parser import esp32_packet_to_point
from services.rules import run_rule_engine


def _point(t: float, **overrides) -> TelemetryPoint:
    defaults = dict(roll=0.0, pitch=0.0, acceleration_x=0.0, acceleration_y=0.0, acceleration_z=1.0, source="test")
    defaults.update(overrides)
    return TelemetryPoint(timestamp=t, **defaults)


def test_orientation_flip_detected_from_roll():
    points = [_point(0.0, roll=0.0), _point(1.0, roll=170.0), _point(2.0, roll=170.0)]
    analytics = compute_analytics(points)
    incidents = run_rule_engine(points, analytics)
    assert "orientation_flip" in [i.type for i in incidents]


def test_collision_detected_from_acceleration_jerk():
    points = [
        _point(0.0, acceleration_z=1.0),
        _point(0.2, acceleration_z=1.0),
        _point(0.4, acceleration_x=4.0, acceleration_y=3.0, acceleration_z=1.0),  # sharp shock
        _point(0.6, acceleration_x=0.0, acceleration_y=0.0, acceleration_z=1.0),
    ]
    analytics = compute_analytics(points)
    incidents = run_rule_engine(points, analytics)
    assert "possible_collision" in [i.type for i in incidents]


def test_free_fall_detected_from_near_zero_acceleration():
    points = [
        _point(0.0, acceleration_z=1.0),  # normal, level
        _point(0.1, acceleration_x=0.02, acceleration_y=0.01, acceleration_z=0.05),  # dropped — free fall
        _point(0.2, acceleration_x=0.01, acceleration_y=0.02, acceleration_z=0.03),
        _point(0.3, acceleration_x=3.5, acceleration_y=0.2, acceleration_z=3.0),  # impact
    ]
    analytics = compute_analytics(points)
    incidents = run_rule_engine(points, analytics)
    types = [i.type for i in incidents]
    assert "free_fall" in types
    assert types.count("free_fall") == 1  # one fall event, not one per low-g sample


def test_free_fall_does_not_fire_during_normal_level_flight():
    points = [_point(float(t)) for t in range(10)]  # all steady 1g, level
    analytics = compute_analytics(points)
    incidents = run_rule_engine(points, analytics)
    assert "free_fall" not in [i.type for i in incidents]


def test_esp32_adapter_derives_tilt_from_raw_accel():
    packet = {"accel_x": 0.0, "accel_y": 0.7, "accel_z": 0.7}
    point = esp32_packet_to_point(packet, fallback_timestamp=0.0)
    assert point is not None
    assert point.roll is not None and point.roll > 0
    assert point.pitch is not None


def test_esp32_adapter_prefers_explicit_roll_pitch_over_derived():
    packet = {"roll": 12.5, "pitch": -4.0, "accel_x": 0.0, "accel_y": 0.7, "accel_z": 0.7}
    point = esp32_packet_to_point(packet, fallback_timestamp=0.0)
    assert point.roll == 12.5
    assert point.pitch == -4.0


def test_live_session_ingest_and_investigation():
    session_id = live_session.start_session("test-session")
    live_session.ingest_packet(session_id, {"timestamp": 0.0, "roll": 0.0, "acceleration_z": 1.0})
    live_session.ingest_packet(session_id, {"timestamp": 1.0, "roll": 170.0, "acceleration_z": 1.0})

    points = live_session.get_points(session_id)
    assert len(points) == 2

    from services.summary import build_investigation

    investigation = build_investigation(points, source="esp32")
    assert investigation["statistics"]["total_telemetry_points"] == 2
    assert any(i["type"] == "orientation_flip" for i in investigation["incidents"])

    live_session.clear_session(session_id)
    try:
        live_session.get_points(session_id)
        assert False, "expected KeyError after clearing session"
    except KeyError:
        pass
