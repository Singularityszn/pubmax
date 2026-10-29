// THE OPERATOR AND MENU URL ALLOW-LIST, ASKED THE QUESTIONS AN ATTACKER ASKS.
//
// Astra's delta audit (6 Sep 2026, F07) asked for the authorization surface to
// be proved behaviourally rather than reasoned about. This file is the half of
// that work which is not about accounts: a URL this repository decides to
// FETCH is caller-influenced input reaching a server-side request, and the
// predicate in front of it is the whole of the decision.
//
// WHERE THESE URLS COME FROM, which is why the bar is this high. A menu URL is
// read off `harvest_venue_overlays.menu_url`, a pub's OSM `website` tag, or a
// link on a page a crawl already fetched. Nobody here types one. So the
// predicate is asked about strings that other people wrote, and the same
// predicate gates every URL-taking Context.dev call, where a passing URL also
// spends credit.
//
// FOUR CLASSES, and the last one is the one a single-URL check cannot see:
// unsafe schemes, hosts we may not read, hosts that name our own network, and
// the page a REDIRECT CHAIN landed on.

import { describe, expect, it, vi } from "vitest";

import {
  harvestRedirectLanding,
  isHarvestableOperatorUrl,
  REFUSED_ESTATE_HOSTS,
} from "@/lib/harvest/sourcePolicy";
import { defined } from "@/__tests__/helpers/defined";
import { fetchText } from "../scripts/harvest/uk-prices/run.mjs";
import { fetchPage } from "../scripts/harvest/uk-prices/ocr.mjs";
import { createRobotsChecker } from "@/lib/harvest/robots";

/** A host the table refuses on permission, used as the worked example below. */
const REFUSED_ESTATE = defined(REFUSED_ESTATE_HOSTS[0]);
/** A pub's own site, which is first-party by definition and needs no table row. */
const PERMITTED = "https://www.arnosarms.co.uk/menu";

describe("unsafe schemes", () => {
  it("admits http and https and refuses every other way of naming bytes", () => {
    expect(isHarvestableOperatorUrl("http://example.com/menu")).toBe(true);
    expect(isHarvestableOperatorUrl("https://example.com/menu")).toBe(true);

    for (const candidate of [
      "javascript:alert(document.cookie)",
      "data:text/html;base64,PHNjcmlwdD4x",
      "file:///etc/passwd",
      "ftp://example.com/menu.pdf",
      "gopher://example.com/",
      "blob:https://example.com/1234",
      "jAvAsCrIpT:alert(1)",
    ]) {
      expect(isHarvestableOperatorUrl(candidate), candidate).toBe(false);
    }
  });

  it("refuses anything that is not an absolute URL at all", () => {
    for (const candidate of ["", "   ", "/menu", "//example.com/menu", "example.com", null, undefined, 42, {}]) {
      expect(isHarvestableOperatorUrl(candidate), String(candidate)).toBe(false);
    }
  });

  it("refuses a URL carrying credentials, because they are sent to whoever it names", () => {
    expect(isHarvestableOperatorUrl("https://user:secret@example.com/menu")).toBe(false);
    expect(isHarvestableOperatorUrl("https://user@example.com/menu")).toBe(false);
  });
});

