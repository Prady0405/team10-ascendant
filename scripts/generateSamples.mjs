// Generates the 4 synthetic sample flight logs used by the app's scenario cards.
// Run with: node scripts/generateSamples.mjs
// Deterministic (seeded PRNG) so the injected anomalies are stable across regenerations.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT_DIR = join(__dirname, '..', 'public', 'samples');

const METERS_PER_DEG_LAT = 111320;
const BASE_LAT = 37.8199;
const BASE_LON = -122.4783;
const START_TIME = new Date('2026-03-14T09:00:00Z').getTime();

// Small deterministic PRNG (mulberry32) so runs are reproducible.
function makeRng(seed) {
  let a = seed;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function offsetLatLon(lat, lon, dNorthM, dEastM) {
  const dLat = dNorthM / METERS_PER_DEG_LAT;
  const dLon = dEastM / (METERS_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180));
  return { lat: lat + dLat, lon: lon + dLon };
}

function normalizeHeading(deg) {
  return ((deg % 360) + 360) % 360;
}

const COLUMNS = ['timestamp', 'lat', 'lon', 'altitude_m', 'speed_mps', 'battery_pct', 'satellite_count', 'heading_deg'];

function toCSV(rows) {
  const lines = [COLUMNS.join(',')];
  for (const row of rows) {
    lines.push(
      COLUMNS.map((c) => {
        const v = row[c];
        return typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(6)) : v;
      }).join(',')
    );
  }
  return lines.join('\n') + '\n';
}

// Builds a baseline "nominal" flight: climb, cruise on a gentle curving heading,
// steady battery drain, healthy GPS lock. Callers mutate/extend it per scenario.
function buildBaseline({ count, rng, batteryDrainPerSec = 0.055, cruiseAltitude = 55, cruiseSpeed = 9 }) {
  const rows = [];
  let lat = BASE_LAT;
  let lon = BASE_LON;
  let battery = 100;
  let heading = 40;

  for (let i = 0; i < count; i++) {
    const t = i;
    const climbing = t < 15;
    const altitude = climbing ? (cruiseAltitude * t) / 15 : cruiseAltitude + Math.sin(t / 14) * 2.5;
    const speed = climbing ? Math.min(cruiseSpeed, 1 + t * 0.6) : cruiseSpeed + Math.sin(t / 9) * 1.2;

    heading = normalizeHeading(heading + Math.sin(t / 20) * 4 + (rng() - 0.5) * 1.5);
    const headingRad = (heading * Math.PI) / 180;
    const stepDist = speed * 1; // 1s interval
    const move = offsetLatLon(lat, lon, Math.cos(headingRad) * stepDist, Math.sin(headingRad) * stepDist);
    lat = move.lat;
    lon = move.lon;

    battery = Math.max(0, battery - batteryDrainPerSec * (1 + (rng() - 0.5) * 0.15));

    rows.push({
      timestamp: new Date(START_TIME + i * 1000).toISOString(),
      lat,
      lon,
      altitude_m: Math.max(0, altitude),
      speed_mps: Math.max(0, speed),
      battery_pct: Number(battery.toFixed(2)),
      satellite_count: 10 + Math.round((rng() - 0.5) * 2),
      heading_deg: Number(heading.toFixed(1)),
    });
  }
  return rows;
}

// --- Scenario 1: Flyaway ---------------------------------------------------
// GPS drifts erratically and the drone stops responding to commands from ~60% in.
function buildFlyaway() {
  const rng = makeRng(1);
  const count = 180;
  const rows = buildBaseline({ count, rng });
  const flyawayStart = Math.floor(count * 0.6);

  let lat = rows[flyawayStart - 1].lat;
  let lon = rows[flyawayStart - 1].lon;

  for (let i = flyawayStart; i < count; i++) {
    const jumpDist = 60 + rng() * 220;
    const jumpBearing = rng() * 2 * Math.PI;
    const jumped = offsetLatLon(lat, lon, Math.cos(jumpBearing) * jumpDist, Math.sin(jumpBearing) * jumpDist);
    lat = jumped.lat;
    lon = jumped.lon;

    rows[i] = {
      ...rows[i],
      lat,
      lon,
      heading_deg: Number((rng() * 360).toFixed(1)),
      speed_mps: Number((14 + rng() * 12).toFixed(2)),
      altitude_m: Number(Math.max(5, rows[i].altitude_m + (rng() - 0.5) * 20).toFixed(2)),
      // satellite lock stays intact — this is a control/nav failure, not a jam.
      satellite_count: 9 + Math.round((rng() - 0.5) * 2),
    };
  }
  return rows;
}

// --- Scenario 2: Signal Jammed ---------------------------------------------
// satellite_count collapses to 0 abruptly mid-flight; the log goes erratic afterward.
function buildSignalJammed() {
  const rng = makeRng(2);
  const count = 170;
  const rows = buildBaseline({ count, rng });
  const jamStart = Math.floor(count * 0.5);
  const erraticBurstFor = 4; // the first few readings after jam swing wildly (dead-reckoning failure)

  let lat = rows[jamStart - 1].lat;
  let lon = rows[jamStart - 1].lon;

  for (let i = jamStart; i < count; i++) {
    const inBurst = i < jamStart + erraticBurstFor;
    const driftDist = inBurst ? 120 + rng() * 150 : 8 + rng() * 25;
    const driftBearing = rng() * 2 * Math.PI;
    const drifted = offsetLatLon(lat, lon, Math.cos(driftBearing) * driftDist, Math.sin(driftBearing) * driftDist);
    lat = drifted.lat;
    lon = drifted.lon;

    rows[i] = {
      ...rows[i],
      lat,
      lon,
      satellite_count: 0,
      heading_deg: Number((inBurst ? rng() * 360 : normalizeHeading(rows[i].heading_deg + (rng() - 0.5) * 140)).toFixed(1)),
      speed_mps: Number(Math.max(0, rows[i].speed_mps + (rng() - 0.5) * 6).toFixed(2)),
    };
  }
  return rows;
}

