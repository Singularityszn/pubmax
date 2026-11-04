import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import * as ask from "@/lib/ask/runAsk";
import { VENUE_ALIAS_FILES } from "@/lib/venueAliasesFile.mjs";
import { rowsFromSlimPayload } from "@/lib/slimPayload";
import { runPalEvalSuite } from "@/evals/pal/runSuite";
import { loadHeritageAmbiguityEvidence, resolveHeritageAmbiguityExpectation } from "@/evals/pal/answerKeyResolver";

const caseDef = { id: "heritage-lamb", query: "Tell me the heritage of The Lamb", cityId: "london" };
const now = Date.parse("2026-07-21T18:00:00.000Z");
const context = { now, cityId: "london" };
const answer = "I cannot tell which pub you mean. Choose the pub on the map, then ask about its history.";
const reference = {
  expectEmpty: true, answerIncludes: [answer],
  honestTerminal: { answer, tool: "venue_heritage" }, expectedTools: ["venue_heritage"],
};
const roots: string[] = [];

afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "pal-lamb-oracle-"));
  roots.push(root);
  const write = (file: string, value: unknown) => {
    const path = join(root, file);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, JSON.stringify(value));
  };
  const rawRows = rowsFromSlimPayload(JSON.parse(readFileSync("public/data/venues_slim.json", "utf8"))) as Array<Record<string, unknown>> | null;
  const rows = (rawRows ?? []).filter((row) => row.name === "The Lamb");
  write("public/data/venues_slim.json", { rows });
  for (const [index, source] of VENUE_ALIAS_FILES.entries()) {
    write(source, index === 0 ? { aliases: {}, clusters: [] } : { aliases: {}, retired: {} });
  }
  return { root, rows, write };
}

