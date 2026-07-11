Surface — Layers

[Layers](/)[Skills](/skills)[About](/about)Install

[← All skills](/skills)

 Layer 7 · Solution space

Surface

`/layers-surface`

Audit and decide the surface against the layers below — vocabulary, object consistency, feedback, hierarchy, and accessibility.

Example prompts

Drop one of these into your AI tool. The skill takes it from there.

Audit this UI against the lower layers. Run `/layers-surface`.

Run `/layers-surface` — I think we have a shapeshifter problem (the same object looks different across screens) and I want to nail down where it's breaking.

Help me `/layers-surface` — review my mockups for vocabulary, feedback, hierarchy, and accessibility.

The skill itself

What `/layers-surface` tells the AI to do

 Below is the actual skill — the instructions your AI tool follows when you run it. Reading it is optional; the skill loads itself.

/layers-surface

Assumes `/layers-intro` has been loaded. This skill is a library of techniques, not a script — see “How to use these skills” there.

The surface layer is where everything decided below becomes something a person actually encounters: words, sounds, visuals, physical affordances, motion, feedback. It’s the most medium-specific layer, but the decisions that matter most first are universal — they hold whether the surface is a screen, voice interface, physical device, or service touchpoint.

Surface problems are often symptoms of deeper ones. The central discipline here is telling apart issues you can fix at the surface from issues that need a lower layer revisited.

The decisions this layer makes

Whether the surface honours the vocabulary and objects from the conceptual model

Whether every affordance from the breadboard is present — and whether any surface element has no model behind it

Whether the emotional register fits the jobs users are doing

How the user knows what happened, what’s in progress, and what went wrong

What’s most prominent, and whether it should be

Whether everything is accessible to the users who need it

Disciplines — what keeps the surface honest

Surface fix vs deeper-layer issue. The key judgement: is this something to fix in the copy/layout, or a symptom whose root is in the conceptual model or interaction flow? Wrong vocabulary may be a rewrite — or a model that never settled the term. Route deeper issues back to the relevant skill rather than patching the symptom.

Terms match the ubiquitous language. Flag direct violations (a model term used inconsistently), unlisted terms (surface words not in the model — add to model, or remove as noise), and tone misalignments.

Object consistency. No shapeshifters (same object in significantly different forms across contexts), no masked objects (a form where the user can’t recognise the object type).

Completeness both ways. Every breadboard affordance is present; no surface element exists with no model or flow behind it (those are interaction decisions that slipped through — route to `/layers-interaction-flow`).

Errors diagnose, explain, recover. “Something went wrong” fails all three. Flag every error state that doesn’t do all three.

Prominence reflects importance. What the flow needs the user to notice is what stands out; nothing prominent that shouldn’t be.

Accessibility is decided, not defaulted.

Emotional register matches the emotional and social jobs from user needs — not the product’s benefit framed as the user’s.

Techniques

Two kinds of work live here: auditing existing surface against the layers below, and working through open surface decisions. Use whichever the situation calls for.

TechniqueUse it to
Vocabulary checkTake the ubiquitous language list; check every label, heading, button, error, notification, help string against it.
Object-consistency checkFor each model object: where does it appear, in how many forms? Catch shapeshifters and masked objects.
Completeness checkWalk the breadboard against the surface in both directions — missing affordances, and surface with no model behind it.
Emotional-register checkReturn to the emotional and social jobs; find where tone, framing, or emphasis misaligns.
Feedback & error inventoryFor each action and state transition: how does the user know it worked, is in progress, or failed — and what to do next?
Hierarchy reviewPer key place: what must the user notice or act on, and does the surface make that most prominent? Decide what’s primary before how to signal it.
Accessibility passPer medium — screen (contrast, sizing, touch targets, keyboard, screen-reader labels, focus), voice (everything conveyed verbally, recovery without visual context), physical (reach, tactile differentiation, lighting, no fine-motor requirement).
Consistency passSimilar things treated similarly, different things differently; medium conventions honoured or deliberately broken.
Make it (real medium, mockups, style tiles, prototypes, design system, copy-first)When producing surface rather than auditing it. Work in code for real interaction feedback; mockups for layout/hierarchy; style tiles for early tone; prototypes for timing and motion; extend (don’t contradict) an existing design system; write copy first when language is the primary material.
Working with the designer

