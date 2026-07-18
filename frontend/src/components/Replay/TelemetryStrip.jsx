import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts';
import { useTimeline } from '../../context/TimelineContext.jsx';
import './TelemetryStrip.css';

export default function TelemetryStrip() {
  const { rows, currentIndex, setCurrentIndex } = useTimeline();

  const hasGps = useMemo(() => rows.some((r) => r.latitude != null), [rows]);

  const data = useMemo(
    () =>
      rows.map((r, i) => ({
        i,
        altitude: r.altitude,
        battery: r.battery,
        gps_satellites: r.gps_satellites,
        roll: r.roll,
        pitch: r.pitch,
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
          <YAxis yAxisId="tilt" hide domain={['auto', 'auto']} />
          <Tooltip
            contentStyle={{ background: '#131820', border: '1px solid #232a35', fontSize: 12 }}
            labelFormatter={() => ''}
            itemStyle={{ padding: 0 }}
          />
          {hasGps && (
            <Line
              yAxisId="alt"
              type="monotone"
              dataKey="altitude"
              name="Altitude (m)"
              stroke="#3ddc84"
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          )}
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="battery"
            name="Battery (%)"
            stroke="#ffb300"
            strokeWidth={1.5}
            dot={false}
            isAnimationActive={false}
          />
          {hasGps && (
            <Line
              yAxisId="sat"
              type="monotone"
              dataKey="gps_satellites"
              name="Satellites"
              stroke="#5aa9ff"
              strokeWidth={1.25}
              dot={false}
              isAnimationActive={false}
            />
          )}
          {!hasGps && (
            <>
              <Line
                yAxisId="tilt"
                type="monotone"
                dataKey="roll"
                name="Roll (deg)"
                stroke="#5aa9ff"
                strokeWidth={1.25}
                dot={false}
                isAnimationActive={false}
              />
              <Line
                yAxisId="tilt"
                type="monotone"
                dataKey="pitch"
                name="Pitch (deg)"
                stroke="#c77dff"
                strokeWidth={1.25}
                dot={false}
                isAnimationActive={false}
              />
            </>
          )}
          <ReferenceLine x={currentIndex} yAxisId={hasGps ? 'alt' : 'pct'} stroke="#ef4444" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
      <div className="telemetry-legend">
        {hasGps ? (
          <>
            <span>
              <i style={{ background: '#3ddc84' }} /> Altitude
            </span>
            <span>
              <i style={{ background: '#ffb300' }} /> Battery
            </span>
            <span>
              <i style={{ background: '#5aa9ff' }} /> Satellites
            </span>
          </>
        ) : (
          <>
            <span>
              <i style={{ background: '#ffb300' }} /> Battery
            </span>
            <span>
              <i style={{ background: '#5aa9ff' }} /> Roll
            </span>
            <span>
              <i style={{ background: '#c77dff' }} /> Pitch
            </span>
          </>
        )}
      </div>
    </div>
  );
}
