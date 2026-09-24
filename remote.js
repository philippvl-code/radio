// Remote control for the studio: the NTS Studio Remote Android app (or anything speaking
// this protocol) connects over a PeerJS data channel using a short pairing code, gets the
// full list of controls, and can change any of them, trigger actions, and send drawings.
//
// studio → remote: {type:"schema"}, {type:"state"}, {type:"levels"}, {type:"preview"}, {type:"drawings"}
// remote → studio: {type:"set", changes}, {type:"action", name, arg}, {type:"drawings", list}
window.createRemoteServer = function (hooks) {
  const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no 0/O, 1/I/L mix-ups
  const KEY = "radio-remote-code";
  const newCode = () => Array.from(crypto.getRandomValues(new Uint8Array(6)), b => ALPHABET[b % ALPHABET.length]).join("");
  let code = null;
  try { code = localStorage.getItem(KEY); } catch {}
  if (!code) { code = newCode(); try { localStorage.setItem(KEY, code); } catch {} }

  const state = { code, status: "off", remotes: 0 };
  const conns = new Set();
  let peer = null, levelTimer = null, previewTimer = null, stateTimer = null;
  const previewCanvas = document.createElement("canvas");
  previewCanvas.width = 320;
  previewCanvas.height = 180;

  const peerId = () => "radio-remote-" + state.code.toLowerCase();
  const sendAll = msg => conns.forEach(c => c.open && c.send(msg));

  function start() {
    if (peer) return;
    state.status = "connecting";
    peer = new Peer(peerId());
    peer.on("open", () => { state.status = "ready"; hooks.changed(); });
    peer.on("connection", conn => {
      conn.on("open", () => {
        conns.add(conn);
        state.remotes = conns.size;
        conn.send(hooks.schema());
        conn.send(hooks.state());
        conn.send({ type: "drawings", list: hooks.drawings() });
        hooks.changed();
      });
      conn.on("data", msg => handle(msg));
      conn.on("close", () => { conns.delete(conn); state.remotes = conns.size; hooks.changed(); });
    });
    peer.on("disconnected", () => peer && peer.reconnect());
    peer.on("error", err => {
      if (err.type === "unavailable-id") state.status = "code in use in another tab";
      else if (err.type !== "peer-unavailable") state.status = "error: " + err.type;
      hooks.changed();
    });

    // Meters ~15x a second and a small preview picture ~3x a second, only while someone is connected.
    levelTimer = setInterval(() => { if (conns.size) sendAll({ type: "levels", ...hooks.levels() }); }, 66);
    previewTimer = setInterval(() => {
      if (!conns.size) return;
      const g = previewCanvas.getContext("2d");
      g.drawImage(hooks.canvas(), 0, 0, previewCanvas.width, previewCanvas.height);
      sendAll({ type: "preview", jpeg: previewCanvas.toDataURL("image/jpeg", 0.55) });
    }, 330);
  }

  function stop() {
    clearInterval(levelTimer);
    clearInterval(previewTimer);
    conns.forEach(c => c.close());
    conns.clear();
    if (peer) peer.destroy();
    peer = null;
    state.status = "off";
    state.remotes = 0;
    hooks.changed();
  }

  function regenerate() {
    const was = !!peer;
    stop();
    state.code = newCode();
    try { localStorage.setItem(KEY, state.code); } catch {}
    if (was) start();
    hooks.changed();
  }

  function handle(msg) {
    if (!msg || typeof msg !== "object") return;
    if (msg.type === "set" && msg.changes && typeof msg.changes === "object") hooks.set(msg.changes);
    else if (msg.type === "action" && typeof msg.name === "string") hooks.action(msg.name, msg.arg);
    else if (msg.type === "drawings" && Array.isArray(msg.list)) hooks.setDrawings(msg.list);
  }

  // Coalesce state updates: many changes in one frame → one message.
  function pushState() {
    if (!conns.size || stateTimer) return;
    stateTimer = setTimeout(() => { stateTimer = null; sendAll(hooks.state()); }, 80);
  }

  return {
    state, start, stop, regenerate, pushState,
    pushDrawings: () => sendAll({ type: "drawings", list: hooks.drawings() }),
    get active() { return !!peer; },
  };
};
