const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawn } = require("node:child_process");

const root = path.resolve(__dirname, "..");
const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];

function client(fetchImpl, { search = "", rendered = false, token = "" } = {}) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      hidden: false, textContent: "", innerHTML: "", value: "", children: [],
      addEventListener() {}, focus() {},
      requestSubmit() { throw Error("A server-rendered search must not resubmit"); },
    });
    return elements.get(id);
  };
  const redirects = [];
  let requests = 0;
  const context = vm.createContext({
    URL, URLSearchParams, console,
    location: { search, href: "https://vidfind.example/" + search, assign(url) { redirects.push(url); } },
    history: { replaceState() {} },
    document: {
      body: { dataset: { serverRendered: String(rendered), nextToken: token }, classList: { add() {} } },
      getElementById: element, querySelectorAll() { return []; }, addEventListener() {},
    },
    fetch: async (...args) => { requests++; return fetchImpl(...args); },
  });
  vm.runInContext(script, context);
  return { context, element, redirects, get requests() { return requests; } };
}

test("an HTML response opens a normal results page instead of showing a JSON parser error", async () => {
  const app = client(async (url, options) => {
    assert.equal(url, "https://vidfind.example/api/search?q=police");
    assert.equal(options.headers.Accept, "application/json");
    assert.equal(options.cache, "no-store");
    return { ok: true, text: async () => "<!doctype html><h1>Starting service</h1>" };
  });
  await app.context.runSearch("police", false);
  assert.deepEqual(app.redirects, ["https://vidfind.example/?q=police"]);
  assert.equal(app.element("status").textContent, "Opening search results…");
  assert.equal(app.element("more").hidden, true);
});

test("an empty response preserves the requested next page in the fallback", async () => {
  const app = client(async () => ({ ok: false, text: async () => "" }), { token: "next-page" });
  await app.context.runSearch("paper & planes", true);
  const redirect = new URL(app.redirects[0]);
  assert.equal(redirect.searchParams.get("q"), "paper & planes");
  assert.equal(redirect.searchParams.get("pageToken"), "next-page");
});

test("a failed background request can use the normal page", async () => {
  const app = client(async () => { throw new TypeError("Load failed"); });
  await app.context.runSearch("police", false);
  assert.equal(app.redirects.length, 1);
});

test("a readable API error is displayed without another provider request", async () => {
  const app = client(async () => ({ ok: false, text: async () => JSON.stringify({ error: "Search quota reached" }) }));
  await app.context.runSearch("police", false);
  assert.equal(app.element("status").textContent, "Couldn't search right now: Search quota reached");
  assert.equal(app.element("more").hidden, true);
  assert.deepEqual(app.redirects, []);
});

