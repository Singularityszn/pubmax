# Deferred UI review verification plan, 9 October 2026

This amendment corrects the native-date disposition in the submitted author plan.
The submitted plan has SHA-256 `4e3d01ca62e2a03d89f5d9c542c01e34ef35d22831a6ceb7e2d33010caca161a`.
Its captured bytes remain unchanged outside this worktree.
This amendment and the recorded human fix decision supersede its claim that Firstmate004 accepted a native-date limitation.

Firstmate makes a technical triage decision. Firstmate's decision is not a human scope waiver.
The recorded human decision requires retaining explicitly named native date controls and reporting the unresolved upstream limitation.
Replacing native date controls is outside this technical disposition.
This change does not fix native date accessibility or complete native accessibility acceptance.
Actual screen-reader speech and native-runtime behavior remain unproved.

## Permalink invariant and scenarios

Every preserved venue spelling must resolve to its surviving identity only when exactly one venue matches.
The shared `venuePermalinkKeys` boundary applies the existing `venueSearchNames` aliases.
The invariant covers both `/pub/:slug` and `/venue/:slug`, bare names, full outward postcodes, shortened districts, and shortened name stems.
Direct canonical IDs and merged duplicate IDs must retain their existing resolution.
Unknown, malformed, and ambiguous names must still refuse resolution.
The bare `the-black-friar` alias must refuse because London and Manchester both match.
The postcode-qualified London and Manchester links must still resolve to their respective identities.

The [delivery report](report.md) owns the before-fix reproduction, focused results, and their proof limits.
The focused verification must prove that both routes redirect to `/map?sel=venue-eltcmh` with status 308.
It must also cover spelling aliases, postcode variants, existing Ship stems, canonical IDs, duplicate IDs, and ambiguous aliases.
The permanent behavioral tests are `__tests__/blackfriarPermalink.test.ts` and `__tests__/venuePermalinkSlug.test.ts`.
The later Test phase owns their configured Vitest execution.

## Native-date evidence invariant and scenarios

Every date-accessibility claim must distinguish application labels, Chromium AX subcontrol names, actual speech, and native-runtime behavior.
This invariant applies to the author plan, delivery report, and renewed Review and Test evidence.
The relevant application controls remain explicitly named at these consumers:

- `components/diary/DiaryLogPanel.tsx`.
- `components/diary/DiaryList.tsx`.
- `components/identity/AccountOnboarding.tsx`.
- `components/identity/PrivateIdentityEditor.tsx`.
- `components/visits/VisitReportPanel.tsx`.

The recorded human decision identifies `native-date-minimal.json` as a plain-page reproduction without application code.
It reports duplicated AX subcontrol names on named native date inputs.
The same decision reports that the explicit-label probe produces one normal application label.
These are recorded evidence descriptions, not fresh checks in this review.
The [delivery report](report.md#preserved-raw-browser-evidence) owns artifact availability, provenance, and the reconstructed comparison's proof limits.
The next Test handoff must retain the recorded evidence gap rather than claim independent verification of missing originals.

For renewed Test, retain the raw application reproduction and any recovered original minimal-page comparison unchanged.
Compare the reconstructed fixture's parent labels and internal AX names through the browser accessibility interface.
Record browser version, platform, viewport, theme, and provenance separately for each capture.
Do not infer spoken announcements from AX names.
Do not infer VoiceOver, TalkBack, or native readiness from a desktop Chromium capture.
Carry the unresolved upstream limitation and missing native proof into the final Test report.
