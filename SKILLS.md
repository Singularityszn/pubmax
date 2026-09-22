# Pubmaxx skill index

Use this index to choose a playbook for the current task. The
[build methodology](docs/agents/build-methodology.md) owns isolation, evidence,
review and shipping. Root and nearest area `AGENTS.md` files own product rules.

## Finding skills

Use an enabled entry in Codex's `$` picker when available. Project skills live
under `.agents/skills/<name>/SKILL.md`; read that file before applying a
project skill. Which global skills appear in the picker depends on local
Codex profile settings, which are not stored in this repository. Keep tracked
skill sources intact for other harnesses even when a profile hides duplicates.

| Work | Skills |
| --- | --- |
| Reproduce a defect | `diagnosing-bugs`, `reproduce-and-fix-issues` |
| Define ownership and types | `domain-modeling`, `codebase-design`, `typescript-best-practices`, `typed-service-contracts` |
| Implement and prove behaviour | `tdd`, `test-unit`, `test-playwright`, `test-qa` |
| React and Next.js | `react-best-practices`, `debug-fe-be-integration`; shared `vercel-react-best-practices` |
| MapLibre | `maplibre-source-wiring`, `maplibre-tile-sources`, `maplibre-terrain-rendering`; restored project skills `maplibre-cartography`, `maplibre-fonts-glyphs`, `maplibre-pmtiles-patterns` |
| Supabase and persistence | `backend-db-performance`, `plan-rls-audit`; shared `supabase`, `supabase-postgres-best-practices` |
| Capacitor | `debugging-capacitor`, `plan-capacitor-hardening`, `mobile-emulator-test` |
| Product design | `design-system`, `enhance-web-ui`, `enhance-web-ux`; shared `frontend-design`, `web-design-guidelines`; follow project design and voice docs |
| Browser QA | `test-playwright`, `test-qa`; `playwright-cli` after restoring project skills |
| Review and ship | `code-review`, `no-mistakes`, `new-branch-and-pr`; follow the build methodology |
| Research current practices | `last30days`; verify technical claims against first-party sources |
| AI judgments | `typesafe-ai` after restoring project skills, `typed-service-contracts`, `plan-llm-cost-guardrails` |
| Documentation | `technical-writing`, `unslop` |

TypeSafe supports AI routing, ranking, extraction and verification. Keep exact
rules and execution in code. Typed answers do not prove truth: prices, hours
and heritage still need project evidence and fail-closed behaviour. Keep
credentials server-side and validate uncertain judgments on representative
cases before they affect product behaviour.

## Restoring project installs

`skills-lock.json` records source and content hashes for project installs made
with the Skills CLI. In a clean checkout, restore those entries with
`npx -y skills experimental_install`. The CLI currently labels this restore
command experimental. It installs only the lock entries into `.agents/skills/`;
tracked project skills remain in the checkout. Review the output and resulting
tree before relying on restored skills.

Use the upstream installer to add or update a skill, then commit the generated
lock change. Do not hand-edit the lock. Older vendored skills may have no lock
entry; compare them with upstream before updating and preserve local changes.
Keep one shared owner for identical global copies. Do not prune by name alone.
Preserve custom skills and harness-specific variants, and verify expected names
after any discovery change.
