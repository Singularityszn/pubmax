// Asking a host's own robots.txt whether this harvest may read a page.
//
// WHY THE SOURCE TABLE IS NOT ENOUGH. lib/harvest/sourcePolicy.ts decides the
// handful of chain pages by hand, with the rule written down. The venue lanes
// have no such list: they follow whatever website the curated dataset holds, and
// there are hundreds. The first run walked straight onto two Mitchells & Butlers
// brand sites through their per-pub domains - an estate the source table
// refuses - because refusing `mbplc.com` says nothing about
// `edinborocastlepub.co.uk`. So the long tail is asked directly, per host, at
// harvest time.
//
// THE RULES THIS APPLIES, and why they are the strict reading:
//
//   * Our identity is PLURAL. The harvest reaches a page through a hosted
//     headless renderer, so it answers to the renderer class as well as to `*`.
//     A restriction on EITHER binds: several sites admit ordinary crawlers and
//     name `CloudflareBrowserRenderingCrawler` in a Disallow, and the narrower
//     rule is the one that counts.
//   * AN UNREADABLE robots.txt IS A REFUSAL, not a missing one. A challenge page
//     or a 403 means no permission can be read, and a page we cannot ask about
//     is a page we do not take. A genuine 404 is different: publishing no rules
//     is the long-standing way of permitting everything, and it is honoured.
//   * A RULES FILE WITH NO RULES IS STILL A RULES FILE. What decides is whether
//     the body PARSES as robots.txt, not whether it happens to contain a
//     `User-agent` line. An empty file, a file that names only its Sitemap and a
//     file that is comments to the last line each publish no restriction, which
//     is the same permission a 404 gives. Measured on 2026-09-04 over the 420
//     UK pub hosts the crawl had recorded as unreadable on a 200: 77 answer with
//     an empty file, 36 name only their Sitemap, 45 serve the Cloudflare content
//     signals preamble as comments with no signal line under it, and 254 serve an
//     HTML page where a rules file should be.
//   * AN ORDINARY HTML PAGE ON A 200 IS AN ABSENT RULES FILE. Captain's ruling,
//     2026-09-05 ("Crawl them"): a small site that routes every unknown path,
//     robots.txt included, to its home page or its own 404 page has published
//     no rules, which RFC 9309 section 2.3.1.3 reads as "no restriction". The
//     host record carries the classification (`robots: "html-page"`) so the
//     admission is auditable per host. What this does NOT loosen: a 401, 403,
//     429 or 5xx stays refused whatever its body says, and a body carrying a
//     challenge-page signature (Cloudflare, Akamai, hCaptcha, "Just a moment",
//     "Attention Required", a meta refresh into a challenge) stays refused on a
//     200 too, because a challenge is a door we were not let through, not a
//     page that has nothing to say. `CHALLENGE_PAGE_SIGNATURES` is the closed
//     table, and a body that is neither a rules file, an HTML document nor a
//     challenge (JSON, a binary, a bare fragment) stays `robots-unreadable`.
//   * A NETWORK FAILURE IS NOT A REFUSAL, and merging the two makes a report say
//     hosts turned us away when nobody was home. A host we could not reach is
//     `robots-unreachable`, asked once more before that is believed. Of the 1,320
//     hosts the same crawl recorded as unreadable on a fetch failure, 874 no
//     longer resolve at all and 72 answered a rules file on the second ask.
//   * The check itself is a plain fetch, not a Firecrawl request, so it costs
//     the run's budget nothing and cannot be the thing that exhausts it.

// A plain-node CLI imports this module, so the specifier is RELATIVE and carries
// its extension. `lib/responseBody.ts` is a leaf and pulls nothing behind it.
import { lookup as dnsLookup } from "node:dns/promises";
import type { LookupAddress } from "node:dns";
import { isIP, type LookupFunction } from "node:net";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { Readable, Transform, pipeline } from "node:stream";
import { createBrotliDecompress, createGunzip, createInflate } from "node:zlib";

import { discardBody } from "../responseBody.ts";
import { MAX_PDF_BYTES as MAX_TEXT_PDF_BYTES } from "./pdfText.ts";
import {
  harvestRedirectLanding,
  isHarvestablePageUrl,
  isPublicHarvestAddress,
  type HarvestUrlPolicy,
} from "./sourcePolicy.ts";

