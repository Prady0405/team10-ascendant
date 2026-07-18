import { motion } from 'framer-motion';
import { useTimeline } from '../../context/TimelineContext.jsx';
import './HUD.css';

const SAT_DOTS = 12;

export default function HUD() {
  const { currentRow, highlightField } = useTimeline();
  const pulsing = (field) => highlightField === field;

  const hasAltitude = currentRow.altitude != null;
  const hasSpeed = currentRow.speed != null;
  const hasYaw = currentRow.yaw != null;
  const hasBattery = currentRow.battery != null;
  const hasSats = currentRow.gps_satellites != null;
  const hasRoll = currentRow.roll != null;
  const hasPitch = currentRow.pitch != null;
  const hasSignal = currentRow.signal_strength != null;

  const batteryTone = !hasBattery ? 'ok' : currentRow.battery < 20 ? 'critical' : currentRow.battery < 40 ? 'warn' : 'ok';
  const satTone = hasSats && currentRow.gps_satellites < 3 ? 'critical' : 'ok';
  const tiltTone = (value) => (Math.abs(value) > 120 ? 'critical' : Math.abs(value) > 45 ? 'warn' : 'ok');

  return (
    <div className="hud">
      <span className="hud-title mono">INSTRUMENT PANEL</span>

      {hasAltitude && (
        <HUDRow label="ALTITUDE" pulsing={pulsing('altitude')}>
          <span className="hud-value mono">
            {currentRow.altitude.toFixed(1)}
            <span className="hud-unit">m</span>
          </span>
        </HUDRow>
      )}

      {hasSpeed && (
        <HUDRow label="SPEED" pulsing={pulsing('speed')}>
          <span className="hud-value mono">
            {currentRow.speed.toFixed(1)}
            <span className="hud-unit">m/s</span>
          </span>
        </HUDRow>
      )}

      {hasYaw && (
        <HUDRow label="HEADING" pulsing={pulsing('yaw')}>
          <span className="hud-value mono">
            {currentRow.yaw.toFixed(0)}
            <span className="hud-unit">deg</span>
          </span>
        </HUDRow>
      )}

      {hasRoll && (
        <HUDRow label="ROLL" pulsing={pulsing('roll')}>
          <span className={`hud-value mono hud-tone-${tiltTone(currentRow.roll)}`}>
            {currentRow.roll.toFixed(0)}
            <span className="hud-unit">deg</span>
          </span>
        </HUDRow>
      )}

      {hasPitch && (
        <HUDRow label="PITCH" pulsing={pulsing('pitch')}>
          <span className={`hud-value mono hud-tone-${tiltTone(currentRow.pitch)}`}>
            {currentRow.pitch.toFixed(0)}
            <span className="hud-unit">deg</span>
          </span>
        </HUDRow>
      )}

      {hasBattery && (
        <HUDRow label="BATTERY" pulsing={pulsing('battery')}>
          <div className="hud-battery">
            <div className="hud-battery-track">
              <div
                className={`hud-battery-fill hud-tone-${batteryTone}`}
                style={{ width: `${Math.max(0, currentRow.battery)}%` }}
              />
            </div>
            <span className="hud-value mono">{currentRow.battery.toFixed(0)}%</span>
          </div>
        </HUDRow>
      )}

      {hasSats && (
        <HUDRow label="SATELLITES" pulsing={pulsing('gps_satellites')}>
          <div className="hud-sats">
            <div className="hud-sat-dots">
              {Array.from({ length: SAT_DOTS }).map((_, i) => (
                <span
                  key={i}
                  className={`hud-sat-dot ${i < currentRow.gps_satellites ? `active hud-tone-${satTone}` : ''}`}
                />
              ))}
            </div>
            <span className="hud-value mono">{currentRow.gps_satellites}</span>
          </div>
        </HUDRow>
      )}

      {hasSignal && (
        <HUDRow label="SIGNAL" pulsing={pulsing('signal_strength')}>
          <div className="hud-battery">
            <div className="hud-battery-track">
              <div
                className={`hud-battery-fill hud-tone-${currentRow.signal_strength < 20 ? 'critical' : currentRow.signal_strength < 40 ? 'warn' : 'ok'}`}
                style={{ width: `${Math.max(0, currentRow.signal_strength)}%` }}
              />
            </div>
            <span className="hud-value mono">{currentRow.signal_strength.toFixed(0)}%</span>
          </div>
        </HUDRow>
      )}
    </div>
  );
}

function HUDRow({ label, pulsing, children }) {
  return (
    <motion.div
      className="hud-row"
      animate={pulsing ? { backgroundColor: ['rgba(255,179,0,0)', 'rgba(255,179,0,0.22)', 'rgba(255,179,0,0)'] } : {}}
      transition={pulsing ? { duration: 0.9, repeat: 2 } : {}}
    >
      <span className="hud-label">{label}</span>
      {children}
    </motion.div>
  );
}