// --- Scenario 3: Battery Failure --------------------------------------------
// battery_pct discharges far faster than the baseline curve; altitude drops shortly after.
function buildBatteryFailure() {
  const rng = makeRng(3);
  const count = 160;
  const rows = buildBaseline({ count, rng, batteryDrainPerSec: 0.05 });
  const failureStart = Math.floor(count * 0.55);
  const fastDrainFor = 20;
  const crashStart = failureStart + fastDrainFor;
  const crashDuration = 5; // freefall to impact happens quickly, right as the battery bottoms out

  let battery = rows[failureStart - 1].battery_pct;
  for (let i = failureStart; i < crashStart; i++) {
    battery = Math.max(0, battery - (0.4 + rng() * 0.12));
    rows[i] = { ...rows[i], battery_pct: Number(battery.toFixed(2)) };
  }

  let altitude = rows[crashStart - 1].altitude_m;
  const altStep = altitude / crashDuration;
  for (let i = crashStart; i < crashStart + crashDuration; i++) {
    battery = Math.max(0, battery - (0.3 + rng() * 0.1));
    altitude = Math.max(0, altitude - altStep * (1 + rng() * 0.3));
    rows[i] = {
      ...rows[i],
      battery_pct: Number(battery.toFixed(2)),
      altitude_m: Number(altitude.toFixed(2)),
      speed_mps: Number((rows[i].speed_mps + 14).toFixed(2)), // uncontrolled dive picks up speed
    };
  }

  const impactIdx = crashStart + crashDuration - 1;
  rows[impactIdx] = { ...rows[impactIdx], altitude_m: 0, speed_mps: 0 }; // sudden stop on impact

  for (let i = impactIdx + 1; i < count; i++) {
    battery = Math.max(0, battery - 0.02);
    rows[i] = { ...rows[i], altitude_m: 0, speed_mps: 0, battery_pct: Number(battery.toFixed(2)) };
  }
  return rows;
}

// --- Scenario 4: Suspicious Loitering ---------------------------------------
// Flight path repeats a tight circle over one area for an extended stretch.
function buildSuspiciousLoitering() {
  const rng = makeRng(4);
  const preCount = 70;
  const loiterCount = 110;
  const postCount = 40;
  const rows = buildBaseline({ count: preCount, rng });

  const center = { lat: rows[preCount - 1].lat, lon: rows[preCount - 1].lon };
  const radius = 14;
  const angularSpeed = (2 * Math.PI) / 22; // one full loop roughly every 22s

  let battery = rows[preCount - 1].battery_pct;
  for (let i = 0; i < loiterCount; i++) {
    const angle = i * angularSpeed;
    const point = offsetLatLon(center.lat, center.lon, Math.sin(angle) * radius, Math.cos(angle) * radius);
    battery = Math.max(0, battery - 0.05 * (1 + (rng() - 0.5) * 0.15));
    rows.push({
      timestamp: new Date(START_TIME + (preCount + i) * 1000).toISOString(),
      lat: point.lat,
      lon: point.lon,
      altitude_m: Number((45 + Math.sin(i / 6) * 1.5).toFixed(2)),
      speed_mps: Number((radius * angularSpeed + (rng() - 0.5) * 0.4).toFixed(2)),
      battery_pct: Number(battery.toFixed(2)),
      satellite_count: 10 + Math.round((rng() - 0.5) * 2),
      heading_deg: Number(normalizeHeading((angle * 180) / Math.PI + 90).toFixed(1)),
    });
  }

  let heading = rows[rows.length - 1].heading_deg;
  let lat = rows[rows.length - 1].lat;
  let lon = rows[rows.length - 1].lon;
  for (let i = 0; i < postCount; i++) {
    heading = normalizeHeading(heading + Math.sin(i / 20) * 4);
    const headingRad = (heading * Math.PI) / 180;
    const speed = 8.5 + Math.sin(i / 9) * 1;
    const moved = offsetLatLon(lat, lon, Math.cos(headingRad) * speed, Math.sin(headingRad) * speed);
    lat = moved.lat;
    lon = moved.lon;
    battery = Math.max(0, battery - 0.055 * (1 + (rng() - 0.5) * 0.15));
    rows.push({
      timestamp: new Date(START_TIME + (preCount + loiterCount + i) * 1000).toISOString(),
      lat,
      lon,
      altitude_m: Number((50 + Math.sin(i / 10) * 2).toFixed(2)),
      speed_mps: Number(speed.toFixed(2)),
      battery_pct: Number(battery.toFixed(2)),
      satellite_count: 10 + Math.round((rng() - 0.5) * 2),
      heading_deg: Number(heading.toFixed(1)),
    });
  }

  return rows;
}

const scenarios = {
  'flyaway.csv': buildFlyaway,
  'signal-jammed.csv': buildSignalJammed,
  'battery-failure.csv': buildBatteryFailure,
  'suspicious-loitering.csv': buildSuspiciousLoitering,
};

for (const [filename, build] of Object.entries(scenarios)) {
  const rows = build();
  writeFileSync(join(OUT_DIR, filename), toCSV(rows));
  console.log(`wrote ${filename} (${rows.length} rows)`);
}