test("a server-rendered page does not repeat its search in the browser", () => {
  const app = client(async () => { throw Error("Unexpected API request"); }, { search: "?q=police", rendered: true });
  assert.equal(app.requests, 0);
  assert.match(html, /\[hidden\]\s*\{\s*display:\s*none\s*!important/);
});

test("the server searches filtered publishers and returns native video pages", async (t) => {
  const preload = path.join(__dirname, "fixtures", "providers.cjs");
  const child = spawn(process.execPath, ["--require", preload, "server.js"], {
    cwd: root, env: { ...process.env, PORT: "0", YOUTUBE_API_KEY: "" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => child.kill());
  const port = await new Promise((resolve, reject) => {
    let output = "";
    const timeout = setTimeout(() => reject(Error("Server startup timed out")), 5000);
    child.stdout.on("data", (bytes) => {
      output += bytes;
      const match = output.match(/__PORT__(\d+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
    child.once("error", (err) => { clearTimeout(timeout); reject(err); });
    child.once("exit", (code) => { if (code) { clearTimeout(timeout); reject(Error("Server exited " + code)); } });
  });
  const base = "http://127.0.0.1:" + port;

  let response = await fetch(base + "/");
  let page = await response.text();
  assert.equal(response.status, 200);
  assert.match(page, /<main id="main" hidden>/);
  assert.doesNotMatch(page, /__VDF_[A-Z_]+__/);
  assert.doesNotMatch(page, /youtube|<iframe/i);

  response = await fetch(base + "/?q=planes");
  page = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(page, /data-server-rendered="true"/);
  assert.match(page, /data-video-id="archive:video-one"/);
  assert.match(page, /<h3>A &quot;plane&quot; &amp; More<\/h3>/);
  assert.match(page, /href="\/watch\?id=archive%3Avideo-one&amp;q=planes"/);
  assert.doesNotMatch(page, /data-video-id="archive:(?:flagged|age-rated|encoded-flag|outside|old-format)"/);

  response = await fetch(base + "/api/search?q=planes");
  assert.match(response.headers.get("content-type"), /application\/json/);
  const results = await response.json();
  assert.deepEqual(results.results.map((v) => v.id), ["archive:video-one", "nasa:earth-one"]);
  assert.deepEqual(JSON.parse(Buffer.from(results.nextPageToken, "base64url")), { archive: 2 });
  response = await fetch(base + "/api/search?q=planes&pageToken=" + results.nextPageToken);
  const second = await response.json();
  assert.deepEqual(second.results.map((v) => v.id), ["archive:video-two"]);
  assert.equal(second.nextPageToken, null);

  response = await fetch(base + "/?q=" + encodeURIComponent('\"><script>query</script>'));
  page = await response.text();
  assert.equal(response.status, 200);
  assert.doesNotMatch(page, /<script>query<\/script>/);

  response = await fetch(base + "/watch?id=archive%3Avideo-one&q=planes");
  page = await response.text();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.match(page, /<video[^>]*controls autoplay playsinline/);
  assert.match(page, /<source src="https:\/\/archive.org\/download\/video-one\/video_512kb.mp4" type="video\/mp4">/);
  assert.match(page, /href="\/\?q=planes"/);
  assert.doesNotMatch(page, /private.mp4|original.mov|bad.mp4|youtube|<iframe|__VDF_[A-Z_]+__/i);

  response = await fetch(base + "/watch?id=nasa%3Aearth-one");
  page = await response.text();
  assert.equal(response.status, 200);
  assert.match(page, /<source src="https:\/\/images-assets.nasa.gov\/video\/earth-one\/earth-one~medium.mp4"/);
  assert.doesNotMatch(page, /evil.example|original.mov|src="http:/);

  for (const id of ["outside", "flagged", "age-rated", "restricted", "private-only"]) {
    response = await fetch(base + "/watch?id=archive:" + id);
    assert.equal(response.status, 404, id);
    assert.doesNotMatch(await response.text(), /<source src=/);
  }
  response = await fetch(base + "/watch?id=" + encodeURIComponent("https://example.com/video.mp4"));
  assert.equal(response.status, 404);

  response = await fetch(base + "/api/search?q=nsfw");
  const blocked = await response.json();
  assert.deepEqual(blocked.results, []);
  assert.match(blocked.notice, /filtered video catalog/);
  response = await fetch(base + "/api/search?q=partial");
  const partial = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(partial.results.map((v) => v.id), ["nasa:earth-one"]);
  assert.match(partial.notice, /Internet Archive is temporarily unavailable/);

  response = await fetch(base + "/api/search?q=");
  assert.equal(response.status, 400);
  response = await fetch(base + "/?q=provider-error");
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Video search is temporarily unavailable/);
  response = await fetch(base + "/api/search?q=planes&pageToken=invalid");
  assert.equal(response.status, 400);
  response = await fetch(base + "/?q=" + "x".repeat(201));
  assert.equal(response.status, 400);
});

test("an older background search cannot overwrite a newer search", async () => {
  let finishFirst;
  const first = new Promise((resolve) => { finishFirst = resolve; });
  const app = client(async (url) => url.includes("q=first") ? first : {
    ok: true, text: async () => JSON.stringify({ results: [], nextPageToken: null }),
  });
  const old = app.context.runSearch("first", false);
  await app.context.runSearch("second", false);
  finishFirst({ ok: true, text: async () => "unreadable" });
  await old;
  assert.deepEqual(app.redirects, []);
  assert.match(app.element("status").textContent, /second/);
});
