Changelog | ImpeccableSkip to content
[Impeccable](/)
[Home](/)[Designing](/designing)[Docs](/docs)[Slop](/slop)[Live](/live-mode)[40k](https://github.com/pbakaus/impeccable)

Release notes

Changelog

What shipped, when, and why. Newest at the top, back through the v3.0 launch.

SkillCLIExtensionAll

v3.9.1July 1, 2026Current
A packaging fix so the design hook loads in Codex.

Codex loads the plugin design hook again. The plugin-packaged hook manifest carried a top-level `description` field that Codex's strict hook parser rejected, so the post-edit design check failed to register. That field is gone from the plugin artifact, and the hook now loads cleanly on Codex while staying identical for Claude Code.

v3.9.0July 1, 2026
A new anti-slop rule for Codex-style grid backgrounds, a bolder pass that respects your design system, and critique that stays independent across more harnesses.

Decorative grid backgrounds are now a named tell. Impeccable refuses the two-axis CSS grid overlay built from hairline gradient lines and a repeating `background-size`, the pattern Codex reaches for on almost any empty surface. Actual canvases, maps, blueprints, and measurement tools still get their grid; everything else gets real product structure or a plain surface.

`/impeccable bolder` stays inside your design system. When a project has a `DESIGN.md`, tokens, or established component styles, a bolder pass now makes the existing language more decisive through hierarchy, proportion, density, and copy instead of inventing new colors, gradients, or effects. If the system genuinely cannot express the direction, it names the exact additions and asks before expanding.

Critique holds its independence on more harnesses. On harnesses other than Claude and Codex, the critique pass now runs in its own sub-agent more often, so the review reads the design with fresh eyes instead of inheriting the editing context that produced it.

Bundled helpers run under strict-permission harnesses. The skill's bundled Node helpers now execute on harnesses that lock permissions down, so setup and detection work without extra approval prompts.

Codex hook manifest fixed. Corrected the Codex hook manifest schema so the post-edit design check registers cleanly.

v3.8.0June 22, 2026
Impeccable reaches across more of your workflow: the design hook now runs in GitHub Copilot, and project context understands monorepos.

Design hooks for GitHub Copilot. Installing the skill adds a `.github/hooks/impeccable.json` hook that runs the detector after Copilot edits a UI file and feeds the findings back as a focused design reminder. It covers both the Copilot CLI and the cloud agent, and recognizes every edit path Copilot uses, including `apply_patch`.

Monorepo-aware context. Open the repo root and Impeccable resolves `PRODUCT.md` and `DESIGN.md` per app: each child app uses its own context files and falls back to the root files for anything it does not define. `/impeccable live` detects multiple apps, asks which one to work on, and then runs and stores live state inside that app.

v3.7.1June 16, 2026
A packaging fix so the bundled detector runs everywhere.

`/impeccable critique` works again. The bundled detector was missing a config module it needed and crashed on startup. The build now ships that file with the skill, so critique and other detector-backed commands run cleanly.

v3.7.0June 16, 2026
Impeccable now carries project design context into hooks, the detector, and docs. The agent can compare edits against your actual typography, color, and radius system instead of only using global anti-pattern rules.

Design-aware hook detections. When a project has `DESIGN.md`, hooks and `impeccable detect` load the local design system and flag font, color, and radius drift against the documented palette, typography stacks, rounded scale, and sidecar tonal ramps.

Ignores now work across hooks and the CLI. Detector exceptions moved into shared config, and `impeccable ignores` can list, add, and remove rule, file, and value ignores without hand-editing JSON.

Docs cover the full project context path. New reference pages explain hooks, the detector, configuration, and Design Context, including how `PRODUCT.md`, `DESIGN.md`, and `.impeccable/design.json` are loaded and kept current.

Docs code blocks now use the Impeccable palette. Shiki syntax highlighting uses design-system colors in both light and dark mode, with contrast tests so examples stay readable and do not trigger design-system color drift.

v3.6.0June 14, 2026
Impeccable now helps while the agent is editing, and the core skill is leaner: ablation-tested guidance, project hooks, sharper detector signal, and Live Mode support for Svelte and manual browser edits.

Ablation-tested skill core. The main skill got leaner after rule-level evals across three providers and four niches. Redundant typography and copy guidance moved out of the always-on prompt, rules with no measurable lift were cut, and examples that primed models to repeat the exact pattern being banned were rewritten. The result is a smaller prompt that spends attention on guidance proven to move design output.

Design hooks for real editing sessions.`/impeccable hooks` wires the detector into Claude, Codex, and Cursor projects. Claude and Codex get focused design reminders after UI file edits, Cursor can review proposed writes before they land, and `/impeccable hooks on` handles manifest setup, repair, and consent for you.

Findings stay reviewable. Hook runs distinguish new findings, already-seen findings, and clean scans, so the agent gets useful pressure without repeated walls of output. Confirmed exceptions can be saved through `ignore-value`, `ignore-file`, and `ignore-rule` in `.impeccable` config files instead of source comments.

The detector now tracks visible design problems more closely. The 41-rule engine skips hidden elements and screen-reader-only text, understands OKLCH alpha and Sass-like inputs, reports exact motion tokens for bounce or elastic easing, and tightens repeated kickers, oversized H1s, clipped overflow, transparent border/shadow, numbered marker, and cramped-padding checks.

Svelte-native Live Mode. Svelte and SvelteKit variants preview as temporary framework components with params stored in `params.json`, then accept back into the selected source component. Stateful pages stay closer to their real shape and avoid the HMR resets caused by string-injected previews.

Live Mode accepts more real-world edits cleanly. Manual text edits now have dedicated evidence, apply, and discard routes. Insertions preserve their anchors, accepted variants clean up mapped lists and JSX slots more reliably, and SvelteKit projects get a framework-aware live adapter that leaves `src/app.html` alone.

v3.5.0May 28, 2026
The biggest release yet. Per-provider rules that lift GPT-5.5 and Codex most, a skill that adapts to new versus existing projects, and Live Mode in Beta.

Before
AfterGPT-5.5, same luxury-hotel brief. Without Impeccable: the cream AI background, an abstract vector hero, and a headline that overflows its column. With Impeccable: real photography, an editorial layout, and copy with a human voice.

74%of GPT-5.5 pages used the cream / beige AI-default background
76%reached for extreme negative letter-spacing on tech briefs
90%+shipped body text below the WCAG contrast floor
Measured across ~190 samples, skill off. Each rate traced to a line in the skill, then fixed.

Dramatically better in GPT and Codex. Impeccable now compiles harness-specific rules into the skill at build time. Codex and GPT-5.5 get rules written for the exact defects they produce, that no other harness ever sees. No other design skill does this; everyone else ships one generic file to every model.

Far less AI-default slop. Bias mining against ~190 samples found the skill's own lines were causing defects, and cut them. The cream / beige background tell (74% on GPT) is banned across the warm-neutral band. Category-to-aesthetic recipes that drove extreme letter-spacing and italic-serif heroes are gone: the shape depends on the brand, not its category. New bans cover all-caps eyebrows, numbered section markers, more than three fonts, and a hard contrast floor.

It treats a new project differently from an existing one. On an existing codebase the skill reads your tokens, theme, and components first and works within them: preserving your identity wins over imposing a fresh look. On a blank slate it draws a single seed color from 129 hand-curated anchors, each carrying a mood and a composition strategy, then builds the full palette around it by hand. One seed becomes a dark jazz club or a light hospitality brand depending on the brief. Either way it ends the cold-start drift toward the same safe palette every time.

Live Mode is Beta. Out of alpha, and it now works at two scales. Type a direction into the new Steer bar, or speak it, and the agent reads the whole page and edits it in place, no element selected and no variant cycling. Or pick a single element, steer it in plain language, and accept the variant straight back to source. You can also edit copy in place: change an element's text right in the browser, and on Apply a subagent rewrites the real source it renders from and repairs anything wired to it, like card labels that double as image keys. Insert mode scaffolds brand-new elements between the ones already there. Recovery survives HMR, hidden heroes, and dev-tool overlays, and an experimental streaming poll mode cuts pickup from seconds to sub-second.

`/impeccable teach` is now `/impeccable init`. Renamed to match what it does: one command to set up a project. From a single codebase scan it writes PRODUCT.md, offers a DESIGN.md, configures Live Mode so it just works the first time you run it, then points you at the best command to start with. The old name still works as an alias.

A bare `/impeccable` recommends your next move. Run it with no command and, instead of a static menu, it reads the project, your dirty git tree, and your latest critique, then leads with the two or three highest-value commands and why (no DESIGN.md yet, run document; unresolved findings in the files you're editing, run polish). It always asks before running anything, and the full menu is still right below.

A faster detector with no jsdom. The HTML/CSS engine was rebuilt from the ground up on `htmlparser2` and a real CSS cascade resolver, replacing jsdom. On the same 160-file HTML corpus it runs about 20x faster under Node: 0.34s where the old jsdom engine took 6.8s, roughly 2 ms per file instead of 43 ms. Dependency-free and small enough to bundle straight into the skill and run inline, not just in the CLI and the extension.

Detector: 14 new rules.`cream-palette`, `em-dash-overuse`, `marketing-buzzword`, `numbered-section-markers`, `aphoristic-cadence`, `theater-slop-phrase`, `oversized-h1`, `extreme-negative-tracking`, `gpt-thin-border-wide-shadow`, `repeating-stripes-gradient`, `image-hover-transform`, `broken-image`, `text-overflow`, and `clipped-overflow-container`. 41 deterministic rules total, one canonical registry feeding the CLI, the browser extension, critique, and the evals.

The skill keeps itself current. On the first session of the day, Impeccable quietly checks whether a newer version shipped. If one has, it offers to run `npx impeccable update` for you. It always asks first, never nags about a version you declined, and never interrupts the task you're on. Set `IMPECCABLE_NO_UPDATE_CHECK=1` to turn it off.

Sharper craft under the hood. Beyond the bans, the craft itself got tighter. Small defaults landed where they pay off, like `text-wrap: balance` on headings, which cleaned up ragged hero type across the ablation runs. And the instructions themselves got leaner: orphan reference files folded into their commands, context loading simplified, and a new LLM-backed test suite that catches instruction-following regressions across three providers on every change. Plus dedicated [/changelog](/changelog) and [/faq](/faq) pages.

CLI v3.2.1July 9, 2026
A compatibility release for Node 22/23 that also ships the detector and installer fixes already waiting on main.

Node 22 and 23 install cleanly again. The CLI now declares `"node": ">=22.12.0"` and CI runs the main test/build lane on Node 22.12 and Node 24. The ZIP installer has used `fflate` since v3.0.2, so the old `extract-zip` stream bug no longer requires avoiding Node 22/23.

`npx` no longer falls back to stale 2.x on modern LTS Node. Because current releases are engine-compatible with Node 22.12+, `npx impeccable install` stays on the latest CLI instead of selecting an older Node-18-compatible release that does not understand the top-level `install` command.

Detector pre-scans can target typography or layout.`impeccable detect --scope type` and `--scope layout` narrow findings to the design domain a command is about to edit, and the new `design-system-font-size` rule flags literal sizes outside the `DESIGN.md` typography ramp. Brings the deterministic rule set to 46.

Google Fonts and detector ignores are sharper.`fonts.googleapis.com/css2` URLs with multiple families, axes, and encoded names now feed the overused-font and single-font checks correctly, and file-scoped wildcard ignores now suppress findings that do not carry a value, such as side tabs.

Pi global installs land in the right directory. User-scope installs, updates, and checks now use `~/.pi/agent/skills` while project installs continue to use `.pi/skills`, so Pi users get the same install/update behavior as the other harnesses.

CLI v3.2.0July 1, 2026
New rule: Codex grid-line backgrounds. The detector flags the two-axis grid overlay drawn from hairline gradients plus a repeating `background-size`. It is a provider tell, so it stays off until you pass `--gpt`, and it counts only hairline gradients inside the background so a stray `mask-image` line does not trip it. Brings the deterministic rule set to 45.

First install preserves an external skills symlink. Installing into a project whose `~/.claude/skills` points at an external directory no longer overwrites that symlink on the first install, so shared skill setups stay intact.

CLI v3.1.0June 22, 2026
Inline ignore comments. Waive a detector finding with an in-file comment that travels with the file, for exported or standalone documents where `.impeccable/config.json` is not present. `impeccable-disable <rule>` covers the whole file; `impeccable-disable-line` and `impeccable-disable-next-line` scope to one line. The marker works in any comment syntax, takes an optional reason, and is bypassed with `--no-inline-ignores`.

Clearer errors on unknown commands. An unrecognized subcommand now fails loudly with a usage hint instead of silently doing nothing.

CLI v3.0.3June 17, 2026
Existing installs now pick up script-only skill fixes.`impeccable update` compares the complete bundled skill tree instead of just `SKILL.md`, so fixes in bundled scripts are detected. Running `impeccable install` on an already-installed project also refreshes stale skill files instead of stopping at "already installed."

Codex installs report the skill version. The `.agents` and `.codex` builds now include the same `version` frontmatter as the other harnesses, so check/update output can show the installed skill version consistently.

CLI v3.0.2June 16, 2026
`impeccable detect` now understands your design system. When a project has `DESIGN.md`, CLI scans load the same context as hooks and flag font, color, and radius drift against documented typography, palette, rounded scale, and sidecar tonal ramps. Pass `--no-design-system` when you want the global detector only.

Ignore management is now a first-class CLI workflow.`impeccable ignores` can list, add, and remove rule, file, and value exceptions in the shared detector config, so teams no longer have to hand-edit `.impeccable/config.json`. Hooks and manual CLI scans honor the same exceptions.

Install no longer fails silently on newer Node. On Node v24.16.0 and v26.1.0+, `impeccable install` could print "Downloading impeccable skills...", exit 0, and write nothing. ZIP extraction now uses pure-JS `fflate`, avoiding the destroyed-stream stall behind [nodejs/node#63487](https://github.com/nodejs/node/issues/63487) while preserving the Windows install fix. Reported by [@kenryu42](https://github.com/kenryu42) in [#250](https://github.com/pbakaus/impeccable/issues/250).

CLI v3.0.1June 15, 2026
Exact motion findings.`bounce-easing` now reports the concrete animation token, Tailwind class, or overshooting cubic-bezier value instead of a generic `bounce` label. Intentional motion can be kept or ignored at the narrow value level.

Hook guidance favors design judgment. Project hook output now asks agents to classify each finding before editing: fix true design problems, leave intentional demos or domain-appropriate motion alone, and explain the decision.

CLI v3.0.0June 14, 2026
Breaking: Node 24 minimum. The CLI now declares `"node": ">=24"`. Upgrade Node before installing or running this version.

Shorter commands.`impeccable install`, `impeccable update`, `impeccable link`, and `impeccable check` are now the primary command shape. The old `impeccable skills ...` namespace still works for existing scripts.

Installer choices match your machine.`impeccable install` shows the harnesses it detects, defaults to that set, lets you customize providers through a searchable picker, and asks whether to install into the current project or globally. Project installs are the default unless real global skills already exist.

Hooks install with the skill when you opt in.`impeccable install` and `impeccable update` can prompt once for hook consent, persist the local answer, and install or repair the Claude, Codex, and Cursor hook manifests. Teams that only want the skill can still pass `--no-hooks`.

Local and submodule installs are safer.`impeccable link --source=.impeccable` supports repo-local development, symlink-safe updates avoid clobbering linked installs, provider aliases include Codex and Rovo Dev names, local bundle overrides are explicit, and ZIP extraction is safer on Windows.

Detector output is more precise. CLI scans pick up the same accuracy work as the skill hooks: hidden-element skips, sr-only text handling, tighter repeated kicker and oversized-H1 heuristics, OKLCH alpha, Sass-like CSS inputs, transparent-border handling, and page-level numbered-marker checks that stay out of implementation literals.

CLI v2.3.2May 29, 2026
The `i-` command prefix is gone. Opting into a prefix at install time was a holdover from when every command was its own skill. With a single `impeccable` skill it only ever renamed that one skill to `i-impeccable`, while the install message wrongly promised `/i-audit` style commands that never existed, and the rename could clobber unrelated third-party skills in the same harness folder. The flag and the prompt are removed.

Existing prefixed installs heal themselves.`skills install` and `skills update` now rename any old `i-impeccable` (or custom-prefixed) skill back to the canonical `impeccable`, scoped by name so a third-party skill that happens to start with `i-` is left untouched. Want a short top-level command? `/impeccable pin audit` still makes `/audit` a standalone shortcut.

CLI v2.3.1May 28, 2026
Codex agent delivery simplified. Codex auto-discovers subagents bundled inside an installed skill's own `agents/` folder, so `skills install` and `skills update` no longer write a separate `.codex/agents/*.toml` sidecar. The nested in-skill agent is the whole delivery now: one fewer file to install and heal, and nothing left behind in non-Codex projects.

`--fast` deprecated. Since the jsdom removal the full static scan runs at about 4 ms per file and covers every rule, so the regex-only `--fast` path only lost coverage (about 10 of 41 rules) for no real speed gain, and a `--fast` run could read "clean" because most rules silently never ran. The flag is still accepted so existing CI scripts keep working, but it is ignored with a one-line notice and the full scan always runs.

CLI v2.3.0May 28, 2026
Codex subagent delivery.`skills install` and `skills update` now write `.codex/agents/impeccable_asset_producer.toml` alongside the skill for Codex projects, detected from a `.agents` target or a global `~/.codex` install. Update heals the file when an older install left it out, and non-Codex projects stay untouched.

CLI v2.2.0May 28, 2026
Static engine, no jsdom. Detection was rebuilt on `htmlparser2` and a real CSS cascade resolver, replacing jsdom. About 20x faster on large HTML scans (a 160-file corpus drops from 6.8s to 0.34s under Node), dependency-free, and small enough to bundle, with no change to the rules themselves.

14 new detection rules.`cream-palette` (warm off-white "claude beige" backgrounds, including Tailwind warm-light utilities), `em-dash-overuse`, `marketing-buzzword`, `numbered-section-markers`, `aphoristic-cadence`, `theater-slop-phrase`, `oversized-h1`, `extreme-negative-tracking`, `gpt-thin-border-wide-shadow`, `repeating-stripes-gradient`, `image-hover-transform`, `broken-image`, `text-overflow`, and `clipped-overflow-container`. 41 deterministic rules total.

everything-centered removed. Dropped from the registry, the regex analyzer, and the layout checks: the rule caught too many legitimately centered layouts to earn its place.

One canonical registry. Eval-side detection logic folded back into the shared engine, so the CLI, the browser extension, the critique skill, and the evals all run the exact same checks.

Extension v1.2.1June 18, 2026
The toolbar badge count matches the popup and panel. The browser-action badge counted flagged elements while the popup and DevTools panel counted anti-pattern findings, so the same scan showed two numbers (for example 21 vs 34). One element can carry several findings; the badge now counts findings too, so every surface agrees. Reported in [#262](https://github.com/pbakaus/impeccable/issues/262).

Local file scans report why they fail. Scanning a `file://` page with file-URL access off used to leave the popup stuck on "Scanning…" forever. The popup now shows the real reason, with a permission hint for local files, and clears it on the next scan. Reported in [#258](https://github.com/pbakaus/impeccable/issues/258).

Popup matches the Kinpaku design system. The toolbar popup picks up the canonical carved-tile mark and light/dark theming that follows your system preference. Reported in [#260](https://github.com/pbakaus/impeccable/issues/260).

Extension v1.2.0June 14, 2026
Firefox support. The same detector, popup, DevTools panel, and per-rule toggles now ship as a Firefox add-on. The Firefox package declares what the extension already does: scans run in the page, and nothing leaves your machine.

The overlay matches the 41-rule engine. Browser scans pick up the latest detector improvements, including hidden-element skips, sr-only text-overflow handling, tighter repeated kicker, oversized-H1, clipped-overflow, OKLCH alpha, Sass-adjacent CSS parsing, transparent-border handling, and exact animation values for bounce or elastic motion.

DevTools opens reliably in packaged builds. Firefox panel and sidebar URLs are now root-relative, scan responses echo their scan IDs, and the icon set plus store metadata match the current detector.

Extension v1.1.0May 28, 2026
The new detection rules flag in the overlay. cream-palette, em-dash-overuse, marketing-buzzword, numbered-section-markers, aphoristic-cadence, theater-slop-phrase, oversized-h1, broken-image, text-overflow, and the rest now light up on any page you scan, same engine as the CLI.

Per-rule toggles in settings. Every rule, including the new ones, has an on/off switch grouped by AI tells and Quality. Toggle state syncs across your browsers and the scan honors it immediately.

v3.1.1May 14, 2026
`/impeccable critique` works on Windows. The CLI entry-point check in `critique-storage.mjs` compared `import.meta.url` against a hand-built `file://` string, which silently failed on Windows because Node returns forward slashes in `import.meta.url` but backslashes in `process.argv[1]`. The script exited 0 with no output and the snapshot save was skipped. Switched to `pathToFileURL`, the standard cross-platform pattern. Reported by [@Genmutant](https://github.com/Genmutant) in [#155](https://github.com/pbakaus/impeccable/issues/155).

v3.1.0May 13, 2026
Codex asset producer agent. A native Codex subagent that produces clean, reusable raster assets from approved Impeccable mock references without redesigning the direction. Preserves silhouette, palette, lighting, and material; strips baked-in UI text and presentation chrome that CSS should own. Codex-only because Codex is the harness with native image generation today.

Critique persistence. Each `/impeccable critique` run now writes a per-target snapshot to `.impeccable/critique/<timestamp>__<slug>.md` with score, P0/P1 counts, and full report. `/impeccable polish` reads the latest matching snapshot as additional signal when invoked on the same target. `ignore.md` at the same path is user-curated; lines there are designer-intended deviations that critique won't re-raise.

Codex-specific image flow extracted. The mock-and-palette workflow lives in `reference/codex.md` with a palette-first gate (lock the palette before any mocks, so generated comps stop drifting). Craft.md is shorter and cleaner for every non-Codex harness.

Detector: new rule + false-positive fixes.`body-text-viewport-edge` catches body text running to the absolute viewport edge. OKLCH and CSS-var resolution improvements remove a class of false positives in modern token-based codebases.

Brand register sharpened. An "inverse test" question now sits up front: describe your page the way a competitor would describe theirs; if that sentence fits the modal landing page in the category, restart. A cultural-symbol palette guardrail catches the lazy pull.

Shape and craft gates strengthened. Image-gen skips are announced in one line. Brief confirmation is explicit, not assumed. When the harness has native image generation, craft now names the four user gates between shape and code (direction questions, palette generation, mock generation, mock approval) with explicit STOP markers at each.

Skill prose, image discipline, and detector counts kept honest. A skill-side prose validator catches em dashes and AI tells in reference instructions. Craft step 3 reads the screenshot back into context after capture. Build validator now ignores changelog history when checking detector counts.

v3.0.7May 4, 2026
Detector flags italic-serif display heroes. Oversized italic serif (Fraunces, Recoleta, Newsreader, Playfair, Cormorant, Tiempos) running as the primary hero h1 is now caught as a structural fingerprint of late-2025 and early-2026 AI-generated marketing pages. Editorial surfaces that legitimately want the pattern can ignore the rule. Contributed by [@vinaypokharkar](https://github.com/vinaypokharkar) in [#129](https://github.com/pbakaus/impeccable/pull/129).

Detector flags hero eyebrow chips. The uppercase letter-spaced label sitting directly above a hero h1 now fires, including the pill-chip variant (background plus 999px border-radius). Bounded to short labels at small sizes so editorial captions don't false-positive. Also in [#129](https://github.com/pbakaus/impeccable/pull/129).

Detector flags the new font monoculture. The overused-font rule now catches Fraunces, Geist, Mona Sans, Plus Jakarta Sans, Space Grotesk, Recoleta, and Instrument Sans alongside Inter and the older defaults. Contrast checks also run on styled `<a>` and `<button>` elements (a "Get started" pill with charcoal text on near-black no longer reads as fine). Brand exceptions for Vercel, Next.js, and GitHub on their own domains.

Live mode survives disconnects. A durable session journal records every event, so an agent crash, a network blip, or a browser refresh no longer loses the session. Three new sub-commands: `live status`, `live resume`, and `live complete`. Contributed by [@nqh-packages](https://github.com/nqh-packages) in [#125](https://github.com/pbakaus/impeccable/pull/125).

Reference files stripped of repetitive scaffolding. SKILL.md and 33 sub-command files lost the "Remember:" closer chants, the brochure-style openers on 12 older commands, and 419 em-dashes that obscured the choice between colon, semicolon, period, or parens.

v3.0.6April 30, 2026
Live mode preserves identity by default. Variants now stay on-brand for the existing surface (same palette, type pairing, visual rhetoric) and explore different expression axes within that identity. Departure from the existing aesthetic only triggers when PRODUCT.md anti-references explicitly call out the current surface, or the user asks for it.

Departure mode derives from brand voice, not a fixed catalog. The old lane list (Swiss-grid, Terminal, Industrial-signage) caused the model to converge on the same three directions every time. Replaced with a brand-voice derivation: read personality words, imagine physical experiences, derive visual directions.

Parameters ship consistently on large surfaces. Planning params is part of variant planning. The freeform bias aligns with the budget table: 2-3 knobs per variant for heroes and sections, with 0-param heroes flagged as mistakes rather than judgment calls.

Reflex-reject aesthetic lanes. Parallel to the font reflex-reject list. Editorial-typographic is the first entry, catching the second-order training reflex where every departure from SaaS-cream defaults to magazine-cover aesthetics.

v3.0.5April 28, 2026
Live mode lands valid TSX through the wrap → preview → accept → carbonize loop on Vite/Next React/TSX projects. The wrapper now keeps a single JSX-slot child instead of three adjacent siblings, so it round-trips cleanly inside `return (...)`, array `.map(...)`, and `asChild` parents. Closes [#114](https://github.com/pbakaus/impeccable/issues/114), with thanks to [@dergachoff](https://github.com/dergachoff).

Wrap correctly disambiguates repeated identical-class siblings. A list of `<Card className="card">` rendered three times used to land on the first one regardless of which the user picked. `live-wrap.mjs` now accepts `--text TEXT` (the picked element's `textContent`) and narrows candidates accordingly.

`live-inject` CSP-meta unwrap now byte-for-byte preserves self-closing tag whitespace. Common Vite shapes that ship a CSP meta now round-trip cleanly.

v3.0.4April 28, 2026
`/impeccable craft` now treats approved mocks as visual contracts. The craft flow requires a mock fidelity inventory before build, maps major visible ingredients to code or assets, and flags missing hero objects, imagery, section structure, nav/CTA treatment, and distinctive motifs as blocking defects unless the user accepted the deviation.

Image-led brand surfaces can no longer degrade into abstract panels. Travel, editorial, portfolio, venue, product showcase, entertainment, and education work now requires credible imagery when the approved mock or subject matter calls for them.

Live picker plays nice with modal hosts. Inside Radix Dialog, Headless UI, vaul, and other portals that lock `body { pointer-events: none }`, the picker chrome had become unclickable. Now defangs outside-handlers at the chrome boundary and forces `pointer-events: auto` on itself. Closes [#113](https://github.com/pbakaus/impeccable/issues/113).

v3.0.2April 27, 2026
Claude Code plugin install shrunk by 380×. The marketplace now ships only the runtime payload (~770 KB) instead of the entire monorepo (291 MB). Plugin source moved from `./` to `./plugin`. Reported in [#107](https://github.com/pbakaus/impeccable/issues/107).

Slash commands now register reliably on Claude Code. The `skills` field in `plugin.json` was missing the trailing slash that the documented schema expects. Reported by three users in [#86](https://github.com/pbakaus/impeccable/issues/86).

v3.0.1April 24, 2026
Live mode runs in strict-CSP apps. When your HTML carries a Content-Security-Policy meta tag, `/impeccable live` now silently appends the live-server origin to `script-src` and `connect-src` on session start, and reverts the patch verbatim on stop.

Live mode survives conditional-render content. Picking an element inside a closed modal, an inactive tab, or a collapsible panel used to wedge live mode when Vite Fast Refresh remounted the parent. Now: a brief upfront heads-up at pick time, plus a contextual toast after Go so variants land the moment the element is back in the DOM.

`/impeccable polish` now a true superset of the retired `/normalize`. Aligning to the design system is non-optional, drift is named by root cause (missing token, one-off implementation, or conceptual misalignment), and a new Information Architecture & Flow dimension covers progressive disclosure.

v3.0April 10, 2026
Live Mode (Alpha). Run `/impeccable live` and iterate on your UI in the browser: pick any element, drop a comment or stroke, hit Go, get three production-quality variants swapped in via your framework's HMR, accept the one you want and it writes back to source. Works on Vite, Next.js (including monorepos), SvelteKit, Astro, Nuxt.

Visualize, then build. Image gen crossed the reference-quality threshold with GPT Image 2, Nano Banana Pro, and Imagen 4 Ultra. `/impeccable shape` drafts a brand toolkit (color, typography, mood board) as real images; `/impeccable craft` pre-renders the hi-fi mock to code toward. Strongest in Codex with GPT 5.5.

PRODUCT.md, shared design memory for your AI. A single file at your project root that names the audience, brand personality, anti-references, and register (brand vs product). Every command reads it before generating.

DESIGN.md generation, spec-compliant and interoperable.`/impeccable document` scans your tokens, components, and rendered output and writes a DESIGN.md that follows the [Google Stitch DESIGN.md format](https://stitch.withgoogle.com/docs/design-md/format/).

18 skills became 1 skill with 23 commands. Every command now lives under `/impeccable`. One entry in your `/` menu instead of 18, a shared design vocabulary, and far less namespace pollution.

Pin your favorites back as shortcuts. Run `/impeccable pin audit` and `/audit` becomes a standalone command again, without reversing the consolidation.

v2.1April 9, 2026
Streamlined from 21 to 18 commands.`/arrange` renamed to `/layout`, `/normalize` merged into `/polish`, `/onboard` merged into `/harden`, and `/extract` became `/impeccable extract`.

Automatic cleanup of deprecated skills. On first load after updating, the skill detects and removes leftover files from renamed or merged commands.

v2.0April 8, 2026
Renamed `frontend-design` to `impeccable`. The core skill now shares its name with the project.

Skill rewritten against evals. Fifteen briefs ran through gpt-5.4 and Qwen 3.6 Plus, with and without the skill loaded, then graded side by side. More font and color variety, fewer purple gradients, much better Codex output.

Anti-pattern detection engine. 28 deterministic rules across typography, color, layout, motion, and quality.

CLI: `npx impeccable detect`. Scans HTML, CSS, JSX/TSX, Vue, Svelte, and CSS-in-JS. Framework detection, multi-file import tracking, CI-ready JSON output.

Chrome DevTools extension. One-click detection on any page. Reads live computed styles, surfaces findings in an interactive panel, and highlights elements on the page.

`/critique` got teeth. Persona sub-agents review in parallel, score against Nielsen's heuristics, run the detector automatically, and open a live browser overlay so you can walk each finding in place.

v1.xFebruary 28 – March 18, 2026
v1.6.0 Trae (China + International) support. `/critique` scores against Nielsen's 10 heuristics and persona archetypes. `/audit` scores 5 dimensions with P0-P3 severity ratings.

v1.5.0`/typeset` (fix typography), `/arrange` (fix layout), `/overdrive` (technically extraordinary effects). Auto design-context gathering via `.impeccable.md`.

v1.3.0 OpenCode and Pi provider support.

v1.2.0 Kiro support. Prefix toggle restored. Audit and critique only suggest installed commands.

v1.1.0 Unified skills architecture. VS Code Copilot and Google Antigravity support. Universal ZIP installer. `/simplify` renamed to `/distill`.

v1.0.0 Initial release. 17 design commands. Cursor, Claude Code, Gemini CLI, and Codex CLI.

[Impeccable](/)[Changelog](/changelog)[FAQ](/faq)[Privacy](/privacy)[GitHub](https://github.com/pbakaus/impeccable)
Created by [Paul Bakaus](https://x.com/pbakaus)[](https://x.com/pbakaus)[](https://linkedin.com/in/paulbakaus)