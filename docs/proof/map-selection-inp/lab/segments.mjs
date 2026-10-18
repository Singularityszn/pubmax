// Split a cpuprofile into busy segments (long tasks) after __TAP_MARKER__ and show each one's top app frames.
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(`${process.cwd()}/`);
const { SourceMapConsumer } = require("source-map-js");
const [file, distDir, minA] = process.argv.slice(2);
const minMs = Number(minA ?? 50);
const profile = JSON.parse(readFileSync(file, "utf8"));
const consumers = new Map();
function consumerFor(url) {
  if (consumers.has(url)) return consumers.get(url);
  let c = null; const m = url.match(/\/_next\/(static\/.*?\.js)/);
  if (m) { const js = `${distDir}/${m[1]}`; if (existsSync(js)) { const t = readFileSync(js, "utf8").slice(-300).match(/sourceMappingURL=(\S+)/); const f = t ? js.replace(/[^/]+$/, t[1]) : `${js}.map`; if (existsSync(f)) c = new SourceMapConsumer(JSON.parse(readFileSync(f, "utf8"))); } }
  consumers.set(url, c); return c;
}
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const parent = new Map(); for (const n of profile.nodes) for (const ch of n.children || []) parent.set(ch, n.id);
const labels = new Map();
function lab(id) {
  if (labels.has(id)) return labels.get(id);
  const f = byId.get(id).callFrame; let s = f.functionName || "(anon)";
  const c = f.url ? consumerFor(f.url) : null;
  if (c) { const o = c.originalPositionFor({ line: f.lineNumber + 1, column: f.columnNumber }); if (o.source) s = `${o.name || f.functionName || "(anon)"} @ ${o.source.replace(/^.*?\[project\]\//, "").replace(/^.*node_modules\//, "nm/")}:${o.line}`; }
  labels.set(id, s); return s;
}
let start = 0; for (let i = 0; i < profile.samples.length; i++) if (byId.get(profile.samples[i]).callFrame.functionName === "__TAP_MARKER__") { start = i; break; }
const segs = []; let cur = null; let t = 0;
for (let i = start; i < profile.samples.length; i++) {
  if (i > start) t += profile.timeDeltas[i] / 1000;
  const idle = byId.get(profile.samples[i]).callFrame.functionName === "(idle)";
  if (idle) { if (cur && t - cur.last > 4) { segs.push(cur); cur = null; } continue; }
  if (!cur) cur = { start: t, last: t, samples: [] };
  cur.last = t; cur.samples.push([i, (profile.timeDeltas[i + 1] ?? 100) / 1000]);
}
if (cur) segs.push(cur);
for (const s of segs) {
  const dur = s.last - s.start; if (dur < minMs) continue;
  const incl = new Map();
  for (const [i, dt] of s.samples) { const seen = new Set(); let c = profile.samples[i]; while (c) { const l = lab(c); if (!seen.has(l)) { seen.add(l); incl.set(l, (incl.get(l) || 0) + dt); } c = parent.get(c); } }
  const app = [...incl].filter(([k]) => /@ (components|app|lib)\//.test(k)).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const react = ["performSyncWorkOnRoot", "performWorkOnRootViaSchedulerTask", "commitRoot", "renderRootSync", "renderRootConcurrent", "flushPassiveEffects"].map((n) => [n, [...incl].filter(([k]) => k.startsWith(n + " ")).reduce((a, [, v]) => a + v, 0)]).filter(([, v]) => v > 0);
  console.log(`\n== +${s.start.toFixed(0)}ms  ${dur.toFixed(0)}ms   react: ${react.map(([n, v]) => n + "=" + v.toFixed(0)).join(" ")}`);
  for (const [k, v] of app) console.log(`   ${v.toFixed(0).padStart(5)}ms ${k}`);
}
