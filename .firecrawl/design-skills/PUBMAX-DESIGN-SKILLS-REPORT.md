# Design Skills Research for PubMax

**Product context:** PubMax — UK pub nights-out planner (map-based, friends, days/nights out)  
**Method:** Firecrawl CLI unavailable (auth timed out); sites scraped via `curl` + GitHub raw skill files  
**Saved under:** `/workspace/.firecrawl/design-skills/`  
**Date:** 2026-07-11

---

## 1. Impeccable — https://impeccable.style

### What it is
Agent design skill + CLI + browser extension. Positions itself as “the missing upgrade” to Anthropic’s frontend-design skill: shared design vocabulary for humans and agents, plus deterministic anti-slop detection.

**Repo:** https://github.com/pbakaus/impeccable · **npm:** `impeccable` · Apache 2.0

### Skills / tools provided
| Tool | Role |
|------|------|
| **1 skill: `/impeccable`** | Single entry point for all design commands |
| **23 commands** | See table below |
| **46 detector rules** | Deterministic anti-pattern lint (`npx impeccable detect`) |
| **Design hooks** | Auto-run detector on UI edits (Cursor blocks bad writes; Claude/Codex/Copilot post-edit) |
| **Live Mode** | Point-at-element browser iteration → 3 variants → write back to source |
| **Chrome extension** | Overlay detector on any live page |
| **PRODUCT.md / DESIGN.md** | Project design context files (Stitch-compatible DESIGN.md) |

#### Commands (via `/impeccable <cmd>`)
| Command | Purpose |
|---------|---------|
| `init` | Setup interview → PRODUCT.md + DESIGN.md |
| `document` | Generate DESIGN.md from existing code |
| `extract` | Pull repeated patterns into tokens/components |
| `shape` | Plan UX/UI before code |
| `craft` | Full shape-then-build with visual iteration |
| `critique` | UX review (hierarchy, clarity, emotion) |
| `audit` | a11y, performance, responsive, anti-patterns |
| `polish` | Pre-ship alignment |
| `bolder` / `quieter` | Amplify or tone down |
| `distill` | Strip to essence |
| `harden` | Errors, i18n, overflow, edge cases |
| `onboard` | First-run / empty / activation |
| `animate` / `colorize` / `typeset` / `layout` | Named visual disciplines |
| `delight` / `overdrive` | Joy / extraordinary effects |
| `clarify` | UX copy |
| `adapt` | Device adaptation |
| `optimize` | Performance |
| `live` | Browser visual variants |
| `pin` | Shortcut aliases (e.g. `/audit`) |

### Design principles / checklists

**Core loop:** Start (context) → Iterate → Polish (audit/clarify/harden) → Maintain (extract/document)

**Brand vs product register:**
- **Brand** (marketing/landing): distinctive type, committed palette, image-led heroes
- **Product** (app/tool): density, semantic states, repeatable components

**Absolute bans (match-and-refuse):**
- Side-stripe / thick accent borders on cards
- Gradient text
- Decorative glassmorphism as default
- Hero-metric template (big number + stats + gradient)
- Identical icon+heading card grids
- Tiny uppercase tracked eyebrows on every section
- Numbered section markers (01/02/03) as default scaffolding
- Text overflow from oversized clamp headlines

**Quality rules:** contrast ≥4.5:1 body; line length 65–75ch; no nested cards; ease-out (no bounce/elastic); `prefers-reduced-motion`; semantic z-index scale; OKLCH color; avoid cream/sand body bg as “tasteful default”; avoid purple gradients / dark neon glow

**AI slop catalog (46):** overused fonts (Inter, Geist, Space Grotesk, Instrument Serif), flat type hierarchy, icon-tile-above-heading, nested cards, monotonous spacing, em-dash overuse, marketing buzzwords, cream palette, AI purple palette, etc.

**Pre-ship gauntlet:** `audit` (5 dimensions 0–4) → `clarify` (copy) → `harden` (messy real-world data)

### Install / use with Cursor & Claude

```bash
# Recommended
npx impeccable install
# Then in agent:
/impeccable init
```

- Detects harness folders (`.cursor`, `~/.claude`, `.codex`, etc.); supports project or global scope
- Cursor: also installs `.cursor/hooks.json` (before-edit detector)
- Claude Code: marketplace `/plugin marketplace add pbakaus/impeccable` or CLI install
- Manual Cursor: `cp -r dist/cursor/.cursor your-project/` (Nightly + Agent Skills enabled)
- Update: `npx impeccable update`
- Detector CI: `npx impeccable detect src/ --json`

**Avoid:** running Impeccable *and* Anthropic’s frontend-design skill together (vocabulary collision).