export const HARVEST_ROBOTS_AGENTS = ["cloudflarebrowserrenderingcrawler", "firecrawlagent", "*"] as const;

/** robots.txt is small; anything larger is not a rules file we should trust. */
const MAX_ROBOTS_BYTES = 512 * 1024;
const ROBOTS_TIMEOUT_MS = 15_000;
/** The pause before a host that could not be reached at all is asked once more. */
const ROBOTS_RETRY_DELAY_MS = 750;
/** Largest PDF any current harvest lane accepts, including the bounded OCR lane. */
const MAX_HARVEST_PDF_BYTES = 64 * 1024 * 1024;

export type RobotsRules = {
  /** Disallowed path prefixes, per lower-cased user-agent token. */
  groups: Map<string, { disallow: string[]; allow: string[] }>;
  /**
   * The sitemaps the file NAMES, in the order it names them.
   *
   * A sitemap line belongs to no user-agent group: it is the host telling every
   * reader where its own index of itself is. Carrying it out of the parser is
   * how a crawler discovers a site's pages by asking the site, rather than by
   * guessing paths at it, and guessing is what a crawl budget is spent on.
   */
  sitemaps: string[];
};

type RobotsDecisionReason =
  | "allowed"
  | "no-rules-published"
  | "robots-disallowed"
  | "robots-unreadable"
  | "robots-unreachable";

/**
 * What the host actually served at /robots.txt, apart from what was decided
 * about it. A ledger keeps this beside the outcome so an admitted host can be
 * told from one that published rules, and a refused one from one that was not
 * there at all.
 *
 *   rules-file      a body that parses as robots.txt, however few rules it holds
 *   absent          404 or 410: no file was published
 *   html-page       200 with an ordinary HTML document: read as no rules
 *   challenge-page  a body carrying a challenge signature, at any status
 *   http-refused    401, 403, 429, 5xx or any other non-2xx that is not absent
 *   not-a-rules-file 200 with a body that is neither rules, HTML nor a challenge
 *   unreachable     the request itself failed, twice
 */
type RobotsFileClass =
  | "rules-file"
  | "absent"
  | "html-page"
  | "challenge-page"
  | "http-refused"
  | "not-a-rules-file"
  | "unreachable";

type RobotsDecision = {
  allowed: boolean;
  reason: RobotsDecisionReason;
  evidence: string;
  /** What the host served at /robots.txt; absent only for a malformed URL. */
  robots?: RobotsFileClass;
  /** The sitemaps the host's own robots.txt named, when one could be read. */
  sitemaps?: string[];
};

/**
 * The marks of a page that is a DOOR rather than a document. Each is the text a
 * challenge vendor puts on the interstitial it serves in place of the page that
 * was asked for, lower-cased, matched anywhere in the first
 * `CHALLENGE_SCAN_BYTES` of the body. The table is closed and each row names
 * its vendor, so an addition is a reviewed claim about a signature and never a
 * word that happens to appear on a pub's home page.
 */
export const CHALLENGE_PAGE_SIGNATURES: ReadonlyArray<{ vendor: string; mark: string }> = [
  { vendor: "cloudflare", mark: "just a moment" },
  { vendor: "cloudflare", mark: "attention required" },
  { vendor: "cloudflare", mark: "cf-browser-verification" },
  { vendor: "cloudflare", mark: "cf_chl_" },
  { vendor: "cloudflare", mark: "__cf_chl" },
  // The interstitial's own orchestrator lives under /h/. The bare
  // `/cdn-cgi/challenge-platform/` prefix is NOT a signature: Cloudflare puts
  // its `scripts/jsd/main.js` detection beacon on every ordinary page behind
  // Bot Fight Mode, and matching the prefix refused 14 pub home pages on the
  // 2026-09-05 re-measurement.
  { vendor: "cloudflare", mark: "/cdn-cgi/challenge-platform/h/" },
  { vendor: "cloudflare", mark: "checking your browser before accessing" },
  { vendor: "cloudflare", mark: "enable javascript and cookies to continue" },
  { vendor: "cloudflare", mark: "verify you are human" },
  { vendor: "akamai", mark: "errors.edgesuite.net" },
  { vendor: "akamai", mark: "akamai-bot-manager" },
  { vendor: "akamai", mark: "/_sec/cp_challenge/" },
  { vendor: "hcaptcha", mark: "hcaptcha.com" },
  { vendor: "hcaptcha", mark: "h-captcha" },
  { vendor: "imperva", mark: "_incapsula_resource" },
  { vendor: "imperva", mark: "incapsula incident id" },
  { vendor: "datadome", mark: "captcha-delivery.com" },
  { vendor: "perimeterx", mark: "px-captcha" },
  { vendor: "ddos-guard", mark: "ddos-guard" },
  { vendor: "generic", mark: "access denied" },
  { vendor: "generic", mark: "bot detection" },
];

