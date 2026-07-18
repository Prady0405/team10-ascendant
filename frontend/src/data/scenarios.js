// Sample flights served by the backend's deterministic math engine +
// rule engine (see backend/sample_data/generate_synthetic.py). `id` maps
// directly to the backend's `GET /sample?scenario=<id>` parameter.
export const SCENARIOS = [
  {
    id: 'normal',
    label: 'Normal Flight',
    tagline: 'A clean baseline mission — nothing trips the rule engine.',
  },
  {
    id: 'gps_loss',
    label: 'GPS Jammed',
    tagline: 'Satellite lock plunges while battery stays healthy — signal interference.',
  },
  {
    id: 'battery_failure',
    label: 'Battery Failure',
    tagline: 'Battery collapses in seconds, triggering a powerless descent and hard landing.',
  },
  {
    id: 'crash',
    label: 'Crash',
    tagline: 'Loss of control: attitude excursion, speed spike, then ground impact.',
  },
];
