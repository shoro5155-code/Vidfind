// Public publisher APIs only. Video bytes go directly from the publisher to the
// browser; this app does not extract, rehost, or proxy videos from other sites.
const COLLECTIONS = {
  prelinger: "Prelinger Archives",
  FedFlix: "FedFlix",
  computerchronicles: "Computer Chronicles",
  netcafe: "Net Café",
  nasa: "NASA Archive",
  tedtalks: "TED Talks",
  academic_films: "Academic Films",
};
const ARCHIVE_ROWS = 12;
const NASA_ROWS = 6;
const cache = new Map();
const coolingDown = new Map();
const HEADERS = {
  Accept: "application/json",
  "User-Agent": "VidFind/2.0 (https://github.com/shoro5155-code/Vidfind)",
};

function text(value) {
  return (Array.isArray(value) ? value.join(" · ") : String(value ?? ""))
    .replace(/<[^>]*>/g, " ")
    .replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos|nbsp);/gi, (match, entity) => {
      const named = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
      if (entity[0] !== "#") return named[entity.toLowerCase()];
      const number = entity[1].toLowerCase() === "x" ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : match;
    }).replace(/\s+/g, " ").trim();
}

// Conservative metadata filtering supplements the publisher/collection allowlist.
// There is no unrestricted Archive search or user-configurable off switch.
const EXPLICIT = /\b(?:porn(?:ography|ographic)?|xxx|nsfw|erotic(?:a)?|nud(?:e|es|ity|ist|ists)|sexual(?:ly)?|sex|fetish(?:es)?|hentai|hardcore|softcore|striptease|playboy|penthouse)\b/i;
function flagged(value) { return value === true || value === 1 || /^(?:true|yes|1)$/i.test(String(value ?? "")); }
function allowed(metadata) {
  const rating = text([metadata.content_rating, metadata.age_rating].flat());
  return !["mature_content", "is_sensitive", "sensitive", "nsfw", "is_adult", "adult", "access-restricted-item", "is_dark"]
    .some((key) => flagged(metadata[key]))
    && !/(?:\badult\b|\bmature\b|\bexplicit\b|\b(?:nc[- ]?17|tv[- ]?ma)\b|18\s*\+)/i.test(rating)
    && !EXPLICIT.test(text([
      metadata.identifier, metadata.title, metadata.description, metadata.subject,
      metadata.keywords, metadata.collection, metadata.content_rating,
    ].flat()));
}
function unavailable(message, status = 503) {
  return Object.assign(new Error(message), { status });
}

async function json(url) {
  const key = String(url);
  const saved = cache.get(key);
  if (saved && saved.expires > Date.now()) return saved.value;
  if (saved) cache.delete(key);
  const origin = new URL(url).origin;
  if ((coolingDown.get(origin) || 0) > Date.now()) throw unavailable("The video publisher is busy. Please try again shortly.");
  let response;
  try {
    response = await fetch(url, { headers: HEADERS, signal: AbortSignal.timeout(12000), redirect: "error" });
  } catch (_) { throw unavailable("The video publisher is temporarily unavailable. Please try again."); }
  if (response.status === 429) {
    const retry = response.headers.get("retry-after");
    const delay = /^\d+$/.test(retry || "") ? Number(retry) * 1000 : Date.parse(retry) - Date.now();
    coolingDown.set(origin, Date.now() + Math.max(30000, Math.min(Number.isFinite(delay) ? delay : 60000, 3600000)));
  }
  if (!response.ok) throw unavailable("The video publisher is temporarily unavailable. Please try again.");
  let value;
  try { value = await response.json(); }
  catch (_) { throw unavailable("The video publisher returned an unreadable response. Please try again."); }
  if (cache.size >= 256) cache.delete(cache.keys().next().value);
  cache.set(key, { value, expires: Date.now() + 5 * 60 * 1000 });
  return value;
}

