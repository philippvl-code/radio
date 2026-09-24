// YouTube overlay, layered over the stage with YouTube's official embed player.
// The player is a cross-origin iframe, so its pixels can't be drawn into the broadcast
// canvas; instead the studio and every viewer show the same embed on top of the stream,
// and the studio keeps viewers in sync with its playback time.
window.parseYouTube = function (url) {
  const s = String(url || "").trim();
  const m = s.match(/(?:youtu\.be\/|youtube(?:-nocookie)?\.com\/(?:watch\?(?:.*&)?v=|embed\/|shorts\/|live\/|v\/))([\w-]{11})/)
    || s.match(/^([\w-]{11})$/);
  return m ? m[1] : null;
};

window.createYouTubeLayer = function (stage) {
  const box = document.createElement("div");
  box.className = "yt-layer";
  box.hidden = true;
  const slot = document.createElement("div");
  box.append(slot);
  stage.firstElementChild.after(box);

  let player = null, ready = false, id = null, latest = null, apiPromise = null;
  // Where playback *should* be, advanced by the wall clock. Browsers pause muted embeds
  // in background tabs, so the player's own time can't be trusted to keep going.
  let clock = null;

  function api() {
    if (!apiPromise) {
      apiPromise = new Promise(resolve => {
        if (window.YT && window.YT.Player) return resolve();
        const prev = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => { prev && prev(); resolve(); };
        const s = document.createElement("script");
        s.src = "https://www.youtube.com/iframe_api";
        document.head.append(s);
      });
    }
    return apiPromise;
  }

  // s: { id, on, layout, size, opacity, blend }; time: where playback should be (seconds).
  async function apply(s, time) {
    latest = { s, time };
    box.dataset.layout = s.layout;
    box.style.setProperty("--yt-size", s.size);
    box.style.opacity = s.opacity;
    box.style.mixBlendMode = s.blend;
    const vid = s.on ? s.id : null;
    box.hidden = !vid;

    if (!vid) {
      if (ready) player.pauseVideo();
      return;
    }
    await api();
    if (!player) {
      id = vid;
      player = new YT.Player(slot, {
        videoId: vid,
        width: "100%",
        height: "100%",
        playerVars: {
          autoplay: 1, mute: 1, controls: 0, disablekb: 1, playsinline: 1,
          rel: 0, iv_load_policy: 3, start: Math.floor(time || 0),
        },
        events: {
          onReady: e => {
            ready = true;
            e.target.mute();
            e.target.playVideo();
            apply(latest.s, latest.time); // pick up anything that changed while loading
          },
          onStateChange: e => {
            if (e.data === YT.PlayerState.ENDED) { e.target.seekTo(0, true); e.target.playVideo(); }
          },
        },
      });
      return;
    }
    if (!ready) return;
    if (vid !== id) {
      id = vid;
      clock = { pos: time || 0, at: performance.now() };
      player.loadVideoById({ videoId: vid, startSeconds: time || 0 });
      return;
    }
    if (player.getPlayerState() !== YT.PlayerState.PLAYING) player.playVideo();
    if (time != null && Math.abs(player.getCurrentTime() - time) > 2) player.seekTo(time, true);
  }

  // Playback position: the player's own time while it is actually playing (which also
  // re-anchors the clock), otherwise the clock's estimate, wrapped for looping videos.
  function position() {
    const now = performance.now();
    if (ready && player.getPlayerState() === YT.PlayerState.PLAYING) {
      clock = { pos: player.getCurrentTime(), at: now };
      return clock.pos;
    }
    if (!clock) return ready ? player.getCurrentTime() : 0;
    const dur = ready ? player.getDuration() : 0;
    const t = clock.pos + (now - clock.at) / 1000;
    return dur > 0 ? t % dur : t;
  }

  return {
    apply,
    time: position,
  };
};
