// Voice generator. Text is spoken by Kokoro, an open 82M-parameter text-to-speech model
// that runs entirely in the browser (Transformers.js, WASM) inside a worker so the
// visuals never stall. Its audio is played into the studio's mix, so viewers hear it and
// the visuals react to it. The Mac's built-in voices are offered as a no-download
// fallback, but the browser plays those straight to the speakers: only you hear them.
window.KOKORO_VOICES = [
  ["af_heart", "Heart · US female"], ["af_bella", "Bella · US female"], ["af_nicole", "Nicole · US female, soft"],
  ["af_sarah", "Sarah · US female"], ["af_sky", "Sky · US female"], ["am_michael", "Michael · US male"],
  ["am_fenrir", "Fenrir · US male"], ["am_puck", "Puck · US male"], ["bf_emma", "Emma · UK female"],
  ["bf_isabella", "Isabella · UK female"], ["bm_george", "George · UK male"], ["bm_fable", "Fable · UK male"],
  ["bm_lewis", "Lewis · UK male"],
];

window.createVoice = function () {
  const KOKORO = "https://cdn.jsdelivr.net/npm/kokoro-js@1.2.1/dist/kokoro.web.js";
  const MODEL = "onnx-community/Kokoro-82M-v1.0-ONNX";

  const state = { status: "idle", progress: 0, speaking: false, caption: "", error: "" };
  let worker = null, readyPromise = null, nextId = 0;
  const pending = new Map();

  // ---- Kokoro in a module worker ----
  function startWorker() {
    const code = `
      import { KokoroTTS } from "${KOKORO}";
      let tts = null;
      self.onmessage = async ({ data }) => {
        try {
          if (data.type === "load") {
            tts = await KokoroTTS.from_pretrained("${MODEL}", {
              dtype: "q8", device: "wasm",
              progress_callback: p => {
                if (p.status === "progress" && /\\.onnx$/.test(p.file || "")) self.postMessage({ type: "progress", progress: p.progress });
              },
            });
            self.postMessage({ type: "ready" });
          } else if (data.type === "generate") {
            const a = await tts.generate(data.text, { voice: data.voice, speed: data.speed });
            self.postMessage({ type: "audio", id: data.id, audio: a.audio, rate: a.sampling_rate }, [a.audio.buffer]);
          }
        } catch (e) {
          self.postMessage({ type: "error", id: data.id, message: String((e && e.message) || e) });
        }
      };`;
    worker = new Worker(URL.createObjectURL(new Blob([code], { type: "text/javascript" })), { type: "module" });
    worker.onmessage = ({ data }) => {
      if (data.type === "progress") state.progress = data.progress;
      if (data.type === "audio" || (data.type === "error" && data.id != null)) {
        const cb = pending.get(data.id);
        pending.delete(data.id);
        if (cb) data.type === "audio" ? cb.resolve(data) : cb.reject(new Error(data.message));
      }
    };
  }

  function load() {
    if (!readyPromise) {
      state.status = "loading";
      startWorker();
      readyPromise = new Promise((resolve, reject) => {
        const onMsg = ({ data }) => {
          if (data.type === "ready") { worker.removeEventListener("message", onMsg); state.status = "ready"; resolve(); }
          if (data.type === "error" && data.id == null) {
            worker.removeEventListener("message", onMsg);
            state.status = "failed"; state.error = data.message; readyPromise = null; reject(new Error(data.message));
          }
        };
        worker.addEventListener("message", onMsg);
        worker.postMessage({ type: "load" });
      });
    }
    return readyPromise;
  }

  function generate(text, voice, speed) {
    const id = nextId++;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      worker.postMessage({ type: "generate", id, text, voice, speed });
    });
  }

  // ---- Voice effects chain, inside the radio's AudioContext ----
  let chain = null;
  function getChain(radio) {
    if (chain && chain.ctx === radio.ctx) return chain;
    const ctx = radio.ctx;
    chain = { ctx, input: ctx.createGain(), output: ctx.createGain(), style: null, extra: [] };
    chain.output.connect(radio.voiceIn);
    return chain;
  }

  function distortion(k) {
    const n = 1024, curve = new Float32Array(n);
    for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x)); }
    return curve;
  }
  function impulse(ctx, seconds) {
    const len = Math.floor(ctx.sampleRate * seconds), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
    }
    return buf;
  }

  function setEffect(c, style) {
    if (c.style === style) return;
    c.input.disconnect();
    c.extra.forEach(n => { try { n.stop && n.stop(); } catch {} n.disconnect(); });
    c.extra = [];
    const ctx = c.ctx;
    if (style === "echo") {
      const d = ctx.createDelay(1), fb = ctx.createGain(), wet = ctx.createGain();
      d.delayTime.value = 0.28; fb.gain.value = 0.4; wet.gain.value = 0.55;
      c.input.connect(c.output);
      c.input.connect(d); d.connect(fb); fb.connect(d); d.connect(wet); wet.connect(c.output);
      c.extra = [d, fb, wet];
    } else if (style === "hall") {
      const conv = ctx.createConvolver(), wet = ctx.createGain();
      conv.buffer = impulse(ctx, 2.8); wet.gain.value = 0.6;
      c.input.connect(c.output);
      c.input.connect(conv); conv.connect(wet); wet.connect(c.output);
      c.extra = [conv, wet];
    } else if (style === "radio") {
      const hp = ctx.createBiquadFilter(), lp = ctx.createBiquadFilter(), sh = ctx.createWaveShaper();
      hp.type = "highpass"; hp.frequency.value = 450; lp.type = "lowpass"; lp.frequency.value = 2800;
      sh.curve = distortion(25);
      c.input.connect(hp); hp.connect(lp); lp.connect(sh); sh.connect(c.output);
      c.extra = [hp, lp, sh];
    } else if (style === "robot") {
      // Ring modulation: multiply the voice by a low sine wave.
      const ring = ctx.createGain(), osc = ctx.createOscillator();
      ring.gain.value = 0; osc.frequency.value = 55; osc.connect(ring.gain); osc.start();
      c.input.connect(ring); ring.connect(c.output);
      c.extra = [ring, osc];
    } else {
      c.input.connect(c.output);
    }
    c.style = style;
  }

  // ---- Speaking ----
  let job = 0;
  const sources = new Set();
  const timers = [];
  const sleep = ms => new Promise(r => setTimeout(r, ms));

  function sentences(text) {
    return (String(text).replace(/\s+/g, " ").trim().match(/[^.!?…]+[.!?…]*["')\]]*\s*/g) || [])
      .map(s => s.trim()).filter(Boolean);
  }

  function stop(radio) {
    job++;
    sources.forEach(s => { try { s.stop(); } catch {} });
    sources.clear();
    timers.splice(0).forEach(clearTimeout);
    if (window.speechSynthesis) speechSynthesis.cancel();
    state.speaking = false;
    state.caption = "";
    if (radio) radio.duck(0);
  }

  async function speakKokoro(parts, o, radio, my) {
    if (!radio) { state.error = "Start the studio first, so the voice can play into the stream."; return; }
    try { await load(); } catch { return; }
    if (my !== job) return;
    const c = getChain(radio), ctx = c.ctx;
    setEffect(c, o.effect);
    c.output.gain.value = o.volume;
    state.speaking = true;
    radio.duck(o.duck);

    let at = ctx.currentTime + 0.05;
    // Each sentence is generated while the previous one plays.
    for (const text of parts) {
      let a;
      try { a = await generate(text, o.voice, o.speed / o.pitch); } catch (e) { state.error = e.message; break; }
      if (my !== job) return;
      const buf = ctx.createBuffer(1, a.audio.length, a.rate);
      buf.copyToChannel(a.audio, 0);
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = o.pitch;
      src.connect(c.input);
      at = Math.max(at, ctx.currentTime + 0.02);
      src.start(at);
      sources.add(src);
      src.onended = () => sources.delete(src);
      timers.push(setTimeout(() => { if (my === job) state.caption = text; }, (at - ctx.currentTime) * 1000));
      at += buf.duration / o.pitch + 0.15;
    }
    await sleep(Math.max(0, (at - ctx.currentTime) * 1000));
    if (my !== job) return;
    state.speaking = false;
    state.caption = "";
    radio.duck(0);
  }

  function speakSystem(parts, o, my) {
    if (!window.speechSynthesis) { state.error = "This browser has no system voices."; return; }
    const voice = speechSynthesis.getVoices().find(v => v.voiceURI === o.systemVoice);
    state.speaking = true;
    parts.forEach((text, i) => {
      const u = new SpeechSynthesisUtterance(text);
      if (voice) u.voice = voice;
      u.rate = o.speed;
      u.onstart = () => { if (my === job) state.caption = text; };
      if (i === parts.length - 1) u.onend = u.onerror = () => { if (my === job) { state.speaking = false; state.caption = ""; } };
      speechSynthesis.speak(u);
    });
  }

  async function speak(text, o, radio) {
    stop(radio);
    const my = job;
    state.error = "";
    const parts = sentences(text);
    if (!parts.length) { state.error = "Type something to say first."; return; }
    if (o.engine === "system") speakSystem(parts, o, my);
    else await speakKokoro(parts, o, radio, my);
  }

  return { state, load, speak, stop };
};
