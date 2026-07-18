"""Simulates an ESP32 + IMU streaming to the live endpoints, so the whole
live pipeline can be verified before wiring up real hardware.

Run with the backend server already up (`uvicorn main:app`):
    py simulate_esp32_stream.py --host http://127.0.0.1:8000

Sends: a calm baseline stretch, a full flip (roll swings past 180deg),
a recovery, then a sharp shock (collision/sudden-stop signature). Each
packet only sends raw accelerometer g-components — no roll/pitch — to
exercise the backend's tilt-from-accelerometer derivation, matching what
a bare IMU (no onboard fusion) would send.
"""

import argparse
import math
import time
import urllib.error
import urllib.request
import json


def post_json(url: str, payload: dict) -> dict:
    data = json.dumps(payload).encode()
    request = urllib.request.Request(url, data=data, headers={"Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(request, timeout=5) as response:
        return json.loads(response.read())


def accel_for_tilt(roll_deg: float, pitch_deg: float) -> tuple[float, float, float]:
    """Inverse of the backend's tilt formulas, so the simulator can send
    raw accelerometer components that will decode back to a target tilt.
    """
    roll_rad, pitch_rad = math.radians(roll_deg), math.radians(pitch_deg)
    az = math.cos(pitch_rad) * math.cos(roll_rad)
    ay = math.sin(roll_rad) * math.cos(pitch_rad)
    ax = -math.sin(pitch_rad)
    return round(ax, 4), round(ay, 4), round(az, 4)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default="http://127.0.0.1:8000")
    parser.add_argument("--session-id", default="esp32-demo")
    args = parser.parse_args()

    base = args.host.rstrip("/")
    session = post_json(f"{base}/live/start", {"session_id": args.session_id})["session_id"]
    print(f"Session started: {session}")

    steps = []
    for i in range(10):  # calm baseline hover
        steps.append(accel_for_tilt(2 * math.sin(i / 3), 1 * math.cos(i / 3)))
    for i in range(6):  # flip: roll swings from 0 to 170 degrees
        steps.append(accel_for_tilt(170 * (i / 5), 0))
    for i in range(4):  # hold inverted
        steps.append(accel_for_tilt(175, 0))
    for i in range(6):  # recover
        steps.append(accel_for_tilt(175 * (1 - i / 5), 0))
    steps.append((4.0, 3.0, 1.0))  # sudden shock: sharp jerk in acceleration magnitude
    steps.append((0.0, 0.0, 1.0))  # settles

    for index, (ax, ay, az) in enumerate(steps):
        result = post_json(
            f"{base}/live/{session}/ingest",
            {"accel_x": ax, "accel_y": ay, "accel_z": az},
        )
        alerts = [a["type"] for a in result["instant_alerts"]]
        print(f"packet {index:02d} -> point_count={result['point_count']} alerts={alerts or 'none'}")
        time.sleep(0.1)

    with urllib.request.urlopen(f"{base}/live/{session}/investigation", timeout=5) as response:
        body = json.loads(response.read())
    print("\nFinal investigation:")
    print(" health_score:", body["health_score"])
    print(" incidents:", [i["type"] for i in body["incidents"]])
    print(" ai_summary.verdict:", body["ai_summary"]["verdict"])


if __name__ == "__main__":
    try:
        main()
    except urllib.error.URLError as exc:
        raise SystemExit(f"Could not reach the backend — is it running? ({exc})")


