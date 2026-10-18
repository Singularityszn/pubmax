/**
 * WHICH HEADER NAMES THE CALLER, AND WHY NEVER THE LEFT-MOST ENTRY.
 *
 * `x-forwarded-for` is written by whoever sends the request first and appended
 * to by each proxy after that. So its LEFT-MOST entry is the one value in the
 * chain a client can always choose, and reading it as the caller's address lets
 * one machine mint an unlimited number of distinct rate-limit buckets by
 * changing a header. Taking `[0]` of that header is unsafe by construction,
 * whatever a given platform happens to do with it today.
 *
 * The order here is therefore: a header the PLATFORM sets and overwrites first,
 * and only then the right-most `x-forwarded-for` entry, which is the value the
 * hop closest to us appended rather than one the caller wrote. On Vercel the
 * platform headers are always present, so the fallback is the self-hosted lane
 * alone; a self-hosted deployment must still front this with a proxy that
 * overwrites or appends, because with no proxy at all every entry belongs to
 * the caller and no reading of that header can be trusted.
 *
 * A pure leaf: it imports nothing, so a bundle that needs this rule pulls no
 * server module behind it, and the rule is unit-testable with no request.
 */

/**
 * Headers a platform sets and overwrites, in preference order. Vercel documents
 * both: `x-vercel-forwarded-for` is the address Vercel itself resolved, and
 * `x-real-ip` mirrors it.
 */
export const PLATFORM_CLIENT_IP_HEADERS = [
  "x-vercel-forwarded-for",
  "x-real-ip",
] as const;

/** The header whose right-most entry is the untrusted fallback. */
export const FORWARDED_FOR_HEADER = "x-forwarded-for";

/** What a caller we could not name is called. Never an empty string. */
export const UNKNOWN_CLIENT_IP = "unknown";

// An IPv6 address with an embedded IPv4 tail is 45 characters at its longest.
const MAX_CLIENT_IP_LENGTH = 45;

// Shape only, never a parser: an address is hex digits, dots and colons, with
// an optional bracket pair and an optional zone id. Requiring a dot or a colon
// is what stops a word like "unknown" (a real, legal `x-forwarded-for` value)
// or a header injection attempt becoming a limiter bucket of its own.
const CLIENT_IP_SHAPE = /^\[?[0-9a-f]*(?:[.:][0-9a-f]*)+\]?(?:%[0-9a-z]{1,16})?$/i;

/** Is this candidate shaped like an address rather than free text? */
export function looksLikeClientIp(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > MAX_CLIENT_IP_LENGTH) return false;
  return CLIENT_IP_SHAPE.test(trimmed);
}

/**
 * The right-most address-shaped entry of an `x-forwarded-for` header, or null.
 * Right-most because that entry was appended by the hop nearest to us; every
 * entry to its left could have arrived in the caller's own request.
 */
export function trailingForwardedForEntry(header: string | null | undefined): string | null {
  if (!header) return null;
  const entries = header.split(",");
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const candidate = entries[index]?.trim() ?? "";
    if (looksLikeClientIp(candidate)) return candidate;
  }
  return null;
}

/**
 * Resolve the caller's address from a header reader. Takes the reader rather
 * than a Request so the rule can be exercised without one.
 */
export function resolveClientIp(readHeader: (name: string) => string | null | undefined): string {
  for (const name of PLATFORM_CLIENT_IP_HEADERS) {
    const value = readHeader(name)?.trim() ?? "";
    // A platform header carries one address, so an entry list here means the
    // platform did not write it. Read it the same cautious way regardless.
    const resolved = looksLikeClientIp(value) ? value : trailingForwardedForEntry(value);
    if (resolved) return resolved;
  }
  return trailingForwardedForEntry(readHeader(FORWARDED_FOR_HEADER)) ?? UNKNOWN_CLIENT_IP;
}

const HEXTET = /^[0-9a-f]{1,4}$/;
const DOTTED_QUAD = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

function dottedQuadToHextets(quad: string): string[] | null {
  const match = DOTTED_QUAD.exec(quad);
  if (!match) return null;
  const octets = match.slice(1).map(Number);
  if (octets.some((octet) => octet > 255)) return null;
  return [
    ((octets[0]! << 8) | octets[1]!).toString(16),
    ((octets[2]! << 8) | octets[3]!).toString(16),
  ];
}

/** The eight hextets of an IPv6 address, or null when it is not one. */
function expandIpv6(address: string): string[] | null {
  const halves = address.split("::");
  if (halves.length > 2) return null;
  const split = (half: string | undefined): string[] | null => {
    if (!half) return [];
    const groups = half.split(":");
    const last = groups[groups.length - 1] ?? "";
    if (last.includes(".")) {
      const tail = dottedQuadToHextets(last);
      if (!tail) return null;
      groups.splice(groups.length - 1, 1, ...tail);
    }
    return groups.every((group) => HEXTET.test(group)) ? groups : null;
  };
  const head = split(halves[0]);
  const tail = split(halves[1]);
  if (!head || !tail) return null;
  if (halves.length === 1) return head.length === 8 ? head : null;
  const missing = 8 - head.length - tail.length;
  if (missing < 1) return null;
  return [...head, ...Array<string>(missing).fill("0"), ...tail];
}

/**
 * The rate-limit bucket for an address: an IPv6 caller is its /64, everything
 * else is itself.
 *
 * One home connection or phone is handed a whole /64, so one machine can walk
 * through millions of IPv6 addresses without changing network. Keyed per full
 * address, every per-IP limit would be a per-request suggestion for such a
 * caller. An IPv4-mapped address (`::ffff:203.0.113.7`) is the IPv4 address
 * it carries. Input that is not a bare IPv6 address (an IPv4 address, a
 * composite key such as `${ip}:${planId}`, "unknown") comes back unchanged.
 */
export function rateLimitAddress(value: string): string {
  const bare = value.trim().replace(/^\[(.*)\]$/, "$1").replace(/%[0-9a-z]{1,16}$/i, "").toLowerCase();
  if (!bare.includes(":")) return value;
  const hextets = expandIpv6(bare);
  if (!hextets) return value;
  const groups = hextets.map((group) => parseInt(group, 16));
  if (groups.slice(0, 5).every((group) => group === 0) && groups[5] === 0xffff) {
    const [high, low] = [groups[6]!, groups[7]!];
    return `${high >> 8}.${high & 255}.${low >> 8}.${low & 255}`;
  }
  return `${groups.slice(0, 4).map((group) => group.toString(16)).join(":")}::/64`;
}
