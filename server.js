// VidFind — YouTube search with official embeds, plus public MP4 collections.
// Run: node server.js
// Then open http://localhost:3000

const http = require("http");
const fs = require("fs");
const path = require("path");
const direct = require("./providers");
const youtube = require("./youtube");
const catalogs = { direct, youtube };

const PORT = process.env.PORT || 3000;


function sendJson(res, status, data) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  res.end(JSON.stringify(data));
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function decodeMetadata(value) {
  const entities = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
  return String(value ?? "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (match, entity) => {
    if (entity[0] !== "#") return entities[entity.toLowerCase()];
    const code = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : match;
  });
}

function sendPage(res, status, query = "", search = { results: [], nextPageToken: null }, error = "", source = "youtube") {
  fs.readFile(path.join(__dirname, "index.html"), "utf8", (err, template) => {
    if (err) { res.writeHead(500); return res.end("Unable to load the search page."); }
    const results = search.results.map((video) => {
      const title = decodeMetadata(video.title);
      const channel = decodeMetadata(video.channel);
      const date = new Date(video.published);
      const published = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric",
      });
      const href = "/watch?" + new URLSearchParams({ id: video.id, q: query, source });
      return `<a class="card" href="${escapeHtml(href)}" data-video-id="${escapeHtml(video.id)}"><img src="${escapeHtml(video.thumbnail)}" alt="" loading="lazy"><h3>${escapeHtml(title)}</h3><div class="meta">${escapeHtml(channel)}${published ? " · " + published : ""}</div><span class="play-label">▶ Play video</span></a>`;
    }).join("");
    const message = error ? "Couldn't search right now: " + error : query
      ? search.results.length ? `${search.results.length} videos for “${query}”`
        : `No videos found for “${query}”. Try another topic.`
      : "";
    const replacements = {
      BODY_CLASS: query ? "searched" : "",
      RENDERED: query ? "true" : "false",
      NEXT_TOKEN: escapeHtml(search.nextPageToken),
      QUERY: escapeHtml(query),
      MAIN_HIDDEN: query ? "" : "hidden",
      STATUS: escapeHtml(message),
      NOTICE: escapeHtml(search.notice || ""),
      NOTICE_HIDDEN: search.notice ? "" : "hidden",
      RESULTS: results,
      MORE_HIDDEN: search.nextPageToken ? "" : "hidden",
      SOURCE: source,
      YOUTUBE_LINK: escapeHtml("/?" + new URLSearchParams({ ...(query ? { q: query } : {}), source: "youtube" })),
      DIRECT_LINK: escapeHtml("/?" + new URLSearchParams({ ...(query ? { q: query } : {}), source: "direct" })),
      YOUTUBE_CURRENT: source === "youtube" ? 'aria-current="page"' : "",
      DIRECT_CURRENT: source === "direct" ? 'aria-current="page"' : "",
      CATALOG_NOTE: source === "youtube" ? "Search YouTube and watch eligible videos here. Your connection must allow the YouTube player." : "Direct playback from NASA and selected Internet Archive collections. Your connection must allow the publisher’s video host.",
      YOUTUBE_HIDDEN: source === "youtube" ? "" : "hidden",
    };
    const body = template.replace(/__VDF_([A-Z_]+)__/g, (_, name) => replacements[name] ?? "");
    res.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    res.end(body);
  });
}