/** How much of a body the challenge scan reads: an interstitial says so early. */
const CHALLENGE_SCAN_BYTES = 64 * 1024;

/**
 * Does a body carry the signature of a challenge interstitial?
 *
 * The status code is not consulted here on purpose: a Cloudflare managed
 * challenge answers 403, a "Just a moment" page answers 503, and some vendors
 * serve theirs on a 200, so the body is asked whatever the status was. A meta
 * refresh is a challenge only when it points INTO one: a page that refreshes to
 * the site's own home page is a plain redirect and is not a refusal.
 */
export function looksLikeChallengePage(body: string): boolean {
  const head = body.slice(0, CHALLENGE_SCAN_BYTES).toLowerCase();
  if (CHALLENGE_PAGE_SIGNATURES.some(({ mark }) => head.includes(mark))) return true;
  const refresh = /<meta[^>]+http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*url\s*=\s*([^"'\s]+)/i.exec(head);
  if (refresh) {
    const target = refresh[1];
    if (/challenge|captcha|cdn-cgi|_sec\/|incapsula|bot-?check|verify/i.test(target)) return true;
  }
  return false;
}

/**
 * Is this body an HTML DOCUMENT, as opposed to a rules file or a fragment?
 *
 * Only a document root counts: a doctype, or an `<html` element as the first
 * thing after any byte-order mark, whitespace, XML declaration or comment. A
 * body that merely contains a tag somewhere is not admitted by this, because
 * the claim being made is "the host served us its site where a rules file
 * should be", and that claim needs the whole page to stand behind it.
 */
export function looksLikeHtmlDocument(body: string): boolean {
  const head = body
    .slice(0, CHALLENGE_SCAN_BYTES)
    .replace(/^\uFEFF/, "")
    .replace(/^\s*<\?xml[^>]*\?>/i, "")
    .replace(/^(\s*<!--[\s\S]*?-->)*/, "")
    .trimStart();
  return /^(<!doctype\s+html[\s>]|<html[\s>])/i.test(head);
}

/**
 * Whether a body is a rules file at all.
 *
 * The question is the SHAPE, not the contents. Every non-comment line of a
 * robots.txt is `field: value` with a bare word for the field, so a body whose
 * every such line reads that way is a rules file however few rules it holds, and
 * an HTML page is not one however long it runs. A body with no non-comment line
 * left is the emptiest rules file there is, and it restricts nothing.
 *
 * This replaced a test for a `User-agent` line, which refused three kinds of
 * file that grant permission: an empty one, one that names only its Sitemap, and
 * one that is comments to the last line.
 */
function looksLikeRulesFile(body: string): boolean {
  for (const raw of body.split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    if (line.length === 0) continue;
    const separator = line.indexOf(":");
    if (separator < 1) return false;
    if (!/^[a-z][a-z-]*$/.test(line.slice(0, separator).trim().toLowerCase())) return false;
  }
  return true;
}

/**
 * Read a robots.txt body into per-agent rules. A group may name several agents
 * before its first rule, which is how `User-agent: A` / `User-agent: B` /
 * `Disallow: /` binds both.
 */
export function parseRobotsTxt(body: string): RobotsRules {
  const groups = new Map<string, { disallow: string[]; allow: string[] }>();
  const sitemaps: string[] = [];
  let currentAgents: string[] = [];
  let sawRuleForGroup = false;

  for (const raw of body.split(/\r?\n/)) {
    const line = raw.split("#")[0].trim();
    if (line.length === 0) continue;
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const field = line.slice(0, separator).trim().toLowerCase();
    const value = line.slice(separator + 1).trim();

    if (field === "user-agent") {
      // A user-agent line after a rule starts a NEW group.
      if (sawRuleForGroup) {
        currentAgents = [];
        sawRuleForGroup = false;
      }
      currentAgents.push(value.toLowerCase());
      if (!groups.has(value.toLowerCase())) groups.set(value.toLowerCase(), { disallow: [], allow: [] });
      continue;
    }
    // A Sitemap line is group-independent, so it is taken wherever it appears
    // and never starts or ends a user-agent group.
    if (field === "sitemap") {
      if (value.length > 0 && !sitemaps.includes(value)) sitemaps.push(value);
      continue;
    }
    if (field !== "disallow" && field !== "allow") continue;
    sawRuleForGroup = true;
    for (const agent of currentAgents) {
      const group = groups.get(agent);
      if (!group) continue;
      if (field === "disallow") {
        // An EMPTY Disallow is the conventional "nothing is disallowed".
        if (value.length > 0) group.disallow.push(value);
      } else if (value.length > 0) {
        group.allow.push(value);
      }
    }
  }

  return { groups, sitemaps };
}

function matchLength(pattern: string, path: string): number {
  // Longest-prefix matching, with `*` and `$` handled the ordinary way.
  if (!pattern.includes("*") && !pattern.endsWith("$")) {
    return path.startsWith(pattern) ? pattern.length : -1;
  }
  const anchored = pattern.endsWith("$");
  const body = anchored ? pattern.slice(0, -1) : pattern;
  const escaped = body.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  const regex = new RegExp(`^${escaped}${anchored ? "$" : ""}`);
  return regex.test(path) ? body.length : -1;
}

/**
 * Is `path` allowed for every identity this harvest answers to? A restriction
 * on any of them binds, because we are all of them at once.
 */
export function robotsAllows(rules: RobotsRules, path: string): { allowed: boolean; agent?: string; rule?: string } {
  for (const agent of HARVEST_ROBOTS_AGENTS) {
    const group = rules.groups.get(agent);
    if (!group) continue;
    let bestDisallow = -1;
    let bestRule = "";
    for (const pattern of group.disallow) {
      const length = matchLength(pattern, path);
      if (length > bestDisallow) {
        bestDisallow = length;
        bestRule = pattern;
      }
    }
    if (bestDisallow < 0) continue;
    let bestAllow = -1;
    for (const pattern of group.allow) {
      bestAllow = Math.max(bestAllow, matchLength(pattern, path));
    }
    // A tie goes to Allow, which is the usual reading of the more permissive rule.
    if (bestAllow >= bestDisallow) continue;
    return { allowed: false, agent, rule: bestRule };
  }
  return { allowed: true };
}

export type RobotsChecker = (url: string) => Promise<RobotsDecision>;

const MAX_HARVEST_REDIRECTS = 5;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

/** The source/address fence refused an outbound page before its bytes were read. */
export class HarvestOutboundRefusal extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HarvestOutboundRefusal";
  }
}

