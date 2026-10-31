import http from 'node:http';
import https from 'node:https';
import { lookup } from 'node:dns/promises';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { isHarvestableOperatorUrl } from '../../../lib/harvest/sourcePolicy.ts';
import { looksLikeChallengePage, looksLikeHtmlDocument, parseRobotsTxt, robotsAllows } from '../../../lib/harvest/robots.ts';

const here = dirname(fileURLToPath(import.meta.url));
let slotId = 0;
async function acquireHost(host, minDelay) {
  if (!process.send) return () => {};
  const id = ++slotId;
  await new Promise((accept) => {
    const listener = (message) => {
      if (message.type === 'host-granted' && message.id === id) {
        process.off('message', listener);
        accept();
      }
    };
    process.on('message', listener);
    process.send({ type: 'host-acquire', id, host, minDelay });
  });
  return () => process.send?.({ type: 'host-release', id, host });
}
export const sha256 = (s) => createHash('sha256').update(s).digest('hex');
export const canonical = (input) => {
  try {
    const url = new URL(input);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) return null;
    url.hash = '';
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid$|gclid$)/i.test(key)) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    return url.href;
  } catch { return null; }
};

export function parsePage(html, url, mapping = {}) {
  const result = spawnSync('python3', [resolve(here, 'parse_html.py')], {
    input: JSON.stringify({ html, url, mapping }), maxBuffer: 64 * 1024 * 1024, encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(`HTML parser failed: ${result.stderr}`);
  return JSON.parse(result.stdout);
}

function ownHost(a, b) { return a.replace(/^www\./, '') === b.replace(/^www\./, ''); }

// Both arms use this exact transport. No production harvest writer is imported.
export class Transport {
  constructor({ venue, protocol, arm, out, clocks = new Map(), fixtureOrigin = null }) {
    Object.assign(this, { venue, protocol, arm, out, clocks, fixtureOrigin });
    this.requests = [];
    this.events = [];
    this.pages = [];
    this.rules = new Map();
    this.cooldown = new Set();
    this.seen = new Map();
    this.paths = new Map([[canonical(venue.website), [canonical(venue.website)]]]);
    this.documentGrants = new Set();
    this.used = 0;
    this.parserCpuSeconds = 0;
    this.parserPeakRssBytes = 0;
    this.queue = Promise.resolve();
    this.keywords = new RegExp(protocol.keywordPattern, 'i');
    mkdirSync(resolve(out, 'bodies'), { recursive: true });
  }

  policy(url) {
    if (this.fixtureOrigin && new URL(url).origin === this.fixtureOrigin) return true;
    return isHarvestableOperatorUrl(url);
  }

  inScope(url) {
    const seed = new URL(this.venue.website);
    const target = new URL(url);
    return ownHost(target.hostname, seed.hostname) || this.documentGrants.has(url);
  }

  event(url, reason, extra = {}) {
    this.events.push({ at: new Date().toISOString(), url, reason, ...extra });
    return null;
  }

  parse(html, url, mapping = {}) {
    const result = parsePage(html, url, mapping);
    this.parserCpuSeconds += result.parserCpuSeconds;
    this.parserPeakRssBytes = Math.max(this.parserPeakRssBytes, result.parserPeakRssBytes);
    return result;
  }

  async raw(url, kind, minDelay = this.protocol.minIntervalMs) {
    if (!this.policy(url)) return this.event(url, 'source-policy-refused');
    if (this.cooldown.has(new URL(url).host)) return this.event(url, 'host-cooldown');
    if (this.used >= this.protocol.requestBudgetPerArmPerVenue) return this.event(url, 'budget-exhausted');
    const host = new URL(url).host;
    const releaseHost = await acquireHost(host, minDelay);
    const wait = Math.max(0, (this.clocks.get(host) ?? 0) + minDelay - Date.now());
    if (wait) await new Promise((r) => setTimeout(r, wait));
    this.clocks.set(host, Date.now());
    const row = { sequence: ++this.used, at: new Date().toISOString(), url, kind, status: null, bytes: 0 };
    this.requests.push(row);
    const start = performance.now();
    try {
      const target = new URL(url);
      let addresses;
      if (!this.fixtureOrigin || target.origin !== this.fixtureOrigin) {
        addresses = await lookup(target.hostname, { all: true });
        if (!addresses.length || addresses.some(({ address }) => !isHarvestableOperatorUrl(`https://${address.includes(':') ? `[${address}]` : address}/`))) {
          throw new Error('DNS returned a non-public address');
        }
      }
      const result = await new Promise((accept, reject) => {
        const client = target.protocol === 'https:' ? https : http;
        const request = client.request(target, {
          method: 'GET', signal: AbortSignal.timeout(this.protocol.timeoutMs),
          headers: { 'user-agent': this.protocol.userAgent, accept: 'text/html,application/pdf,text/plain;q=0.8,*/*;q=0.1', 'accept-encoding': 'identity' },
          ...(addresses ? { lookup: (_host, options, callback) => options.all
            ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family) } : {}),
        }, (response) => {
          row.status = response.statusCode;
          row.location = response.headers.location ?? null;
          row.contentType = response.headers['content-type'] ?? '';
          row.retryAfter = response.headers['retry-after'] ?? null;
          const chunks = [];
          response.on('data', (chunk) => {
            row.bytes += chunk.length;
            if (row.bytes > this.protocol.maxResponseBytes) request.destroy(new Error('response-too-large'));
            else chunks.push(chunk);
          });
          response.on('end', () => accept({ status: response.statusCode, headers: response.headers, body: Buffer.concat(chunks) }));
          response.on('error', reject);
        });
        request.on('error', reject);
        request.end();
      });
      if ([429, 503].includes(result.status) || result.headers['retry-after']) this.cooldown.add(host);
      row.bodySha256 = sha256(result.body);
      row.bodyFile = `bodies/${row.bodySha256}.bin`;
      writeFileSync(resolve(this.out, row.bodyFile), result.body);
      return result;
    } catch (error) {
      row.error = error.message;
      this.event(url, 'fetch-failed', { detail: error.message });
      return null;
    } finally { row.elapsedMs = performance.now() - start; releaseHost(); }
  }

  async robots(origin) {
    if (this.rules.has(origin)) return this.rules.get(origin);
    let url = `${origin}/robots.txt`;
    let answer = { allowed: false, reason: 'robots-unreadable', delay: this.protocol.minIntervalMs };
    for (let hop = 0; hop <= this.protocol.maxRedirectHops; hop++) {
      const response = await this.raw(url, 'robots');
      if (!response) break;
      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        const target = canonical(new URL(response.headers.location, url).href);
        // A robots redirect cannot authorise a new origin for ordinary pages.
        if (!target || !this.policy(target) || !ownHost(new URL(target).hostname, new URL(origin).hostname)
          || (new URL(url).protocol === 'https:' && new URL(target).protocol !== 'https:')) break;
        url = target;
        continue;
      }
      const body = response.body.toString('utf8');
      if (looksLikeChallengePage(body)) break;
      if ([404, 410].includes(response.status)) answer = { ...answer, allowed: true, reason: 'robots-absent' };
      else if (response.status === 200 && (looksLikeHtmlDocument(body) || !body.trim() || /(?:^|\n)\s*(?:#|user-agent:|sitemap:|allow:|disallow:)/i.test(body))) {
        const delays = [...body.matchAll(/^\s*crawl-delay:\s*(\d+(?:\.\d+)?)/gmi)].map((m) => Number(m[1]) * 1000);
        const rates = [...body.matchAll(/^\s*request-rate:\s*(\d+)\s*\/\s*(\d+)/gmi)]
          .filter((m) => Number(m[1]) > 0).map((m) => Number(m[2]) / Number(m[1]) * 1000);
        answer = { allowed: true, reason: looksLikeHtmlDocument(body) ? 'robots-html-page' : 'robots-rules',
          rules: parseRobotsTxt(body), delay: Math.max(this.protocol.minIntervalMs, ...delays, ...rates), body };
      }
      break;
    }
    this.rules.set(origin, answer);
    this.events.push({ url: `${origin}/robots.txt`, reason: answer.reason, allowed: answer.allowed, delayMs: answer.delay });
    return answer;
  }

  async permitted(url) {
    if (!this.policy(url)) return this.event(url, 'source-policy-refused');
    if (!this.inScope(url)) return this.event(url, 'scope-refused');
    const rules = await this.robots(new URL(url).origin);
    if (!rules.allowed) return this.event(url, rules.reason);
    if (rules.rules) {
      const path = new URL(url).pathname + new URL(url).search;
      const decisions = [robotsAllows(rules.rules, path)];
      // Add the actual benchmark and PageSift identities to the repository's stricter classes.
      for (const [agent, group] of rules.rules.groups) {
        if (agent !== '*' && ['pubmaxmenubenchmark', 'pagesift'].some((name) => name.includes(agent))) {
          decisions.push(robotsAllows({ ...rules.rules, groups: new Map([['*', group]]) }, path));
        }
      }
      if (decisions.some((r) => !r.allowed)) return this.event(url, 'robots-disallowed');
    }
    return rules;
  }

  // Serialise every upstream request, including PageSift attachment fetches.
  fetch(url) {
    const work = this.queue.then(() => this.fetchSerial(url));
    this.queue = work.catch(() => {});
    return work;
  }

  populateHtml(page, body) {
    if (page.format !== 'html' || page.status !== 200) return;
    const parsed = this.parse(body.toString('utf8'), page.url);
    Object.assign(page, { title: parsed.title, headings: parsed.headings, text: parsed.text });
    for (const link of parsed.links) {
      const target = canonical(link.url);
      if (!target || /\.(?:png|jpg|jpeg|webp|gif|svg|ico|css|js|zip|mp4|mp3|woff2?)(?:\?|$)/i.test(target)) continue;
      if (!ownHost(new URL(target).hostname, new URL(this.venue.website).hostname)) {
        // Only an explicitly linked menu PDF can extend the host set. It remains unverified.
        if (!/\.pdf(?:\?|$)/i.test(target) || !this.keywords.test(link.anchor + ' ' + target)) continue;
        this.documentGrants.add(target);
      }
      if (!this.paths.has(target)) this.paths.set(target, [...page.path, target]);
      page.links.push({ url: target, anchor: link.anchor, keyword: this.keywords.test(`${target} ${link.anchor}`) });
    }
  }

  async fetchSerial(input) {
    let url = canonical(input);
    if (!url) return null;
    if (this.seen.has(url)) return this.seen.get(url);
    const path = [...(this.paths.get(url) ?? [canonical(this.venue.website), url])];
    const sourceUrl = path.length > 1 ? path[path.length - 2] : null;
    const original = url;
    for (let hop = 0; hop <= this.protocol.maxRedirectHops; hop++) {
      const permission = await this.permitted(url);
      if (!permission) { this.seen.set(original, null); return null; }
      const response = await this.raw(url, 'page', permission.delay);
      if (!response) { this.seen.set(original, null); return null; }
      if (response.status >= 300 && response.status < 400 && response.headers.location) {
        const target = canonical(new URL(response.headers.location, url).href);
        if (!target) return this.event(url, 'invalid-redirect');
        if (hop === this.protocol.maxRedirectHops) return this.event(url, 'redirect-hop-limit');
        // Re-check permission before requesting every hop, including an off-site hop.
        url = target;
        path.push(target);
        this.paths.set(target, [...path]);
        continue;
      }
      const type = String(response.headers['content-type'] ?? '');
      const pdf = response.body.subarray(0, 5).toString() === '%PDF-';
      const html = !pdf && (type.includes('html') || looksLikeHtmlDocument(response.body.toString('utf8')));
      if (looksLikeChallengePage(response.body.toString('utf8', 0, 16384))) {
        this.cooldown.add(new URL(url).host);
        this.seen.set(original, null);
        return this.event(url, 'challenge-page', { status: response.status });
      }
      const page = {
        requestedUrl: original, url, sourceUrl, path, status: response.status,
        format: pdf ? 'pdf' : html ? 'html' : 'other', bodySha256: sha256(response.body),
        bodyFile: `bodies/${sha256(response.body)}.bin`, contentType: type,
        fetchedAt: this.requests.at(-1).at, bytes: response.body.length,
        title: '', headings: '', text: '', links: [], candidate: false,
      };
      this.populateHtml(page, response.body);
      const incoming = [...this.seen.values()].filter(Boolean).flatMap((p) => p.links)
        .find((l) => l.url === original)?.anchor ?? '';
      page.candidate = response.status === 200 && (pdf || html)
        && this.keywords.test(`${url} ${incoming} ${page.title} ${page.headings}`);
      page.identityPostcodePresent = page.text.replace(/\s/g, '').toLowerCase()
        .includes(this.venue.postcode.replace(/\s/g, '').toLowerCase());
      this.pages.push(page);
      this.seen.set(original, page);
      this.seen.set(url, page);
      // Both arms pay for the first linked terms page before they explore further.
      if (original === canonical(this.venue.website) && !this.termsChecked) {
        this.termsChecked = true;
        const terms = page.links.find((link) => /(?:terms(?:-and-conditions|-of-use)?|legal)(?:\/|\?|$)/i.test(new URL(link.url).pathname));
        if (terms) {
          const termsPage = await this.fetchSerial(terms.url);
          const text = termsPage?.text ?? '';
          const restrictions = text.match(/[^.!?\n]{0,200}(?:scrap(?:e|ing)|crawl(?:ing|er)?|robots?|automated)[^.!?\n]{0,200}/gi) ?? [];
          const refusal = restrictions.find((line) => /prohibit|must not|may not|not permitted|not allowed|without.{0,50}(?:consent|permission)|prior.{0,25}(?:consent|permission)/i.test(line));
          if (!termsPage || refusal) {
            this.cooldown.add(new URL(url).host);
            this.event(terms.url, termsPage ? 'terms-restrict-automation' : 'terms-unreadable', { evidence: refusal ?? null });
          } else this.event(terms.url, 'terms-no-automation-bar-found');
        } else this.event(url, 'terms-link-not-found');
      }
      return page;
    }
    return null;
  }
}
