import pytest
from fastapi import HTTPException

from services.parser import parse_csv

BASIC_CSV = (
    "timestamp,lat,lon,alt,speed,battery,roll,pitch,yaw,satellites,signal,ax,ay,az\n"
    "0,37.0,-122.0,50,5,100,0,0,0,12,90,0,0,1\n"
    "1,37.0001,-122.0001,51,5,99,0,0,0,12,90,0,0,1\n"
)


def test_parses_aliased_headers():
    points = parse_csv(BASIC_CSV.encode())
    assert len(points) == 2
    assert points[0].latitude == 37.0
    assert points[0].gps_satellites == 12
    assert points[0].acceleration_z == 1.0


def test_missing_columns_do_not_crash():
    csv_bytes = b"timestamp,battery\n0,100\n1,90\n"
    points = parse_csv(csv_bytes)
    assert points[0].latitude is None
    assert points[0].battery == 100.0


def test_empty_file_raises_400():
    with pytest.raises(HTTPException) as exc_info:
        parse_csv(b"")
    assert exc_info.value.status_code == 400


def test_missing_timestamp_column_raises_400():
    with pytest.raises(HTTPException) as exc_info:
        parse_csv(b"battery,altitude\n100,50\n")
    assert exc_info.value.status_code == 400


def test_invalid_coordinates_are_dropped_not_crashed():
    csv_bytes = b"timestamp,lat,lon\n0,999,-200\n1,37.0,-122.0\n"
    points = parse_csv(csv_bytes)
    assert points[0].latitude is None
    assert points[1].latitude == 37.0


def test_rows_sorted_by_timestamp():
    csv_bytes = b"timestamp,battery\n2,90\n0,100\n1,95\n"
    points = parse_csv(csv_bytes)
    assert [p.timestamp for p in points] == [0.0, 1.0, 2.0]


def test_time_ms_column_is_converted_to_elapsed_seconds():
    csv_bytes = b"time_ms,battery\n0,100\n500,99\n1000,98\n"
    points = parse_csv(csv_bytes)
    assert [p.timestamp for p in points] == [0.0, 0.5, 1.0]


def test_alternate_timestamp_aliases_accepted():
    for header in ("date", "datetime", "ts", "epoch", "sec"):
        csv_bytes = f"{header},battery\n0,100\n1,99\n".encode()
        points = parse_csv(csv_bytes)
        assert len(points) == 2, f"failed for header {header!r}"


def test_ros_percent_time_header_with_nanosecond_epoch():
    # Real ROS bag CSV export format: header "%time", values are
    # nanoseconds since Unix epoch, not a small relative counter.
    base_ns = 1_700_000_000_000_000_000
    csv_bytes = (
        f"%time,battery\n{base_ns},100\n{base_ns + 500_000_000},99\n{base_ns + 1_000_000_000},98\n"
    ).encode()
    points = parse_csv(csv_bytes)
    assert [p.timestamp for p in points] == [0.0, 0.5, 1.0]


def test_absolute_second_epoch_is_normalized_to_elapsed():
    csv_bytes = b"timestamp,battery\n1700000000,100\n1700000001,99\n1700000002,98\n"
    points = parse_csv(csv_bytes)
    assert [p.timestamp for p in points] == [0.0, 1.0, 2.0]


def test_combined_coordinates_column_comma_separated():
    csv_bytes = b"timestamp,coordinates,battery\n0,\"35.6762,139.6503\",100\n1,\"35.6763,139.6504\",99\n"
    points = parse_csv(csv_bytes)
    assert points[0].latitude == 35.6762
    assert points[0].longitude == 139.6503


def test_combined_coordinates_column_with_compass_directions():
    # Tehran, Iran — northern & eastern hemisphere, explicit N/E suffixes with degree symbols.
    csv_bytes = 'timestamp,coordinates\n0,"35.6892\xb0 N, 51.3890\xb0 E"\n'.encode("utf-8")
    points = parse_csv(csv_bytes)
    assert points[0].latitude == pytest.approx(35.6892)
    assert points[0].longitude == pytest.approx(51.3890)


def test_combined_coordinates_column_southern_western_hemisphere():
    # Sydney, Australia — negative latitude, positive-but-should-be-negative longitude via W/S suffix test.
    csv_bytes = b'timestamp,coordinates\n0,"33.8688S,151.2093E"\n'
    points = parse_csv(csv_bytes)
    assert points[0].latitude == pytest.approx(-33.8688)
    assert points[0].longitude == pytest.approx(151.2093)


def test_combined_coordinates_is_fallback_not_override():
    # Explicit lat/lon columns must win over a "coordinates" column if both exist.
    csv_bytes = b'timestamp,lat,lon,coordinates\n0,10.0,20.0,"99.0,99.0"\n'
    points = parse_csv(csv_bytes)
    assert points[0].latitude == 10.0
    assert points[0].longitude == 20.0


def test_roll_pitch_derived_from_raw_accel_only_csv():
    # A pure-IMU log with no explicit roll/pitch columns and no GPS/battery
    # at all — the HUD has nothing to show unless tilt gets derived here,
    # same as the ESP32 live-packet path already does.
    csv_bytes = b"timestamp,accel_x,accel_y,accel_z\n0,0.0,0.0,1.0\n1,0.05,0.7,0.7\n"
    points = parse_csv(csv_bytes)
    assert points[0].roll == 0.0
    assert points[1].roll is not None and points[1].roll > 0
    assert points[1].pitch is not None
