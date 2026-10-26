const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
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

test("the server returns HTML results and preserves the JSON API", async (t) => {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), "vidfind-test-"));
  const preload = path.join(temporary, "provider.cjs");
  fs.writeFileSync(preload, `
    const http = require('node:http');
    const listen = http.Server.prototype.listen;
    http.Server.prototype.listen = function(...args) {
      this.once('listening', () => console.log('__PORT__' + this.address().port));
      return listen.apply(this, args);
    };
    global.fetch = async input => {
      const url = new URL(input);
      if (url.origin !== 'https://www.googleapis.com') throw Error('Unexpected provider');
      if (url.searchParams.get('key') !== 'local-test-key') throw Error('Missing key');
      if (url.searchParams.get('q') === 'provider-error') return new Response(JSON.stringify({error:{message:'Test provider failure'}}), {status:403});
      return new Response(JSON.stringify({
        nextPageToken: url.searchParams.has('pageToken') ? undefined : 'page-two',
        items:[{id:{videoId:url.searchParams.get('pageToken') || 'video-one'},snippet:{
          title:'A &quot;plane&quot; <script>unsafe</script>', channelTitle:'Crafts &amp; More',
          publishedAt:'2026-10-25T12:00:00Z', description:'Fixture',
          thumbnails:{medium:{url:'https://example.com/test.jpg'}}
        }}]
      }), {status:200});
    };
  `);
  const child = spawn(process.execPath, ["--require", preload, "server.js"], {
    cwd: root, env: { ...process.env, PORT: "0", YOUTUBE_API_KEY: "local-test-key" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  t.after(() => { child.kill(); fs.rmSync(temporary, { recursive: true, force: true }); });
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
  assert.doesNotMatch(page, /local-test-key/);

  response = await fetch(base + "/?q=police");
  page = await response.text();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type"), /text\/html/);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.match(page, /data-server-rendered="true"/);
  assert.match(page, /data-video-id="video-one"/);
  assert.match(page, /<h3>A &quot;plane&quot; &lt;script&gt;unsafe&lt;\/script&gt;<\/h3>/);
  assert.match(page, /Crafts &amp; More/);
  assert.doesNotMatch(page, /<script>unsafe<\/script>/);

  response = await fetch(base + "/?q=" + encodeURIComponent('\"><script>query</script>') + "&pageToken=page-two");
  page = await response.text();
  assert.match(page, /data-video-id="page-two"/);
  assert.match(page, /data-next-token=""/);
  assert.doesNotMatch(page, /<script>query<\/script>/);

  response = await fetch(base + "/api/search?q=police");
  assert.match(response.headers.get("content-type"), /application\/json/);
  assert.equal((await response.json()).results[0].id, "video-one");
  response = await fetch(base + "/api/search?q=");
  assert.equal(response.status, 400);

  response = await fetch(base + "/?q=provider-error");
  assert.equal(response.status, 503);
  assert.match(await response.text(), /Test provider failure/);
  response = await fetch(base + "/?q=" + "x".repeat(201));
  assert.equal(response.status, 400);
});
