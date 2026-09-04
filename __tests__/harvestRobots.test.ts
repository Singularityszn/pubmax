// The venue lanes follow whatever website the curated dataset holds, so the
// hand-written source table cannot cover them. This is the check that does:
// every host is asked, and a host that will not answer is refused.

import { describe, expect, it, vi } from "vitest";

import {
  createRobotsChecker,
  HARVEST_ROBOTS_AGENTS,
  parseRobotsTxt,
  robotsAllows,
} from "@/lib/harvest/robots";

function robotsResponse(body: string, status = 200): Response {
  return new Response(body, { status, headers: { "content-type": "text/plain" } });
}

describe("reading a robots.txt", () => {
  it("binds every user-agent named before a group's first rule", () => {
    const rules = parseRobotsTxt(`
User-agent: GPTBot
User-agent: CloudflareBrowserRenderingCrawler
Disallow: /

User-agent: *
Allow: /
`);
    expect(robotsAllows(rules, "/whats-on").allowed).toBe(false);
    expect(robotsAllows(rules, "/whats-on").agent).toBe("cloudflarebrowserrenderingcrawler");
  });

  it("treats an empty Disallow as no restriction at all", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow:\n");
    expect(robotsAllows(rules, "/anything").allowed).toBe(true);
  });

  it("matches on the longest prefix and lets a more specific Allow win", () => {
    const rules = parseRobotsTxt(`
User-agent: *
Disallow: /private/
Allow: /private/public-page
`);
    expect(robotsAllows(rules, "/private/secret").allowed).toBe(false);
    expect(robotsAllows(rules, "/private/public-page").allowed).toBe(true);
  });

  it("honours wildcard and end-anchored patterns", () => {
    const rules = parseRobotsTxt("User-agent: *\nDisallow: /*?session=\nDisallow: /tmp$\n");
    expect(robotsAllows(rules, "/page?session=1").allowed).toBe(false);
    expect(robotsAllows(rules, "/tmp").allowed).toBe(false);
    expect(robotsAllows(rules, "/tmpfiles").allowed).toBe(true);
  });

  it("ignores comments and unknown fields", () => {
    const rules = parseRobotsTxt(`
# a comment
Sitemap: https://example.com/sitemap.xml
Crawl-delay: 10
User-agent: *
Disallow: /basket   # trailing comment
`);
    expect(robotsAllows(rules, "/basket").allowed).toBe(false);
    expect(robotsAllows(rules, "/whats-on").allowed).toBe(true);
  });

  it("starts a new group when a user-agent line follows a rule", () => {
    const rules = parseRobotsTxt(`
User-agent: *
Disallow: /admin

User-agent: BadBot
Disallow: /
`);
    // "*" only loses /admin; BadBot's blanket rule is not ours to inherit.
    expect(robotsAllows(rules, "/whats-on").allowed).toBe(true);
    expect(robotsAllows(rules, "/admin").allowed).toBe(false);
  });

  it("answers to the renderer class as well as to the wildcard", () => {
    expect(HARVEST_ROBOTS_AGENTS).toContain("cloudflarebrowserrenderingcrawler");
    expect(HARVEST_ROBOTS_AGENTS).toContain("*");
  });
});

