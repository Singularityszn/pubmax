import { describe, expect, it } from "vitest";

import { validateVenueRecordCopy } from "@/lib/venueRecordCopy";
import { judgeResults, scoreJudgeProbe, type Draft } from "../scripts/lib/pubCopyGrounding";

const draft: Draft = { venueId: "fixture", borough: "Hackney", supportedTags: ["Cocktails"],
  description: "This pub serves cocktails.", vibeTags: ["Cocktails"] };
const verdict = { venueId: draft.venueId, verdict: "SUPPORTED", claims:
  [draft.description, ...draft.vibeTags].map((phrase) => ({ phrase, verdict: "SUPPORTED", offendingPhrase: "" })) };
const body = (rows: unknown[], finishReason = "STOP") => ({ candidates: [{ finishReason,
  content: { parts: [{ text: JSON.stringify({ rows }) }] } }] });

describe("independent pub copy grounding judge", () => {
  it("requires evidence bound to the exact draft and stored facts at runtime", () => {
    const [entry] = judgeResults(body([verdict]), [draft]);
    expect(validateVenueRecordCopy(draft, entry)).toEqual({description: draft.description, vibeTags: draft.vibeTags});
    expect(validateVenueRecordCopy(draft, draft)).toBeNull();
    expect(validateVenueRecordCopy(draft, {...entry, description: "This pub has cocktails and sandwiches."})).toBeNull();
    expect(validateVenueRecordCopy({...draft, borough: "Camden"}, entry)).toBeNull();
    expect(validateVenueRecordCopy({...draft, supportedTags: []}, entry)).toBeNull();
  });

  it("scores the two explicitly settled review exceptions without changing raw judge verdicts", () => {
    const duplicate = {...draft, borough: "Lambeth", description: "Fancy some cocktails? This Lambeth place does Cocktails.",
      expected: "UNSUPPORTED", scoring: "publication-gate"};
    expect(scoreJudgeProbe(duplicate, verdict)).toBe(true);
    expect(scoreJudgeProbe({...duplicate, scoring: undefined}, verdict)).toBe(false);
    const awkward = {...draft, description: "This pub is where you can catch live music and cocktails.",
      expected: "UNSUPPORTED", scoring: "rejection-verdict"};
    const rejection = {verdict: "UNSUPPORTED", claims: [{verdict: "UNSUPPORTED", offendingPhrase: "catch cocktails"}]};
    expect(scoreJudgeProbe(awkward, rejection)).toBe(true);
    expect(scoreJudgeProbe({...awkward, scoring: undefined}, rejection)).toBe(false);
    expect(scoreJudgeProbe(awkward, verdict)).toBe(false);
  });

  it("fails closed on contradictions, missing claim coverage, duplicates and truncation", () => {
    for (const rows of [[], [verdict, verdict], [{...verdict, claims: []}],
      [{...verdict, claims: [{phrase: "cocktails", verdict: "SUPPORTED", offendingPhrase: ""}]}],
      [{...verdict, claims: [{phrase: draft.description, verdict: "UNSUPPORTED", offendingPhrase: "pub"}]}],
      [{...verdict, claims: [{phrase: "Invented quote", verdict: "SUPPORTED", offendingPhrase: ""}]}],
      [{...verdict, verdict: "UNSUPPORTED"}],
    ]) expect(judgeResults(body(rows), [draft])).toEqual([]);
    expect(judgeResults(body([verdict], "MAX_TOKENS"), [draft])).toEqual([]);
    expect(judgeResults({candidates: [{finishReason: "STOP", content: {parts: [{text: "{"}]}}]}, [draft])).toEqual([]);
  });
});