describe("hosts we may not read", () => {
  it("refuses a recorded estate host however it is spelled", () => {
    expect(isHarvestableOperatorUrl(`https://${REFUSED_ESTATE}/menu`)).toBe(false);
    expect(isHarvestableOperatorUrl(`https://www.${REFUSED_ESTATE}/menu`)).toBe(false);
    expect(isHarvestableOperatorUrl(`https://${REFUSED_ESTATE.toUpperCase()}/menu`)).toBe(false);
    expect(isHarvestableOperatorUrl(`https://www.${REFUSED_ESTATE}./menu`)).toBe(false);
    expect(isHarvestableOperatorUrl(`https://${REFUSED_ESTATE.toUpperCase()}./menu`)).toBe(false);
  });

  it("refuses a SUBDOMAIN of a refused host, because a refusal is about an operator", () => {
    // Before this rule, `menu.tobycarvery.co.uk` was harvestable while
    // `tobycarvery.co.uk` was refused, so every refused estate had a way back
    // in that the table still claimed to hold shut.
    for (const estate of REFUSED_ESTATE_HOSTS) {
      expect(isHarvestableOperatorUrl(`https://menu.${estate}/drinks`), estate).toBe(false);
      expect(isHarvestableOperatorUrl(`https://a.b.${estate}/drinks`), estate).toBe(false);
    }
  });

  it("does not refuse a DIFFERENT host that merely contains a refused name", () => {
    // The suffix rule matches on a label boundary, so a look-alike domain is a
    // different operator and is judged on its own permission rather than
    // inheriting somebody else's refusal.
    expect(isHarvestableOperatorUrl(`https://${REFUSED_ESTATE}.evil.example/menu`)).toBe(true);
    expect(isHarvestableOperatorUrl(`https://not-${REFUSED_ESTATE}/menu`)).toBe(true);
    expect(isHarvestableOperatorUrl(PERMITTED)).toBe(true);
  });
});

describe("hosts that name our own network", () => {
  it("refuses loopback, link-local, private and metadata addresses", () => {
    for (const host of [
      "localhost",
      "app.localhost",
      "127.0.0.1",
      "127.1.1.1",
      "0.0.0.0",
      "10.0.0.5",
      "172.16.4.4",
      "172.31.255.255",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.0",
      "100.100.100.200",
      "100.127.255.255",
      "198.18.0.1",
      "198.19.255.255",
      "240.0.0.1",
      "255.255.255.255",
      "[::1]",
      "printer.local",
      "vault.internal",
    ]) {
      expect(isHarvestableOperatorUrl(`http://${host}/menu`), host).toBe(false);
      expect(isHarvestableOperatorUrl(`https://${host}/menu`), host).toBe(false);
    }
  });

  it("still admits ordinary public addresses, so the rule is a fence and not a ban", () => {
    for (const host of [
      "11.0.0.1",
      "172.32.0.1",
      "192.169.0.1",
      "8.8.8.8",
      "100.63.255.255",
      "100.128.0.1",
      "198.17.255.255",
      "198.20.0.1",
      "239.255.255.255",
    ]) {
      expect(isHarvestableOperatorUrl(`https://${host}/menu`), host).toBe(true);
    }
  });

  it("reads an IPv6 literal as an ADDRESS, in every spelling of it", () => {
    // The predicate used to test the hostname as a string, so it saw only the
    // spellings it enumerated. The WHATWG parser normalises
    // `[::ffff:169.254.169.254]` to `[::ffff:a9fe:a9fe]`, which is neither
    // `::1` nor dotted-quad shaped, so the cloud metadata address - the one
    // this refusal names out loud - was admitted in the form a crafted OSM
    // `website` tag would use.
    for (const host of [
      // Loopback and the unspecified address, compressed and written out.
      "::1",
      "0:0:0:0:0:0:0:1",
      "::",
      "0000:0000:0000:0000:0000:0000:0000:0000",
      // IPv4-mapped: the metadata address, loopback and the private ranges,
      // in the dotted form and in the hex form one normalises to.
      "::ffff:169.254.169.254",
      "::ffff:a9fe:a9fe",
      "::FFFF:A9FE:A9FE",
      "::ffff:127.0.0.1",
      "::ffff:7f00:1",
      "::ffff:10.1.2.3",
      "::ffff:192.168.1.1",
      "::ffff:172.16.0.1",
      "::ffff:100.64.0.1",
      "::ffff:198.18.0.1",
      "::ffff:240.0.0.1",
      // The deprecated IPv4-compatible form, NAT64 and 6to4, each of which a
      // gateway translates back to the v4 address it carries.
      "::169.254.169.254",
      "64:ff9b::169.254.169.254",
      "2002:a9fe:a9fe::",
      // Link-local, site-local and unique-local, by first-hextet range.
      "fe80::1",
      "fe80::1%25eth0",
      "febf::1",
      "fec0::1",
      "fc00::1",
      "fd12:3456:789a::1",
      "FD00::1",
      // A literal we cannot read is refused rather than walked past.
      "::ffff:999.1.1.1",
      "12345::1",
    ]) {
      expect(isHarvestableOperatorUrl(`http://[${host}]/latest/meta-data/`), host).toBe(false);
      expect(isHarvestableOperatorUrl(`https://[${host}]/menu`), host).toBe(false);
    }
  });

  it("still admits a public IPv6 address", () => {
    for (const host of ["2001:4860:4860::8888", "2606:4700::1111"]) {
      expect(isHarvestableOperatorUrl(`https://[${host}]/menu`), host).toBe(true);
    }
  });

  it("treats one trailing dot as the same host and refuses a second", () => {
    expect(isHarvestableOperatorUrl("http://localhost./admin")).toBe(false);
    expect(isHarvestableOperatorUrl("http://metadata.google.internal./")).toBe(false);
    expect(isHarvestableOperatorUrl("https://example.com./menu")).toBe(true);
    expect(isHarvestableOperatorUrl("https://example.com../menu")).toBe(false);
    expect(isHarvestableOperatorUrl("http://127.0.0.1./")).toBe(false);
  });

  it("judges a hostname that merely BEGINS fc or fd on its own permission", () => {
    // `startsWith("fc")` / `startsWith("fd")` was applied to every hostname
    // rather than to a parsed IPv6 literal, so ordinary pubs and clubs were
    // refused as though they were unique-local addresses.
    for (const host of ["fcbarcelona.com", "fdgreatpubs.co.uk", "fe80pub.co.uk", "feathersinn.co.uk"]) {
      expect(isHarvestableOperatorUrl(`https://${host}/menu`), host).toBe(true);
    }
  });
});

