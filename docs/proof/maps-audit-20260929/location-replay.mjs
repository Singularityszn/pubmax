import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { stripTypeScriptTypes } from "node:module";
import { runInNewContext } from "node:vm";

const asModule = (source) => `data:text/javascript;base64,${Buffer.from(stripTypeScriptTypes(source)).toString("base64")}`;
const revision = process.argv[2];
const readSource = (path) => revision
  ? execFileSync("git", ["show", `${revision}:${path}`], { encoding: "utf8" })
  : readFileSync(path, "utf8");
const storageModule = asModule(readSource("lib/safeStorage.ts"));
const source = readSource("lib/mapOpeningLocation.ts")
  .replace("@/lib/safeStorage", storageModule);
const { readMapOpeningLocation, readOpeningMapLocation } = await import(asModule(source));
const key = "pubmax:map-opening-location:v1";
const now = Date.now();
const results = [];

for (const [name, value] of [
  ["undated remembered fix", { lat: 51.7, lng: 0.2 }],
  ["yesterday's remembered fix", { lat: 51.7, lng: 0.2, savedAt: now - 86_400_000 }],
  ["future remembered fix", { lat: 51.7, lng: 0.2, savedAt: now + 60_000 }],
]) {
  const values = new Map([[key, JSON.stringify(value)]]);
  const store = { getItem: (entry) => values.get(entry) ?? null, removeItem: (entry) => values.delete(entry) };
  const actual = readMapOpeningLocation(store);
  results.push({ name, passed: actual === null && !values.has(key), actual });
}

for (const [name, permissions] of [
  ["missing permission query", undefined],
  ["failed permission query", { query: async () => { throw new Error("unsupported"); } }],
  ["malformed permission result", { query: async () => null }],
]) {
  let calls = 0;
  const actual = await readOpeningMapLocation({
    permissions,
    geolocation: { getCurrentPosition: (success) => {
      calls += 1;
      success({ coords: { latitude: 51.5, longitude: -0.1 } });
    } },
  });
  results.push({ name, passed: calls === 0 && actual === null, calls, actual });
}

const requests = [];
const values = new Map([
  ["pubmax:first-pins-seen:v1", "1"],
  [key, JSON.stringify({ lat: 51.7, lng: 0.2, savedAt: now - 86_400_000 })],
]);
const bootWindow = {
  innerWidth: 390,
  innerHeight: 844,
  location: { href: "https://pubmaxxing.com/map" },
  localStorage: { getItem: (entry) => values.get(entry) ?? null, removeItem: (entry) => values.delete(entry) },
};
const bootScript = readSource("public/map-first-paint-init.js");
const bootContext = {
  window: bootWindow,
  document: { currentScript: { src: "https://pubmaxxing.com/map-first-paint-init.js?v=deploy-42" } },
  navigator: {},
  URL,
  Date,
  fetch: async (path) => {
    requests.push(path);
    return { ok: true, json: async () => path.includes("manifest") ? {
      revision: "deploy-42",
      shards: [
        { url: "/data/london.json", bbox: [-0.3, 51.3, -0.1, 51.6] },
        { url: "/data/old-fix.json", bbox: [0.1, 51.69, 0.4, 51.75] },
      ],
    } : { revision: "deploy-42", rows: [] } };
  },
};
runInNewContext(bootScript, bootContext);
await new Promise((resolve) => setImmediate(resolve));
results.push({
  name: "boot warm ignores yesterday's fix",
  passed: requests.includes("/data/london.json?v=deploy-42") && !requests.includes("/data/old-fix.json?v=deploy-42") && !values.has(key),
  requests: [...requests],
});
requests.length = 0;
values.set(key, JSON.stringify({ lat: 53.48, lng: -2.24, savedAt: now }));
runInNewContext(bootScript, bootContext);
await new Promise((resolve) => setImmediate(resolve));
results.push({
  name: "London warm preserves fresh Manchester hint",
  passed: requests.includes("/data/london.json?v=deploy-42") && values.has(key),
  requests: [...requests],
});
console.log(JSON.stringify({ results }, null, 2));
process.exitCode = results.every((result) => result.passed) ? 0 : 1;
