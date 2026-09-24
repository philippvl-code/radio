// NTS Radio: live stream URLs and what's on now (https://www.nts.live/api/v2/live).
// radiomast is where NTS's own stream links redirect to; it sends CORS headers, which
// Web Audio needs in order to read the sound for the visuals.
window.NTS = (function () {
  const streams = {
    1: "https://streams.radiomast.io/nts1",
    2: "https://streams.radiomast.io/nts2",
  };

  const decoder = document.createElement("textarea");
  const decode = s => { decoder.innerHTML = s || ""; return decoder.value; };

  function show(slot) {
    if (!slot) return null;
    const d = (slot.embeds && slot.embeds.details) || {};
    const media = d.media || {};
    return {
      title: decode(slot.broadcast_title || d.name || "NTS"),
      location: d.location_long || "",
      genres: (d.genres || []).map(g => (typeof g === "string" ? g : g.value)).filter(Boolean),
      start: slot.start_timestamp,
      end: slot.end_timestamp,
      image: media.picture_medium_large || media.background_medium_large || media.picture_medium || null,
      url: d.show_alias && d.episode_alias
        ? `https://www.nts.live/shows/${d.show_alias}/episodes/${d.episode_alias}`
        : "https://www.nts.live/",
    };
  }

  async function live() {
    const res = await fetch("https://www.nts.live/api/v2/live");
    if (!res.ok) throw new Error("NTS API " + res.status);
    const data = await res.json();
    const out = {};
    for (const c of data.results || []) {
      out[c.channel_name] = { now: show(c.now), next: show(c.next) };
    }
    return out;
  }

  return { streams, live };
})();
