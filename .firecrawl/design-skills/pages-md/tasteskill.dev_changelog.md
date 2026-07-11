Changelog | Taste Skill

[Back](/)

Version History
Changelog.

Track every update to Taste Skill. New skills, design rules, and improvements.

v2Experimental
v2 (experimental) just shipped.

Substantial 2026 rewrite of the default skill. Same install command, now installs v2. Genuinely better than v1, still iterating toward v2.0.0 stable. Install name (`design-taste-frontend`) stays stable.

[CHANGELOG.md on GitHub](https://github.com/Leonxlnx/taste-skill/blob/main/CHANGELOG.md)[Read v2 SKILL.md](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill/SKILL.md)[Legacy v1](https://github.com/Leonxlnx/taste-skill/blob/main/skills/taste-skill-v1/SKILL.md)

v2 (experimental)
May 2026Latest
taste-skill: substantial rewrite of the default skill. New title "tasteskill: Anti-Slop Frontend Skill". Around 900 lines, Sections 0 to 14 plus Appendices A to C.

Same install command (`design-taste-frontend`) now installs v2. Existing users get it on next install.

Section 0: Brief inference. The agent reads the room (industry, audience, mood, motion, layout) before generating.

Section 2: Brief to design system map. Material, Fluent, Carbon, Polaris, Atlassian, Primer, GOV.UK, USWDS, Bootstrap, Radix, shadcn, Tailwind official, or native CSS.

Section 8: Dark mode protocol. Dual-mode by default, contrast and hierarchy parity.

Section 11: Redesign protocol. Audit-first, preservation rules, explicit modernisation levers.

Section 12: Block library schema. Contract for iterative block additions.

Section 14: Hard pre-flight check. Every checkbox must honestly pass.

Section 9: Complete em-dash ban. Section-numbering eyebrows banned. Version labels in hero banned. Photo-credit captions, decoration text strips, pills on images, version footers, locale or time strips, scroll cues, decorative status dots all banned. border-t plus border-b on every row of long lists banned. Div-based fake product UI banned.

New rules: color consistency lock, shape consistency lock, page theme lock, hero discipline (max 2 lines, 20 words subtext, CTA without scroll), navigation discipline (one line, 80px max), section-layout repetition ban (at least 4 different families across 8 sections), bento cell count rule, italic descender clearance, long lists need a different UI component.

Section 5: canonical GSAP code skeletons for sticky-stack, horizontal-pan, scroll-reveal. Forbidden patterns including raw window.addEventListener('scroll'). Reduced motion mandatory for MOTION_INTENSITY greater than 3. Motion claimed equals motion shown.

Stack: Tailwind v4 default, Motion (rebranded Framer Motion) recommended, icons from Phosphor, HugeIcons, Radix, Tabler only. Lucide discouraged. Hand-rolled SVG icons banned.

taste-skill-v1 preserved at `skills/taste-skill-v1/`. Install legacy explicitly with `--skill "design-taste-frontend-v1"`.

README skills table updated. CHANGELOG.md added at repo root. brutalist-skill BETA badge removed. 4 new sponsors added.

v1.2
May 2026
imagegen-frontend-web: tightened hero composition rules on 2026-05-04 (default left-text or right-image hero banned, then revised to a composition bias rather than a hard ban in a follow-up commit).

imagegen-frontend-web: required one horizontal reference image per section on 2026-05-03. A page with eight sections expects eight images; combining multiple sections in one frame is not allowed.

imagegen-frontend-web: added brief-adaptation cues plus conditional background rules on 2026-05-03.

imagegen-frontend-web: expanded background modes and gradient discipline (palette-matched gradients encouraged, typical AI-default gradient recipes discouraged) on 2026-05-03.

imagegen-frontend-web: documented per-section framing, composition variety, hero scale presets, conversion-oriented section roles, LAYOUT_VARIATION and CONVERSION_DISCIPLINE dials, and expanded clarity checks on 2026-05-03.

imagegen-frontend-web: concept spine, second-read cues, and further anti-slop bans on 2026-05-03.

v1.1
April 2026
README: banner image, Taste Skill logo asset, and shield row trimmed to Stars, MIT, Tools, and Changelog on 2026-04-30.

gpt-tasteskill (listed as gpt-taste in the README table): stricter GPT and Codex-oriented rules. Landed on 2026-04-16.

images-taste-skill: image-first reference pipeline added 2026-04-21. Renamed to image-to-code-skill on 2026-04-25.

imagegen-frontend-web and imagegen-frontend-mobile: image-only web and mobile comp skills. Naming and the mobile skill stabilized on 2026-04-25; all three imagegen skills moved under skills/ for npx discovery on 2026-04-28.

brandkit: image-only brand kit boards. Added 2026-04-25, included in the 2026-04-28 skills/ layout.

License: MIT file added on 2026-04-28.

README: documented `npx skills add` on the repository URL plus optional `--skill` for installing a single skill.

v1.0
March 2026
2026-03-20: repository migrated to the npx skills layout with everything under skills/, llms.txt, and a refreshed README install section.

2026-03-20: stitch-skill added (Google Stitch-oriented rules with DESIGN.md export).

2026-03-19: brutalist-skill added and marked beta.

2026-03-17: minimalist-skill added.

2026-03-15 to 2026-03-16: soft-skill added with follow-up naming and description fixes.

2026-03-01: split the former single core package into taste-skill, output-skill, and redesign-skill, plus research notes and example shots.

Seven implementation skills were present after these March commits: taste-skill, redesign-skill, soft-skill, minimalist-skill, brutalist-skill, output-skill, stitch-skill.

taste-skill retained the 3-dial system (DESIGN_VARIANCE, MOTION_INTENSITY, VISUAL_DENSITY), the creative arsenal, and the anti-slop ban lists.

v0.1
February 2026
Taste Skill shipped as a single primary SKILL.md with the three dials, creative arsenal growth, and anti-slop enforcement (iterated heavily through 2026-02-21).

README updates across the same window documented installation, dial examples, and the Taste Skill positioning.

© 2026 Taste Skill. Built by Leon Lin.[Home](/)[Docs](/docs)[Blog](/blog)[Guide](/guide)[GitHub](https://github.com/Leonxlnx/taste-skill)