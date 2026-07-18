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
