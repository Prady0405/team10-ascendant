// BlackBox AI — ESP32 + MPU6050 on-board diagnostic sentinel.
//
// Wiring (I2C, default ESP32 pins):
//   ESP32 3V3 -> MPU6050 VCC
//   ESP32 GND -> MPU6050 GND
//   ESP32 G21 -> MPU6050 SDA
//   ESP32 G22 -> MPU6050 SCL
//
// Prints "LIVE_DATA,ax,ay,az" (accelerometer, g) over USB serial at
// 115200 baud. Read by backend/services/serial_bridge.py when the
// backend is started with SERIAL_PORT=<your COM port>, which forwards
// every line into the same live-session pipeline the WiFi/HTTP
// `/live/{session_id}/ingest` endpoint uses.
//
// Requires the Adafruit MPU6050 + Adafruit Unified Sensor libraries
// (Arduino Library Manager).

#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <Wire.h>

Adafruit_MPU6050 mpu;

void setup(void) {
  Serial.begin(115200);

  if (!mpu.begin()) {
    Serial.println("HARDWARE_ERROR: MPU6050 not found — check wiring.");
    while (1) {
      delay(10);
    }
  }

  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BANDWIDTH_21_HZ);
  delay(100);
}

void loop() {
  sensors_event_t accel, gyro, temp;
  mpu.getEvent(&accel, &gyro, &temp);

  // Adafruit reports acceleration in m/s^2; convert to g so it matches
  // the backend's TelemetryPoint.acceleration_* convention (1.0 = level).
  const float g = 9.80665;

  Serial.print("LIVE_DATA,");
  Serial.print(accel.acceleration.x / g, 4);
  Serial.print(",");
  Serial.print(accel.acceleration.y / g, 4);
  Serial.print(",");
  Serial.println(accel.acceleration.z / g, 4);

  delay(100); // ~10Hz
}
