// Vercel Edge Function — the only server-side piece of this app.
// Input: ONLY the structured events already detected by the deterministic rules
// engine (never raw telemetry). Output: forced JSON narrating those events in
// plain English. The model is never allowed to introduce a cause of its own —
// the caller (src/lib/narrate.js) re-validates every line against the real
// events regardless of what comes back here.

export const config = { runtime: 'edge' };

const MODEL = 'claude-haiku-4-5-20251001';

const SYSTEM_PROMPT = `You narrate drone flight incident reports for crash investigators.
You will receive JSON with:
- "events": a list of anomalies a deterministic rules engine already detected, each with a type, timestamp, description, and evidence.
- "rootCauseLabel": the root cause the rules engine already determined.
- "confidenceLabel": the confidence fraction the rules engine already computed.

Your only job is to rephrase these into plain English. Rules:
1. Never invent an event, cause, or detail that is not present in the input.
2. Never change the confidence fraction — copy it verbatim.
3. The verdict must restate rootCauseLabel in one plain sentence, and nothing else.
4. Produce exactly one narrative entry per input event, in the same order, each keeping that event's exact timestamp and evidence field verbatim.
5. Respond with ONLY valid JSON, no markdown fences, no commentary, matching exactly:
{"verdict": string, "confidence": string, "narrative": [{"text": string, "timestamp_ref": string, "evidence_field": string}]}`;

function extractJSON(text) {
  try {
    return JSON.parse(text);
  } catch {
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405 });
  }

  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 });
  }

  const { events, rootCauseLabel, confidenceLabel } = body || {};
  if (!Array.isArray(events)) {
    return new Response(JSON.stringify({ error: '"events" must be an array' }), { status: 400 });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return new Response(JSON.stringify({ error: 'ANTHROPIC_API_KEY is not configured' }), { status: 500 });
  }

  try {
    const anthropicRes = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: JSON.stringify({ events, rootCauseLabel, confidenceLabel }) }],
      }),
    });

    if (!anthropicRes.ok) {
      const errText = await anthropicRes.text();
      return new Response(JSON.stringify({ error: `LLM API error: ${errText}` }), { status: 502 });
    }

    const data = await anthropicRes.json();
    const text = data?.content?.[0]?.text ?? '';
    const parsed = extractJSON(text);

    if (!parsed) {
      return new Response(JSON.stringify({ error: 'LLM did not return valid JSON' }), { status: 502 });
    }

    // The rules engine's own count is the source of truth — never trust the model's math.
    parsed.confidence = confidenceLabel;

    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: `Request failed: ${err.message}` }), { status: 500 });
  }
}
