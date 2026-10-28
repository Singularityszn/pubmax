// The predicates the harvest asks before it reads a URL.
//
// Registered sources and estate hosts live in lib/harvest/sourceRegistry.ts.
// Keep the re-exports here so existing callers retain the same import path.
// The source ledger (docs/data/SOURCE_LEDGER.md) owns the separate contracts
// for registered-source and venue own-site reads.

import {
  HARVEST_SOURCES,
  REFUSED_ESTATE_HOSTS,
  type HarvestSkipReason,
  type HarvestSource,
  type HarvestSourceKind,
} from "./sourceRegistry.ts";

export {
  HARVEST_SKIP_REASONS,
  HARVEST_SOURCES,
  REFUSED_ESTATE_HOSTS,
  type HarvestSkipReason,
  type HarvestSource,
  type HarvestSourceKind,
} from "./sourceRegistry.ts";

const BY_ID = new Map(HARVEST_SOURCES.map((source) => [source.id, source]));

export function harvestSource(id: string): HarvestSource | undefined {
  return BY_ID.get(id);
}

export function isHarvestSourceAllowed(source: HarvestSource): boolean {
  return source.access.allowed;
}

export function harvestSourcesOfKind(kind: HarvestSourceKind): HarvestSource[] {
  return HARVEST_SOURCES.filter((source) => source.kind === kind);
}

/** The sources of a kind this run may actually read. */
export function allowedHarvestSources(kind: HarvestSourceKind): HarvestSource[] {
  return harvestSourcesOfKind(kind).filter(isHarvestSourceAllowed);
}

/**
 * The URL an open-data builder may fetch: `pathAndQuery` resolved against its
 * registered row's own url, or a throw.
 *
 * THE TABLE OWNS THE HOST. A builder names its row and the path it wants, so
 * no builder types an origin, a row the table refuses reads nothing, and a
 * path that would resolve anywhere else (`//other.host/`, another scheme) is
 * refused before it is asked. Builders pair this with `redirect: "error"`, so
 * the host they land on is the host this returned.
 */
export function openDataSourceUrl(id: string, pathAndQuery: string): URL {
  const source = harvestSource(id);
  if (!source || source.kind !== "open-data") {
    throw new Error(`sourcePolicy: no open-data source "${id}"`);
  }
  if (!source.access.allowed) {
    throw new Error(`sourcePolicy refuses ${id}: ${source.access.reason}`);
  }
  const base = new URL(source.url);
  const url = new URL(pathAndQuery, base);
  if (url.protocol !== "https:" || url.host !== base.host) {
    throw new Error(`sourcePolicy: ${url.href} is not ${source.id}'s ${base.origin}`);
  }
  return url;
}

/**
 * Allowed venue-events pages the Context.dev events lane may read.
 *
 * FIRST PARTY IS THE BAR, and it is the semantic property rather than a proxy
 * for it: an extract call hands a whole page to a model and takes back whatever
 * it says, so it cannot honour the narrow `nonFirstPartyException` an allowed
 * listings source carries ("facts only, from the og:description prefix" is a
 * promise no extraction keeps). A URL suffix stood in for this and would have
 * admitted the next allowed non-first-party page that did not happen to end
 * `.xml`.
 */
export function contextDevEventSources(): HarvestSource[] {
  return allowedHarvestSources("venue-events").filter((source) => source.firstParty);
}

/**
 * The skip reasons that mean WE MAY NOT READ THIS HOST, as opposed to the ones
 * that mean we read it and there was nothing there, or we did not get to it
 * this run.
 *
 * The distinction is load-bearing for `REFUSED_HOSTS` below. Greene King and
 * Wetherspoon both gave permission and both publish no price, so their
 * menu-price rows are refused for `publishes-no-web-price`. Folding that into a
 * permission refusal would bar their own pub pages from every other lane, which
 * would be a false statement about hosts that said yes.
 */
const PERMISSION_REFUSALS: ReadonlySet<HarvestSkipReason> = new Set([
  "robots-disallowed",
  "robots-unreadable",
  "terms-forbid-commercial-use",
]);

/** True when a source is refused because we may not read it, not because it was empty. */
export function isRefusedOnPermission(source: HarvestSource): boolean {
  return !source.access.allowed && PERMISSION_REFUSALS.has(source.access.reason);
}


/** Drink overlay rows follow the same permission fence as every other harvest. */
export function isHarvestableDrinkUpdateUrl(value: unknown): boolean {
  if (typeof value !== "string" || !value.trim()) return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  if (url.username || url.password || namesOurOwnNetwork(url.hostname)) return false;
  return isHarvestableOperatorUrl(url.href);
}

