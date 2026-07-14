/*
  CanSat Dummy Telemetry Transmitter for Web Serial GCS
  Baud rate: 9600

  Packet format:
  packet,pcTime,missionTime,mode,containerAltitude,payloadAltitude,pressure,temperature,
  descentRate,battery,lat,lon,gpsFix,satellites,roll,pitch,yaw,separated,parachute,accelX,accelY,accelZ

  Upload this sketch to the microcontroller, then open index.html through localhost,
  click Connect Serial, choose the board, and click Start Telemetry.
*/

unsigned long lastPacketMs = 0;
unsigned long missionStartMs = 0;
long packetNumber = 0;
bool streaming = true;
bool separated = false;
bool parachute = false;
bool redundantActive = false;

const float startAltitude = 620.0;
const float startLat = 25.594100;
const float startLon = 85.137600;

void setup() {
  Serial.begin(9600);
  missionStartMs = millis();
  Serial.println("# CanSat dummy telemetry transmitter ready");
  Serial.println("# packet,pcTime,missionTime,mode,containerAltitude,payloadAltitude,pressure,temperature,descentRate,battery,lat,lon,gpsFix,satellites,roll,pitch,yaw,separated,parachute,accelX,accelY,accelZ");
}

void loop() {
  readCommands();

  if (streaming && millis() - lastPacketMs >= 1000) {
    lastPacketMs = millis();
    sendTelemetryPacket();
  }
}

void readCommands() {
  if (!Serial.available()) return;

  String command = Serial.readStringUntil('\n');
  command.trim();

  if (command == "START_TELEMETRY") {
    streaming = true;
    Serial.println("# ACK START_TELEMETRY");
  } else if (command == "STOP_TELEMETRY") {
    streaming = false;
    Serial.println("# ACK STOP_TELEMETRY");
  } else if (command == "RESET_PACKET") {
    packetNumber = 0;
    missionStartMs = millis();
    separated = false;
    parachute = false;
    redundantActive = false;
    Serial.println("# ACK RESET_PACKET");
  } else if (command.startsWith("SYNC_TIME")) {
    missionStartMs = millis();
    Serial.println("# ACK SYNC_TIME");
  } else if (command == "MANUAL_SEPARATION") {
    separated = true;
    Serial.println("# ACK MANUAL_SEPARATION");
  } else if (command == "EMERGENCY_PARACHUTE") {
    parachute = true;
    Serial.println("# ACK EMERGENCY_PARACHUTE");
  } else if (command == "REDUNDANT_ACTIVATION") {
    redundantActive = true;
    Serial.println("# ACK REDUNDANT_ACTIVATION");
  }
}

void sendTelemetryPacket() {
  packetNumber++;
  unsigned long seconds = (millis() - missionStartMs) / 1000;

  float descentRate = 8.7 + sin(packetNumber / 9.0) * 0.55;
  float containerAltitude = startAltitude - seconds * descentRate;
  if (containerAltitude < 0) containerAltitude = 0;

  if (containerAltitude < 360) separated = true;

  float payloadAltitude = separated ? containerAltitude - 8.0 - sin(packetNumber / 5.0) * 4.0 : containerAltitude;
  if (payloadAltitude < 0) payloadAltitude = 0;

  float pressure = 949.0 + (startAltitude - containerAltitude) * 0.105 + sin(packetNumber / 7.0) * 0.7;
  float temperature = 27.0 - (containerAltitude / 1000.0) * 5.0 + sin(packetNumber / 6.0) * 0.4;
  float battery = 8.4 - seconds * 0.0017;
  if (battery < 6.25) battery = 6.25;

  float lat = startLat + packetNumber * 0.000035;
  float lon = startLon + packetNumber * 0.000046;
  int gpsFix = (packetNumber % 53 == 0) ? 0 : 1;
  int satellites = gpsFix ? 8 + (packetNumber % 4) : 0;

  float roll = sin(packetNumber / 7.0) * 28.0;
  float pitch = cos(packetNumber / 8.0) * 18.0;
  float yaw = fmod(packetNumber * 6.0, 360.0);
  float accelX = sin(packetNumber / 4.0) * 0.06;
  float accelY = cos(packetNumber / 5.0) * 0.06;
  float accelZ = 0.98 + sin(packetNumber / 3.0) * 0.03;

  String mode = "DESCENT";
  if (containerAltitude < 360) mode = "PAYLOAD";
  if (containerAltitude < 60) mode = "LANDING";
  if (containerAltitude <= 1) mode = "LANDED";
  if (redundantActive && mode == "DESCENT") mode = "REDUNDANT";

  printValue(packetNumber); Serial.print(',');
  Serial.print("MCU"); Serial.print(',');
  printMissionTime(seconds); Serial.print(',');
  Serial.print(mode); Serial.print(',');
  printValue(containerAltitude); Serial.print(',');
  printValue(payloadAltitude); Serial.print(',');
  printValue(pressure); Serial.print(',');
  printValue(temperature); Serial.print(',');
  printValue(descentRate); Serial.print(',');
  printValue(battery); Serial.print(',');
  printValue(lat, 6); Serial.print(',');
  printValue(lon, 6); Serial.print(',');
  Serial.print(gpsFix); Serial.print(',');
  Serial.print(satellites); Serial.print(',');
  printValue(roll); Serial.print(',');
  printValue(pitch); Serial.print(',');
  printValue(yaw); Serial.print(',');
  Serial.print(separated ? 1 : 0); Serial.print(',');
  Serial.print(parachute ? 1 : 0); Serial.print(',');
  printValue(accelX, 3); Serial.print(',');
  printValue(accelY, 3); Serial.print(',');
  printValue(accelZ, 3);
  Serial.println();
}

void printMissionTime(unsigned long seconds) {
  unsigned long minutes = seconds / 60;
  unsigned long remainingSeconds = seconds % 60;
  if (minutes < 10) Serial.print('0');
  Serial.print(minutes);
  Serial.print(':');
  if (remainingSeconds < 10) Serial.print('0');
  Serial.print(remainingSeconds);
}

void printValue(float value, int digits = 2) {
  Serial.print(value, digits);
}

void printValue(long value) {
  Serial.print(value);
}
