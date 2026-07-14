'use strict';

const $ = (id) => document.getElementById(id);

const FIELD_ORDER = [
  'packet', 'pcTime', 'missionTime', 'mode',
  'containerAltitude', 'payloadAltitude', 'pressure', 'temperature',
  'descentRate', 'battery', 'lat', 'lon', 'gpsFix', 'satellites',
  'roll', 'pitch', 'yaw', 'separated', 'parachute',
  'accelX', 'accelY', 'accelZ'
];

const TELEMETRY_SCHEMA = {
  container: [
    ['containerAltitude', 'Container Altitude', 'm'],
    ['pressure', 'Pressure', 'hPa'],
    ['temperature', 'Temperature', '°C'],
    ['descentRate', 'Descent Rate', 'm/s'],
    ['battery', 'Battery Voltage', 'V'],
    ['mode', 'Mission Mode', '']
  ],
  payload: [
    ['payloadAltitude', 'Payload Altitude', 'm'],
    ['lat', 'Latitude', '°'],
    ['lon', 'Longitude', '°'],
    ['gpsFix', 'GPS Fix', ''],
    ['satellites', 'Satellites', ''],
    ['separated', 'Payload Separated', ''],
    ['parachute', 'Emergency Parachute', ''],
    ['accelX', 'Accel X', 'g'],
    ['accelY', 'Accel Y', 'g'],
    ['accelZ', 'Accel Z', 'g']
  ]
};

const MAX_GRAPH_POINTS = 70;
const STORAGE_KEY = 'cansat_gcs_telemetry_log_v1';
const INITIAL_POSITION = [25.5941, 85.1376];

const state = {
  telemetryRunning: false,
  usingSerial: false,
  simTimer: null,
  clockTimer: null,
  telemetryLog: [],
  charts: {},
  map: null,
  marker: null,
  pathLine: null,
  gpsPath: [],
  serial: {
    port: null,
    reader: null,
    writer: null,
    readLoopActive: false,
    buffer: ''
  },
  videoStream: null,
  three: {
    scene: null,
    camera: null,
    renderer: null,
    model: null,
    animationId: null
  },
  packetCounter: 0,
  missionStartEpoch: Date.now(),
  commandHistory: [],
  separationCommandedAt: null,
  simFlags: {
    separated: false,
    parachute: false,
    redundant: false
  },
  lastTelemetry: null
};

function init() {
  buildTelemetryTables();
  setupClock();
  setupCharts();
  setupMap();
  setupOrientationModel();
  setupVideoDevices();
  setupEvents();
  loadStoredTelemetry();
  logEvent('SYSTEM', 'GCS loaded. Click Start Telemetry for simulator or Connect Serial for microcontroller data.');
  updateStatusPill($('telemetryStatus'), 'Idle', 'warn');
  updateStatusPill($('serialStatus'), 'Serial: Not connected', 'warn');
  updateStatusPill($('videoStatusTop'), 'Video: Off', 'warn');
}

function setupClock() {
  const render = () => {
    const now = new Date();
    $('pcTime').textContent = now.toLocaleTimeString();
    $('missionDate').textContent = now.toLocaleDateString(undefined, {
      weekday: 'short', year: 'numeric', month: 'short', day: 'numeric'
    });
  };
  render();
  state.clockTimer = setInterval(render, 1000);
}

function buildTelemetryTables() {
  buildTable('containerTelemetry', TELEMETRY_SCHEMA.container);
  buildTable('payloadTelemetry', TELEMETRY_SCHEMA.payload);
}

function buildTable(containerId, fields) {
  const container = $(containerId);
  container.innerHTML = '';
  fields.forEach(([key, label, unit]) => {
    const row = document.createElement('div');
    row.className = 'telemetry-row';
    row.innerHTML = `<span>${label}</span><strong id="tele_${key}" data-unit="${unit}">--</strong>`;
    container.appendChild(row);
  });
}

