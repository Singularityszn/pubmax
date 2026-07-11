Interaction structure & flow — Layers

[Layers](/)[Skills](/skills)[About](/about)Install

[← All skills](/skills)

 Layer 6 · Solution space

Interaction structure & flow

`/layers-interaction-flow`

Map interaction structure and flow — places, affordances, edge cases, and failure paths — without committing to visual form.

Example prompts

Drop one of these into your AI tool. The skill takes it from there.

Run `/layers-interaction-flow` for the checkout — including all the edge cases I'm probably missing.

Help me design the search → result → detail path with `/layers-interaction-flow`.

Use `/layers-interaction-flow` to map this flow as a breadboard before I touch any pixels.

The skill itself

What `/layers-interaction-flow` tells the AI to do

 Below is the actual skill — the instructions your AI tool follows when you run it. Reading it is optional; the skill loads itself.

/layers-interaction-flow

Assumes `/layers-intro` has been loaded. This skill is a library of techniques, not a script — see “How to use these skills” there.

The interaction structure and flow layer defines how a person interacts with the product: the places they navigate, the affordances available, the content presented, and the flow between states. It sits above the conceptual model (which defines what exists) and below the surface (which defines how it looks).

A breadboard is always for a particular user in a particular situation doing a particular job. Know which job story before you start.

The decisions this layer makes

The distinct places this flow moves through

What the user can do in each place, and where each action leads

What content each place needs to show

What happens on failure paths, empty states, and edge cases

Whether the flow is as simple as it can be while still serving the job

If the conceptual model beneath isn’t stable, flows built on it often need redoing — check that first.

Disciplines — what keeps a flow honest

Every affordance has a named destination. “Submit → where?” If you can’t name it, it’s an unmade decision.

Edges are required steps, not afterthoughts. Breadboard the failure paths (validation, server error, disconnection, timeout, concurrent edit), the empty and loading states, the post-action state, and the cancel path. Each gap is an unmade design decision — name it.

No broken objects. For each conceptual-model object in this flow, its attributes and actions should be available together — not scattered across screens with no cross-linking.

No isolated objects. Each model relationship should be visible and navigable in the flow, or there should be a deliberate decision that it needn’t be.

Vocabulary matches the model’s ubiquitous language.

Naming places is a design decision — descriptive and user-meaningful (“Referral dashboard”, not “Page 3”).

Keep it minimal. More than 5–6 places for a single job story is a signal to look for what can be collapsed.

Breadboard notation
`Place name- affordance → destination place- affordance → destination place[ content shown in this place ]`
Techniques

Breadboarding is the default; the rest serve particular situations.

TechniqueUse it when
Breadboarding (Ryan Singer / Shape Up)Default. Text notation that forces interaction logic to be settled before visual design makes changes expensive.
Walk the flow as the userNarrate: “I’m a user who [situation]. I arrive at [place], I see [content], I want to [motivation], so I [affordance]…” Walk the happy path, then every edge. The fastest way to find unmade decisions.
User story mapping (Jeff Patton)Complex product, many user types, incremental planning. Activities → tasks → stories across a timeline.
Task analysisRedesigning an existing flow — decompose the current task to find where friction, errors, and workarounds concentrate.
Service blueprintingFlow spans channels or involves backstage operations (staff, systems, third parties).
Critical User JourneysDeciding which flow to work on — the minimal path to core value (high-traffic, high-revenue, metric-critical).
Flow diagram (`graph LR`)Orientation only — flow through time reads left to right. The text breadboard stays the primary artefact; the diagram loses conditional detail.
Working with the designer

Settle which job story the flow serves, where the user starts, and what success looks like. If redesigning, describe the current flow first — it reveals decisions already made, many of them unintentionally. Then name the places, map affordances and destinations, and walk the flow including its edges, applying the disciplines above. Conditions — when an affordance is or isn’t available — are often where the real decisions hide.

Offer the technique that fits: breadboarding for most flows, task analysis for a redesign, story mapping when there’s a lot to plan. Do the next useful thing, not all of them.

Capture only the residue: the breadboard (places, affordances, destinations, content, key conditional states), a flow diagram if it aids orientation, the open decisions (gaps and unresolved edge cases), and risks that depend on unsettled lower-layer decisions.

A breadboard defines interaction logic without committing to visual form. Before moving to surface, make sure the conceptual model beneath is stable.
 Show full skill ↓

Example output

An example of what `/layers-interaction-flow` captures

From a roles & permissions redesign.

PreviewMarkdown

Flow 1 — Admin creates a custom Role and assigns content permissions

Job story: When I'm configuring access for a new team member, I want to create a Role with the right folder and view access, so they can see what they need now and in the future without me having to maintain it.
`Settings / Roles [ List: name, type (Built-in / Custom), user count ] [ Empty state: "No custom roles yet" ] - [Role name] → Role - Create Role → Create Role (modal) --- Role [ Role name ] [ Content Access ] [ Folder permissions: folder name, access level (view / edit), Revoke ] [ Empty state: "No content access — users can't see any dashboards" ] [ View Access ] [ Capabilities ] [ Assigned Users ] - Grant folder access → Content access picker - Toggle Capability → inline, same place - Assign User → User search (inline panel) - Delete Role → Delete Role (confirmation) - ← Settings / Roles`
Flow diagram
graph LR Roles["Settings / Roles"] -->|Create Role| CreateModal["Create Role"] Roles -->|Open role| RoleDetail["Role"] CreateModal -->|Save| RoleDetail RoleDetail -->|Grant folder access| ContentPicker["Content access picker"] ContentPicker -->|Confirm| RoleDetail RoleDetail -->|Delete| DeleteConfirm["Delete Role"] DeleteConfirm -->|Confirm| Roles
`## Flow 1 — Admin creates a custom Role and assigns content permissions **Job story:** When I'm configuring access for a new team member, I want to create a Role with the right folder and view access, so they can see what they need now and in the future without me having to maintain it. ``` Settings / Roles [ List: name, type (Built-in / Custom), user count ] [ Empty state: "No custom roles yet" ] - [Role name] → Role - Create Role → Create Role (modal) --- Role [ Role name ] [ Content Access ] [ Folder permissions: folder name, access level (view / edit), Revoke ] [ Empty state: "No content access — users can't see any dashboards" ] [ View Access ] [ Capabilities ] [ Assigned Users ] - Grant folder access → Content access picker - Toggle Capability → inline, same place - Assign User → User search (inline panel) - Delete Role → Delete Role (confirmation) - ← Settings / Roles ``` ## Flow diagram ```mermaid graph LR Roles["Settings / Roles"] -->|Create Role| CreateModal["Create Role"] Roles -->|Open role| RoleDetail["Role"] CreateModal -->|Save| RoleDetail RoleDetail -->|Grant folder access| ContentPicker["Content access picker"] ContentPicker -->|Confirm| RoleDetail RoleDetail -->|Delete| DeleteConfirm["Delete Role"] DeleteConfirm -->|Confirm| Roles ````

Zone
Solution space

Deliberate decisions about what to build.

Position
Layer 6 of 7

Source
[SKILL.md ↗](https://github.com/jamiemill/layers-skills/blob/main/skills/layers-interaction-flow/SKILL.md)

Run it
`/layers-interaction-flow`

In your AI tool, after installing the skills.
Install →

Install

Install the skills

 Install in Claude Code, Cursor, Codex & more

`npx skills add jamiemill/layers-skills`CopyCopied
 Install once with the skills package, then run any `/layers-*` skill in your AI tool.

[← Layer 5Conceptual model](/skills/conceptual-model)
[Layer 7 →Surface](/skills/surface)

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
