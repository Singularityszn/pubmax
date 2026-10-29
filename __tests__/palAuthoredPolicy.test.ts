import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as venueIndex from "@/evals/pal/venueIndex";
import * as ask from "@/lib/ask/runAsk";
import { runPalEvalSuite } from "@/evals/pal/runSuite";
import { VENUE_ALIAS_FILES } from "@/lib/venueAliasesFile.mjs";
import { LATE_FOOD_AREA_ALIASES } from "@/lib/lateFood";
import { loadAuthoredPolicyEvidence, resolveAuthoredPolicyNegative } from "@/evals/pal/answerKeyResolver";
import type { PalEvalAnswerExpectations, PalEvalPublicCase } from "@/evals/pal/types";

const now = Date.parse("2026-07-21T18:00:00.000Z");
const ctx = { now, cityId: "london" };
const policies = [
  {
    caseDef: { id: "food-midnight-covent", query: "Food after midnight near Covent Garden", cityId: "london" },
    terminal: { answer: "I have no current late-food record for Covent Garden.", tool: "search_venues" as const },
  },
  {
    caseDef: { id: "heritage-lamb", query: "Tell me the heritage of The Lamb", cityId: "london" },
    terminal: { answer: "I cannot tell which pub you mean. Choose the pub on the map, then ask about its history.", tool: "venue_heritage" as const },
  },
];

describe.each(policies)("authored honest terminal: $caseDef.id", ({ caseDef, terminal }) => {
  const reference: PalEvalAnswerExpectations = { expectEmpty: true, answerIncludes: [terminal.answer], honestTerminal: terminal };
  it("validates the independent case and relevant committed evidence", () => {
    expect(resolveAuthoredPolicyNegative(caseDef, ctx)).toEqual(reference);
  });
  it.each([
    { ...caseDef, query: `${caseDef.query} at 94 Lamb's Conduit Street` },
    { ...caseDef, cityId: "manchester" },
    { ...caseDef, turns: [{ role: "user" as const, content: "I selected the Camden pub" }] },
    { ...caseDef, turns: [{ role: "assistant" as const, content: "The Camden pub" }] },
    { ...caseDef, venueId: "venue-1yd70c7" },
    { ...caseDef, selection: "venue-1yd70c7" },
    { ...caseDef, lat: 51.5231, lng: -0.119017 },
  ])("requires review for changed query, city or context: %j", (changed) => {
    expect(() => resolveAuthoredPolicyNegative(changed, ctx)).toThrow(/input changed.*review required/);
  });
  it("requires review when the pinned instant changes", () => {
    expect(() => resolveAuthoredPolicyNegative(caseDef, { ...ctx, now: now + 1 })).toThrow(/input changed/);
  });
  it("requires review when context gains an additional selection", () => {
    const changed = { ...ctx, selection: "venue-1yd70c7" };
    expect(() => resolveAuthoredPolicyNegative(caseDef, changed)).toThrow(/input changed/);
  });
});

