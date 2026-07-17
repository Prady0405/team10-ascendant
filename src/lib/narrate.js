import { buildLocalNarrative } from './localNarrator.js';

// Calls the /api/narrate serverless function with ONLY the structured events the
// deterministic rules engine already found — raw telemetry never leaves the browser.
// Falls back to the local narrator if the function is unreachable, and always
// re-validates whatever comes back so a hallucinated line can never reach the UI.
export async function narrateFlight(detection) {
  try {
    const res = await fetch('/api/narrate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        events: detection.events,
        rootCause: detection.rootCause,
        rootCauseLabel: detection.rootCauseLabel,
        confidenceLabel: detection.confidenceLabel,
      }),
    });
    if (!res.ok) throw new Error(`narrate API responded ${res.status}`);
    const data = await res.json();
    return sanitizeNarration(data, detection);
  } catch {
    return buildLocalNarrative(detection);
  }
}

// Every narrative line must trace back to a real detected event — this is the
// "prove every claim" guarantee enforced in code, not just by prompt instructions.
function sanitizeNarration(aiResponse, detection) {
  const eventsByTimestamp = new Map(detection.events.map((e) => [e.timestamp, e]));

  const narrative = Array.isArray(aiResponse?.narrative)
    ? aiResponse.narrative.filter((line) => {
        const source = eventsByTimestamp.get(line?.timestamp_ref);
        return (
          typeof line?.text === 'string' &&
          line.text.trim().length > 0 &&
          source !== undefined &&
          source.evidence.field === line.evidence_field
        );
      })
    : [];

  if (narrative.length === 0) {
    return buildLocalNarrative(detection);
  }

  return {
    verdict: typeof aiResponse.verdict === 'string' && aiResponse.verdict.trim()
      ? aiResponse.verdict.trim()
      : `${detection.rootCauseLabel}.`,
    // The confidence fraction is never trusted from the model — it is always the
    // rules engine's own count of independent rules that agree.
    confidence: detection.confidenceLabel,
    narrative,
  };
}
