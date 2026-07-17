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
(`src/lib/detectionEngine.test.js`). Five independent rules — signal loss,
impact/crash, battery anomaly, erratic flight, and loiter pattern — each
produce `{ type, timestamp, description, evidence }` events. The confidence
fraction shown in the UI (e.g. "2/5 signals confirm this cause") is a count of
how many of those five rules agree on the same root cause, never a
model-generated number.

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
`battery_failure_log.csv`), that's shown as a small "filed as" tag next to
the source name (`src/lib/filenameLabel.js`) — purely for context. It's never
fed into the detection engine or the verdict, which come from telemetry
alone; a mislabeled filename won't change the analysis.