describe("the page a redirect chain landed on", () => {
  it("refuses a chain that leaves the allow-list, whatever we asked for", () => {
    const landing = harvestRedirectLanding(PERMITTED, `https://${REFUSED_ESTATE}/drinks`);
    expect(landing.outcome).toBe("refused");
    expect(landing.url).toBe(`https://${REFUSED_ESTATE}/drinks`);
  });

  it("refuses a chain that lands on our own network or on an unsafe scheme", () => {
    expect(harvestRedirectLanding(PERMITTED, "http://169.254.169.254/latest/meta-data/").outcome)
      .toBe("refused");
    expect(harvestRedirectLanding(PERMITTED, "file:///etc/passwd").outcome).toBe("refused");
  });

  it("names a permitted redirect as a redirect, so provenance can follow the words", () => {
    const moved = harvestRedirectLanding(PERMITTED, "https://www.arnosarms.co.uk/food-and-drink");
    expect(moved).toEqual({
      outcome: "redirected",
      url: "https://www.arnosarms.co.uk/food-and-drink",
    });
  });

  it("reads no redirect at all as the page we asked for", () => {
    for (const landed of [PERMITTED, null, undefined, "", "   "]) {
      expect(harvestRedirectLanding(PERMITTED, landed)).toEqual({
        outcome: "same",
        url: PERMITTED,
      });
    }
  });
});