describe("asking a host before reading it", () => {
  it("permits a page the host allows", async () => {
    const fetchImpl = vi.fn(async () => robotsResponse("User-agent: *\nDisallow: /basket\n"));
    const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const decision = await check("https://thepub.co.uk/whats-on");
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("allowed");
  });

  it("refuses a page the host disallows for our renderer, and names the rule", async () => {
    const fetchImpl = vi.fn(async () =>
      robotsResponse("User-agent: *\nAllow: /\n\nUser-agent: CloudflareBrowserRenderingCrawler\nDisallow: /\n"),
    );
    const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const decision = await check("https://edinborocastlepub.co.uk/events");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("robots-disallowed");
    expect(decision.evidence).toContain("cloudflarebrowserrenderingcrawler");
  });

  it("refuses a host that answers robots.txt with a challenge page", async () => {
    const fetchImpl = vi.fn(async () => new Response("<!DOCTYPE html><title>Attention Required!</title>", { status: 403 }));
    const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const decision = await check("https://www.nicholsonspubs.co.uk/whats-on");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("robots-unreadable");
  });

  it("refuses a 200 body that is not a rules file", async () => {
    const fetchImpl = vi.fn(async () => robotsResponse("<html><body>Just a page</body></html>"));
    const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const decision = await check("https://example.com/whats-on");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("robots-unreadable");
  });

  // A RULES FILE WITH NO RULES IS STILL A RULES FILE. Each of these three
  // publishes no restriction, which is the same permission a 404 gives, and each
  // was refused before the gate asked about SHAPE rather than about a
  // `User-agent` line: 77, 36 and 45 UK pub hosts respectively on 2026-09-04.
  it.each([
    ["an empty file", ""],
    ["a file that names only its sitemap", "Sitemap: https://smallpub.co.uk/sitemap.xml\n"],
    ["a file that is comments to the last line", "# As a condition of accessing this website\n# you agree to the following content signals:\n"],
  ])("permits a page over %s", async (_name, body) => {
    const fetchImpl = vi.fn(async () => robotsResponse(body));
    const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const decision = await check("https://smallpub.co.uk/drinks");
    expect(decision.allowed).toBe(true);
  });

  it("carries the sitemap out of a file that names nothing else", async () => {
    const fetchImpl = vi.fn(async () => robotsResponse("Sitemap: https://smallpub.co.uk/sitemap.xml\n"));
    const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const decision = await check("https://smallpub.co.uk/drinks");
    expect(decision.sitemaps).toEqual(["https://smallpub.co.uk/sitemap.xml"]);
  });

  it("reads a file that opens with a byte-order mark", async () => {
    const fetchImpl = vi.fn(async () => robotsResponse("\uFEFFUser-agent: *\nDisallow: /admin\n"));
    const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((await check("https://smallpub.co.uk/drinks")).allowed).toBe(true);
    expect((await check("https://smallpub.co.uk/admin")).reason).toBe("robots-disallowed");
  });

  it("still refuses an HTML page served where a rules file should be, however long it runs", async () => {
    const page = `<!DOCTYPE html>\n<html lang="en">\n<head><meta http-equiv="refresh" content="0;url=https://smallpub.co.uk/"></head>\n<body>404</body>\n</html>`;
    const fetchImpl = vi.fn(async () => robotsResponse(page));
    const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const decision = await check("https://smallpub.co.uk/drinks");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("robots-unreadable");
  });

  it("permits everything when a host publishes no robots.txt at all", async () => {
    const fetchImpl = vi.fn(async () => new Response("not found", { status: 404 }));
    const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const decision = await check("https://smallpub.co.uk/whats-on");
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("no-rules-published");
  });

  // A NETWORK FAILURE IS NOT A REFUSAL. The page is still not taken, and the
  // finding is named for what happened rather than for permission nobody
  // withheld.
  it("names a host it could not reach unreachable rather than refusing us", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new Error("getaddrinfo ENOTFOUND");
    });
    const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const decision = await check("https://gone.example/whats-on");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("robots-unreachable");
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("keeps a host that answers on the second ask", async () => {
    let asked = 0;
    const fetchImpl = vi.fn(async () => {
      asked += 1;
      if (asked === 1) throw new Error("UND_ERR_CONNECT_TIMEOUT");
      return robotsResponse("User-agent: *\nDisallow: /admin\n");
    });
    const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const decision = await check("https://slowpub.co.uk/drinks");
    expect(decision.allowed).toBe(true);
  });

  it("does not ask a host that ANSWERED a second time", async () => {
    const fetchImpl = vi.fn(async () => robotsResponse("<html>nope</html>"));
    const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await check("https://refused.example/drinks");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("asks each host once per run, however many pages it reads", async () => {
    const fetchImpl = vi.fn(async () => robotsResponse("User-agent: *\nDisallow:\n"));
    const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    await Promise.all([
      check("https://thepub.co.uk/"),
      check("https://thepub.co.uk/whats-on"),
      check("https://otherpub.co.uk/"),
    ]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("refuses anything that is not an absolute url", async () => {
    const fetchImpl = vi.fn();
    const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const decision = await check("/whats-on");
    expect(decision.allowed).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
