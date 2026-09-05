import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CONTACT_EMAIL, CONTACT_MAILTO } from "@/lib/siteContact";

// The public-contact fence. Captain 5 Sep 2026 ("Role address"): the support
// and privacy contact on /privacy, /terms, /about, /account/delete and in every
// crawler user-agent header was the owner's PERSONAL free-mail address. A
// personal inbox printed as the site's public contact is a promise the product
// cannot keep: it cannot be handed over, it cannot be shared with a second
// person, and both app stores require a working support contact for an app
// declaring user content.
//
// Two laws, and the second is the one that lasts. (1) The retired address is
// gone from the tree. (2) No public-facing file may name a free-mail address at
// all, so the next personal inbox cannot arrive under a different local part.
//
// This file builds the retired address from parts on purpose, so the sweep does
// not have to skip itself and "zero literal copies" stays literally true.

const ROOT = process.cwd();

const RETIRED_LOCAL_PART = ["karan", "szdy"].join("");
const RETIRED_ADDRESS = `${RETIRED_LOCAL_PART}@${["gmail", "com"].join(".")}`;

// Hosts nobody may publish an address on here. A personal mailbox is the whole
// point of the finding, so the list is free-mail providers rather than a guess
// at which local part is a person's own.
const FREE_MAIL_HOSTS = [
  "gmail",
  "googlemail",
  "outlook",
  "hotmail",
  "live",
  "yahoo",
  "icloud",
  "proton",
  "protonmail",
  "aol",
  "gmx",
  "yandex",
];

// The surface a stranger, a store reviewer or a site operator we crawl can end
// up reading: the app, the shared libraries, the plain-node scripts, the tests,
// the docs and both native shells. Node modules and build output are not ours.
const SWEPT_PREFIXES = [
  "app/",
  "components/",
  "lib/",
  "scripts/",
  "__tests__/",
  "e2e/",
  "docs/",
  "ios/",
  "android/",
  "supabase/",
  "public/",
];

// Generated venue, price and shard artifacts under public/data are machine
// output, never hand-written copy, and reading them costs the fence tens of
// megabytes for a claim nothing could put an address into.
const SWEPT_EXCLUSIONS = ["public/data/"];

const SWEPT_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".mjs",
  ".mts",
  ".js",
  ".jsx",
  ".json",
  ".md",
  ".xml",
  ".plist",
  ".entitlements",
  ".properties",
  ".gradle",
  ".sql",
  ".css",
  ".html",
  ".yml",
  ".yaml",
  ".webmanifest",
];

function trackedFiles(): string[] {
  return execFileSync("git", ["ls-files"], { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 })
    .split("\n")
    .filter(Boolean)
    .filter((path) => SWEPT_PREFIXES.some((prefix) => path.startsWith(prefix)))
    .filter((path) => !SWEPT_EXCLUSIONS.some((prefix) => path.startsWith(prefix)))
    .filter((path) => SWEPT_EXTENSIONS.some((extension) => path.endsWith(extension)));
}

// A test or a regex may write the address escaped (`gmail\.com`), which a plain
// substring search would walk straight past, so escapes come out first.
function unescaped(source: string): string {
  return source.replace(/\\/g, "");
}

const FREE_MAIL_PATTERN = new RegExp(
  `[a-z0-9._%+-]+@(?:${FREE_MAIL_HOSTS.join("|")})\\.[a-z][a-z.]*[a-z]`,
  "i",
);

describe("the one public contact address", () => {
  it("is on our own domain and is not a personal free-mail inbox", () => {
    expect(CONTACT_EMAIL).toMatch(/^[a-z0-9._%+-]+@pubmaxxing\.com$/);
    expect(CONTACT_EMAIL).not.toMatch(FREE_MAIL_PATTERN);
    expect(CONTACT_MAILTO).toBe(`mailto:${CONTACT_EMAIL}`);
  });

  it("is written down in exactly one place, which the app re-exports", () => {
    const master = readFileSync(join(ROOT, "lib/siteContact.mjs"), "utf8");
    const door = readFileSync(join(ROOT, "lib/siteContact.ts"), "utf8");
    expect(master).toContain(`"${CONTACT_EMAIL}"`);
    // The TypeScript door owns no address of its own: it hands the app the
    // master's two names and nothing else.
    expect(door).toContain('from "@/lib/siteContact.mjs"');
    expect(door).not.toContain("@pubmaxxing.com");
  });

  it("is what every crawler user-agent header names", () => {
    // The scripts that used to type the personal address. Each is a polite
    // header a site operator reads when they want to reach us about our crawl,
    // so it is the same public contact and it reads the same constant.
    const crawlers = [
      "scripts/gen_london_localities.mjs",
      "scripts/refresh_drink_prices.mjs",
      "scripts/whatson/commonRefresh.mjs",
      "scripts/whatson/quizRefresh.mjs",
      "scripts/whatson/scrape_greene_king_sport.mjs",
    ];
    for (const path of crawlers) {
      const source = readFileSync(join(ROOT, path), "utf8");
      expect(source, path).toContain("siteContact.mjs");
      expect(source, path).toContain("${CONTACT_EMAIL}");
    }
  });
});

describe("the retired personal address", () => {
  const files = trackedFiles();

  it("sweeps a surface a reader can actually reach", () => {
    // A sweep that quietly matched nothing would pass for ever. This is the
    // proof the file list is real.
    expect(files.length).toBeGreaterThan(500);
    expect(files).toContain("lib/siteContact.mjs");
    expect(files).toContain("app/privacy/page.tsx");
  });

  it("appears in no tracked file", () => {
    const offenders = files.filter((path) =>
      unescaped(readFileSync(join(ROOT, path), "utf8")).includes(RETIRED_ADDRESS),
    );
    expect(offenders).toEqual([]);
  });

  it("cannot come back under another local part", () => {
    const offenders = files.filter((path) =>
      FREE_MAIL_PATTERN.test(unescaped(readFileSync(join(ROOT, path), "utf8"))),
    );
    expect(offenders).toEqual([]);
  });
});
