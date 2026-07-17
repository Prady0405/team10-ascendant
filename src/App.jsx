import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Landing from './components/Landing/Landing.jsx';
import ReplayView from './components/Replay/ReplayView.jsx';

export default function App() {
  const [flight, setFlight] = useState(null);

  const handleLoad = useCallback((rows, label) => {
    setFlight({ rows, label });
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
          <ReplayView rows={flight.rows} sourceLabel={flight.label} onReset={handleReset} />
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
