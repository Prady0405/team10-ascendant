import { motion } from 'framer-motion';
import { useTimeline } from '../../context/TimelineContext.jsx';
import './HUD.css';

const SAT_DOTS = 12;

export default function HUD() {
  const { currentRow, highlightField, availableFields } = useTimeline();
  const pulsing = (field) => highlightField === field;
  const has = (field) => availableFields.includes(field);

  const batteryTone = currentRow.battery_pct < 20 ? 'critical' : currentRow.battery_pct < 40 ? 'warn' : 'ok';
  const satTone = currentRow.satellite_count < 3 ? 'critical' : 'ok';

  return (
    <div className="hud">
      <span className="hud-title mono">INSTRUMENT PANEL</span>

      {has('altitude_m') && (
        <HUDRow label="ALTITUDE" pulsing={pulsing('altitude_m')}>
          <span className="hud-value mono">
            {currentRow.altitude_m.toFixed(1)}
            <span className="hud-unit">m</span>
          </span>
        </HUDRow>
      )}

      {has('speed_mps') && (
        <HUDRow label="SPEED" pulsing={pulsing('speed_mps')}>
          <span className="hud-value mono">
            {currentRow.speed_mps.toFixed(1)}
            <span className="hud-unit">m/s</span>
          </span>
        </HUDRow>
      )}

      {has('heading_deg') && (
        <HUDRow label="HEADING" pulsing={pulsing('heading_deg')}>
          <span className="hud-value mono">
            {currentRow.heading_deg.toFixed(0)}
            <span className="hud-unit">deg</span>
          </span>
        </HUDRow>
      )}

      {has('battery_pct') && (
        <HUDRow label="BATTERY" pulsing={pulsing('battery_pct')}>
          <div className="hud-battery">
            <div className="hud-battery-track">
              <div
                className={`hud-battery-fill hud-tone-${batteryTone}`}
                style={{ width: `${Math.max(0, currentRow.battery_pct)}%` }}
              />
            </div>
            <span className="hud-value mono">{currentRow.battery_pct.toFixed(0)}%</span>
          </div>
        </HUDRow>
      )}

      {has('satellite_count') && (
        <HUDRow label="SATELLITES" pulsing={pulsing('satellite_count')}>
          <div className="hud-sats">
            <div className="hud-sat-dots">
              {Array.from({ length: SAT_DOTS }).map((_, i) => (
                <span
                  key={i}
                  className={`hud-sat-dot ${i < currentRow.satellite_count ? `active hud-tone-${satTone}` : ''}`}
                />
              ))}
            </div>
            <span className="hud-value mono">{currentRow.satellite_count}</span>
          </div>
        </HUDRow>
      )}

      {has('accel_mps2') && (
        <HUDRow label="ACCEL" pulsing={pulsing('accel_mps2')}>
          <span className="hud-value mono">
            {currentRow.accel_mps2.toFixed(2)}
            <span className="hud-unit">m/s²</span>
          </span>
        </HUDRow>
      )}

      {has('yaw_rate_dps') && (
        <HUDRow label="YAW RATE" pulsing={pulsing('yaw_rate_dps')}>
          <span className="hud-value mono">
            {currentRow.yaw_rate_dps.toFixed(1)}
            <span className="hud-unit">deg/s</span>
          </span>
        </HUDRow>
      )}

      {availableFields.length === 0 && (
        <p className="hud-empty">Position only — no other instrument fields in this log.</p>
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
