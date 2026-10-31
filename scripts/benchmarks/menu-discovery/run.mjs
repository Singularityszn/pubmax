import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { readFileSync, writeFileSync, mkdirSync, createWriteStream } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { platform, release, cpus, totalmem } from 'node:os';
import { Transport, canonical, sha256 } from './transport.mjs';
import { evaluate } from './evaluate.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const protocolFile = resolve(here, 'protocol.json');
const protocol = JSON.parse(readFileSync(protocolFile));
const args = process.argv.slice(2);
const command = args.shift();
const option = (key, fallback) => args.includes(`--${key}`) ? args[args.indexOf(`--${key}`) + 1] : fallback;
const json = (path, value) => writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`);
const bin = process.env.PAGESIFT_BIN ?? resolve(here, 'tools/pagesift');
const nativeChildren = new Set();
const venueChildren = new Set();
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => {
  for (const child of venueChildren) child.kill('SIGTERM');
  for (const child of nativeChildren) {
    try { process.kill(-child.pid, 'SIGINT'); } catch (error) { if (error.code !== 'ESRCH') console.error(error.message); }
  }
  setTimeout(() => process.exit(signal === 'SIGINT' ? 130 : 143), 100);
});

function checkBinary() {
  const result = spawnSync(bin, ['--version'], { encoding: 'utf8' });
  if (result.status !== 0 || result.stdout.trim() !== 'pagesift 0.81.0') throw new Error('Set PAGESIFT_BIN to the pinned PageSift 0.81.0 executable. Run bootstrap.py first.');
  return { version: result.stdout.trim(), sha256: sha256(readFileSync(bin)) };
}

async function breadthFirst(transport) {
  const queue = [{ url: canonical(transport.venue.website), depth: 0, keyword: false, order: 0 }];
  const enqueued = new Set(queue.map((row) => row.url));
  let order = 0;
  while (queue.length && transport.used < transport.protocol.requestBudgetPerArmPerVenue) {
    queue.sort((a, b) => a.depth - b.depth || Number(b.keyword) - Number(a.keyword) || a.order - b.order);
    const item = queue.shift();
    const page = await transport.fetch(item.url);
    if (!page || page.status !== 200 || item.depth >= transport.protocol.maxDepth) continue;
    for (const link of page.links) {
      if (enqueued.has(link.url)) continue;
      enqueued.add(link.url);
      queue.push({ ...link, depth: item.depth + 1, order: ++order });
    }
  }
  return { stopReason: transport.used >= transport.protocol.requestBudgetPerArmPerVenue ? 'request-budget' : 'frontier-empty' };
}

async function relevanceGuided(transport) {
  const routes = new Map();
  let localOrigin;
  let localRequests = 0;
  let nativeProcess;
  let budgetStopped = false;
  let exitSignal = null;
  const stopAtBudget = () => {
    if (budgetStopped || !nativeProcess) return;
    budgetStopped = true;
    try { process.kill(-nativeProcess.pid, 'SIGINT'); } catch (error) { if (error.code !== 'ESRCH') throw error; }
  };
  const toLocal = (input) => {
    const url = new URL(input);
    const same = url.hostname.replace(/^www\./, '') === new URL(transport.venue.website).hostname.replace(/^www\./, '');
    const path = `${same ? '' : `/__menu_asset__/${url.hostname}`}${url.pathname}${url.search}`;
    routes.set(path, input);
    return `${localOrigin}${path}`;
  };
  const server = createServer(async (request, response) => {
    localRequests++;
    if (request.url === '/robots.txt') {
      response.writeHead(200, { 'content-type': 'text/plain' }).end('User-agent: *\nAllow: /\n');
      return;
    }
    try {
      const target = routes.get(request.url);
      if (!target) { response.writeHead(404).end(); return; }
      const page = await transport.fetch(target);
      if (!page) {
        if (transport.used >= transport.protocol.requestBudgetPerArmPerVenue) response.once('finish', stopAtBudget);
        // A synthetic policy refusal must not trigger native retry cooldowns.
        response.writeHead(200, { 'content-type': 'text/plain', 'x-benchmark-refused': 'true' }).end('');
        return;
      }
      let body = readFileSync(resolve(transport.out, page.bodyFile));
      if (page.format === 'html' && page.status === 200) {
        const mapping = {};
        for (const link of page.links) mapping[link.url] = toLocal(link.url);
        const original = transport.parse(body.toString('utf8'), page.url);
        for (const link of original.links) {
          if (mapping[canonical(link.url)]) mapping[link.url] = mapping[canonical(link.url)];
        }
        body = Buffer.from(transport.parse(body.toString('utf8'), page.url, mapping).html);
      }
      response.writeHead(page.status >= 400 ? 200 : page.status,
        { 'content-type': page.status >= 400 ? 'text/plain' : page.contentType || 'application/octet-stream', 'x-benchmark-upstream-status': String(page.status) })
        .end(page.status >= 400 ? '' : body);
    } catch (error) {
      transport.event(routes.get(request.url) ?? request.url, 'gateway-error', { detail: error.message });
      response.writeHead(500).end('Gateway error');
    }
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  localOrigin = `http://127.0.0.1:${server.address().port}`;
  const start = toLocal(transport.venue.website);
  const timePath = resolve(transport.out, 'pagesift-time.txt');
  const stdout = createWriteStream(resolve(transport.out, 'pagesift.jsonl'));
  const stderr = createWriteStream(resolve(transport.out, 'pagesift.stderr.txt'));
  const cli = ['crawl', start, '--config', resolve(here, 'pagesift.toml'), '--query', transport.protocol.query,
    '--limit', String(transport.protocol.requestBudgetPerArmPerVenue), '--depth', String(transport.protocol.maxDepth),
    '--scope', 'domain', '--sitemap', 'skip', '--engine', 'http', '--attachments',
    '--attachment-limit', String(transport.protocol.requestBudgetPerArmPerVenue),
    '--tuning-mode', 'conservative', '--allow-cidr', '127.0.0.1/32'];
  json(resolve(transport.out, 'pagesift-command.json'), { executable: bin, args: cli, urlMapping: 'Own-host paths unchanged. Explicit external menu PDFs use /__menu_asset__/host/original-path.' });
  let exitCode;
  try {
    exitCode = await new Promise((accept, reject) => {
      const timeArgs = process.platform === 'darwin' ? ['-l', '-p', '-o', timePath] : ['-v', '-o', timePath];
      const child = spawn('/usr/bin/time', [...timeArgs, bin, ...cli], {
        detached: true,
        cwd: transport.out,
        // No API credentials or inherited PageSift settings enter the child.
        env: { PATH: process.env.PATH, TMPDIR: process.env.TMPDIR ?? '/tmp', LANG: 'en_GB.UTF-8' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      nativeProcess = child;
      nativeChildren.add(child);
      child.stdout.pipe(stdout);
      child.stderr.pipe(stderr);
      const timeout = setTimeout(() => {
        process.kill(-child.pid, 'SIGINT');
        transport.event(transport.venue.website, 'native-venue-timeout');
      }, 600000);
      child.on('error', (error) => { clearTimeout(timeout); reject(error); });
      child.on('close', (code, signal) => { nativeChildren.delete(child); clearTimeout(timeout); exitSignal = signal; accept(code); });
    });
    await new Promise((r) => stdout.end(r));
    await new Promise((r) => stderr.end(r));
  } finally {
    await transport.queue;
    server.closeAllConnections();
    await new Promise((r) => server.close(r));
  }
  const time = readFileSync(timePath, 'utf8');
  const number = (pattern) => Number(time.match(pattern)?.[1] ?? 0);
  const childCpuSeconds = process.platform === 'darwin'
    ? number(/^user\s+(\d+(?:\.\d+)?)/m) + number(/^sys\s+(\d+(?:\.\d+)?)/m)
    : number(/User time \(seconds\): (\d+(?:\.\d+)?)/) + number(/System time \(seconds\): (\d+(?:\.\d+)?)/);
  const childPeakRssBytes = process.platform === 'darwin'
    ? number(/^\s*(\d+)\s+maximum resident set size/m) : number(/Maximum resident set size \(kbytes\): (\d+)/) * 1024;
  return { exitCode, exitSignal, budgetStopped, localRequests, childCpuSeconds, childPeakRssBytes,
    stopReason: budgetStopped ? 'request-budget' : 'native-cli-returned',
    nativeOutputSha256: sha256(readFileSync(resolve(transport.out, 'pagesift.jsonl'))) };
}

export async function runArm({ venue, arm, out, config, clocks, fixtureOrigin }) {
  mkdirSync(out, { recursive: true });
  const transport = new Transport({ venue, arm, out, protocol: config, clocks, fixtureOrigin });
  const begin = performance.now();
  const cpu = process.cpuUsage();
  const childrenBefore = process.resourceUsage();
  let peakRssBytes = process.memoryUsage().rss;
  const sample = setInterval(() => { peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss); }, 20);
  let outcome;
  try { outcome = arm === 'A' ? await breadthFirst(transport) : await relevanceGuided(transport); }
  finally { clearInterval(sample); }
  const wallSeconds = (performance.now() - begin) / 1000;
  const delta = process.cpuUsage(cpu);
  const nodeCpuSeconds = (delta.user + delta.system) / 1e6;
  const result = { schemaVersion: 1, venueId: venue.venueId, name: venue.name, arm,
    budget: config.requestBudgetPerArmPerVenue, networkRequests: transport.used,
    wallSeconds, nodeCpuSeconds, nodePeakRssBytes: peakRssBytes,
    parserCpuSeconds: transport.parserCpuSeconds, parserPeakRssBytes: transport.parserPeakRssBytes,
    computeNote: 'Node CPU is measured per arm. Native child CPU and RSS use /usr/bin/time. Each Python parser reports its own CPU and RSS. Node RSS is sampled. These maxima are not a simultaneous process-tree peak. B includes gateway rewriting overhead.',
    resourceUsageBefore: { userCPUTime: childrenBefore.userCPUTime, systemCPUTime: childrenBefore.systemCPUTime },
    ...outcome, pages: transport.pages, requests: transport.requests, events: transport.events };
  json(resolve(out, 'result.json'), result);
  return result;
}

async function worker(venue, out, config) {
  const clocks = new Map();
  for (const arm of venue.armOrder) {
    await runArm({ venue, arm, out: resolve(out, venue.venueId.replace('/', '-'), arm), config, clocks });
  }
}

async function live() {
  const binary = checkBinary();
  const manifestBytes = readFileSync(resolve(here, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes);
  if (sha256(readFileSync(protocolFile)) !== manifest.protocolSha256) throw new Error('Manifest protocol hash differs. Run prepare.mjs.');
  const out = resolve(option('out', resolve(here, 'runs', new Date().toISOString().replaceAll(':', '-'))));
  mkdirSync(out, { recursive: true });
  const limit = Number(option('venues', manifest.venues.length));
  const venues = manifest.venues.slice(0, limit);
  const meta = { startedAt: new Date().toISOString(), binary, protocol, manifestSha256: sha256(manifestBytes),
    codeHead: spawnSync('git', ['rev-parse', 'HEAD'], { cwd: here, encoding: 'utf8' }).stdout.trim(),
    harnessFiles: Object.fromEntries(['run.mjs', 'transport.mjs', 'parse_html.py', 'pagesift.toml', 'protocol.json', 'manifest.json', 'dependency-lock.json', 'access-review.json',
      '../../../lib/harvest/sourcePolicy.ts', '../../../lib/harvest/sourceRegistry.ts', '../../../lib/harvest/robots.ts']
      .map((name) => [name, sha256(readFileSync(resolve(here, name)))])),
    environment: { node: process.version, platform: platform(), release: release(), cpu: cpus()[0].model, cpuCount: cpus().length, totalMemoryBytes: totalmem() },
    includedVenues: venues.map((v) => v.venueId), completeCohort: venues.length === 60 };
  json(resolve(out, 'run.json'), meta);
  const active = new Map();
  const pending = [...venues];
  const failures = [];
  // Different venue domains can link to the same menu CDN. Serialise by actual host.
  const hostQueues = new Map();
  const hostStarts = new Map();
  const start = performance.now();
  while (pending.length || active.size) {
    const usedHosts = new Set([...active.values()].map((row) => row.host));
    let index;
    while (active.size < protocol.venueConcurrency && (index = pending.findIndex((v) => !usedHosts.has(v.host))) !== -1) {
      const venue = pending.splice(index, 1)[0];
      usedHosts.add(venue.host);
      const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'worker', '--venue', venue.venueId, '--out', out], {
        env: { ...process.env, PAGESIFT_BIN: bin }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      });
      venueChildren.add(child);
      const releases = new Map();
      child.on('message', (message) => {
        if (message.type === 'host-release') {
          hostStarts.set(message.host, Date.now());
          releases.get(message.id)?.();
          releases.delete(message.id);
        }
        if (message.type !== 'host-acquire') return;
        const prior = hostQueues.get(message.host) ?? Promise.resolve();
        const next = prior.then(async () => {
          const wait = Math.max(0, (hostStarts.get(message.host) ?? 0) + message.minDelay - Date.now());
          if (wait) await new Promise((r) => setTimeout(r, wait));
          if (!child.connected) return;
          hostStarts.set(message.host, Date.now());
          await new Promise((r) => {
            releases.set(message.id, r);
            child.send({ type: 'host-granted', id: message.id });
          });
        });
        hostQueues.set(message.host, next);
      });
      let errors = '';
      child.stderr.on('data', (chunk) => { errors += chunk; });
      const done = new Promise((r) => child.on('close', (code) => {
        venueChildren.delete(child);
        for (const release of releases.values()) release();
        if (code !== 0) failures.push({ venueId: venue.venueId, code, error: errors });
        console.log(JSON.stringify({ venue: venue.name, venueId: venue.venueId, code }));
        active.delete(venue.venueId);
        r();
      }));
      active.set(venue.venueId, { host: venue.host, done });
    }
    if (active.size) await Promise.race([...active.values()].map((row) => row.done));
  }
  json(resolve(out, 'run.json'), { ...meta, finishedAt: new Date().toISOString(), wallSeconds: (performance.now() - start) / 1000, failures });
  if (failures.length) process.exitCode = 1;
  console.log(JSON.stringify({ out, failures: failures.length }));
}

