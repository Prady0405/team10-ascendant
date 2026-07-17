export const SCENARIOS = [
  {
    id: 'flyaway',
    label: 'Flyaway',
    file: '/samples/flyaway.csv',
    tagline: 'GPS drifts erratically — the drone stops responding to commands.',
  },
  {
    id: 'signal-jammed',
    label: 'Signal Jammed',
    file: '/samples/signal-jammed.csv',
    tagline: 'Satellite lock collapses to zero mid-flight, then the log turns erratic.',
  },
  {
    id: 'battery-failure',
    label: 'Battery Failure',
    file: '/samples/battery-failure.csv',
    tagline: 'Battery drains far faster than a normal curve, then altitude falls.',
  },
  {
    id: 'suspicious-loitering',
    label: 'Suspicious Loitering',
    file: '/samples/suspicious-loitering.csv',
    tagline: 'The flight path circles a tight radius over one area far too long.',
  },
];