### Visual design language the site promotes
| Aspect | Site / guidance |
|--------|-----------------|
| **Colors** | Lacquer/near-black ground; gold “kinpaku” accents; patina teal; vermilion; champagne text. OKLCH tokens. Committed dark brand surface, not purple SaaS |
| **Typography** | Display: Alumni Sans (ultra-light); body: Albert Sans. Strong weight contrast |
| **Layout** | Editorial sections, command-forward docs, catalog grids for anti-patterns; brand vs product split |
| **Motion** | Intentional ease-out; Live Mode picker; bans bounce/elastic and layout-property animation |

### Concrete takeaways for PubMax
1. Run `/impeccable init` with **product** register (planner app), voice: social, local UK, night-out energy — anti-references: purple gradients, cream “premium DTC”, Inter-only, nested map+list cards.
2. Use `DESIGN.md` + detector hooks so map UI doesn’t drift into slop (side-tab venue cards, icon tiles, glow pins).
3. Pre-ship: `audit` + `harden` for long pub names, German/emoji friend names, offline map, empty “no pubs nearby”.
4. Prefer **colorize** toward a distinctive UK-night accent (amber pint / deep teal / vermillion) on neutrals — not AI purple.
5. Live Mode for iterating map pin popovers and plan timeline without full redesigns.

---

## 2. Taste Skill — https://tasteskill.dev (www)

### What it is
Open-source “anti-slop frontend framework” of portable `SKILL.md` files. Strongest on **visual craft**: layout variance, typography, motion, hero discipline, ban lists. v2 (experimental) is the default install.

**Repo:** https://github.com/Leonxlnx/taste-skill · MIT

### Skills / tools provided

#### Implementation skills
| Folder | Install name | Role |
|--------|--------------|------|
| `taste-skill` | `design-taste-frontend` | **v2 default** — brief inference, dials, locks, GSAP skeletons, redesign protocol, pre-flight |
| `taste-skill-v1` | `design-taste-frontend-v1` | Legacy pin |
| `gpt-tasteskill` | `gpt-taste` | Stricter GPT/Codex variant |
| `redesign-skill` | `redesign-existing-projects` | Audit-first redesign |
| `soft-skill` | `high-end-visual-design` | Calm, expensive, spring motion |
| `minimalist-skill` | `minimalist-ui` | Editorial / Notion-Linear |
| `brutalist-skill` | `industrial-brutalist-ui` | Swiss / terminal / high contrast |
| `output-skill` | `full-output-enforcement` | No half-finished output |
| `stitch-skill` | `stitch-design-taste` | Google Stitch + DESIGN.md |
| `image-to-code-skill` | `image-to-code` | Generate refs → analyze → code |

#### Image-generation skills
`imagegen-frontend-web`, `imagegen-frontend-mobile`, `brandkit` — comps/boards only, then hand to coding agent.

### Design principles / checklists

**Three dials (1–10):**
- `DESIGN_VARIANCE` — symmetry → asymmetry (baseline 8)
- `MOTION_INTENSITY` — hover → cinematic (baseline 6)
- `VISUAL_DENSITY` — gallery → cockpit (baseline 4)

**Three locks:**
1. Color consistency (one accent page-wide)
2. Shape consistency (one radius system)
3. Page theme lock (light/dark/auto once — no mid-page flips)

**Hero discipline:**
- Fits first viewport; headline ≤2 lines; subtext ≤20 words / ≤4 lines
- Primary CTA visible without scroll; nav ≤80px single line
- Max 4 text elements in hero (eyebrow OR brand, headline, subtext, CTAs)
- Ban: trust strips, feature bullets, social-proof rows in hero

**Anti-slop bans (high signal):** em/en-dashes; section-numbering eyebrows; hero version labels; photo-credit decoration; mono-caps decoration strips; pills on images; locale/weather strips; scroll cues; decorative status dots; 3-equal feature cards; AI-purple/mesh blobs; hand-rolled SVG illustrations; `window.addEventListener('scroll')`; div-fake product UIs

**Other:** max 1 accent; discourage Inter/serif-by-default; cards only when elevation matters; dual-mode WCAG AA; reduced motion mandatory; pre-flight checklist must pass before ship

### Install / use with Cursor & Claude

```bash
# Default v2
npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"

# Full bundle
npx skills add Leonxlnx/taste-skill

# Codex-targeted
npx skills add Leonxlnx/taste-skill -a codex
```

Works with Cursor, Claude Code, Codex, Gemini CLI, v0, Lovable, OpenCode, Copilot, etc. Agent auto-loads `SKILL.md`. Guide: two paste prompts (greenfield vs redesign) at https://www.tasteskill.dev/guide

