from services.report import build_insurance_brief


def test_brief_includes_real_incident_data_not_placeholders():
    investigation = {
        "mission": {"source": "sample"},
        "statistics": {
            "duration_seconds": 65.0,
            "distance_traveled_m": 815.7,
            "max_altitude_m": 65.0,
            "battery_consumed_pct": 35.0,
            "risk_distribution": {"structural": 100.0, "jamming": 0.0, "spoofing": 0.0, "hardware": 0.0, "pilot_error": 0.0},
        },
        "health_score": 10,
        "ai_summary": {
            "verdict": "Crash detected.",
            "probable_cause": "Loss of control leading to ground impact",
            "recommended_actions": ["Inspect airframe"],
            "confidence": 0.9,
            "ai_available": True,
        },
        "incidents": [
            {
                "id": "inc-0000",
                "type": "crash",
                "title": "Crash Detected",
                "severity": "critical",
                "timestamp": 52.5,
                "telemetry_index": 105,
                "evidence": [{"reason": "Altitude reached 0.0m while descending at 36.4 m/s"}],
                "liability_hint": "Structural loss event — root cause requires correlation with preceding incidents",
            }
        ],
    }

    brief = build_insurance_brief(investigation)

    assert "BLACKBOX AI" in brief
    assert "Crash Detected" in brief
    assert "36.4 m/s" in brief
    assert "T+52s" in brief or "T+53s" in brief
    assert "Structural loss event" in brief
    assert "not a legal, certified, or regulatory finding" in brief


def test_brief_includes_integrity_section_when_present():
    investigation = {
        "mission": {"source": "sample"},
        "statistics": {},
        "ai_summary": {},
        "incidents": [],
        "integrity": {
            "algorithm": "SHA-256",
            "data_sha256": "abc123def456",
            "point_count": 42,
            "computed_at": "2026-07-18T00:00:00+00:00",
        },
    }
    brief = build_insurance_brief(investigation)
    assert "abc123def456" in brief
    assert "DATA INTEGRITY" in brief
    assert "42" in brief


def test_brief_handles_empty_investigation_gracefully():
    brief = build_insurance_brief({})
    assert "None detected" in brief
    assert "BLACKBOX AI" in brief
