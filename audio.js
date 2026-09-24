// Plays an NTS channel through Web Audio, measures it for the visuals, and exposes the
// audio as a MediaStream so it can be sent to viewers along with the video.
window.createRadio = function () {
  const ctx = new AudioContext();
  const el = new Audio();
  el.crossOrigin = "anonymous";

  const source = ctx.createMediaElementSource(el);
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.55;
  const monitor = ctx.createGain();
  const out = ctx.createMediaStreamDestination();

  // The broadcast always gets full volume; "monitor" only changes what you hear locally.
  source.connect(analyser);
  source.connect(out);
  source.connect(monitor).connect(ctx.destination);
  out.stream.getAudioTracks().forEach(t => { t.contentHint = "music"; });

  const freq = new Uint8Array(analyser.frequencyBinCount);
  const wave = new Uint8Array(analyser.fftSize);
  const binHz = ctx.sampleRate / analyser.fftSize;

  const levels = { bass: 0, mid: 0, treble: 0, beat: 0 };
  const peak = { bass: 0.2, mid: 0.2, treble: 0.2 };
  const bassHistory = [0, 0, 0, 0];
  let fluxAvg = 0.03, lastBeat = 0, lastT = performance.now();

  function band(lo, hi) {
    const a = Math.max(1, Math.floor(lo / binHz)), b = Math.min(freq.length - 1, Math.ceil(hi / binHz));
    let sum = 0;
    for (let i = a; i <= b; i++) sum += freq[i];
    return sum / (b - a + 1) / 255;
  }

  // Levels are 0..1, auto-gained against a slowly falling peak so quiet and loud shows
  // both drive the effects. `beat` jumps to 1 on a kick and decays. Kicks are found as a
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
      peak[k] = Math.max(raw[k], peak[k] * Math.pow(0.9, dt), 0.05);
      levels[k] = Math.min(1, Math.pow(raw[k] / peak[k], 3) * sensitivity);
    }

    const flux = Math.max(0, raw.bass - Math.min(...bassHistory));
    bassHistory.shift();
    bassHistory.push(raw.bass);
    fluxAvg += (flux - fluxAvg) * Math.min(1, dt * 1.5);
    const threshold = Math.max(0.07, fluxAvg * 2.5) / sensitivity;
    if (flux > threshold && raw.bass > 0.2 && now - lastBeat > 260) {
      levels.beat = 1;
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
    async play(channel) {
      await ctx.resume();
      el.src = NTS.streams[channel] + "?t=" + Date.now();
      await el.play();
      this.playing = true;
    },
    stop() { el.pause(); el.removeAttribute("src"); el.load(); this.playing = false; },
    setMonitor(v) { monitor.gain.value = v; },
    onError(fn) { el.addEventListener("error", fn); el.addEventListener("stalled", fn); },
  };
};
