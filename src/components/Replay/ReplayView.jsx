import { useEffect, useMemo, useState } from 'react';
import { motion } from 'framer-motion';
import { TimelineProvider } from '../../context/TimelineContext.jsx';
import { runDetectionEngine } from '../../lib/detectionEngine.js';
import { narrateFlight } from '../../lib/narrate.js';
import FlightMap from './FlightMap.jsx';
import HUD from './HUD.jsx';
import TelemetryStrip from './TelemetryStrip.jsx';
import Controls from './Controls.jsx';
import ReportPanel from '../Report/ReportPanel.jsx';
import './ReplayView.css';

export default function ReplayView({
  rows,
  availableFields,
  hasPosition,
  positionSource,
  sourceLabel,
  reportedLabel,
  onReset,
}) {
  const detection = useMemo(
    () => runDetectionEngine(rows, availableFields, hasPosition),
    [rows, availableFields, hasPosition]
  );
  const [narration, setNarration] = useState(null);
  const [narrationLoading, setNarrationLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setNarrationLoading(true);
    setNarration(null);
    narrateFlight(detection).then((result) => {
      if (!cancelled) {
        setNarration(result);
        setNarrationLoading(false);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [detection]);

  return (
    <TimelineProvider rows={rows} availableFields={availableFields}>
      <motion.div
        className="replay-view"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.4 }}
      >
        <header className="replay-header">
          <div className="replay-heading">
            <span className="replay-title mono">BLACK BOX</span>
            <span className="replay-source mono">{sourceLabel}</span>
            {reportedLabel && reportedLabel !== sourceLabel && (
              <span className="replay-filename-tag mono" title="Extracted from the filename — not analysis. Only the VERDICT panel below is derived from telemetry.">
                filed as: {reportedLabel}
              </span>
            )}
          </div>
          <button className="replay-reset" onClick={onReset}>
            New Flight
          </button>
        </header>

        <div className="replay-main">
          <div className="replay-col-map">
            <FlightMap positionSource={positionSource} />
            <TelemetryStrip />
            <Controls />
          </div>
          <div className="replay-col-side">
            <HUD />
            <ReportPanel detection={detection} narration={narration} loading={narrationLoading} />
          </div>
        </div>
      </motion.div>
    </TimelineProvider>
  );
}
