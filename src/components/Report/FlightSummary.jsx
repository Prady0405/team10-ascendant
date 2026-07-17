import { useMemo } from 'react';
import { motion } from 'framer-motion';
import { buildFlightSummary } from '../../lib/flightSummary.js';
import './FlightSummary.css';

// A plain-English paragraph at the bottom of the page synthesizing everything
// analyzed above — duration, ground track, every telemetry field this
// specific file actually has, and the deterministic verdict. Every number is
// read straight off the parsed rows or the rules engine's result.
export default function FlightSummary({ rows, detection, availableFields, hasPosition, positionSource }) {
  const text = useMemo(
    () => buildFlightSummary(rows, detection, { availableFields, hasPosition, positionSource }),
    [rows, detection, availableFields, hasPosition, positionSource]
  );

  if (!text) return null;

  return (
    <motion.section
      className="flight-summary"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.15 }}
    >
      <span className="flight-summary-title mono">FLIGHT SUMMARY</span>
      <p className="flight-summary-text">{text}</p>
    </motion.section>
  );
}