function setupEvents() {
  $('connectSerialBtn').addEventListener('click', connectSerial);
  $('startBtn').addEventListener('click', startTelemetry);
  $('stopBtn').addEventListener('click', stopTelemetry);
  $('exportCsvBtn').addEventListener('click', exportCsv);
  $('exportGraphBtn').addEventListener('click', exportGraphs);
  $('syncTimeBtn').addEventListener('click', syncPcTime);
  $('resetPacketBtn').addEventListener('click', resetPacket);
  $('manualSepBtn').addEventListener('click', () => executeCommand('MANUAL_SEPARATION'));
  $('parachuteBtn').addEventListener('click', () => executeCommand('EMERGENCY_PARACHUTE'));
  $('redundantBtn').addEventListener('click', () => executeCommand('REDUNDANT_ACTIVATION'));
  $('injectPacketBtn').addEventListener('click', injectPacket);
  $('startVideoBtn').addEventListener('click', startVideo);
  $('stopVideoBtn').addEventListener('click', stopVideo);
  $('clearLogBtn').addEventListener('click', () => {
    $('logWindow').innerHTML = '';
    logEvent('SYSTEM', 'On-screen log cleared. Telemetry storage is unchanged.');
  });

  window.addEventListener('beforeunload', () => {
    if (state.videoStream) stopVideo();
    closeSerial();
  });
}

function setupCharts() {
  if (!window.Chart) {
    logEvent('ERROR', 'Chart.js not loaded. Check internet connection or CDN access.', 'error');
    return;
  }

  Chart.defaults.color = '#9fb4c9';
  Chart.defaults.borderColor = 'rgba(130, 180, 255, 0.18)';
  Chart.defaults.font.family = getComputedStyle(document.documentElement).getPropertyValue('--font');

  state.charts.altitude = createLineChart('altitudeChart', 'Altitude (m)', ['Container', 'Payload'], ['containerAltitude', 'payloadAltitude']);
  state.charts.pressure = createLineChart('pressureChart', 'Pressure (hPa)', ['Pressure'], ['pressure']);
  state.charts.temperature = createLineChart('temperatureChart', 'Temperature (°C)', ['Temperature'], ['temperature']);
  state.charts.descent = createLineChart('descentChart', 'Descent Rate (m/s)', ['Descent Rate'], ['descentRate']);
  state.charts.battery = createLineChart('batteryChart', 'Battery Voltage (V)', ['Battery'], ['battery']);
}

function createLineChart(canvasId, title, labels, keys) {
  const ctx = $(canvasId).getContext('2d');
  const palette = ['#35c7ff', '#7af0c4', '#ffcf66', '#ff5b6e', '#b9a1ff'];
  return new Chart(ctx, {
    type: 'line',
    data: {
      labels: [],
      datasets: labels.map((label, index) => ({
        label,
        data: [],
        borderColor: palette[index % palette.length],
        backgroundColor: `${palette[index % palette.length]}22`,
        borderWidth: 2,
        pointRadius: 0,
        tension: 0.32,
        fill: false,
        metaKey: keys[index]
      }))
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      animation: false,
      plugins: {
        legend: { labels: { boxWidth: 10, usePointStyle: true } },
        title: { display: true, text: title, color: '#eef7ff', align: 'start' }
      },
      scales: {
        x: { ticks: { maxRotation: 0, autoSkip: true, maxTicksLimit: 5 } },
        y: { beginAtZero: false }
      }
    }
  });
}

function setupMap() {
  if (!window.L) {
    $('map').innerHTML = '<p style="padding:16px;color:#9fb4c9">Leaflet.js not loaded. Check internet connection or CDN access.</p>';
    return;
  }

  state.map = L.map('map', {
    zoomControl: true,
    attributionControl: true
  }).setView(INITIAL_POSITION, 15);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; OpenStreetMap contributors'
  }).addTo(state.map);

  state.marker = L.marker(INITIAL_POSITION).addTo(state.map).bindPopup('Payload current location');
  state.pathLine = L.polyline([], { color: '#35c7ff', weight: 4, opacity: 0.78 }).addTo(state.map);
}

