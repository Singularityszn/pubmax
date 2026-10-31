import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadResults } from './evaluate.mjs';
import { parsePage, sha256 } from './transport.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const run = resolve(process.argv[2]);
const bin = process.env.PAGESIFT_BIN ?? resolve(here, 'tools/pagesift');
const rows = loadResults(run);
const cases = [];
for (const venueId of ['way/176677099', 'node/2267462478', 'way/155488603']) {
  const arm = rows.find((r) => r.venueId === venueId && r.arm === 'B');
  const page = arm?.pages.find((p) => p.sourceUrl === null && p.format === 'html');
  if (!page) continue;
  const original = readFileSync(resolve(run, venueId.replace('/', '-'), 'B', page.bodyFile));
  const mapping = Object.fromEntries(page.links.map((l) => [l.url, `http://127.0.0.1:9876${new URL(l.url).pathname}${new URL(l.url).search}`]));
  const rewritten = Buffer.from(parsePage(original.toString('utf8'), page.url, mapping).html);
  const out = resolve(run, 'sensitivity', venueId.replace('/', '-'));
  mkdirSync(out, { recursive: true });
  const variants = [];
  for (const [name, body] of [['original', original], ['rewritten', rewritten]]) {
    const file = resolve(out, `${name}.html`);
    writeFileSync(file, body);
    const child = spawnSync(bin, ['convert', file, '--config', resolve(here, 'pagesift.toml'), '--base-url', page.url], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
    if (child.status !== 0) throw new Error(child.stderr);
    writeFileSync(resolve(out, `${name}.md`), child.stdout);
    variants.push({ name, htmlBytes: body.length, htmlSha256: sha256(body), extractedCharacters: child.stdout.length,
      markdownSha256: sha256(child.stdout), pdfLinksInExtractedText: (child.stdout.match(/\.pdf/gi) ?? []).length,
      warnings: child.stderr.trim() });
  }
  cases.push({ venueId, url: page.url, variants, networkRequests: 0 });
}
writeFileSync(resolve(run, 'sensitivity.json'), `${JSON.stringify({ note: 'Offline extraction sensitivity only. Neither variant adds live requests or changes either measured crawl.', cases }, null, 2)}\n`);
console.log(JSON.stringify({ cases: cases.length }));
