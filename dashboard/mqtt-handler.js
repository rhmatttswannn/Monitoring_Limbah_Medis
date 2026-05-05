// ========== Configuration ==========
const LEVEL_EMPTY_CM = 39;   // Jarak sensor saat tangki kosong
const LEVEL_FULL_CM = 22;    // Jarak sensor saat tangki penuh
const MQTT_HOST = "broker.hivemq.com";
const MQTT_PORT = 8884; // WebSocket SSL port for HiveMQ
const MQTT_TOPIC = "limbah/data";
const CLIENT_ID = "web_client_" + Math.random().toString(16).substr(2, 8);

// DOM Elements
let phValEl, phStatusEl, tempValEl, tempProgEl, levelValEl, levelProgEl, tankPctEl, tankCmEl, statusDot, statusText;
let chart; 
let lastSeen = 0; // Timestamp pesan terakhir
let watchdogTimer; // Timer untuk cek status aktif

function initDOMElements() {
  phValEl      = document.getElementById('ph-value');
  phStatusEl   = document.getElementById('ph-status');
  tempValEl    = document.getElementById('temp-value');
  tempProgEl   = document.getElementById('temp-progress');
  levelValEl   = document.getElementById('level-value');
  levelProgEl  = document.getElementById('level-progress');
  tankPctEl    = document.getElementById('tank-percent');
  tankCmEl     = document.getElementById('tank-cm');
  statusDot    = document.querySelector('.status-pulse');
  statusText   = statusDot ? statusDot.nextElementSibling : null;
  
  initChart();
}

function initChart() {
  const options = {
    series: [{ name: 'Ketinggian (cm)', data: [] }],
    chart: {
      type: 'area',
      height: 180,
      toolbar: { show: false },
      animations: { enabled: true, easing: 'linear', dynamicAnimation: { speed: 1000 } }
    },
    colors: ['#10b77f'],
    fill: {
      type: 'gradient',
      gradient: { shadeIntensity: 1, opacityFrom: 0.4, opacityTo: 0.05, stops: [0, 90, 100] }
    },
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: 3 },
    xaxis: {
      type: 'datetime',
      labels: { show: false },
      axisBorder: { show: false },
      axisTicks: { show: false }
    },
    yaxis: { labels: { style: { colors: '#64748b' } }, min: 0, max: 100 }, // Sekarang dalam persen
    grid: { borderColor: 'rgba(255,255,255,0.05)', strokeDashArray: 4 }
  };

  chart = new ApexCharts(document.querySelector("#chart-timeline"), options);
  chart.render();

  // Load existing history into chart
  const history = JSON.parse(localStorage.getItem('waste_history') || '[]');
  if (history.length > 0) {
    const chartData = history.slice().reverse().map(item => {
      const dist = parseFloat(item.jarak);
      // Inverted logic: (Empty - Current) / (Empty - Full)
      const pct = Math.min(100, Math.max(0, ((LEVEL_EMPTY_CM - dist) / (LEVEL_EMPTY_CM - LEVEL_FULL_CM)) * 100));
      return { x: item.timestamp, y: parseFloat(pct.toFixed(1)) };
    });
    chart.updateSeries([{ data: chartData }]);
  }
}

// ========== MQTT Client Setup ==========
const client = new Paho.MQTT.Client(MQTT_HOST, MQTT_PORT, CLIENT_ID);

client.onConnectionLost = onConnectionLost;
client.onMessageArrived = onMessageArrived;

function connectMQTT() {
  console.log("Connecting to MQTT...");
  client.connect({
    onSuccess: onConnect,
    onFailure: onConnectFailure,
    useSSL: true, // Diaktifkan agar bisa jalan di Vercel (HTTPS)
    keepAliveInterval: 30
  });
}

function onConnect() {
  console.log("Connected to MQTT Broker");
  client.subscribe(MQTT_TOPIC);
  
  // Update UI Status
  if (statusDot) {
    statusDot.classList.replace('bg-slate-500', 'bg-amber-500');
    statusDot.classList.replace('bg-red-500', 'bg-amber-500');
    statusText.textContent = "Menunggu Data..."; 
    statusText.classList.replace('text-slate-500', 'text-amber-500');
    statusText.classList.replace('text-red-500', 'text-amber-500');
    
    // Mulai cek detak jantung (watchdog) setiap 2 detik
    startWatchdog();
  }
}

function startWatchdog() {
  if (watchdogTimer) clearInterval(watchdogTimer);
  const startTime = Date.now();
  
  watchdogTimer = setInterval(() => {
    const now = Date.now();
    
    // Jika BELUM PERNAH ada data sejak awal (cek timeout dari waktu koneksi)
    if (lastSeen === 0) {
      if (now - startTime > 15000) { // Beri waktu 15 detik untuk data pertama
        updateStatusOffline();
      }
      return;
    }

    // Jika SUDAH PERNAH ada data tapi berhenti (lebih dari 10 detik)
    if (now - lastSeen > 10000) {
      updateStatusOffline();
    }
  }, 2000);
}

