// Deterministic, non-AI fallback narrator. Used when the /api/narrate serverless
// function is unreachable (e.g. local `npm run dev` with no API key configured).
// It never invents anything either — it just surfaces the rules engine's own
// event descriptions verbatim, which is exactly what the AI layer is instructed to do.

export function buildLocalNarrative(detection) {
  const { events, rootCauseLabel, confidenceLabel } = detection;

  if (events.length === 0) {
    return {
      verdict: 'No anomaly detected — telemetry is consistent with a nominal flight.',
      confidence: confidenceLabel,
      narrative: [],
    };
  }

  return {
    verdict: `${rootCauseLabel}.`,
    confidence: confidenceLabel,
    narrative: events.map((event) => ({
      text: event.description,
      timestamp_ref: event.timestamp,
      evidence_field: event.evidence.field,
    })),
  };
}
