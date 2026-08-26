// BlackBox — ESP32 + MPU6050, WiFi/HTTP live-streaming firmware.
//
// This is the "Go Live" path: the ESP32 connects to your WiFi and POSTs
// JSON accelerometer packets straight to a live session on the backend —
// no USB cable, no COM port, works from anywhere on the same network.
//
// Setup:
//   1. Open the BlackBox web app, click "GO LIVE — ESP32 IMU".
//   2. It shows an endpoint line like:
//        POST http://192.168.0.100:8000/live/a1b2c3d4e5f6/ingest
//      Copy that FULL URL and paste it into INGEST_URL below.
//   3. Fill in your WiFi SSID/password below.
//   4. Flash this sketch (requires the Adafruit MPU6050 + Adafruit
//      Unified Sensor libraries via the Arduino Library Manager).
//   5. Power on the ESP32 — the SAME browser tab that showed the URL in
//      step 2 is already polling that exact session, so data appears
//      there automatically once packets start arriving.
//
// Using a phone hotspot instead of home WiFi:
//   Works the same way — just put the hotspot's SSID/password below
//   instead of a router's. Your laptop's IP changes once it joins the
//   hotspot (re-check with ipconfig/ifconfig WHILE connected to it, then
//   re-copy the ingest URL from the web app). If the ESP32 connects fine
//   but every POST times out, your phone may have AP/client isolation on
//   — see firmware/README.md for how to check.
//
// Wiring (I2C, default ESP32 pins):
//   ESP32 3V3 -> MPU6050 VCC
//   ESP32 GND -> MPU6050 GND
//   ESP32 G21 -> MPU6050 SDA
//   ESP32 G22 -> MPU6050 SCL

#include <WiFi.h>
#include <HTTPClient.h>
#include <Adafruit_MPU6050.h>
#include <Adafruit_Sensor.h>
#include <Wire.h>

const char* WIFI_SSID = "Trisha9-5G";
const char* WIFI_PASSWORD = "Trisha98";

// Paste the exact URL the web app showed you under "GO LIVE — ESP32 IMU".
// Must use your computer's LAN IP (e.g. 192.168.x.x), never 127.0.0.1 or
// "localhost" — those mean "this device itself" from the ESP32's point of
// view, not your computer.
const char* INGEST_URL = "http://192.168.0.100:8000/live/e56ba9f0ac16/ingest";

const unsigned long SEND_INTERVAL_MS = 150; // ~6-7 Hz, gentle on WiFi/backend

Adafruit_MPU6050 mpu;

void setup() {
  Serial.begin(115200);
  Wire.begin();

  if (!mpu.begin()) {
    Serial.println("HARDWARE_ERROR: MPU6050 not found — check wiring.");
    while (1) {
      delay(10);
    }
  }
  mpu.setAccelerometerRange(MPU6050_RANGE_8_G);
  mpu.setGyroRange(MPU6050_RANGE_500_DEG);
  mpu.setFilterBandwidth(MPU6050_BANDWIDTH_21_HZ);

  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  Serial.print("Connecting to WiFi");
  while (WiFi.status() != WL_CONNECTED) {
    delay(500);
    Serial.print(".");
  }
  Serial.println();
  Serial.print("Connected. ESP32 IP: ");
  Serial.println(WiFi.localIP());
}

void loop() {
  sensors_event_t accel, gyro, temp;
  mpu.getEvent(&accel, &gyro, &temp);

  // Adafruit reports m/s^2; convert to g so it matches the backend's
  // TelemetryPoint.acceleration_* convention (level == 1.0).
  const float g = 9.80665;
  float ax = accel.acceleration.x / g;
  float ay = accel.acceleration.y / g;
  float az = accel.acceleration.z / g;

  if (WiFi.status() == WL_CONNECTED) {
    HTTPClient http;
    http.begin(INGEST_URL);
    http.addHeader("Content-Type", "application/json");

    String payload = "{\"accel_x\":" + String(ax, 4) +
                      ",\"accel_y\":" + String(ay, 4) +
                      ",\"accel_z\":" + String(az, 4) + "}";

    int statusCode = http.POST(payload);
    Serial.print("POST -> ");
    Serial.println(statusCode);
    http.end();
  } else {
    Serial.println("WiFi disconnected — skipping this sample");
  }

  delay(SEND_INTERVAL_MS);
}
