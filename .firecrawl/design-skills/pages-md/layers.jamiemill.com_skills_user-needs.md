User needs — Layers

[Layers](/)[Skills](/skills)[About](/about)Install

[← All skills](/skills)

 Layer 3 · Problem space

User needs

`/layers-user-needs`

Elicit and prioritise user needs, pains, and desires — the opportunities that feed product strategy.

Example prompts

Drop one of these into your AI tool. The skill takes it from there.

Turn these interview notes into prioritised job stories with `/layers-user-needs`.

Help me `/layers-user-needs` for this onboarding flow — I have research, I need direction.

I have a feature list pretending to be a roadmap. Run `/layers-user-needs` and rebuild it around opportunities.

The skill itself

What `/layers-user-needs` tells the AI to do

 Below is the actual skill — the instructions your AI tool follows when you run it. Reading it is optional; the skill loads itself.

/layers-user-needs

Assumes `/layers-intro` has been loaded. This skill is a library of techniques, not a script — see “How to use these skills” there.

User needs are what we think users are trying to achieve, and why — an interpretation built on observed behaviour and domain knowledge, not a direct capture of reality. This layer sits between the messy raw material of observation and the deliberate decisions of the solution space.

The outputs here are opportunities: needs (what users want to achieve), pains (what causes friction), and desires (improvements they’d value). All three are valid — elicit all three.

The decisions this layer makes

Who exactly the users are whose needs we’re defining — and in what situation

What jobs they’re trying to do: functional, emotional, and social

Which needs are grounded in evidence, and which are assumptions

Which needs matter most, and why

If the needs are already clear and grounded, don’t re-elicit them for the sake of it — take them to `/layers-product-strategy`.

Disciplines — what keeps needs honest

Need, not solution. “When I need a report, I want to export to CSV” is a solution. Push to the underlying need.

Strip the mechanism. If the “When” clause references your specific solution (your dashboard, your CSM, your weekly email), you’re describing the current system, not the need. Re-state it independent of who or what serves it: what’s true about the user at the moment they need this? The need follows from the state, not the mechanism.

The “When” must be picturable. Specific enough to see the moment it happens — triggered by an event, a feeling, a rhythm, or a threshold crossed. Push until it is.

Elicit emotional and social jobs, not just functional. They’re chronically under-articulated even when they’re shaping behaviour. Asking explicitly is usually what surfaces them. (Functional → interaction & model; emotional → surface tone/feedback; social → surface, sometimes strategy.)

Mark confidence: observed / inferred / assumed.

Workarounds are signal. A need real enough to motivate a spreadsheet or a workaround email is a strong one.

Techniques

Job stories are the default; the rest suit particular situations.

TechniqueUse it when
Job stories (JTBD)Default. When [situation], I want to [motivation], so I can [outcome]. Keeps solutions out; the “When” clause forces specificity.
User storiesThe team prefers role-based framing or an existing Agile workflow.
Top tasks analysis (Gerry McGovern)Large existing user base — identify which tasks matter most by frequency. Statistical, survey-based.
Persona + scenarioCommunicating to stakeholders who think in archetypes. Good for alignment; less precise for design.
ODI desired outcomes (Ulwick)Precise, measurable statements — “Minimize [metric] when [context].” Maps directly to opportunity scoring.
Surface hidden needsPrompts to find what’s ignored: what users do before/after the moment you focus on; what they wish they didn’t have to do; what a workaround currently serves.
Rough prioritisationOrder by importance × how poorly currently served. A need that matters and is badly served is a high-value opportunity. Keep it rough — precise scoring is strategy work.
Working with the designer

First settle who the users are and in what situation — not “users” but which type, when. If there’s more than one distinct type with different needs, work them separately. Note the source (research, domain knowledge, or assumption); if it’s assumption, mark it and plan to validate.

Then work the needs the designer raises through the disciplines above, and probe for hidden ones. Offer the technique that fits — job stories by default, ODI when measurability matters, top tasks when there’s a large user base. Don’t run a fixed sequence.

Capture only the residue: the prioritised needs with confidence ratings, the unprioritised-but-surfaced ones (so they aren’t lost), gaps (probably-real needs not yet grounded), and any contradictions between user types. Keep it to what carries a decision.

These needs are the opportunities for `/layers-product-strategy`. If they’re mostly assumed, consider `/layers-observed-behaviour` to gather evidence before building strategy on them.
 Show full skill ↓

Example output

An example of what `/layers-user-needs` captures

From a customer referral programme.

PreviewMarkdown

Job stories

1. Personal referral`inferred`

When I'm in a conversation with a peer who needs a better tool like this, I want to pass on a concrete recommendation that includes something useful for them, so I can be genuinely helpful without it feeling like I have a personal stake in it.

2. Status and reward transparency`inferred`

When time has passed since I referred someone, I want to know whether they signed up, whether I've earned my reward, and what its current status is, so I don't feel like I was promised something that disappeared without explanation.

3. Public referral`observed`

When I'm in a public context where recommending tools is natural, I want to share the product in a way that reads as a genuine endorsement from a credible practitioner — not as someone promoting for a bonus.

Strategic flags

Altruism evidence is stronger than assumed. Observed public referrals happened without any mechanism or incentive. A voucher may activate referrers who need a nudge — but if it becomes the dominant framing, it can undermine motivation for people already acting from goodwill.

Gift framing is in the design but needs to be surfaced. The referee discount exists. The referrer needs to know about it — and it should be presented as what they're giving, not only what they're getting.

`## Job stories **1. Personal referral** `inferred` > *When I'm in a conversation with a peer who needs a better tool like this, I want to pass on a concrete recommendation that includes something useful for them, so I can be genuinely helpful without it feeling like I have a personal stake in it.* **2. Status and reward transparency** `inferred` > *When time has passed since I referred someone, I want to know whether they signed up, whether I've earned my reward, and what its current status is, so I don't feel like I was promised something that disappeared without explanation.* **3. Public referral** `observed` > *When I'm in a public context where recommending tools is natural, I want to share the product in a way that reads as a genuine endorsement from a credible practitioner — not as someone promoting for a bonus.* ## Strategic flags - **Altruism evidence is stronger than assumed.** Observed public referrals happened without any mechanism or incentive. A voucher may activate referrers who need a nudge — but if it becomes the dominant framing, it can undermine motivation for people already acting from goodwill. - **Gift framing is in the design but needs to be surfaced.** The referee discount exists. The referrer needs to know about it — and it should be presented as what they're giving, not only what they're getting.`

Zone
Problem space

Knowledge gathered from reality.

Position
Layer 3 of 7

Source
[SKILL.md ↗](https://github.com/jamiemill/layers-skills/blob/main/skills/layers-user-needs/SKILL.md)

Run it
`/layers-user-needs`

In your AI tool, after installing the skills.
Install →

Install

Install the skills

 Install in Claude Code, Cursor, Codex & more

`npx skills add jamiemill/layers-skills`CopyCopied
 Install once with the skills package, then run any `/layers-*` skill in your AI tool.

[← Layer 2The domain](/skills/domain)
[Layer 4 →Product & service strategy](/skills/product-strategy)

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
