import { useCallback, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { parseFlightLogCSV, FlightLogParseError } from '../../lib/csvParser.js';
import { SCENARIOS } from '../../data/scenarios.js';
import './Landing.css';

export default function Landing({ onLoad }) {
  const [dragOver, setDragOver] = useState(false);
  const [error, setError] = useState(null);
  const [loadingScenario, setLoadingScenario] = useState(null);
  const fileInputRef = useRef(null);

  const handleFile = useCallback(
    async (file) => {
      setError(null);
      try {
        const text = await file.text();
        const rows = parseFlightLogCSV(text);
        onLoad(rows, file.name);
      } catch (err) {
        setError(err instanceof FlightLogParseError ? err.message : 'Could not read that file.');
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
      const res = await fetch(scenario.file);
      if (!res.ok) throw new Error('fetch failed');
      const text = await res.text();
      const rows = parseFlightLogCSV(text);
      onLoad(rows, scenario.label);
    } catch {
      setError(`Could not load the ${scenario.label} sample.`);
    } finally {
      setLoadingScenario(null);
    }
  };

  return (
    <div className="landing">
      <motion.section
        className="landing-hero"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: 'easeOut' }}
      >
        <span className="landing-kicker mono">BLACK BOX // FLIGHT LOG DECODER</span>
        <h1>
          Every flight log has a story.
          <br />
          This finds it — and proves it.
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
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".csv"
          hidden
          onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
        />
        <p className="landing-dropzone-title mono">DROP FLIGHT LOG (.CSV) OR CLICK TO BROWSE</p>
        <p className="landing-schema mono">
          timestamp, lat, lon, altitude_m, speed_mps, battery_pct, satellite_count, heading_deg
        </p>
      </motion.section>

      {error && (
        <motion.p className="landing-error" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
          {error}
        </motion.p>
      )}

      <motion.section
        className="landing-scenarios"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, delay: 0.2, ease: 'easeOut' }}
      >
        <h2>Or load a sample flight</h2>
        <div className="landing-scenario-grid">
          {SCENARIOS.map((s) => (
            <motion.button
              key={s.id}
              className="scenario-card"
              onClick={() => handleScenario(s)}
              disabled={loadingScenario !== null}
              whileHover={{ y: -4, borderColor: 'var(--amber)' }}
              whileTap={{ scale: 0.98 }}
            >
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
