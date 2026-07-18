import { useCallback, useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { LineChart, Line, XAxis, YAxis, ResponsiveContainer } from 'recharts';
import * as api from '../../lib/api.js';
import { buildCalmSequence, buildFlipSequence, buildCollisionSequence, buildFreeFallSequence, accelForTilt } from '../../lib/imuSimulator.js';
import AttitudeIndicator from './AttitudeIndicator.jsx';
import '../Replay/ReplayView.css';
import '../Report/ReportPanel.css';
import '../Report/MissionDashboard.css';
import './LiveView.css';

const POLL_INTERVAL_MS = 1000;
const CHART_WINDOW = 60;

// Inverse of imuSimulator's accelForTilt — recovers roll/pitch straight from
// the local accel state so the horizon can respond instantly to a drag or
// slider, instead of waiting up to a second for the next server poll.
function attitudeFromAccel(x, y, z) {
  const roll = (Math.atan2(y, z) * 180) / Math.PI;
  const pitch = (Math.atan2(-x, Math.sqrt(y * y + z * z)) * 180) / Math.PI;
  return { roll, pitch };
}

export default function LiveView({ onFinish, onExit, initialSessionId }) {
  const [phase, setPhase] = useState('connecting'); // connecting | ready | error
  const [errorMessage, setErrorMessage] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [investigation, setInvestigation] = useState(null);
  const [flashAlert, setFlashAlert] = useState(null);
  const [simulating, setSimulating] = useState(false);
  const [manual, setManualState] = useState({ x: 0, y: 0, z: 1 });
  const [manualStreaming, setManualStreaming] = useState(false);
  const [pulseKey, setPulseKey] = useState(0);
  const seenIncidentIds = useRef(new Set());
  const flashTimeoutRef = useRef(null);
  const pollRef = useRef(null);
  const manualRef = useRef({ x: 0, y: 0, z: 1 });
  const manualIntervalRef = useRef(null);

  // Sliders (and drags on the attitude indicator) write to a ref — read
  // fresh by the streaming interval below — and to state for the on-screen
  // readout, in one call, so a change while streaming takes effect on the
  // very next tick instead of waiting for a re-render.
  const setManual = (next) => {
    manualRef.current = next;
    setManualState(next);
  };

  const startManualStreaming = () => {
    if (manualIntervalRef.current || !sessionId) return;
    setManualStreaming(true);
    manualIntervalRef.current = setInterval(() => {
      const { x, y, z } = manualRef.current;
      api.ingestLivePacket(sessionId, { accel_x: x, accel_y: y, accel_z: z }).catch(() => {});
      setPulseKey((k) => k + 1);
    }, 150);
  };

  const stopManualStreaming = () => {
    clearInterval(manualIntervalRef.current);
    manualIntervalRef.current = null;
    setManualStreaming(false);
  };

  const toggleManualStreaming = () => {
    if (manualStreaming) {
      stopManualStreaming();
      return;
    }
    if (!sessionId || simulating) return;
    startManualStreaming();
  };

  // Dragging the attitude indicator itself: convert the angle straight to
  // an accelerometer reading and auto-start the same stream the sliders use,
  // so touching the horizon is a third way into the same pipeline.
  const handleAttitudeDrag = (rollDeg, pitchDeg) => {
    if (simulating || !sessionId) return;
    const { accel_x, accel_y, accel_z } = accelForTilt(rollDeg, pitchDeg);
    setManual({ x: accel_x, y: accel_y, z: accel_z });
    startManualStreaming();
  };

  useEffect(() => () => clearInterval(manualIntervalRef.current), []);

  useEffect(() => {
    let cancelled = false;

    if (initialSessionId) {
      // Joining an already-running session (e.g. the backend's USB-serial
      // bridge, or reconnecting after a page reload) — never call
      // startLiveSession here, that would wipe out whatever's already
      // been buffered for it.
      setSessionId(initialSessionId);
      setPhase('ready');
      return undefined;
    }

    api
      .startLiveSession()
      .then((id) => {
        if (cancelled) return;
        setSessionId(id);
        setPhase('ready');
      })
      .catch((err) => {
        if (cancelled) return;
        setErrorMessage(err.message);
        setPhase('error');
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const poll = useCallback(async () => {
    if (!sessionId) return;
    try {
      const data = await api.fetchLiveInvestigation(sessionId);
      setInvestigation(data);

      const newCritical = (data.incidents ?? []).find(
        (incident) => !seenIncidentIds.current.has(incident.id) && incident.severity === 'critical'
      );
      for (const incident of data.incidents ?? []) seenIncidentIds.current.add(incident.id);

      if (newCritical) {
        clearTimeout(flashTimeoutRef.current);
        setFlashAlert(newCritical);
        flashTimeoutRef.current = setTimeout(() => setFlashAlert(null), 3000);
      }
    } catch {
      // transient network hiccup during polling — next tick will retry
    }
  }, [sessionId]);

  useEffect(() => {
    if (phase !== 'ready' || !sessionId) return undefined;
    poll();
    pollRef.current = setInterval(poll, POLL_INTERVAL_MS);
    return () => clearInterval(pollRef.current);
  }, [phase, sessionId, poll]);

  useEffect(() => () => clearTimeout(flashTimeoutRef.current), []);

  const runSequence = async (packets) => {
    if (!sessionId || simulating) return;
    setSimulating(true);
    for (const packet of packets) {
      try {
        await api.ingestLivePacket(sessionId, packet);
        setPulseKey((k) => k + 1);
      } catch {
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 120));
    }
    await poll();
    setSimulating(false);
  };

  const handleFinish = async () => {
    if (!sessionId) return;
    const finalInvestigation = await api.fetchLiveInvestigation(sessionId).catch(() => investigation);
    onFinish(finalInvestigation, 'ESP32 Live Session');
  };

  const handleExit = async () => {
    if (sessionId) api.clearLiveSession(sessionId).catch(() => {});
    onExit();
  };

  if (phase === 'error') {
    return (
      <div className="live-view live-view-error">
        <p className="mono">COULD NOT START A LIVE SESSION</p>
        <p className="live-error-detail">{errorMessage}</p>
        <p className="live-error-hint">Is the backend running? (`uvicorn main:app`)</p>
        <button className="replay-reset" onClick={onExit}>
          Back
        </button>
      </div>
    );
  }

  if (phase === 'connecting') {
    return (
      <div className="live-view live-view-connecting">
        <p className="mono">CONNECTING…</p>
      </div>
    );
  }

  const rows = investigation?.raw_data ?? [];
  const latest = rows[rows.length - 1] ?? {};
  const previous = rows[rows.length - 2] ?? null;

  const magnitudeOf = (r) =>
    r && r.acceleration_x != null && r.acceleration_y != null && r.acceleration_z != null
      ? Math.sqrt(r.acceleration_x ** 2 + r.acceleration_y ** 2 + r.acceleration_z ** 2)
      : null;
  const latestMagnitude = magnitudeOf(latest);
  const previousMagnitude = magnitudeOf(previous);
  const dt = previous ? latest.timestamp - previous.timestamp : null;
  const jerk =
    latestMagnitude != null && previousMagnitude != null && dt
      ? Math.abs(latestMagnitude - previousMagnitude) / dt
      : null;
  const freeFalling = latestMagnitude != null && latestMagnitude <= 0.35;

  const chartData = rows.slice(-CHART_WINDOW).map((r, i) => ({
    i,
    roll: r.roll,
    pitch: r.pitch,
    accel: magnitudeOf(r),
  }));
  // While the user is actively driving manual/drag control, show the horizon
  // instantly from local state instead of waiting up to a second for the
  // next poll to reflect it — the server is still the source of truth for
  // everything else (incidents, health score, IMU readout tiles below).
  const manualAttitude = attitudeFromAccel(manual.x, manual.y, manual.z);
  const displayRoll = manualStreaming ? manualAttitude.roll : latest.roll ?? 0;
  const displayPitch = manualStreaming ? manualAttitude.pitch : latest.pitch ?? 0;
  const flipped = Math.abs(displayRoll) > 120 || Math.abs(displayPitch) > 120;
  const incidents = investigation?.incidents ?? [];
  const healthScore = investigation?.health_score ?? 100;

  return (
    <div className="live-view">
      <header className="live-header">
        <div>
          <span className="live-title mono">BLACK BOX // LIVE</span>
          <span className="live-session mono">session: {sessionId}</span>
        </div>
        <button className="replay-reset" onClick={handleExit}>
          Exit
        </button>
      </header>

      <div className="live-endpoint-hint mono">
        Real ingestion endpoint (for actual ESP32/MPU6050 hardware): POST {api.API_BASE}/live/{sessionId}/ingest
      </div>

      <div className="live-panel live-packetflow-panel">
        <span className="live-panel-title mono">HOW THIS WORKS — LIVE PACKET FLOW</span>
        <p className="live-simulate-note">
          Every simulate click, slider drag, or horizon drag below sends one real HTTP request to the backend,
          which re-runs the full detection pipeline on everything received so far and hands back updated
          incidents — that round trip is the dot below, made visible.
        </p>
        <div className="packetflow-diagram">
          <span className="packetflow-node-label mono">YOUR BROWSER</span>
          <span className="packetflow-node-label mono">INGEST API</span>
          <span className="packetflow-node-label mono">ANALYSIS ENGINE</span>
          <div className="packetflow-track">
            <span key={pulseKey} className="packetflow-pulse" />
          </div>
        </div>
      </div>

      <AnimatePresence>
        {flashAlert && (
          <motion.div
            className="live-flash"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
          >
            <span className="material-symbols-outlined" aria-hidden="true">warning</span> {flashAlert.title} — T+
            {Math.round(flashAlert.timestamp)}s
          </motion.div>
        )}
      </AnimatePresence>

      <div className="live-main">
        <div className="live-col">
          <div className="live-panel live-simulate-panel live-simulate-primary">
            <span className="live-panel-title mono">
              <span className="material-symbols-outlined" aria-hidden="true">science</span> SIMULATE LIVE TELEMETRY
            </span>
            <p className="live-simulate-note">
              No hardware on stage? These buttons stream synthetic IMU packets through the exact same
              ingestion pipeline real ESP32 hardware uses — indistinguishable to the backend.
            </p>
            <div className="live-simulate-buttons">
              <button disabled={simulating || manualStreaming} onClick={() => runSequence(buildCalmSequence())}>Calm hover</button>
              <button disabled={simulating || manualStreaming} onClick={() => runSequence(buildFlipSequence())}>Flip</button>
              <button disabled={simulating || manualStreaming} onClick={() => runSequence(buildCollisionSequence())}>Collision</button>
              <button disabled={simulating || manualStreaming} onClick={() => runSequence(buildFreeFallSequence())}>Free Fall</button>
            </div>
          </div>

          <div className="live-panel live-manual-panel">
            <span className="live-panel-title mono">
              <span className="material-symbols-outlined" aria-hidden="true">sports_esports</span> MANUAL PACKET
              CONTROL — PILOT IT YOURSELF
            </span>
            <p className="live-simulate-note">
              Drag an axis and watch the artificial horizon respond live — every drag sends a real accelerometer
              packet to the exact same ingestion endpoint, at the same 150ms cadence real hardware would use.
            </p>
            <div className="live-manual-sliders">
              {(['x', 'y', 'z']).map((axis) => (
                <label key={axis} className="live-manual-slider">
                  <span className="live-manual-slider-label mono">
                    accel_{axis} <span className="live-manual-slider-value">{manual[axis].toFixed(2)}g</span>
                  </span>
                  <input
                    type="range"
                    min={-3}
                    max={3}
                    step={0.05}
                    value={manual[axis]}
                    disabled={simulating}
                    onChange={(e) => setManual({ ...manualRef.current, [axis]: Number(e.target.value) })}
                  />
                </label>
              ))}
            </div>
            <div className="live-manual-actions">
              <button
                className="live-manual-toggle"
                disabled={simulating}
                onClick={toggleManualStreaming}
              >
                {manualStreaming ? '■ Stop Manual Stream' : '▶ Start Manual Stream'}
              </button>
              <button className="live-manual-reset" onClick={() => setManual({ x: 0, y: 0, z: 1 })}>
                Reset to level
              </button>
            </div>
          </div>

          <div className="live-panel live-attitude-panel">
            <span className="live-panel-title mono">ARTIFICIAL HORIZON</span>
            <AttitudeIndicator
              roll={displayRoll}
              pitch={displayPitch}
              flipped={flipped}
              interactive={phase === 'ready' && !simulating}
              onManualDrag={handleAttitudeDrag}
            />
            <p className="live-imu-note">
              Tilts live to match the drone's real roll/pitch — derived straight from the accelerometer, the
              same way the sensor itself has no idea which way is &quot;up&quot; except by feeling gravity's pull.
              Drag it yourself above.
            </p>
          </div>

          <div className="live-panel">
            <span className="live-panel-title mono">LIVE IMU READOUT</span>
            <div className="stat-grid">
              <div className="stat-tile">
                <span className="stat-tile-label">Roll</span>
                <span className="stat-tile-value mono">
                  {latest.roll != null ? latest.roll.toFixed(1) : '—'}
                  <span className="stat-tile-unit">deg</span>
                </span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile-label">Pitch</span>
                <span className="stat-tile-value mono">
                  {latest.pitch != null ? latest.pitch.toFixed(1) : '—'}
                  <span className="stat-tile-unit">deg</span>
                </span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile-label">Accel X</span>
                <span className="stat-tile-value mono">
                  {latest.acceleration_x != null ? latest.acceleration_x.toFixed(2) : '—'}
                  <span className="stat-tile-unit">g</span>
                </span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile-label">Accel Y</span>
                <span className="stat-tile-value mono">
                  {latest.acceleration_y != null ? latest.acceleration_y.toFixed(2) : '—'}
                  <span className="stat-tile-unit">g</span>
                </span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile-label">Accel Z</span>
                <span className="stat-tile-value mono">
                  {latest.acceleration_z != null ? latest.acceleration_z.toFixed(2) : '—'}
                  <span className="stat-tile-unit">g</span>
                </span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile-label">Magnitude</span>
                <span className={`stat-tile-value mono ${freeFalling ? 'live-value-critical' : ''}`}>
                  {latestMagnitude != null ? latestMagnitude.toFixed(2) : '—'}
                  <span className="stat-tile-unit">g</span>
                </span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile-label">Jerk</span>
                <span className="stat-tile-value mono">
                  {jerk != null ? jerk.toFixed(1) : '—'}
                  <span className="stat-tile-unit">g/s</span>
                </span>
              </div>
              <div className="stat-tile">
                <span className="stat-tile-label">Packets</span>
                <span className="stat-tile-value mono">{rows.length}</span>
              </div>
            </div>
            <p className="live-imu-note">
              No GPS or barometer on this sensor, so speed and altitude aren't available — roll/pitch/acceleration
              is everything a bare accelerometer + gyro can actually measure. Jerk (rate of change of acceleration)
              is what the collision detector watches; near-zero magnitude is a free-fall signature.
            </p>
          </div>

          <div className="live-panel">
            <span className="live-panel-title mono">ROLL / PITCH / ACCEL MAGNITUDE</span>
            <ResponsiveContainer width="100%" height={140}>
              <LineChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                <XAxis dataKey="i" hide />
                <YAxis yAxisId="deg" hide domain={['auto', 'auto']} />
                <YAxis yAxisId="g" hide domain={[0, 'auto']} />
                <Line yAxisId="deg" type="monotone" dataKey="roll" stroke="#5aa9ff" strokeWidth={1.25} dot={false} isAnimationActive={false} />
                <Line yAxisId="deg" type="monotone" dataKey="pitch" stroke="#c77dff" strokeWidth={1.25} dot={false} isAnimationActive={false} />
                <Line yAxisId="g" type="monotone" dataKey="accel" stroke="#ffb300" strokeWidth={1.25} dot={false} isAnimationActive={false} />
              </LineChart>
            </ResponsiveContainer>
            <div className="telemetry-legend">
              <span><i style={{ background: '#5aa9ff' }} /> Roll</span>
              <span><i style={{ background: '#c77dff' }} /> Pitch</span>
              <span><i style={{ background: '#ffb300' }} /> Accel |g|</span>
            </div>
          </div>
        </div>

        <div className="live-col">
          <div className="live-panel">
            <span className="live-panel-title mono">SESSION</span>
            <div className="live-stat-row">
              <span>Packets received</span>
              <span className="mono">{rows.length}</span>
            </div>
            <div className="live-stat-row">
              <span>Health score</span>
              <span className={`mono live-health-${healthScore >= 80 ? 'ok' : healthScore >= 50 ? 'warn' : 'critical'}`}>
                {healthScore}
              </span>
            </div>
          </div>

          <div className="live-panel live-incidents-panel">
            <span className="live-panel-title mono">INCIDENTS SO FAR</span>
            {incidents.length === 0 && <p className="report-empty">Nothing detected yet.</p>}
            <ol className="report-lines">
              {incidents.map((incident) => (
                <li key={incident.id}>
                  <div className={`report-line report-line-static report-line-${incident.severity}`}>
                    <span className={`report-line-severity mono report-severity-${incident.severity}`}>
                      {incident.severity}
                    </span>
                    <span className="report-line-body">
                      <span className="report-line-text">{incident.title}</span>
                      <span className="report-line-evidence">{incident.evidence?.[0]?.reason}</span>
                    </span>
                    <span className="report-line-proof mono">T+{Math.round(incident.timestamp)}s</span>
                  </div>
                </li>
              ))}
            </ol>
          </div>

          <button className="live-finish-button" disabled={rows.length === 0} onClick={handleFinish}>
            Finalize Flight → View Report
          </button>
        </div>
      </div>
    </div>
  );
}
