# Layers of Product Design — Skills Toolkit

A set of AI skills that guide product designers through the **Layers of Product Design** framework — a structured way to think about design work across seven layers, from observed user behaviour through to surface decisions.

Each skill facilitates work at one layer: explaining the layer's nature, naming the decisions that need to be made, and optionally running a structured working session using proven methods.

## How it works

Load `/layers-intro` at the start of any session. It provides the framework context all other skills depend on. Then either run `/layers-orient` to find out where to focus, or jump directly to the layer you're working at.

---

## Start here

| Skill | What it does |
|---|---|
| [`/layers-intro`](skills/layers-intro/SKILL.md) | Framework orientation — load this first |
| [`/layers-orient`](skills/layers-orient/SKILL.md) | Diagnostic audit across all seven layers; identifies where to focus |

---

## Problem space

Work in the problem space builds understanding of users and their context, independently of any solution.

| Layer | Skill | What it produces |
|---|---|---|
| 1 · Observed behaviour | [`/layers-observed-behaviour`](skills/layers-observed-behaviour/SKILL.md) | Candidate job stories with confidence ratings |
| 2 · The domain | [`/layers-domain`](skills/layers-domain/SKILL.md) | Concept map, terminology conflicts, noun harvest |
| 3 · User needs | [`/layers-user-needs`](skills/layers-user-needs/SKILL.md) | Prioritised job stories (needs, pains, desires) |

---

## Solution space

Work in the solution space converts problem space understanding into deliberate decisions about what to build and how.

| Layer | Skill | What it produces |
|---|---|---|
| 4 · Product & service strategy | [`/layers-product-strategy`](skills/layers-product-strategy/SKILL.md) | Opportunity Solution Tree with prioritised bets |
| 5 · Conceptual model | [`/layers-conceptual-model`](skills/layers-conceptual-model/SKILL.md) | Object map, state diagrams, ubiquitous language |
| 6 · Interaction structure and flow | [`/layers-interaction-flow`](skills/layers-interaction-flow/SKILL.md) | Breadboard with edge cases and open decisions |
| 7 · Surface | [`/layers-surface`](skills/layers-surface/SKILL.md) | Audit findings and surface decision inventory |

---

## The framework in brief

Layers have *logical dependency* — lower layers are foundations for upper ones. Weak lower layers create UX debt that propagates upward. This is not a linear process: you can enter at any layer, but it's always worth checking whether the foundations below are sound.

**Reality** → **Problem space** (observed behaviour → domain → user needs) → **Solution space** (strategy → conceptual model → interaction structure → surface) → **Reality**

The most neglected layer is almost always the conceptual model: the objects, relationships, states, and vocabulary the product works with. If you're unsure where to start, run `/layers-orient`.

---

## License

MIT — see [LICENSE](LICENSE). Fork it, adapt it, ship it. Attribution is appreciated but not required.
