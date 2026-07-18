// Offline proof that the static-tier hash CSP is sound for EVERY stamped
// route: each prerendered HTML file must carry exactly one injected meta CSP
// (data-csp-tier="static-hash"), positioned BEFORE its first <script>, whose
// sha256 list covers every inline script in the file — the exact condition the
// browser will enforce. Run after `npm run build` (the postbuild stamp):
// `node scripts/verify_csp_static.mjs`. Exits non-zero on ANY failure,
// printing the route and the missing hash.

import { createHash } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

const APP_DIR = join(".next", "server", "app");
const MARKER_ATTR = 'data-csp-tier="static-hash"';

function htmlFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...htmlFiles(full));
    else if (entry.endsWith(".html")) out.push(full);
  }
  return out;
}

let failures = 0;
let checked = 0;
for (const file of htmlFiles(APP_DIR)) {
  const rel = `/${relative(APP_DIR, file).split(sep).join("/")}`;
  if (rel === "/_global-error.html" || rel === "/_not-found.html") continue;
  const html = readFileSync(file, "utf8");
  const metas = [...html.matchAll(
    new RegExp(`<meta http-equiv="Content-Security-Policy" content="([^"]*)" ${MARKER_ATTR}/>`, "g"),
  )];
  if (metas.length !== 1) {
    console.error(`${rel}: expected exactly 1 injected meta CSP, found ${metas.length}`);
    failures += 1;
    continue;
  }
  const csp = metas[0][1].replace(/&quot;/g, '"').replace(/&amp;/g, "&");
  const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src ")) ?? "";
  if (/unsafe-inline/.test(scriptSrc)) {
    console.error(`${rel}: script-src contains unsafe-inline`);
    failures += 1;
    continue;
  }
  if (metas[0].index > html.search(/<script/i)) {
    console.error(`${rel}: meta CSP sits AFTER the first <script> — that script would be ungoverned`);
    failures += 1;
    continue;
  }
  const allowed = new Set([...scriptSrc.matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]));
  const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  for (let m; (m = re.exec(html)); ) {
    if (!m[1]) continue;
    const hash = createHash("sha256").update(m[1], "utf8").digest("base64");
    if (!allowed.has(hash)) {
      console.error(`${rel}: inline script NOT covered (sha256-${hash})`);
      failures += 1;
    }
  }
  checked += 1;
}

if (checked === 0) {
  console.error("verify-csp-static: no stamped HTML found — run the postbuild stamp first");
  process.exit(1);
}
if (failures > 0) {
  console.error(`verify-csp-static: ${failures} failure(s) across ${checked} routes`);
  process.exit(1);
}
console.log(`verify-csp-static: all inline scripts covered on ${checked} static routes; meta precedes every script; no unsafe-inline anywhere`);
