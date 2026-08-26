# BlackBox — Handoff Document

Pitched to hackathon judges as **"BlackBox"**. A drone flight-log / telemetry forensics platform: upload a CSV (or stream live from an ESP32+MPU6050), get a deterministic, evidence-cited investigation of what happened during the flight, an AI-narrated summary, and an insurance-ready liability brief — with cryptographic chain-of-custody hashing so the report can't be silently altered after the fact.

This file is written for **a new Claude session with zero prior context**. Read it top to bottom before touching code.

---

## 1. Core Architecture Principle (read this first)

**The math/detection engine is 100% deterministic. AI is only a narrator, never a source of facts.**

- `services/rules.py` runs pure threshold/physics comparisons against parsed telemetry and produces `Incident` objects, each carrying structured `Evidence` (before/after values, threshold, timestamp, telemetry_index). No incident is ever asserted by the AI.
- `services/gemini.py` (Google Gemini via `google-genai`) receives the already-computed incidents/statistics and narrates them in plain English. It must cite timestamps/telemetry_index from the evidence it's given, never invent new claims, and has a deterministic non-AI fallback (`_fallback_summary`) if the API call fails for any reason (quota, network, bad key).
- Confidence is never asserted as boolean certainty. `services/forensics.py` uses a sigmoid probability model for signal-disruption/jamming confidence — "never assert false certainty" was an explicit design mandate.

If you're asked to add a new incident type: write the detector in `rules.py` against real physics/thresholds first. Only wire AI narration on top afterward.

---

## 2. Folder Structure

```
blackbox/
├── backend/                     FastAPI, local-first, no DB, no auth
│   ├── main.py                  App entry, CORS, router registration, serial bridge startup hook
│   ├── requirements.txt
│   ├── .env                     GEMINI_API_KEY, GEMINI_MODEL (gitignored)
│   ├── .env.example             committed blank template
│   ├── models/                  Pydantic models: telemetry.py, incident.py
│   ├── services/                All business logic (see §3)
│   ├── routes/                  health, upload, analyze, live, report
│   ├── utils/                   config.py (thresholds), helpers.py
│   ├── sample_data/              4 synthetic CSVs + generator + ESP32 stream simulator
│   ├── firmware/                 Arduino .ino files for real ESP32+MPU6050 hardware
│   └── tests/                   pytest, 39 passing as of last run
└── frontend/                     React 19 + Vite, "cyberpunk telemetry HUD" aesthetic
    ├── .env                      VITE_API_BASE_URL (LAN IP, not localhost — needed for ESP32)
    ├── src/App.jsx               Mode router: landing / replay / live
    ├── src/lib/                  api.js (backend client), csvParser.js + localFallback.js +
    │                             briefFormatter.js (offline-fallback mirrors of backend logic),
    │                             imuSimulator.js, detectionEngine.js
    └── src/components/
        ├── Landing/               Upload/scenario picker, Go Live, join session
        ├── Live/                  LiveView, AttitudeIndicator (artificial horizon)
        ├── Replay/                FlightMap (Leaflet), HUD, TelemetryStrip, Controls
        └── Report/                ReportPanel, VerdictCard, HealthGauge, MissionDashboard
```

---

## 3. Backend Service Pipeline (in call order)

1. **`services/parser.py`** — CSV → `list[TelemetryPoint]`. Header-alias matching (`HEADER_ALIASES`) tolerant of `%time`, `time_ms`, combined `coordinates` columns with N/S/E/W notation, and epoch-scale auto-detection (s/ms/us/ns) via magnitude heuristics (`_detect_numeric_timestamp_scale`). Calls `_derive_tilt_from_accel` so pure-IMU CSVs (no roll/pitch column) still get attitude data.
2. **`services/analytics.py`** — `compute_analytics(points)` → `list[AnalyticsPoint]`: rolling deltas, `acceleration_magnitude_g`, `acceleration_jerk_g_s`, `gps_implied_acceleration_m_s2` (2nd derivative of lat/lon position — used to distinguish GPS spoofing from real IMU-corroborated acceleration), `kinetic_jitter_variance`.
3. **`services/rules.py`** — `run_rule_engine(points, analytics)` → sorted, deduplicated `list[Incident]`. ~20 detector functions (battery, GPS, attitude, speed, signal, collision, free-fall, spoofing, loiter/hover). See `TYPE_TITLES`/`TYPE_LIABILITY` dicts at the top of the file for the full incident taxonomy and liability categorization (jamming / spoofing / hardware / pilot_error / structural).
4. **`services/statistics.py`** — `compute_mission_statistics`, `compute_risk_distribution`.
5. **`services/forensics.py`** — `signal_disruption_probability` sigmoid model for jamming confidence.
6. **`services/integrity.py`** — SHA-256 hash of normalized telemetry (+ optional original file bytes) → chain-of-custody block.
7. **`services/gemini.py`** — AI narration layer, graceful fallback.
8. **`services/summary.py`** — `build_investigation(points, source, source_file_bytes=None)` orchestrates all of the above into the final JSON response shape used by every route and mirrored by the frontend offline fallback.
9. **`services/report.py`** — `build_insurance_brief`: an 8-section document (Mission Summary, Verdict, Chronological Summary, Probable Cause, Liability Risk Distribution, Detected Incidents, Recommended Actions, Data Integrity/Chain of Custody).

