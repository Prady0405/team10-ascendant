import { useCallback, useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { parseFlightLogCSV, FlightLogParseError } from '../../lib/csvParser.js';
import { buildLocalInvestigation } from '../../lib/localFallback.js';
import * as api from '../../lib/api.js';
import { ApiError } from '../../lib/api.js';
import { SCENARIOS } from '../../data/scenarios.js';
import './Landing.css';

const SCENARIO_ICONS = {
  normal: 'check_circle',
  gps_loss: 'signal_disconnected',
  battery_failure: 'battery_alert',
  crash: 'dangerous',
};

const SCENARIO_TONE = {
  normal: 'ok',
  gps_loss: 'warn',
  battery_failure: 'warn',
  crash: 'critical',
};

function UploadIcon() {
  return (
    <svg viewBox="0 0 24 24" width="30" height="30" fill="none" stroke="currentColor" strokeWidth="1.5">
      <path d="M12 16V4M12 4L7 9M12 4l5 5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M4 15v3a2 2 0 002 2h12a2 2 0 002-2v-3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function Landing({ onLoad, onGoLive }) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);
  const [loadingScenario, setLoadingScenario] = useState(null);
  const [uploading, setUploading] = useState(false);
  const [joinSessionId, setJoinSessionId] = useState('');
  const [backendOnline, setBackendOnline] = useState(null); // null = checking
  const fileInputRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    api
      .checkHealth()
      .then((ok) => mounted && setBackendOnline(ok))
      .catch(() => mounted && setBackendOnline(false));
    return () => {
      mounted = false;
    };
  }, []);

  const handleFile = useCallback(
    async (file) => {
      setError(null);
      setUploading(true);
      try {
        const investigation = await api.uploadFlightLog(file);
        onLoad(investigation, file.name);
      } catch (backendErr) {
        if (backendErr instanceof ApiError) {
          // The backend was reached and rejected the file for a real reason
          // (e.g. an actually-missing timestamp column). Its parser accepts
          // far more header aliases than the offline fallback below, so its
          // message is authoritative — show it directly instead of masking
          // it behind the stricter local parser's unrelated complaint.
          setError(backendErr.message);
          return;
        }
        // Anything else (network error, backend not running, CORS) means we
        // genuinely couldn't reach the backend — fall back to local parsing.
        try {
          const text = await file.text();
          const rows = parseFlightLogCSV(text);
          onLoad(buildLocalInvestigation(rows, file.name), file.name);
        } catch (err) {
          setError(
            err instanceof FlightLogParseError
              ? err.message
              : `Could not read that file (backend also unreachable: ${backendErr.message}).`
          );
        }
      } finally {
        setUploading(false);
      }
    },
    [onLoad]
  );

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handleFile(file);
  };

  const handleScenario = async (scenario) => {
    setError(null);
    setLoadingScenario(scenario.id);
    try {
      const investigation = await api.fetchSample(scenario.id);
      onLoad(investigation, scenario.label);
    } catch (err) {
      setError(`Could not load the ${scenario.label} sample — is the backend running? (${err.message})`);
    } finally {
      setLoadingScenario(null);
    }
  };

  return (
    <div className="landing">
      <motion.div
        className="landing-status-bar mono"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.5 }}
      >
        <span className={`landing-status-dot landing-status-${backendOnline === null ? 'checking' : backendOnline ? 'ok' : 'down'}`} />
        {backendOnline === null ? 'CHECKING BACKEND…' : backendOnline ? 'BACKEND ONLINE' : 'BACKEND OFFLINE — OFFLINE ANALYSIS ONLY'}
      </motion.div>

      <motion.section
        className="landing-hero"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      >
        <div className="landing-hero-glow" aria-hidden="true" />
        <span className="landing-kicker mono">
          <span className="landing-kicker-pulse" />◆ BLACK BOX // FLIGHT LOG DECODER ◆
        </span>
        <h1 className="landing-headline">
          Every flight log has a story.
          <br />
          <span className="landing-headline-accent">This finds it — and proves it.</span>
        </h1>
        <p className="landing-sub">
          Drop a raw drone telemetry CSV and Black Box replays the flight, runs it through a
          deterministic rules engine, and writes a plain-English incident report where every
          claim links straight back to the exact data point that proves it.
        </p>
      </motion.section>

      <motion.section
        className={`landing-dropzone ${dragOver ? 'drag-over' : ''}`}
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.1, ease: 'easeOut' }}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        role="button"
        tabIndex={0}
        whileHover={{ scale: 1.005 }}
        whileTap={{ scale: 0.995 }}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          hidden
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <div className="landing-dropzone-icon">
          <UploadIcon />
        </div>
        <p className="landing-dropzone-title mono">
          {uploading ? 'ANALYZING…' : 'DROP FLIGHT LOG (.CSV) OR CLICK TO BROWSE'}
        </p>
        <p className="landing-schema mono">
          only a timestamp column is required — lat/lon (or a single combined "coordinates" column,
          e.g. "35.6892° N, 51.3890° E", anywhere on Earth), altitude, speed, battery, roll/pitch/yaw,
          satellites, hdop, signal, and accelerometer columns are all optional and recognized under
          common aliases (lat/latitude, alt/altitude_m, sats/satellite_count, etc.)
        </p>
      </motion.section>

      {error && (
        <motion.p className="landing-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          ⚠ {error}
        </motion.p>
      )}

      <motion.section
        className="landing-live-cta"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.15, ease: 'easeOut' }}
      >
        <motion.button
          className="live-cta-button"
          onClick={() => onGoLive()}
          whileHover={{ y: -2 }}
          whileTap={{ scale: 0.98 }}
        >
          <span className="live-cta-dot" />
          <span>
            <span className="live-cta-title mono">GO LIVE — REAL-TIME TELEMETRY</span>
            <span className="live-cta-sub">
              Simulate a live packet stream instantly, or connect real ESP32/MPU6050 hardware — same pipeline either way.
            </span>
          </span>
          <span className="live-cta-arrow mono">→</span>
        </motion.button>

        <form
          className="live-cta-join"
          onSubmit={(e) => {
            e.preventDefault();
            if (joinSessionId.trim()) onGoLive(joinSessionId.trim());
          }}
        >
          <input
            type="text"
            placeholder="Or join an existing session ID (e.g. esp32-serial)"
            value={joinSessionId}
            onChange={(e) => setJoinSessionId(e.target.value)}
            className="live-cta-join-input mono"
          />
          <button type="submit" className="live-cta-join-button" disabled={!joinSessionId.trim()}>
            Join
          </button>
        </form>
      </motion.section>

      <motion.section
        className="landing-scenarios"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2, ease: 'easeOut' }}
      >
        <h2>Or load a sample flight</h2>
        <div className="landing-scenario-grid">
          {SCENARIOS.map((s, i) => (
            <motion.button
              key={s.id}
              className={`scenario-card scenario-tone-${SCENARIO_TONE[s.id] ?? 'ok'}`}
              onClick={() => handleScenario(s)}
              disabled={loadingScenario !== null}
              whileHover={{ y: -6 }}
              whileTap={{ scale: 0.98 }}
              transition={{ type: 'spring', stiffness: 400, damping: 25 }}
            >
              <div className="scenario-card-top">
                <span className="scenario-icon material-symbols-outlined" aria-hidden="true">
                  {SCENARIO_ICONS[s.id] ?? 'radio_button_checked'}
                </span>
                <span className="scenario-index mono">{String(i + 1).padStart(2, '0')}</span>
              </div>
              <span className="scenario-label">{s.label}</span>
              <span className="scenario-tagline">{s.tagline}</span>
              <span className="scenario-cta mono">
                {loadingScenario === s.id ? 'LOADING…' : 'REPLAY →'}
              </span>
            </motion.button>
          ))}
        </div>
      </motion.section>
    </div>
  );
}
