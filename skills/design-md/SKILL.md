---
name: design-md
description: Use the DESIGN.md format (google-labs-code/design.md) to give coding agents a persistent, structured visual identity / design system. Use when creating or updating DESIGN.md, aligning UI to a design system for agents, or when the user mentions design.md / visual identity for agents.
---

# DESIGN.md

Upstream: https://github.com/google-labs-code/design.md

DESIGN.md is a format specification for describing a visual identity to coding agents. It gives agents a persistent, structured understanding of a design system.

## When to use

- Creating or updating a `DESIGN.md` for this repo or a surface
- Teaching an agent the brand / visual system before UI work
- Reviewing whether UI changes match a written design identity

## Instructions

1. Read the upstream README and philosophy: https://github.com/google-labs-code/design.md
2. Prefer a single project `DESIGN.md` (or linked package docs) over scattered vibe notes.
3. Keep tokens, type, color, motion, and component rules concrete enough an agent can execute without guessing.
4. Related installed skills from the same repo: `typed-service-contracts`, `tdd-red-green-refactor`, `ink`, `agent-dx-cli-scale`.
5. For pixel craft after the identity is set, hand off to `better-ui`, `make-interfaces-feel-better`, or Taste / Impeccable skills.

## Do not

- Invent a parallel design-token dialect when DESIGN.md already covers it
- Confuse DESIGN.md (identity for agents) with a one-off mockup screenshot
