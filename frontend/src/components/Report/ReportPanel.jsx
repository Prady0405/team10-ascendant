import { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useTimeline } from '../../context/TimelineContext.jsx';
import * as api from '../../lib/api.js';
import { formatBriefLocally } from '../../lib/briefFormatter.js';
import VerdictCard from './VerdictCard.jsx';
import MissionDashboard from './MissionDashboard.jsx';
import './ReportPanel.css';

// The hero interaction: clicking an incident animates the map, scrubber,
// and HUD to the exact frame that proves the claim — a crash investigator
// freezing the black-box tape on the critical second.
export default function ReportPanel({ investigation }) {
  const { rows, jumpToIndex } = useTimeline();
  const [activeLine, setActiveLine] = useState(null);
  const [brief, setBrief] = useState(null);
  const [briefLoading, setBriefLoading] = useState(false);
  const [touring, setTouring] = useState(false);
  const tourCancelRef = useRef(false);

  const incidents = investigation.incidents ?? [];
  const aiSummary = investigation.ai_summary ?? {};

  useEffect(() => () => {
    tourCancelRef.current = true;
  }, []);

  const handleIncidentClick = (incident, index) => {
    setActiveLine(index);
    const targetIndex = Math.min(incident.telemetry_index ?? 0, rows.length - 1);
    jumpToIndex(targetIndex, { highlight: incident.evidence?.[0]?.parameter });
  };

  // The "one-click investigation replay" — walks the map/scrubber through
  // every detected incident in order, pausing at each so a judge can read
  // the evidence, using the exact same cinematic jump as clicking a single
  // incident line manually.
  const handleTourClick = async () => {
    if (touring) {
      tourCancelRef.current = true;
      setTouring(false);
      return;
    }
    setTouring(true);
    tourCancelRef.current = false;
    for (let i = 0; i < incidents.length; i++) {
      if (tourCancelRef.current) break;
      handleIncidentClick(incidents[i], i);
      await new Promise((resolve) => setTimeout(resolve, 2400));
      if (tourCancelRef.current) break;
    }
    setTouring(false);
  };

  const handleCompileBrief = async () => {
    setBriefLoading(true);
    try {
      const text = await api.generateBrief(investigation);
      setBrief(text);
    } catch {
      setBrief(formatBriefLocally(investigation));
    } finally {
      setBriefLoading(false);
    }
  };

  const handleDownloadBrief = () => {
    const blob = new Blob([brief], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'blackbox-incident-brief.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="report-panel">
      <VerdictCard investigation={investigation} />

      <MissionDashboard investigation={investigation} />

      <div className="report-narrative">
        <div className="report-narrative-heading">
          <span className="report-narrative-title mono">DETECTED INCIDENTS</span>
          {incidents.length > 0 && (
            <button className="report-tour-button" onClick={handleTourClick}>
              {touring ? '■ Stop Tour' : '▶ Auto-Tour Incidents'}
            </button>
          )}
        </div>

        {incidents.length === 0 && <p className="report-empty">No anomalies detected — nothing to prove.</p>}

        {incidents.length > 0 && (
          <ol className="report-lines">
            {incidents.map((incident, i) => (
              <li key={incident.id ?? i}>
                <button
                  className={`report-line report-line-${incident.severity} ${activeLine === i ? 'report-line-active' : ''}`}
                  onClick={() => handleIncidentClick(incident, i)}
                >
                  {activeLine === i && (
                    <motion.span
                      layoutId="report-line-highlight"
                      className="report-line-highlight"
                      transition={{ type: 'spring', stiffness: 400, damping: 34 }}
                    />
                  )}
                  <span className={`report-line-severity mono report-severity-${incident.severity}`}>
                    {incident.severity}
                  </span>
                  <span className="report-line-body">
                    <span className="report-line-text">{incident.title}</span>
                    <span className="report-line-evidence">{incident.evidence?.[0]?.reason}</span>
                    {incident.liability_hint && (
                      <span className="report-line-liability">
                        <span className="material-symbols-outlined" aria-hidden="true">balance</span>{' '}
                        {incident.liability_hint}
                      </span>
                    )}
                  </span>
                  <span className="report-line-proof mono">T+{Math.round(incident.timestamp)}s ▶</span>
                </button>
              </li>
            ))}
          </ol>
        )}

        {aiSummary.recommended_actions?.length > 0 && (
          <div className="report-actions">
            <span className="report-narrative-title mono">RECOMMENDED ACTIONS</span>
            <ul>
              {aiSummary.recommended_actions.map((action, i) => (
                <li key={i}>{action}</li>
              ))}
            </ul>
          </div>
        )}

        <div className="report-brief-section">
          <button className="report-brief-button" onClick={handleCompileBrief} disabled={briefLoading}>
            {briefLoading ? (
              'Compiling…'
            ) : (
              <>
                <span className="material-symbols-outlined" aria-hidden="true">description</span> Compile Insurance
                Brief
              </>
            )}
          </button>

          {brief && (
            <motion.div
              className="report-brief-output"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
            >
              <div className="report-brief-actions">
                <button onClick={handleDownloadBrief}>
                  <span className="material-symbols-outlined" aria-hidden="true">download</span> Download .txt
                </button>
              </div>
              <pre className="report-brief-text mono">{brief}</pre>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
