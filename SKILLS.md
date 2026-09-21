# Pubmaxx skill index

Use this index to select a playbook for the work in front of you. The
[build methodology](docs/agents/build-methodology.md) owns isolation, evidence,
review and shipping. Root and nearest area AGENTS.md own the product rules.

## Resolve the skill

Read the project copy under `.agents/skills/<name>/SKILL.md` when present.
Otherwise use the shared installation under `~/.agents/skills/` or the active
harness catalog. Read the actual file before applying it. Resolve symlinks before
updates, and preserve project customisations. A plugin's similarly named skill
may have different instructions.

## Select a playbook

| Work | Skills |
| --- | --- |
| Reproduce a defect | `diagnosing-bugs`, `reproduce-and-fix-issues` |
| Define ownership and types | `domain-modeling`, `codebase-design`, `typescript-best-practices`, `typed-service-contracts` |
| Implement and prove behaviour | `tdd`, `test-unit`, `test-playwright`, `test-qa` |
| React and Next.js | `react-best-practices`, `debug-fe-be-integration`; shared `vercel-react-best-practices` |
| MapLibre | `maplibre-source-wiring`, `maplibre-tile-sources`, `maplibre-terrain-rendering`, `maplibre-pmtiles-patterns`, `maplibre-cartography`, `maplibre-fonts-glyphs` |
| Supabase and persistence | `backend-db-performance`, `plan-rls-audit`; shared `supabase`, `supabase-postgres-best-practices` |
| Capacitor | `debugging-capacitor`, `plan-capacitor-hardening`, `mobile-emulator-test` |
| Product design | `design-system`, `enhance-web-ui`, `enhance-web-ux`; shared `frontend-design`, `web-design-guidelines`; follow the project design and voice docs |
| Browser QA | `test-playwright`, `test-qa`, `playwright-cli`; shared `agent-browser` |
| Review and ship | `code-review`, `no-mistakes`, `new-branch-and-pr`; follow the build methodology's review loop |
| Research current practices | `last30days`; report source failures and verify technical claims against first-party docs |
| AI judgments | `typesafe-ai`, `typed-service-contracts`, `plan-llm-cost-guardrails` |
| Documentation | `technical-writing`, `unslop` |

TypeSafe is installed from `typesafe-ai/skills` for Codex. Use its live docs when
designing AI routing, ranking, extraction or verification. Keep exact rules and
execution in code. Typed answers do not prove truth: prices, hours and heritage
still require the evidence and fail-closed behaviour defined by the project.
Keep credentials server-side and validate uncertain judgments on representative
cases before they affect product behaviour.

## Maintain installations

Use the original package manager or upstream installer. The skills CLI records
new project installs in its generated `skills-lock.json`; do not hand-edit it.
Older vendored skills may have no lock entry. Compare them with their upstream
source before updating, and preserve local changes.

Keep one shared owner for identical global copies. Quarantine redundant copies
outside every skill-discovery root, recording their old path, restore path and
reason. Do not prune by name alone. Preserve custom skills and harness-specific
variants. Verify discovery and references after cleanup, including the expected
skill names; an empty error list alone does not prove complete loading.
