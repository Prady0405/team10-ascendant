# Black Box — Flight Log Decoder

A drone flight-log decoder that turns raw telemetry into a cinematic replay and
a provable, plain-English incident report. A deterministic rules engine reads
the CSV and detects anomalies; an AI layer only narrates what the engine
already found — it never invents a cause. Every narrative line is clickable
and jumps the map, scrubber, and HUD straight to the data point that proves it.

## Stack

React + Vite, Leaflet (`react-leaflet`), Framer Motion, Recharts, PapaParse,
the Web Speech API, and one serverless function (`api/narrate.js`) that calls
an LLM to phrase the rules engine's findings in plain English. No backend
database, no auth — fully stateless.

## Getting started

```bash
npm install
npm run dev      # http://localhost:5173
npm test         # detection engine unit tests (vitest)
npm run build
```

The 4 sample flights are pre-generated CSVs in `public/samples/`. Regenerate
them with:

```bash
node scripts/generateSamples.mjs
```

## AI narration

`api/narrate.js` is a Vercel Edge Function. Set `ANTHROPIC_API_KEY` in your
Vercel project to enable it. Without a deployed function or key, the app
falls back to a deterministic local narrator (`src/lib/localNarrator.js`) so
the demo works out of the box. Either way, every narrative line is
re-validated client-side against the rules engine's own events before it can
reach the UI — the confidence fraction always comes from the engine, never
the model.

## Detection engine

`src/lib/detectionEngine.js` is pure, dependency-free, and unit tested
(`src/lib/detectionEngine.test.js`). Six independent rules — signal loss,
impact/crash, battery anomaly, erratic flight, loiter pattern, and sustained
altitude loss — each produce `{ type, timestamp, description, evidence }`
events. The confidence fraction shown in the UI (e.g. "2/6 signals confirm
this cause") is a count of how many of those rules agree on the same root
cause, never a model-generated number.

Every rule's window is defined in elapsed **time**, not reading count. Real
logs sample at wildly different rates — this app's synthetic samples are
~1Hz, a real MAVROS setpoint stream can be ~50Hz+ — so a count-based window
(e.g. "3 readings") would fire dozens of times too eagerly on a fast log and
never fire on a slow one; a time-based window ("3 seconds") behaves the same
regardless of sample rate. `erratic_flight` also averages position over a
rolling window rather than comparing consecutive rows, because a commanded
setpoint stream commonly updates its target at a lower rate than the log
itself, so most rows repeat the same value and then jump in a discrete step —
dividing that step by a near-zero single-row `dt` looks like an impossible
speed that never actually happened. All of this was found and fixed against
a real ~53Hz MAVROS `setpoint_raw/local` engine-failure log, which also
exposed a genuine altitude drop (50m → 31m over the flight's final 16s) that
the original near-zero-altitude `impact` rule couldn't see — hence
`altitude_loss`, which catches a descent in progress even when the log ends
before the aircraft reaches the ground.

## Flexible CSV schema

Not every flight log in the wild carries the same columns. Only a timestamp
column is required — everything else, including position, is analyzed if
present and skipped if it isn't. `src/lib/csvParser.js` recognizes both this
app's own column names and common alternates (e.g. a MAVROS/ROS bag CSV
export's `%time`, `field.latitude`, `field.velocity.x/y/z`, `field.yaw`), and
derives fields it doesn't have directly: speed from a 3-axis velocity vector,
heading in degrees from a yaw angle in radians, ISO timestamps from
nanosecond/second epoch values, and — when there's no GPS lat/lon at all — a
plottable position from a local `position.x/y` frame (common in ROS
PositionTarget-style logs), converted around an arbitrary reference origin so
the path's real shape and scale still show up on the map. If a log has no
position data whatsoever, the map panel says so instead of rendering, and the
position-dependent rules (erratic flight, loiter) are skipped rather than run
against nothing. The detection engine only runs rules whose required fields
(and position, where needed) exist (`RULE_REQUIRED_FIELDS` /
`POSITION_DEPENDENT_RULES` in `src/lib/detectionEngine.js`), so the confidence
denominator reflects how many rules could actually be checked, not always 5.
The HUD, telemetry chart, and report panel likewise only render the fields
the uploaded file actually has.

If the uploaded filename hints at a failure type (e.g.
`battery_failure_log.csv`, `engine_failure_...csv`), that's shown as a small
"filed as" tag next to the source name (`src/lib/filenameLabel.js`) — purely
for context. It's never fed into the detection engine or the verdict, which
come from telemetry alone; a mislabeled filename won't change the analysis.

Also derived when present: acceleration magnitude (`accel_mps2`, from a
3-axis acceleration/force vector) and yaw rate in degrees/second
(`yaw_rate_dps`, from a raw rad/s field) — both shown in the HUD and
telemetry chart alongside altitude, speed, battery, and satellites.

## Flight summary

Below the map, HUD, and report sits a plain-English paragraph
(`src/lib/flightSummary.js`, rendered by
`src/components/Report/FlightSummary.jsx`) synthesizing the whole flight:
duration, ground track distance, the range of every telemetry field this
specific file actually has, the deterministic verdict and its confidence
fraction, and which fields were absent and therefore not analyzed. Every
number in it is read straight off the parsed rows or the rules engine's own
result — nothing is invented, same as everywhere else in this app.
