# BlackBox AI — AirFlare

**A drone flight-log and telemetry forensics platform.** Upload a flight-log CSV (or stream live telemetry from an ESP32+MPU6050, or simulate that same stream with zero hardware), and BlackBox AI reconstructs the flight, runs it through a deterministic rule engine, and produces a plain-English incident report where every claim links straight back to the exact data point that proves it — plus an insurance-ready liability brief and a cryptographic chain-of-custody hash so the report can't be silently altered after the fact.

Pitched as **AirFlare**.

---

## Why this exists

Drone incidents — crashes, GPS spoofing, jamming, hardware failure — currently get investigated by someone manually eyeballing a CSV export, if they get investigated at all. There's no standard way to prove *why* a drone went down, which matters enormously for insurance claims, liability disputes, and regulatory compliance. BlackBox AI turns a raw telemetry log into a defensible, evidence-cited forensic report in seconds.

## Core design principle

**The detection engine is 100% deterministic. AI only narrates already-computed facts — it never invents them.**

- A pure rule/math engine (thresholds, physics, statistics) detects every incident and attaches structured evidence (exact timestamp, telemetry index, before/after values).
- An AI layer (Google Gemini) turns that evidence into a readable narrative, but is contractually restricted (via prompt + fallback) to only ever summarize what the rule engine already found — never to assert a new fact, and never to claim more certainty than the evidence supports.
- If the AI is unavailable (no API key, quota exceeded, network failure), the app falls back to a deterministic, evidence-only summary automatically. The forensics never depend on the AI being up.

---

## Features

### Flight analysis
- **CSV upload & replay** — drop a flight-log CSV; only a timestamp column is required. Broad header-alias matching handles real-world messy exports (`%time`, `time_ms`, ROS-bag style columns, epoch timestamps in seconds/ms/µs/ns, a combined `coordinates` column with compass notation like `"35.6892° N, 51.3890° E"`).
- **~20 deterministic incident detectors**: battery drain/failure, GPS degradation/loss, GPS spoofing (via GPS-implied vs. IMU-measured acceleration cross-check, not a naive heuristic), signal jamming (sigmoid probability model, not a boolean claim), excessive roll/pitch/speed, orientation flip, collision (jerk spike), free-fall (near-zero accelerometer magnitude), hover/loiter anomalies, and more.
- **Animated flight map** (Leaflet) that auto-fits to the actual flight path anywhere on Earth, radar-sweep placeholder when no GPS track exists (pure-IMU flights).
- **Mission Timeline** — a scrubbable strip of every detected incident along the flight, color-coded by severity, click to jump straight to that moment.
- **Auto-Tour Incidents** — one click cinematically walks the map/scrubber through every incident in sequence.
- **Mission Dashboard** — full flight statistics, risk distribution (jamming / spoofing / hardware / pilot error / structural), and a chain-of-custody integrity card.
- **AI-narrated verdict** with an animated health-score gauge, every claim citing timestamp/telemetry index.
- **Insurance brief generator** — an 8-section deterministic report (mission summary, verdict, chronological summary, probable cause, liability risk distribution, detected incidents, recommended actions, data integrity), downloadable as a file.
- **Chain-of-custody integrity hashing** — SHA-256 hash of normalized telemetry (+ original file bytes if uploaded), so any post-hoc tampering with the report is detectable.

### Live telemetry
- **Real ESP32 + MPU6050 hardware** streams over WiFi/HTTP or USB-serial into the exact same analysis pipeline CSV replay uses.
- **Simulate mode** — no hardware needed. Preset packet sequences (calm hover, flip, collision, free-fall) stream through the identical backend ingestion endpoint real hardware uses.
- **Manual packet control** — sliders for raw accelerometer X/Y/Z, streamed live at the same cadence real hardware would use.
- **Drag-to-pilot** — grab the artificial horizon directly and drag; it tilts instantly and streams real packets to the backend as you move it.
- **Live packet-flow visualization** — a small animated diagram (Browser → Ingest API → Analysis Engine) makes every actual HTTP round-trip visible as a traveling pulse.
- Real-time IMU readout (roll, pitch, accel X/Y/Z, magnitude, jerk) and incident detection as data streams in — incidents can fire *while the flight is still happening*, not just after the fact.

### Offline resilience
If the backend is unreachable, the frontend falls back to a client-side parser/analysis engine that mirrors the backend's logic and output shape exactly — the app degrades gracefully rather than breaking.

---

## Architecture

