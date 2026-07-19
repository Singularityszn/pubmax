# Design Judge — Wave 2 Verdict (2026-07-20)

_The overnight taste loop's exit test. Every core mobile surface captured at 390x844 in both themes on a production build (SwiftShader WebGL for the map), judged against docs/DESIGN_DIRECTION_2026-07-18.md, docs/DESIGN_SYSTEM.md, docs/VOICE_AND_WORDING_SPEC_2026-07-18.md, docs/VIBE_LAYER_SPEC_2026-07-19.md and the design-engineering discipline. Evidence: docs/screenshots/judge-w2-*.png (14 primary shots + landing scroll pair; map re-shot at 15s paint via JUDGE_MAP_WAIT_MS)._

**Verdict: CLEAN PASS. Zero blocking findings. The #423-#432 wave holds together as one app.**

## Per-surface status

| Surface | Status | One-liner |
|---|---|---|
| / (landing) | Clean | Hierarchy carries: display headline, receipts subhead, one coral action, mono proof points; six-tab bar even in both themes. |
| /map/london | Clean | Fully painted both themes; compass sits clear of the pill row and floaters (judge-w1 fix verified); landmark register consistent. |
| /tonight | Clean | Honest quiet-night line with underlined map exit (friction fix live), vibe chips stamp in Bungee without shouting, value cards below the fold-line. |
| /today | Clean | Brief reads as a morning ritual: weather verdict, picks with map exit, privacy-honest last-train ask; card rhythm even. |
| /pal/chat | Clean | Chips + Tonight glance give the first open real value; covenant copy up top; input anchored with thumb-reach send. |
| /feed | Clean | One-row header, "Yours" label (banned Apple-ism gone), empty state hands a CTA not an apology. |
| /near (location denied) | Clean | Five priced cards render instantly, one dry line, compact Change area + retry; the borough wall is gone in both themes. |
| Pal first-open glance | Clean | Quiet-night line with map exit when whats-on is thin; nothing renders on outage. |

## Remaining polish (ranked, none blocking — wave-3 candidates)

1. **Pal chat mid-zone**: below the glance panel ~250px still sits empty at 390x844. Candidates: recent-ask history once transcripts persist, or a second glance row (cheapest pint near the remembered patch).
2. **Feed tab strip truncation**: "Cheap Lege…" clips at the viewport edge; the scroll fade + partial-chip peek is the affordance, but shorter labels would remove the need.
3. **/near header idiom**: back-arrow + centred logo differs from the main-surface header pill; acceptable for a sub-page, unify if it ever gains siblings.
4. **Landing coach chip**: the "Pick a drink" tooltip overlaps the hero image edge on first paint; transient and self-dismissing.
5. **Map first-frame attitude**: fresh-session capture reads flat; the designed 38/-8 attitude and its session restore were verified live post-#421. Watch only.

## Notes

- Both themes were captured for every surface; no theme-specific defect found.
- All copy on the judged surfaces is em-dash free and in house voice; no banned register appeared.
- The vibe chips read as the user's voice (stamps), not the brand shouting: Bungee at chip scale with letter-spaced caps held its discipline on both Tonight and pal surfaces.
