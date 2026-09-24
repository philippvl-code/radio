// Renders one output frame: the camera through a WebGL effects shader (which can also use
// the body mask from body.js), then body graphics, the music visualiser, the NTS
// now-playing card and text drawn on top in 2D. The output canvas is
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
    uniform sampler2D uMask;
    uniform vec2 uMaskTexel;
    uniform float uMaskOn, uOutline;
    uniform int uBodyMode;
    uniform vec3 uBodyColor, uBgColor, uOutlineColor;

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

      // Body mask: the mask is in output space, so sample it where the camera was sampled.
      if (uMaskOn > 0.5) {
        vec2 mp = clamp(p, 0.0, 1.0);
        float m = texture2D(uMask, mp).r;
        vec3 clean = cam(p) * uCamOn;
        if (uBodyMode == 1) col = mix(col, clean, m);                                // effects on background only
        else if (uBodyMode == 2) col = mix(clean, col, m);                           // effects on body only
        else if (uBodyMode == 3) col = mix(col, uBodyColor * (0.75 + 0.5 * uBeat), m); // solid silhouette
        else if (uBodyMode == 4) col = mix(uBgColor, col, m);                        // cut out the person
        else if (uBodyMode == 5) col = mix(col, 1.0 - col, m);                       // negative body

        if (uOutline > 0.0) {
          vec2 d = uMaskTexel * (2.0 + 10.0 * uOutline) * (1.0 + uBass);
          float ring =
              abs(texture2D(uMask, mp + vec2(d.x, 0.0)).r - texture2D(uMask, mp - vec2(d.x, 0.0)).r)
            + abs(texture2D(uMask, mp + vec2(0.0, d.y)).r - texture2D(uMask, mp - vec2(0.0, d.y)).r)
            + abs(texture2D(uMask, mp + d).r - texture2D(uMask, mp - d).r)
            + abs(texture2D(uMask, mp + vec2(d.x, -d.y)).r - texture2D(uMask, mp - vec2(d.x, -d.y)).r);
          col += uOutlineColor * clamp(ring * 0.6, 0.0, 1.0) * (0.6 + 0.8 * uBeat);
        }
      }
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

  // Body mask lives on texture unit 1.
  const maskTex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, maskTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, 1, 1, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, new Uint8Array(1));
  gl.activeTexture(gl.TEXTURE0);

  const U = {};
  ["uRes", "uCamSize", "uTime", "uBass", "uMid", "uTreble", "uBeat", "uZoom", "uFlash", "uRgb", "uHue",
    "uPix", "uGlitch", "uKale", "uKaleRot", "uMirror", "uCamOn", "uMode", "uDuoA", "uDuoB",
    "uCam", "uMask", "uMaskTexel", "uMaskOn", "uOutline", "uBodyMode", "uBodyColor", "uBgColor", "uOutlineColor"]
    .forEach(n => { U[n] = gl.getUniformLocation(prog, n); });

  const MODES = { normal: 0, mono: 1, duotone: 2, invert: 3, thermal: 4 };
  const BODY_MODES = { off: 0, bgfx: 1, bodyfx: 2, fill: 3, cutout: 4, negative: 5 };
  gl.uniform1i(U.uCam, 0);
  gl.uniform1i(U.uMask, 1);
  const rgb = hex => { const n = parseInt(hex.slice(1), 16); return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

  let hue = 0, kaleRot = 0;
  const t0 = performance.now();

  function cameraPass(p, lv, body) {
    const camReady = p.camera && camVideo.readyState >= 2 && camVideo.videoWidth > 0;
    if (camReady) gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, camVideo);

    const maskOn = !!(p.bodyOn && camReady && body && body.hasMask);
    if (maskOn) {
      gl.activeTexture(gl.TEXTURE1);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, body.maskW, body.maskH, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, body.mask);
      gl.activeTexture(gl.TEXTURE0);
      gl.uniform2f(U.uMaskTexel, 1 / body.maskW, 1 / body.maskH);
    }
    gl.uniform1f(U.uMaskOn, maskOn ? 1 : 0);
    gl.uniform1i(U.uBodyMode, BODY_MODES[p.bodyMode] || 0);
    gl.uniform1f(U.uOutline, p.outline);
    gl.uniform3fv(U.uBodyColor, rgb(p.bodyColor));
    gl.uniform3fv(U.uBgColor, rgb(p.bgColor));
    gl.uniform3fv(U.uOutlineColor, rgb(p.outlineColor));

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

  // ---- Body graphics: skeleton, trails, sparks ----
  const BONES = [[11, 12], [11, 13], [13, 15], [12, 14], [14, 16], [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27], [24, 26], [26, 28], [27, 31], [28, 32], [15, 19], [16, 20]];
  const JOINTS = [0, 11, 12, 13, 14, 15, 16, 23, 24, 25, 26, 27, 28];
  const TRAIL_POINTS = [0, 15, 16, 27, 28]; // head, wrists, ankles
  const SPARK_POINTS = [0, 15, 16];
  let tracks = [];   // one per person, kept across frames: { c: centre, hist: {joint: [[x, y]]} }
  let sparks = [];
  let lastBeatCount = 0;
  let anchors = {};

  const seen = pt => pt && pt.v > 0.5;
  const px = pt => [pt.x * W, pt.y * H];

  function bodyLayer(p, lv, body) {
    const people = p.bodyOn && body ? body.people : [];

    // Pair each person with last frame's nearest track so trails stay on the right body.
    const next = [];
    const free = tracks.slice();
    for (const lm of people) {
      const pts = [lm[11], lm[12], lm[23], lm[24]];
      const c = [pts.reduce((a, q) => a + q.x, 0) / 4 * W, pts.reduce((a, q) => a + q.y, 0) / 4 * H];
      let best = -1, bestD = W * 0.25;
      free.forEach((t, i) => { const d = Math.hypot(t.c[0] - c[0], t.c[1] - c[1]); if (d < bestD) { bestD = d; best = i; } });
      const t = best >= 0 ? free.splice(best, 1)[0] : { hist: {} };
      t.c = c;
      t.lm = lm;
      next.push(t);
    }
    tracks = next;

    // Anchors for the visualiser and text to follow (first person).
    anchors = {};
    if (tracks[0]) {
      const lm = tracks[0].lm;
      const shoulderW = Math.hypot((lm[11].x - lm[12].x) * W, (lm[11].y - lm[12].y) * H);
      anchors.chest = { x: tracks[0].c[0], y: (lm[11].y + lm[12].y) / 2 * H * 0.6 + tracks[0].c[1] * 0.4, size: shoulderW };
      if (seen(lm[0])) anchors.head = { x: lm[0].x * W, y: lm[0].y * H - shoulderW * 0.75 };
    }

    const color = p.skelColor;
    const base = H * 0.007 * p.skelWidth * (1 + lv.bass * 0.8);
    out.save();
    out.lineCap = out.lineJoin = "round";
    out.strokeStyle = out.fillStyle = color;
    if (p.skeleton === "neon") {
      out.globalCompositeOperation = "lighter";
      out.shadowColor = color;
      out.shadowBlur = base * 4;
    }

    // Trails
    if (p.trails > 0) {
      const len = Math.round(3 + p.trails * 40);
      for (const t of tracks) {
        for (const j of TRAIL_POINTS) {
          const h = t.hist[j] || (t.hist[j] = []);
          if (seen(t.lm[j])) h.push(px(t.lm[j]));
          while (h.length > len) h.shift();
          for (let k = 1; k < h.length; k++) {
            out.globalAlpha = (k / h.length) * 0.9;
            out.lineWidth = base * (0.4 + (k / h.length) * 1.2);
            out.beginPath();
            out.moveTo(h[k - 1][0], h[k - 1][1]);
            out.lineTo(h[k][0], h[k][1]);
            out.stroke();
          }
        }
      }
      out.globalAlpha = 1;
    }

    // Skeleton
    if (p.skeleton !== "none") {
      for (const t of tracks) {
        const lm = t.lm;
        if (p.skeleton !== "dots") {
          out.lineWidth = base;
          out.beginPath();
          for (const [a, b] of BONES) {
            if (!seen(lm[a]) || !seen(lm[b])) continue;
            out.moveTo(lm[a].x * W, lm[a].y * H);
            out.lineTo(lm[b].x * W, lm[b].y * H);
          }
          out.stroke();
          if (seen(lm[0]) && seen(lm[11]) && seen(lm[12])) {
            const r = Math.hypot((lm[11].x - lm[12].x) * W, (lm[11].y - lm[12].y) * H) * 0.28 * (1 + lv.beat * 0.15);
            out.beginPath();
            out.arc(lm[0].x * W, lm[0].y * H, r, 0, Math.PI * 2);
            out.stroke();
          }
        }
        const jr = base * (p.skeleton === "dots" ? 1.6 : 0.9) * (1 + lv.beat * 1.2);
        for (const j of JOINTS) {
          if (!seen(lm[j])) continue;
          out.beginPath();
          out.arc(lm[j].x * W, lm[j].y * H, jr, 0, Math.PI * 2);
          out.fill();
        }
      }
    }

    // Sparks fly from the head and hands on every beat.
    if (lv.count !== undefined && lv.count !== lastBeatCount) {
      lastBeatCount = lv.count;
      if (p.sparks > 0) {
        const n = Math.round(p.sparks * 14 * (0.5 + lv.bass));
        for (const t of tracks) {
          for (const j of SPARK_POINTS) {
            if (!seen(t.lm[j])) continue;
            const [x, y] = px(t.lm[j]);
            for (let k = 0; k < n; k++) {
              const a = Math.random() * Math.PI * 2, sp = H * (0.004 + Math.random() * 0.012);
              const life = 25 + Math.random() * 30;
              sparks.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - H * 0.004, life, max: life });
            }
          }
        }
        if (sparks.length > 900) sparks = sparks.slice(-900);
      }
    }
    if (sparks.length) {
      out.globalCompositeOperation = "lighter";
      out.shadowBlur = 0;
      const r = H * 0.0035;
      sparks = sparks.filter(s => {
        s.x += s.vx; s.y += s.vy; s.vy += H * 0.0004; s.life--;
        out.globalAlpha = Math.max(0, s.life / s.max);
        out.beginPath();
        out.arc(s.x, s.y, r * (0.5 + s.life / s.max), 0, Math.PI * 2);
        out.fill();
        return s.life > 0;
      });
    }
    out.restore();
  }

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
      const follow = p.bodyOn && p.followVis && anchors.chest;
      const cx = follow ? anchors.chest.x : W / 2, ccy = follow ? anchors.chest.y : cy;
      const r = (follow ? Math.max(H * 0.08, anchors.chest.size * 0.75) : H * 0.14) * (1 + lv.beat * 0.12 * p.visScale);
      out.lineWidth = Math.max(2, (2 * Math.PI * r) / n * 0.55);
      out.lineCap = "round";
      out.beginPath();
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        const val = v[i < n / 2 ? i : n - 1 - i]; // mirror left/right
        const len = 4 + val * maxH * 0.6;
        out.moveTo(cx + Math.cos(a) * r, ccy + Math.sin(a) * r);
        out.lineTo(cx + Math.cos(a) * (r + len), ccy + Math.sin(a) * (r + len));
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
    if (p.bodyOn && p.followText && anchors.head) out.fillText(p.text, anchors.head.x, anchors.head.y - size * 0.4);
    else out.fillText(p.text, W / 2, H * Y[p.textPos]);
    out.restore();
  }

  // ---- Drawings from the remote's drawing pad, animated to the music ----
  // A drawing: { id, kind: stroke|line|rect|ellipse|triangle|star, points: [[x, y]] in 0..1,
  //   color, width (px at 720p), fill, glow, hue (cycle colour), anim, source, amount }
  const drawAnim = new Map(); // id → { angle }
  const t0d = performance.now();

  function shapePath(d, pts, cx, cy, jitter, progress) {
    const P = pts.map(([x, y]) => [x * W - cx, y * H - cy]);
    const j = () => (jitter ? (Math.random() - 0.5) * jitter : 0);
    out.beginPath();
    if (d.kind === "stroke" || d.kind === "line") {
      const n = Math.max(2, Math.ceil(P.length * progress));
      P.slice(0, n).forEach(([x, y], i) => (i ? out.lineTo(x + j(), y + j()) : out.moveTo(x + j(), y + j())));
      return;
    }
    const [[x0, y0], [x1, y1]] = [P[0], P[P.length - 1]];
    const l = Math.min(x0, x1), r = Math.max(x0, x1), t = Math.min(y0, y1), b = Math.max(y0, y1);
    if (d.kind === "rect") {
      out.rect(l + j(), t + j(), r - l, b - t);
    } else if (d.kind === "ellipse") {
      out.ellipse((l + r) / 2 + j(), (t + b) / 2 + j(), (r - l) / 2, (b - t) / 2, 0, 0, Math.PI * 2 * progress);
    } else if (d.kind === "triangle") {
      out.moveTo((l + r) / 2 + j(), t + j()); out.lineTo(r + j(), b + j()); out.lineTo(l + j(), b + j()); out.closePath();
    } else if (d.kind === "star") {
      const mx = (l + r) / 2, my = (t + b) / 2, rx = (r - l) / 2, ry = (b - t) / 2;
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? 0.45 : 1;
        const x = mx + Math.cos(a) * rx * k + j(), y = my + Math.sin(a) * ry * k + j();
        i ? out.lineTo(x, y) : out.moveTo(x, y);
      }
      out.closePath();
    }
  }

  function drawingsLayer(p, lv, list) {
    if (!p.drawOn || !list || !list.length) return;
    const t = (performance.now() - t0d) / 1000;
    out.save();
    out.lineCap = out.lineJoin = "round";
    for (const d of list) {
      const pts = d.points;
      if (!Array.isArray(pts) || !pts.length) continue;
      let minX = 1, maxX = 0, minY = 1, maxY = 0;
      for (const [x, y] of pts) { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
      const cx = (minX + maxX) / 2 * W, cy = (minY + maxY) / 2 * H;
      const lvl = d.source === "beat" ? lv.beat : lv[d.source] || 0;
      const a = d.amount == null ? 0.6 : d.amount;
      const st = drawAnim.get(d.id) || { angle: 0 };
      drawAnim.set(d.id, st);

      let scale = 1, rot = 0, dy = 0, alpha = 1, jitter = 0, progress = 1;
      if (d.anim === "pulse") scale = 1 + a * lvl * 0.6;
      else if (d.anim === "spin") { st.angle += a * (0.01 + lvl * 0.15); rot = st.angle; }
      else if (d.anim === "bounce") dy = -a * lvl * H * 0.15;
      else if (d.anim === "wobble") jitter = a * lvl * H * 0.04;
      else if (d.anim === "flash") alpha = 0.1 + 0.9 * lvl;
      else if (d.anim === "trace") progress = Math.max(0.02, (t * (0.25 + a * 0.75)) % 1.15);
      else if (d.anim === "dance") {
        scale = 1 + a * lv.beat * 0.35;
        rot = Math.sin(t * 2.2) * a * 0.35 * (0.3 + lv.mid);
        dy = -a * lv.bass * H * 0.06;
      }
      progress = Math.min(1, progress);

      const color = d.hue ? `hsl(${(t * 60 + (d.id % 360)) % 360}, 95%, 60%)` : d.color || "#ffffff";
      const width = (d.width || 6) * (H / 720) * (d.anim === "pulse" ? 1 + a * lvl * 0.5 : 1);
      out.globalAlpha = alpha * p.drawOpacity;
      out.strokeStyle = out.fillStyle = color;
      out.lineWidth = width;
      out.shadowColor = color;
      out.shadowBlur = d.glow ? width * 2.5 * (1 + lvl) : 0;
      out.setTransform(1, 0, 0, 1, cx, cy + dy);
      out.rotate(rot);
      out.scale(scale, scale);
      shapePath(d, pts, cx, cy, jitter, progress);
      if (d.fill && d.kind !== "stroke" && d.kind !== "line") out.fill();
      else out.stroke();
    }
    out.restore();
  }

  // Captions for the voice generator: the sentence being spoken, at the bottom.
  function caption(text) {
    if (!text) return;
    const size = H * 0.042;
    out.save();
    out.font = `500 ${size}px ${DISPLAY}`;
    out.textAlign = "center";
    out.textBaseline = "middle";
    const t = fit(text, W * 0.8);
    const w = out.measureText(t).width + size * 1.4, h = size * 1.8, y = H * 0.9;
    out.fillStyle = "rgba(0, 0, 0, 0.6)";
    roundRect(W / 2 - w / 2, y - h / 2, w, h, h / 2);
    out.fill();
    out.fillStyle = "#fff";
    out.fillText(t, W / 2, y);
    out.restore();
  }

  return {
    render(p, lv, radio, np, art, channel, body, captionText, drawingList) {
      cameraPass(p, lv, body);
      bodyLayer(p, lv, body);
      drawingsLayer(p, lv, drawingList);
      visualiser(p, lv, radio);
      nowPlaying(p, np, art, channel);
      text(p, lv);
      if (p.vCaptions) caption(captionText);
    },
  };
};
