# CanSat Ground Control Software (GCS)

A professional single-page CanSat/CubeSat-style Ground Control Software dashboard built with HTML, CSS, and JavaScript.
Quick OverView Using this Link :   https://cansatgroundcontrolsoftware.netlify.app/

## Included Features

- Single-page aerospace operator dashboard
- Top control bar with:
  - Connect Serial
  - Start Telemetry
  - Stop Telemetry
  - Export CSV
  - Export Graph
  - Sync PC Time
  - Reset Packet
- Mission Control Panel:
  - Manual Separation
  - Emergency Parachute Deployment
  - Redundant Activation
  - Dynamic command execution status
- Container telemetry display
- Payload telemetry display
- 4-digit mission error code system:
  - Digit 1: Descent rate fault, safe range is 8–10 m/s
  - Digit 2: GPS unavailable
  - Digit 3: Payload separation failure after separation command timeout
  - Digit 4: Emergency parachute activated
- Real-time graphs:
  - Altitude
  - Pressure
  - Temperature
  - Descent rate
  - Battery voltage
- Live GPS map and trajectory path using Leaflet + OpenStreetMap
- 3D orientation visualization using Three.js
- Live video stream using browser camera APIs
- Telemetry logging and browser storage
- CSV export and graph PNG export
- Manual telemetry packet injection for testing
- Arduino dummy telemetry transmitter sketch

## How to Run

### Recommended method

Open a terminal in this folder and run:

```bash
python -m http.server 8000
```

Then open:

```text
http://localhost:8000
```

Use Chrome or Edge for Web Serial and camera features.

### Quick simulator mode

1. Open the dashboard.
2. Click **Start Telemetry**.
3. The built-in telemetry simulator will start immediately.
4. Graphs, map, orientation, error code, and telemetry values will update automatically.

### Serial/microcontroller mode

1. Upload `arduino_dummy_telemetry.ino` to your Arduino or compatible board.
2. Keep baud rate at **9600**.
3. Open the dashboard through `localhost`.
4. Click **Connect Serial**.
5. Choose the board port.
6. Click **Start Telemetry**.

## Telemetry Packet Format

The dashboard accepts CSV, JSON, or key=value telemetry packets.

Default CSV order:

```text
packet,pcTime,missionTime,mode,containerAltitude,payloadAltitude,pressure,temperature,descentRate,battery,lat,lon,gpsFix,satellites,roll,pitch,yaw,separated,parachute,accelX,accelY,accelZ
```

Example CSV packet:

```text
1,2026-07-10T12:00:01Z,00:01,DESCENT,611.2,611.2,949.9,24.1,8.8,8.39,25.594135,85.137646,1,9,4.0,17.8,6,0,0,0.015,0.059,0.990
```

Example key=value packet:

```text
packet=1,missionTime=00:01,mode=DESCENT,containerAltitude=611.2,payloadAltitude=611.2,pressure=949.9,temperature=24.1,descentRate=8.8,battery=8.39,lat=25.594135,lon=85.137646,gpsFix=1,satellites=9,roll=4,pitch=18,yaw=6,separated=0,parachute=0
```

Example JSON packet:

```json
{"packet":1,"missionTime":"00:01","mode":"DESCENT","containerAltitude":611.2,"payloadAltitude":611.2,"pressure":949.9,"temperature":24.1,"descentRate":8.8,"battery":8.39,"lat":25.594135,"lon":85.137646,"gpsFix":true,"satellites":9,"roll":4,"pitch":18,"yaw":6,"separated":false,"parachute":false}
```

## Files

- `index.html` - dashboard structure
- `styles.css` - professional responsive UI styling
- `app.js` - telemetry logic, charts, map, serial, video, exports
- `arduino_dummy_telemetry.ino` - test microcontroller sketch
- `sample_telemetry.csv` - sample telemetry data

## Notes

- Chart.js, Leaflet, and Three.js are loaded from CDN, so the graph/map/3D features need internet access.
- Web Serial requires Chrome/Edge and localhost or HTTPS.
- Camera streaming requires browser permission.
