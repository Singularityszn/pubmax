Conceptual model — Layers

[Layers](/)[Skills](/skills)[About](/about)Install

[← All skills](/skills)

 Layer 5 · Solution space

Conceptual model

`/layers-conceptual-model`

Define the product’s objects, relationships, states, and vocabulary independently of any interface — the most load-bearing layer.

Example prompts

Drop one of these into your AI tool. The skill takes it from there.

Help me define the `/layers-conceptual-model` for this scheduling tool — shifts, slots, and bookings keep blurring together.

Run `/layers-conceptual-model` on this product. I want one committed object set and vocabulary before any screens get drawn.

Walk me through `/layers-conceptual-model` for this domain. Naming is contested and I want to commit to one model.

The skill itself

What `/layers-conceptual-model` tells the AI to do

 Below is the actual skill — the instructions your AI tool follows when you run it. Reading it is optional; the skill loads itself.

/layers-conceptual-model

Assumes `/layers-intro` has been loaded. This skill is a library of techniques, not a script — see “How to use these skills” there.

The conceptual model is the most neglected load-bearing layer. It defines the objects the product recognises, how they relate, what states they can be in, and the vocabulary for all of it — a deliberate decision about how the product models its domain, independent of any interface.

It is not the users’ messy mental model (that’s the domain layer), and not a database schema, wireframe, or flow. But the gap between this model and what engineers build matters: a large, unexamined gap is both UX debt (users meet a product that contradicts the model) and technical debt (the system is hard to evolve).

The decisions this layer makes

What objects the product recognises, and where each object’s boundary is

How those objects relate — cardinality, and named roles where an object plays several

What a user can do to or with each object

What states an object can be in, and which transitions matter

The product’s vocabulary — one name per concept, one concept per name

If none of these is genuinely open, you may not need this layer right now. Say so rather than working it for the sake of it.

Disciplines — what keeps the model honest

Apply these to whatever you produce, in any order. They are the high-value part of this layer.

Real objects only. A true object is instanceable (you can have many), structured (has its own attributes), and useful (the user cares about it in its own right). This catches two errors: an attribute promoted to an object, and — more often — instances mistaken for objects: “CAC” and “ROAS” aren’t objects, they’re instances of one object, Metric. When several nouns are of-a-kind, model the type as the object; the specific names are instances or values.

Attributes that are really relationships. If an attribute is just the name or ID of another object in the model, model it as a relationship — don’t duplicate it.

Name the role when an object plays several. “belongs to one User (as referrer)”, not “belongs to one User.”

No speculative additions. Every object, attribute, action, and relationship should trace to a stated user need. Scope creep here propagates through every layer above. (Tracing to strategy vocabulary doesn’t count — strategy words aren’t yet objects.)

Can-be-an-object ≠ should-be-first-class. The “real objects only” test tells you something can be an object — not that the product should commit to it as a first-class, persistent, stateful entity. That elevation is a design bet with a cost. Justify it by concrete use: what flow or job forces this thing to persist, hold state, and be returned to? If nothing does, it’s transient, or it’s premature. And when an object exists only because of an unvalidated strategy bet, mark it provisional — model it as a hypothesis, don’t “lock” it, and don’t build the layer above on it until the bet is tested.

Verb precision. Does a generic verb (Edit, Delete, Update) hide operations with different real-world consequences? “Edit address” conflates correcting a typo (overwrite is fine) with recording a house move (which should preserve history). When a generic verb could mean genuinely different things, name the operations separately — “Correct address” vs “Register change of address” isn’t verbose, it’s precise.

Implementation is not design. When talk drifts to how something is stored, generated, or computed, redirect to what the user can do and what happens to things that referenced it. Flag genuinely entangled questions for an engineering conversation rather than forcing a premature answer.

Techniques

Pick the one that fits the live decision — don’t run them all.

