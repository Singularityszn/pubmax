# ad3 first-run failure review

Read-only review of `/tmp/pubmaxx-audit-full-ad3-failure-ledger.json` and saved error contexts.
Tested source: `ad3af95996e7a7499a859951eabea16db6c707f4`.
No runtime or source change occurred during this review.

| Failure | Supported finding | Candidate scope |
|---|---|---|
| Onboarding, dark, Plan my night | Viewport ratio 0.5103124976158142 matches the independently reproduced baseline clipping. | CSS directly addresses this layout defect; native acceptance remains missing. |
| Onboarding, light, root stays `/` | Existing fixture defines a read-only Capacitor global without the custom platform. The real SDK assignment defect is independently reproduced. | Corrected nine-case fixture addresses that defect. Causation for this recorded failure remains unproven. |
| Returning direct onboarding stays `/` | Same defective native fixture; the document route also crosses the proxy boundary. | Needs route evidence with the valid bridge; no CSS claim. |
| Native useful-plan push and Skip push absent | Same native fixture can disrupt SDK loading or native runtime detection. | No CSS fix. Verify successful plan action, stable bridge, shell mounting, and prompt budget. |
| First-run map tour absent | Web shell extras wait 30 seconds, while the test expects the dialog within 10 seconds. Saved context shows the map without the tour. | No CSS fix. Preserve the literal before-first-value requirement; do not silently weaken it by raising timeouts. |
| Installed PWA push absent | PWA uses the same 30-second web shell delay. Saved context shows a generated Hand-built plan. | No CSS fix. Confirm shell mount timing and qualifying action notification before changing eligibility. |

`FirstRunTour`, `NativePushPrompt`, and `WebPushPrompt` contain no inspected authentication gate.
Their gates concern runtime, first-run/explicit intent, action sequence, and the shared prompt budget.
This evidence does not establish lost authentication eligibility.

The existing test override `pubmax:e2e-defer-shell:v1` changes scheduling, not first-run eligibility.
Using it could isolate component behavior, but would not prove the actual delayed first-run journey.
Do not seed native handoff, preferred city, action sequence, or claimed budget to manufacture a prompt.
A real plan action and normal prompt arbitration must remain in the end-to-end path.

Candidate remains uncommitted on `codex/ios-onboarding-actions`, based at `d55f6e16c`.
Only onboarding CSS, the corrected focused test, and proof files are pending.

## Consent geometry cluster at line 390

Six cases cover 320x568, 320x844, 360x640, 360x844, 390x844, and 430x932.
All six fail because the first onboarding row is absent, before any collision assertion.
The helper seeds a handoff, a consent answer, and the old read-only bridge, then requests `/onboarding` directly.
The proxy redirects an onboarding document request to `/`, regardless of browser session storage.
The native contract requires root entry to issue the handoff and use client navigation into onboarding.
A synthetic handoff cannot make the direct document request satisfy that contract.

Fresh native entry is not a useful product answer. The entry rewrite must not summon consent by itself.
A seeded consent answer isolates card geometry only; it does not prove actual first-run consent timing.
Use root-earned eligibility for this cluster and retain separate no-seed first-entry acceptance.

The existing post-dismissal assertion permits scrolling to a CTA that falls below the fold.
It retries scrollIntoView and accepts 0.99 viewport ratio, so it cannot prove the stricter issue 1531 requirement.
Preserve all six widths, row reachability, and real dismissal.
Add photo-ready initial bounds and full CTA visibility immediately after dismissal, before any automatic scrolling.
Keep separate focus and last-content access checks. Re-read rectangles after scroll or reflow before testing hit ownership.
No tests or product code changed during this source review.