function setupOrientationModel() {
  const holder = $('orientationScene');
  if (!window.THREE) {
    holder.innerHTML = '<p style="padding:16px;color:#9fb4c9">Three.js not loaded. Check internet connection or CDN access.</p>';
    return;
  }

  const width = holder.clientWidth || 420;
  const height = holder.clientHeight || 270;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
  camera.position.set(3.6, 2.8, 5.5);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(width, height);
  holder.innerHTML = '';
  holder.appendChild(renderer.domElement);

  const ambient = new THREE.AmbientLight(0xffffff, 0.72);
  const directional = new THREE.DirectionalLight(0x8cdfff, 1.2);
  directional.position.set(4, 5, 6);
  scene.add(ambient, directional);

  const body = new THREE.Group();
  const geometry = new THREE.BoxGeometry(1.55, 1.55, 2.25);
  const material = new THREE.MeshStandardMaterial({ color: 0x35c7ff, metalness: 0.28, roughness: 0.38 });
  const cube = new THREE.Mesh(geometry, material);
  body.add(cube);

  const noseGeometry = new THREE.ConeGeometry(0.78, 0.85, 4);
  const noseMaterial = new THREE.MeshStandardMaterial({ color: 0x7af0c4, metalness: 0.18, roughness: 0.42 });
  const nose = new THREE.Mesh(noseGeometry, noseMaterial);
  nose.rotation.x = Math.PI / 2;
  nose.position.z = 1.55;
  body.add(nose);

  const axisMaterialX = new THREE.LineBasicMaterial({ color: 0xff5b6e });
  const axisMaterialY = new THREE.LineBasicMaterial({ color: 0x7af0c4 });
  const axisMaterialZ = new THREE.LineBasicMaterial({ color: 0x35c7ff });
  body.add(makeAxisLine([-1.9, 0, 0], [1.9, 0, 0], axisMaterialX));
  body.add(makeAxisLine([0, -1.9, 0], [0, 1.9, 0], axisMaterialY));
  body.add(makeAxisLine([0, 0, -2.3], [0, 0, 2.3], axisMaterialZ));

  scene.add(body);

  state.three = { scene, camera, renderer, model: body, animationId: null };

  const animate = () => {
    state.three.animationId = requestAnimationFrame(animate);
    renderer.render(scene, camera);
  };
  animate();

  window.addEventListener('resize', () => {
    const newWidth = holder.clientWidth || width;
    const newHeight = holder.clientHeight || height;
    camera.aspect = newWidth / newHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(newWidth, newHeight);
  });
}

function makeAxisLine(from, to, material) {
  const points = [new THREE.Vector3(...from), new THREE.Vector3(...to)];
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  return new THREE.Line(geometry, material);
}

async function setupVideoDevices() {
  const select = $('cameraSelect');
  select.innerHTML = '<option value="">Default camera</option>';

  if (!navigator.mediaDevices?.enumerateDevices) {
    select.innerHTML = '<option>Camera API not available</option>';
    return;
  }

  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    devices
      .filter((device) => device.kind === 'videoinput')
      .forEach((device, index) => {
        const option = document.createElement('option');
        option.value = device.deviceId;
        option.textContent = device.label || `Camera ${index + 1}`;
        select.appendChild(option);
      });
  } catch (error) {
    logEvent('WARN', `Unable to list cameras: ${error.message}`, 'warn');
  }
}

async function connectSerial() {
  if (!('serial' in navigator)) {
    logEvent('ERROR', 'Web Serial API is not supported. Use Chrome/Edge on localhost or HTTPS.', 'error');
    updateStatusPill($('serialStatus'), 'Serial: Unsupported', 'danger');
    return;
  }

  try {
    if (state.serial.port) {
      await closeSerial();
      return;
    }

    const port = await navigator.serial.requestPort();
    await port.open({ baudRate: 9600 });
    state.serial.port = port;
    state.usingSerial = true;
    $('connectSerialBtn').textContent = 'Disconnect Serial';
    updateStatusPill($('serialStatus'), 'Serial: Connected', 'ok');
    logEvent('SERIAL', 'Serial port connected at 9600 baud. Click Start Telemetry to read data.');
  } catch (error) {
    logEvent('ERROR', `Serial connection failed: ${error.message}`, 'error');
    updateStatusPill($('serialStatus'), 'Serial: Connection failed', 'danger');
  }
}

async function closeSerial() {
  try {
    state.serial.readLoopActive = false;
    if (state.serial.reader) {
      try { await state.serial.reader.cancel(); } catch (_) {}
      state.serial.reader.releaseLock();
      state.serial.reader = null;
    }
    if (state.serial.writer) {
      try { await state.serial.writer.close(); } catch (_) {}
      state.serial.writer = null;
    }
    if (state.serial.port) {
      await state.serial.port.close();
      state.serial.port = null;
    }
    state.usingSerial = false;
    $('connectSerialBtn').textContent = 'Connect Serial';
    updateStatusPill($('serialStatus'), 'Serial: Not connected', 'warn');
    logEvent('SERIAL', 'Serial port disconnected.');
  } catch (error) {
    logEvent('ERROR', `Error while closing serial port: ${error.message}`, 'error');
  }
}

