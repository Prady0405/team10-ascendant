// Best-effort label extracted from a flight log's filename (e.g. a file named
// "battery_failure_incident_04.csv" probably documents a battery failure).
// This is metadata only, shown for context in the UI — it is never fed into
// the detection engine or used to influence the verdict, which is derived
// solely from telemetry. A filename can claim anything; only the data proves it.
const FILENAME_KEYWORDS = [
  { pattern: /fly[\s_-]?away/, label: 'Flyaway' },
  { pattern: /(signal|gps)[\s_-]?(jam|jammed|jamming|spoof|spoofed|spoofing|loss|lost|denied|denial)/, label: 'Signal Jammed' },
  { pattern: /batt(ery)?[\s_-]?(fail|failure|drain|died|dead|critical)/, label: 'Battery Failure' },
  { pattern: /engine[\s_-]?(fail|failure)/, label: 'Engine Failure' },
  { pattern: /(power|motor)[\s_-]?(fail|failure|loss|cut|cutout)/, label: 'Engine Failure' },
  { pattern: /loiter(ing)?/, label: 'Suspicious Loitering' },
  { pattern: /surveil(lance)?/, label: 'Suspicious Loitering' },
  { pattern: /(crash|impact|collision)/, label: 'Impact / Crash' },
];

export function labelFromFilename(filename) {
  if (!filename) return null;
  const normalized = filename.replace(/\.[^.]+$/, '').toLowerCase();
  for (const { pattern, label } of FILENAME_KEYWORDS) {
    if (pattern.test(normalized)) return label;
  }
  return null;
}
