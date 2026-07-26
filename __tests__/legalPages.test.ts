import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { describe, expect, it } from "vitest";
import ts from "typescript";

import { CONTACT_EMAIL } from "@/lib/siteContact";

// The /privacy + /terms fence. These pages are the only surfaces where the site
// makes promises about data ON THE RECORD, so the regressions that matter are
// (a) a reader who cannot find them, (b) a dead contact address, and (c) a
// privacy claim drifting away from what the code does. Source-level assertions,
// the same house pattern as landingChromeCss.test.ts: they fail in CI rather
// than needing a browser pass we can't run headless.

function read(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

const ROOT = process.cwd();

function collectSourceFiles(dir: string, files: string[]): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      if (entry !== "__tests__") collectSourceFiles(path, files);
    } else if (/\.tsx?$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      files.push(path);
    }
  }
}

function allSourceFiles(): string[] {
  const files: string[] = [];
  for (const dir of ["app", "components", "lib"]) {
    collectSourceFiles(join(ROOT, dir), files);
  }
  return files;
}

function fetchWindows(source: string): string[] {
  const windows: string[] = [];
  for (const match of source.matchAll(/\b(?:fetch|fetchImpl)\s*\(/g)) {
    windows.push(source.slice(Math.max(0, match.index - 300), match.index + 1_500));
  }
  return windows;
}

function fetchArguments(path: string, source: string): string[] {
  const sourceFile = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    path.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const argumentsList: string[] = [];
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node)) {
      const callee = node.expression.getText(sourceFile);
      if (callee === "fetch" || callee === "fetchImpl") {
        argumentsList.push(node.arguments.map((argument) => argument.getText(sourceFile)).join("\n"));
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return argumentsList;
}

function localImportPath(from: string, specifier: string): string | null {
  const base = specifier.startsWith("@/")
    ? join(ROOT, specifier.slice(2))
    : specifier.startsWith(".")
      ? resolve(dirname(from), specifier)
      : null;
  if (!base) return null;
  for (const candidate of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(candidate) && statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function importClosure(start: string): Set<string> {
  const files = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const path = queue.pop();
    if (!path || files.has(path)) continue;
    files.add(path);
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const imported = localImportPath(path, match[1]);
      if (imported) queue.push(imported);
    }
  }
  return files;
}

function coordinateProviderImports(route: string): Set<string> {
  const source = readFileSync(route, "utf8");
  const sourceFile = ts.createSourceFile(
    route,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  const imports = new Map<string, string>();
  for (const statement of sourceFile.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const imported = localImportPath(route, statement.moduleSpecifier.text);
    const bindings = statement.importClause?.namedBindings;
    if (!imported || !bindings || !ts.isNamedImports(bindings)) continue;
    for (const element of bindings.elements) imports.set(element.name.text, imported);
  }

  const providers = new Set<string>();
  const pointArgument = /\b(?:lat|lng|lon|point|from|to|near)\b/i;
  function visit(node: ts.Node): void {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression)) {
      const imported = imports.get(node.expression.text);
      const args = node.arguments.map((argument) => argument.getText(sourceFile)).join("\n");
      if (imported && pointArgument.test(args)) providers.add(imported);
    }
    ts.forEachChild(node, visit);
  }
  visit(sourceFile);
  return providers;
}

function httpHosts(source: string): string[] {
  return [...source.matchAll(/https?:\/\/([a-z0-9.-]+)/gi)].map((match) =>
    match[1].toLowerCase(),
  );
}

