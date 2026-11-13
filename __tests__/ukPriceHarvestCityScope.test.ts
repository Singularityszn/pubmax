import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { harvestCityScope, hostsTouchingCityScope } from "../scripts/harvest/uk-prices/cityScope.mjs";
import { defined } from "@/__tests__/helpers/defined";

function scopeOf(ids: string[]) {
  const scope = harvestCityScope(ids);
  if (!scope) throw new Error(`expected a scope for ${ids.join(",")}`);
  return scope;
}

const MANCHESTER_PUB = { name: "Briton's Protection", lat: 53.4746, lng: -2.2467 };
const LEEDS_PUB = { name: "Whitelock's", lat: 53.7983, lng: -1.5423 };
const BARNSLEY_PUB = { name: "The Botanist", lat: 53.553, lng: -1.4817 };

describe("uk price harvest city scope", () => {
  it("contains a pub inside a named city's map box and nothing outside it", () => {
    const scope = scopeOf(["Manchester", " leeds "]);
    expect(scope.ids).toEqual(["manchester", "leeds"]);
    expect(scope.contains(MANCHESTER_PUB)).toBe(true);
    expect(scope.contains(LEEDS_PUB)).toBe(true);
    expect(scope.contains(BARNSLEY_PUB)).toBe(false);
    expect(scope.contains({ lat: null, lng: null })).toBe(false);
  });

  it("refuses a city with no map box and sends London to its own scope", () => {
    expect(() => harvestCityScope(["sheffield"])).toThrow(/not a city/);
    expect(() => harvestCityScope(["london"])).toThrow(/--london/);
    expect(harvestCityScope([""])).toBeNull();
  });

  it("keeps every pub of an estate host that serves one pub in scope", () => {
    const scope = scopeOf(["manchester"]);
    const estate = { host: "estate.example", pubs: [MANCHESTER_PUB, BARNSLEY_PUB] };
    const elsewhere = { host: "barnsley.example", pubs: [BARNSLEY_PUB] };
    const { hosts, hostsOutsideScope } = hostsTouchingCityScope([estate, elsewhere], scope);
    expect(hosts).toEqual([estate]);
    expect(defined(hosts[0]).pubs).toHaveLength(2);
    expect(hostsOutsideScope).toBe(1);
  });

  it("keeps an Exa host shared with a pub outside the city out of a city run", () => {
    const root = mkdtempSync(path.join(process.cwd(), ".harvest-exa-scope-"));
    try {
      const snapshotDir = path.join(root, "data/osm/uk");
      const ledgerDir = path.join(root, "data-harvest/uk_prices");
      mkdirSync(snapshotDir, { recursive: true });
      mkdirSync(ledgerDir, { recursive: true });
      writeFileSync(path.join(snapshotDir, "uk_osm_pubs.json"), JSON.stringify([]));
      const candidate = (pub: typeof MANCHESTER_PUB, osmId: string) => ({
        ...pub,
        osmId,
        venueId: `venue-uk-${osmId}`,
        host: "shared.example",
        siteUrl: "https://shared.example/",
        binding: { postcode: "M1 1AA", streetAddress: null },
      });
      const exaPath = path.join(root, "exa.json");
      writeFileSync(exaPath, JSON.stringify({
        candidates: [candidate(MANCHESTER_PUB, "n1"), candidate(BARNSLEY_PUB, "n2")],
      }));
      const transportPath = path.join(root, "transport.mjs");
      writeFileSync(transportPath,
        'globalThis.fetch = async () => new Response("User-agent: *\\nDisallow: /\\n", { headers: { "content-type": "text/plain" } });\n',
      );
      execFileSync(process.execPath, [
        "--import", "tsx", "--import", transportPath, path.join(process.cwd(), "scripts/harvest/uk-prices/run.mjs"),
        "--city", "manchester", "--exa-sites", exaPath, "--exa-sites-only", "--menu-urls", "none",
      ], { cwd: root, stdio: "pipe" });
      const saved = JSON.parse(readFileSync(path.join(ledgerDir, "hosts.json"), "utf8"));
      expect(saved.hosts["shared.example"]).toBeUndefined();
      const report = JSON.parse(readFileSync(path.join(root, "data/uk_prices/exa_sites_report.json"), "utf8"));
      expect(report.exaSites.sharedHost).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it.each([
    { limits: ["--pages", "0"], crawls: false },
    { limits: ["--hosts", "0"], crawls: false },
    { limits: ["--only", "glasgow.example"], crawls: false },
    { limits: ["--exa-sites-only"], crawls: false },
    { limits: [], crawls: true },
    { limits: ["--pages", "1"], crawls: true, raceRules: "Allow: /" },
    { limits: ["--pages", "1"], crawls: true, raceRules: "Disallow: /" },
    { limits: ["--pages", "1"], crawls: true, raceRules: "Allow: /", national: true },
    { limits: ["--pages", "1"], crawls: true, raceRules: "Disallow: /", national: true },
  ])("preserves findings outside completed crawls with $limits", ({ limits, crawls, raceRules, national }) => {
    const root = mkdtempSync(path.join(process.cwd(), ".harvest-recheck-"));
    try {
      const snapshotDir = path.join(root, "data/osm/uk");
      const ledgerDir = path.join(root, "data-harvest/uk_prices");
      mkdirSync(snapshotDir, { recursive: true });
      mkdirSync(ledgerDir, { recursive: true });
      writeFileSync(path.join(snapshotDir, "uk_osm_pubs.json"), JSON.stringify([
        { ...MANCHESTER_PUB, osmId: "n1", website: "https://manchester.example" },
        ...(raceRules
          ? [{ ...MANCHESTER_PUB, osmId: "n2", website: "https://second-manchester.example" }]
          : [{ name: "Glasgow pub", osmId: "n2", lat: 55.86, lng: -4.25, website: "https://glasgow.example" }]),
      ]));
      const ledger = {
        version: 1,
        hosts: {
          "manchester.example": { outcome: "robots-unreadable", pubs: 1, checkedAt: "2026-11-01" },
          "glasgow.example": { outcome: "robots-unreadable", pubs: 1, checkedAt: "2026-11-02" },
          ...(raceRules ? {
            "second-manchester.example": { outcome: "robots-unreadable", pubs: 1, checkedAt: "2026-11-03" },
          } : {}),
        },
      };
      const ledgerPath = path.join(ledgerDir, "hosts.json");
      writeFileSync(ledgerPath, JSON.stringify(ledger));
      const transportPath = path.join(root, "transport.mjs");
      writeFileSync(transportPath,
        raceRules ? `
let releaseFirstRobots;
const secondRobotsStarted = new Promise(resolve => { releaseFirstRobots = resolve; });
let releaseSecondRobots;
const firstHomeStarted = new Promise(resolve => { releaseSecondRobots = resolve; });
globalThis.fetch = async (input) => {
  const url = new URL(input);
  if (url.pathname === "/robots.txt") {
    if (url.hostname === "manchester.example") {
      await secondRobotsStarted;
      return new Response("User-agent: *\\nAllow: /\\n");
    }
    releaseFirstRobots();
    await firstHomeStarted;
    return new Response(${JSON.stringify(`User-agent: *\n${raceRules}\n`)});
  }
  releaseSecondRobots();
  return new Response("Not found", { status: 404 });
};
` : 'globalThis.fetch = async () => new Response("User-agent: *\\nDisallow: /\\n", { headers: { "content-type": "text/plain" } });\n',
      );
      execFileSync(process.execPath, [
        "--import", "tsx", "--import", transportPath, path.join(process.cwd(), "scripts/harvest/uk-prices/run.mjs"),
        ...(national ? [] : ["--city", "manchester"]),
        "--recheck", "robots-unreadable", "--menu-urls", "none", ...limits,
      ], { cwd: root, stdio: "pipe" });
      const saved = JSON.parse(readFileSync(ledgerPath, "utf8"));
      if (crawls) {
        expect(saved.hosts["manchester.example"].outcome).toBe(raceRules ? "unreachable" : "robots-disallowed");
        expect(saved.hosts["glasgow.example"]).toEqual(ledger.hosts["glasgow.example"]);
        if (raceRules) {
          expect(saved.hosts["second-manchester.example"]).toEqual(ledger.hosts["second-manchester.example"]);
          expect(saved.hosts["manchester.example"].pagesRead).toBe(1);
          const report = JSON.parse(readFileSync(path.join(root, "data/uk_prices/harvest_report.json"), "utf8"));
          expect(report.hostsCrawledThisRun).toBe(1);
          expect(report.pagesRead).toBe(1);
        }
      } else {
        expect(saved).toEqual(ledger);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
