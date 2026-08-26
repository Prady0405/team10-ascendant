// Thin client for the BlackBox backend. Every function here either
// resolves with the parsed JSON body or throws — callers (Landing,
// LiveView) decide whether to fall back to the local, client-side engine
// when the backend is unreachable.

export const API_BASE = (import.meta.env.VITE_API_BASE_URL ?? 'http://127.0.0.1:8000').replace(/\/$/, '');

export class ApiError extends Error {}

async function asJson(response) {
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(body.detail || `Request failed with ${response.status}`);
  }
  return response.json();
}

export async function uploadFlightLog(file) {
  const formData = new FormData();
  formData.append('file', file);
  const response = await fetch(`${API_BASE}/upload`, { method: 'POST', body: formData });
  return asJson(response);
}

export async function fetchSample(scenarioId) {
  const response = await fetch(`${API_BASE}/sample?scenario=${encodeURIComponent(scenarioId)}`);
  return asJson(response);
}

export async function analyzeNormalized(points, source = 'external') {
  const response = await fetch(`${API_BASE}/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ points, source }),
  });
  return asJson(response);
}

export async function startLiveSession(sessionId) {
  const response = await fetch(`${API_BASE}/live/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId ?? null }),
  });
  const body = await asJson(response);
  return body.session_id;
}

export async function ingestLivePacket(sessionId, packet) {
  const response = await fetch(`${API_BASE}/live/${encodeURIComponent(sessionId)}/ingest`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(packet),
  });
  return asJson(response);
}

export async function fetchLiveInvestigation(sessionId) {
  const response = await fetch(`${API_BASE}/live/${encodeURIComponent(sessionId)}/investigation`);
  return asJson(response);
}

export async function clearLiveSession(sessionId) {
  const response = await fetch(`${API_BASE}/live/${encodeURIComponent(sessionId)}`, { method: 'DELETE' });
  return asJson(response);
}

export async function generateBrief(investigation) {
  const response = await fetch(`${API_BASE}/report/brief`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(investigation),
  });
  const body = await asJson(response);
  return body.report_text;
}

export async function checkHealth() {
  const response = await fetch(`${API_BASE}/health`, { signal: AbortSignal.timeout(2500) });
  return response.ok;
}