function startTelemetry() {
  if (state.telemetryRunning) return;

  state.telemetryRunning = true;
  $('startBtn').disabled = true;
  $('stopBtn').disabled = false;
  updateStatusPill($('telemetryStatus'), 'Telemetry: Running', 'ok');

  if (state.serial.port) {
    state.usingSerial = true;
    startSerialReadLoop();
    sendSerialLine('START_TELEMETRY');
    logEvent('SYSTEM', 'Started telemetry reception from serial device.');
  } else {
    state.usingSerial = false;
    state.simTimer = setInterval(() => updateTelemetry(generateDummyTelemetry()), 1000);
    updateTelemetry(generateDummyTelemetry());
    logEvent('SYSTEM', 'Started built-in telemetry simulator. Connect serial to use real microcontroller data.');
  }
}

async function startSerialReadLoop() {
  if (!state.serial.port || state.serial.readLoopActive) return;

  state.serial.readLoopActive = true;
  const decoder = new TextDecoder();

  try {
    state.serial.reader = state.serial.port.readable.getReader();
    while (state.telemetryRunning && state.serial.readLoopActive) {
      const { value, done } = await state.serial.reader.read();
      if (done) break;
      if (!value) continue;

      state.serial.buffer += decoder.decode(value, { stream: true });
      const lines = state.serial.buffer.split(/\r?\n/);
      state.serial.buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const packet = parseTelemetry(trimmed);
        if (packet) updateTelemetry(packet, trimmed);
      }
    }
  } catch (error) {
    if (state.telemetryRunning) {
      logEvent('ERROR', `Serial read error: ${error.message}`, 'error');
      updateStatusPill($('serialStatus'), 'Serial: Read error', 'danger');
    }
  } finally {
    if (state.serial.reader) {
      try { state.serial.reader.releaseLock(); } catch (_) {}
      state.serial.reader = null;
    }
    state.serial.readLoopActive = false;
  }
}

function stopTelemetry() {
  state.telemetryRunning = false;
  $('startBtn').disabled = false;
  $('stopBtn').disabled = true;
  updateStatusPill($('telemetryStatus'), 'Telemetry: Stopped', 'warn');

  if (state.simTimer) {
    clearInterval(state.simTimer);
    state.simTimer = null;
  }

  if (state.serial.port) {
    sendSerialLine('STOP_TELEMETRY');
  }

  logEvent('SYSTEM', 'Telemetry stopped.');
}

function parseTelemetry(raw) {
  try {
    if (raw.trim().startsWith('{')) {
      return normalizeTelemetry(JSON.parse(raw));
    }

    if (raw.includes('=') && raw.includes(',')) {
      return normalizeTelemetry(parseKeyValuePacket(raw));
    }

    return normalizeTelemetry(parseCsvPacket(raw));
  } catch (error) {
    logEvent('ERROR', `Unable to parse packet: ${error.message}`, 'error');
    return null;
  }
}

function parseKeyValuePacket(raw) {
  return raw.split(',').reduce((acc, pair) => {
    const [rawKey, ...rest] = pair.split('=');
    if (!rawKey || rest.length === 0) return acc;
    acc[rawKey.trim()] = rest.join('=').trim();
    return acc;
  }, {});
}

function parseCsvPacket(raw) {
  const values = splitCsv(raw);

  if (values.length < 8) {
    throw new Error('CSV packet has too few fields');
  }

  return FIELD_ORDER.reduce((acc, field, index) => {
    acc[field] = values[index];
    return acc;
  }, {});
}

function splitCsv(line) {
  const result = [];
  let current = '';
  let insideQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    if (char === '"') {
      insideQuotes = !insideQuotes;
      continue;
    }
    if (char === ',' && !insideQuotes) {
      result.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim());
  return result;
}

function normalizeTelemetry(raw) {
  const toNumber = (value, fallback = 0) => {
    if (value === undefined || value === null || value === '') return fallback;
    const number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  };

  const toBoolean = (value) => {
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return value === 1;
    const text = String(value ?? '').trim().toLowerCase();
    return ['1', 'true', 'yes', 'available', 'ok', 'active', 'separated'].includes(text);
  };

  state.packetCounter = toNumber(raw.packet, state.packetCounter + 1);

  return {
    packet: state.packetCounter,
    pcTime: raw.pcTime || new Date().toISOString(),
    missionTime: raw.missionTime || formatDuration(Math.floor((Date.now() - state.missionStartEpoch) / 1000)),
    mode: String(raw.mode || inferMode(toNumber(raw.containerAltitude, 0))).toUpperCase(),
    containerAltitude: toNumber(raw.containerAltitude),
    payloadAltitude: toNumber(raw.payloadAltitude, toNumber(raw.containerAltitude)),
    pressure: toNumber(raw.pressure, 1013.25),
    temperature: toNumber(raw.temperature, 25),
    descentRate: toNumber(raw.descentRate),
    battery: toNumber(raw.battery, 7.4),
    lat: toNumber(raw.lat, INITIAL_POSITION[0]),
    lon: toNumber(raw.lon, INITIAL_POSITION[1]),
    gpsFix: toBoolean(raw.gpsFix ?? raw.gps ?? true),
    satellites: toNumber(raw.satellites ?? raw.sats, 7),
    roll: toNumber(raw.roll),
    pitch: toNumber(raw.pitch),
    yaw: toNumber(raw.yaw),
    separated: toBoolean(raw.separated),
    parachute: toBoolean(raw.parachute),
    accelX: toNumber(raw.accelX),
    accelY: toNumber(raw.accelY),
    accelZ: toNumber(raw.accelZ, 1),
    receivedAt: new Date().toISOString()
  };
}