TechniqueUse it to
Noun foraging + OOUX (Sophia Prater)Extract objects from research or domain notes. The default when you have naturalistic language to mine. Sort nouns into objects / attributes / instances-or-values / set-aside (UI elements, vague abstractions, actions dressed as nouns), using the “real objects only” test above.
Object definitionPin down one object: what it is (one sentence, the user’s view), its attributes, its relationships (cardinality + role names), and its actions.
Sketch the flow first (push forward, pull back)Objecthood is uncertain — whether something should be a persistent object depends on how it’s used. Breadboard the flow (`/layers-interaction-flow`) to see what must persist, hold state, or be returned to, then come back and formalise only those. Often the fastest way to tell a real object from a transient one.
Relational object map (`erDiagram`)See objects and relationships together and catch missing, reversed, or spurious connections. `||`=exactly one, `o{`=zero-or-many, `|{`=one-or-many; crow’s foot on the many side; labels read first entity → second.
State transition diagram (`stateDiagram-v2`)For an object whose status changes what users can do — name the states, the transitions, and what each state forbids.
Action (CTA) inventoryList every action a user can take, across all objects, in one place — the product’s call-to-action vocabulary. Listing them together (not object by object) is what exposes inconsistency (Add vs Create vs New for one operation) and over-flattening (one verb hiding distinct operations).
Ubiquitous language listResolve naming. For each contested concept: the chosen term, rejected alternatives, and why. One name per concept, one concept per name — in UI, help text, API names, and internal talk alike.
Semantic IxD / action grammar (Rosenberg)Audit verb consistency and precision across many actions and objects.
Event storming — commands/policies (Brandolini)Process-heavy domain: start from what happens, work back to the objects involved.
Card sortingVocabulary is unclear or contested across users or teams.
Walking the existing productRedesign: the current UI reveals the implicit model — compare it to how users actually think.
Also probe the temporal decisions from `/layers-intro` — intermediate action states, read-model lag, relationship temporality, deletion semantics, history — for any object where they bite.

Working with the designer

Find which of the decisions above are live. Offer the technique that fits: noun foraging if there’s material to mine, walking the product if redesigning, or straight to object definition if the objects are known and only their shape is open. Do the next useful thing, not the whole toolkit.

Capture only the residue — the object definitions that got settled (and which are still provisional, pending a bet or a flow), any diagram that encodes a real relationship or lifecycle, the vocabulary calls, and the open questions (objects that felt thin, decisions deferred to engineering). Don’t write a report the designer won’t reread.

If domain work hasn’t been done, say plainly: this model is a hypothesis until there’s evidence.

When the objects and actions are stable, the natural next move is to design how users move through them — `/layers-interaction-flow`.
 Show full skill ↓

Example output

An example of what `/layers-conceptual-model` captures

From a roles & permissions redesign.

PreviewMarkdown

Object map
erDiagram WORKSPACE ||--o{ FOLDER : contains WORKSPACE ||--o{ VIEWCOLLECTION : contains WORKSPACE ||--o{ ROLE : defines WORKSPACE ||--o{ USER : has FOLDER ||--o{ DASHBOARD : contains DASHBOARD ||--o{ BLOCK : contains VIEWCOLLECTION ||--o{ VIEW : contains ROLE ||--o{ USER : "assigned to" ROLE }o--o{ FOLDER : "grants access (view | edit)" ROLE }o--o{ DASHBOARD : "specific override" ROLE }o--o{ CAPABILITY : "grants"
A Folder access permission covers all Dashboards within that Folder — including ones added later. No manual role updates needed when new Dashboards are created.

Ubiquitous language

TermRejected alternativesDecision
BlockReportReport stays code-internal only. Block everywhere: UI, help, API.
UserMember—
CapabilityFeatureMore precise for a permission context.
RolePermission setBuilt-in (read-only) or Custom (editable). Same object type, different mutability.
ApplyEnable, toggleUser activates a saved filter.
`## Object map ```mermaid erDiagram WORKSPACE ||--o{ FOLDER : contains WORKSPACE ||--o{ VIEWCOLLECTION : contains WORKSPACE ||--o{ ROLE : defines WORKSPACE ||--o{ USER : has FOLDER ||--o{ DASHBOARD : contains DASHBOARD ||--o{ BLOCK : contains VIEWCOLLECTION ||--o{ VIEW : contains ROLE ||--o{ USER : "assigned to" ROLE }o--o{ FOLDER : "grants access (view | edit)" ROLE }o--o{ DASHBOARD : "specific override" ROLE }o--o{ CAPABILITY : "grants" ``` A **Folder access permission** covers all Dashboards within that Folder — including ones added later. No manual role updates needed when new Dashboards are created. ## Ubiquitous language | Term | Rejected alternatives | Decision | |---|---|---| | **Block** | Report | Report stays code-internal only. Block everywhere: UI, help, API. | | **User** | Member | — | | **Capability** | Feature | More precise for a permission context. | | **Role** | Permission set | Built-in (read-only) or Custom (editable). Same object type, different mutability. | | **Apply** | Enable, toggle | User activates a saved filter. |`

Zone
Solution space

Deliberate decisions about what to build.

Position
Layer 5 of 7

Source
[SKILL.md ↗](https://github.com/jamiemill/layers-skills/blob/main/skills/layers-conceptual-model/SKILL.md)

Run it
`/layers-conceptual-model`

In your AI tool, after installing the skills.
Install →

Install

Install the skills

 Install in Claude Code, Cursor, Codex & more

`npx skills add jamiemill/layers-skills`CopyCopied
 Install once with the skills package, then run any `/layers-*` skill in your AI tool.

[← Layer 4Product & service strategy](/skills/product-strategy)
[Layer 6 →Interaction structure & flow](/skills/interaction-flow)

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
