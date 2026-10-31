# PageSift 0.81.0 licence review

Review date: 31 October 2026.
Decision: permit this isolated experiment. Reject production integration until its licence obligations have a recorded decision.

The [0.81.0 release](https://github.com/YOLOW92/pagesift/releases/tag/v0.81.0) states AGPL-3.0-only and offers commercial licensing.
The release points to commit `8c1c799a40447bf33e5c772075e63a917903bb41`.
The [licence at that commit](https://github.com/YOLOW92/pagesift/blob/8c1c799a40447bf33e5c772075e63a917903bb41/LICENSE) contains GNU AGPL version 3.
The workspace package metadata also states `AGPL-3.0-only`.
This is version 3 only, not an option to choose a later licence version.

The [dependency lock](dependency-lock.json) records the source commit, release archive hashes, and licence hash.
The bootstrap downloads an unchanged executable and its licence into an ignored tools directory.
The experiment calls that executable through its CLI. It does not copy PageSift code into the application.
The application package manifest and lockfile remain unchanged.

## Obligations that affect a future integration

AGPL section 2 permits running an unmodified program. The local experiment does not offer PageSift as a public service.
If we convey the executable, sections 4 and 6 require the applicable notices and Corresponding Source arrangements.
We do not distribute the executable in this change.

Section 5 covers modified source versions and the licensing of a combined covered work.
Its aggregation exception concerns separate, independent works. It does not automatically settle whether an integration forms a combined work.
Calling a separate process does not by itself establish that every integration qualifies as an independent aggregate.

Section 13 requires a modified network-interactive version to offer its Corresponding Source to remote users.
A source offer can cover more than a small patch when the modified or combined work contains other covered code.
These obligations need an architecture-specific assessment before a hosted or modified integration.

The output URLs and price facts do not automatically become AGPL-licensed merely because PageSift produced them.
Website copyright, access terms, and database rights remain separate questions.
The benchmark therefore keeps complete response bodies private and retains source attribution for each fact.

## Integration decision required

Before adoption, record the exact deployment architecture and whether PageSift changes or links to application code.
Record any distribution of its executable or containers.
Then choose either a compliant AGPL release and source-offer plan, or an executed commercial licence with suitable rights.
The publisher offers a commercial option, but its price and terms are unknown in this experiment.
No purchase, licence acceptance, distribution, or production integration is authorised by this benchmark.

This review identifies engineering obligations. It does not claim that process isolation resolves all licence questions.
