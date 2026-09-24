// Studio: settings panel, presets, the render loop, and broadcasting to viewers.

// ---- Settings ----
// [section, id, label, type, default, extra]. The panel is built from this list.
const range = (min = 0, max = 1, step = 0.01) => ({ min, max, step });
const PARAMS = [
  ["Station", "channel", "Channel", "select", 1, { options: [[1, "NTS 1"], [2, "NTS 2"]] }],
  ["Station", "monitor", "Monitor volume", "range", 0.8, range()],
  ["Station", "sensitivity", "Sensitivity", "range", 1, range(0.3, 2.5, 0.05)],

  ["Camera", "camera", "Camera on", "toggle", true],
  ["Camera", "mirror", "Mirror", "toggle", false],
  ["Camera", "mode", "Colour", "select", "normal", { options: [["normal", "Normal"], ["mono", "Mono"], ["duotone", "Duotone"], ["invert", "Invert"], ["thermal", "Thermal"]] }],
  ["Camera", "duoA", "Duotone dark", "color", "#1a0b3d", { when: p => p.mode === "duotone" }],
  ["Camera", "duoB", "Duotone light", "color", "#ff5ea8", { when: p => p.mode === "duotone" }],

  ["Effects", "zoom", "Zoom punch · beat", "range", 0.4, range()],
  ["Effects", "flash", "Flash · beat", "range", 0.15, range()],
  ["Effects", "rgb", "RGB split · mid", "range", 0.3, range()],
  ["Effects", "hue", "Hue shift · beat", "range", 0, range()],
  ["Effects", "pixelate", "Pixelate · treble", "range", 0, range()],
  ["Effects", "glitch", "Glitch · beat", "range", 0, range()],
  ["Effects", "kaleido", "Kaleidoscope · mid", "select", 0, { options: [[0, "Off"], [4, "4"], [6, "6"], [8, "8"], [12, "12"]] }],

  ["Visualiser", "vis", "Style", "select", "bars", { options: [["none", "None"], ["bars", "Bars"], ["mirror", "Mirrored bars"], ["columns", "Full-height bars"], ["wave", "Waveform"], ["circle", "Circle"]] }],
  ["Visualiser", "barCount", "Number of bars", "range", 32, { ...range(1, 96, 1), when: p => ["bars", "mirror", "columns", "circle"].includes(p.vis) }],
  ["Visualiser", "colMax", "Max thickness", "range", 0.8, { ...range(0.05, 1), when: p => p.vis === "columns" }],
  ["Visualiser", "colBass", "Thickness · bass", "range", 0, { ...range(), when: p => p.vis === "columns" }],
  ["Visualiser", "colMid", "Thickness · mid", "range", 0.7, { ...range(), when: p => p.vis === "columns" }],
  ["Visualiser", "colTreble", "Thickness · treble", "range", 0.7, { ...range(), when: p => p.vis === "columns" }],
  ["Visualiser", "visPos", "Position", "select", "bottom", { options: [["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]], when: p => !["none", "columns"].includes(p.vis) }],
  ["Visualiser", "visColor", "Colour", "color", "#ffffff"],
  ["Visualiser", "visScale", "Height", "range", 0.6, { ...range(0.1, 1.5), when: p => !["none", "columns"].includes(p.vis) }],
  ["Visualiser", "visOpacity", "Opacity", "range", 0.85, range()],

  ["Now playing", "np", "Show card", "toggle", true],
  ["Now playing", "npPos", "Corner", "select", "tl", { options: [["tl", "Top left"], ["tr", "Top right"], ["bl", "Bottom left"], ["br", "Bottom right"]] }],

  ["Text", "text", "Text", "text", ""],
  ["Text", "textSize", "Size", "range", 0.12, range(0.03, 0.4, 0.005)],
  ["Text", "textColor", "Colour", "color", "#ffffff"],
  ["Text", "textPos", "Position", "select", "middle", { options: [["top", "Top"], ["middle", "Middle"], ["bottom", "Bottom"]] }],
  ["Text", "textPulse", "Pulse · beat", "range", 0.3, range()],

  ["YouTube overlay", "ytUrl", "YouTube link", "text", ""],
  ["YouTube overlay", "ytOn", "Show video", "toggle", false],
  ["YouTube overlay", "ytLayout", "Layout", "select", "full", { options: [["full", "Full frame"], ["center", "Centre"], ["tl", "Top left"], ["tr", "Top right"], ["bl", "Bottom left"], ["br", "Bottom right"]] }],
  ["YouTube overlay", "ytSize", "Size", "range", 0.35, { ...range(0.15, 1), when: p => p.ytLayout !== "full" }],
  ["YouTube overlay", "ytOpacity", "Opacity", "range", 0.8, range()],
  ["YouTube overlay", "ytBlend", "Blend", "select", "normal", { options: [["normal", "Normal"], ["screen", "Screen"], ["lighten", "Lighten"], ["multiply", "Multiply"], ["darken", "Darken"], ["overlay", "Overlay"], ["difference", "Difference"]] }],

  ["Randomiser", "autoRandom", "Auto randomise", "select", 0, { options: [[0, "Off"], [8, "Every 8 beats"], [16, "Every 16 beats"], [32, "Every 32 beats"], [64, "Every 64 beats"]] }],
];

// Presets only touch the look; station, camera on/off and text content are left alone.
const PRESETS = {
  Clean: { mode: "normal", zoom: 0.2, flash: 0, rgb: 0, hue: 0, pixelate: 0, glitch: 0, kaleido: 0, vis: "bars", visPos: "bottom", visColor: "#ffffff", visOpacity: 0.7 },
  Pulse: { mode: "normal", zoom: 0.7, flash: 0.35, rgb: 0.4, hue: 0, pixelate: 0, glitch: 0, kaleido: 0, vis: "circle", visPos: "middle", visColor: "#ffffff", visOpacity: 0.9 },
  Acid: { mode: "duotone", duoA: "#0a1f00", duoB: "#c6ff00", zoom: 0.5, flash: 0.2, rgb: 0.6, hue: 0.6, pixelate: 0, glitch: 0.2, kaleido: 0, vis: "wave", visPos: "middle", visColor: "#c6ff00", visOpacity: 0.9 },
  Kaleido: { mode: "normal", zoom: 0.3, flash: 0.1, rgb: 0.3, hue: 0.4, pixelate: 0, glitch: 0, kaleido: 8, vis: "none" },
  Glitch: { mode: "normal", zoom: 0.4, flash: 0.2, rgb: 0.9, hue: 0, pixelate: 0.4, glitch: 0.8, kaleido: 0, vis: "mirror", visPos: "middle", visColor: "#ff3b30", visOpacity: 0.8 },
  Noir: { mode: "mono", zoom: 0.25, flash: 0.1, rgb: 0, hue: 0, pixelate: 0, glitch: 0, kaleido: 0, vis: "wave", visPos: "bottom", visColor: "#ffffff", visOpacity: 0.6 },
  Stripes: { mode: "mono", zoom: 0.3, flash: 0.15, rgb: 0.5, hue: 0, pixelate: 0, glitch: 0, kaleido: 0, vis: "columns", barCount: 12, colMax: 0.8, colBass: 0, colMid: 0.7, colTreble: 0.7, visColor: "#ffffff", visOpacity: 0.85 },
  Heat: { mode: "thermal", zoom: 0.5, flash: 0.2, rgb: 0.2, hue: 0, pixelate: 0.3, glitch: 0, kaleido: 0, vis: "bars", visPos: "bottom", visColor: "#ffe066", visOpacity: 0.85 },
};

// Randomiser: a fresh look from the same controls the presets use.
const pick = a => a[Math.floor(Math.random() * a.length)];
const rnd = (lo, hi) => Math.round((lo + Math.random() * (hi - lo)) * 100) / 100;
function hsl(h, s, l) {
  const f = n => {
    const k = (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)))).toString(16).padStart(2, "0");
  };
  return "#" + f(0) + f(8) + f(4);
}
function randomLook() {
  const hue = Math.random() * 360;
  return {
    mode: pick(["normal", "normal", "mono", "duotone", "duotone", "invert", "thermal"]),
    duoA: hsl(hue, 0.7, 0.08),
    duoB: hsl((hue + pick([30, 150, 180, 210])) % 360, 1, 0.6),
    zoom: rnd(0, 0.8), flash: rnd(0, 0.4), rgb: rnd(0, 0.9),
    hue: pick([0, 0, rnd(0.2, 0.8)]),
    pixelate: pick([0, 0, 0, rnd(0.2, 0.6)]),
    glitch: pick([0, 0, rnd(0.2, 0.8)]),
    kaleido: pick([0, 0, 0, 4, 6, 8, 12]),
    vis: pick(["bars", "mirror", "columns", "columns", "wave", "circle", "none"]),
    barCount: pick([4, 8, 12, 16, 24, 32, 48, 64]),
    colMax: rnd(0.4, 1), colBass: pick([0, 0, rnd(0, 0.6)]), colMid: rnd(0.3, 1), colTreble: rnd(0.3, 1),
    visPos: pick(["top", "middle", "bottom"]),
    visScale: rnd(0.4, 1.2),
    visColor: pick(["#ffffff", hsl(Math.random() * 360, 1, 0.6)]),
    visOpacity: rnd(0.5, 0.95),
  };
}

const STORE = "radio-settings";
const p = Object.fromEntries(PARAMS.map(([, id, , , def]) => [id, def]));
try { Object.assign(p, JSON.parse(localStorage.getItem(STORE) || "{}")); } catch {}
const save = () => { try { localStorage.setItem(STORE, JSON.stringify(p)); } catch {} };

// ---- Panel ----
const controls = document.getElementById("controls");
const inputs = {};
const rows = [];

function buildPanel() {
  let section = null, details = null;
  for (const [sec, id, label, type, def, extra = {}] of PARAMS) {
    if (sec !== section) {
      section = sec;
      details = document.createElement("details");
      details.open = ["Station", "Effects", "Visualiser"].includes(sec);
      details.innerHTML = `<summary>${sec}</summary>`;
      controls.append(details);
    }
    const row = document.createElement("label");
    row.className = "ctl" + (type === "text" ? " wide" : "");
    row.append(label);
    let input, readout;
    if (type === "range") {
      input = Object.assign(document.createElement("input"), { type: "range", min: extra.min, max: extra.max, step: extra.step });
      readout = document.createElement("span");
      const wrap = document.createElement("div");
      wrap.className = "val";
      wrap.append(input, readout);
      row.append(wrap);
    } else if (type === "select") {
      input = document.createElement("select");
      for (const [v, t] of extra.options) input.append(new Option(t, v));
      row.append(input);
    } else if (type === "toggle") {
      input = Object.assign(document.createElement("input"), { type: "checkbox" });
      row.append(input);
    } else {
      input = Object.assign(document.createElement("input"), { type, placeholder: type === "text" ? "Type something…" : "" });
      row.append(input);
    }
    input.addEventListener("input", () => {
      const v = type === "toggle" ? input.checked
        : type === "range" || typeof def === "number" ? Number(input.value)
        : input.value;
      set({ [id]: v });
    });
    inputs[id] = { input, readout, type };
    rows.push({ row, when: extra.when });
    details.append(row);
  }
}

function syncPanel() {
  for (const id in inputs) {
    const { input, readout, type } = inputs[id];
    if (type === "toggle") input.checked = !!p[id];
    else input.value = p[id];
    if (readout) readout.textContent = Number(p[id]).toFixed(2).replace(/\.?0+$/, "") || "0";
  }
  rows.forEach(r => { r.row.hidden = r.when ? !r.when(p) : false; });
}

function set(changes) {
  const prev = { ...p };
  Object.assign(p, changes);
  save();
  syncPanel();
  if (p.channel !== prev.channel) changeChannel();
  if (p.monitor !== prev.monitor && radio) radio.setMonitor(p.monitor);
  if (p.camera !== prev.camera && started) p.camera ? startCamera() : stopCamera();
  if (YT_KEYS.some(k => p[k] !== prev[k])) updateYouTube(p.ytUrl !== prev.ytUrl);
}

const presetsEl = document.getElementById("presets");
for (const name in PRESETS) {
  const b = Object.assign(document.createElement("button"), { className: "ghost", textContent: name });
  b.addEventListener("click", () => set(PRESETS[name]));
  presetsEl.append(b);
}
const randomBtn = Object.assign(document.createElement("button"), { textContent: "Randomise" });
randomBtn.addEventListener("click", () => set(randomLook()));
presetsEl.append(randomBtn);

buildPanel();
syncPanel();

// ---- YouTube overlay ----
const YT_KEYS = ["ytUrl", "ytOn", "ytLayout", "ytSize", "ytOpacity", "ytBlend"];
const yt = createYouTubeLayer(document.querySelector(".stage"));
const ytState = () => ({
  type: "yt", id: parseYouTube(p.ytUrl), on: p.ytOn, layout: p.ytLayout,
  size: p.ytSize, opacity: p.ytOpacity, blend: p.ytBlend, time: yt.time(),
});
function updateYouTube(linkChanged) {
  const id = parseYouTube(p.ytUrl);
  inputs.ytUrl.input.setCustomValidity(p.ytUrl && !id ? "Not a YouTube link" : "");
  // Pasting a new working link switches the overlay on.
  if (linkChanged && id && !p.ytOn) return set({ ytOn: true });
  const st = ytState();
  yt.apply(st, linkChanged ? 0 : undefined);
  sendYouTube();
}
function sendYouTube() {
  if (!conns.size) return;
  const st = ytState();
  conns.forEach(c => c.open && c.send(st));
}

// ---- Camera, radio, now playing ----
const cam = document.getElementById("cam");
const outCanvas = document.getElementById("out");
const placeholder = document.getElementById("placeholder");
const fx = createFx(outCanvas, cam);
let radio = null, started = false, camStream = null;
let shows = null, art = null, artUrl = null;

async function startCamera() {
  try {
    camStream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1280 }, height: { ideal: 720 } }, audio: false });
    cam.srcObject = camStream;
    await cam.play();
  } catch (e) {
    setStatus("Camera blocked: " + e.name);
  }
}
function stopCamera() {
  if (camStream) camStream.getTracks().forEach(t => t.stop());
  camStream = null;
  cam.srcObject = null;
}

