// A minimal artificial-horizon style attitude indicator: the horizon disk
// rotates with roll and shifts with pitch, same convention as a real flight
// instrument — including a fixed roll-tick scale with a rotating pointer,
// and a pitch ladder. Flashes red when either axis crosses the flip threshold.
// When `interactive`, it's also a control: drag it and `onManualDrag(roll, pitch)`
// fires continuously so the caller can stream those angles as real packets.

import { useRef } from 'react';

const ROLL_TICKS = [-60, -45, -30, -15, 0, 15, 30, 45, 60];

function rollTickMark(angle) {
  const rad = ((angle - 90) * Math.PI) / 180;
  const outerR = 74;
  const innerR = angle === 0 ? 62 : 68;
  const x1 = 80 + outerR * Math.cos(rad);
  const y1 = 80 + outerR * Math.sin(rad);
  const x2 = 80 + innerR * Math.cos(rad);
  const y2 = 80 + innerR * Math.sin(rad);
  return <line key={angle} x1={x1} y1={y1} x2={x2} y2={y2} className="attitude-roll-tick" />;
}

export default function AttitudeIndicator({ roll = 0, pitch = 0, flipped = false, interactive = false, onManualDrag }) {
  const clampedPitch = Math.max(-40, Math.min(40, pitch));
  const translateY = (clampedPitch / 40) * 30;
  const dragRef = useRef(null);

  const handlePointerDown = (e) => {
    if (!interactive) return;
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragRef.current = { startX: e.clientX, startY: e.clientY, startRoll: roll, startPitch: pitch };
  };

  const handlePointerMove = (e) => {
    if (!interactive || !dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    const nextRoll = Math.max(-170, Math.min(170, dragRef.current.startRoll + dx * 0.9));
    const nextPitch = Math.max(-80, Math.min(80, dragRef.current.startPitch - dy * 0.6));
    onManualDrag?.(nextRoll, nextPitch);
  };

  const handlePointerUp = () => {
    dragRef.current = null;
  };

  return (
    <div
      className={`attitude-indicator ${flipped ? 'attitude-flipped' : ''} ${interactive ? 'attitude-interactive' : ''}`}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={handlePointerUp}
    >
      {interactive && (
        <span className="attitude-drag-hint mono">
          <span className="material-symbols-outlined" aria-hidden="true">pan_tool</span> DRAG TO PILOT
        </span>
      )}
      <svg viewBox="0 0 160 160" width="100%" height="100%">
        <circle cx="80" cy="80" r="78" className="attitude-bezel" />

        {ROLL_TICKS.map(rollTickMark)}

        <clipPath id="attitude-clip">
          <circle cx="80" cy="80" r="60" />
        </clipPath>
        <g clipPath="url(#attitude-clip)">
          <g transform={`rotate(${roll} 80 80) translate(0 ${translateY})`}>
            <rect x="-40" y="-160" width="240" height="160" className="attitude-sky" />
            <rect x="-40" y="0" width="240" height="160" className="attitude-ground" />
            <line x1="-40" y1="0" x2="200" y2="0" className="attitude-horizon-line" />
            {/* pitch ladder: +/-10 and +/-20 degree reference lines */}
            <line x1="10" y1="-20" x2="30" y2="-20" className="attitude-pitch-rung" />
            <line x1="130" y1="-20" x2="150" y2="-20" className="attitude-pitch-rung" />
            <line x1="0" y1="-40" x2="40" y2="-40" className="attitude-pitch-rung" />
            <line x1="120" y1="-40" x2="160" y2="-40" className="attitude-pitch-rung" />
            <line x1="10" y1="20" x2="30" y2="20" className="attitude-pitch-rung" />
            <line x1="130" y1="20" x2="150" y2="20" className="attitude-pitch-rung" />
            <line x1="0" y1="40" x2="40" y2="40" className="attitude-pitch-rung" />
            <line x1="120" y1="40" x2="160" y2="40" className="attitude-pitch-rung" />
          </g>
          {/* rotating roll pointer, attached to the horizon disk */}
          <g transform={`rotate(${roll} 80 80)`}>
            <polygon points="80,10 75,20 85,20" className="attitude-roll-pointer" />
          </g>
        </g>

        <line x1="30" y1="80" x2="65" y2="80" className="attitude-marker" />
        <line x1="95" y1="80" x2="130" y2="80" className="attitude-marker" />
        <circle cx="80" cy="80" r="2.5" className="attitude-marker" />
      </svg>
      <div className="attitude-readout mono">
        <span>R {roll.toFixed(0)}°</span>
        <span>P {pitch.toFixed(0)}°</span>
      </div>
    </div>
  );
}