/** Resolve all answers once; mixed public/private DNS answers fail closed. */
export async function resolvePublicHarvestAddress(
  hostname: string,
  lookupImpl: typeof dnsLookup = dnsLookup,
): Promise<LookupAddress> {
  const host = hostname.replace(/^\[|\]$/g, "");
  const family = isIP(host);
  const addresses = family
    ? [{ address: host, family }]
    : await lookupImpl(host, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicHarvestAddress(address))) {
    throw new HarvestOutboundRefusal(`Outbound address policy refused ${hostname}.`);
  }
  return addresses[0]!;
}

/** Bind Node's socket lookup to the already checked DNS answer for this hop. */
export function createPinnedHarvestLookup(pinnedAddress: LookupAddress): LookupFunction {
  return (_hostname, options, callback) => {
    if (typeof options === "object" && options !== null && options.all) {
      callback(null, [{ address: pinnedAddress.address, family: pinnedAddress.family }]);
    } else {
      callback(null, pinnedAddress.address, pinnedAddress.family);
    }
  };
}

/**
 * Make one GET/HEAD request through one already-validated, pinned DNS answer.
 * Redirects are returned to the caller; automatic redirects would let the
 * runtime resolve a second host without the policy and robots checks.
 */
export async function fetchHarvestResponse(
  input: string | URL,
  init: RequestInit = {},
  options: {
    urlPolicy?: HarvestUrlPolicy;
    lookupImpl?: typeof dnsLookup;
    maxPdfBytes?: number;
  } = {},
): Promise<Response> {
  const url = input instanceof URL ? input : new URL(input);
  const urlPolicy = options.urlPolicy ?? "operator";
  if (!isHarvestablePageUrl(url.href, urlPolicy)) throw new HarvestOutboundRefusal(`Source policy refused ${url.href}.`);
  if (init.redirect === "follow") throw new HarvestOutboundRefusal("Harvest transport refuses automatic redirects.");
  if (init.body !== undefined && init.body !== null) throw new TypeError("Harvest transport only accepts bodyless GET/HEAD requests.");

  const method = (init.method ?? "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") throw new TypeError("Harvest transport only accepts GET/HEAD requests.");
  const maxPdfBytes = options.maxPdfBytes ?? MAX_TEXT_PDF_BYTES;
  if (!Number.isSafeInteger(maxPdfBytes) || maxPdfBytes < 1 || maxPdfBytes > MAX_HARVEST_PDF_BYTES) {
    throw new RangeError(`Harvest PDF byte ceiling must be between 1 and ${MAX_HARVEST_PDF_BYTES}.`);
  }
  const pinnedAddress = await resolvePublicHarvestAddress(url.hostname, options.lookupImpl);
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;
  const headers = new Headers(init.headers);
  if (!headers.has("accept-encoding")) headers.set("accept-encoding", "gzip, deflate, br");

  return await new Promise<Response>((resolve, reject) => {
    const req = request(url, {
      method,
      headers: Object.fromEntries(headers.entries()),
      signal: init.signal ?? undefined,
      lookup: createPinnedHarvestLookup(pinnedAddress),
    }, (incoming) => {
      const responseHeaders = new Headers();
      for (const [name, value] of Object.entries(incoming.headers)) {
        if (value === undefined) continue;
        if (Array.isArray(value)) {
          for (const item of value) responseHeaders.append(name, item);
        } else {
          responseHeaders.set(name, value);
        }
      }

      const encoding = responseHeaders.get("content-encoding")?.trim().toLowerCase();
      const decoder = encoding === "gzip" ? createGunzip()
        : encoding === "deflate" ? createInflate()
        : encoding === "br" ? createBrotliDecompress() : null;
      if (encoding === "gzip" || encoding === "deflate" || encoding === "br") {
        responseHeaders.delete("content-encoding");
        responseHeaders.delete("content-length");
      }

      const status = incoming.statusCode ?? 502;
      const noBody = method === "HEAD" || status === 204 || status === 205 || status === 304;
      let body: ReadableStream<Uint8Array> | null = null;
      if (noBody) {
        incoming.destroy();
      } else {
        // Count decoded bytes before any caller can allocate text or a PDF buffer.
        const maxBytes = /pdf/i.test(responseHeaders.get("content-type") ?? "") || url.pathname.toLowerCase().endsWith(".pdf")
          ? maxPdfBytes : 4 * 1024 * 1024;
        let bytes = 0;
        const bounded = new Transform({
          transform(chunk: Buffer, _encoding, callback) {
            bytes += chunk.byteLength;
            if (bytes > maxBytes) callback(new Error(`Harvest decoded body exceeds ${maxBytes} bytes.`));
            else callback(null, chunk);
          },
        });
        body = Readable.toWeb(bounded, {
          strategy: { highWaterMark: 16 * 1024, size: (chunk: Uint8Array) => chunk.byteLength },
        }) as ReadableStream<Uint8Array>;
        // Pipeline tears down the socket and decoder on overflow or cancellation.
        const complete = (error: NodeJS.ErrnoException | null) => {
          if (error) bounded.destroy(error);
        };
        if (decoder) pipeline(incoming, decoder, bounded, complete);
        else pipeline(incoming, bounded, complete);
      }
      resolve(new Response(body, {
        status,
        statusText: incoming.statusMessage,
        headers: responseHeaders,
      }));
    });
    req.once("error", reject);
    req.end();
  });
}

