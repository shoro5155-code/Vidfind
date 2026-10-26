const http = require("node:http");
const listen = http.Server.prototype.listen;
http.Server.prototype.listen = function (...args) {
  this.once("listening", () => console.log("__PORT__" + this.address().port));
  return listen.apply(this, args);
};

function archiveItem(identifier = "video-one", extra = {}) {
  return {
    identifier, title: "A &quot;plane&quot; &amp; More", creator: "Crafts &amp; More",
    date: "2026-10-25T12:00:00Z", description: "<p>A public video.</p>",
    mediatype: "movies", collection: ["prelinger"], format: ["h.264"], ...extra,
  };
}
function nasaItem() {
  return {
    data: [{ nasa_id: "earth-one", title: "Earth from orbit", media_type: "video", center: "GSFC", date_created: "2025-04-22T00:00:00Z", description: "Our planet." }],
    links: [{ href: "http://images-assets.nasa.gov/video/earth-one/poster.jpg", render: "image", rel: "preview" }],
  };
}
global.fetch = async (input, options) => {
  const url = new URL(input);
  if (!options.headers["User-Agent"].includes("VidFind/")) throw Error("Missing publisher User-Agent");
  if (url.origin === "https://archive.org" && url.pathname === "/advancedsearch.php") {
    const q = url.searchParams.get("q");
    if (!q.includes("mediatype:movies AND (collection:prelinger OR collection:FedFlix")) throw Error("Missing catalog restriction");
    if (q.includes('"provider"') || q.includes('"partial"')) return new Response("Unavailable", { status: 503 });
    const second = url.searchParams.get("page") === "2";
    return Response.json({ response: { numFound: second ? 13 : 30, docs: [
      archiveItem(second ? "video-two" : "video-one"),
      archiveItem("flagged", { nsfw: true }),
      archiveItem("age-rated", { content_rating: "18+" }),
      archiveItem("encoded-flag", { title: "N&#117;dity collection" }),
      archiveItem("outside", { collection: ["opensource_movies"] }),
      archiveItem("old-format", { format: ["MPEG2"] }),
    ] } });
  }
  if (url.origin === "https://archive.org" && url.pathname.startsWith("/metadata/")) {
    const id = decodeURIComponent(url.pathname.slice("/metadata/".length));
    const metadata = archiveItem(id);
    if (id === "outside") metadata.collection = ["opensource_movies"];
    if (id === "flagged") metadata.is_sensitive = "true";
    if (id === "age-rated") metadata.content_rating = "18+";
    if (id === "restricted") metadata["access-restricted-item"] = true;
    const files = [
      { name: "video.mp4", format: "h.264", size: "500000000" },
      { name: "video_512kb.mp4", format: "512Kb MPEG4", size: "20000000" },
      { name: "private.mp4", format: "h.264", private: "true", size: "100" },
      { name: "../bad.mp4", format: "h.264", size: "100" },
      { name: "original.mov", format: "QuickTime", size: "100" },
    ];
    if (id === "private-only") files.splice(0, files.length, { name: "private.mp4", format: "h.264", private: true });
    return Response.json({ metadata, files });
  }
  if (url.origin === "https://images-api.nasa.gov" && url.pathname === "/search") {
    if (url.searchParams.get("media_type") !== "video") throw Error("Not restricted to video");
    if (url.searchParams.get("q") === "provider-error") return new Response("Unavailable", { status: 503 });
    const key = url.searchParams.get("nasa_id");
    return Response.json({ collection: {
      items: key && key !== "earth-one" ? [] : [nasaItem()],
      links: [], metadata: { total_hits: 1 },
    } });
  }
  if (url.origin === "https://images-api.nasa.gov" && url.pathname === "/asset/earth-one") {
    return Response.json({ collection: { items: [
      { href: "http://images-assets.nasa.gov/video/earth-one/earth-one~mobile.mp4" },
      { href: "http://images-assets.nasa.gov/video/earth-one/earth-one~medium.mp4" },
      { href: "https://evil.example/video.mp4" },
      { href: "http://images-assets.nasa.gov/video/earth-one/original.mov" },
    ] } });
  }
  throw Error("Unexpected publisher request: " + url.origin + url.pathname);
};