it("requires review when a canonical alias joins Lamb identities", () => {
  const evidence = loadAuthoredPolicyEvidence();
  evidence.lambAliasEdges.push(["public/data/venue_id_aliases.json", "venue-uov7ku", "venue-1yd70c7"]);
  expect(() => resolveAuthoredPolicyNegative(policies[1]!.caseDef, ctx, evidence)).toThrow(/evidence changed/);
});
it("requires review when a Lamb identity or name alias changes", () => {
  const evidence = loadAuthoredPolicyEvidence();
  evidence.lambCandidates.pop();
  expect(() => resolveAuthoredPolicyNegative(policies[1]!.caseDef, ctx, evidence)).toThrow(/evidence changed/);
});
it("requires review for newly supported Covent food evidence", () => {
  const evidence = loadAuthoredPolicyEvidence();
  evidence.coventFoodOptions.push({ area: "covent-garden", optionIds: ["new-official-food-record"] });
  expect(() => resolveAuthoredPolicyNegative(policies[0]!.caseDef, ctx, evidence)).toThrow(/evidence changed/);
});
it("requires review for a new Covent area mapping", () => {
  const evidence = loadAuthoredPolicyEvidence();
  evidence.coventAreaMappings.push({ slug: "piccadilly-soho", names: ["Covent Garden"] });
  expect(() => resolveAuthoredPolicyNegative(policies[0]!.caseDef, ctx, evidence)).toThrow(/evidence changed/);
});
it("does not invalidate Lamb because unrelated food evidence changes", () => {
  const evidence = loadAuthoredPolicyEvidence();
  evidence.coventFoodOptions.push({ area: "covent-garden", optionIds: ["new-official-food-record"] });
  expect(resolveAuthoredPolicyNegative(policies[1]!.caseDef, ctx, evidence)).not.toBeNull();
});
it("does not grant an authored-negative exemption to Old Bank or an inherited object key", () => {
  const bank: PalEvalPublicCase = { id: "heritage-bank", query: "Heritage story for The Old Bank of England", cityId: "london" };
  expect(resolveAuthoredPolicyNegative(bank, ctx)).toBeNull();
  expect(resolveAuthoredPolicyNegative({ ...bank, id: "toString" }, ctx)).toBeNull();
});

