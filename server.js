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
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
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
    return fs.readFile(path.join(__dirname, "index.html"), (err, body) => {
      if (err) { res.writeHead(500); return res.end("index.html is missing"); }
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
      res.end(body);
    });
  }
  res.writeHead(404); res.end("Not found");
});

server.listen(PORT, () => console.log(`VidFind running at http://localhost:${PORT}`));
