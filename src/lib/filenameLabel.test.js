import { describe, it, expect } from 'vitest';
import { labelFromFilename } from './filenameLabel.js';

describe('labelFromFilename', () => {
  it('recognizes a flyaway filename', () => {
    expect(labelFromFilename('drone_flyaway_incident.csv')).toBe('Flyaway');
  });

  it('recognizes a signal jam / GPS spoofing filename', () => {
    expect(labelFromFilename('gps_spoofing_test_04.csv')).toBe('Signal Jammed');
    expect(labelFromFilename('signal-jammed.csv')).toBe('Signal Jammed');
  });

  it('recognizes a battery failure filename', () => {
    expect(labelFromFilename('battery_failure_log.csv')).toBe('Battery Failure');
  });

  it('recognizes an engine/power failure filename', () => {
    expect(
      labelFromFilename('carbonZ_20181018110606_engine_failure_with_emr_trajmavrossetpoint_rawlocal.csv')
    ).toBe('Engine Failure');
    expect(labelFromFilename('motor_cutout_test.csv')).toBe('Engine Failure');
  });

  it('recognizes a loitering/surveillance filename', () => {
    expect(labelFromFilename('suspicious_loitering.csv')).toBe('Suspicious Loitering');
    expect(labelFromFilename('surveillance_case_12.csv')).toBe('Suspicious Loitering');
  });

  it('recognizes a crash/impact filename', () => {
    expect(labelFromFilename('crash_report_2024.csv')).toBe('Impact / Crash');
  });

  it('returns null for a filename with no recognizable failure type', () => {
    expect(labelFromFilename('ros-flight.csv')).toBeNull();
    expect(labelFromFilename('log_2024_04_05.csv')).toBeNull();
  });

  it('returns null for an empty or missing filename', () => {
    expect(labelFromFilename('')).toBeNull();
    expect(labelFromFilename(undefined)).toBeNull();
  });
});
