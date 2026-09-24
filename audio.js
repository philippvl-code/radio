// Plays an NTS channel through Web Audio, measures it for the visuals, and exposes the
// audio as a MediaStream so it can be sent to viewers along with the video.
//
// Two ways in: Chrome and Firefox play the stream in an <audio> element and tap it with
// createMediaElementSource. Safari hands Web Audio only silence for a live cross-origin
// stream, so there we fetch the MP3 bytes ourselves, decode them with mpg123 (WASM, in a
// worker) and schedule the PCM as buffers. Add ?decode=1 to the URL to force that path.
const USE_DECODER = /[?&]decode=1/.test(location.search) ||
  /^((?!chrome|chromium|crios|fxios|android|edg).)*safari/i.test(navigator.userAgent);

window.createRadio = function () {
  const ctx = new AudioContext();
  const errorHandlers = [];
  const fail = e => errorHandlers.forEach(fn => fn(e));

  // Everything downstream listens to `input`, whichever way the audio arrives. The music
  // passes through its own gain first so it can be lowered ("ducked") under the voice,
  // which joins at `input` directly.
  const input = ctx.createGain();
  const music = ctx.createGain();
  music.connect(input);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.55;
  // Radio is mastered loud; the default -30 dB ceiling pins most bins at the maximum.
  analyser.minDecibels = -90;
  analyser.maxDecibels = -10;
  const monitor = ctx.createGain();
  const out = ctx.createMediaStreamDestination();

  // The broadcast always gets full volume; "monitor" only changes what you hear locally.
  input.connect(analyser);
  input.connect(out);
  input.connect(monitor).connect(ctx.destination);

  // ---- <audio> element path ----
  let el = null;
  function playElement(url) {
    if (!el) {
      el = new Audio();
      el.crossOrigin = "anonymous";
      ctx.createMediaElementSource(el).connect(music);
      el.addEventListener("error", fail);
      el.addEventListener("ended", fail); // a live stream only "ends" if the server hung up
    }
    el.src = url;
    return el.play();
  }
  function stopElement() {
    if (!el) return;
    el.pause();
    el.removeAttribute("src");
    el.load();
  }

  // ---- fetch + decode path ----
  let decoder = null, abort = null, playHead = 0;
  const active = new Set();

  function schedule(channelData, samples, sampleRate) {
    const buf = ctx.createBuffer(channelData.length, samples, sampleRate);
    channelData.forEach((d, i) => buf.copyToChannel(d.length === samples ? d : d.subarray(0, samples), i));
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.connect(music);
    const now = ctx.currentTime;
    // Start (or recover from a network hiccup) with a small cushion; cap latency at 4 s.
    if (playHead < now + 0.02 || playHead > now + 4) playHead = now + 0.4;
    src.start(playHead);
    playHead += buf.duration;
    active.add(src);
    src.onended = () => active.delete(src);
  }

  async function playDecoded(url) {
    stopDecoded();
    if (!decoder) {
      decoder = new window["mpg123-decoder"].MPEGDecoderWebWorker();
      await decoder.ready;
    } else {
      await decoder.reset();
    }
    const ctrl = abort = new AbortController();
    const res = await fetch(url, { signal: ctrl.signal, cache: "no-store" });
    if (!res.ok || !res.body) throw new Error("NTS stream " + res.status);
    const reader = res.body.getReader();
    (async () => {
      try {
        while (!ctrl.signal.aborted) {
          const { value, done } = await reader.read();
          if (done) throw new Error("NTS stream ended");
          const { channelData, samplesDecoded, sampleRate } = await decoder.decode(value);
          if (ctrl.signal.aborted) break;
          if (samplesDecoded) schedule(channelData, samplesDecoded, sampleRate);
        }
      } catch (e) {
        if (!ctrl.signal.aborted) fail(e);
      }
    })();
  }
  function stopDecoded() {
    if (abort) abort.abort();
    abort = null;
    active.forEach(s => { try { s.stop(); } catch {} });
    active.clear();
    playHead = 0;
  }
  out.stream.getAudioTracks().forEach(t => { t.contentHint = "music"; });

  const freq = new Uint8Array(analyser.frequencyBinCount);
  const wave = new Uint8Array(analyser.fftSize);
  const binHz = ctx.sampleRate / analyser.fftSize;

  const levels = { bass: 0, mid: 0, treble: 0, beat: 0, count: 0 };
  const peak = { bass: 0.5, mid: 0.5, treble: 0.5 };
  const floor = { bass: 0.3, mid: 0.3, treble: 0.3 };
  const bassHistory = [0, 0, 0, 0];
  let fluxAvg = 0.03, lastBeat = 0, lastT = performance.now();

  function band(lo, hi) {
    const a = Math.max(1, Math.floor(lo / binHz)), b = Math.min(freq.length - 1, Math.ceil(hi / binHz));
    let sum = 0;
    for (let i = a; i <= b; i++) sum += freq[i];
    return sum / (b - a + 1) / 255;
  }

  // Levels are 0..1, rescaled between a moving floor and peak per band, so each band uses
  // its full range whether the show is quiet or loud. `beat` jumps to 1 on a kick and decays. Kicks are found as a
  // sudden rise in bass over the last few frames (heavily compressed radio audio rarely
  // rises far above its average, but each kick is still a sharp step up).
  function update(sensitivity = 1) {
    const now = performance.now();
    const dt = Math.min(0.1, (now - lastT) / 1000);
    lastT = now;
    analyser.getByteFrequencyData(freq);
    analyser.getByteTimeDomainData(wave);

    const raw = { bass: band(30, 150), mid: band(150, 2000), treble: band(2000, 10000) };
    for (const k in raw) {
      const v = raw[k];
      // Peak jumps up and eases down over a few seconds; floor drops at once and creeps up.
      peak[k] = v > peak[k] ? v : peak[k] - (peak[k] - v) * Math.min(1, dt * 0.35);
      floor[k] = v < floor[k] ? v : floor[k] + (v - floor[k]) * Math.min(1, dt * 0.35);
      const span = Math.max(peak[k] - floor[k], 0.04);
      levels[k] = Math.min(1, Math.pow(Math.max(0, (v - floor[k]) / span), 1.4) * sensitivity);
    }

    const flux = Math.max(0, raw.bass - Math.min(...bassHistory));
    bassHistory.shift();
    bassHistory.push(raw.bass);
    fluxAvg += (flux - fluxAvg) * Math.min(1, dt * 1.5);
    const threshold = Math.max(0.07, fluxAvg * 2.5) / sensitivity;
    if (flux > threshold && raw.bass > 0.2 && now - lastBeat > 260) {
      levels.beat = 1;
      levels.count++;
      lastBeat = now;
    } else {
      levels.beat *= Math.exp(-dt / 0.12);
    }
    return levels;
  }

  // Log-spaced bands for bar visualisers, 0..1 each.
  function bars(n, sensitivity = 1) {
    const out = new Array(n);
    for (let i = 0; i < n; i++) {
      const lo = 40 * Math.pow(300, i / n), hi = 40 * Math.pow(300, (i + 1) / n);
      out[i] = Math.min(1, Math.pow(band(lo, hi), 1.5) * 1.6 * sensitivity);
    }
    return out;
  }

  return {
    freq, wave, levels, update, bars,
    stream: out.stream,
    playing: false,
    decoding: USE_DECODER,
    async play(channel) {
      await ctx.resume();
      const url = NTS.streams[channel] + "?t=" + Date.now();
      await (USE_DECODER ? playDecoded(url) : playElement(url));
      this.playing = true;
    },
    stop() { USE_DECODER ? stopDecoded() : stopElement(); this.playing = false; },
    setMonitor(v) { monitor.gain.value = v; },
    ctx,
    voiceIn: input,
    // Lower the music by `amount` (0..1) while the voice speaks; 0 brings it back.
    duck(amount) {
      const t = ctx.currentTime;
      music.gain.cancelScheduledValues(t);
      music.gain.setValueAtTime(music.gain.value, t);
      music.gain.linearRampToValueAtTime(1 - amount, t + (amount ? 0.25 : 0.8));
    },
    onError(fn) { errorHandlers.push(fn); },
  };
};