function archiveCollection(metadata) {
  const collections = Array.isArray(metadata.collection) ? metadata.collection : [metadata.collection];
  return collections.find((collection) => Object.hasOwn(COLLECTIONS, collection));
}
function archiveId(id) { return /^[a-z0-9][a-z0-9._-]{0,199}$/i.test(id); }
function archiveResult(item) {
  const collection = archiveCollection(item);
  if (!collection || !archiveId(item.identifier || "") || !allowed(item)) return null;
  return {
    id: "archive:" + item.identifier,
    title: text(item.title) || "Untitled video",
    channel: text(item.creator) || COLLECTIONS[collection],
    published: item.date || "",
    description: text(item.description),
    thumbnail: `https://archive.org/services/img/${encodeURIComponent(item.identifier)}`,
    provider: "Internet Archive",
  };
}

// NASA occasionally returns http links in manifests. Upgrade only its known
// asset host; never accept arbitrary publisher-supplied URLs or credentials.
function nasaAsset(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.hostname !== "images-assets.nasa.gov" || url.port || url.username || url.password) return null;
    url.protocol = "https:";
    return url.href;
  } catch (_) { return null; }
}
function nasaResult(item) {
  const data = item.data?.[0];
  if (!data || data.media_type !== "video" || !data.nasa_id || !allowed(data)) return null;
  const thumbnail = (item.links || []).find((link) => link.render === "image" && link.rel === "preview")
    || (item.links || []).find((link) => link.render === "image");
  return {
    id: "nasa:" + data.nasa_id,
    title: text(data.title) || "NASA video",
    channel: "NASA" + (data.center ? " / " + text(data.center) : ""),
    published: data.date_created || "",
    description: text(data.description),
    thumbnail: nasaAsset(thumbnail?.href) || "",
    provider: "NASA",
  };
}

async function searchArchive(query, page) {
  const url = new URL("https://archive.org/advancedsearch.php");
  // Treat each user term literally; boolean/field syntax cannot widen the
  // collection restriction. The metadata allowlist is also checked afterwards.
  const terms = query.match(/[\p{L}\p{N}]+/gu) || [];
  if (!terms.length) return { results: [], next: null };
  const scope = Object.keys(COLLECTIONS).map((collection) => `collection:${collection}`).join(" OR ");
  url.search = new URLSearchParams({
    q: `mediatype:movies AND (${scope}) AND (${terms.map((term) => '"' + term + '"').join(" AND ")})`,
    rows: String(ARCHIVE_ROWS), page: String(page), output: "json",
  }).toString();
  for (const field of ["identifier", "title", "creator", "date", "description", "subject", "collection", "format", "mature_content", "access-restricted-item", "content_rating", "age_rating", "is_sensitive", "sensitive", "nsfw", "is_adult", "adult", "is_dark"]) url.searchParams.append("fl[]", field);
  const data = await json(url);
  if (!Array.isArray(data.response?.docs) || !Number.isFinite(data.response.numFound)) throw unavailable("The archive search is temporarily unavailable.");
  return {
    results: data.response.docs.filter((item) => (Array.isArray(item.format) ? item.format : [item.format])
      .some((format) => /(?:MPEG4|h\.264)/i.test(format || ""))).map(archiveResult).filter(Boolean),
    next: page * ARCHIVE_ROWS < Math.min(data.response.numFound, 9996) ? page + 1 : null,
  };
}

async function searchNasa(query, page) {
  const url = new URL("https://images-api.nasa.gov/search");
  url.search = new URLSearchParams({ q: query, media_type: "video", page_size: String(NASA_ROWS), page: String(page) }).toString();
  const data = await json(url);
  if (!Array.isArray(data.collection?.items)) throw unavailable("NASA search is temporarily unavailable.");
  return {
    results: data.collection.items.map(nasaResult).filter(Boolean),
    next: data.collection.links?.some((link) => link.rel === "next") ? page + 1 : null,
  };
}

function pages(token) {
  if (!token) return { archive: 1, nasa: 1 };
  try {
    if (token.length > 200) throw Error();
    const parsed = JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
    if (!parsed || Array.isArray(parsed) || Object.keys(parsed).some((key) => !["archive", "nasa"].includes(key))
      || !Object.keys(parsed).length || Object.values(parsed).some((value) => !Number.isInteger(value) || value < 1 || value > 833)) throw Error();
    return parsed;
  } catch (_) { throw unavailable("That results page has expired. Start a new search.", 400); }
}

