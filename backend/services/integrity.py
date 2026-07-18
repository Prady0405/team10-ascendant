"""Chain-of-custody data integrity hashing.

This is what "defensive forensics" actually means in practice: not
detecting or countering an attacker, but preserving and proving data
integrity after the fact. A SHA-256 fingerprint of the exact telemetry
analyzed — and, for direct file uploads, of the original bytes as
received — is cryptographic proof the investigation ran against this
data, unmodified, letting a dispute later verify nothing was altered.
"""

import hashlib
import json
from datetime import datetime, timezone
from typing import Any, Optional


def hash_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def hash_telemetry(raw_data: list[dict[str, Any]]) -> str:
    """A stable fingerprint of the normalized telemetry itself — sorted
    keys and str-coerced values so the same data always hashes the same,
    regardless of dict ordering or float/int representation quirks.
    """
    canonical = json.dumps(raw_data, sort_keys=True, default=str).encode("utf-8")
    return hash_bytes(canonical)


def build_integrity_block(
    raw_data: list[dict[str, Any]], source_file_bytes: Optional[bytes] = None
) -> dict[str, Any]:
    """Builds the `integrity` block included in every investigation payload."""
    block: dict[str, Any] = {
        "algorithm": "SHA-256",
        "data_sha256": hash_telemetry(raw_data),
        "point_count": len(raw_data),
        "computed_at": datetime.now(timezone.utc).isoformat(),
    }
    if source_file_bytes is not None:
        block["source_file_sha256"] = hash_bytes(source_file_bytes)
        block["source_file_bytes"] = len(source_file_bytes)
    return block
