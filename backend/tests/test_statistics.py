from models.telemetry import TelemetryPoint
from services.analytics import compute_analytics
from services.rules import run_rule_engine
from services.statistics import compute_mission_statistics


def test_basic_mission_statistics():
    points = [
        TelemetryPoint(timestamp=0.0, latitude=37.0, longitude=-122.0, altitude=50.0, battery=100.0, speed=5.0, source="test"),
        TelemetryPoint(timestamp=1.0, latitude=37.0001, longitude=-122.0, altitude=55.0, battery=95.0, speed=6.0, source="test"),
        TelemetryPoint(timestamp=2.0, latitude=37.0002, longitude=-122.0, altitude=52.0, battery=90.0, speed=4.0, source="test"),
    ]
    analytics = compute_analytics(points)
    incidents = run_rule_engine(points, analytics)
    stats = compute_mission_statistics(points, analytics, incidents)

    assert stats["duration_seconds"] == 2.0
    assert stats["battery_start_pct"] == 100.0
    assert stats["battery_end_pct"] == 90.0
    assert stats["battery_consumed_pct"] == 10.0
    assert stats["max_altitude_m"] == 55.0
    assert stats["distance_traveled_m"] > 0