/**
 * A chain menu transport is bound to one recorded publisher and its explicitly
 * associated first-party pub sites. Callers pass associated hosts only after
 * joining them to the publisher's curated venue records.
 */
export function isHarvestableChainMenuUrl(
  value: unknown,
  sourceId: string,
  associatedHosts: readonly string[] = [],
): boolean {
  const source = HARVEST_SOURCES.find(
    (row) => row.id === sourceId && row.kind === "chain-menu-prices",
  );
  if (!source?.access.allowed || !isHarvestableDrinkUpdateUrl(value)) return false;

  let url: URL;
  try {
    url = new URL(String(value).trim());
  } catch {
    return false;
  }
  if (url.port && !((url.protocol === "http:" && url.port === "80") || (url.protocol === "https:" && url.port === "443"))) {
    return false;
  }

  const normalizeHost = (host: string) => {
    const normalized = normalizeHarvestHostname(host);
    return normalized ? normalized.replace(/^www\./, "") : "";
  };
  const sourceHosts = [source.url, ...(source.renderedMenuHosts ?? [])]
    .map((entry) => {
      try {
        return normalizeHost(new URL(entry).hostname);
      } catch {
        return "";
      }
    })
    .filter(Boolean);
  const allowedHosts = new Set([
    ...sourceHosts,
    ...associatedHosts.map(normalizeHost),
  ]);
  return allowedHosts.has(normalizeHost(url.hostname));
}

/**
 * A venue's own site is first-party by definition, so it needs no table row -
 * but it still has to be a real http(s) origin we can attribute, and it may
 * never be one of the hosts we may not read, wearing a venue's name.
 *
 * The lanes that read a pub's own events page (scripts/harvest/run.mjs
 * `--events` and scripts/whatson/contextDevHarvest.mjs) were confirmed by the
 * captain on 28 Oct 2026 (survey question Q2, option a). Each one asks the
 * host's own robots.txt live, once per run, before it reads a page.
 */
const REFUSED_HOSTS = new Set([
  ...HARVEST_SOURCES.filter(isRefusedOnPermission).map((source) => {
    try {
      return normalizeHarvestHostname(new URL(source.url).hostname)?.replace(/^www\./, "") ?? source.url;
    } catch {
      return source.url;
    }
  }),
  ...REFUSED_ESTATE_HOSTS,
]);

/**
 * Hostname shapes that name THIS MACHINE or the network it sits on rather than
 * a pub's website.
 *
 * A menu URL is not something we typed: it arrives from
 * `harvest_venue_overlays.menu_url`, from a pub's OSM `website` tag, or from a
 * link on a page we crawled. So it is caller-influenced input reaching a
 * server-side fetch, and a loopback, link-local or private address there asks
 * our own infrastructure a question in the name of a pub. The cloud metadata
 * address (169.254.169.254) is the sharpest case and the reason this is a
 * REFUSAL rather than an ordinary miss.
 *
 * THE FAMILY IS DECIDED FIRST, and an address is read as an ADDRESS rather than
 * as a prefix. Reading the hostname as a string admitted the metadata address
 * in the one spelling a crafted value would use - the WHATWG parser normalises
 * `http://[::ffff:169.254.169.254]/` to `[::ffff:a9fe:a9fe]`, which is neither
 * `::1` nor dotted-quad shaped - and it refused every real pub whose name began
 * `fc` or `fd`, because a unique-local test written as `startsWith` was applied
 * to ordinary domains.
 *
 * What this cannot do is resolve a name: a DNS host that ANSWERS with a private
 * address is not covered by a pre-resolution check. The controls for that are
 * `harvestRedirectLanding`, which re-asks this predicate about the page a chain
 * landed on, and, if this gate ever guards a request-time route, an address
 * check after resolution.
 *
 * CGNAT (`100.64.0.0/10`), the benchmarking range (`198.18.0.0/15`) and the
 * reserved block (`240.0.0.0/4`) are this network too: a crafted website tag
 * that names one of them is a request to infrastructure that is not a pub.
 */
function namesOurOwnNetwork(hostname: string): boolean {
  const host = normalizeHarvestHostname(hostname);
  // `host..` is not a name we can attribute. Refuse it rather than compare
  // the unstripped spelling, which is how a trailing dot used to miss.
  if (host === null) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  // A colon is never part of a DNS name, so anything holding one is an IPv6
  // literal and is judged as one - including a literal we cannot parse, which
  // fails closed rather than walking through the dotted-quad regex below.
  if (host.includes(":")) return namesOurOwnIpv6Network(host);
  return namesOurOwnIpv4Address(host);
}

