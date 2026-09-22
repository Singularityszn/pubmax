// The venue lanes follow whatever website the curated dataset holds, so the
// hand-written source table cannot cover them. This is the check that does:
// every host is asked, and a host that will not answer is refused.

import { describe, expect, it, vi } from "vitest";

import {
  CHALLENGE_PAGE_SIGNATURES,
  createRobotsChecker,
  HARVEST_ROBOTS_AGENTS,
  looksLikeChallengePage,
  looksLikeHtmlDocument,
  parseRobotsTxt,
  robotsAllows,
} from "@/lib/harvest/robots";

// FIXTURE BODIES. Each is the shape of something a UK pub host really served at
// /robots.txt during the 2026-09-04 crawl, cut to what the classifier reads.
const ORDINARY_HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>The Red Lion, Barnes | Home</title>
<link rel="stylesheet" href="/assets/site.css">
</head>
<body>
<nav><a href="/">Home</a> <a href="/drinks">Drinks</a> <a href="/food">Food</a></nav>
<h1>Welcome to The Red Lion</h1>
<p>Open every day from noon. Real ale, Sunday roasts, dogs welcome.</p>
</body>
</html>`;

const CLOUDFLARE_CHALLENGE_PAGE = `<!DOCTYPE html>
<html lang="en-US">
<head>
<title>Just a moment...</title>
<meta http-equiv="refresh" content="390">
</head>
<body class="no-js">
<div class="main-wrapper" role="main">
<h1>www.nicholsonspubs.co.uk</h1>
<p>Verifying you are human. This may take a few seconds.</p>
<script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1?ray=abc"></script>
</div>
</body>
</html>`;

const REAL_RULES_FILE = `# The Red Lion
User-agent: *
Disallow: /admin/
Disallow: /basket
Sitemap: https://redlionbarnes.co.uk/sitemap.xml
`;

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
  it("refuses a robots redirect before contacting its target", async () => {
    const fetchImpl = vi.fn(async (_input: string | URL | Request, _init?: RequestInit) => new Response("", {
      status: 302, headers: { location: "http://169.254.169.254/latest/meta-data/" },
    }));
    const check = createRobotsChecker({ fetchImpl: fetchImpl as typeof fetch });
    await expect(check("https://thepub.co.uk/drinks")).resolves.toMatchObject({
      allowed: false, reason: "robots-unreadable", robots: "http-refused",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe("https://thepub.co.uk/robots.txt");
    expect(fetchImpl.mock.calls[0]?.[1]).toMatchObject({ redirect: "manual" });
  });
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

  it("refuses a host that answers robots.txt with a challenge page on a 403", async () => {
    const fetchImpl = vi.fn(async () => new Response("<!DOCTYPE html><title>Attention Required!</title>", { status: 403 }));
    const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const decision = await check("https://www.nicholsonspubs.co.uk/whats-on");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("robots-unreadable");
    expect(decision.robots).toBe("challenge-page");
  });

  it("refuses a 200 body that is neither a rules file nor an HTML document", async () => {
    const fetchImpl = vi.fn(async () => robotsResponse('{"error":"not found"}'));
    const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const decision = await check("https://example.com/whats-on");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("robots-unreadable");
    expect(decision.robots).toBe("not-a-rules-file");
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

  // AN ORDINARY HTML PAGE ON A 200 IS AN ABSENT RULES FILE. Captain's ruling of
  // 2026-09-05 ("Crawl them") over the 254 UK pub hosts that route /robots.txt
  // to their own site: no rules were published, which RFC 9309 section
  // 2.3.1.3 reads as no restriction, the same permission a 404 gives.
  describe("an ordinary HTML page served where a rules file should be", () => {
    it("is read as no rules published, and says so on the decision", async () => {
      const fetchImpl = vi.fn(async () => robotsResponse(ORDINARY_HTML_PAGE));
      const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
      const decision = await check("https://redlionbarnes.co.uk/drinks");
      expect(decision.allowed).toBe(true);
      expect(decision.reason).toBe("no-rules-published");
      expect(decision.robots).toBe("html-page");
      expect(decision.evidence).toContain("RFC 9309");
      expect(decision.sitemaps).toBeUndefined();
    });

    it("admits a site's own 404 page that refreshes to its home page", async () => {
      const page = `<!DOCTYPE html>\n<html lang="en">\n<head><meta http-equiv="refresh" content="0;url=https://smallpub.co.uk/"></head>\n<body>404</body>\n</html>`;
      const fetchImpl = vi.fn(async () => robotsResponse(page));
      const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
      const decision = await check("https://smallpub.co.uk/drinks");
      expect(decision.allowed).toBe(true);
      expect(decision.robots).toBe("html-page");
    });

    it("admits a document root behind a byte-order mark, an XML declaration or a leading comment", () => {
      expect(looksLikeHtmlDocument("\uFEFF<!DOCTYPE html><html></html>")).toBe(true);
      expect(looksLikeHtmlDocument('<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n<html></html>')).toBe(true);
      expect(looksLikeHtmlDocument("<!-- built 2026 -->\n<html lang=\"en\"><body></body></html>")).toBe(true);
      expect(looksLikeHtmlDocument("  <html>\n")).toBe(true);
    });

    it("does not admit a fragment, a stray tag or a body that merely mentions html", () => {
      expect(looksLikeHtmlDocument("<div>Just a page</div>")).toBe(false);
      expect(looksLikeHtmlDocument("<body>404</body>")).toBe(false);
      expect(looksLikeHtmlDocument("Not found. <html> would be here.")).toBe(false);
      expect(looksLikeHtmlDocument("")).toBe(false);
      expect(looksLikeHtmlDocument('{"html":"<html>"}')).toBe(false);
    });

    it("does not admit a rules file, whose Disallow lines are still honoured", async () => {
      const fetchImpl = vi.fn(async () => robotsResponse(REAL_RULES_FILE));
      const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
      const drinks = await check("https://redlionbarnes.co.uk/drinks");
      expect(drinks.allowed).toBe(true);
      expect(drinks.reason).toBe("allowed");
      expect(drinks.robots).toBe("rules-file");
      expect(drinks.sitemaps).toEqual(["https://redlionbarnes.co.uk/sitemap.xml"]);
      const admin = await check("https://redlionbarnes.co.uk/admin/users");
      expect(admin.allowed).toBe(false);
      expect(admin.reason).toBe("robots-disallowed");
      expect(admin.robots).toBe("rules-file");
      expect(looksLikeHtmlDocument(REAL_RULES_FILE)).toBe(false);
    });
  });

  // A CHALLENGE IS A DOOR, NOT A PAGE. The admission above is for a host that
  // served its site; a host that served an interstitial served nothing we were
  // let through to, and it stays refused at every status.
  describe("a challenge page served where a rules file should be", () => {
    it("stays refused on a 200", async () => {
      const fetchImpl = vi.fn(async () => robotsResponse(CLOUDFLARE_CHALLENGE_PAGE));
      const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
      const decision = await check("https://www.nicholsonspubs.co.uk/whats-on");
      expect(decision.allowed).toBe(false);
      expect(decision.reason).toBe("robots-unreadable");
      expect(decision.robots).toBe("challenge-page");
    });

    it.each([
      ["Cloudflare, Just a moment", "<!DOCTYPE html><html><head><title>Just a moment...</title></head><body></body></html>"],
      ["Cloudflare, Attention Required", "<!DOCTYPE html><html><head><title>Attention Required! | Cloudflare</title></head></html>"],
      ["Cloudflare, challenge platform script", '<html><head><script src="/cdn-cgi/challenge-platform/h/b/orchestrate/chl_page/v1"></script></head></html>'],
      ["Akamai, edgesuite reference", '<html><head><title>Access Denied</title></head><body>Reference #18.abc<br>https://errors.edgesuite.net/18.abc</body></html>'],
      ["hCaptcha widget", '<html><body><div class="h-captcha" data-sitekey="abc"></div></body></html>'],
      ["meta refresh into a challenge", '<html><head><meta http-equiv="refresh" content="0;url=/cdn-cgi/challenge-platform/?r=1"></head></html>'],
      ["meta refresh into a captcha", '<html><head><meta http-equiv="refresh" content="1; URL=https://geo.captcha-delivery.com/captcha/?initialCid=x"></head></html>'],
    ])("recognises %s", (_name, body) => {
      expect(looksLikeChallengePage(body)).toBe(true);
    });

    it("does not read an ordinary page, or a rules file, as a challenge", () => {
      expect(looksLikeChallengePage(ORDINARY_HTML_PAGE)).toBe(false);
      expect(looksLikeChallengePage(REAL_RULES_FILE)).toBe(false);
      expect(looksLikeChallengePage("")).toBe(false);
    });

    // Cloudflare injects its detection beacon into EVERY page served behind Bot
    // Fight Mode, ordinary home pages included; measured on 2026-09-05, the bare
    // challenge-platform prefix refused 14 pub home pages that had let us in.
    it("does not read Cloudflare's per-page detection beacon as a challenge", () => {
      const page = `<!DOCTYPE html><html lang="en-GB"><head><title>Home - The Crown Cirencester</title></head><body><h1>The Crown</h1><script src="/cdn-cgi/challenge-platform/scripts/jsd/main.js"></script></body></html>`;
      expect(looksLikeChallengePage(page)).toBe(false);
      expect(looksLikeHtmlDocument(page)).toBe(true);
    });

    it("does not read a site's own redirect to its home page as a challenge", () => {
      expect(looksLikeChallengePage('<html><head><meta http-equiv="refresh" content="0;url=https://smallpub.co.uk/"></head></html>')).toBe(false);
    });

    it("keeps its signature table closed, with every row naming its vendor", () => {
      expect(CHALLENGE_PAGE_SIGNATURES.length).toBeGreaterThan(0);
      for (const row of CHALLENGE_PAGE_SIGNATURES) {
        expect(row.vendor.length).toBeGreaterThan(0);
        expect(row.mark).toBe(row.mark.toLowerCase());
      }
    });
  });

  // NOTHING ELSE IS LOOSENED. A status that refuses us refuses us whatever the
  // body says, an ordinary HTML page included.
  it.each([401, 403, 429, 500, 502, 503])("still refuses a %s, even when its body is an ordinary page", async (status) => {
    const fetchImpl = vi.fn(async () => new Response(ORDINARY_HTML_PAGE, { status, headers: { "content-type": "text/html" } }));
    const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const decision = await check("https://smallpub.co.uk/drinks");
    expect(decision.allowed).toBe(false);
    expect(decision.reason).toBe("robots-unreadable");
    expect(decision.robots).toBe("http-refused");
  });

  it("permits everything when a host publishes no robots.txt at all", async () => {
    const fetchImpl = vi.fn(async () => new Response("not found", { status: 404 }));
    const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const decision = await check("https://smallpub.co.uk/whats-on");
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("no-rules-published");
    expect(decision.robots).toBe("absent");
  });

  // A RESPONSE NOBODY READS IS A CONNECTION NOBODY CLOSES. The 404 branch takes
  // its answer from the status alone, so the body it never looks at has to be
  // let go of rather than left holding the socket open on a host we have
  // finished asking.
  it("lets go of the body on a 404 it never reads", async () => {
    let cancelled = false;
    const fetchImpl = vi.fn(async () => {
      const response = new Response("not found", { status: 404 });
      const body = response.body;
      if (!body) throw new Error("the fixture needs a body to cancel");
      const originalCancel = body.cancel.bind(body);
      body.cancel = async (reason?: unknown) => {
        cancelled = true;
        return originalCancel(reason);
      };
      return response;
    });
    const check = createRobotsChecker({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const decision = await check("https://smallpub.co.uk/whats-on");
    expect(decision.allowed).toBe(true);
    expect(decision.reason).toBe("no-rules-published");
    await Promise.resolve();
    expect(cancelled).toBe(true);
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
    expect(decision.robots).toBe("unreachable");
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
    const fetchImpl = vi.fn(async () => robotsResponse('{"nope":true}'));
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