const npEl = document.getElementById("np");
const time = s => s ? new Date(s).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "";

function renderNowPlaying() {
  const now = shows && shows[String(p.channel)] && shows[String(p.channel)].now;
  if (!now) { npEl.textContent = shows ? "No show info right now." : "Loading NTS schedule…"; return; }
  npEl.innerHTML = "";
  if (now.image) npEl.append(Object.assign(document.createElement("img"), { src: now.image, alt: "" }));
  const div = document.createElement("div");
  const b = document.createElement("b");
  b.textContent = now.title;
  const link = Object.assign(document.createElement("a"), { href: now.url, target: "_blank", rel: "noopener", textContent: "on nts.live" });
  div.append(b, `NTS ${p.channel} · ${time(now.start)}–${time(now.end)}${now.location ? " · " + now.location : ""} · `, link);
  npEl.append(div);

  if (now.image !== artUrl) {
    artUrl = now.image;
    art = null;
    if (artUrl) {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => { if (artUrl === now.image) art = img; };
      img.src = artUrl;
    }
  }
}

async function refreshShows() {
  try { shows = await NTS.live(); } catch (e) { console.warn(e); }
  renderNowPlaying();
  broadcastInfo();
}
refreshShows();
setInterval(refreshShows, 60000);

async function changeChannel() {
  renderNowPlaying();
  broadcastInfo();
  if (radio && started) {
    try { await radio.play(p.channel); } catch (e) { setStatus("Couldn't play NTS " + p.channel); }
  }
}