describe.each([
  { lane: "UK text prices", fetchPage: fetchText },
  { lane: "UK OCR prices", fetchPage },
])("$lane redirect permission contract", ({ fetchPage }) => {
  const moved = "https://www.arnosarms.co.uk/drinks";
  const allow = async (url: string) => ({ allowed: true, reason: "allowed" as const, evidence: `${url} permitted` });

  it.each([
    "http://127.0.0.1/admin",
    `https://${REFUSED_ESTATE}/menu`,
    "file:///etc/passwd",
  ])("never requests a policy-refused redirect target: %s", async (refused) => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url === PERMITTED) return new Response(null, { status: 302, headers: { location: moved } });
      if (url === moved) return new Response(null, { status: 302, headers: { location: refused } });
      return new Response("This refused page must not be requested.");
    });
    const robots = vi.fn(allow);

    const result = await fetchPage(PERMITTED, { fetchImpl, robots });

    expect(result).toMatchObject({ ok: false, reason: "redirect-refused", body: "", finalUrl: refused });
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([PERMITTED, moved]);
    expect(robots.mock.calls).toEqual([[moved]]);
  });

  it("never requests a redirect target that robots refuses", async () => {
    const refused = "https://www.arnosarms.co.uk/private/menu";
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      const location = url === PERMITTED ? moved : refused;
      return new Response(null, { status: 302, headers: { location } });
    });
    const robots = vi.fn(async (url: string) => ({
      allowed: url !== refused,
      reason: "robots-disallowed" as const,
      evidence: `${url} checked`,
    }));

    const result = await fetchPage(PERMITTED, { fetchImpl, robots });

    expect(result).toMatchObject({ ok: false, reason: "robots-disallowed", body: "", finalUrl: refused });
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([PERMITTED, moved]);
    expect(robots.mock.calls).toEqual([[moved], [refused]]);
  });

  it("refuses a page when its robots file redirects to a refused target", async () => {
    const robotsUrl = "https://www.arnosarms.co.uk/robots.txt";
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      const location = url === PERMITTED ? moved : "http://127.0.0.1/admin";
      return new Response(null, { status: 302, headers: { location } });
    });

    const result = await fetchPage(PERMITTED, { fetchImpl, robots: createRobotsChecker({ fetchImpl }) });

    expect(result).toMatchObject({ ok: false, reason: "robots-unreadable", body: "", finalUrl: moved });
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([PERMITTED, robotsUrl]);
  });

  it.each(["text/html", "application/pdf"])("refuses an unexpected %s landing before reading its body", async (type) => {
    const refused = `https://${REFUSED_ESTATE}/menu`;
    const response = new Response("This refused body must not be read.", { headers: { "content-type": type } });
    Object.defineProperty(response, "url", { value: refused });
    const readBody = vi.spyOn(response, "text");
    const readBytes = vi.spyOn(response, "arrayBuffer");
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      String(input) === PERMITTED
        ? new Response(null, { status: 302, headers: { location: moved } })
        : response,
    );

    const result = await fetchPage(PERMITTED, { fetchImpl, robots: allow });

    expect(result).toMatchObject({ ok: false, reason: "redirect-refused", body: "", finalUrl: refused });
    expect(readBody).not.toHaveBeenCalled();
    expect(readBytes).not.toHaveBeenCalled();
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([PERMITTED, moved]);
  });

  it.each([
    { failure: "same-host loop", location: "/menu", reason: "redirect-hop-limit", requests: 6 },
    { failure: "invalid Location", location: "http://[", reason: "redirect-unreadable", requests: 1 },
  ])("preserves the $reason reason for a $failure", async ({ location, reason, requests }) => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      new Response(null, { status: 302, headers: { location } }),
    );

    const result = await fetchPage(PERMITTED, { fetchImpl, robots: allow });

    expect(result).toMatchObject({ ok: false, status: 302, body: "", reason, finalUrl: PERMITTED });
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual(Array(requests).fill(PERMITTED));
  });

  it("returns the final permitted page and its URL after a relative redirect", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      String(input) === PERMITTED
        ? new Response(null, { status: 302, headers: { location: "/drinks" } })
        : new Response("The pub's drinks menu.", { headers: { "content-type": "text/html" } }),
    );
    const robots = vi.fn(allow);

    const result = await fetchPage(PERMITTED, { fetchImpl, robots });

    expect(result).toMatchObject({ ok: true, status: 200, body: "The pub's drinks menu.", finalUrl: moved });
    expect(fetchImpl.mock.calls.map(([url]) => String(url))).toEqual([PERMITTED, moved]);
    expect(fetchImpl.mock.calls.every(([, init]) => init?.redirect === "manual")).toBe(true);
    expect(robots.mock.calls).toEqual([[moved]]);
  });
});
