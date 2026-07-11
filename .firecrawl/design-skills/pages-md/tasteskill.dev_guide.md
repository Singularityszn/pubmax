Prompt Guide | Taste Skill

[Back](/)

On this page

Setup

Creating a new website

Redesigning an existing website

Quick reminders

Short prompt guideFull guide

Prompt Guide
Use v2 in twoprompts.

Two ready-to-paste prompts for taste-skill v2 (experimental). One for greenfield, one for redesigns. Both include the audits the skill expects.

Setup
Load the skill once at the top of your session, then use one of the two prompts below.

$ npx skills add https://github.com/Leonxlnx/taste-skill --skill "design-taste-frontend"[Read SKILL.md on GitHub↗](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md)

1. Creating a new website

For a fresh build. Paste, fill the brief, run the prompt.

Copy promptI have loaded tasteskill v2 (experimental) as my only source of design rules. Brief: - Page kind: <landing / portfolio / marketing> - Product: <name and one-line description> - Audience: <who reads this, concrete adjectives> - Vibe words: <2 to 4 concrete adjectives, e.g. "minimalist, editorial, restrained"> - References: <real URLs or product names that anchor the aesthetic> - Avoid: <explicit slop patterns the brief should NOT default to> Step 1. Declare your design read in one sentence and the three dial values with one-line reasoning each. Stop. Step 2 (after my OK). Ship a single Next.js page with at least 8 sections. Pick the sections that actually fit the product. At least 4 different layout families across the page. Use real images (gen-tool first, then Picsum-seed). Lock one theme for the whole page. Step 3. Run in writing: - Em-dash audit (zero em-dashes U+2014 or en-dashes U+2013 anywhere) - Pre-Flight Check (Section 14, every box marked Pass or Fail with one-line justification) - Section-Layout-Repetition audit (list each section's layout family) - Hero discipline audit (headline lines, subtext words, CTA visibility) Any Fail blocks completion.

2. Redesigning an existing website

For an existing site. The agent audits first, declares the mode, then implements without silently breaking URLs or brand.

Copy promptI have loaded tasteskill v2 (experimental) as my only source of design rules. Brief: - Site: <URL or repo path> - Mode: <preserve brand / overhaul / unsure> - Audience: <who reads this> - What works today: <2 to 3 specifics you want kept> - What is broken today: <2 to 3 specifics you want fixed> - SEO constraint: <which routes, headings, or anchors must not change> Step 1. Run the Section 11 audit (Section 11.B in the skill): - Brand tokens currently in use (primary, accent, type stack, radii) - Information architecture (page tree, nav, conversion paths) - Patterns to preserve (signature interactions, recognisable hero, copy voice) - Patterns to retire (slop tells, broken layouts, dead links) - Inferred dial reading of the current site (DESIGN_VARIANCE, MOTION_INTENSITY, VISUAL_DENSITY) - SEO baseline (ranking pages, titles, anchors) Post the audit in writing. Stop. Step 2 (after my OK). Declare the mode (Preserve, Overhaul, or Greenfield-with-content-preserved) and which modernisation levers from Section 11.D you will apply, in priority order. Stop. Step 3 (after my OK). Implement the changes. Keep URL structure, primary nav labels, form field names, brand logo, and legal copy unchanged unless I explicitly approve a change. Step 4. Run in writing: - Em-dash audit - Pre-Flight Check (Section 14) - Preservation audit: list every URL, nav label, form field, and anchor changed. Should be empty unless I approved. - Brand fidelity audit: confirm the existing brand accent color, type stack, and logo treatment survived the redesign. Any Fail blocks completion.

Quick reminders

Zero em-dashes anywhere. Hyphen only.

Hero headline max 2 lines. Subtext max 20 words. CTA visible without scroll.

Navigation max 80 pixels tall, one line at desktop.

Bento grid: N items equals N cells. No empty cells.

One theme for the whole page (no light/dark flips mid-page).

Real images, no div-based fake screenshots, no hand-rolled SVG illustrations.

No section-numbering eyebrows, no version labels in hero, no scroll cues, no locale strips, no decorative status dots.

If MOTION_INTENSITY is greater than 4, the page actually animates. Otherwise drop the dial.

© 2026 Taste Skill. Built by Leon Lin.[Home](/)[Docs](/docs)[Changelog](/changelog)[Blog](/blog)[GitHub](https://github.com/Leonxlnx/taste-skill)