Establish the medium and what exists from below — conceptual model (objects + ubiquitous language), breadboard, job stories including emotional/social jobs. If surface exists, audit it; if not, work the open decisions.

Offer the technique that fits the live concern — a vocabulary check when terms feel off, a feedback inventory when users don’t know what happened, an accessibility pass when it’s been left to defaults. Don’t run all ten.

Capture only the residue: audit findings (each tagged surface-fix or deeper-layer issue), the open surface decisions grouped and prioritised (with options and constraints), the cross-layer issues to resolve first, and what’s already working well so it isn’t lost in revision.

The surface either honours what’s decided below or undermines it. Revisit after any significant change to the conceptual model or interaction structure.
 Show full skill ↓

Example output

An example of what `/layers-surface` captures

From a surface audit on a roles management UI.

PreviewMarkdown

Surface decision inventory

Surface decisionInherits fromStatus
Primary verb wordingConceptual model — "Apply" for viewsCommitted
Empty state copy: "No views"User needs — needs context, not just absenceDrafted
Loading state per blockInteraction flow — async dataDrafted
Touch target size on filter chipsAccessibility AAOpen
Tone in destructive confirmationsBrand — neutral, no shamingCommitted
Audit findings against lower layers

Vocabulary mismatch: "Activate" used in a tooltip, but the conceptual model commits to "Apply". Reword.

Masked objects: the same card component is used for a Dashboard preview and a Block preview. Distinct treatment needed.

Broken relationship: the Role detail page doesn't show the Folders the role grants access to without a click. The conceptual relationship should be visible without expansion.

Empty-state copy for "no roles assigned" reads as failure ("No one"). Reframe to neutral and actionable.

Open decisions

Confirmation pattern for irreversible destructive actions (currently inconsistent: dialog in some places, inline in others).

Whether to expose the full Capability list at role creation as "all on" or "all off" by default.

`## Surface decision inventory | Surface decision | Inherits from | Status | |---|---|---| | Primary verb wording | Conceptual model — "Apply" for views | Committed | | Empty state copy: "No views" | User needs — needs context, not just absence | Drafted | | Loading state per block | Interaction flow — async data | Drafted | | Touch target size on filter chips | Accessibility AA | Open | | Tone in destructive confirmations | Brand — neutral, no shaming | Committed | ## Audit findings against lower layers - **Vocabulary mismatch:** "Activate" used in a tooltip, but the conceptual model commits to "Apply". Reword. - **Masked objects:** the same card component is used for a Dashboard preview and a Block preview. Distinct treatment needed. - **Broken relationship:** the Role detail page doesn't show the Folders the role grants access to without a click. The conceptual relationship should be visible without expansion. - **Empty-state copy** for "no roles assigned" reads as failure ("No one"). Reframe to neutral and actionable. ## Open decisions - Confirmation pattern for irreversible destructive actions (currently inconsistent: dialog in some places, inline in others). - Whether to expose the full Capability list at role creation as "all on" or "all off" by default.`

Zone
Solution space

Deliberate decisions about what to build.

Position
Layer 7 of 7

Source
[SKILL.md ↗](https://github.com/jamiemill/layers-skills/blob/main/skills/layers-surface/SKILL.md)

Run it
`/layers-surface`

In your AI tool, after installing the skills.
Install →

Install

Install the skills

 Install in Claude Code, Cursor, Codex & more

`npx skills add jamiemill/layers-skills`CopyCopied
 Install once with the skills package, then run any `/layers-*` skill in your AI tool.

[← Layer 6Interaction structure & flow](/skills/interaction-flow)

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