const temporaryRoots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixtureRoot() {
  const root = mkdtempSync(join(tmpdir(), "pal-policy-"));
  temporaryRoots.push(root);
  const write = (file: string, value: unknown) => {
    const path = join(root, file);
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify(value));
  };
  const rows = loadAuthoredPolicyEvidence().lambCandidates.map(({ searchNames: _names, eligible: _eligible, ...row }) => ({
    ...row, borough: "London", cheapestPrice: null as number | null, kind: "pub",
  }));
  write("public/data/venues_slim.json", { rows });
  write("public/data/venue_id_aliases.json", { aliases: {}, clusters: [] });
  write("public/data/cities/venue_id_aliases.json", { aliases: {}, retired: {} });
  write("public/data/uk_base_venue_id_aliases.json", { aliases: {}, retired: {} });
  write("public/data/late_food_evidence.json", { areas: {} });
  return { root, write, rows };
}
it.each(["Lamb!", "The Lamb."])("detects a new leading-article/punctuation candidate: %s", (name) => {
  const { root, write, rows } = fixtureRoot();
  write("public/data/venues_slim.json", { rows: [...rows, { id: "new-lamb", name, lat: 51.5, lng: -0.1 }] });
  const evidence = loadAuthoredPolicyEvidence(root);
  expect(evidence.lambCandidates.some((row) => row.id === "new-lamb")).toBe(true);
  expect(() => resolveAuthoredPolicyNegative(policies[1]!.caseDef, ctx, evidence)).toThrow(/evidence changed/);
});
it("detects an identity introduced by a recorded search alias from the name reader", () => {
  const { root, write, rows } = fixtureRoot();
  write("public/data/venues_slim.json", { rows: [...rows, { id: "alias-lamb", name: "Recorded longer name", lat: 51.5, lng: -0.1 }] });
  const actual = venueIndex.loadPalEvalVenueIndex(root);
  actual.namesById.set("alias-lamb", ["Recorded longer name", "Lamb"]);
  vi.spyOn(venueIndex, "loadPalEvalVenueIndex").mockReturnValue(actual);
  const evidence = loadAuthoredPolicyEvidence(root);
  expect(evidence.lambCandidates.find((row) => row.id === "alias-lamb")?.searchNames).toContain("Lamb");
  expect(() => resolveAuthoredPolicyNegative(policies[1]!.caseDef, ctx, evidence)).toThrow(/evidence changed/);
});
it("detects relevant canonical cluster changes independently of direct alias edges", () => {
  const { root, write } = fixtureRoot();
  write("public/data/venue_id_aliases.json", { aliases: {}, clusters: [
    { canonicalId: "venue-1yd70c7", canonicalName: "The Lamb", mergedFrom: [{ id: "old-lamb", name: "Lamb!", rows: 2 }] },
  ] });
  const evidence = loadAuthoredPolicyEvidence(root);
  expect(evidence.lambClusters).toHaveLength(1);
  expect(() => resolveAuthoredPolicyNegative(policies[1]!.caseDef, ctx, evidence)).toThrow(/evidence changed/);
});
it("detects a new Covent mapping in the food-only alias data", () => {
  const aliases = LATE_FOOD_AREA_ALIASES as Record<string, string>;
  aliases["covent garden"] = "piccadilly-soho";
  try {
    const evidence = loadAuthoredPolicyEvidence(fixtureRoot().root);
    expect(evidence.coventFoodAliases).toEqual([["covent garden", "piccadilly-soho"]]);
    expect(() => resolveAuthoredPolicyNegative(policies[0]!.caseDef, ctx, evidence)).toThrow(/evidence changed/);
  } finally { delete aliases["covent garden"]; }
});
it("ignores unrelated venue, search-name, cluster, alias and food changes", () => {
  const { root, write, rows } = fixtureRoot();
  write("public/data/venues_slim.json", { rows: [...rows, { id: "other", name: "Unrelated Pub", lat: 54, lng: -1 }] });
  write("public/data/venue_id_aliases.json", { aliases: { older: "other" }, clusters: [
    { canonicalId: "other", canonicalName: "Unrelated Pub", mergedFrom: [{ id: "older", name: "Other" }] },
  ] });
  write("public/data/late_food_evidence.json", { areas: { clapham: { options: [{ id: "other-food", area: "clapham" }] } } });
  const evidence = loadAuthoredPolicyEvidence(root);
  expect(resolveAuthoredPolicyNegative(policies[0]!.caseDef, ctx, evidence)).not.toBeNull();
  expect(resolveAuthoredPolicyNegative(policies[1]!.caseDef, ctx, evidence)).not.toBeNull();
});
it.each(["stale-key", "new-food", "changed-context"])("the actual eval consumer refuses %s before product execution", async (change) => {
  const { root, write } = fixtureRoot();
  const policy = policies[0]!;
  const caseDef = change === "changed-context"
    ? { ...policy.caseDef, turns: [{ role: "user", content: "Use the Soho option" }] } : policy.caseDef;
  const key = change === "stale-key"
    ? { expectEmpty: true, expectedTools: ["search_venues"] }
    : { expectEmpty: true, answerIncludes: [policy.terminal.answer], honestTerminal: policy.terminal, expectedTools: ["search_venues"] };
  write("evals/pal/cases.public.json", { cases: [caseDef] });
  write("evals/pal/answer-key.json", { now: new Date(now).toISOString(), cases: { [policy.caseDef.id]: key } });
  if (change === "new-food") write("public/data/late_food_evidence.json", {
    areas: { "covent-garden": { options: [{ id: "new-support", area: "covent-garden" }] } },
  });
  const product = vi.spyOn(ask, "runAsk").mockResolvedValue({
    answer: policy.terminal.answer, cards: [], proposals: [], sources: [], status: "ready", toolsUsed: [policy.terminal.tool],
  });
  await expect(runPalEvalSuite({ mode: "deterministic", root })).rejects.toThrow(/review|regenerate/);
  expect(product).not.toHaveBeenCalled();
});

it("ignores an unrelated food-only alias mapping", () => {
  const aliases = LATE_FOOD_AREA_ALIASES as Record<string, string>;
  aliases["unrelated-food-area"] = "clapham";
  try {
    const evidence = loadAuthoredPolicyEvidence(fixtureRoot().root);
    expect(resolveAuthoredPolicyNegative(policies[0]!.caseDef, ctx, evidence)).not.toBeNull();
  } finally { delete aliases["unrelated-food-area"]; }
});