### Visual design language the site promotes
| Aspect | Site / guidance |
|--------|-----------------|
| **Colors** | Neutral light UI (#151515 marks, white/neutral-200); emerald success accents on site; skills push Zinc/Slate + one high-contrast accent (emerald, electric blue, deep rose, burnt orange) — ban AI purple and cream DTC |
| **Typography** | Site: Manrope (sans) + Playfair Display (display) + IBM Plex Mono. Skills: Geist/Outfit/Cabinet Grotesk/Satoshi; serif only for true editorial |
| **Layout** | Asymmetric heroes when variance >4; ban 3-equal cards; zig-zag / bento / sticky-stack / horizontal-pan |
| **Motion** | Spring physics, GSAP ScrollTrigger skeletons, stagger reveals; no scroll listeners; magnetic micro-physics at high motion dial |

**Variant aesthetics:** soft = Apple/Linear premium; minimalist = warm mono + flat bento; brutalist = Swiss/industrial print OR tactical terminal

### Concrete takeaways for PubMax
1. Treat the **planner shell as product density** (dial density ~5–7) and **marketing as higher variance** — don’t use landing-page motion on the map canvas.
2. Lock **one nightlife accent** (e.g. warm amber or deep teal) across map pins, CTAs, and friend avatars.
3. Hero for marketing: brand-first, one night-out promise, one CTA, full-bleed atmosphere photo — no stats/schedules in fold (aligns with Taste hero bans).
4. Avoid three equal “Discover / Plan / Share” cards; use asymmetric map preview + copy zig-zag.
5. For redesigns of existing PubMax UI: use redesign skill / Section 11 audit — preserve routes and nav labels.
6. Prefer soft-skill or taste-v2 over brutalist for social nightlife (brutalist fits admin/ops, not friend planning).

---

## 3. Layers — https://layers.jamiemill.com

### What it is
AI skills pack for **product design depth**, not visual styling. Seven layers of product design + orient + intro. Explicitly: “Skills don’t generate output; they help you make better decisions.”

**Repo:** https://github.com/jamiemill/layers-skills · MIT  
**Author:** Jamie Mill (extends *Elements of Product Design* / JJ Garrett)

### Skills / tools provided

| Skill | Layer | Produces |
|-------|-------|----------|
| `/layers-intro` | Meta | Framework context (load first) |
| `/layers-orient` | Diagnostic | Where to focus across 7 layers |
| `/layers-observed-behaviour` | 1 Problem | Job stories + confidence |
| `/layers-domain` | 2 Problem | Concept map, terminology conflicts |
| `/layers-user-needs` | 3 Problem | Prioritised needs/pains/desires |
| `/layers-product-strategy` | 4 Solution | Opportunity Solution Tree / bets |
| `/layers-conceptual-model` | 5 Solution | Objects, states, ubiquitous language |
| `/layers-interaction-flow` | 6 Solution | Breadboard + edge cases |
| `/layers-surface` | 7 Solution | Surface audit vs lower layers |

### Design principles / checklists

**Zones:** Reality → Problem space (1–3) → Solution space (4–7)

**Cross-session principles:**
1. Decisions, not outputs  
2. Uncover before resolve  
3. One layer at a time  
4. Check foundations before building up  
5. Conceptual model is most neglected load-bearing layer  
6. Flag bad decisions, not just missing ones  
7. Steer, don’t be steered (don’t jump to screens)  
8. Separate UX requirements from implementation questions  
9. Capture light residue (decisions + open questions)  
10. Probe up to learn, then come back down  

**OOUX failure modes:** shapeshifter, masked, broken, isolated objects  

**Surface disciplines:** vocabulary vs model; object consistency; feedback/errors diagnose+explain+recover; prominence = importance; accessibility decided not defaulted; emotional register matches social/emotional jobs

**Interaction disciplines:** every affordance has a named destination; edges (empty/loading/error/cancel) are required; no broken objects across places

### Install / use with Cursor & Claude

```bash
npx skills add jamiemill/layers-skills
```

Then: load `/layers-intro` → `/layers-orient` (or jump to a layer). Compatible with Claude Code, Cursor, Codex, pi.dev, +50 more via skills CLI.

### Visual design language the site promotes
Layers is **not** a visual style system. The marketing site itself uses:
| Aspect | Site |
|--------|------|
| **Colors** | White bg; brand `#3f3608`; accent yellow `#ffd601`; reality band near-black; problem zones greys; solution zones yellow ladder |
| **Typography** | Plus Jakarta Sans + system mono |
| **Layout** | Stacked “sheet” metaphor for 7 layers; long-form skill docs |
| **Motion** | Minimal; conceptual framework first |

Takeaway: use Layers for **product correctness**; use Impeccable/Taste for **pixels**.

### Concrete takeaways for PubMax (highest leverage)

Suggested conceptual model objects (Layer 5):
- **Night Out / Plan** — date, area, vibe, status (drafting → locked → live → done)
- **Stop / Venue visit** — ordered, time window, venue ref, RSVP
- **Venue / Pub** — place identity (not shapeshifting between map pin / list row / detail)
- **Friend / Participant** — RSVP states
- **Area / Neighbourhood crawl** — geographic grouping
- **Route / Sequence** — walking order between stops

Interaction breadboard priorities (Layer 6):
- Plan creation → invite → map explore → add stops → reorder → lock → night-of live view
- Empty: no pubs / no friends / no plan yet
- Conflict: overlapping times, closed pub, friend decline
- Map ↔ list as two **places** with shared objects (no masked “card that is sometimes a pub and sometimes a plan”)

Surface audit (Layer 7): ubiquitous language (“pub” vs “venue” vs “stop”); pin/list/detail visual consistency; feedback when friend joins; accessible map alternatives.

---

## Cross-site synthesis for PubMax

### How the three tools fit together

```
Layers          →  What the product IS (objects, flows, jobs)
Impeccable      →  How to direct/audit craft in the agent + CI detector
Taste Skill     →  How pixels should feel (dials, bans, hero/layout rules)
```

| Concern | Best source |
|---------|-------------|
| Friend-planning mental model, map IA | **Layers** |
| Anti-AI-slop CI, PRODUCT.md, Live Mode | **Impeccable** |
| Colorful but intentional visual system | **Taste** (+ soft-skill if premium calm) |
| Marketing landing | Taste hero rules + Impeccable brand register |
| Map/planner app UI | Layers interaction/surface + Impeccable product register + Taste density dial |

### Shared principles that make PubMax more intuitive **and** colorful

1. **Depth before decoration**  
   Settle Plan / Stop / Venue / Friend vocabulary and flows (Layers) before polishing chrome. Colorful UI on a confused model still feels hard.

2. **One composition, one job per view**  
   Taste hero stack + Impeccable “cards only when needed” + Layers prominence: map night-planning should feel like **one spatial composition**, not a dashboard of cards/stats.

3. **Color with locks, not rainbows**  
   One locked accent (Taste) + intentional OKLCH strategy (Impeccable) → colorful without AI-purple or cream monoculture. Map pins, CTAs, “tonight” states share that accent; neutrals carry the rest.

4. **Object consistency across map and list**  
   Same Venue looks like the same object in pin, sheet, and timeline (Layers shapeshifter ban). Visual variance is for layout, not for reinventing the pub card each time.

5. **Emotional register = night out with friends**  
   Surface tone should match social/emotional jobs (Layers): playful, clear, low-shame empty states — not enterprise SaaS or cyberpunk glow.

6. **Ban the AI nightlife clichés**  
   No purple neon maps, glassmorphism overlays, bounce pins, 3 feature cards, eyebrow chips on every section, em-dash hype copy.

7. **Motion that teaches the plan**  
   Prefer purposeful motion: stop added to timeline, route draw between pubs, friend RSVP — not decorative float. Respect reduced motion (both visual skills).

8. **Hard edges designed**  
   Empty neighbourhood, closed pubs, friend dropped out, GPS denied — breadboarded (Layers) and hardened (Impeccable).

9. **Brand vs product split**  
   Marketing: committed color, full-bleed place imagery, brand-first hero. App: denser, semantic states (going / maybe / out), fluent map+list.

10. **Context files beat one-off prompts**  
    PRODUCT.md + DESIGN.md (Impeccable) and/or Taste SKILL dials tuned for “UK social nightlife planner” keep agents consistent across sessions.

### Suggested install stack for PubMax (research recommendation only)

```bash
npx impeccable install                                          # craft + detector + hooks
npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"
npx skills add jamiemill/layers-skills
```

**Workflow:** `/layers-orient` once on PubMax → `/layers-conceptual-model` + `/layers-interaction-flow` for map planner → `/impeccable init` (product register) → Taste dials ~ variance 6–7 / motion 4–5 / density 6 for app UI → `/impeccable polish` + Taste pre-flight before ship.

### PubMax-specific visual direction (synthesis, not a mandate)
- **Avoid:** purple-indigo SaaS, cream terracotta editorial, newspaper dense columns, dark neon cyberpunk map
- **Lean:** place-real imagery (UK streets/pubs), one warm or jewel accent, expressive non-Inter type, map as full-bleed planning surface, timeline as secondary structure, friend presence as color-coded but restrained markers
- **Intuitive cues:** clear Plan states; Stop order obvious; Venue never shapeshifts; “what’s next tonight” always the primary prominence on night-of view

---

## Sources captured locally

| Path | Content |
|------|---------|
| `design-skills/*.html` / `*.md` | Homepages |
| `design-skills/pages-md/` | Docs, guides, skill pages |
| `design-skills/github/` | READMEs + SKILL.md files + antipatterns registry |
| `design-skills/*.css` | Site token samples |

**Note:** Firecrawl CLI was installed but authentication timed out; research used HTTPS curl + GitHub raw. HTTP URLs redirected to HTTPS for all three sites.
