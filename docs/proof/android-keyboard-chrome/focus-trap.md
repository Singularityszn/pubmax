# Hidden tab bar focus proof

The production browser probe used a 390x844 phone viewport. It focused the planner text field and simulated a visual viewport height of 500px. The app marked the mounted tab bar hidden and inert. The probe then focused the final sheet control and dispatched Tab in the same task, before the deferred focusout recompute. This isolates the trap's handling of the current hidden state.

| Observation | Before | After |
| --- | --- | --- |
| Tab was intercepted | Yes | Yes |
| Focus stayed at the final sheet control | Yes | No |
| Focus wrapped to the first sheet control | No | Yes |
| Shift+Tab wrapped from first to last | Not recorded | Yes |

The trap now excludes controls under an inert or aria-hidden ancestor when selecting focus. It checks the current DOM state on each Tab, so a cached exempt surface cannot contribute a hidden target.

The mounted-hook regressions failed before the fix for both inert and aria-hidden surfaces. They pass after it and also check reverse wrapping and restoration of the exempt region when it becomes reachable. All 50 focused tests passed.

[The probe output](focus-trap-results.json) records the immediate focus result. The [before screenshot](before/focus-trap-before.png) and [after screenshot](after/focus-trap-after.png) show the page after the event. The later focusout recompute can restore the visible dock before a screenshot, so the images alone do not prove the hidden-state focus result.

This follow-up has production browser and mounted-hook evidence. It adds no native IME or physical-device proof. The existing A14 and A16 follow-ups remain unchanged.