// ---- Render loop ----
// Ticks come from a worker so rendering (and the broadcast) keeps going in a background tab,
// where requestAnimationFrame would stop.
const QUIET = { bass: 0, mid: 0, treble: 0, beat: 0 };
const meters = ["Bass", "Mid", "Treble"].map(n => document.getElementById("m" + n));
const beatEl = document.getElementById("mBeat");

let silentSince = null;
let lastCount = 0, beatsSinceRandom = 0;
function frame() {
  const lv = radio && radio.playing ? radio.update(p.sensitivity) : QUIET;
  if (lv.count !== undefined && lv.count !== lastCount) {
    beatsSinceRandom += lv.count - lastCount;
    lastCount = lv.count;
    if (p.autoRandom && beatsSinceRandom >= p.autoRandom) { beatsSinceRandom = 0; set(randomLook()); }
  }
  if (radio && radio.playing) {
    const silent = radio.freq.every(v => v === 0);
    silentSince = silent ? silentSince || performance.now() : null;
    if (silentSince && performance.now() - silentSince > 4000 && !peer) {
      setStatus("No audio data – this browser may block analysing the stream; try Chrome");
    }
  }
  const now = shows && shows[String(p.channel)] && shows[String(p.channel)].now;
  fx.render(p, lv, radio && radio.playing ? radio : null, now, art, p.channel);
  if (!document.hidden) {
    meters[0].style.width = lv.bass * 100 + "%";
    meters[1].style.width = lv.mid * 100 + "%";
    meters[2].style.width = lv.treble * 100 + "%";
    beatEl.style.opacity = 0.15 + lv.beat * 0.85;
  }
}
const ticker = new Worker(URL.createObjectURL(new Blob(["setInterval(() => postMessage(0), 1000 / 30);"], { type: "text/javascript" })));
ticker.onmessage = frame;