function inferMode(altitude) {
  if (altitude > 450) return 'DESCENT';
  if (altitude > 60) return 'PAYLOAD';
  if (altitude > 5) return 'LANDING';
  return 'LANDED';
}

function generateDummyTelemetry() {
  const seconds = Math.floor((Date.now() - state.missionStartEpoch) / 1000);
  const packet = state.packetCounter + 1;
  const descentRate = 8.7 + Math.sin(packet / 9) * 0.55;
  const containerAltitude = Math.max(0, 620 - seconds * descentRate);
  const separated = state.simFlags.separated || containerAltitude < 360;
  const payloadAltitude = separated ? Math.max(0, containerAltitude - 8 - Math.sin(packet / 5) * 4) : containerAltitude;
  const pressure = 949 + (620 - containerAltitude) * 0.105 + Math.sin(packet / 7) * 0.7;
  const temperature = 27 - (containerAltitude / 1000) * 5 + Math.sin(packet / 6) * 0.4;
  const battery = Math.max(6.25, 8.4 - seconds * 0.0017);
  const lat = INITIAL_POSITION[0] + packet * 0.000035;
  const lon = INITIAL_POSITION[1] + packet * 0.000046;
  const gpsFix = packet % 53 !== 0;

  return normalizeTelemetry({
    packet,
    pcTime: new Date().toISOString(),
    missionTime: formatDuration(seconds),
    mode: inferMode(containerAltitude),
    containerAltitude,
    payloadAltitude,
    pressure,
    temperature,
    descentRate,
    battery,
    lat,
    lon,
    gpsFix,
    satellites: gpsFix ? 8 + (packet % 4) : 0,
    roll: Math.sin(packet / 7) * 28,
    pitch: Math.cos(packet / 8) * 18,
    yaw: (packet * 6) % 360,
    separated,
    parachute: state.simFlags.parachute,
    accelX: Math.sin(packet / 4) * 0.06,
    accelY: Math.cos(packet / 5) * 0.06,
    accelZ: 0.98 + Math.sin(packet / 3) * 0.03
  });
}

function updateTelemetry(data, rawPacket = '') {
  state.lastTelemetry = data;
  state.telemetryLog.push(data);
  if (state.telemetryLog.length > 2000) state.telemetryLog.shift();
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.telemetryLog.slice(-500)));

  updateMissionSummary(data);
  updateTelemetryReadouts(data);
  updateErrorCode(data);
  updateCharts(data);
  updateMap(data);
  updateOrientation(data);

  if (rawPacket) {
    logEvent('PACKET', `#${data.packet}: ${rawPacket.slice(0, 180)}${rawPacket.length > 180 ? '...' : ''}`);
  } else if (data.packet % 5 === 0) {
    logEvent('PACKET', `#${data.packet}: ALT=${formatNumber(data.containerAltitude)}m, GPS=${data.gpsFix ? 'OK' : 'NO FIX'}, ERR=${$('errorCode').textContent}`);
  }
}

function updateMissionSummary(data) {
  $('packetNumber').textContent = data.packet;
  $('missionTime').textContent = data.missionTime;
  $('missionMode').textContent = data.mode;
  $('batteryVoltage').textContent = `${formatNumber(data.battery, 2)} V`;

  let remark = 'Nominal';
  if (data.battery < 6.6) remark = 'Critical battery';
  else if (data.battery < 7.0) remark = 'Low battery warning';
  $('batteryRemark').textContent = remark;
}

