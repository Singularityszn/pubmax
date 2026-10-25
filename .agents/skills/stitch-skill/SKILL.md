---
name: stitch-design-taste
description: Create or update DESIGN.md for Google Stitch using the existing project design system. Preserve its typography, colour roles, components, and accessible motion.
---

# Stitch design taste

## Overview

This skill translates a project's design system into a `DESIGN.md` specification
for Google Stitch. Preserve the established product decisions before applying
any optional defaults below.

## Project rules and first reads

For PUBMAXX, read the repository-root `DESIGN.md`, `docs/DESIGN_SYSTEM.md`,
`docs/VOICE.md`, and the relevant area rules. The engineering guide's
"Where things live" section defines ownership. Resolve token values against
`app/globals.css` and `app/theme.css`, including the DOM and map differences.

Use Space Grotesk for display, Inter for body, and JetBrains Mono for figures.
Use existing colour and component tokens. Trust standing is expressed in words.
Price bands determine price colour. Use the documented motion owners and
reduced-motion behaviour. Phone sheet travel may animate height to preserve
its footer geometry.

The sibling `DESIGN.md` is an optional new-project example, not the PUBMAXX
specification. Its palette, font choices, layout, and motion examples apply only
when the target project has no corresponding decision. Do not read or copy it
for an existing PUBMAXX screen. Generic skills cannot override project rules.

