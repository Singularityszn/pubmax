// usage: node analyze.mjs <cpuprofile> <distDir> <fromMs> <toMs>   (ms after __TAP_MARKER__)
import { readFileSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(`${process.cwd()}/`);
const { SourceMapConsumer } = require("source-map-js");
const [file, distDir, fromA, toA] = process.argv.slice(2);
const from = Number(fromA), to = Number(toA);
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
let t = 0; const incl = new Map(), file2 = new Map(), comp = new Map(); let total = 0;
for (let i = start; i < profile.samples.length; i++) {
  if (i > start) t += profile.timeDeltas[i] / 1000;
  if (t < from || t > to) continue;
  const dt = (profile.timeDeltas[i + 1] ?? 100) / 1000; total += dt;
  const seen = new Set(), seenF = new Set(); let cur = profile.samples[i];
  while (cur) { const l = lab(cur); if (!seen.has(l)) { seen.add(l); incl.set(l, (incl.get(l) || 0) + dt); }
    const fm = l.match(/@ ((components|app|lib)\/[^:]+)/); if (fm && !seenF.has(fm[1])) { seenF.add(fm[1]); file2.set(fm[1], (file2.get(fm[1]) || 0) + dt); }
    // React component functions: capitalised names in app files
    const cm = l.match(/^([A-Z][A-Za-z0-9]+) @ ((components|app)\/[^:]+)/); if (cm && !seen.has("C:" + cm[1])) { seen.add("C:" + cm[1]); comp.set(cm[1] + " (" + cm[2] + ")", (comp.get(cm[1] + " (" + cm[2] + ")") || 0) + dt); }
    cur = parent.get(cur); }
}
const top = (m, n) => [...m].sort((a, c) => c[1] - a[1]).slice(0, n).map(([k, v]) => `${v.toFixed(0).padStart(6)}ms ${k}`).join("\n");
console.log(`window ${from}-${to}ms, sampled ${total.toFixed(0)}ms`);
console.log("--- components (inclusive)\n" + top(comp, 35));
console.log("--- files (inclusive)\n" + top(file2, 25));
console.log("--- all frames (inclusive, top)\n" + top(incl, 45));
console.log("--- app frames (inclusive)\n" + top(new Map([...incl].filter(([k]) => /@ (components|app|lib)\//.test(k))), 70));