function discoverCoordinateEgress(): {
  apiPaths: Set<string>;
  providerHosts: Set<string>;
} {
  const apiPaths = new Set<string>();
  const providerHosts = new Set<string>();
  const pointSignal =
    /\b(?:lat|lng|lon|latitude|longitude|near|userLocation|roundedUser|roundedPoint|origin)\b|privacyRoundedJourneyPoint|roundCoord/;
  const strongPointFile = /privacyRoundedJourneyPoint|\broundCoord\s*\(|opts\.near/;

  for (const path of allSourceFiles()) {
    const source = readFileSync(path, "utf8");
    const strongPointEgress = strongPointFile.test(source);
    const relativePath = path.slice(ROOT.length + 1);
    if (relativePath.startsWith("app/") || relativePath.startsWith("components/")) {
      const outboundTexts = strongPointEgress
        ? fetchWindows(source)
        : pointSignal.test(source)
          ? fetchArguments(path, source)
          : [];
      for (const window of outboundTexts) {
        if (!pointSignal.test(window) && !strongPointEgress) continue;
        for (const match of window.matchAll(/\/api\/[a-z0-9][a-z0-9\-/]*/gi)) {
          apiPaths.add(match[0].replace(/\/$/, ""));
        }
        for (const host of httpHosts(window)) providerHosts.add(host);
      }
    }
    if (strongPointEgress || /https?:\/\/[a-z0-9.-]+\/maps\//i.test(source)) {
      for (const host of httpHosts(source)) providerHosts.add(host);
    }
  }

  for (const apiPath of apiPaths) {
    const route = join(ROOT, "app", apiPath.slice(1), "route.ts");
    if (!existsSync(route)) continue;
    const providerFiles = new Set([route]);
    for (const imported of coordinateProviderImports(route)) {
      for (const path of importClosure(imported)) providerFiles.add(path);
    }
    for (const path of providerFiles) {
      const source = readFileSync(path, "utf8");
      if (!/\b(?:fetch|fetchImpl)\s*\(/.test(source)) continue;
      for (const host of httpHosts(source)) providerHosts.add(host);
      if (/https:\/\/\$\{/.test(source)) {
        for (const match of source.matchAll(/["'`]((?:[a-z0-9-]+\.)+[a-z]{2,})["'`]/gi)) {
          providerHosts.add(match[1].toLowerCase());
        }
      }
    }
  }

  const normalized = new Set(
    [...providerHosts]
      .filter((host) => !/(^|\.)pubmaxxing\.com$/.test(host))
      .map((host) => host.replace(/^www\./, "")),
  );
  return { apiPaths, providerHosts: normalized };
}

const privacy = read("app/privacy/page.tsx");
const terms = read("app/terms/page.tsx");
const landing = read("components/landing/LandingPage.tsx");
const sitemap = read("app/sitemap.ts");

describe("legal content pages", () => {
  it("reaches the reader from the site footer", () => {
    expect(landing).toMatch(/<Link href="\/privacy">/);
    expect(landing).toMatch(/<Link href="\/terms">/);
    expect(landing).toMatch(/CONTACT_MAILTO/);
  });

  it("is discoverable in the sitemap", () => {
    expect(sitemap).toMatch(/path: "\/privacy"/);
    expect(sitemap).toMatch(/path: "\/terms"/);
  });

  it("quotes the one monitored contact address on both pages", () => {
    for (const page of [privacy, terms]) {
      expect(page).toMatch(/from "@\/lib\/siteContact"/);
      expect(page).toMatch(/\{CONTACT_EMAIL\}/);
      // The address itself never gets hardcoded into a page: swapping to a
      // company inbox later must stay a one-constant change.
      expect(page).not.toContain(CONTACT_EMAIL);
    }
  });

  it("claims nothing we have not got", () => {
    for (const page of [privacy, terms]) {
      expect(page).not.toMatch(/ISO ?27001|SOC ?2|GDPR certified|Privacy Shield/i);
      // We are one person, not a company with a Data Protection Officer. The
      // privacy page may say we have NOT appointed one; neither page may claim
      // we have.
      expect(page).not.toMatch(/(?<!not )appointed a Data Protection Officer/i);
    }
  });

  it("keeps the privacy notice honest about how analytics actually work", () => {
    // Each of these mirrors a real gate: consent-off-by-default and the account
    // toggle (components/profile/PubmaxxAccountHub.tsx), Do Not Track (client
    // beacon + app/api/events/route.ts), the header-stripping first-party proxy
    // (app/ingest/[...path]/route.ts), and hashed-never-stored IPs
    // (lib/supabase.ts hashIp/hashActor).
    expect(privacy).toMatch(/off by default/i);
    expect(privacy).toMatch(/Do Not Track/);
    expect(privacy).toMatch(/no forwarded IP address/i);
    expect(privacy).toMatch(/never the address itself/i);
    expect(privacy).toMatch(/PostHog/);
    expect(privacy).toMatch(/Supabase/);
    expect(privacy).toMatch(/Vercel/);
    expect(privacy).toMatch(/PUBMAXX never stores raw IP addresses in its own/);
    expect(privacy).not.toMatch(/We never store your IP address/);
  });

  it("discloses precise location processing without overstating retention", () => {
    expect(privacy).toMatch(/coordinates never leave your\s+device/);
    expect(privacy).toMatch(/\/api\/whats-on/);
    expect(privacy).toMatch(/\/api\/tonight-conditions/);
    expect(privacy).toMatch(/\/api\/last-train/);
    expect(privacy).toMatch(/\/api\/tfl-disruption/);
    expect(privacy).toMatch(/\/api\/citymcp\/journey/);
    expect(privacy).toMatch(/without\s+rounding them first/);
    expect(privacy).toMatch(/rounds your\s+point to three decimal places/);
    expect(privacy).toMatch(/public StopPoint API/);
    expect(privacy).not.toMatch(/does not\s+write them to our database/);
    expect(privacy).not.toMatch(/not sent to us or stored anywhere/);
  });

  it("names every third party that receives a viewer point", () => {
    // Source-derived scan chosen because hardcoded provider assertions cannot
    // detect a new coordinate recipient. Client seams discover their own API
    // routes, then each route's imports reveal external fetch hosts.
    const egress = discoverCoordinateEgress();
    const thirdPartySection =
      privacy.match(/aria-labelledby="third"[\s\S]*?aria-labelledby="keep"/)?.[0] ?? "";

    expect(egress.apiPaths.size).toBeGreaterThanOrEqual(5);
    expect(egress.providerHosts.size).toBeGreaterThanOrEqual(3);
    for (const host of egress.providerHosts) {
      expect(thirdPartySection, `Missing coordinate recipient disclosure for ${host}`).toContain(host);
    }
  });

  it("describes remembered-area request use without claiming all state stays local", () => {
    expect(privacy).toMatch(/public area&rsquo;s coarse centre/);
    expect(privacy).toMatch(/The saved choice itself is not\s+uploaded/);
    expect(privacy).toMatch(/don&rsquo;t upload those stored values as a bundle/);
    expect(privacy).toMatch(/device night profile stays\s+on your device unless you sign in/);
    expect(privacy).not.toMatch(/These never leave your\s+device/);
  });

  it("describes durable rate-limit retention", () => {
    expect(privacy).toMatch(/durable limiter rows are\s+keyed to salted hashes/);
    expect(privacy).toMatch(/Hit timestamps\s+outside that window are pruned/);
    expect(privacy).toMatch(/the key row remains/);
    expect(privacy).not.toMatch(/Server and rate-limit records/);
  });

  it("states the product's own age framing on the terms page", () => {
    expect(terms).toMatch(/under 18/i);
    expect(terms).toMatch(/drinkaware\.co\.uk/);
  });
});
