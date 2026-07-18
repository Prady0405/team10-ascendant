import { useState } from 'react';
import { formatElapsed } from '../../lib/investigationAdapter.js';
import './MissionDashboard.css';

function StatTile({ label, value, unit }) {
  const hasValue = value !== null && value !== undefined;
  return (
    <div className="stat-tile">
      <span className="stat-tile-label">{label}</span>
      <span className="stat-tile-value mono">
        {hasValue ? value : '—'}
        {hasValue && unit && <span className="stat-tile-unit">{unit}</span>}
      </span>
    </div>
  );
}

function IntegrityCard({ integrity }) {
  const [copied, setCopied] = useState(false);
  if (!integrity) return null;

  const hash = integrity.data_sha256 ?? '';
  const shortHash = hash ? `${hash.slice(0, 16)}…${hash.slice(-8)}` : '—';

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(hash);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard permissions denied — non-critical, silently ignore
    }
  };

  return (
    <div className="integrity-card">
      <div className="integrity-header">
        <span className="integrity-title mono">🛡 DATA INTEGRITY — CHAIN OF CUSTODY</span>
      </div>
      <div className="integrity-rows">
        <div className="integrity-row">
          <span>Algorithm</span>
          <span className="mono">{integrity.algorithm}</span>
        </div>
        <div className="integrity-row">
          <span>Telemetry fingerprint</span>
          <button className="integrity-hash mono" onClick={handleCopy} title="Click to copy full hash">
            {copied ? 'Copied!' : shortHash}
          </button>
        </div>
        {integrity.source_file_sha256 && (
          <div className="integrity-row">
            <span>Source file fingerprint</span>
            <span className="mono integrity-hash-static">
              {integrity.source_file_sha256.slice(0, 16)}…{integrity.source_file_sha256.slice(-8)}
            </span>
          </div>
        )}
        <div className="integrity-row">
          <span>Points hashed</span>
          <span className="mono">{integrity.point_count}</span>
        </div>
        <div className="integrity-row">
          <span>Computed</span>
          <span className="mono">{integrity.computed_at ? new Date(integrity.computed_at).toLocaleString() : '—'}</span>
        </div>
      </div>
      <p className="integrity-note">
        This fingerprint proves the exact telemetry analyzed — recomputing it against the same data will always
        produce this same hash. Any alteration, however small, changes it completely.
      </p>
    </div>
  );
}

export default function MissionDashboard({ investigation }) {
  const stats = investigation.statistics ?? {};
  const integrity = investigation.integrity;

  return (
    <div className="mission-dashboard">
      <span className="mission-dashboard-title mono">MISSION DASHBOARD</span>

      <div className="stat-section">
        <span className="stat-section-title">FLIGHT</span>
        <div className="stat-grid">
          <StatTile label="Duration" value={stats.duration_seconds != null ? formatElapsed(stats.duration_seconds) : null} />
          <StatTile label="Distance" value={stats.distance_traveled_m?.toFixed(0)} unit="m" />
          <StatTile label="Max Altitude" value={stats.max_altitude_m?.toFixed(1)} unit="m" />
          <StatTile label="Avg Altitude" value={stats.avg_altitude_m?.toFixed(1)} unit="m" />
          <StatTile label="Max Speed" value={stats.max_speed_m_s?.toFixed(1)} unit="m/s" />
          <StatTile label="Avg Speed" value={stats.avg_speed_m_s?.toFixed(1)} unit="m/s" />
        </div>
      </div>

      <div className="stat-section">
        <span className="stat-section-title">POWER &amp; ATTITUDE</span>
        <div className="stat-grid">
          <StatTile label="Battery Start" value={stats.battery_start_pct?.toFixed(0)} unit="%" />
          <StatTile label="Battery End" value={stats.battery_end_pct?.toFixed(0)} unit="%" />
          <StatTile label="Battery Used" value={stats.battery_consumed_pct?.toFixed(1)} unit="%" />
          <StatTile label="Max Roll" value={stats.max_roll_deg?.toFixed(1)} unit="deg" />
          <StatTile label="Max Pitch" value={stats.max_pitch_deg?.toFixed(1)} unit="deg" />
        </div>
      </div>

      <div className="stat-section">
        <span className="stat-section-title">SIGNAL &amp; FORENSICS</span>
        <div className="stat-grid">
          <StatTile label="GPS Dropouts" value={stats.total_gps_dropouts} />
          <StatTile label="Anomalies Detected" value={stats.total_anomalies_detected} />
          <StatTile label="Telemetry Points" value={stats.total_telemetry_points} />
        </div>
      </div>

      <IntegrityCard integrity={integrity} />
    </div>
  );
}