it("requires review when four Lamb namesakes cease to be eligible pubs", () => {
  const { root, write, rows } = fixtureRoot();
  write("public/data/venues_slim.json", { rows: rows.map((row, index) => ({ ...row, kind: index === 0 ? "pub" : "restaurant" })) });
  const evidence = loadAuthoredPolicyEvidence(root);
  expect(evidence.lambCandidates.filter((row) => row.eligible)).toHaveLength(1);
  expect(() => resolveAuthoredPolicyNegative(policies[1]!.caseDef, ctx, evidence)).toThrow(/evidence changed/);
});
it.each([
  ["borough", null], ["cheapestPrice", "unknown"], ["cheapestPrice", undefined],
  ["lat", null], ["lng", null], ["id", ""], ["name", ""],
])("requires review for malformed Lamb admission field %s=%j", (field, value) => {
  const { root, write, rows } = fixtureRoot();
  write("public/data/venues_slim.json", { rows: rows.map((row, index) => index === 0 ? { ...row, [field as string]: value } : row) });
  const evidence = loadAuthoredPolicyEvidence(root);
  expect(() => resolveAuthoredPolicyNegative(policies[1]!.caseDef, ctx, evidence)).toThrow(/evidence changed/);
});
it.each([3.5, 9.25, null])("permits a valid Lamb price change without freezing its amount: %j", (cheapestPrice) => {
  const { root, write, rows } = fixtureRoot();
  write("public/data/venues_slim.json", { rows: rows.map((row) => ({ ...row, cheapestPrice })) });
  const evidence = loadAuthoredPolicyEvidence(root);
  expect(evidence.lambCandidates.every((row) => row.eligible)).toBe(true);
  expect(resolveAuthoredPolicyNegative(policies[1]!.caseDef, ctx, evidence)).not.toBeNull();
});
it("permits an omitted pub kind while retaining the same eligible identities", () => {
  const { root, write, rows } = fixtureRoot();
  write("public/data/venues_slim.json", { rows: rows.map(({ kind: _kind, ...row }) => row) });
  expect(resolveAuthoredPolicyNegative(policies[1]!.caseDef, ctx, loadAuthoredPolicyEvidence(root))).not.toBeNull();
});

