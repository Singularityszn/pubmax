# Tonight fixture review

Base: `605249b97`. Failure evidence came from the completed `ad3af9599` production browser run.
The source review covers five specs and eight failed cases in `/tmp/pubmaxx-audit-full-ad3-failure-ledger.json`.

| Failure | Current contract | Correction |
| --- | --- | --- |
| Mobile heading | `tonightHeading` uses London copy without a local area. | Use the exact London heading and two known independent listings. |
| Share status, phone and desktop | `TonightShareControl` owns the status below its action. | Keep polite, atomic status and below-action geometry in that owner. |
| First row below the phone dock | The 7 September contract puts researched pubs before independent listings. | Measure the first actual answer and require its whole box above the dock. |
| Vibe chips, phone and desktop | Chips require a ready or empty listings answer. Saved failures show an unavailable answer. | Cover ready, empty, and unavailable feeds separately. |
| Chain offer inside primary wrapper | `tonight-lede` is the governed lead. Chain blocks follow it inside the wider column. | Keep the chain out of the lead and require its offer below the lead. |

`app/AGENTS.md` names the current lead order. `TonightClient` and the saved failure DOM match it.
The older `.tonightRow` began at 1568.3 px because the researched pub rows came before it.
This is not proof that the current first answer is below the dock. The corrected browser assertion must measure that answer.
The independent list must still precede the secondary Deals lane.

Ready vibe checks click the music filter and verify its selected state and resulting row.
Empty checks retain the keyboard-accessible quiet-plan link. Unavailable checks retain Retry and forbid a false quiet-night claim.
Phone controls retain the 44 px target and no-overflow checks. No test is skipped and no timeout is extended.
No production source changed.

Scoped lint passed. Four existing source suites passed 37 tests:
`tonightHypedLede`, `tonightLedeContract`, `vibeChips`, and `vibeChipsSharedSkin`.
See [source test output](source-tests.txt).
No browser, build, development server, or native runtime ran for this candidate.
The main audit task owns the corrected browser run and geometry evidence.