async function fixture() {
  checkBinary();
  const out = resolve(option('out', resolve(here, 'runs/fixture')));
  const scenario = option('scenario', 'normal');
  let forbiddenHits = 0;
  const server = createServer((request, response) => {
    const send = (body, status = 200, headers = {}) => response.writeHead(status, { 'content-type': 'text/html', ...headers }).end(body);
    if (request.url === '/robots.txt') return scenario === 'robots-refused' ? send('Access denied', 403)
      : send('User-agent: *\nDisallow: /private-menu\n', 200, { 'content-type': 'text/plain' });
    if (request.url === '/private-menu') { forbiddenHits++; return send('Forbidden', 500); }
    if (request.url === '/terms-conditions') return send('<html><title>Terms and Conditions</title><p>No text or data mining, or web scraping. You shall not conduct, facilitate, authorise or permit any text or data mining or web scraping in relation to our Websites.</p></html>');
    if (request.url === '/') return send(scenario === 'terms-refused' ? '<html><title>Fixture pub</title><a href="/terms-conditions">Terms and Conditions</a><a href="/old-menu">Food menu</a></html>'
      : scenario === 'redirect-refused' ? '<html><title>Fixture pub</title><a href="/old-menu">Food menu</a></html>'
      : '<html><head><title>Fixture pub food and drinks</title></head><body><h1>Fixture pub</h1><p>London SW1A 1AA</p><a href="/old-menu">Food menu</a><a href="/menu-news">Menu news</a><a href="/private-menu">Private menu</a><a href="/challenge">Drinks menu</a><a href="/unknown-menu">Seasonal menu</a></body></html>');
    if (request.url === '/old-menu') return send('', 302, { location: scenario === 'redirect-refused' ? 'http://169.254.169.254/metadata-menu.pdf' : '/food-menu' });
    if (request.url === '/food-menu') return send('<html><head><title>Food menu</title></head><body><h1>Food menu</h1><p>Soup £6.50</p></body></html>');
    if (request.url === '/menu-news') return send('<html><head><title>Menu news</title></head><body><h1>Menu news</h1><p>We will announce our new menu next year.</p></body></html>');
    if (request.url === '/challenge') return send('<html><title>Just a moment...</title><body>cf-chl-platform</body></html>');
    if (request.url === '/unknown-menu') return send('<html><title>Seasonal menu</title><p>Unreviewed content.</p></html>');
    return send('Missing', 404);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const venue = { venueId: 'fixture', name: 'Fixture pub', website: scenario === 'source-refused' ? 'http://169.254.169.254/metadata-menu.pdf' : `${origin}/`, postcode: 'SW1A 1AA', goldSample: true };
  const config = { ...protocol, minIntervalMs: 0, timeoutMs: 3000, requestBudgetPerArmPerVenue: Number(option('budget', 9)) };
  const arms = [];
  try {
    for (const arm of ['A', 'B']) arms.push(await runArm({ venue, arm, out: resolve(out, arm), config, clocks: new Map(), fixtureOrigin: origin }));
    const labels = [
      { venueId: 'fixture', url: `${origin}/food-menu`, verdict: 'menu', format: 'html', reviewer: 'fixture-truth', relevant: true,
        priceRecords: [{ id: 'soup', item: 'Soup', amountGbp: 6.5, evidence: 'Soup £6.50' }] },
      { venueId: 'fixture', url: `${origin}/menu-news`, verdict: 'not-menu', reviewer: 'fixture-truth', relevant: false },
      { venueId: 'fixture', url: `${origin}/missing-menu.pdf`, verdict: 'menu', format: 'pdf', reviewer: 'fixture-truth', relevant: true },
      { venueId: 'fixture', url: `${origin}/`, verdict: 'not-menu', reviewer: 'fixture-truth', relevant: false },
    ];
    // The evaluation oracle is separate from native scheduler order and host cooldown.
    const oracle = arms.map((row) => ({ ...row, pages: [
      { url: `${origin}/food-menu`, candidate: true, status: 200 },
      { url: `${origin}/menu-news`, candidate: true, status: 200 },
      { url: `${origin}/unknown-menu`, candidate: true, status: 200 },
    ] }));
    json(resolve(out, 'fixture-check.json'), { arms, forbiddenHits, evaluation: evaluate(oracle, labels) });
  } finally { await new Promise((r) => server.close(r)); }
}

try {
  if (command === 'live') await live();
  else if (command === 'worker') {
    const manifest = JSON.parse(readFileSync(resolve(here, 'manifest.json')));
    const venue = manifest.venues.find((v) => v.venueId === option('venue'));
    if (!venue) throw new Error('Unknown venue ID');
    await worker(venue, resolve(option('out')), protocol);
    if (process.connected) process.disconnect();
  } else if (command === 'fixture') await fixture();
  else throw new Error('Usage: node run.mjs live [--out PATH] [--venues N] | fixture [--out PATH] [--budget N]');
} catch (error) { console.error(error.stack); process.exitCode = 1; }
