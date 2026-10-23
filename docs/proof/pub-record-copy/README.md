# Grounded pub copy

Gemini 2.5 Flash-Lite wrote short descriptions and chose one to three supported
vibe tags. A separate Gemini 2.5 Flash call judged each draft against the same
stored facts. The final pack has 515 descriptions for 1,916 curated London
pubs. Another 135 eligible pubs failed the publication gate twice and are
listed as `invalid-copy-after-retry`; 1,266 have no eligible fact and are listed
as `insufficient-stored-facts`. All 650 eligible pubs went through the writer
and judge in the full regeneration. A later targeted run sent only the one
published row the tightened passive-verb check rejected ("Darts and cocktails
are served up"); its new drafts failed twice, so it is now a documented skip.
UK base pubs and non-pub anchors are outside this pack.

Both models received only venue IDs, boroughs and positive structured amenity
labels: cocktails, alcohol-free options, live music, pub quiz, darts, pool,
happy hour and karaoke. The judge additionally received the draft. Food, live
sport and beer garden remain in the Overview chips. Names, free text, prices,
hours, URLs and Google Places content were excluded. No page, Places or search
request was made.

Deterministic draft checks enforce format, supported tags and recognised
feature terms. Their feature and claim regexes are deny-lists, not a complete
semantic check. The judge reviews every factual or implied claim and returns
SUPPORTED or UNSUPPORTED, with quoted claims and an offending phrase for a
rejection. Publication requires every claim supported, full draft coverage,
a complete response and an unambiguous verdict. Each failed pub gets one new
draft and judge attempt, then a documented skip. Runtime requires judge
evidence bound to the exact description, tags and current stored fact snapshot;
it makes no model call. Changed facts or unjudged copy suppress the summary.
A model verdict is a semantic check, not a guarantee that arbitrary prose
cannot slip through.

The [live regression evaluation](judge-evaluation.json) covers 138 reviewer
probes and positive controls. Raw Flash judge results passed 136 cases.
Firstmate authorised two scoring exceptions: probe-25 is scored through the
complete publication gate, which deterministically rejects its duplicated,
capitalised Cocktails; probe-56 is scored on the UNSUPPORTED verdict, despite
its offending phrase being non-verbatim. Both are documented beside their
unchanged raw responses. The resulting authorised score is 138/138. No further
evaluation round was run. The [first Flash-Lite trial](judge-evaluation-first-attempt.json)
passed only 75/138 and is retained as before evidence.

Judge calls use at most five drafts, temperature zero and a 1,024-token
thinking budget. Output and thinking costs are reserved before each call and
metered separately from the Flash-Lite writer. The full regeneration projected
USD 9.764765 before any call, under the fixed USD 15 cap, and a USD 1.75
actual-spend guard then in place kept it below Firstmate's USD 2 target. The
cap now applies per run: the targeted run projected USD 0.0222752 and spent
USD 0.0031639 over three requests. Final lifetime token-metered spend is
USD 1.5660186 over 1,855 requests, including prior rounds and live judge
evaluations. This is API usage accounting,
not an invoice. No quota override was changed.

## Before and after

Before this change the selected-pub API had no `recordCopy`, and George's
Overview tab showed its address and actions only. George's stored fields hold
food and a beer garden alone, both already shown as chips, so it now
[returns no copy](api-after-skipped.json). The Pregnant Man has cocktails,
live music and happy hour on record, and now returns and shows:

> This place does cocktails and puts on live music.

Its tags are Cocktails, Live music, Happy hour.

| Proof | Before (George) | After (The Pregnant Man) |
| --- | --- | --- |
| Selected-pub API | [Before](api-before.json) | [After](api-after.json) |
| Desktop, 1440 by 1000 | [Before](before-desktop.png) | [After](after-desktop.png) |
| Phone, 390 by 844 | [Before](before-mobile.png) | [After](after-mobile.png) |
| Phone, 320 by 700 | | [After](after-mobile-320.png) |

Screenshots use a local production build on private port 34716. They prove the
local integration, not a deployment. The pub's photo placeholder stays visible;
no Google photo was stored as evidence.

## Checks

`npm run generate:pub-copy -- --check` validates all 515 entries and the
reasons for all 1,401 skips. Focused tests exercise independent judging,
malformed/truncated/contradictory verdicts, full claim coverage, draft and
fact binding at runtime, retry once then skip, cumulative usage for both
models, stale checkpoints, quota backoff, non-JSON errors, sparse pubs,
the selected-venue reader and rendered summary. CI tests use mocked model
responses, without live LLM calls. The live evaluation above is separate proof.

`npm run verify:no-mistakes` ran the repository `npm run verify` gate and
exited zero: coverage passed 19,298 tests, PostgreSQL proofs passed, and data,
types, dead code, freshness and audit gates passed. Lint reported 16 existing
complexity warnings and no errors. Three durable feeds were unmeasurable
without credentials and were explicitly not reported fresh. The existing
dev-only audit waivers remained in place.

The isolated `NEXT_DIST_DIR=.next-pub-copy` production build passed. Fresh
Chrome screenshots show the exact final API description and tags at 1440 by
1000, 390 by 844 and 320 by 700 pixels, with no document horizontal overflow.
The 320-pixel screenshot uses the sheet's Expand button so the full summary
and wrapped tags are visible. Before screenshots show the earlier no-copy
selected-pub surface. Keyless production preview reports unavailable durable
busyness and visit-note feeds; these screenshots prove copy integration, not
those store-backed features or a deployment.
