// CONTEXT.md is the ubiquitous language, and CLAUDE.md sends every agent session
// to read it. So it is held like any other contract: a term is defined ONCE, and
// a statement about the data path either matches the code or is a bug in the
// glossary rather than a wording preference.
//
// The age sentence is the one this fence exists for. It used to say PUBMAXX
// required a date of birth at signup and blocked nothing by age; both halves were
// wrong, and it is the sentence a store or legal reviewer would read.
import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defined } from "@/__tests__/helpers/defined";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const CONTEXT = readFileSync(join(ROOT, "CONTEXT.md"), "utf8");

/** Every `**Term**:` heading, in file order. */
function glossaryTerms(): string[] {
  return [...CONTEXT.matchAll(/^\*\*([^*]+)\*\*:/gm)].map((m) => defined(m[1]));
}

/**
 * What one term SAYS, up to the next term or the end of the file. The `_Avoid_`
 * line is deliberately left out: it lists the wordings this entry replaces, so a
 * fence that read it would find every retired claim inside its own correction.
 */
function definitionOf(term: string): string {
  const heading = `**${term}**:`;
  const start = CONTEXT.indexOf(heading);
  expect(start, `${term} is missing from CONTEXT.md`).toBeGreaterThan(-1);
  const rest = CONTEXT.slice(start + heading.length);
  const next = rest.search(/^\*\*[^*]+\*\*:/m);
  const block = next === -1 ? rest : rest.slice(0, next);
  return block
    .split("\n")
    .filter((line) => !line.startsWith("_Avoid_:"))
    .join("\n");
}

describe("CONTEXT.md glossary", () => {
  it("defines every term exactly once", () => {
    const terms = glossaryTerms();
    const duplicates = terms.filter((term, i) => terms.indexOf(term) !== i);
    expect(duplicates).toEqual([]);
  });

  it("does not claim a date of birth is required to make an account", () => {
    // `POST /api/identity/handle/claim` stores none, so a glossary that calls it
    // required describes a signup this product does not have.
    const definition = definitionOf("Private Account Identity").toLowerCase();
    expect(definition).not.toMatch(/required date of birth/);
    expect(definition).not.toMatch(/date of birth[^.]*\bat signup\b/);
    expect(definition).toMatch(/optional/);
  });

  it("says the product does gate by age, through the one adult gate", () => {
    const definition = definitionOf("Private Account Identity").toLowerCase();
    // The retired sentence claimed the opposite of three live code paths.
    expect(definition).not.toMatch(/does not block accounts or contributions by age/);
    expect(definition).not.toMatch(/does not derive contribution eligibility/);
    expect(definitionOf("Adult Self-Assertion")).toContain("lib/adultGate.ts");
  });

  it("names a real module for each term added with one", () => {
    // A glossary entry that points at a module keeps its own claim checkable.
    const modules = [...CONTEXT.matchAll(/`(lib\/[A-Za-z0-9_.\-/]+\.tsx?)`/g)].map(
      (m) => m[1],
    );
    expect(modules.length).toBeGreaterThan(0);
    const missing = modules.filter((path) => !existsSync(join(ROOT, defined(path))));
    expect(missing).toEqual([]);
  });

  it("carries the vocabulary the price and belonging waves shipped", () => {
    const terms = new Set(glossaryTerms());
    for (const term of [
      "Price Band",
      "Price Standing",
      "Price Lane",
      "Pint Trust",
      "Pint Drop Confirmation",
      "Second Drinker",
      "Drink Measure",
      "Drink Lane",
      "Adult Self-Assertion",
      "Founding Member",
      "Referral Mark",
      "Starter Pack",
      "Wanted",
      "Open Crew",
    ]) {
      expect(terms, `${term} is missing from CONTEXT.md`).toContain(term);
    }
  });
});
