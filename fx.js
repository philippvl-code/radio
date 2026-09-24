// Renders one output frame: the camera through a WebGL effects shader, then the music
// visualiser, the NTS now-playing card and text drawn on top in 2D. The output canvas is
// what gets broadcast, so viewers see exactly this.
window.createFx = function (outCanvas, camVideo) {
  const W = outCanvas.width, H = outCanvas.height;
  const out = outCanvas.getContext("2d");

  // ---- WebGL camera pass ----
  const glCanvas = document.createElement("canvas");
  glCanvas.width = W;
  glCanvas.height = H;
  const gl = glCanvas.getContext("webgl", { premultipliedAlpha: false });

  const VERT = `
    attribute vec2 a;
    varying vec2 vUv;
    void main() { vUv = a * 0.5 + 0.5; gl_Position = vec4(a, 0.0, 1.0); }`;

  const FRAG = `
    precision mediump float;
    varying vec2 vUv;
    uniform sampler2D uCam;
    uniform vec2 uRes, uCamSize;
    uniform float uTime, uBass, uMid, uTreble, uBeat;
    uniform float uZoom, uFlash, uRgb, uHue, uPix, uGlitch, uKale, uKaleRot, uMirror, uCamOn;
    uniform int uMode;
    uniform vec3 uDuoA, uDuoB;

    float hash(float n) { return fract(sin(n) * 43758.5453); }

    // object-fit: cover
    vec2 cover(vec2 p) {
      float ra = uRes.x / uRes.y, ca = uCamSize.x / uCamSize.y;
      vec2 s = ra > ca ? vec2(1.0, ca / ra) : vec2(ra / ca, 1.0);
      return (p - 0.5) * s + 0.5;
    }
    vec3 cam(vec2 p) {
      p = cover(p);
      if (uMirror > 0.5) p.x = 1.0 - p.x;
      return texture2D(uCam, clamp(p, 0.0, 1.0)).rgb;
    }
    vec3 hueRotate(vec3 c, float a) {
      const vec3 k = vec3(0.57735);
      float ca = cos(a);
      return c * ca + cross(k, c) * sin(a) + k * dot(k, c) * (1.0 - ca);
    }
    vec3 thermal(float t) {
      vec3 a = vec3(0.02, 0.0, 0.25), b = vec3(0.55, 0.0, 0.75), c = vec3(1.0, 0.3, 0.0), d = vec3(1.0, 1.0, 0.45);
      if (t < 0.33) return mix(a, b, t / 0.33);
      if (t < 0.66) return mix(b, c, (t - 0.33) / 0.33);
      return mix(c, d, (t - 0.66) / 0.34);
    }

    void main() {
      vec2 p = vUv;
      float aspect = uRes.x / uRes.y;

      if (uKale > 0.5) {
        vec2 q = (p - 0.5) * vec2(aspect, 1.0);
        float r = length(q), a = atan(q.y, q.x) + uKaleRot;
        float seg = 6.2831853 / uKale;
        a = mod(a, seg);
        a = abs(a - seg * 0.5);
        p = vec2(cos(a), sin(a)) * r / vec2(aspect, 1.0) + 0.5;
      }

      p = (p - 0.5) / (1.0 + uZoom * uBeat * 0.18) + 0.5;

      if (uPix > 0.0) {
        float s = (0.004 + 0.035 * uTreble) * uPix;
        vec2 cell = vec2(s / aspect, s);
        p = (floor(p / cell) + 0.5) * cell;
      }

      if (uGlitch > 0.0) {
        float row = floor(p.y * 24.0) + floor(uTime * 12.0) * 7.0;
        if (hash(row) < uGlitch * (0.12 + uBeat * 0.6)) p.x += (hash(row + 3.1) - 0.5) * 0.25 * uGlitch;
      }

      float off = uRgb * (0.002 + 0.025 * uMid);
      vec3 col = vec3(cam(p + vec2(off, 0.0)).r, cam(p).g, cam(p - vec2(off, 0.0)).b) * uCamOn;

      float l = dot(col, vec3(0.299, 0.587, 0.114));
      if (uMode == 1) col = vec3(l);
      else if (uMode == 2) col = mix(uDuoA, uDuoB, l);
      else if (uMode == 3) col = 1.0 - col;
      else if (uMode == 4) col = thermal(l);

      col = hueRotate(col, uHue);
      col += uFlash * uBeat * 0.35;
      gl_FragColor = vec4(col, 1.0);
    }`;

  function compile(type, src) {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  }
  const prog = gl.createProgram();
  gl.attachShader(prog, compile(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);
  gl.useProgram(prog);

  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const aLoc = gl.getAttribLocation(prog, "a");
  gl.enableVertexAttribArray(aLoc);
  gl.vertexAttribPointer(aLoc, 2, gl.FLOAT, false, 0, 0);

  const tex = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, 1, 1, 0, gl.RGB, gl.UNSIGNED_BYTE, new Uint8Array(3));
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);

  const U = {};
  ["uRes", "uCamSize", "uTime", "uBass", "uMid", "uTreble", "uBeat", "uZoom", "uFlash", "uRgb", "uHue",
    "uPix", "uGlitch", "uKale", "uKaleRot", "uMirror", "uCamOn", "uMode", "uDuoA", "uDuoB"]
    .forEach(n => { U[n] = gl.getUniformLocation(prog, n); });

  const MODES = { normal: 0, mono: 1, duotone: 2, invert: 3, thermal: 4 };
  const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

  let hue = 0, kaleRot = 0;
  const t0 = performance.now();

  function cameraPass(p, lv) {
    const camReady = p.camera && camVideo.readyState >= 2 && camVideo.videoWidth > 0;
    if (camReady) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, camVideo);

    hue = (hue + p.hue * (lv.beat * 0.09 + 0.003)) % (Math.PI * 2);
    kaleRot += 0.004 + lv.mid * 0.02;

    gl.viewport(0, 0, W, H);
    gl.uniform2f(U.uRes, W, H);
    gl.uniform2f(U.uCamSize, camVideo.videoWidth || 16, camVideo.videoHeight || 9);
    gl.uniform1f(U.uTime, (performance.now() - t0) / 1000);
    gl.uniform1f(U.uBass, lv.bass);
    gl.uniform1f(U.uMid, lv.mid);
    gl.uniform1f(U.uTreble, lv.treble);
    gl.uniform1f(U.uBeat, lv.beat);
    gl.uniform1f(U.uZoom, p.zoom);
    gl.uniform1f(U.uFlash, p.flash);
    gl.uniform1f(U.uRgb, p.rgb);
    gl.uniform1f(U.uHue, p.hue > 0 ? hue : 0);
    gl.uniform1f(U.uPix, p.pixelate);
    gl.uniform1f(U.uGlitch, p.glitch);
    gl.uniform1f(U.uKale, Number(p.kaleido));
    gl.uniform1f(U.uKaleRot, kaleRot);
    gl.uniform1f(U.uMirror, p.mirror ? 1 : 0);
    gl.uniform1f(U.uCamOn, camReady ? 1 : 0);
    gl.uniform1i(U.uMode, MODES[p.mode] || 0);
    gl.uniform3fv(U.uDuoA, rgb(p.duoA));
    gl.uniform3fv(U.uDuoB, rgb(p.duoB));
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    out.drawImage(glCanvas, 0, 0);
  }

  // ---- 2D overlays ----
  const DISPLAY = 'Futura, "Futura PT", Jost, "Century Gothic", sans-serif';
  const MONO = 'ui-monospace, "SF Mono", Menlo, monospace';
  const Y = { top: 0.2, middle: 0.5, bottom: 0.82 };

  function visualiser(p, lv, radio) {
    if (p.vis === "none" || !radio) return;
    out.save();
    out.globalAlpha = p.visOpacity;
    out.fillStyle = out.strokeStyle = p.visColor;
    const cy = H * Y[p.visPos];
    const maxH = H * 0.3 * p.visScale;

    if (p.vis === "columns") {
      // Full-height bars: each one's thickness pulses with the chosen bands, varied per
      // bar by its own slice of the spectrum.
      const n = p.barCount, v = radio.bars(n, p.sensitivity);
      const drive = Math.min(1, p.colBass * lv.bass + p.colMid * lv.mid + p.colTreble * lv.treble);
      const slotW = W / n, maxW = slotW * p.colMax;
      for (let i = 0; i < n; i++) {
        const w = Math.max(1, maxW * drive * (0.35 + 0.65 * v[i]));
        out.fillRect(slotW * (i + 0.5) - w / 2, 0, w, H);
      }
    } else if (p.vis === "bars" || p.vis === "mirror") {
      const n = p.barCount, v = radio.bars(n, p.sensitivity);
      const gap = W * 0.004, bw = (W * 0.9 - gap * (n - 1)) / n, x0 = W * 0.05;
      for (let i = 0; i < n; i++) {
        const h = Math.max(2, v[i] * maxH);
        const x = x0 + i * (bw + gap);
        if (p.vis === "mirror") out.fillRect(x, cy - h / 2, bw, h);
        else out.fillRect(x, p.visPos === "top" ? cy - maxH / 2 : cy + maxH / 2 - h, bw, h);
      }
    } else if (p.vis === "wave") {
      const w = radio.wave, step = Math.ceil(w.length / 400);
      out.lineWidth = Math.max(2, H * 0.004);
      out.lineJoin = "round";
      out.beginPath();
      for (let i = 0; i < w.length; i += step) {
        const x = (i / (w.length - 1)) * W;
        const y = cy + ((w[i] - 128) / 128) * maxH * (1 + lv.beat * 0.3);
        i ? out.lineTo(x, y) : out.moveTo(x, y);
      }
      out.stroke();
    } else if (p.vis === "circle") {
      const n = p.barCount * 2, v = radio.bars(p.barCount, p.sensitivity);
      const r = H * 0.14 * (1 + lv.beat * 0.12 * p.visScale);
      out.lineWidth = Math.max(2, (2 * Math.PI * r) / n * 0.55);
      out.lineCap = "round";
      out.beginPath();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const val = v[i < n / 2 ? i : n - 1 - i]; // mirror left/right
        const len = 4 + val * maxH * 0.6;
        out.moveTo(W / 2 + Math.cos(a) * r, cy + Math.sin(a) * r);
        out.lineTo(W / 2 + Math.cos(a) * (r + len), cy + Math.sin(a) * (r + len));
      }
      out.stroke();
    }
    out.restore();
  }

  function roundRect(x, y, w, h, r) {
    out.beginPath();
    out.moveTo(x + r, y);
    out.arcTo(x + w, y, x + w, y + h, r);
    out.arcTo(x + w, y + h, x, y + h, r);
    out.arcTo(x, y + h, x, y, r);
    out.arcTo(x, y, x + w, y, r);
    out.closePath();
  }

  function fit(text, maxW) {
    if (out.measureText(text).width <= maxW) return text;
    let t = text;
    while (t.length > 1 && out.measureText(t + "…").width > maxW) t = t.slice(0, -1);
    return t + "…";
  }

  function nowPlaying(p, np, art, channel) {
    if (!p.np || !np) return;
    const pad = H * 0.035, h = H * 0.13, gap = H * 0.022;
    const artS = art ? h - gap * 2 : 0;
    const titleSize = H * 0.034, smallSize = H * 0.019;

    out.save();
    out.font = `500 ${titleSize}px ${DISPLAY}`;
    const title = fit(np.title, W * 0.42);
    const textW = Math.max(out.measureText(title).width, W * 0.16);
    const w = gap * 2 + (art ? artS + gap : 0) + textW;
    const right = p.npPos.endsWith("r"), bottom = p.npPos.startsWith("b");
    const x = right ? W - pad - w : pad, y = bottom ? H - pad - h : pad;

    out.fillStyle = "rgba(0, 0, 0, 0.55)";
    roundRect(x, y, w, h, H * 0.016);
    out.fill();
    if (art) out.drawImage(art, x + gap, y + gap, artS, artS);

    const tx = x + gap + (art ? artS + gap : 0);
    out.fillStyle = "#ff3b30";
    out.beginPath();
    out.arc(tx + smallSize * 0.35, y + gap + smallSize * 0.55, smallSize * 0.3, 0, Math.PI * 2);
    out.fill();
    out.fillStyle = "rgba(255,255,255,0.75)";
    out.font = `${smallSize}px ${MONO}`;
    out.textBaseline = "top";
    out.fillText(`NTS ${channel} · LIVE`, tx + smallSize, y + gap);
    out.fillStyle = "#fff";
    out.font = `500 ${titleSize}px ${DISPLAY}`;
    out.fillText(title, tx, y + gap + smallSize * 1.6);
    if (np.location) {
      out.fillStyle = "rgba(255,255,255,0.6)";
      out.font = `${smallSize}px ${MONO}`;
      out.fillText(fit(np.location, textW), tx, y + gap + smallSize * 1.6 + titleSize * 1.25);
    }
    out.restore();
  }

  function text(p, lv) {
    if (!p.text) return;
    const size = H * p.textSize * (1 + lv.beat * p.textPulse * 0.3);
    out.save();
    out.font = `500 ${size}px ${DISPLAY}`;
    out.textAlign = "center";
    out.textBaseline = "middle";
    out.shadowColor = "rgba(0,0,0,0.35)";
    out.shadowBlur = size * 0.15;
    out.fillStyle = p.textColor;
    out.fillText(p.text, W / 2, H * Y[p.textPos]);
    out.restore();
  }

  return {
    render(p, lv, radio, np, art, channel) {
      cameraPass(p, lv);
      visualiser(p, lv, radio);
      nowPlaying(p, np, art, channel);
      text(p, lv);
    },
  };
};
