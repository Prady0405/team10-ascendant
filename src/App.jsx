import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Landing from './components/Landing/Landing.jsx';
import ReplayView from './components/Replay/ReplayView.jsx';
import { labelFromFilename } from './lib/filenameLabel.js';

export default function App() {
  const [flight, setFlight] = useState(null);

  const handleLoad = useCallback(({ rows, availableFields, hasPosition, positionSource }, label) => {
    setFlight({ rows, availableFields, hasPosition, positionSource, label, reportedLabel: labelFromFilename(label) });
  }, []);

  const handleReset = useCallback(() => setFlight(null), []);

  return (
    <AnimatePresence mode="wait">
      {flight ? (
        <motion.div
          key="replay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
        >
          <ReplayView
            rows={flight.rows}
            availableFields={flight.availableFields}
            hasPosition={flight.hasPosition}
            positionSource={flight.positionSource}
            sourceLabel={flight.label}
            reportedLabel={flight.reportedLabel}
            onReset={handleReset}
          />
        </motion.div>
      ) : (
        <motion.div
          key="landing"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
        >
          <Landing onLoad={handleLoad} />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
