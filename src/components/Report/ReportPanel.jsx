import { useState } from 'react';
import { motion } from 'framer-motion';
import { useTimeline } from '../../context/TimelineContext.jsx';
import VerdictCard from './VerdictCard.jsx';
import './ReportPanel.css';

// The hero interaction: clicking a narrative line animates the map, scrubber,
// and HUD to the exact frame that proves the claim — a crash investigator
// freezing the black-box tape on the critical second.
export default function ReportPanel({ detection, narration, loading }) {
  const { jumpToTimestamp } = useTimeline();
  const [activeLine, setActiveLine] = useState(null);

  const handleLineClick = (line, index) => {
    setActiveLine(index);
    jumpToTimestamp(line.timestamp_ref, { highlight: line.evidence_field });
  };

  return (
    <div className="report-panel">
      <VerdictCard detection={detection} narration={narration} loading={loading} />

      <div className="report-narrative">
        <span className="report-narrative-title mono">FLIGHT NARRATIVE</span>

        {loading && <p className="report-loading mono">ANALYZING TELEMETRY…</p>}

        {!loading && narration.narrative.length === 0 && (
          <p className="report-empty">No anomalies detected — nothing to prove.</p>
        )}

        {!loading && narration.narrative.length > 0 && (
          <ol className="report-lines">
            {narration.narrative.map((line, i) => (
              <li key={`${line.timestamp_ref}-${i}`}>
                <button
                  className={`report-line ${activeLine === i ? 'report-line-active' : ''}`}
                  onClick={() => handleLineClick(line, i)}
                >
                  {activeLine === i && (
                    <motion.span
                      layoutId="report-line-highlight"
                      className="report-line-highlight"
                      transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                    />
                  )}
                  <span className="report-line-index mono">{String(i + 1).padStart(2, '0')}</span>
                  <span className="report-line-text">{line.text}</span>
                  <span className="report-line-proof mono">▶ {line.evidence_field}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