```
blackbox-ai/
├── backend/    FastAPI, Python, no database, no auth — fully local-first
│   ├── main.py                 App entry, CORS, router registration
│   ├── models/                 Pydantic models (telemetry, incidents)
│   ├── services/
│   │   ├── parser.py           CSV → TelemetryPoint (robust header aliasing, epoch detection)
│   │   ├── analytics.py        Rolling deltas, jerk, GPS-implied acceleration, jitter variance
│   │   ├── rules.py            The deterministic rule engine — ~20 incident detectors
│   │   ├── statistics.py       Mission statistics + risk distribution
│   │   ├── forensics.py        Sigmoid signal-disruption probability model
│   │   ├── integrity.py        SHA-256 chain-of-custody hashing
│   │   ├── gemini.py           AI narration layer (evidence-only, graceful fallback)
│   │   ├── summary.py          Orchestrates the full investigation pipeline
│   │   ├── report.py           Insurance brief generator
│   │   ├── live_session.py     In-memory live session store
│   │   └── serial_bridge.py    Opt-in USB-serial ESP32 bridge
│   ├── routes/                 health, upload, analyze, live, report
│   ├── firmware/                Arduino .ino files (WiFi/HTTP + USB-serial paths)
│   ├── sample_data/             Synthetic sample CSVs + generators
│   └── tests/                  pytest suite
└── frontend/    React 19 + Vite — "cyberpunk telemetry HUD" aesthetic
    └── src/
        ├── components/
        │   ├── Landing/         Upload, sample scenarios, live entry point
        │   ├── Live/            Live telemetry view, attitude indicator, manual/drag control
        │   ├── Replay/          Flight map, HUD, mission timeline, controls
        │   └── Report/          Verdict card, mission dashboard, incident report
        ├── lib/                 API client + offline fallback engine (mirrors backend exactly)
        └── context/             Timeline state (single source of truth for playback position)
```

See [HANDOFF.md](HANDOFF.md) for full technical detail — every threshold, design decision, and file-by-file breakdown.

---

## Tech stack

**Backend:** FastAPI, Pydantic v2, pandas, numpy, `google-genai` (Gemini), pyserial, python-dotenv, pytest.

**Frontend:** React 19, Vite, Framer Motion, React-Leaflet, Recharts, PapaParse.

**Hardware (optional):** ESP32 + MPU6050, via WiFi/HTTP or USB-serial.

---

## Getting started

### Backend

```bash
cd backend
pip install -r requirements.txt
cp .env.example .env   # then fill in GEMINI_API_KEY (optional — app works without it)
uvicorn main:app --host 0.0.0.0 --port 8000
```

`--host 0.0.0.0` is required if you want real ESP32 hardware on the same network to reach it — `127.0.0.1` only accepts connections from the same machine.

Run tests: `pytest`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Set `VITE_API_BASE_URL` in `frontend/.env` if the backend isn't at `http://127.0.0.1:8000` (e.g. your LAN IP, if connecting real ESP32 hardware).

Run tests: `npm run test` · Build: `npm run build`

### Try it without any setup at all

Click any of the four sample scenarios on the landing page (Normal Flight, GPS Jammed, Battery Failure, Crash) — no upload needed, no hardware needed.

---

## API overview

| Endpoint | Purpose |
|---|---|
| `GET /health` | Backend liveness check |
| `POST /upload` | Upload a flight-log CSV, get a full investigation |
| `GET /sample?scenario=` | Load one of the 4 built-in synthetic scenarios |
| `POST /analyze` | Analyze pre-normalized telemetry points |
| `POST /live/start` | Start a live telemetry session |
| `POST /live/{id}/ingest` | Push one telemetry packet into a live session |
| `GET /live/{id}/investigation` | Get the current investigation for a live session |
| `DELETE /live/{id}` | Clear a live session |
| `POST /report/brief` | Generate the insurance brief for an investigation |

---

## Hardware setup (optional)

Real ESP32 + MPU6050 hardware can stream into the same pipeline via WiFi/HTTP or USB-serial. Full wiring diagrams and setup steps are in [backend/firmware/README.md](backend/firmware/README.md). Hardware is entirely optional — everything above works with simulated data.

---

## Known limitations

- A bare MPU6050 has no GPS or barometer, so speed and altitude aren't available from live hardware — only roll, pitch, and raw acceleration. This is a physical sensor limitation, not a software gap.
- No database or auth — this is a local-first, single-session tool by design, not a multi-tenant production service.
