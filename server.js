// VidFind — search public video collections and play publisher-provided MP4s.
// Run: node server.js
// Then open http://localhost:3000

const http = require("http");
const fs = require("fs");
const path = require("path");
const { searchVideos, getVideo } = require("./providers");

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

function sendPage(res, status, query = "", search = { results: [], nextPageToken: null }, error = "") {
  fs.readFile(path.join(__dirname, "index.html"), "utf8", (err, template) => {
    if (err) { res.writeHead(500); return res.end("Unable to load the search page."); }
    const results = search.results.map((video) => {
      const title = decodeMetadata(video.title);
      const channel = decodeMetadata(video.channel);
      const date = new Date(video.published);
      const published = Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString("en-US", {
        year: "numeric", month: "short", day: "numeric",
      });
      const href = "/watch?" + new URLSearchParams({ id: video.id, q: query });
      return `<a class="card" href="${escapeHtml(href)}" data-video-id="${escapeHtml(video.id)}"><img src="${escapeHtml(video.thumbnail)}" alt="" loading="lazy"><h3>${escapeHtml(title)}</h3><div class="meta">${escapeHtml(channel)}${published ? " · " + published : ""}</div><span class="play-label">▶ Play video</span></a>`;
    }).join("");
    const message = error ? "Couldn't search right now: " + error : query
      ? search.results.length ? `${search.results.length} videos for “${query}”`
        : `No direct videos found for “${query}”. Try another topic.`
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

function sendWatchPage(res, status, query, video, error = "") {
  fs.readFile(path.join(__dirname, "watch.html"), "utf8", (err, template) => {
    if (err) { res.writeHead(500); return res.end("Unable to load the video page."); }
    const replacements = {
      TITLE: escapeHtml(video?.title || "Video unavailable"),
      CHANNEL: escapeHtml(video ? [video.channel, video.provider].filter(Boolean).join(" · ") : ""),
      DESCRIPTION: escapeHtml(video?.description || ""),
      POSTER: escapeHtml(video?.thumbnail || ""),
      BACK: escapeHtml(query ? "/?" + new URLSearchParams({ q: query }) : "/"),
      VIDEO_HIDDEN: video ? "" : "hidden",
      ERROR_HIDDEN: error ? "" : "hidden",
      ERROR: escapeHtml(error),
      FILE: escapeHtml(video?.sources[0]?.url || ""),
      SOURCES: (video?.sources || []).map((source) => `<source src="${escapeHtml(source.url)}" type="${escapeHtml(source.type)}">`).join(""),
    };
    const body = template.replace(/__VDF_([A-Z_]+)__/g, (_, name) => replacements[name] ?? "");
    res.writeHead(status, {
      "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer",
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
    try {
      const video = await getVideo(url.searchParams.get("id"));
      return sendWatchPage(res, 200, query, video);
    } catch (err) {
      console.error("Video: " + err.message);
      return sendWatchPage(res, err.status || 502, query, null, err.message);
    }
  }

  // Back end: the search endpoint your page calls
  if (url.pathname === "/api/search") {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return sendJson(res, 400, { error: "Type something to search for." });
    if (q.length > 200) return sendJson(res, 400, { error: "That search is too long." });
    try {
      const out = await searchVideos(q, url.searchParams.get("pageToken"));
      return sendJson(res, 200, out);
    } catch (err) {
      console.error(err.message);
      return sendJson(res, err.status || 502, { error: err.message });
    }
  }

  // Front end: the search page
  if (url.pathname === "/" || url.pathname === "/index.html") {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return sendPage(res, 200);
    if (q.length > 200) return sendPage(res, 400, q, undefined, "That search is too long.");
    try {
      const search = await searchVideos(q, url.searchParams.get("pageToken"));
      return sendPage(res, 200, q, search);
    } catch (err) {
      console.error(err.message);
      return sendPage(res, err.status || 502, q, undefined, err.message);
    }
  }
  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, () => console.log(`VidFind running at http://localhost:${PORT}`));