function sendWatchPage(res, status, query, video, error = "", source = "youtube", mode = "privacy") {
  fs.readFile(path.join(__dirname, "watch.html"), "utf8", (err, template) => {
    if (err) { res.writeHead(500); return res.end("Unable to load the video page."); }
    const isYoutube = Boolean(video?.youtubeId);
    const referrer = isYoutube ? "strict-origin-when-cross-origin" : "no-referrer";
    const otherMode = mode === "standard" ? "privacy" : "standard";
    const embedUrl = isYoutube ? `https://${mode === "standard" ? "www.youtube.com" : "www.youtube-nocookie.com"}/embed/${video.youtubeId}?autoplay=1&playsinline=1&rel=0` : "";
    const player = !video ? "" : isYoutube
      ? `<iframe id="youtube-player" title="${escapeHtml(decodeMetadata(video.title))}" src="${escapeHtml(embedUrl)}" referrerpolicy="strict-origin-when-cross-origin" allow="autoplay; encrypted-media; picture-in-picture; fullscreen" allowfullscreen></iframe>`
      : `<video id="video" controls autoplay playsinline preload="metadata" poster="${escapeHtml(video.thumbnail)}" aria-label="${escapeHtml(video.title)}">${video.sources.map((entry) => `<source src="${escapeHtml(entry.url)}" type="${escapeHtml(entry.type)}">`).join("")}Your browser cannot play this video. Use “Open video file” below.</video>`;
    const replacements = {
      TITLE: escapeHtml(decodeMetadata(video?.title || "Video unavailable")),
      CHANNEL: escapeHtml(video ? [...new Set([decodeMetadata(video.channel), video.provider])].filter(Boolean).join(" · ") : ""),
      DESCRIPTION: escapeHtml(video?.description || ""),
      POSTER: escapeHtml(video?.thumbnail || ""),
      BACK: escapeHtml("/?" + new URLSearchParams({ ...(query ? { q: query } : {}), source })),
      VIDEO_HIDDEN: video ? "" : "hidden",
      ERROR_HIDDEN: error ? "" : "hidden",
      ERROR: escapeHtml(error),
      FILE: escapeHtml(video?.sources?.[0]?.url || ""),
      FILE_HIDDEN: video && !isYoutube ? "" : "hidden",
      PLAYER: player,
      REFERRER: referrer,
      PLAYER_STATUS: isYoutube ? "If the player is blocked, try the other player option below or choose Direct videos." : "Press play if the video does not start automatically.",
      PLAYER_NOTE: isYoutube ? "This is YouTube’s official embedded player. Your connection must allow YouTube playback." : "This video plays directly from its publisher. The publisher’s file host must be allowed by your connection.",
      YOUTUBE_HIDDEN: isYoutube ? "" : "hidden",
      PLAYER_MODE: mode === "standard" ? "Standard player" : "Privacy-enhanced player",
      OTHER_PLAYER_MODE: mode === "standard" ? "Try privacy-enhanced player" : "Try standard player",
      OTHER_PLAYER: escapeHtml("/watch?" + new URLSearchParams({ id: video?.id || "", q: query, source, player: otherMode })),
      DIRECT_LINK: escapeHtml("/?" + new URLSearchParams({ ...(query ? { q: query } : {}), source: "direct" })),
    };
    const body = template.replace(/__VDF_([A-Z_]+)__/g, (_, name) => replacements[name] ?? "");
    res.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": referrer,
    });
    res.end(body);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { Allow: "GET, HEAD" }); return res.end("Method not allowed");
  }

  if (url.pathname === "/watch") {
    const query = (url.searchParams.get("q") || "").slice(0, 200);
    const id = url.searchParams.get("id");
    const source = id?.startsWith("youtube:") ? "youtube" : "direct";
    const mode = url.searchParams.get("player") === "standard" ? "standard" : "privacy";
    try {
      const video = await catalogs[source].getVideo(id);
      return sendWatchPage(res, 200, query, video, "", source, mode);
    } catch (err) {
      console.error("Video: " + err.message);
      return sendWatchPage(res, err.status || 502, query, null, err.message, source, mode);
    }
  }

  // Back end: the search endpoint your page calls
  if (url.pathname === "/api/search") {
    const source = url.searchParams.get("source") || "youtube";
    if (!Object.hasOwn(catalogs, source)) return sendJson(res, 400, { error: "Choose YouTube or Direct videos." });
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return sendJson(res, 400, { error: "Type something to search for." });
    if (q.length > 200) return sendJson(res, 400, { error: "That search is too long." });
    try {
      const out = await catalogs[source].searchVideos(q, url.searchParams.get("pageToken"));
      return sendJson(res, 200, out);
    } catch (err) {
      console.error(err.message);
      return sendJson(res, err.status || 502, { error: err.message });
    }
  }

  // Front end: the search page
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const source = url.searchParams.get("source") || "youtube";
    const q = (url.searchParams.get("q") || "").trim();
    if (!Object.hasOwn(catalogs, source)) return sendPage(res, 400, q, undefined, "Choose YouTube or Direct videos.");
    if (!q) return sendPage(res, 200, "", undefined, "", source);
    if (q.length > 200) return sendPage(res, 400, q, undefined, "That search is too long.", source);
    try {
      const search = await catalogs[source].searchVideos(q, url.searchParams.get("pageToken"));
      return sendPage(res, 200, q, search, "", source);
    } catch (err) {
      console.error(err.message);
      return sendPage(res, err.status || 502, q, undefined, err.message, source);
    }
  }
  if (url.pathname === "/privacy") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "X-Content-Type-Options": "nosniff" });
    return res.end(fs.readFileSync(path.join(__dirname, "privacy.html"), "utf8"));
  }
  if (url.pathname === "/youtube-logo.svg") {
    res.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "public, max-age=86400", "X-Content-Type-Options": "nosniff" });
    return res.end(fs.readFileSync(path.join(__dirname, "youtube-logo.svg"), "utf8"));
  }
  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, () => console.log(`VidFind running at http://localhost:${PORT}`));
