// Builds fake raw-accelerometer packets for demoing the live ESP32 pipeline
// without hardware wired up — mirrors backend/sample_data/simulate_esp32_stream.py
// so the browser-triggered demo and the hardware-free CLI script produce the
// same kind of signal shape.

export function accelForTilt(rollDeg, pitchDeg) {
  const rollRad = (rollDeg * Math.PI) / 180;
  const pitchRad = (pitchDeg * Math.PI) / 180;
  return {
    accel_x: Number((-Math.sin(pitchRad)).toFixed(4)),
    accel_y: Number((Math.sin(rollRad) * Math.cos(pitchRad)).toFixed(4)),
    accel_z: Number((Math.cos(pitchRad) * Math.cos(rollRad)).toFixed(4)),
  };
}

export function buildCalmSequence(steps = 6) {
  return Array.from({ length: steps }, (_, i) => accelForTilt(2 * Math.sin(i / 2), 1 * Math.cos(i / 2)));
}

export function buildFlipSequence() {
  const packets = [];
  for (let i = 0; i <= 5; i++) packets.push(accelForTilt(170 * (i / 5), 0));
  for (let i = 0; i < 3; i++) packets.push(accelForTilt(175, 0));
  for (let i = 0; i <= 5; i++) packets.push(accelForTilt(175 * (1 - i / 5), 0));
  return packets;
}

export function buildCollisionSequence() {
  return [
    { accel_x: 0, accel_y: 0, accel_z: 1 },
    { accel_x: 4.0, accel_y: 3.0, accel_z: 1.0 },
    { accel_x: 0, accel_y: 0, accel_z: 1 },
  ];
}

// Free fall (~0g on every axis) followed by an impact spike — mirrors what
// actually happens if you drop the hardware: the accelerometer reads near
// zero while falling, since it measures deviation from free fall, not
// gravity itself, then spikes hard the instant it hits something.
export function buildFreeFallSequence() {
  return [
    { accel_x: 0, accel_y: 0, accel_z: 1 },
    { accel_x: 0.02, accel_y: 0.01, accel_z: 0.05 },
    { accel_x: 0.01, accel_y: 0.02, accel_z: 0.03 },
    { accel_x: 0.0, accel_y: 0.01, accel_z: 0.02 },
    { accel_x: 3.5, accel_y: 0.2, accel_z: 3.0 },
    { accel_x: 0, accel_y: 0, accel_z: 1 },
  ];
}
