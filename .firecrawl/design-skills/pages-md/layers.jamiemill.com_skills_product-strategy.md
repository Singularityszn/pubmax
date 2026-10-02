Product & service strategy — Layers

[Layers](/)[Skills](/skills)[About](/about)Install

[← All skills](/skills)

 Layer 4 · Solution space

Product & service strategy

`/layers-product-strategy`

Connect user opportunities to business outcomes and solution bets — and test the riskiest assumptions cheaply.

Example prompts

Drop one of these into your AI tool. The skill takes it from there.

Help me `/layers-product-strategy` — connect our quarterly outcomes to the bets we should be making.

Stakeholders keep changing the brief. Use `/layers-product-strategy` to make our trade-offs explicit.

Run `/layers-product-strategy` on these opportunities — which ones should we actually pursue and why?

The skill itself

What `/layers-product-strategy` tells the AI to do

 Below is the actual skill — the instructions your AI tool follows when you run it. Reading it is optional; the skill loads itself.

/layers-product-strategy

Assumes `/layers-intro` has been loaded. This skill is a library of techniques, not a script — see “How to use these skills” there.

Strategy is the first layer of the solution space — where problem-space understanding converts into deliberate decisions about scope and direction. It is about choices: which user needs to serve, and which business outcomes to target.

The decisions this layer makes

The business outcome this work serves

Which user opportunities (needs, pains, desires) genuinely connect to that outcome

What solution bets we’re placing on those opportunities

How to test the riskiest assumptions cheaply

Which bets to pursue first, and why

If the outcome and the bets are already clear, don’t rebuild the tree for its own sake.

Disciplines — what keeps strategy honest

The outcome is measurable, meaningful, and bounded. Not “grow the product” but “increase users who activate in the first 30 days.” One outcome per tree.

Opportunities are customer needs/pains/desires — anchored to a journey moment. First-person, problem-space statements (“I don’t know which streaming service has this movie”), not job stories and not features. Apply the flip test: if you can restate it as a feature, it’s a solution in disguise. Keep them specific, not generic. Group opportunities by journey moment — the forcing function that exposes vague opportunities and surfaces moments left unaddressed. (Teresa Torres.)

Every opportunity connects to the outcome. If serving it wouldn’t move the outcome, it doesn’t belong in this tree.

Every bet names its riskiest assumption, and there’s more than one bet per opportunity — resist early convergence.

Every experiment is the cheapest way to test the core assumption — days, not months.

Techniques

The Opportunity Solution Tree is the default; the rest serve particular strategic questions.

TechniqueUse it when
Opportunity Solution Tree (Teresa Torres)Default. Makes outcome → opportunity → solution → experiment explicit. Good for ongoing discovery.
Solution betsFor a chosen opportunity: “We could [solution], which we believe would [serve the opportunity] because [reasoning].” Generate several; name each one’s key assumption.
ExperimentsCheapest test of a bet’s core assumption — prototype, fake door, concierge, a targeted interview, data analysis.
Impact mapping (Gojko Adzic)B2B with multiple stakeholders who each must change behaviour.
Jobs portfolio mappingMany job stories — decide which to target by frequency, severity, strategic fit.
Now / Next / Later roadmapThe team needs a shared timeline view of bets.
Kano analysisSort candidate features into hygiene, performance, and delight.
HEART / North Star (Google / Amplitude)Choosing the outcome metric. HEART structures the choice; North Star distils to one.
Wardley mappingPositioning depends on where capabilities sit on the evolution curve; build/buy/partner.
Bundling / unbundling (Christensen)Should this product own more of the workflow, or one job precisely?
NPE CanvasConsumer products: Narrative, Primitive, Enablers.
Critical User Journeys (Google / Reforge)Which flows to prioritise — the minimal path to core value (high-traffic, high-revenue, or metric-critical).
When you build the tree as a diagram (`graph TD`): outcome at the top, branching down through opportunities grouped by journey moment, then bets, then experiments. Top-to-bottom reads as dependency, not sequence.

Working with the designer

