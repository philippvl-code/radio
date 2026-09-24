// Body tracking for the studio, with MediaPipe Pose Landmarker (up to 3 people).
// The camera is cropped into a small 16:9 frame exactly the way the effects shader crops
// it (and mirrored the same way), so the 33 landmarks per person and the body mask line
// up with the output picture without any further mapping.
window.createBodyTracker = function (cam) {
  const VISION = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14";
  const MODEL = "https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task";
  const W = 640, H = 360;
  const MIN_INTERVAL = 45; // ms; ~20 detections a second is plenty for smooth visuals

  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext("2d");

  const state = {
    people: [],                 // [[{x, y, v}] × 33] in 0..1 output coordinates
    mask: new Uint8Array(W * H), // 0..255, everyone's silhouettes combined
    maskW: W, maskH: H,
    hasMask: false,
    status: "off",
  };
  let landmarker = null, loading = null, last = 0;

  function load() {
    if (!loading) {
      state.status = "loading";
      loading = (async () => {
        const { PoseLandmarker, FilesetResolver } = await import(VISION + "/vision_bundle.mjs");
        const fileset = await FilesetResolver.forVisionTasks(VISION + "/wasm");
        landmarker = await PoseLandmarker.createFromOptions(fileset, {
          baseOptions: { modelAssetPath: MODEL, delegate: "GPU" },
          runningMode: "VIDEO",
          numPoses: 3,
          outputSegmentationMasks: true,
        });
        state.status = "ready";
      })().catch(e => { state.status = "failed"; console.error(e); });
    }
    return loading;
  }

  function update(mirror) {
    const now = performance.now();
    if (!landmarker || cam.readyState < 2 || !cam.videoWidth || now - last < MIN_INTERVAL) return state;
    last = now;

    // Same object-fit: cover crop as the shader.
    const vw = cam.videoWidth, vh = cam.videoHeight, ca = vw / vh, ra = W / H;
    let sx = 0, sy = 0, sw = vw, sh = vh;
    if (ca > ra) { sw = vh * ra; sx = (vw - sw) / 2; } else { sh = vw / ra; sy = (vh - sh) / 2; }
    ctx.save();
    if (mirror) { ctx.translate(W, 0); ctx.scale(-1, 1); }
    ctx.drawImage(cam, sx, sy, sw, sh, 0, 0, W, H);
    ctx.restore();

    landmarker.detectForVideo(canvas, now, res => {
      state.people = (res.landmarks || []).map(lm => lm.map(p => ({ x: p.x, y: p.y, v: p.visibility ?? 1 })));
      const masks = res.segmentationMasks || [];
      state.hasMask = masks.length > 0;
      if (state.hasMask) {
        const m = state.mask;
        m.fill(0);
        for (const mask of masks) {
          const f = mask.getAsFloat32Array();
          for (let i = 0; i < f.length && i < m.length; i++) {
            const v = f[i] * 255;
            if (v > m[i]) m[i] = v;
          }
        }
      }
    });
    return state;
  }

  function clear() {
    state.people = [];
    state.hasMask = false;
  }

  return { state, load, update, clear };
};
