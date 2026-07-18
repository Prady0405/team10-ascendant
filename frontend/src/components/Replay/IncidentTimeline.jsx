import { useMemo, useRef, useState } from 'react';
import { useTimeline } from '../../context/TimelineContext.jsx';
import './IncidentTimeline.css';

const SEVERITY_CLASS = {
  critical: 'incident-timeline-marker-critical',
  warning: 'incident-timeline-marker-warning',
  normal: 'incident-timeline-marker-normal',
};

// A scrubbable strip showing where every detected incident falls across the
// mission — click a marker to jump straight to that moment (same cinematic
// jump ReportPanel's incident list uses), or click anywhere on the track to
// scrub freely.
export default function IncidentTimeline({ incidents }) {
  const { rows, currentRow, jumpToIndex, jumpToTimestamp } = useTimeline();
  const trackRef = useRef(null);
  const [hovered, setHovered] = useState(null);

  const { minTs, span } = useMemo(() => {
    if (!rows.length) return { minTs: 0, span: 1 };
    const min = rows[0].timestamp ?? 0;
    const max = rows[rows.length - 1].timestamp ?? min + 1;
    return { minTs: min, span: Math.max(max - min, 0.001) };
  }, [rows]);

  const pctOf = (ts) => Math.max(0, Math.min(100, ((ts - minTs) / span) * 100));
  const playheadPct = pctOf(currentRow?.timestamp ?? minTs);

  const handleTrackClick = (e) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    jumpToTimestamp(minTs + ratio * span, { duration: 400 });
  };

  const handleMarkerClick = (incident, e) => {
    e.stopPropagation();
    const target = Math.min(incident.telemetry_index ?? 0, rows.length - 1);
    jumpToIndex(target, { highlight: incident.evidence?.[0]?.parameter });
  };

  return (
    <div className="incident-timeline">
      <div className="incident-timeline-header mono">
        <span>MISSION TIMELINE</span>
        {incidents.length > 0 ? (
          <span className="incident-timeline-count">
            {incidents.length} incident{incidents.length === 1 ? '' : 's'}
          </span>
        ) : (
          <span className="incident-timeline-count incident-timeline-count-clean">clean flight</span>
        )}
      </div>
      <div className="incident-timeline-track" ref={trackRef} onClick={handleTrackClick}>
        <div className="incident-timeline-playhead" style={{ left: `${playheadPct}%` }} />
        {incidents.map((incident, i) => (
          <button
            key={incident.id ?? i}
            type="button"
            className={`incident-timeline-marker ${SEVERITY_CLASS[incident.severity] ?? ''}`}
            style={{ left: `${pctOf(incident.timestamp)}%` }}
            onClick={(e) => handleMarkerClick(incident, e)}
            onMouseEnter={() => setHovered(incident)}
            onMouseLeave={() => setHovered(null)}
            aria-label={incident.title}
          />
        ))}
      </div>
      <div className="incident-timeline-tooltip mono" style={{ opacity: hovered ? 1 : 0 }}>
        {hovered && (
          <>
            <span className={`incident-timeline-tooltip-dot ${SEVERITY_CLASS[hovered.severity] ?? ''}`} />
            {hovered.title} — T+{Math.round(hovered.timestamp)}s
          </>
        )}
      </div>
    </div>
  );
}
