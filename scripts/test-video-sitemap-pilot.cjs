"use strict";
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");

const root = path.resolve(__dirname, "..");
const modules = new Map();
let readPilot, backend, localDetail;
function load(file) {
  if (modules.has(file)) return modules.get(file).exports;
  const mod = { exports: {} };
  modules.set(file, mod);
  const code = ts.transpileModule(fs.readFileSync(path.join(root, file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function("require", "module", "exports", code)(name => {
    if (file.endsWith("/route.ts") && name.endsWith("/video-sitemap-pilot-source")) return { readVideoSitemapPilot: () => readPilot() };
    if (name === "./public-video-production") return { productionPublicBackend: options => backend(options) };
    if (name === "./public-video-server") return { readPublicDetailCore: id => localDetail(id) };
    return name.startsWith(".") ? load(path.posix.join(path.posix.dirname(file), name) + ".ts") : require(name);
  }, mod, mod.exports);
  return mod.exports;
}

async function main() {
  const { renderVideoSitemap, PILOT_VIDEO_IDS } = load("lib/video-sitemap-pilot.ts");
  const { videoMetadata, blankCatalog } = load("lib/public-video-core.ts");
  const { readVideoSitemapPilot } = load("lib/video-sitemap-pilot-source.ts");
  const { GET } = load("app/sitemap-video-pilot.xml/route.ts");
  const rows = PILOT_VIDEO_IDS.map(id => ({
    id, authorId: "11", handle: "fixture", text: "見本 & <test> 😺", sourceHash: "a".repeat(64),
    eligible: true, createdAt: "2026-11-07T12:00:00Z", posterUrl: "https://pbs.twimg.com/sample.jpg?a=1&b=2",
    videoUrl: "https://video.twimg.com/sample.mp4?tag=12",
  }));
  const entries = rows.map(video => ({ video, metadata: videoMetadata(video, null), labels: [] }));
  assert(entries.every(entry => entry.metadata.index));
  const output = renderVideoSitemap(entries);
  assert.equal((output.match(/<video:video>/g) ?? []).length, 5);
  assert(output.includes("<video:family_friendly>no</video:family_friendly>"));
  assert(output.includes("a=1&amp;b=2"));
  assert(output.includes("&amp; &lt;test&gt; 😺"));
  assert(output.includes("<video:publication_date>2026-11-07T12:00:00.000Z</video:publication_date>"));
  const [first, second, third, fourth, fifth] = entries;
  assert.equal(renderVideoSitemap([
    null,
    { ...first, video: { ...first.video, eligible: false } },
    { ...second, metadata: { ...second.metadata, index: false } },
    { ...third, video: { ...third.video, videoUrl: "https://video.twimg.com/sample.mp4?token=expires" } },
    { ...fourth, video: { ...fourth.video, posterUrl: "https://elsewhere.example/sample.jpg" } },
    { ...fifth, metadata: { ...fifth.metadata, canonical: fifth.metadata.canonical + "?from=/" } },
  ]), null);
  const calls = [];
  backend = options => {
    assert.deepEqual(options, { readOnlyRender: true });
    return {
      service: { inspect: async ids => { calls.push(["posts", ids]); return rows.slice(1); } },
      catalog: { readForIds: async ids => { calls.push(["catalog", ids]); return blankCatalog(); } },
    };
  };
  localDetail = async id => {
    calls.push(["detail", id]);
    return id === PILOT_VIDEO_IDS[0] ? null : entries.find(entry => entry.video.id === id);
  };
  readPilot = readVideoSitemapPilot;
  const live = await GET();
  assert.equal(live.status, 200);
  assert.equal(live.headers.get("content-type"), "application/xml; charset=utf-8");
  assert.equal(live.headers.get("cache-control"), "no-store");
  const remaining = await live.text();
  assert.equal((remaining.match(/<video:video>/g) ?? []).length, 4);
  assert(!remaining.includes(PILOT_VIDEO_IDS[0]));
  if (calls[0]?.[0] === "posts") {
    assert.deepEqual(calls, [["posts", [...PILOT_VIDEO_IDS]], ["catalog", [...PILOT_VIDEO_IDS]]]);
  } else {
    assert.deepEqual(calls, PILOT_VIDEO_IDS.map(id => ["detail", id]));
  }
  readPilot = async () => [];
  assert.equal((await GET()).status, 404);
  readPilot = async () => { throw Error("fixture outage"); };
  const failed = await GET();
  assert.equal(failed.status, 503);
  assert.equal(failed.headers.get("retry-after"), "60");
  assert.equal(await failed.text(), "");
  console.log("PASS video sitemap pilot: bounded read, publication checks, XML escaping and temporary failure");
}
main().catch(error => { console.error(error); process.exitCode = 1; });
