import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  INTERNAL_LANGUAGE_RULES,
  describeInternalLanguage,
  internalLanguageFinding,
  internalLanguageFindings,
  isPublishableDescription,
} from "../lib/heritageLanguageGate.mjs";
import { defined } from "@/__tests__/helpers/defined";

// F05. The Queens Arms card told every reader it was "a useful Victorian
// reference stop for the seeded heritage route", a note we wrote to ourselves
// published as a fact about a pub. This pins the gate that refuses that class
// of sentence, and then pins the shipped artifacts against the whole class, so
// the next one is a failing test rather than a live card.

const ROOT = path.join(__dirname, "..");

function readJson<T>(relative: string): T {
  return JSON.parse(readFileSync(path.join(ROOT, relative), "utf8")) as T;
}

describe("internal language is refused", () => {
  it("refuses the exact sentence the audit found in production", () => {
    const finding = internalLanguageFinding(
      "Pimlico pub from 1846; a useful Victorian reference stop for the seeded heritage route.",
    );
    expect(finding).not.toBeNull();
    expect(finding?.ruleId).toBe("seed-language");
    expect(describeInternalLanguage(finding)).toContain("seeded");
  });

  it.each([
    ["seed-language", "A seeded reference row for Pimlico."],
    ["placeholder-marker", "TODO: write a real hook for this pub."],
    ["template-language", "Standard template copy for a Victorian pub."],
    ["demo-language", "A strong pub for the heritage-by-water demo."],
    ["route-scaffolding", "Kept as a reference stop for the heritage crawl."],
    ["internal-fit-note", "Useful as a west London water-side heritage stop."],
    ["internal-review-note", "Kept as a soft match until the exact pub is verified."],
    ["test-fixture-language", "Sample data for the historic index."],
  ])("refuses %s", (ruleId, text) => {
    const findings = internalLanguageFindings(text);
    expect(findings.map((f) => f.ruleId)).toContain(ruleId);
    expect(isPublishableDescription(text)).toBe(false);
  });

  it("names every finding, not only the first, so one pass fixes the sentence", () => {
    const findings = internalLanguageFindings(
      "Bethnal Green pub, useful for a writer-inspired crawl seed.",
    );
    expect(findings.length).toBeGreaterThan(1);
    expect(new Set(findings.map((f) => f.ruleId)).size).toBe(findings.length);
  });

  it("every rule states the class it catches, so a refusal is actionable", () => {
    for (const rule of INTERNAL_LANGUAGE_RULES) {
      expect(rule.id).toMatch(/^[a-z][a-z-]*$/);
      expect(rule.why.length).toBeGreaterThan(10);
    }
  });
});

describe("honest heritage prose is left alone", () => {
  it.each([
    "The Prospect of Whitby is a Grade II* listed pub on Wapping Wall, reputed to be one of the oldest riverside taverns in London.",
    "Victorian Pimlico pub from 1846.",
    "The Tipperary is a Grade II listed pub at 66 Fleet Street; the building was built in about 1667.",
    "Private member's drinking club in Soho, London (1948-2008).",
    "pub in the City of London",
  ])("publishes %s", (text) => {
    expect(internalLanguageFindings(text)).toEqual([]);
    expect(isPublishableDescription(text)).toBe(true);
  });

  it("treats empty and missing text as nothing to refuse", () => {
    expect(internalLanguageFindings("")).toEqual([]);
    expect(internalLanguageFindings(null)).toEqual([]);
    expect(internalLanguageFindings(undefined)).toEqual([]);
  });
});

describe("no shipped public description carries internal language", () => {
  it("the historic index publishes none", () => {
    const rows = readJson<
      { name: string; hook: string; facts: { fact: string }[] }[]
    >("public/data/historic_pubs.json");
    expect(rows.length).toBeGreaterThan(100);
    const offences: string[] = [];
    for (const row of rows) {
      for (const text of [row.hook, ...row.facts.map((f) => f.fact)]) {
        for (const finding of internalLanguageFindings(text)) {
          offences.push(`${row.name}: ${describeInternalLanguage(finding)}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it("the heritage cache the index is built from publishes none", () => {
    const cache = readJson<Record<string, { fact: string }[]>>(
      "public/data/heritage_cache.json",
    );
    const offences: string[] = [];
    for (const [key, facts] of Object.entries(cache)) {
      for (const fact of facts) {
        for (const finding of internalLanguageFindings(fact.fact)) {
          offences.push(`${key}: ${describeInternalLanguage(finding)}`);
        }
      }
    }
    expect(offences).toEqual([]);
  });

  it("the curated venue notes the map hero and story tab render publish none", () => {
    const source = readFileSync(path.join(ROOT, "lib/curation.ts"), "utf8");
    const notes = [...source.matchAll(/heritageNote:\s*\n?\s*"((?:[^"\\]|\\.)*)"/g)];
    expect(notes.length).toBeGreaterThan(5);
    const offences: string[] = [];
    for (const [, raw] of notes) {
      const text = defined(raw).replace(/\\"/g, '"');
      for (const finding of internalLanguageFindings(text)) {
        offences.push(`${text.slice(0, 40)}: ${describeInternalLanguage(finding)}`);
      }
    }
    expect(offences).toEqual([]);
  });
});