function updateTelemetryReadouts(data) {
  const renderValue = (key, value) => {
    const element = $(`tele_${key}`);
    if (!element) return;
    const unit = element.dataset.unit || '';
    if (typeof value === 'boolean') element.textContent = value ? 'YES' : 'NO';
    else if (typeof value === 'number') element.textContent = `${formatNumber(value)}${unit ? ` ${unit}` : ''}`;
    else element.textContent = value || '--';
  };

  [...TELEMETRY_SCHEMA.container, ...TELEMETRY_SCHEMA.payload].forEach(([key]) => renderValue(key, data[key]));

  $('rollValue').textContent = `${formatNumber(data.roll, 1)}°`;
  $('pitchValue').textContent = `${formatNumber(data.pitch, 1)}°`;
  $('yawValue').textContent = `${formatNumber(data.yaw, 1)}°`;
}

function updateErrorCode(data) {
  const descentFault = data.descentRate < 8 || data.descentRate > 10;
  const gpsFault = !data.gpsFix || !Number.isFinite(data.lat) || !Number.isFinite(data.lon) || data.satellites <= 0;
  const separationFault = state.separationCommandedAt && !data.separated && (Date.now() - state.separationCommandedAt > 3000);
  const parachuteFault = data.parachute === true;

  const digits = [descentFault, gpsFault, separationFault, parachuteFault].map(Boolean).map((fault) => fault ? '1' : '0');
  const code = digits.join('');

  const errorElement = $('errorCode');
  errorElement.textContent = code;
  errorElement.classList.toggle('fault', code !== '0000');

  setFaultState('descent', descentFault);
  setFaultState('gps', gpsFault);
  setFaultState('separation', separationFault);
  setFaultState('parachute', parachuteFault);

  if (code !== '0000') {
    updateStatusPill($('telemetryStatus'), `Telemetry: Fault ${code}`, 'danger');
  } else if (state.telemetryRunning) {
    updateStatusPill($('telemetryStatus'), 'Telemetry: Running', 'ok');
  }
}

function setFaultState(name, isFault) {
  const element = document.querySelector(`[data-fault="${name}"]`);
  if (element) element.classList.toggle('fault', Boolean(isFault));
}

function updateCharts(data) {
  if (!window.Chart) return;

  const label = data.missionTime || String(data.packet);
  Object.values(state.charts).forEach((chart) => {
    if (!chart) return;
    chart.data.labels.push(label);
    chart.data.datasets.forEach((dataset) => {
      dataset.data.push(data[dataset.metaKey]);
      if (dataset.data.length > MAX_GRAPH_POINTS) dataset.data.shift();
    });
    if (chart.data.labels.length > MAX_GRAPH_POINTS) chart.data.labels.shift();
    chart.update('none');
  });

  $('graphPointCount').textContent = `${Math.min(state.telemetryLog.length, MAX_GRAPH_POINTS)} points`;
}

function updateMap(data) {
  if (!state.map || !state.marker || !data.gpsFix) {
    $('gpsBadge').textContent = data.gpsFix ? 'GPS: Waiting' : 'GPS: No Fix';
    return;
  }

  const position = [data.lat, data.lon];
  state.gpsPath.push(position);
  if (state.gpsPath.length > 500) state.gpsPath.shift();

  state.marker.setLatLng(position).setPopupContent(
    `Packet #${data.packet}<br>Lat: ${formatNumber(data.lat, 6)}<br>Lon: ${formatNumber(data.lon, 6)}`
  );
  state.pathLine.setLatLngs(state.gpsPath);

  if (state.gpsPath.length < 3 || data.packet % 8 === 0) {
    state.map.setView(position, state.map.getZoom(), { animate: true });
  }

  $('gpsBadge').textContent = `GPS: ${formatNumber(data.lat, 5)}, ${formatNumber(data.lon, 5)}`;
}

function updateOrientation(data) {
  if (!state.three.model) return;
  const deg = Math.PI / 180;
  state.three.model.rotation.x = data.pitch * deg;
  state.three.model.rotation.y = data.yaw * deg;
  state.three.model.rotation.z = data.roll * deg;
}