## Prerequisites
- Access to Google Stitch via [labs.google/stitch](https://labs.google/stitch)
- Optionally: Stitch MCP Server for programmatic integration with Cursor, Antigravity, or Gemini CLI

## The Goal
Generate a `DESIGN.md` file that encodes:
1. **Visual atmosphere:** The mood, density, and design philosophy
2. **Color calibration:** Neutrals, accents, and banned patterns with hex codes
3. **Typographic architecture:** Font stacks, scale hierarchy, and anti-patterns
4. **Component behaviors:** Buttons, cards, inputs with interaction states
5. **Layout principles:** Grid systems, spacing philosophy, responsive strategy
6. **Motion philosophy:** Animation engine specs, existing animation owners and reduced-motion behaviour
7. **Anti-patterns:** Explicit list of banned AI design clichés

## Analysis & Synthesis Instructions

### 1. Define the Atmosphere
Evaluate the target project's intent. Use evocative adjectives from the taste spectrum:
- **Density:** "Art Gallery Airy" (1–3) → "Daily App Balanced" (4–7) → "Cockpit Dense" (8–10)
- **Variance:** "Predictable Symmetric" (1–3) → "Offset Asymmetric" (4–7) → "Artsy Chaotic" (8–10)
- **Motion:** "Static Restrained" (1–3) → "Fluid CSS" (4–7) → "Cinematic Choreography" (8–10)

For a new project without design guidance, use Variance 8, Motion 6, Density 4 as a starting point. Existing project settings take precedence.

### 2. Map the Color Palette
For each color provide: **Descriptive Name** + **Hex Code** + **Functional Role**.

**Defaults for a new project without an existing palette:**
- Maximum 1 accent color. Saturation below 80%
- The "AI Purple/Blue Neon" aesthetic is strictly BANNED. No purple button glows, no neon gradients
- Use absolute neutral bases (Zinc/Slate) with high-contrast singular accents
- Stick to one palette for the entire output. No warm/cool gray fluctuation
- Never use pure black (`#000000`). Use Off-Black, Zinc-950, or Charcoal

### 3. Establish Typography Rules
- **Display/Headlines:** Track-tight, controlled scale. Not screaming. Hierarchy through weight and color, not just massive size
- **Body:** Relaxed leading, max 65 characters per line
- **Font Selection:** Preserve the project's chosen font roles. For a new project, compare suitable families by readability and character. PUBMAXX uses Inter for body text.
- **Serif choice:** Preserve an established type system. In a new system, choose a serif only when it supports the product and remains readable.
- **Dashboard typography:** Reuse the project font roles. Avoid adding a second typography system for a dashboard.
- **Data typography:** Use the project's data font only for the content roles assigned to it.

### 4. Define the Hero Section
Keep the existing product hierarchy. PUBMAXX uses the map as the main visual element. The following are optional new-project composition ideas:
- **Inline Image Typography:** Embed small, contextual photos or visuals directly between words or letters in the headline. Images sit inline at type-height, rounded, acting as visual punctuation. This is the signature creative technique
- **No Overlapping:** Text must never overlap images or other text. Every element occupies its own clean spatial zone
- **No Filler Text:** "Scroll to explore", "Swipe down", scroll arrow icons, bouncing chevrons are BANNED. The content should pull users in naturally
- **Asymmetric Structure:** Centered Hero layouts BANNED when variance exceeds 4
- **CTA Restraint:** Maximum one primary CTA. No secondary "Learn more" links

### 5. Describe Component Stylings
Use existing components first. For a new project without components, consider these defaults:
- **Buttons:** Tactile push feedback on active state. No neon outer glows. No custom mouse cursors
- **Cards:** Use ONLY when elevation communicates hierarchy. Tint shadows to background hue. For high-density layouts, replace cards with border-top dividers or negative space
- **Inputs/Forms:** Label above input, helper text optional, error text below. Standard gap spacing
- **Loading States:** Skeletal loaders matching layout dimensions. No generic circular spinners
- **Empty States:** A clear title, explanation, and useful next action
- **Error States:** Clear, inline error reporting

### 6. Define Layout Principles
Preserve existing layout contracts. Apply the following defaults only where the project has no corresponding rule:
- Prevent accidental occlusion. Preserve intentional map overlays, sheets, and the existing stacking tokens.
- Centered Hero sections are BANNED when variance exceeds 4. Use Split Screen, Left-Aligned, or Asymmetric Whitespace
- The generic "3 equal cards horizontally" feature row is BANNED. Use 2-column Zig-Zag, asymmetric grid, or horizontal scroll
- CSS Grid over Flexbox math. Never use `calc()` percentage hacks
- Contain layouts using max-width constraints (e.g., 1400px centered)
- Full-height sections must use `min-h-[100dvh]`. Never `h-screen` (iOS Safari catastrophic jump)

### 7. Define Responsive Rules
Every design must work across all viewports:
- **Responsive layout:** Use the project breakpoints and component layouts. Do not force map controls or navigation into a generic single-column template.
- **No Horizontal Scroll:** Horizontal overflow on mobile is a critical failure
- **Typography Scaling:** Use the existing type scale and verify readability at supported widths and text sizes.
- **Touch Targets:** All interactive elements minimum `44px` tap target
- **Image Behavior:** Inline typography images (photos between words) stack below headline on mobile
- **Navigation:** Preserve the established mobile navigation. Do not replace PUBMAXX's tab bar with a template menu.
- **Spacing:** Vertical section gaps reduce proportionally (`clamp(3rem, 8vw, 6rem)`)

### 8. Encode Motion Philosophy

- Reuse the project motion tokens and animation owners.
- Add motion only when it communicates state, feedback, or spatial change.
- Do not require permanent loops or staggered reveals on every component.
- Respect reduced-motion preferences and keep information available without animation.
- Prefer transform and opacity when they preserve the required layout behaviour.
- Preserve documented exceptions, including PUBMAXX phone sheet height animation.
- Measure animation performance in the affected interaction before changing its implementation.

### 9. List Anti-Patterns (AI Tells)
Use the project's existing prohibitions. For a new project, review these candidates before adding them to DESIGN.md:
- No emojis anywhere
- No unrequested replacement of the project font roles
- No generic serif fonts (`Times New Roman`, `Georgia`, `Garamond`). Use distinctive modern serifs only if needed
- No pure black (`#000000`)
- No neon/outer glow shadows
- No oversaturated accents
- No excessive gradient text on large headers
- No custom mouse cursors
- No overlapping elements. Keep clean spatial separation always
- No 3-column equal card layouts
- No generic names ("John Doe", "Acme", "Nexus")
- No invented metrics, prices, people, or venue facts. Use sourced data or clearly labelled placeholders.
- No AI copywriting clichés ("Elevate", "Seamless", "Unleash", "Next-Gen")
- No filler UI text: "Scroll to explore", "Swipe down", scroll arrows, bouncing chevrons
- No unrelated stock images presented as real venues or people. Use approved assets or an explicit placeholder.
- No centered Hero sections (for high-variance projects)

## Output Format (DESIGN.md Structure)

For PUBMAXX, update the existing root file in place and keep its structure.
Use its YAML tokens and prose together. Do not copy this illustrative template
or the sibling example over it. For a new project, adapt the outline below to
that project's decisions and the current [DESIGN.md specification](https://github.com/google-labs-code/design.md).

```markdown
# Design System: [Project Title]

## 1. Visual Theme & Atmosphere
(Evocative description of the mood, density, variance, and motion intensity.
Example: "A restrained, gallery-airy interface with confident asymmetric layouts
and fluid spring-physics motion. The atmosphere resembles a well-lit architecture studio.")

## 2. Color Palette & Roles
- **Canvas White** (#F9FAFB). Primary background surface
- **Pure Surface** (#FFFFFF). Card and container fill
- **Charcoal Ink** (#18181B). Primary text, Zinc-950 depth
- **Muted Steel** (#71717A). Secondary text, descriptions, metadata
- **Whisper Border** (rgba(226,232,240,0.5)). Card borders, 1px structural lines
- **[Accent Name]** (#XXXXXX). Single accent for CTAs, active states, focus rings
(Max 1 accent. Saturation < 80%. No purple/neon.)

## 3. Typography Rules
- **Display:** [Font Name]. Track-tight, controlled scale, weight-driven hierarchy
- **Body:** [Font Name]. Relaxed leading, 65ch max-width, neutral secondary color
- **Mono:** [Font Name]. For code, metadata, timestamps, high-density numbers
- **Constraints:** [The project's font roles and documented restrictions.]

## 4. Component Stylings
* **Buttons:** Flat, no outer glow. Tactile -1px translate on active. Accent fill for primary, ghost/outline for secondary.
* **Cards:** Generously rounded corners (2.5rem). Diffused whisper shadow. Used only when elevation serves hierarchy. High-density: replace with border-top dividers.
* **Inputs:** Label above, error below. Focus ring in accent color. No floating labels.
* **Loaders:** Skeletal shimmer matching exact layout dimensions. No circular spinners.
* **Empty States:** Composed, illustrated compositions. Include a useful next action.

## 5. Layout Principles
(Grid-first responsive architecture. Asymmetric splits for Hero sections.
Strict single-column collapse below 768px. Max-width containment.
No flexbox percentage math. Generous internal padding.)

## 6. Motion & Interaction
(Name the existing motion tokens, animation owners, reduced-motion behaviour,
and any measured layout exceptions. Do not mandate permanent animation.)

## 7. Anti-Patterns (Banned)
(List the project's documented restrictions. Do not import unrelated template bans.)
```

## Best Practices
- **Be Descriptive:** "Deep Charcoal Ink (#18181B)". Include the value and role.
- **Be Functional:** Explain what each element is used for
- **Be Consistent:** Same terminology throughout the document
- **Be Precise:** Include exact hex codes, rem values, pixel values in parentheses
- **Preserve decisions:** The project design system controls the output. Defaults fill gaps only.

## Tips for Success
1. Start with the atmosphere. Understand the vibe before detailing tokens
2. Look for patterns. Identify consistent spacing, sizing, and styling
3. Think semantically. Name colors by purpose, not just appearance
4. Consider hierarchy. Document how visual weight communicates importance
5. Encode the bans. Anti-patterns are as important as the rules themselves

## Common Pitfalls to Avoid
- Using technical jargon without translation ("rounded-xl" instead of "generously rounded corners")
- Omitting hex codes or using only descriptive names
- Forgetting functional roles of design elements
- Being too vague in atmosphere descriptions
- Ignoring the anti-pattern list. Preserve the project restrictions
- Replacing the project design system with this skill's optional defaults