// ---- Start / stop studio ----
const startBtn = document.getElementById("startBtn");
const liveBtn = document.getElementById("liveBtn");
const status = document.getElementById("status");
const statusText = document.getElementById("statusText");
function setStatus(text, live) { statusText.textContent = text; status.classList.toggle("live", !!live); }

startBtn.addEventListener("click", async () => {
  if (started) {
    stopLive();
    radio.stop();
    stopCamera();
    started = false;
    startBtn.textContent = "Start studio";
    liveBtn.disabled = true;
    placeholder.hidden = false;
    setStatus("Off air");
    return;
  }
  startBtn.disabled = true;
  if (!radio) {
    radio = createRadio();
    radio.onError(() => { if (started) setStatus("NTS stream interrupted"); });
  }
  radio.setMonitor(p.monitor);
  try {
    await radio.play(p.channel);
  } catch (e) {
    setStatus("Couldn't play NTS: " + e.name);
    startBtn.disabled = false;
    return;
  }
  if (p.camera) await startCamera();
  started = true;
  placeholder.hidden = true;
  startBtn.textContent = "Stop studio";
  startBtn.disabled = false;
  liveBtn.disabled = false;
  setStatus(radio.decoding ? "Studio on (not live) · decoded audio" : "Studio on (not live)");
});

