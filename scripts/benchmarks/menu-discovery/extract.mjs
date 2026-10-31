import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
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
const cpuStart = process.cpuUsage();
let childCpuSeconds = 0;
let childPeakRssBytes = 0;
const results = loadResults(run).map((row) => ({ ...row, archiveRoot: resolve(run, row.venueId.replace('/', '-'), row.arm) }));
const referenceRoot = resolve(run, 'reference');
if (existsSync(referenceRoot)) {
  for (const entry of readdirSync(referenceRoot, { withFileTypes: true }).filter((e) => e.isDirectory())) {
    const folder = resolve(referenceRoot, entry.name);
    if (existsSync(resolve(folder, 'result.json'))) results.push({ ...JSON.parse(readFileSync(resolve(folder, 'result.json'))), archiveRoot: folder });
  }
}
for (const arm of results) {
  for (const page of arm.pages.filter((p) => p.format === 'pdf' && p.status === 200)) {
    if (seen.has(page.bodySha256)) continue;
    seen.add(page.bodySha256);
    const file = resolve(docs, `${page.bodySha256}.pdf`);
    writeFileSync(file, readFileSync(resolve(arm.archiveRoot, page.bodyFile)));
    const timeFile = resolve(docs, `${page.bodySha256}.time`);
    const timeArgs = process.platform === 'darwin' ? ['-l', '-p', '-o', timeFile] : ['-v', '-o', timeFile];
    const result = spawnSync('/usr/bin/time', [...timeArgs, bin, 'scrape', file, '--config', resolve(here, 'pagesift.toml'), '--format', 'json'], { encoding: 'utf8', timeout: 60000, maxBuffer: 32 * 1024 * 1024 });
    const timing = existsSync(timeFile) ? readFileSync(timeFile, 'utf8') : '';
    const number = (pattern) => Number(timing.match(pattern)?.[1] ?? 0);
    const cpuSeconds = process.platform === 'darwin'
      ? number(/^user\s+(\d+(?:\.\d+)?)/m) + number(/^sys\s+(\d+(?:\.\d+)?)/m)
      : number(/User time \(seconds\): (\d+(?:\.\d+)?)/) + number(/System time \(seconds\): (\d+(?:\.\d+)?)/);
    const peakRssBytes = process.platform === 'darwin'
      ? number(/^\s*(\d+)\s+maximum resident set size/m) : number(/Maximum resident set size \(kbytes\): (\d+)/) * 1024;
    childCpuSeconds += cpuSeconds;
    childPeakRssBytes = Math.max(childPeakRssBytes, peakRssBytes);
    let extracted;
    try { extracted = JSON.parse(result.stdout); } catch { extracted = { success: false }; }
    output.push({ bodySha256: page.bodySha256, url: page.url, success: result.status === 0 && extracted.success,
      cpuSeconds, peakRssBytes, text: extracted.data?.markdown ?? '', metadata: extracted.data?.metadata ?? {}, warnings: result.stderr,
      note: 'Offline extraction for manual review only. No crawl request or verified price record is created.' });
  }
}
const cpuDelta = process.cpuUsage(cpuStart);
writeFileSync(resolve(run, 'extracted-pdfs.json'), `${JSON.stringify({ wallSeconds: (performance.now() - start) / 1000, nodeCpuSeconds: (cpuDelta.user + cpuDelta.system) / 1e6, nodePeakRssBytes: process.resourceUsage().maxRSS * 1024, childCpuSeconds, childPeakRssBytes, timingResolution: 'Native CPU seconds use the operating system time tool. Values below its printed resolution can round to zero.', documents: output }, null, 2)}\n`);
console.log(JSON.stringify({ documents: output.length, wallSeconds: (performance.now() - start) / 1000 }));