async function executeCommand(command) {
  const commandLabels = {
    MANUAL_SEPARATION: 'Manual separation command sent',
    EMERGENCY_PARACHUTE: 'Emergency parachute deployment command sent',
    REDUNDANT_ACTIVATION: 'Redundant activation command sent'
  };

  const now = new Date();
  const status = `${commandLabels[command]} at ${now.toLocaleTimeString()}`;
  $('commandStatus').textContent = status;
  state.commandHistory.push({ command, time: now.toISOString() });

  if (command === 'MANUAL_SEPARATION') {
    state.separationCommandedAt = Date.now();
    setTimeout(() => {
      state.simFlags.separated = true;
      if (state.lastTelemetry && !state.lastTelemetry.separated) {
        state.lastTelemetry.separated = true;
        updateTelemetryReadouts(state.lastTelemetry);
        updateErrorCode(state.lastTelemetry);
      }
    }, 1500);
  }

  if (command === 'EMERGENCY_PARACHUTE') {
    state.simFlags.parachute = true;
  }

  if (command === 'REDUNDANT_ACTIVATION') {
    state.simFlags.redundant = true;
  }

  await sendSerialLine(command);
  logEvent('COMMAND', status);
}

async function sendSerialLine(line) {
  if (!state.serial.port?.writable) return false;

  try {
    const encoder = new TextEncoder();
    state.serial.writer = state.serial.port.writable.getWriter();
    await state.serial.writer.write(encoder.encode(`${line}\n`));
    state.serial.writer.releaseLock();
    state.serial.writer = null;
    return true;
  } catch (error) {
    logEvent('ERROR', `Failed to send serial command: ${error.message}`, 'error');
    return false;
  }
}

function injectPacket() {
  const input = $('packetInput');
  const raw = input.value.trim();
  if (!raw) {
    logEvent('WARN', 'Paste a telemetry packet before injecting.', 'warn');
    return;
  }

  const packet = parseTelemetry(raw);
  if (packet) {
    updateTelemetry(packet, raw);
    input.value = '';
    logEvent('SYSTEM', 'Manual telemetry packet injected successfully.');
  }
}

function syncPcTime() {
  state.missionStartEpoch = Date.now();
  sendSerialLine(`SYNC_TIME,${new Date().toISOString()}`);
  logEvent('SYSTEM', 'PC time synchronized with mission clock.');
}

function resetPacket() {
  state.packetCounter = 0;
  state.missionStartEpoch = Date.now();
  state.telemetryLog = [];
  state.gpsPath = [];
  state.separationCommandedAt = null;
  state.simFlags = { separated: false, parachute: false, redundant: false };
  localStorage.removeItem(STORAGE_KEY);

  if (state.pathLine) state.pathLine.setLatLngs([]);
  if (state.marker) state.marker.setLatLng(INITIAL_POSITION);

  Object.values(state.charts).forEach((chart) => {
    if (!chart) return;
    chart.data.labels = [];
    chart.data.datasets.forEach((dataset) => { dataset.data = []; });
    chart.update('none');
  });

  $('packetNumber').textContent = '0';
  $('missionTime').textContent = '00:00';
  $('graphPointCount').textContent = '0 points';
  $('gpsBadge').textContent = 'GPS: Waiting';
  $('errorCode').textContent = '0000';
  $('errorCode').classList.remove('fault');
  document.querySelectorAll('.fault-item').forEach((item) => item.classList.remove('fault'));
  sendSerialLine('RESET_PACKET');
  logEvent('SYSTEM', 'Packet counter, graphs, trajectory, and telemetry storage reset.');
}

function exportCsv() {
  if (!state.telemetryLog.length) {
    logEvent('WARN', 'No telemetry available for CSV export.', 'warn');
    return;
  }

  const headers = [
    'packet', 'pcTime', 'missionTime', 'mode', 'containerAltitude', 'payloadAltitude',
    'pressure', 'temperature', 'descentRate', 'battery', 'lat', 'lon', 'gpsFix', 'satellites',
    'roll', 'pitch', 'yaw', 'separated', 'parachute', 'accelX', 'accelY', 'accelZ', 'receivedAt'
  ];

  const rows = [headers.join(',')].concat(
    state.telemetryLog.map((packet) => headers.map((key) => csvEscape(packet[key])).join(','))
  );

  downloadBlob(rows.join('\n'), `cansat_telemetry_${timestampForFile()}.csv`, 'text/csv;charset=utf-8');
  logEvent('EXPORT', 'Telemetry CSV exported.');
}

function exportGraphs() {
  const chartEntries = Object.entries(state.charts).filter(([, chart]) => chart);
  if (!chartEntries.length) {
    logEvent('WARN', 'No graph is available for export.', 'warn');
    return;
  }

  const width = 1200;
  const sectionHeight = 360;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = sectionHeight * chartEntries.length;
  const ctx = canvas.getContext('2d');

  ctx.fillStyle = '#06111f';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = '#eef7ff';
  ctx.font = '24px Arial';

  chartEntries.forEach(([name, chart], index) => {
    const y = index * sectionHeight;
    ctx.fillText(name.toUpperCase(), 32, y + 38);
    ctx.drawImage(chart.canvas, 30, y + 56, width - 60, sectionHeight - 82);
  });

  canvas.toBlob((blob) => {
    if (!blob) {
      logEvent('ERROR', 'Graph export failed.', 'error');
      return;
    }
    downloadBlob(blob, `cansat_graphs_${timestampForFile()}.png`, 'image/png');
    logEvent('EXPORT', 'Graph PNG exported.');
  }, 'image/png');
}