function updateStatusOffline() {
  if (statusDot && statusText.textContent !== "ESP32 Offline") {
    statusDot.className = "status-pulse w-2 h-2 rounded-full bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.6)]";
    statusText.textContent = "ESP32 Offline";
    statusText.className = "text-[10px] font-black tracking-[0.3em] uppercase text-red-500";
  }
}

function onConnectFailure(err) {
  console.log("Connect failed:", err);
  setTimeout(connectMQTT, 5000);
  
  if (statusDot) {
    statusDot.classList.replace('bg-primary', 'bg-red-500');
    statusText.textContent = "Koneksi Terputus";
    statusText.classList.replace('text-primary', 'text-red-500');
  }
}

function onConnectionLost(responseObject) {
  if (responseObject.errorCode !== 0) {
    console.log("Connection lost:", responseObject.errorMessage);
    connectMQTT();
  }
}

function onMessageArrived(message) {
  try {
    const data = JSON.parse(message.payloadString);
    console.log("Received data:", data);
    
    // Update timestamp pesan terakhir
    lastSeen = Date.now();
    
    // Kembalikan status ke Aktif jika sebelumnya offline atau baru konek
    if (statusDot && statusText.textContent !== "Sistem Aktif") {
      statusDot.className = "status-pulse w-2 h-2 rounded-full bg-primary shadow-[0_0_8px_rgba(16,183,127,0.6)]";
      statusText.textContent = "Sistem Aktif";
      statusText.className = "text-[10px] font-black tracking-[0.3em] uppercase text-primary";
    }

    updateUI(data);
  } catch (e) {
    console.error("Error parsing payload:", e);
  }
}

function getPHStatus(ph) {
  if (ph < 6.5) return { label: 'ASAM', color: 'text-red-400' };
  if (ph > 8.5) return { label: 'BASA', color: 'text-red-400' };
  return { label: 'NORMAL', color: 'text-primary' };
}

function updateUI(data) {
  if (!phValEl) return; // Ensure elements are ready

  // pH
  const ph = parseFloat(data.ph);
  const phStatus = getPHStatus(ph);
  phValEl.textContent = ph.toFixed(1);
  phStatusEl.textContent = phStatus.label;
  phStatusEl.className = `text-[9px] font-bold uppercase tracking-widest mt-0.5 ${phStatus.color}`;

  // Temperature
  const temp = parseFloat(data.suhu);
  tempValEl.textContent = temp.toFixed(1);
  const tempPct = Math.min(100, Math.max(0, ((temp - 20) / 30) * 100));
  tempProgEl.style.width = tempPct + '%';

  // Level / Distance Calculation
  const distance = parseFloat(data.jarak);
  
  // Inverted mapping: Semakin kecil jarak, semakin penuh
  // Rumus: (BatasKosong - JarakSekarang) / (BatasKosong - BatasPenuh) * 100
  const levelPct = Math.min(100, Math.max(0, ((LEVEL_EMPTY_CM - distance) / (LEVEL_EMPTY_CM - LEVEL_FULL_CM)) * 100));
  
  // Water level display (cm ketinggian air dari dasar/titik kosong)
  const displayLevelCm = Math.max(0, LEVEL_EMPTY_CM - distance);
  
  levelValEl.textContent = displayLevelCm.toFixed(1);
  levelProgEl.style.width = levelPct + '%';

  // Big Tank Card
  tankPctEl.textContent = Math.round(levelPct);
  tankCmEl.textContent = displayLevelCm.toFixed(1);

  // Update Chart (dalam persen)
  if (chart) {
    const newDataPoint = { x: Date.now(), y: parseFloat(levelPct.toFixed(1)) };
    const currentData = chart.w.config.series[0].data;
    currentData.push(newDataPoint);
    if (currentData.length > 20) currentData.shift();
    chart.updateSeries([{ data: currentData }]);
  }

  saveToHistory(data);
}

function saveToHistory(data) {
  let history = JSON.parse(localStorage.getItem('waste_history') || '[]');
  const newEntry = {
    time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
    ...data,
    timestamp: Date.now()
  };
  
  history.unshift(newEntry);
  if (history.length > 20) history.pop();
  localStorage.setItem('waste_history', JSON.stringify(history));
}

function logout() {
  const modal = document.getElementById('logout-modal');
  if (modal) {
    modal.classList.remove('hidden');
    modal.classList.add('flex');
  }
}

function closeLogoutModal() {
  const modal = document.getElementById('logout-modal');
  if (modal) {
    modal.classList.add('hidden');
    modal.classList.remove('flex');
  }
}

function confirmLogout() {
  sessionStorage.removeItem('isLoggedIn');
  window.location.href = '../Login/login.html';
}

// Initial connection when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  initDOMElements();
  connectMQTT();
});