export type HarvestedPageResult =
  | { ok: true; response: Response; url: string }
  | { ok: false; reason: "source-policy" | "robots-refused" | "redirect-limit" | "redirect-location"; url: string; response?: Response };

/** Check source policy and the exact path's robots rules before every hop. */
export async function fetchHarvestedPage(
  input: string | URL,
  robots: RobotsChecker,
  init: RequestInit = {},
  options: { fetchImpl?: typeof fetch; urlPolicy?: HarvestUrlPolicy } = {},
): Promise<HarvestedPageResult> {
  const original = input instanceof URL ? input.href : input;
  let current = original;
  const urlPolicy = options.urlPolicy ?? "operator";
  const fetchImpl: typeof fetch = options.fetchImpl ?? ((url, requestInit) => {
    if (url instanceof Request) return Promise.reject(new TypeError("Harvest transport requires an explicit URL."));
    return fetchHarvestResponse(url, requestInit, { urlPolicy });
  });
  for (let hop = 0; hop <= MAX_HARVEST_REDIRECTS; hop += 1) {
    if (harvestRedirectLanding(original, current, urlPolicy).outcome === "refused") {
      return { ok: false, reason: "source-policy", url: current };
    }
    const permission = await robots(current);
    if (!permission.allowed) return { ok: false, reason: "robots-refused", url: current };

    const response = await fetchImpl(current, { ...init, redirect: "manual" });
    if (!REDIRECT_STATUSES.has(response.status)) return { ok: true, response, url: current };
    const location = response.headers.get("location");
    discardBody(response);
    if (!location) return { ok: false, reason: "redirect-location", url: current, response };
    if (hop === MAX_HARVEST_REDIRECTS) return { ok: false, reason: "redirect-limit", url: current, response };
    try {
      current = new URL(location, current).href;
    } catch {
      return { ok: false, reason: "redirect-location", url: current, response };
    }
  }
  return { ok: false, reason: "redirect-limit", url: current };
}