// ---- Broadcasting ----
// Viewers open a data connection; we call them back with the rendered video + NTS audio.
const viewersEl = document.getElementById("viewers");
let peer = null, outStream = null;
const calls = new Map();
const conns = new Set();

// Ask for stereo, higher-bitrate Opus (the WebRTC default is tuned for speech).
const musicSdp = sdp => sdp.replace(/useinbandfec=1/g, "useinbandfec=1;stereo=1;sprop-stereo=1;maxaveragebitrate=256000");

function updateViewers() { viewersEl.textContent = calls.size + (calls.size === 1 ? " viewer" : " viewers"); }

function broadcastInfo() {
  conns.forEach(c => c.open && c.send({ type: "station", channel: p.channel }));
}

function goLive(slot = 0) {
  if (!outStream) {
    outStream = new MediaStream([
      ...outCanvas.captureStream(30).getVideoTracks(),
      ...radio.stream.getAudioTracks(),
    ]);
  }
  liveBtn.disabled = true;
  const me = peer = new Peer(STREAM_IDS[slot]);
  peer.on("open", () => {
    setStatus(slot ? `Live (backup slot ${slot + 1})` : "Live", true);
    liveBtn.textContent = "End live";
    liveBtn.classList.add("stop");
    liveBtn.disabled = false;
  });
  peer.on("connection", conn => {
    conn.on("open", () => {
      conns.add(conn);
      conn.send({ type: "station", channel: p.channel });
      conn.send(ytState());
      const call = me.call(conn.peer, outStream, { sdpTransform: musicSdp });
      calls.set(conn.peer, call);
      updateViewers();
      const drop = () => { calls.delete(conn.peer); updateViewers(); };
      call.on("close", drop);
      conn.on("close", () => { conns.delete(conn); call.close(); drop(); });
    });
  });
  peer.on("disconnected", () => { if (peer === me) me.reconnect(); });
  peer.on("error", err => {
    if (err.type === "unavailable-id") {
      // A stale studio still holds this ID; move on to the next one.
      me.destroy();
      if (slot + 1 < STREAM_IDS.length) return goLive(slot + 1);
      stopLive();
      setStatus("Every stream slot is taken – close other studio tabs and try again");
    } else if (err.type !== "peer-unavailable") {
      setStatus("Error: " + err.type);
    }
  });
}

function stopLive() {
  calls.forEach(c => c.close());
  calls.clear();
  conns.clear();
  updateViewers();
  if (peer) { peer.destroy(); peer = null; }
  if (outStream) { outStream.getVideoTracks().forEach(t => t.stop()); outStream = null; }
  liveBtn.textContent = "Go live";
  liveBtn.classList.remove("stop");
  liveBtn.disabled = !started;
  if (started) setStatus("Studio on (not live)");
}

liveBtn.addEventListener("click", () => (peer ? stopLive() : goLive()));
window.addEventListener("beforeunload", stopLive);

updateYouTube(false);
setInterval(sendYouTube, 2000); // keeps viewers' playback in step