async function searchVideos(query, token) {
  const page = pages(token);
  if (EXPLICIT.test(text(query))) return { results: [], nextPageToken: null, notice: "This search is outside the filtered video catalog." };
  const sources = Object.entries(page);
  const responses = await Promise.allSettled(sources.map(([source, number]) =>
    source === "archive" ? searchArchive(query, number) : searchNasa(query, number)));
  const results = [], next = {}, failures = [];
  responses.forEach((response, index) => {
    const source = sources[index][0];
    if (response.status === "fulfilled") {
      results.push(...response.value.results);
      if (response.value.next) next[source] = response.value.next;
    } else {
      console.error(`${source} search: ${response.reason.message}`);
      failures.push(source === "archive" ? "Internet Archive" : "NASA");
    }
  });
  if (failures.length === sources.length) throw unavailable("Video search is temporarily unavailable. Please try again shortly.");
  return {
    results,
    nextPageToken: Object.keys(next).length ? Buffer.from(JSON.stringify(next)).toString("base64url") : null,
    notice: failures.length ? `${failures.join(" and ")} is temporarily unavailable. Showing other available results.` : "",
  };
}

async function getVideo(id) {
  if (typeof id !== "string" || id.length > 250) throw unavailable("That video could not be found.", 404);
  const separator = id.indexOf(":");
  const provider = id.slice(0, separator), key = id.slice(separator + 1);
  if (provider === "archive" && archiveId(key)) {
    const data = await json(`https://archive.org/metadata/${encodeURIComponent(key)}`);
    const metadata = data.metadata;
    if (!metadata || metadata.mediatype !== "movies" || !allowed(metadata)) throw unavailable("This video is not available in the filtered catalog.", 404);
    const result = archiveResult({ ...metadata, identifier: key });
    if (!result) throw unavailable("This video is not available in the filtered catalog.", 404);
    const files = (data.files || []).filter((file) => typeof file.name === "string" && /\.mp4$/i.test(file.name)
      && !flagged(file.private) && /(?:MPEG4|h\.264)/i.test(file.format || "")
      && !file.name.split("/").some((part) => part === ".." || part === ".")
      && !EXPLICIT.test(text(file.name)));
    // Prefer a streaming derivative over a very large camera/source file.
    files.sort((a, b) => Number(a.size || Infinity) - Number(b.size || Infinity));
    const sources = files.slice(0, 3).map((file) => ({
      url: `https://archive.org/download/${encodeURIComponent(key)}/${file.name.split("/").map(encodeURIComponent).join("/")}`,
      type: "video/mp4",
    }));
    if (!sources.length) throw unavailable("This video has no public MP4 file available.", 404);
    return { ...result, sources };
  }
  if (provider === "nasa" && key && !/[\x00-\x1f/\\]/.test(key)) {
    const searchUrl = new URL("https://images-api.nasa.gov/search");
    searchUrl.search = new URLSearchParams({ nasa_id: key, media_type: "video" }).toString();
    const data = await json(searchUrl);
    const item = data.collection?.items?.find((entry) => entry.data?.[0]?.nasa_id === key);
    const result = item && nasaResult(item);
    if (!result) throw unavailable("This video is not available in the filtered catalog.", 404);
    const manifest = await json(`https://images-api.nasa.gov/asset/${encodeURIComponent(key)}`);
    const urls = (manifest.collection?.items || []).map((entry) => nasaAsset(entry.href)).filter((url) => url && /\.mp4$/i.test(new URL(url).pathname));
    const preference = (url) => /~medium\.mp4$/i.test(url) ? 0 : /~small\.mp4$/i.test(url) ? 1 : /~mobile\.mp4$/i.test(url) ? 2 : /~preview\.mp4$/i.test(url) ? 4 : 3;
    urls.sort((a, b) => preference(a) - preference(b));
    if (!urls.length) throw unavailable("This video has no public MP4 file available.", 404);
    return { ...result, sources: [...new Set(urls)].slice(0, 3).map((url) => ({ url, type: "video/mp4" })) };
  }
  throw unavailable("That video could not be found.", 404);
}

module.exports = { searchVideos, getVideo, allowedMetadata: allowed };
