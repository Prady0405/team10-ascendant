import { useState } from 'react';
import { motion } from 'framer-motion';
import HealthGauge from './HealthGauge.jsx';
import './VerdictCard.css';

const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window;

const RISK_CATEGORIES = [
  { key: 'jamming', label: 'Signal Jamming', color: '#ffb300' },
  { key: 'spoofing', label: 'GPS Spoofing', color: '#c77dff' },
  { key: 'hardware', label: 'Hardware / Power', color: '#ff4d4d' },
  { key: 'pilot_error', label: 'Operator Input', color: '#5aa9ff' },
  { key: 'structural', label: 'Structural / Impact', color: '#ff8a3d' },
];

function healthTone(score) {
  if (score >= 80) return 'ok';
  if (score >= 50) return 'warn';
  return 'critical';
}

function RiskDistribution({ distribution }) {
  if (!distribution || !Object.values(distribution).some((v) => v > 0)) return null;
  return (
    <div className="verdict-risk">
      <span className="verdict-risk-title mono">LIABILITY RISK DISTRIBUTION</span>
      {RISK_CATEGORIES.filter((c) => (distribution[c.key] ?? 0) > 0).map((category, i) => (
        <div className="verdict-risk-row" key={category.key}>
          <span className="verdict-risk-label">{category.label}</span>
          <div className="verdict-risk-track">
            <motion.div
              className="verdict-risk-fill"
              style={{ background: category.color, boxShadow: `0 0 8px ${category.color}` }}
              initial={{ width: 0 }}
              animate={{ width: `${distribution[category.key]}%` }}
              transition={{ duration: 0.8, delay: 0.2 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
            />
          </div>
          <span className="verdict-risk-value mono" style={{ color: category.color }}>
            {distribution[category.key].toFixed(0)}%
          </span>
        </div>
      ))}
    </div>
  );
}

export default function VerdictCard({ investigation }) {
  const [speaking, setSpeaking] = useState(false);
  const aiSummary = investigation.ai_summary ?? {};
  const healthScore = investigation.health_score ?? 100;
  const hasAnomaly = (investigation.incidents?.length ?? 0) > 0;
  const riskDistribution = investigation.statistics?.risk_distribution;

  const speak = () => {
    if (!canSpeak) return;
    window.speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(
      `${aiSummary.verdict} ${aiSummary.probable_cause ?? ''} Health score: ${healthScore} out of 100.`
    );
    utterance.rate = 0.98;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    setSpeaking(true);
    window.speechSynthesis.speak(utterance);
  };

  return (
    <motion.div
      className={`verdict-card ${hasAnomaly ? 'verdict-alert' : 'verdict-clear'}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4 }}
    >
      <div className="verdict-top">
        <div>
          <span className="verdict-label mono">VERDICT</span>
          <p className="verdict-text">{aiSummary.verdict}</p>
        </div>
        <HealthGauge score={healthScore} tone={healthTone(healthScore)} />
      </div>

      {aiSummary.probable_cause && <p className="verdict-cause">{aiSummary.probable_cause}</p>}

      <RiskDistribution distribution={riskDistribution} />

      {aiSummary.ai_available === false && (
        <p className="verdict-fallback mono">
          {aiSummary.fallback_reason ?? 'AI narrative unavailable — deterministic findings only.'}
        </p>
      )}

      <div className="verdict-footer">
        <span className="verdict-confidence mono">
          {typeof aiSummary.confidence === 'number' ? `${Math.round(aiSummary.confidence * 100)}% confidence` : ''}
        </span>
        {canSpeak && (
          <button className="verdict-speak" onClick={speak} disabled={speaking}>
            {speaking ? '🔊 Speaking…' : '🔊 Narrate Aloud'}
          </button>
        )}
      </div>
    </motion.div>
  );
}
