import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts';
import { useTimeline } from '../../context/TimelineContext.jsx';
import './TelemetryStrip.css';

export default function TelemetryStrip() {
  const { rows, currentIndex, setCurrentIndex } = useTimeline();

  const data = useMemo(
    () =>
      rows.map((r, i) => ({
        i,
        altitude_m: r.altitude_m,
        battery_pct: r.battery_pct,
        satellite_count: r.satellite_count,
      })),
    [rows]
  );

  return (
    <div className="telemetry-strip">
      <ResponsiveContainer width="100%" height={130}>
        <LineChart
          data={data}
          margin={{ top: 10, right: 12, bottom: 0, left: 0 }}
          onClick={(e) => {
            if (e && e.activeLabel !== undefined) setCurrentIndex(e.activeLabel);
          }}
        >
          <XAxis dataKey="i" hide />
          <YAxis yAxisId="alt" hide domain={['auto', 'auto']} />
          <YAxis yAxisId="pct" hide domain={[0, 100]} />
          <YAxis yAxisId="sat" hide domain={[0, 14]} />
          <Tooltip
            contentStyle={{ background: '#131820', border: '1px solid #232a35', fontSize: 12 }}
            labelFormatter={() => ''}
            itemStyle={{ padding: 0 }}
          />
          <Line
            yAxisId="alt"
            type="monotone"
            dataKey="altitude_m"
            name="Altitude (m)"
            stroke="#3ddc84"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="battery_pct"
            name="Battery (%)"
            stroke="#ffb300"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            yAxisId="sat"
            type="monotone"
            dataKey="satellite_count"
            name="Satellites"
            stroke="#5aa9ff"
            strokeWidth={1.25}
            dot={false}
            isAnimationActive={false}
          />
          <ReferenceLine x={currentIndex} yAxisId="alt" stroke="#ff4d4d" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
      <div className="telemetry-legend">
        <span>
          <i style={{ background: '#3ddc84' }} /> Altitude
        </span>
        <span>
          <i style={{ background: '#ffb300' }} /> Battery
        </span>
        <span>
          <i style={{ background: '#5aa9ff' }} /> Satellites
        </span>
      </div>
    </div>
  );
}
