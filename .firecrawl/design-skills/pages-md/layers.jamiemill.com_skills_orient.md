Orient — Layers

[Layers](/)[Skills](/skills)[About](/about)Install

[← All skills](/skills)

 Diagnostic

Orient

`/layers-orient`

Diagnostic audit across all seven layers — find the bottleneck and where to focus.

Example prompts

Drop one of these into your AI tool. The skill takes it from there.

I'm taking over a redesign and don't know where to start. `/layers-orient` me on the current state.

Something feels off with this feature but I can't name what. Run `/layers-orient` across all seven layers.

Before we kick off the next quarter, `/layers-orient` the team — where are we strongest, where are the gaps?

The skill itself

What `/layers-orient` tells the AI to do

 Below is the actual skill — the instructions your AI tool follows when you run it. Reading it is optional; the skill loads itself.

/layers-orient

Assumes `/layers-intro` has been loaded for framework context.

Orient is a rapid diagnostic — the front door for finding the live decisions the other skills then work. It maps the current state of decisions across all seven layers, identifies the bottleneck — the lowest layer with unresolved or risky decisions — and recommends where to focus next.

It is not a deep dive into any layer. That’s what the individual layer skills are for. Orient answers the prior question: which layer deserves attention most urgently? Keep it fast and light — the output is a short audit and one recommendation, not a report.

What it assesses:

Whether key decisions have been made at each layer, and how solidly

Whether decisions treated as solid are actually assumptions

Which layer is the most foundational with unresolved work, creating risk for everything above

Quality signals — when orient is done well:

The bottleneck layer is specifically named, not vaguely gestured at

Assumed layers are distinguished from Strong ones — they require different responses

The recommendation connects to a specific skill with a clear reason

Guided session

Describe your design situation and what prompted you to pick it up, or say “let’s orient” to start.

(Capture is opt-in and light — see `/layers-intro`. For orient, the audit table itself is usually all that’s worth keeping.)

Then ask:

What product or feature are you working on?

What design challenge are you facing right now?

How far along is this work — early exploration, active design, or fixing something in an existing product?

Listen for clues about which layers have already been worked through and which are thin or missing.

Layer audit

Work through each layer with one or two targeted questions. Rate each as: Strong / Partial / Assumed / Weak / Not started / N/A

Observed behaviour“What user research do you have? Have you spoken to users, observed them, or have analytics? Or is this mostly based on what the team believes users do?”

The domain“How well do you understand the space this product operates in — the real-world concepts, terminology, and how users think before your product enters the picture?”

User needs“Can you articulate what users are trying to achieve — not in features, but the underlying job and why it matters? Do you have job stories or equivalent?”

Product & service strategy“Do you know which specific user need this work targets and what business outcome it’s meant to move? Is the connection between opportunity and business goal explicit, or informal?”

Conceptual model“Does the product have a clear model of the objects it works with — the things that exist, how they connect, and what vocabulary you use? Is this shared across the team, or does each person have their own version?”

Interaction structure and flow“Do you have a clear picture of the key user journeys — places, steps, decision points? A breadboard, rough flow, working code, or a description you can narrate?”

Surface“Is there an existing design system, visual language, or component library this needs to fit into?”

Decision landscape

Produce the audit as a table:
`Layer | State | Notes---------------------------|-------------|----------------------------------------Observed behaviour | |The domain | |User needs | |Product & service strategy | |Conceptual model | |Interaction structure | |Surface | |`
Bottleneck analysis

Identify the bottleneck layer: the lowest layer with Weak, Assumed, or Not started state. State it clearly: what decisions are missing, and what risk does that create for the layers above?

Also flag assumed layers — layers treated as decided but not verified. Assumptions that look solid are often where the most dangerous decisions hide.

If the designer has a deadline or constraint that changes the calculus, acknowledge it. Sometimes the right move isn’t the most foundational one — name that tradeoff explicitly rather than ignoring it.

Recommendation

Recommend a specific skill to run next and why:

Conceptual model → `/layers-conceptual-model`

Product strategy → `/layers-product-strategy`

User needs → `/layers-user-needs`

Domain → `/layers-domain`

Interaction structure → `/layers-interaction-flow`

Observed behaviour → `/layers-observed-behaviour`

Close with: “Want to run [skill] now, or is there something in this picture to push back on first?”
 Show full skill ↓

Example output

An example of what `/layers-orient` captures

From a roles & permissions redesign in a B2B analytics product.

PreviewMarkdown

Layer audit

LayerStateNotes
Observed behaviourWeakOne customer complaint, team intuition. No analytics or research at hand.
DomainPartialClear on basic objects. Less clear whether "role" maps to how admins think about the job.
User needsPartialFunctional need clear (control access). Underlying job — "grant access by intent, not by enumeration" — not explicitly articulated.
Product & service strategyAssumed"Good time to improve" is informal. No explicit business outcome stated.
Conceptual modelWeakWhitelist-of-named-items model is the root cause of the main complaint. Model conflates what content exists vs what capability a role represents.
Interaction structureAssumedFlows exist but described as confusing. Likely a symptom of model problems.
SurfaceAssumedExisting UI exists.
Bottleneck: Conceptual Model. The "always update the role when you add a dashboard or block" complaint is not a UI problem — it's a model problem. A Role defined as a whitelist of specific named objects is coupled to content instances. Every new piece of content breaks every affected role.

`## Layer audit | Layer | State | Notes | |---|---|---| | Observed behaviour | Weak | One customer complaint, team intuition. No analytics or research at hand. | | Domain | Partial | Clear on basic objects. Less clear whether "role" maps to how admins think about the job. | | User needs | Partial | Functional need clear (control access). Underlying job — "grant access by intent, not by enumeration" — not explicitly articulated. | | Product & service strategy | Assumed | "Good time to improve" is informal. No explicit business outcome stated. | | Conceptual model | Weak | Whitelist-of-named-items model is the root cause of the main complaint. Model conflates what content exists vs what capability a role represents. | | Interaction structure | Assumed | Flows exist but described as confusing. Likely a symptom of model problems. | | Surface | Assumed | Existing UI exists. | **Bottleneck: Conceptual Model.** The "always update the role when you add a dashboard or block" complaint is not a UI problem — it's a model problem. A Role defined as a whitelist of specific named objects is coupled to content instances. Every new piece of content breaks every affected role.`

Spans
All seven layers

Diagnostic skill — audits the whole stack.

Source
[SKILL.md ↗](https://github.com/jamiemill/layers-skills/blob/main/skills/layers-orient/SKILL.md)

Run it
`/layers-orient`

In your AI tool, after installing the skills.
Install →

Install

Install the skills

 Install in Claude Code, Cursor, Codex & more

`npx skills add jamiemill/layers-skills`CopyCopied
 Install once with the skills package, then run any `/layers-*` skill in your AI tool.

[Layer 1 →Observed behaviour](/skills/observed-behaviour)

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
