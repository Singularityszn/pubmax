# Validation status

The local benchmark CLI passed all 36 checks after the recovered review fixes.
The checks used synthetic local websites and the pinned PageSift executable.
They covered request limits, access refusals, redirects, provenance, evaluation, reference holds, and saved review decisions.
The complete run took 71.412 seconds. No pub requests occurred during these checks.

The retained paired archive passed its current offline audit for 60 venues, 120 arms, and 637 upstream attempts.
The audit found no accepted unreadable terms pages or published host-delay violations in that paired archive.
Earlier excluded calibration incidents remain in calibration-notice.json.
The compact result reproduced the evaluation without network access.

The measured crawler remains commit c350c09b785f4e5798665751606ed0466a5ff213.
Later runtime fixes have not received a live measurement.

The earlier no-mistakes run 01M69VH4HAT3GTV57RTJ4RGMVZ failed when its fix agent exhausted its output limit.
Its four committed fixes through 25a91e5b8f1292699e8251744bc3cbbef84d952d were recovered.
The three remaining fixes were restored from that worker's recorded source patches.
The 36 passing checks cover that restored state.

Final no-mistakes validation and changed-scope repository verification remain pending.
A different PUBMAXX task holds the next shared test slot.
No dependency installation, heavy Test step, or application build was started during that reservation.
Earlier changed-scope checks passed before these review fixes. They do not establish a pass for the final head.
This branch has not been pushed, merged, deployed, or declared ready to merge.

The private review page uses the PUBMAXX design tokens and font stacks.
Scripted review checks passed. Browser rendering remains unverified because the Chrome bridge was unavailable.
The 12-venue gold sample remains provisional until a human approves its source decisions and inventory coverage.
