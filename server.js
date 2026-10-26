// VidFind — a tiny video search website.
// The browser talks only to this server. This server talks to the YouTube Data API
// behind the scenes, so visitors never leave your site.
//
// Run:  YOUTUBE_API_KEY=your_key_here node server.js
// Then open http://localhost:3000

const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.YOUTUBE_API_KEY;
// Safe search level: "none" (off), "moderate", or "strict". Off unless you set SAFE_SEARCH.
const SAFE_SEARCH = ["none", "moderate", "strict"].includes(process.env.SAFE_SEARCH) ? process.env.SAFE_SEARCH : "none";

if (!API_KEY) {
  console.error("Missing YOUTUBE_API_KEY. See README.md for how to get one.");
  process.exit(1);
}


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
      return `<button class="card" type="button" data-video-id="${escapeHtml(video.id)}" data-video-title="${escapeHtml(title)}"><img src="${escapeHtml(video.thumbnail)}" alt="" loading="lazy"><h3>${escapeHtml(title)}</h3><div class="meta">${escapeHtml(channel)}${published ? " · " + published : ""}</div></button>`;
    }).join("");
    const message = error ? "Couldn't search right now: " + error : query
      ? search.results.length ? `${search.results.length} videos for “${query}”`
        : `No videos found for “${query}”. Try different words.`
      : "";
    const replacements = {
      BODY_CLASS: query ? "searched" : "",
      RENDERED: query ? "true" : "false",
      NEXT_TOKEN: escapeHtml(search.nextPageToken),
      QUERY: escapeHtml(query),
      MAIN_HIDDEN: query ? "" : "hidden",
      STATUS: escapeHtml(message),
      RESULTS: results,
      MORE_HIDDEN: search.nextPageToken && search.results.length ? "" : "hidden",
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

async function searchVideos(query, pageToken) {
  const url = new URL("https://www.googleapis.com/youtube/v3/search");
  url.search = new URLSearchParams({
    part: "snippet",
    type: "video",
    maxResults: "12",
    safeSearch: SAFE_SEARCH,
    q: query,
    key: API_KEY,
    ...(pageToken ? { pageToken } : {}),
  }).toString();

  const r = await fetch(url);
  const data = await r.json();
  if (!r.ok) {
    const msg = data?.error?.message || "Search provider returned an error.";
    throw Object.assign(new Error(msg), { status: r.status });
  }

  return {
    nextPageToken: data.nextPageToken || null,
    results: (data.items || []).map((item) => ({
      id: item.id.videoId,
      title: item.snippet.title,
      channel: item.snippet.channelTitle,
      published: item.snippet.publishedAt,
      description: item.snippet.description,
      thumbnail: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url,
    })),
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

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
      return sendJson(res, err.status === 403 ? 503 : 502, { error: err.message });
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
      return sendPage(res, err.status === 403 ? 503 : 502, q, undefined, err.message);
    }
  }
  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, () => console.log(`VidFind running at http://localhost:${PORT}`));
