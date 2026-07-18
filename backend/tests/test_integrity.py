from services.integrity import build_integrity_block, hash_bytes, hash_telemetry


def test_data_hash_is_stable_regardless_of_key_order():
    a = [{"timestamp": 0.0, "battery": 100.0}]
    b = [{"battery": 100.0, "timestamp": 0.0}]
    assert hash_telemetry(a) == hash_telemetry(b)


def test_data_hash_changes_when_data_changes():
    a = [{"timestamp": 0.0, "battery": 100.0}]
    b = [{"timestamp": 0.0, "battery": 99.9}]
    assert hash_telemetry(a) != hash_telemetry(b)


def test_integrity_block_without_source_file():
    block = build_integrity_block([{"timestamp": 0.0}])
    assert block["algorithm"] == "SHA-256"
    assert block["point_count"] == 1
    assert "data_sha256" in block
    assert "source_file_sha256" not in block


def test_integrity_block_with_source_file():
    file_bytes = b"timestamp,battery\n0,100\n"
    block = build_integrity_block([{"timestamp": 0.0}], source_file_bytes=file_bytes)
    assert block["source_file_sha256"] == hash_bytes(file_bytes)
    assert block["source_file_bytes"] == len(file_bytes)
