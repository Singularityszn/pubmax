import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadResults } from './evaluate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const run = resolve(process.argv[2]);
const bin = process.env.PAGESIFT_BIN ?? resolve(here, 'tools/pagesift');
const docs = resolve(run, 'review/documents');
mkdirSync(docs, { recursive: true });
const seen = new Set();
const output = [];
const start = performance.now();
for (const arm of loadResults(run)) {
  for (const page of arm.pages.filter((p) => p.format === 'pdf' && p.status === 200)) {
    if (seen.has(page.bodySha256)) continue;
    seen.add(page.bodySha256);
    const file = resolve(docs, `${page.bodySha256}.pdf`);
    writeFileSync(file, readFileSync(resolve(run, arm.venueId.replace('/', '-'), arm.arm, page.bodyFile)));
    const result = spawnSync(bin, ['scrape', file, '--config', resolve(here, 'pagesift.toml'), '--format', 'json'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    let extracted;
    try { extracted = JSON.parse(result.stdout); } catch { extracted = { success: false }; }
    output.push({ bodySha256: page.bodySha256, url: page.url, success: result.status === 0 && extracted.success,
      text: extracted.data?.markdown ?? '', metadata: extracted.data?.metadata ?? {}, warnings: result.stderr,
      note: 'Offline extraction for manual review only. No crawl request or verified price record is created.' });
  }
}
writeFileSync(resolve(run, 'extracted-pdfs.json'), `${JSON.stringify({ wallSeconds: (performance.now() - start) / 1000, documents: output }, null, 2)}\n`);
console.log(JSON.stringify({ documents: output.length, wallSeconds: (performance.now() - start) / 1000 }));