/**
 * One spelling of a host every harvest predicate compares.
 *
 * WHATWG keeps a single trailing dot on `hostname`, so `localhost.` and
 * `tobycarvery.co.uk.` missed every string compare and named this machine or
 * a refused estate. Lowercase, strip that one DNS-root dot, and return null
 * for a second trailing dot: `host..` is not a name.
 */
export function normalizeHarvestHostname(hostname: string): string | null {
  let host = hostname.trim().toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.endsWith(".")) {
    host = host.slice(0, -1);
    if (!host || host.endsWith(".")) return null;
  }
  return host || null;
}

/** The v4 rules, over a dotted quad. */
function namesOurOwnIpv4Address(host: string): boolean {
  const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!octets) return false;
  const parts = octets.slice(1).map(Number);
  if (parts.some((part) => part > 255)) return true;
  const [first, second] = parts;
  if (first === undefined || second === undefined) return false;
  return namesOurOwnIpv4Octets(first, second);
}

function namesOurOwnIpv4Octets(first: number, second: number): boolean {
  if (first === 0 || first === 127) return true;
  if (first === 10) return true;
  // 100.64.0.0/10, carrier-grade NAT. Not a pub, and not in the RFC1918 list.
  if (first === 100 && second >= 64 && second <= 127) return true;
  if (first === 169 && second === 254) return true;
  if (first === 172 && second >= 16 && second <= 31) return true;
  if (first === 192 && second === 168) return true;
  // 198.18.0.0/15, network interconnect benchmarking.
  if (first === 198 && (second === 18 || second === 19)) return true;
  // 240.0.0.0/4, reserved.
  if (first >= 240) return true;
  return false;
}

/**
 * The eight hextets of an IPv6 literal, or null when the text is not one.
 *
 * Handles the spellings a URL can carry: zero compression (`::`), a trailing
 * embedded dotted quad (`::ffff:169.254.169.254`), and a zone id (`%eth0`),
 * which names an interface of THIS machine and is stripped before the address
 * is read.
 */
function parseIpv6Hextets(value: string): number[] | null {
  let text = value.split("%")[0] ?? "";
  if (!text || !text.includes(":")) return null;

  // A trailing dotted quad is rewritten as the two hextets it IS, so there is
  // one parser rather than two shapes of one.
  const lastColon = text.lastIndexOf(":");
  const tail = text.slice(lastColon + 1);
  if (tail.includes(".")) {
    const octets = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(tail);
    if (!octets) return null;
    const parts = octets.slice(1).map(Number);
    if (parts.some((part) => part > 255)) return null;
    const [a = 0, b = 0, c = 0, d = 0] = parts;
    const high = ((a << 8) | b).toString(16);
    const low = ((c << 8) | d).toString(16);
    text = `${text.slice(0, lastColon + 1)}${high}:${low}`;
  }

  const halves = text.split("::");
  if (halves.length > 2) return null;

  const readGroups = (part: string): number[] | null => {
    if (!part) return [];
    const groups: number[] = [];
    for (const group of part.split(":")) {
      if (!/^[0-9a-f]{1,4}$/.test(group)) return null;
      groups.push(Number.parseInt(group, 16));
    }
    return groups;
  };

  const left = readGroups(halves[0] ?? "");
  const right = halves.length === 2 ? readGroups(halves[1] ?? "") : [];
  if (left === null || right === null) return null;

  if (halves.length === 2) {
    const zeros = 8 - left.length - right.length;
    if (zeros < 1) return null;
    return [...left, ...Array<number>(zeros).fill(0), ...right];
  }
  return left.length === 8 ? left : null;
}

/** The v4 address an IPv6 literal EMBEDS, as `[first, second]`, or null. */
function embeddedIpv4Octets(hextets: number[]): number[] | null {
  const at = (index: number): number => hextets[index] ?? 0;
  const fromPair = (high: number, low: number): number[] => [
    (high >> 8) & 0xff,
    high & 0xff,
    (low >> 8) & 0xff,
    low & 0xff,
  ];
  const leadingZero = at(0) === 0 && at(1) === 0 && at(2) === 0 && at(3) === 0 && at(4) === 0;
  // ::ffff:a.b.c.d (mapped) and ::a.b.c.d (deprecated compatible).
  if (leadingZero && (at(5) === 0xffff || at(5) === 0)) return fromPair(at(6), at(7));
  // 64:ff9b::/96, the well-known NAT64 prefix, which a gateway translates back
  // to the v4 address it embeds.
  if (at(0) === 0x0064 && at(1) === 0xff9b && at(2) === 0 && at(3) === 0
    && at(4) === 0 && at(5) === 0) return fromPair(at(6), at(7));
  // 2002::/16, 6to4, which embeds the v4 address in the next two hextets.
  if (at(0) === 0x2002) return fromPair(at(1), at(2));
  return null;
}

