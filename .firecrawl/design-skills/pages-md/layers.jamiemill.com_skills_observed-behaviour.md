Observed behaviour — Layers

[Layers](/)[Skills](/skills)[About](/about)Install

[← All skills](/skills)

 Layer 1 · Problem space

Observed behaviour

`/layers-observed-behaviour`

Plan and synthesise user research at the observed-behaviour layer — into grounded, confidence-rated findings about what users actually do.

Example prompts

Drop one of these into your AI tool. The skill takes it from there.

Plan a research study to understand how users actually finish onboarding. Run `/layers-observed-behaviour`.

Analytics shows a drop-off at step 3. Use `/layers-observed-behaviour` to design what to investigate.

Synthesise these 12 interviews into job stories with confidence ratings — `/layers-observed-behaviour`.

The skill itself

What `/layers-observed-behaviour` tells the AI to do

 Below is the actual skill — the instructions your AI tool follows when you run it. Reading it is optional; the skill loads itself.

/layers-observed-behaviour

Assumes `/layers-intro` has been loaded. This skill is a library of techniques, not a script — see “How to use these skills” there.

The observed behaviour layer is the closest we can get to reality — what users actually do, not what we think they do or wish they would. Everything above it is interpretation; this layer is the source.

It splits into two situations. Detect which applies and say so:

Plan — no research yet; design a study.

Synthesise — research material exists; make sense of it.

With partial research, synthesise what exists first, then plan to fill the gaps.

The decisions this layer makes

What specific questions we most need to answer about our users

What evidence already exists, and how reliable it is

How to gather what’s missing

What patterns hold with confidence vs. what remains assumption

Disciplines — what keeps observation honest

Stay close to raw data. Observations should be specific and near the source — what users said, did, felt — not summarised into conclusions.

Ground in something seen or heard, not in team beliefs.

Mark confidence: observed / inferred / assumed. If you mark something observed, the verbatim that supports it should be quotable in the same note — an observed claim with no quotable evidence is really inferred.

Name research gaps explicitly rather than papering over them.

Workarounds are signal. A need real enough to motivate improvisation is a strong one.

Techniques

To plan a study

TechniqueUse it when
Define the learning goalAlways start here. Push past “understand users better” to 2–3 specific questions — “what triggers someone to refer a friend, and what makes them hesitate.”
JTBD interviewsUnderstanding triggers, motivations, anxieties. Interview about a real past experience, not hypotheticals. Guide: opening (“tell me about the last time you…”), timeline (what triggered it, what you tried), motivations (what you hoped, what worried you), closing.
Contextual inquiry / observationWhat users say differs from what they do — watch real work for tacit behaviour.
Diary studiesBehaviour is distributed over time or infrequent — users self-report as events occur.
Support ticket / review analysisExisting product with accumulated signal — pain points at scale without recruiting.
Analytics reviewWhat users do (not why). Complements qualitative; doesn’t replace it.
Usability observationWhere people struggle or succeed with an existing product.
For interviews, plan synthesis up front: one observation per note, tagged with the question it speaks to, raw quotes over summaries. (6–10 qualitative interviews usually reach saturation.)

To synthesise material

TechniqueUse it to
Extract observationsPull out concrete things users said, did, or felt — no interpretation yet. From memory, prompt: most surprising thing? what recurred? what did they struggle with unexpectedly?
Pattern groupingGroup observations by recurring situations, common motivations, shared anxieties, and workarounds.
Candidate job storiesWhen [situation], I want to [motivation], so I can [outcome]. Check the “When” is specific and the “want” is a motivation not a solution; mark confidence.
Gap-flaggingWhat do the observations not yet answer? These become a follow-up Plan session.
Working with the designer

First find out what exists — interviews, recordings, tickets, analytics — and state the mode. Listen for nouns (candidate domain objects) and the natural language users use; that feeds the domain layer.

Offer the technique that fits: in Plan, the method matched to the learning goal; in Synthesise, extraction → patterns → candidate stories. Do the next useful thing, not a full battery.

Capture only the residue — key raw observations, the patterns with their supporting evidence, candidate job stories with confidence ratings, and the named research gaps.

Candidate job stories are ready to refine at `/layers-user-needs`.
 Show full skill ↓

Example output

An example of what `/layers-observed-behaviour` captures

From a research plan for an onboarding redesign.

PreviewMarkdown

Research plan — onboarding completion

Goal

Understand why new users drop off between sign-up and creating their first dashboard.

Method

Mixed: 8 user interviews with people who signed up in the last 30 days (4 completed onboarding, 4 dropped); 1 week of session replays for the same cohort.

What we'll capture

Where (which step) users hesitate, abandon, or backtrack.

What they expected vs. what the product showed them.

Which terms in the UI confused them.

What they tried before reaching for help (or giving up).

Synthesis — after 5 of 8 interviews

Job story 1`observed`

When I sign up to evaluate a tool, I want a quick win that proves the product works for my data, so I can decide whether to invest more time in setup.

Job story 2`inferred`

When I get blocked during setup, I want examples that match my context, so I don't have to translate generic docs to my situation.

Strategic flag. "Connect a data source" is the single biggest drop-off — users disengage at credential prompts. Worth a strategy-layer conversation about removing or deferring this step.

`## Research plan — onboarding completion ### Goal Understand why new users drop off between sign-up and creating their first dashboard. ### Method Mixed: 8 user interviews with people who signed up in the last 30 days (4 completed onboarding, 4 dropped); 1 week of session replays for the same cohort. ### What we'll capture - Where (which step) users hesitate, abandon, or backtrack. - What they expected vs. what the product showed them. - Which terms in the UI confused them. - What they tried before reaching for help (or giving up). ## Synthesis — after 5 of 8 interviews **Job story 1** `observed` > *When I sign up to evaluate a tool, I want a quick win that proves the product works for my data, so I can decide whether to invest more time in setup.* **Job story 2** `inferred` > *When I get blocked during setup, I want examples that match my context, so I don't have to translate generic docs to my situation.* **Strategic flag.** "Connect a data source" is the single biggest drop-off — users disengage at credential prompts. Worth a strategy-layer conversation about removing or deferring this step.`

Zone
Problem space

Knowledge gathered from reality.

Position
Layer 1 of 7

Source
[SKILL.md ↗](https://github.com/jamiemill/layers-skills/blob/main/skills/layers-observed-behaviour/SKILL.md)

Run it
`/layers-observed-behaviour`

In your AI tool, after installing the skills.
Install →

Install

Install the skills

 Install in Claude Code, Cursor, Codex & more

`npx skills add jamiemill/layers-skills`CopyCopied
 Install once with the skills package, then run any `/layers-*` skill in your AI tool.

[Layer 2 →The domain](/skills/domain)

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