### Live/hardware path (parallel, feeds the same pipeline)
- `services/live_session.py` — in-memory session store (no DB): `start_session`, `ingest_packet`, `get_points`, `clear_session`, `list_sessions`.
- Two ingestion routes into the same store: WiFi/HTTP `POST /live/{id}/ingest` (ESP32 firmware in `firmware/blackbox_wifi/blackbox_wifi.ino`) and USB-serial (`services/serial_bridge.py`, opt-in via `SERIAL_PORT` env var, started from `main.py`'s startup hook; firmware in `firmware/blackbox_mpu6050.ino`).
- Both funnel raw IMU packets through `esp32_packet_to_point` (same tilt-derivation logic as the CSV path) into the same `build_investigation` pipeline — live and replay share 100% of the analysis code.

---

## 4. Key Design Decisions & Why

- **No boolean "GPS is spoofed" claims** — v1 of `detect_gps_spoofing` keyed on "GPS shows fast movement + IMU is calm," which false-positived on every normal cruising flight (Newton's first law: constant velocity is calm on an accelerometer). Fixed to key on `gps_implied_acceleration_m_s2` (a sudden implied acceleration jump) vs `acceleration_magnitude_g` staying near 1g — i.e., GPS claims a force the IMU never felt.
- **Free-fall detection uses ~0g, not high-g** — accelerometers measure deviation from freefall, not gravity directly; a body in freefall reads ~0g magnitude, not negative-g. `FREE_FALL_MAX_ACCEL_G = 0.35` in `utils/config.py`.
- **Rising-edge dedup for sustained-condition rules** — `stationary_hovering`, `hover_anomaly`, `loiter_pattern`, and the spoofing rule use an `in_flag` transition pattern so a single sustained event fires one incident, not one per window-duration for the whole event.
- **Offline-first frontend fallback, never masking real backend errors** — `csvParser.js`/`localFallback.js`/`briefFormatter.js` mirror the backend's investigation JSON shape exactly and only activate on genuine network failure (checked via `instanceof ApiError` in `Landing.jsx`). Earlier bug: real backend 400 validation errors were being masked by the offline parser's unrelated stricter error message — always check the error type before falling back.
- **LAN binding required for ESP32** — backend must run with `--host 0.0.0.0` (not the default `127.0.0.1`), and the frontend's `VITE_API_BASE_URL` must point at the machine's actual LAN IP (find via `Get-NetIPAddress`, and watch out for virtual adapters like VirtualBox's `192.168.56.1` — use the real WiFi adapter's IP).
- **`gemini-flash-latest` alias, not a pinned version** — pinned model IDs (`gemini-2.0-flash`, `gemini-1.5-flash`, `gemini-2.5-flash`, `gemini-2.0-flash-lite`) variously returned 404 (retired/closed to new users) or 429 (zero quota) despite a valid key. The `-latest` alias resolved to a model with actual quota. If narration starts failing again, re-test model IDs directly against the Gemini API before assuming the key is bad.

---

## 5. Commands

**Backend** (from `backend/`):
```bash
pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000    # 0.0.0.0 required for ESP32/LAN access
pytest                                           # 39 tests
```

**Frontend** (from `frontend/`):
```bash
npm install          # postinstall regenerates public/samples/ via scripts/generateSamples.mjs
npm run dev
npm run build
npm run test          # vitest, 22 tests
npm run lint          # oxlint
```

**Firmware**: open `backend/firmware/blackbox_wifi/blackbox_wifi.ino` (WiFi/HTTP path) or `backend/firmware/blackbox_mpu6050.ino` (USB-serial path) in Arduino IDE. See `backend/firmware/README.md` for wiring, the LAN-IP requirement, and the Windows Firewall rule needed to let the ESP32 reach the backend (left for the user to run: `New-NetFirewallRule ...`).

---

## 6. Dependencies

**Backend** (`requirements.txt`): fastapi, uvicorn[standard], pandas, numpy, pydantic, google-genai, python-multipart, pyserial, python-dotenv, pytest, httpx.

**Frontend** (`package.json`): React 19.2.7, react-leaflet 5.0.0, leaflet 1.9.4, framer-motion 12.42.2, recharts 3.9.2, papaparse 5.5.4; dev: vite 8.1.1, vitest 4.1.10, oxlint 1.71.0.

---

## 7. Environment Setup

- `backend/.env` (gitignored, must be created from `.env.example`): `GEMINI_API_KEY=...`, `GEMINI_MODEL=gemini-flash-latest`, optional `SERIAL_PORT=COM3` (or `/dev/ttyUSB0`) to enable the USB-serial bridge.
- `frontend/.env`: `VITE_API_BASE_URL=http://<your-LAN-IP>:8000` — must be a real LAN IP if testing with physical ESP32 hardware, `127.0.0.1` is fine for browser-only testing.

---

## 8. Completed Features

- CSV upload → full deterministic investigation (incidents, statistics, risk distribution, AI narrative, integrity hash)
- 4 synthetic sample scenarios (normal/gps_loss/battery_failure/crash), each at a distinct real-world location (SF/NYC/London/Tokyo)
- Robust CSV parsing: broad header aliasing, ROS-bag-style `%time` columns, combined `coordinates` column with compass notation, auto epoch-scale detection
- ~20 rule-based incident detectors covering battery, GPS, attitude, speed, signal, collision, free-fall, spoofing, loiter/hover — see `TYPE_TITLES` in `rules.py`
- GPS spoofing detection via IMU/GPS acceleration cross-check (not naive speed+calm heuristic)
- Signal-disruption probability model (sigmoid, not boolean) for jamming confidence
- Chain-of-custody SHA-256 integrity hashing, surfaced in UI with click-to-copy
- Insurance brief generator: 8-section document, deterministic liability categorization per incident type
- Live ESP32 ingestion via both WiFi/HTTP and USB-serial, sharing the CSV-replay analysis pipeline
- Real-time IMU readout panel (roll/pitch/accel XYZ/magnitude/jerk) in Live view
- Full UI overhaul: design-token system, animated radial health gauge, artificial-horizon attitude indicator with roll-tick scale + pitch ladder, animated flight map with auto-fit bounds, animated risk-distribution bars, ambient HUD background (grid/vignette/scanline)
- Offline-first fallback path that mirrors backend logic exactly, activates only on genuine network failure
- 39 backend tests (pytest) + 22 frontend tests (vitest), all passing as of last full run

## 9. Pending / Known Issues

- `frontend/README.md` is **stale** — still describes the old pre-integration, client-only architecture and references a deleted `api/narrate.js`. Should be rewritten to describe the real FastAPI backend before handing this repo to anyone external.
- Speed and altitude are **physically unavailable from a bare MPU6050** (it's an IMU, not GPS/barometer) — this is a real hardware limitation, documented in `firmware/README.md`, not a bug to fix.
- Frontend JS bundle is ~895KB with no code-splitting — fine for a hackathon demo, worth addressing if this becomes a real product.
- The in-browser preview/screenshot tool was unreliable for visual verification throughout the last session (screenshot timeouts, stale reads). `get_page_text` + `npm run build`/`pytest`/`vitest` were used as substitute verification. If you hit the same issue, don't fight it — use those instead, and don't bypass React's event system via direct fiber/DOM manipulation for verification (it produces misleading "state says X, DOM shows Y" ghost-state artifacts).

## 10. Full Threshold Reference

All tunable thresholds live in `backend/utils/config.py` — battery, altitude, GPS, attitude, speed, signal, orientation-impact, free-fall, signal-disruption-model, GPS-spoofing, loiter, and health-score-weight constants. Read that file directly rather than trusting a stale copy of these numbers elsewhere; it's the single source of truth and gets tuned as detectors are refined.
