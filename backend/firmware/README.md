# ESP32 + MPU6050 hardware setup

Two ways to feed real IMU data into BlackBox AI. Both land in the exact
same live-session pipeline (analytics -> rules -> statistics -> narration)
— pick whichever is easier for your demo.

## Wiring (I2C, default ESP32 pins)

```
ESP32 3V3 -> MPU6050 VCC
ESP32 GND -> MPU6050 GND
ESP32 G21 -> MPU6050 SDA
ESP32 G22 -> MPU6050 SCL
```

## Option A — WiFi / HTTP (recommended — no cable, no COM port)

The backend must be reachable from your ESP32 over the network, and the
ESP32 needs to be on the **same WiFi network** as the machine running it.

1. Start (or restart) the backend bound to all interfaces, not just
   localhost:
   ```
   uvicorn main:app --host 0.0.0.0 --port 8000
   ```
2. Find your computer's LAN IP address (not `127.0.0.1` / `localhost` —
   those mean "this device itself" to the ESP32, not your machine):
   - Windows: `ipconfig`, look for "IPv4 Address" under your Wi-Fi adapter
   - macOS/Linux: `ifconfig` or `ip addr`, look for the Wi-Fi interface
3. **Windows Firewall**: the first time something binds to `0.0.0.0`,
   Windows may prompt to allow it — allow it for Private networks. If it
   doesn't prompt and the ESP32 can't connect, add a rule yourself:
   ```
   New-NetFirewallRule -DisplayName "BlackBox AI" -Direction Inbound -LocalPort 8000 -Protocol TCP -Action Allow
   ```
   (run in an elevated PowerShell — this isn't something the assistant
   will do on your behalf, since it's a security-relevant setting.)
4. Set `VITE_API_BASE_URL` in `frontend/.env` to `http://<your-lan-ip>:8000`
   and restart the frontend dev server (env vars are only read at startup,
   not hot-reloaded).
5. Open the web app, click **"GO LIVE — ESP32 IMU"**. It shows a line like:
   ```
   POST http://192.168.0.100:8000/live/a1b2c3d4e5f6/ingest
   ```
   Copy that exact URL.
6. Open `blackbox_wifi.ino`, paste that URL into `INGEST_URL`, fill in
   your WiFi `WIFI_SSID`/`WIFI_PASSWORD`, and flash it (requires the
   Adafruit MPU6050 + Adafruit Unified Sensor libraries via the Arduino
   Library Manager).
7. Power on the ESP32. The same browser tab that showed you the URL in
   step 5 is already polling that exact session — data appears there
   automatically, no page reload needed.

### Using a phone hotspot instead of home WiFi

Works fine — the ESP32 just needs to join whatever network your laptop is
on, home router or phone hotspot, it doesn't matter which.

1. Turn on your phone's hotspot and note its SSID/password (shown in the
   hotspot settings screen — see below for exactly where).
2. Put that SSID/password into `WIFI_SSID`/`WIFI_PASSWORD` in the `.ino`
   file, same as you would for home WiFi.
3. Your laptop gets a **different IP address** once it joins the hotspot
   (typically `172.20.10.x` on iPhone, `192.168.43.x` or `192.168.x.x` on
   Android) — re-run `ipconfig` *while connected to the hotspot* and use
   that new IP for `VITE_API_BASE_URL` and `INGEST_URL`, not whatever IP
   you used on home WiFi.
4. **Watch out for AP/client isolation.** Some phones block hotspot
   clients from talking to each other directly (only allowing internet
   access, not device-to-device). If the ESP32's Serial Monitor shows
   "Connected. ESP32 IP: ..." successfully but every POST times out or
   fails, this is the likely cause. Android: look for an "AP isolation" /
   "client isolation" toggle in the hotspot's advanced settings and turn
   it off. iPhone Personal Hotspot has no public toggle for this — if
   it's blocked, switch to a home router or use Option B (USB serial)
   below instead.

## Option B — USB serial (no WiFi needed)

1. Flash `blackbox_mpu6050.ino` (same library requirements as above).
2. Plug the ESP32 into the same machine running the backend.
3. Find its COM port (Device Manager on Windows, `ls /dev/tty.*` on
   macOS/Linux) and start the backend with that port set:
   ```
   SERIAL_PORT=COM3 uvicorn main:app --reload
   ```
4. The backend auto-creates a live session named `esp32-serial` (override
   with `SERIAL_SESSION_ID`) and starts ingesting immediately.
5. In the web app, use the **"Or join an existing session ID"** field
   below the Go Live button and enter `esp32-serial` (or your custom
   `SERIAL_SESSION_ID`) — this connects the UI to the already-running
   session instead of starting a new empty one.

## Note on units

Both paths expect acceleration in **g** (level ≈ 1.0), not raw m/s².
Both `.ino` files divide by 9.80665 before sending — if you write your own
firmware, do the same, since the collision/flip/spoofing thresholds in
`utils/config.py` are all tuned in g.
