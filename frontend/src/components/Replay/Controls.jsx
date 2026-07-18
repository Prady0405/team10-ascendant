import { useTimeline } from '../../context/TimelineContext.jsx';
import { formatElapsed } from '../../lib/investigationAdapter.js';
import './Controls.css';

export default function Controls() {
  const { rows, currentIndex, setCurrentIndex, playing, togglePlay, currentRow } = useTimeline();

  return (
    <div className="controls">
      <button className="controls-play" onClick={togglePlay} aria-label={playing ? 'Pause' : 'Play'}>
        {playing ? '❚❚' : '▶'}
      </button>
      <input
        type="range"
        className="controls-scrubber"
        min={0}
        max={rows.length - 1}
        value={currentIndex}
        onChange={(e) => setCurrentIndex(Number(e.target.value))}
      />
      <span className="controls-time mono">T+{formatElapsed(currentRow.timestamp)}</span>
      <span className="controls-frame mono">
        {currentIndex + 1}/{rows.length}
      </span>
    </div>
  );
}
