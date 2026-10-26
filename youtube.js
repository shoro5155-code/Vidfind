const { allowedMetadata } = require("./providers");
const cache = new Map();
const VALID_ID = /^[a-zA-Z0-9_-]{11}$/;
function problem(message, status = 503) { return Object.assign(new Error(message), { status }); }

async function request(resource, params) {
  const key = process.env.YOUTUBE_API_KEY;
  if (!key) throw problem("YouTube search is not configured. Direct videos are still available.");
  const url = new URL("https://www.googleapis.com/youtube/v3/" + resource);
  url.search = new URLSearchParams({ ...params, key }).toString();
  const cacheKey = resource + ":" + JSON.stringify(params);
  const saved = cache.get(cacheKey);
  if (saved && saved.expires > Date.now()) return saved.value;
  let response, data;
  try {
    response = await fetch(url, { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(12000) });
    data = await response.json();
  } catch (_) { throw problem("YouTube is temporarily unavailable. Please try again or choose Direct videos."); }
  if (!response.ok) {
    const reason = data?.error?.errors?.[0]?.reason;
    if (["quotaExceeded", "dailyLimitExceeded"].includes(reason)) throw problem("YouTube's daily search limit has been reached. Direct videos are still available.");
    if (response.status === 400) throw problem("That YouTube results page is unavailable. Start a new search.", 400);
    throw problem("YouTube search is temporarily unavailable. Direct videos are still available.");
  }
  if (!Array.isArray(data.items)) throw problem("YouTube returned an unreadable response. Please try again.");
  if (cache.size >= 128) cache.delete(cache.keys().next().value);
  cache.set(cacheKey, { value: data, expires: Date.now() + 5 * 60 * 1000 });
  return data;
}

function result(item, id) {
  const snippet = item.snippet;
  if (!VALID_ID.test(id || "") || !snippet || !allowedMetadata({ title: snippet.title, description: snippet.description, keywords: snippet.tags })) return null;
  let thumbnail = "";
  try {
    const image = new URL(snippet.thumbnails?.medium?.url || snippet.thumbnails?.default?.url);
    if (image.protocol === "https:" && ["i.ytimg.com", "img.youtube.com"].includes(image.hostname)) thumbnail = image.href;
  } catch (_) {}
  return {
    id: "youtube:" + id, title: snippet.title || "YouTube video", channel: snippet.channelTitle || "YouTube",
    published: snippet.publishedAt || "", description: snippet.description || "", thumbnail, provider: "YouTube",
    sources: [],
  };
}

async function searchVideos(query, token) {
  if (token && (!/^[a-zA-Z0-9_=-]+$/.test(token) || token.length > 500)) throw problem("That results page has expired. Start a new search.", 400);
  if (!allowedMetadata({ title: query })) return { results: [], nextPageToken: null, notice: "This search is outside the filtered video catalog." };
  const data = await request("search", {
    part: "snippet", type: "video", maxResults: "12", q: query,
    safeSearch: "strict", videoEmbeddable: "true", videoSyndicated: "true",
    ...(token ? { pageToken: token } : {}),
  });
  return { results: data.items.map((item) => result(item, item.id?.videoId)).filter(Boolean), nextPageToken: data.nextPageToken || null, notice: "" };
}

async function getVideo(identifier) {
  const id = typeof identifier === "string" && identifier.startsWith("youtube:") ? identifier.slice(8) : "";
  if (!VALID_ID.test(id)) throw problem("That video could not be found.", 404);
  const data = await request("videos", { part: "snippet,status,contentDetails", id });
  const item = data.items.find((video) => video.id === id);
  const video = item && result(item, id);
  if (!video || item.status?.privacyStatus !== "public" || item.status?.embeddable !== true
    || item.contentDetails?.contentRating?.ytRating === "ytAgeRestricted") throw problem("This video is unavailable for playback here.", 404);
  return { ...video, youtubeId: id };
}

module.exports = { searchVideos, getVideo };
