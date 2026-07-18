// Offline proof that the static-tier hash CSP is sound for EVERY stamped
// route: each inline <script> in each prerendered HTML file must be allowed by
// the sha256 list in that route's stamped Content-Security-Policy header —
// i.e. the exact condition the browser will enforce. Run after `npm run build`
// (the postbuild stamp): `node scripts/verify_csp_static.mjs`. Exits non-zero
// on ANY uncovered script, printing the route and the missing hash.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const manifest = JSON.parse(readFileSync(join(".next", "routes-manifest.json"), "utf8"));
const stamped = manifest.headers.filter(
  (h) => Array.isArray(h.headers) && h.headers.some((x) => x.key === "x-csp-tier"),
);
if (stamped.length === 0) {
  console.error("verify-csp-static: no stamped routes — run the postbuild stamp first");
  process.exit(1);
}

let failures = 0;
for (const entry of stamped) {
  const csp = entry.headers.find((x) => x.key === "Content-Security-Policy")?.value ?? "";
  const scriptSrc = csp.split("; ").find((d) => d.startsWith("script-src ")) ?? "";
  if (/unsafe-inline/.test(scriptSrc)) {
    console.error(`${entry.source}: script-src contains unsafe-inline`);
    failures += 1;
    continue;
  }
  const allowed = new Set([...scriptSrc.matchAll(/'sha256-([^']+)'/g)].map((m) => m[1]));
  const file = join(".next", "server", "app", entry.source === "/" ? "index.html" : `${entry.source.slice(1)}.html`);
  const html = readFileSync(file, "utf8");
  const re = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  for (let m; (m = re.exec(html)); ) {
    if (!m[1]) continue;
    const hash = createHash("sha256").update(m[1], "utf8").digest("base64");
    if (!allowed.has(hash)) {
      console.error(`${entry.source}: inline script NOT covered (sha256-${hash})`);
      failures += 1;
    }
  }
}

if (failures > 0) {
  console.error(`verify-csp-static: ${failures} failure(s) across ${stamped.length} routes`);
  process.exit(1);
}
console.log(`verify-csp-static: all inline scripts covered on ${stamped.length} static routes; no unsafe-inline anywhere`);
