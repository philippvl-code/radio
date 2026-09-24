// Full screen for the video stage: a button, double-click, or the F key. Uses the
// webkit-prefixed calls Safari still needs, and falls back to the native video player
// on iPhone, where only <video> elements can go full screen.
window.setupFullscreen = function (stage, button, video) {
  const current = () => document.fullscreenElement || document.webkitFullscreenElement;

  function toggle() {
    if (current()) {
      (document.exitFullscreen || document.webkitExitFullscreen).call(document);
    } else if (stage.requestFullscreen) {
      stage.requestFullscreen().catch(() => {});
    } else if (stage.webkitRequestFullscreen) {
      stage.webkitRequestFullscreen();
    } else if (video && video.webkitEnterFullscreen) {
      video.webkitEnterFullscreen();
    }
  }

  // Hide the cursor and button after a moment of stillness while full screen.
  let idleTimer = null;
  function wake() {
    stage.classList.remove("idle");
    clearTimeout(idleTimer);
    if (current()) idleTimer = setTimeout(() => stage.classList.add("idle"), 2000);
  }

  function sync() {
    const on = !!current();
    button.textContent = on ? "Exit full screen" : "Full screen";
    stage.classList.toggle("is-full", on);
    wake();
  }

  button.addEventListener("click", e => { e.stopPropagation(); toggle(); });
  stage.addEventListener("dblclick", toggle);
  stage.addEventListener("mousemove", wake);
  document.addEventListener("keydown", e => {
    const typing = /INPUT|SELECT|TEXTAREA/.test(document.activeElement && document.activeElement.tagName);
    if ((e.key === "f" || e.key === "F") && !typing && !e.metaKey && !e.ctrlKey) toggle();
  });
  document.addEventListener("fullscreenchange", sync);
  document.addEventListener("webkitfullscreenchange", sync);
  sync();
};
