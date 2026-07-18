import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { TimelineProvider } from '../../context/TimelineContext.jsx';
import { investigationToRows } from '../../lib/investigationAdapter.js';
import FlightMap from './FlightMap.jsx';
import HUD from './HUD.jsx';
import TelemetryStrip from './TelemetryStrip.jsx';
import Controls from './Controls.jsx';
import IncidentTimeline from './IncidentTimeline.jsx';
import ReportPanel from '../Report/ReportPanel.jsx';
import './ReplayView.css';

export default function ReplayView({ investigation, sourceLabel, onReset }) {
  const rows = useMemo(() => investigationToRows(investigation), [investigation]);

  return (
    <TimelineProvider rows={rows}>
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
            {investigation.ran_locally && <span className="replay-offline-badge mono">OFFLINE ANALYSIS</span>}
          </div>
          <button className="replay-reset" onClick={onReset}>
            New Flight
          </button>
        </header>

        <div className="replay-main">
          <div className="replay-col-map">
            <FlightMap />
            <TelemetryStrip />
            <Controls />
            <IncidentTimeline incidents={investigation.incidents ?? []} />
          </div>
          <div className="replay-col-side">
            <HUD />
            <ReportPanel investigation={investigation} />
          </div>
        </div>
      </motion.div>
    </TimelineProvider>
  );
}
