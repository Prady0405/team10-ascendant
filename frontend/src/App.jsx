import { useCallback, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import Landing from './components/Landing/Landing.jsx';
import ReplayView from './components/Replay/ReplayView.jsx';
import LiveView from './components/Live/LiveView.jsx';

export default function App() {
  const [flight, setFlight] = useState(null); // { investigation, label }
  const [mode, setMode] = useState('landing'); // 'landing' | 'replay' | 'live'
  const [joinSessionId, setJoinSessionId] = useState(null);

  const handleLoad = useCallback((investigation, label) => {
    setFlight({ investigation, label });
    setMode('replay');
  }, []);

  const handleGoLive = useCallback((sessionId) => {
    setJoinSessionId(sessionId || null);
    setMode('live');
  }, []);

  const handleReset = useCallback(() => {
    setFlight(null);
    setMode('landing');
  }, []);

  return (
    <>
      <div className="scanline" aria-hidden="true" />
      <AnimatePresence mode="wait">
        {mode === 'replay' && flight ? (
          <motion.div
            key="replay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
          >
            <ReplayView investigation={flight.investigation} sourceLabel={flight.label} onReset={handleReset} />
          </motion.div>
        ) : mode === 'live' ? (
          <motion.div
            key="live"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
          >
            <LiveView onFinish={handleLoad} onExit={handleReset} initialSessionId={joinSessionId} />
          </motion.div>
        ) : (
          <motion.div
            key="landing"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{ display: 'flex', flexDirection: 'column', flex: 1 }}
          >
            <Landing onLoad={handleLoad} onGoLive={handleGoLive} />
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
