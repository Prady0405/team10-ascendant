import { useState } from 'react';
import { motion } from 'framer-motion';
import './VerdictCard.css';

const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

export default function VerdictCard({ detection, narration, loading }) {
  const [speaking, setSpeaking] = useState(false);

  const speak = () => {
    if (!narration || !canSpeak) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      `${narration.verdict} Confidence: ${narration.confidence} signals confirm this cause.`
    );
    utterance.rate = 0.98;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  const hasAnomaly = detection.rootCause !== 'none';

  return (
    <motion.div
      className={`verdict-card ${hasAnomaly ? 'verdict-alert' : 'verdict-clear'}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <span className="verdict-label mono">VERDICT</span>
      <p className="verdict-text">{loading ? 'Analyzing telemetry…' : narration.verdict}</p>
      <div className="verdict-footer">
        <span className="verdict-confidence mono">
          {detection.confidenceLabel} signals confirm this cause
        </span>
        {canSpeak && (
          <button className="verdict-speak" onClick={speak} disabled={loading || speaking}>
            {speaking ? '🔊 Speaking…' : '🔊 Narrate Aloud'}
          </button>
        )}
      </div>
    </motion.div>
  );
}