Settle the desired outcome first, pushing for specificity. Then map the opportunities that connect to it (applying the disciplines above), generate bets for the ones worth pursuing, and identify the cheapest experiment for the most promising. Prioritise by opportunity size, assumption risk, effort, and reversibility — start with high size, manageable risk, and a clear experiment path, not necessarily the most ambitious.

Offer the technique that fits the question — an OST to connect things end to end, Kano or jobs-portfolio to choose among many candidates, Wardley or bundling for positioning. Don’t run them all.

Capture only the residue: the outcome, the opportunity tree (opportunities grouped by journey moment), the top 2–3 bets with their experiments, deferred bets worth returning to, and the open questions (untested assumptions, ungrounded needs). If the needs underneath were weak or assumed, say plainly that the strategy is a bet on assumptions.

The bets chosen here define what needs designing next — the objects, relationships, and vocabulary those solutions work with: `/layers-conceptual-model`.
 Show full skill ↓

Example output

An example of what `/layers-product-strategy` captures

From a customer referral programme.

PreviewMarkdown

Desired outcome

Referrals become a measurable source of new customer acquisition — enough to establish the channel as viable and worth investing in further.

Opportunity Solution Tree
graph TD A["Outcome: referrals become
a measurable acquisition channel"] A --> O1["O1 — Discovery
customer has a referral moment
but no mechanism to act"] A --> O2["O2 — Incentive fit
customer needs something
worth the social cost"] A --> O3["O3 — Friction
customer has decided to refer
but the act is effortful"] O1 --> S1["Persistent referral link
in account menu"] O1 --> S2["Triggered prompt after
positive signal"] O2 --> S4["$100 voucher"] O3 --> S6["Personal link + code
+ copyable message"]
Key decisions

Referrer incentive: $100 voucher to the individual user. Subscription discounts don't benefit the person doing the referring in B2B.

Referee incentive: 30% off first month. Gives the referrer something concrete to offer.

Mechanism: Persistent personal link and code (not per-referral). Lower friction, sufficient for a validation experiment.

`## Desired outcome Referrals become a measurable source of new customer acquisition — enough to establish the channel as viable and worth investing in further. ## Opportunity Solution Tree ```mermaid graph TD A["Outcome: referrals become<br/>a measurable acquisition channel"] A --> O1["O1 — Discovery<br/>customer has a referral moment<br/>but no mechanism to act"] A --> O2["O2 — Incentive fit<br/>customer needs something<br/>worth the social cost"] A --> O3["O3 — Friction<br/>customer has decided to refer<br/>but the act is effortful"] O1 --> S1["Persistent referral link<br/>in account menu"] O1 --> S2["Triggered prompt after<br/>positive signal"] O2 --> S4["$100 voucher"] O3 --> S6["Personal link + code<br/>+ copyable message"] ``` ## Key decisions - **Referrer incentive:** $100 voucher to the individual user. Subscription discounts don't benefit the person doing the referring in B2B. - **Referee incentive:** 30% off first month. Gives the referrer something concrete to offer. - **Mechanism:** Persistent personal link and code (not per-referral). Lower friction, sufficient for a validation experiment.`

Zone
Solution space

Deliberate decisions about what to build.

Position
Layer 4 of 7

Source
[SKILL.md ↗](https://github.com/jamiemill/layers-skills/blob/main/skills/layers-product-strategy/SKILL.md)

Run it
`/layers-product-strategy`

In your AI tool, after installing the skills.
Install →

Install

Install the skills

 Install in Claude Code, Cursor, Codex & more

`npx skills add jamiemill/layers-skills`CopyCopied
 Install once with the skills package, then run any `/layers-*` skill in your AI tool.

[← Layer 3User needs](/skills/user-needs)
[Layer 5 →Conceptual model](/skills/conceptual-model)

Install

 Install in Claude Code, Cursor, Codex & more

`npx skills add jamiemill/layers-skills`CopyCopied
 Install once with the skills package, then run any `/layers-*` skill in your AI tool.

Layers

[Home](/)

[Skills](/#skills)

[About](/about)

Elsewhere

[jamiemill.com](https://jamiemill.com)

[GitHub](https://github.com/jamiemill/layers-skills)

 Skills are [MIT-licensed](https://github.com/jamiemill/layers-skills/blob/main/LICENSE). Fork them, adapt them, ship them.