describe("independent Lamb ambiguity oracle", () => {
  it("binds the unqualified public input to five distinct eligible locations", () => {
    const evidence = loadHeritageAmbiguityEvidence();
    expect(evidence.lambCandidates.map((row) => row.id)).toEqual([
      "venue-1yd70c7", "venue-46mqmt", "venue-kuml9r", "venue-o3sr33", "venue-uov7ku",
    ]);
    expect(new Set(evidence.lambCandidates.map((row) => `${row.lat},${row.lng}`)).size).toBe(5);
    expect(evidence.lambCandidates.every((row) => row.eligible)).toBe(true);
    expect(resolveHeritageAmbiguityExpectation(caseDef, context)).toEqual(reference);
  });

  it.each([
    { ...caseDef, query: "Tell me the heritage of The Lamb in Camden" },
    { ...caseDef, cityId: "manchester" },
    { ...caseDef, turns: [{ role: "user" as const, content: "I selected The Lamb in Camden" }] },
    { ...caseDef, turns: [{ role: "assistant" as const, content: "The Camden pub" }] },
    { ...caseDef, venueId: "venue-1yd70c7" },
    { ...caseDef, area: "Camden" },
    { ...caseDef, lat: 51.5231, lng: -0.119017 },
  ])("requires review rather than erasing a qualifier: %j", (changed) => {
    expect(() => resolveHeritageAmbiguityExpectation(changed, context)).toThrow(/input changed/);
  });

  it("requires review when the pinned context changes", () => {
    expect(() => resolveHeritageAmbiguityExpectation(caseDef, { ...context, now: now + 1 })).toThrow(/input changed/);
    const changed = { ...context, area: "Camden" };
    expect(() => resolveHeritageAmbiguityExpectation(caseDef, changed)).toThrow(/input changed/);
  });

  it("grants no exemption to Old Bank or another case ID", () => {
    expect(resolveHeritageAmbiguityExpectation({ ...caseDef, id: "heritage-bank" }, context)).toBeNull();
    expect(resolveHeritageAmbiguityExpectation({ ...caseDef, id: "toString" }, context)).toBeNull();
  });

  it.each(["Lamb!", "The Lamb."])("detects a new whole-name variant: %s", (name) => {
    const { root, rows, write } = fixture();
    write("public/data/venues_slim.json", { rows: [...rows, { ...rows[0], id: "new-lamb", name }] });
    expect(() => resolveHeritageAmbiguityExpectation(caseDef, context, loadHeritageAmbiguityEvidence(root)))
      .toThrow(/evidence changed/);
  });

  it("detects a loss of eligible namesakes without freezing their price amounts", () => {
    const { root, rows, write } = fixture();
    write("public/data/venues_slim.json", { rows: rows.map((row) => ({ ...row, cheapestPrice: 7.25 })) });
    expect(resolveHeritageAmbiguityExpectation(caseDef, context, loadHeritageAmbiguityEvidence(root))).toEqual(reference);
    write("public/data/venues_slim.json", { rows: rows.map((row, index) => ({ ...row, kind: index ? "restaurant" : "pub" })) });
    expect(() => resolveHeritageAmbiguityExpectation(caseDef, context, loadHeritageAmbiguityEvidence(root)))
      .toThrow(/evidence changed/);
  });

  it.each(VENUE_ALIAS_FILES)("detects a relevant canonical edge in %s", (source) => {
    const { root, write } = fixture();
    write(source, { aliases: { "venue-uov7ku": "venue-1yd70c7" }, clusters: [] });
    expect(() => resolveHeritageAmbiguityExpectation(caseDef, context, loadHeritageAmbiguityEvidence(root)))
      .toThrow(/evidence changed/);
  });

  it("binds transitive incoming and outgoing edges across all three sources", () => {
    const { root, write } = fixture();
    write(VENUE_ALIAS_FILES[0]!, { aliases: { oldLamb: "bridge", "venue-uov7ku": "outgoing" }, clusters: [] });
    write(VENUE_ALIAS_FILES[1]!, { aliases: { bridge: "venue-1yd70c7" }, retired: {} });
    write(VENUE_ALIAS_FILES[2]!, { aliases: { olderLamb: "oldLamb", outgoing: "lastLamb" }, retired: {} });
    const evidence = loadHeritageAmbiguityEvidence(root);
    expect(evidence.lambAliasEdges).toHaveLength(5);
    expect(() => resolveHeritageAmbiguityExpectation(caseDef, context, evidence)).toThrow(/evidence changed/);
  });

  it("respects later valid edges and ignores unrelated components", () => {
    const { root, write } = fixture();
    write(VENUE_ALIAS_FILES[0]!, { aliases: { oldPub: "venue-1yd70c7" }, clusters: [] });
    write(VENUE_ALIAS_FILES[1]!, { aliases: { oldPub: "unrelated", otherOld: "otherNew" }, retired: {} });
    write(VENUE_ALIAS_FILES[2]!, { aliases: { oldPub: "", otherNew: "otherFinal" }, retired: {} });
    expect(resolveHeritageAmbiguityExpectation(caseDef, context, loadHeritageAmbiguityEvidence(root))).toEqual(reference);
  });

  it("requires review for a changed canonical cluster", () => {
    const { root, write } = fixture();
    write(VENUE_ALIAS_FILES[0]!, { aliases: {}, clusters: [{
      canonicalId: "venue-1yd70c7", canonicalName: "The Lamb",
      mergedFrom: [{ id: "old-lamb", name: "The Lamb" }],
    }] });
    expect(() => resolveHeritageAmbiguityExpectation(caseDef, context, loadHeritageAmbiguityEvidence(root)))
      .toThrow(/evidence changed/);
  });

  it.each(["stale-key", "area-context", "venue-id-context", "new-alias"])("the real consumer refuses %s before product execution", async (change) => {
    const { root, write } = fixture();
    const input = change === "area-context" ? { ...caseDef, area: "Camden" }
      : change === "venue-id-context" ? { ...caseDef, venueId: "venue-1yd70c7" } : caseDef;
    write("evals/pal/cases.public.json", { cases: [input] });
    write("evals/pal/answer-key.json", { now: new Date(now).toISOString(), cases: {
      [caseDef.id]: change === "stale-key" ? { minCards: 1, answerIncludes: ["won"] } : reference,
    } });
    if (change === "new-alias") write(VENUE_ALIAS_FILES[2]!, {
      aliases: { "venue-uov7ku": "venue-1yd70c7" }, retired: {},
    });
    const product = vi.spyOn(ask, "runAsk");
    await expect(runPalEvalSuite({ mode: "deterministic", root })).rejects.toThrow(/review|regenerate/);
    expect(product).not.toHaveBeenCalled();
  });
});