it.each([
  "public/data/cities/venue_id_aliases.json",
  "public/data/uk_base_venue_id_aliases.json",
])("requires review for a Lamb edge in previously omitted source %s", (source) => {
  const { root, write } = fixtureRoot();
  write(source, { aliases: { "venue-uov7ku": "venue-1yd70c7" }, retired: {} });
  const evidence = loadAuthoredPolicyEvidence(root);
  expect(evidence.lambAliasEdges).toContainEqual([source, "venue-uov7ku", "venue-1yd70c7"]);
  expect(() => resolveAuthoredPolicyNegative(policies[1]!.caseDef, ctx, evidence)).toThrow(/evidence changed/);
});
it("binds a transitive incoming chain across all three sources", () => {
  const { root, write } = fixtureRoot();
  write(VENUE_ALIAS_FILES[0]!, { aliases: { formerA: "venue-1yd70c7" }, clusters: [] });
  write(VENUE_ALIAS_FILES[1]!, { aliases: { formerB: "formerA" }, retired: {} });
  write(VENUE_ALIAS_FILES[2]!, { aliases: { formerC: "formerB" }, retired: {} });
  const evidence = loadAuthoredPolicyEvidence(root);
  expect(evidence.lambAliasEdges).toHaveLength(3);
  expect(evidence.lambAliasEdges).toContainEqual([VENUE_ALIAS_FILES[2], "formerC", "formerB"]);
  expect(() => resolveAuthoredPolicyNegative(policies[1]!.caseDef, ctx, evidence)).toThrow(/evidence changed/);
});
it("binds a transitive outgoing chain across all three sources", () => {
  const { root, write } = fixtureRoot();
  write(VENUE_ALIAS_FILES[0]!, { aliases: { "venue-1yd70c7": "bridgeA" }, clusters: [] });
  write(VENUE_ALIAS_FILES[1]!, { aliases: { bridgeA: "bridgeB" }, retired: {} });
  write(VENUE_ALIAS_FILES[2]!, { aliases: { bridgeB: "venue-uov7ku" }, retired: {} });
  const evidence = loadAuthoredPolicyEvidence(root);
  expect(evidence.lambAliasEdges).toHaveLength(3);
  expect(evidence.lambAliasEdges).toContainEqual([VENUE_ALIAS_FILES[1], "bridgeA", "bridgeB"]);
  expect(() => resolveAuthoredPolicyNegative(policies[1]!.caseDef, ctx, evidence)).toThrow(/evidence changed/);
});
it("ignores an overwritten alias edge when the later winning edge is unrelated", () => {
  const { root, write } = fixtureRoot();
  write(VENUE_ALIAS_FILES[0]!, { aliases: { oldPub: "venue-1yd70c7" }, clusters: [] });
  write(VENUE_ALIAS_FILES[1]!, { aliases: { oldPub: "unrelated-current" }, retired: {} });
  const evidence = loadAuthoredPolicyEvidence(root);
  expect(evidence.lambAliasEdges).toEqual([]);
  expect(resolveAuthoredPolicyNegative(policies[1]!.caseDef, ctx, evidence)).not.toBeNull();
});
it("uses the last source when overlapping aliases connect a Lamb identity", () => {
  const { root, write } = fixtureRoot();
  write(VENUE_ALIAS_FILES[0]!, { aliases: { oldPub: "unrelated-one" }, clusters: [] });
  write(VENUE_ALIAS_FILES[1]!, { aliases: { oldPub: "unrelated-two" }, retired: {} });
  write(VENUE_ALIAS_FILES[2]!, { aliases: { oldPub: "venue-uov7ku" }, retired: {} });
  const evidence = loadAuthoredPolicyEvidence(root);
  expect(evidence.lambAliasEdges).toEqual([[VENUE_ALIAS_FILES[2], "oldPub", "venue-uov7ku"]]);
  expect(() => resolveAuthoredPolicyNegative(policies[1]!.caseDef, ctx, evidence)).toThrow(/evidence changed/);
});
it.each(VENUE_ALIAS_FILES)("ignores unrelated alias connectivity in %s", (source) => {
  const { root, write } = fixtureRoot();
  const aliases = { unrelatedOld: "unrelatedNew", unrelatedNew: "unrelatedFinal" };
  write(source, source === VENUE_ALIAS_FILES[0] ? { aliases, clusters: [] } : { aliases, retired: {} });
  const evidence = loadAuthoredPolicyEvidence(root);
  expect(evidence.lambAliasEdges).toEqual([]);
  expect(resolveAuthoredPolicyNegative(policies[1]!.caseDef, ctx, evidence)).not.toBeNull();
});

it("ignores self-maps and invalid later targets without erasing a valid earlier edge", () => {
  const { root, write } = fixtureRoot();
  write(VENUE_ALIAS_FILES[0]!, { aliases: { oldPub: "venue-1yd70c7" }, clusters: [] });
  write(VENUE_ALIAS_FILES[1]!, { aliases: { oldPub: null, "venue-uov7ku": "venue-uov7ku" }, retired: {} });
  write(VENUE_ALIAS_FILES[2]!, { aliases: { oldPub: "" }, retired: {} });
  const evidence = loadAuthoredPolicyEvidence(root);
  expect(evidence.lambAliasEdges).toEqual([[VENUE_ALIAS_FILES[0], "oldPub", "venue-1yd70c7"]]);
  expect(() => resolveAuthoredPolicyNegative(policies[1]!.caseDef, ctx, evidence)).toThrow(/evidence changed/);
});