/** The v6 rules, by first-hextet RANGE rather than by string prefix. */
function namesOurOwnIpv6Network(host: string): boolean {
  const hextets = parseIpv6Hextets(host);
  if (!hextets) return true;
  const first = hextets[0] ?? 0;
  const embedded = embeddedIpv4Octets(hextets);
  if (embedded) {
    const [a, b] = embedded;
    if (namesOurOwnIpv4Octets(a ?? 0, b ?? 0)) return true;
  }
  // ::1 loopback and :: unspecified, which binds to every local interface.
  if (hextets.every((hextet, index) => (index === 7 ? hextet <= 1 : hextet === 0))) return true;
  if (first >= 0xfc00 && first <= 0xfdff) return true; // fc00::/7, unique local
  if (first >= 0xfe80 && first <= 0xfebf) return true; // fe80::/10, link-local
  if (first >= 0xfec0 && first <= 0xfeff) return true; // fec0::/10, site-local
  return false;
}

/**
 * True when the hostname IS a refused host or sits UNDER one.
 *
 * A refusal is about an operator, not about one string: `tobycarvery.co.uk`
 * and `menu.tobycarvery.co.uk` are the same estate answering the same way, so
 * refusing only the exact spelling would let every refused estate back in
 * through a subdomain while the table still claimed to hold it out.
 */
function underRefusedHost(hostname: string): boolean {
  const normalized = normalizeHarvestHostname(hostname);
  if (!normalized) return true;
  const host = normalized.replace(/^www\./, "");
  if (REFUSED_HOSTS.has(host)) return true;
  for (const refused of REFUSED_HOSTS) {
    if (host.endsWith(`.${refused}`)) return true;
  }
  return false;
}

/**
 * What a crawl lane may do with the page a redirect chain LANDED on.
 *
 * A redirect lets the host, not us, choose the last hop, so the permission we
 * asked about is not necessarily the permission we spent. Callers that use
 * `fetchFollowingPermittedRedirects` check each hop before its request.
 * This rule checks the final response independently.
 *
 * `refused` means the chain left the allow-list and the page is not ours to
 * read. `redirected` means it stayed inside and the row's provenance should
 * name where the words actually were, not where we knocked.
 */
export type HarvestRedirectLanding =
  | { outcome: "same"; url: string }
  | { outcome: "redirected"; url: string }
  | { outcome: "refused"; url: string };

export function harvestRedirectLanding(
  askedUrl: string,
  landedUrl: string | null | undefined,
): HarvestRedirectLanding {
  const landed = typeof landedUrl === "string" && landedUrl.trim() ? landedUrl.trim() : askedUrl;
  if (!isHarvestableOperatorUrl(landed)) return { outcome: "refused", url: landed };
  return { outcome: landed === askedUrl ? "same" : "redirected", url: landed };
}

export function isHarvestableOperatorUrl(value: unknown): value is string {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  // Credentials in a URL are sent to whatever the URL names, so a harvested one
  // is somebody else's secret heading for somebody else's host.
  if (url.username || url.password) return false;
  if (namesOurOwnNetwork(url.hostname)) return false;
  return !underRefusedHost(url.hostname);
}

/**
 * Hosts this table has ALREADY recorded a permission for, with evidence and a
 * day it was checked.
 *
 * This is what lets the Context.dev wrapper tell a page we have argued about
 * from an arbitrary URL. A host in here answered yes on a recorded date, so a
 * read of it needs no second question; every other host has to be asked live
 * before a credit is spent. The set is deliberately narrow: only rows whose
 * `access.allowed` is true, so a row refused on permission and a row refused
 * for `publishes-no-web-price` alike fall to the live check rather than
 * inheriting a permission the table never granted them.
 */
const PERMITTED_SOURCE_HOSTS: ReadonlySet<string> = new Set(
  HARVEST_SOURCES.filter(isHarvestSourceAllowed).flatMap((source) => {
    try {
      const host = normalizeHarvestHostname(new URL(source.url).hostname)?.replace(/^www\./, "");
      return host ? [host] : [];
    } catch {
      return [];
    }
  }),
);

/**
 * True when this table already holds a recorded permission for the URL's host.
 *
 * False is not a refusal. It means "nobody has written this host's answer
 * down", which is a reason to ask robots live, and `isHarvestableOperatorUrl`
 * stays the separate question of whether the host is one we may not read at
 * all.
 */
export function hasRecordedHarvestPermission(value: unknown): boolean {
  if (typeof value !== "string" || value.trim().length === 0) return false;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  const host = normalizeHarvestHostname(url.hostname);
  if (!host) return false;
  return PERMITTED_SOURCE_HOSTS.has(host.replace(/^www\./, ""));
}
