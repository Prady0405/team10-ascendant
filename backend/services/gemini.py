"""The narrative engine.

This is the ONLY module allowed to call an LLM. It does zero math and
detects zero incidents — it receives already-computed mission statistics
and already-detected incidents/evidence and translates them into a
human-readable brief. The prompt explicitly forbids inventing facts not
present in the supplied evidence.
"""

import json
import logging
from typing import Any

from google import genai
from google.genai import types

from utils.config import GEMINI_API_KEY, GEMINI_MODEL

logger = logging.getLogger(__name__)

SYSTEM_INSTRUCTION = """You are an aviation incident report writer for AirFlare/BlackBox AI, \
an enterprise drone flight-log diagnostics platform.

You will be given deterministically computed mission statistics and a list of incidents, \
each with structured evidence (exact timestamps, telemetry values, and thresholds).

Some incidents carry a `liability_category` and `liability_hint` — these were assigned by the \
deterministic rule engine, never guessed. You may reference them, but never invent your own \
liability conclusion and never state a probability or certainty stronger than what the evidence \
itself (including any `signal_disruption_probability` value) supports.

Rules you must follow exactly:
1. Only summarize the supplied evidence. Never invent a cause, value, or timestamp that is not present in the input.
2. Every factual claim must cite the timestamp and/or telemetry index it came from.
3. If the evidence is insufficient to determine a probable cause, say so explicitly instead of guessing.
4. Do not perform any new calculations — treat all provided numbers as ground truth.
5. Respond with ONLY a single JSON object, no markdown fences, matching this schema:
{
  "verdict": "<one sentence overall verdict>",
  "chronological_summary": "<narrative walkthrough of the mission in timestamp order>",
  "probable_cause": "<grounded probable cause, or a statement that evidence is insufficient>",
  "recommended_actions": ["<action 1>", "<action 2>"],
  "confidence": <float 0-1>
}
"""


def _fallback_summary(reason: str, incidents: list[dict[str, Any]]) -> dict[str, Any]:
    if not incidents:
        chronological_summary = "No incidents were detected during this mission."
        probable_cause = "No anomalies were found in the telemetry; no cause analysis is needed."
    else:
        chronological_summary = " ".join(
            f"At t={incident['timestamp']}s, {incident['title']} was detected "
            f"(index {incident['telemetry_index']})."
            for incident in incidents
        )
        probable_cause = (
            "AI narrative unavailable ("
            + reason
            + "). Refer to the incidents and evidence list below for the deterministic findings."
        )
    return {
        "verdict": "AI narrative unavailable — deterministic findings only." if incidents or reason else "No anomalies detected.",
        "chronological_summary": chronological_summary,
        "probable_cause": probable_cause,
        "recommended_actions": ["Review the incidents and evidence list for details."] if incidents else [],
        "confidence": 0.0,
        "ai_available": False,
        "fallback_reason": reason,
    }


def generate_mission_summary(
    mission_statistics: dict[str, Any],
    incidents: list[dict[str, Any]],
) -> dict[str, Any]:
    """Ask Gemini to translate deterministic findings into a readable brief.

    Falls back to a deterministic, evidence-only summary (no LLM call) if
    no API key is configured or the call fails for any reason — the
    pipeline must never break because the narrative layer is unavailable.
    """
    if not GEMINI_API_KEY:
        return _fallback_summary("GEMINI_API_KEY is not configured", incidents)

    payload = {
        "mission_statistics": mission_statistics,
        "incidents": incidents,
    }

    try:
        client = genai.Client(api_key=GEMINI_API_KEY)
        response = client.models.generate_content(
            model=GEMINI_MODEL,
            contents=json.dumps(payload, default=str),
            config=types.GenerateContentConfig(system_instruction=SYSTEM_INSTRUCTION),
        )
        text = (response.text or "").strip()
        if text.startswith("```"):
            text = text.strip("`")
            if text.startswith("json"):
                text = text[4:]
        parsed = json.loads(text)
        parsed["ai_available"] = True
        return parsed
    except Exception as exc:  # noqa: BLE001 - any LLM/network failure must degrade gracefully
        logger.warning("Gemini narrative generation failed: %s", exc)
        return _fallback_summary(f"Gemini call failed: {exc}", incidents)