function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function downloadBlob(content, fileName, type) {
  const blob = content instanceof Blob ? content : new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}

async function startVideo() {
  if (!navigator.mediaDevices?.getUserMedia) {
    $('videoStatus').textContent = 'Camera API is not available in this browser.';
    updateStatusPill($('videoStatusTop'), 'Video: Unsupported', 'danger');
    return;
  }

  try {
    if (state.videoStream) stopVideo();
    const selectedDevice = $('cameraSelect').value;
    const constraints = {
      video: selectedDevice ? { deviceId: { exact: selectedDevice } } : { facingMode: 'environment' },
      audio: false
    };

    state.videoStream = await navigator.mediaDevices.getUserMedia(constraints);
    $('videoStream').srcObject = state.videoStream;
    $('startVideoBtn').disabled = true;
    $('stopVideoBtn').disabled = false;
    $('videoStatus').textContent = 'Camera stream is live.';
    updateStatusPill($('videoStatusTop'), 'Video: Live', 'ok');
    await setupVideoDevices();
    logEvent('VIDEO', 'Camera stream started.');
  } catch (error) {
    $('videoStatus').textContent = `Camera error: ${error.message}`;
    updateStatusPill($('videoStatusTop'), 'Video: Error', 'danger');
    logEvent('ERROR', `Camera start failed: ${error.message}`, 'error');
  }
}

function stopVideo() {
  if (state.videoStream) {
    state.videoStream.getTracks().forEach((track) => track.stop());
    state.videoStream = null;
  }
  $('videoStream').srcObject = null;
  $('startVideoBtn').disabled = false;
  $('stopVideoBtn').disabled = true;
  $('videoStatus').textContent = 'Camera stream is off.';
  updateStatusPill($('videoStatusTop'), 'Video: Off', 'warn');
  logEvent('VIDEO', 'Camera stream stopped.');
}

function loadStoredTelemetry() {
  try {
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]');
    if (!Array.isArray(stored) || stored.length === 0) return;
    state.telemetryLog = stored;
    const latest = stored[stored.length - 1];
    state.packetCounter = Number(latest.packet) || 0;
    updateMissionSummary(latest);
    updateTelemetryReadouts(latest);
    updateErrorCode(latest);
    stored.slice(-MAX_GRAPH_POINTS).forEach((packet) => {
      updateCharts(packet);
      if (packet.gpsFix) updateMap(packet);
    });
    updateOrientation(latest);
    logEvent('SYSTEM', `Restored ${stored.length} recent telemetry packets from browser storage.`);
  } catch (error) {
    logEvent('WARN', `Stored telemetry could not be restored: ${error.message}`, 'warn');
  }
}

function logEvent(type, message, level = 'info') {
  const windowElement = $('logWindow');
  if (!windowElement) return;
  const time = new Date().toLocaleTimeString();
  const entry = document.createElement('div');
  entry.className = `log-entry ${level}`;
  entry.innerHTML = `<b>[${time}] ${type}</b> ${escapeHtml(message)}`;
  windowElement.prepend(entry);

  while (windowElement.children.length > 250) {
    windowElement.lastElementChild.remove();
  }
}

function updateStatusPill(element, text, mode) {
  element.textContent = text;
  const dot = document.createElement('i');
  element.prepend(dot);
  element.classList.remove('ok', 'warn', 'danger');
  element.classList.add(mode);
}

function formatNumber(value, decimals = 2) {
  if (!Number.isFinite(Number(value))) return '--';
  const number = Number(value);
  if (Math.abs(number) >= 100) return number.toFixed(1);
  return number.toFixed(decimals);
}

function formatDuration(totalSeconds) {
  const safeSeconds = Math.max(0, Number(totalSeconds) || 0);
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const seconds = Math.floor(safeSeconds % 60);
  const mmss = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  return hours > 0 ? `${String(hours).padStart(2, '0')}:${mmss}` : mmss;
}

function timestampForFile() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

document.addEventListener('DOMContentLoaded', init);
