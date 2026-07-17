import { useMemo } from 'react';
import { LineChart, Line, XAxis, YAxis, ReferenceLine, ResponsiveContainer, Tooltip } from 'recharts';
import { useTimeline } from '../../context/TimelineContext.jsx';
import './TelemetryStrip.css';

// Each chartable field gets its own y-axis id so unrelated scales (meters,
// percent, satellite count) never distort each other, plus a color/label
// for the legend. Only the fields actually present in the CSV render at all.
const CHART_FIELDS = [
  { field: 'altitude_m', axisId: 'alt', domain: ['auto', 'auto'], color: '#3ddc84', label: 'Altitude' },
  { field: 'battery_pct', axisId: 'pct', domain: [0, 100], color: '#ffb300', label: 'Battery' },
  { field: 'satellite_count', axisId: 'sat', domain: [0, 14], color: '#5aa9ff', label: 'Satellites' },
  { field: 'speed_mps', axisId: 'spd', domain: ['auto', 'auto'], color: '#c084fc', label: 'Speed' },
  { field: 'accel_mps2', axisId: 'accel', domain: ['auto', 'auto'], color: '#ff9f5a', label: 'Accel' },
  { field: 'yaw_rate_dps', axisId: 'yawrate', domain: ['auto', 'auto'], color: '#5affd6', label: 'Yaw rate' },
];

export default function TelemetryStrip() {
  const { rows, currentIndex, setCurrentIndex, availableFields } = useTimeline();

  const chartFields = useMemo(
    () => CHART_FIELDS.filter((cf) => availableFields.includes(cf.field)),
    [availableFields]
  );

  const data = useMemo(
    () =>
      rows.map((r, i) => {
        const point = { i };
        for (const cf of chartFields) point[cf.field] = r[cf.field];
        return point;
      }),
    [rows, chartFields]
  );

  if (chartFields.length === 0) {
    return (
      <div className="telemetry-strip telemetry-strip-empty">
        <p>No chartable telemetry fields in this log — position data only.</p>
      </div>
    );
  }

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
          {chartFields.map((cf) => (
            <YAxis key={cf.axisId} yAxisId={cf.axisId} hide domain={cf.domain} />
          ))}
          <Tooltip
            contentStyle={{ background: '#131820', border: '1px solid #232a35', fontSize: 12 }}
            labelFormatter={() => ''}
            itemStyle={{ padding: 0 }}
          />
          {chartFields.map((cf) => (
            <Line
              key={cf.field}
              yAxisId={cf.axisId}
              type="monotone"
              dataKey={cf.field}
              name={cf.label}
              stroke={cf.color}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
            />
          ))}
          <ReferenceLine x={currentIndex} yAxisId={chartFields[0].axisId} stroke="#ff4d4d" strokeWidth={2} />
        </LineChart>
      </ResponsiveContainer>
      <div className="telemetry-legend">
        {chartFields.map((cf) => (
          <span key={cf.field}>
            <i style={{ background: cf.color }} /> {cf.label}
          </span>
        ))}
      </div>
    </div>
  );
}