/**
 * Build a per-run robots checker. One fetch per HOST, remembered for the run, so
 * a lane that reads two pages on a site asks once.
 */
export function createRobotsChecker(options: { fetchImpl?: typeof fetch; urlPolicy?: HarvestUrlPolicy } = {}): RobotsChecker {
  const urlPolicy = options.urlPolicy ?? "operator";
  const fetchImpl: typeof fetch = options.fetchImpl ?? ((url, init) => {
    if (url instanceof Request) return Promise.reject(new TypeError("Harvest transport requires an explicit URL."));
    return fetchHarvestResponse(url, init, { urlPolicy });
  });
  const cache = new Map<string, Promise<RobotsDecision | RobotsRules>>();

  async function ask(origin: string): Promise<RobotsDecision | RobotsRules> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ROBOTS_TIMEOUT_MS);
    try {
      let current = `${origin}/robots.txt`;
      let response: Response | undefined;
      for (let hop = 0; hop <= MAX_HARVEST_REDIRECTS; hop += 1) {
        if (!isHarvestablePageUrl(current, urlPolicy)) {
          throw new HarvestOutboundRefusal(`Source policy refused ${current}.`);
        }
        response = await fetchImpl(current, {
          headers: { accept: "text/plain", "user-agent": "PUBMAXX-harvest/1" },
          signal: controller.signal,
          redirect: "manual",
        });
        if (!REDIRECT_STATUSES.has(response.status)) break;
        const location = response.headers.get("location");
        discardBody(response);
        if (!location || hop === MAX_HARVEST_REDIRECTS) {
          throw new HarvestOutboundRefusal(`Robots redirect from ${current} has no safe landing.`);
        }
        current = new URL(location, current).href;
      }
      if (!response) throw new HarvestOutboundRefusal(`No robots response for ${origin}.`);
      if (response.status === 404 || response.status === 410) {
        // Nothing here reads this body, so let the stream go rather than
        // leaving the connection open on a host we are about to stop asking.
        discardBody(response);
        return {
          allowed: true,
          reason: "no-rules-published",
          robots: "absent",
          evidence: `${origin}/robots.txt returns ${response.status}, which publishes no restriction.`,
        };
      }
      const body = (await response.text()).slice(0, MAX_ROBOTS_BYTES);
      if (!response.ok) {
        // A 401, 403, 429 or 5xx is refused whatever its body says. The body is
        // still read so the ledger can say WHICH refusal it was.
        const challenge = looksLikeChallengePage(body);
        return {
          allowed: false,
          reason: "robots-unreadable",
          robots: challenge ? "challenge-page" : "http-refused",
          evidence: challenge
            ? `${origin}/robots.txt answered ${response.status} with a challenge page, so no permission can be read.`
            : `${origin}/robots.txt answered ${response.status}, so no permission can be read.`,
        };
      }
      // A file that parses to no group at all is a file that restricts nothing,
      // and it is still asked, so a Sitemap line in it is carried out.
      if (looksLikeRulesFile(body)) return parseRobotsTxt(body);
      if (looksLikeChallengePage(body)) {
        return {
          allowed: false,
          reason: "robots-unreadable",
          robots: "challenge-page",
          evidence: `${origin}/robots.txt answered ${response.status} with a challenge page, so no permission can be read.`,
        };
      }
      if (looksLikeHtmlDocument(body)) {
        // AN ORDINARY PAGE WHERE A RULES FILE SHOULD BE IS NO RULES FILE. The
        // host has published nothing a crawler can read as a restriction, which
        // RFC 9309 section 2.3.1.3 treats the same as a 404.
        return {
          allowed: true,
          reason: "no-rules-published",
          robots: "html-page",
          evidence: `${origin}/robots.txt returned an ordinary HTML page rather than a rules file, which publishes no restriction (RFC 9309 section 2.3.1.3).`,
        };
      }
      return {
        allowed: false,
        reason: "robots-unreadable",
        robots: "not-a-rules-file",
        evidence: `${origin}/robots.txt returned something that is neither a rules file nor an HTML page, so no permission can be read.`,
      };
    } catch (error) {
      if (error instanceof HarvestOutboundRefusal) {
        return {
          allowed: false,
          reason: "robots-unreadable",
          robots: "http-refused",
          evidence: `${origin}/robots.txt could not be safely fetched (${error.message}).`,
        };
      }
      return {
        allowed: false,
        reason: "robots-unreachable",
        robots: "unreachable",
        evidence: `${origin}/robots.txt could not be fetched (${error instanceof Error ? error.message : String(error)}).`,
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Ask a host, and ask ONCE more when the ask itself failed.
   *
   * The retry is spent on one question and only that one: did the request get
   * through. A host that ANSWERED keeps its answer, whatever the answer was, so
   * a refusal is never asked again in the hope of a different verdict.
   */
  async function load(origin: string): Promise<RobotsDecision | RobotsRules> {
    const first = await ask(origin);
    if (!("reason" in first) || first.reason !== "robots-unreachable") return first;
    await new Promise((resolve) => setTimeout(resolve, ROBOTS_RETRY_DELAY_MS));
    return ask(origin);
  }

  return async (url: string): Promise<RobotsDecision> => {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { allowed: false, reason: "robots-unreadable", evidence: `${url} is not an absolute URL.` };
    }
    const origin = parsed.origin;
    let pending = cache.get(origin);
    if (!pending) {
      pending = load(origin);
      cache.set(origin, pending);
    }
    const loaded = await pending;
    if ("reason" in loaded) return loaded;

    const path = `${parsed.pathname}${parsed.search}`;
    const verdict = robotsAllows(loaded, path);
    if (verdict.allowed) {
      return {
        allowed: true,
        reason: "allowed",
        robots: "rules-file",
        evidence: `${origin}/robots.txt permits ${path}.`,
        sitemaps: loaded.sitemaps,
      };
    }
    return {
      allowed: false,
      reason: "robots-disallowed",
      robots: "rules-file",
      evidence: `${origin}/robots.txt disallows ${path} for \`${verdict.agent}\` (rule: ${verdict.rule}).`,
    };
  };
}
