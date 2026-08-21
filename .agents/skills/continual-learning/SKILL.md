---
name: continual-learning
description: Mine current-workspace transcripts and propose evidence-backed AGENTS.md updates with user approval.
disable-model-invocation: true
---

# Continual Learning

Keep `AGENTS.md` current from durable lessons in this workspace.

## Trigger

Use when the user asks to mine prior chats, maintain `AGENTS.md`, or run the continual-learning loop.

## Workflow

1. Locate transcripts only for current workspace. Do not search other projects.
2. Find repeated engineering lessons or explicit user corrections. Skip one-off details.
3. Check each lesson against current `AGENTS.md` and its source-of-truth path.
4. Show proposed edits, evidence, and affected scope to user.
5. Wait for explicit approval.
6. Apply approved edits to source of truth, then update required mirrors.
7. Run repository writing and instruction checks.

## Guardrails

- Never read transcripts outside current workspace.
- Never copy secrets, personal data, or raw transcript text into instructions.
- Require evidence from two sessions unless user explicitly corrected a rule.
- Do not edit instructions before user approves exact proposal.
