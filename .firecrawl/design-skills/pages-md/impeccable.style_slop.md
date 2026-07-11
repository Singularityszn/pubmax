Slop | ImpeccableSkip to content
[Impeccable](/)
[Home](/)[Designing](/designing)[Docs](/docs)[Slop](/slop)[Live](/live-mode)[40k](https://github.com/pbakaus/impeccable)
On this page

On this page

See it

Try it live11

The catalog46
Visual Details7

Typography10

Color & Contrast5

Layout & Space8

Motion3

Copy4

Imagery1

General quality8

Run it yourself

Slop

46 patterns that mark an interface as AI-generated, and the detection overlay that catches them in place. Watch it flag them live, try it on 11 synthetic specimens, or browse the full catalog. 41 rules run deterministically (`npx impeccable detect` or the browser extension), 4 of them opt-in provider tells behind `--gpt` / `--gemini`; 5 need [/impeccable critique](/docs/critique)'s LLM review pass.

See it

Every wave of AI-generated UIs converges on a recognizable aesthetic. The detector catches both. The patterns just change.

20222026

Purple gradients, glassmorphism, neon glow
Hover or tap any outlined element to see which rule fired. Toggle the era to see how the patterns shifted.

Try it live

These 11 synthetic slop pages ship with the detector script baked in. Click any to see the overlay running on a real page, then hover the outlined elements.

[

Purple Gradients Everywhere

The AI color palette: purple-to-blue gradients on everything. Buttons, text, backgrounds, orbs. The new "make it pop."
](/antipattern-examples/purple-gradients.html)[

Lazy "Cool"

Glassmorphism, neon glows, blurred orbs, monospace everything. Looks like a hackathon project, not a product.
](/antipattern-examples/lazy-cool.html)[

Lazy "Impact"

When in doubt, animate everything. Bouncing buttons, wiggling icons, gradient text, floating badges. Motion without meaning.
](/antipattern-examples/lazy-impact.html)[

Side-Tab Cards

A thick colored border on one side of a rounded card. The single most recognizable tell of AI-generated UI.
](/antipattern-examples/thick-border-cards.html)[

Cardocalypse

Cards inside cards inside cards. Five levels of nesting, each with its own padding and shadow.
](/antipattern-examples/cardocalypse.html)[

Copy-Paste Layouts

The same hero-metric-features template repeated with different colors. When every section looks the same, nothing stands out.
](/antipattern-examples/layout-templates.html)[

Inter Everywhere

One font for everything. Headings, body, labels, buttons. No typographic hierarchy, no personality, no design.
](/antipattern-examples/inter-everywhere.html)[

Massive Icons

Icon containers larger than the content they introduce. When the decoration is bigger than the message, priorities are backwards.
](/antipattern-examples/massive-icons.html)[

Bad Contrast Choices

Gray text on colored backgrounds, low-contrast labels, unreadable combinations. Looking good and being readable should not conflict.
](/antipattern-examples/bad-contrast.html)[

Redundant UX Writing

Label, sublabel, helper text, and hint text all saying the same thing in slightly different words. Say it once, say it well.
](/antipattern-examples/redundant-ux-writing.html)[

Modal Abuse

Complex settings crammed into a modal. If it needs a scroll bar and three columns, it deserves its own page.
](/antipattern-examples/modal-abuse.html)

The catalog

Every pattern [/impeccable](/docs/impeccable) teaches against. AI slop rules flag the tells of AI-generated UIs; Quality rules flag general design mistakes that hurt regardless of who wrote them.
How to read this

Each rule shows how it is detected:

CLIDeterministic. Runs from `npx impeccable detect` on files, no browser required.
BrowserDeterministic, but needs real browser layout. Runs via the browser extension or Puppeteer, not the plain CLI.
LLM onlyNo deterministic detector. Caught by [/impeccable critique](/docs/critique) during its LLM design review.
opt-inDeterministic, but a provider-specific tell that is off by default. Enable with `--gpt` or `--gemini`.

Visual Details

7 rules

Rounded card
Thick colored border clashes with the radius.

AI slopCLI
Border accent on rounded element

Thick accent border on a rounded card. The border clashes with the rounded corners. Remove the border or the border-radius.
[See in /impeccable](/docs/impeccable#visual-details)

Frosted glass card

AI slopLLM only
Glassmorphism everywhere

Blur effects, glass cards, and glow borders used as decoration rather than to solve a real layering problem.
[See in /impeccable](/docs/impeccable#visual-details)

Alert title
Thick colored stripe on one side.

AI slopCLI
Side-tab accent border

Thick colored border on one side of a card. The most recognizable tell of AI-generated UIs. Use a subtler accent or remove it entirely.
[See in /impeccable](/docs/impeccable#visual-details)

Ghost card
1px hairline plus a wide soft shadow.

AI slopCLIopt-in
Hairline border with wide shadow

A hairline border paired with a wide, diffuse shadow is a recurring generated-UI signature. Commit to one: a defined edge or a soft elevation, not both at once.
[See in /impeccable](/docs/impeccable#visual-details)

AI slopCLIopt-in
Repeating-gradient stripes

Repeating-gradient stripes used as surface decoration are a recurring generated-UI signature. Reach for a deliberate texture, or leave the surface plain.
[See in /impeccable](/docs/impeccable#visual-details)

44px radius
A small card rounded into a blob.

AI slopLLM only
Extreme border-radius on cards

Over-rounding cards, sections, and inputs (24px and up on a small card) rounds everything into the same soft blob. Cards top out around 12 to 16px; reserve full-pill for tags and buttons.
[See in /impeccable](/docs/impeccable#visual-details)

A crude hand-coded mascot.

AI slopLLM only
Amateurish hand-drawn SVG

Hand-coded SVG illustrations of scenes or mascots read as amateur doodles, not whimsy. If you cannot render it with real assets, ship no illustration rather than a sketchy fallback.
[See in /impeccable](/docs/impeccable#visual-details)

Typography

10 rules

Heading
Subheading
Body text at almost the same size.

AI slopCLI
Flat type hierarchy

Font sizes are too close together. No clear visual hierarchy. Use fewer sizes with more contrast (aim for at least a 1.25 ratio between steps).
[See in /impeccable](/docs/impeccable#typography)

✦
Feature name
Rounded icon tile above heading.

AI slopCLI
Icon tile stacked above heading

A small rounded-square icon container above a heading is the universal AI feature-card template. Every generator outputs this exact shape. Try a side-by-side icon and heading, or let the icon sit in flow without its own container.
[See in /impeccable](/docs/impeccable#typography)

Beautifully
Crafted

AI slopCLI
Italic serif display headline

Oversized italic serif as the primary hero headline reads as taste in isolation but has become the universal AI-startup landing page hero. Set it roman, or move to a non-serif display face. Editorial registers may legitimately want it; judge by context.
[See in /impeccable](/docs/impeccable#typography)

Introducing
The hero headline

AI slopCLI
Hero eyebrow / pill chip

A tiny uppercase letter-spaced label sitting immediately above an oversized hero headline, or the same shape rendered as a pill chip, is the default AI SaaS hero. Drop the eyebrow, fold the kicker into the headline, or run it as a breadcrumb instead.
[See in /impeccable](/docs/impeccable#typography)

Features
What you get

Pricing
Simple plans

AI slopCLI
Repeated section kicker labels

Repeating tiny uppercase tracked labels above section headings turns a brand page into AI editorial scaffolding. Replace them with stronger structure, artifacts, imagery, or a deliberate brand system.
[See in /impeccable](/docs/impeccable#typography)

Everything your whole team needs to ship faster

AI slopCLI
Oversized hero headline

A full-sentence headline set at display size dominates the viewport, leaving no room for anything else above the fold. A punchy one or two-word headline at that size is fine; the problem is a long headline blown up too large. Set long headlines smaller, or tighten the copy.
[See in /impeccable](/docs/impeccable#typography)

Crushed Together

AI slopCLI
Crushed letter spacing

Letter spacing pulled tighter than the point where characters keep their own shapes costs legibility. Tighten display type optically, not destructively.
[See in /impeccable](/docs/impeccable#typography)

Just another Inter headline
Every SaaS homepage looks like this.

AI slopCLI
Overused font

Inter, Geist, Space Grotesk, and the newest reflex, Instrument Serif, are used on so many sites they no longer feel distinctive. Each new wave of AI-generated UIs converges on the same handful of faces. Choose a face that gives your interface personality.
[See in /impeccable](/docs/impeccable#typography)

Heading in the body font
Body in the same font. No contrast. Flat.

AI slopCLI
Single font for everything

Only one font family is used for the entire page. Pair a distinctive display font with a refined body font to create typographic hierarchy.
[See in /impeccable](/docs/impeccable#typography)

Long passages in uppercase are hard to read. We recognize words by their shape, which all-caps removes.

QualityCLI
All-caps body text

Long passages in uppercase are hard to read. We recognize words by shape (ascenders and descenders), which all-caps removes. Reserve uppercase for short labels and headings.
[See in /impeccable](/docs/impeccable#typography)

Color & Contrast

5 rules

AI slopCLI
AI color palette

Purple/violet gradients and cyan-on-dark are the most recognizable tells of AI-generated UIs. Choose a distinctive, intentional palette.
[See in /impeccable](/docs/impeccable#color-contrast)

Neon on dark
Cyberpunk-by-default slop.

AI slopCLI
Dark mode with glowing accents

Dark backgrounds with colored box-shadow glows are the default "cool" look of AI-generated UIs. Use subtle, purposeful lighting instead, or skip the dark theme entirely.
[See in /impeccable](/docs/impeccable#color-contrast)

Build the Future
Gradient text kills scannability.

AI slopCLI
Gradient text

Gradient text is decorative rather than meaningful. A common AI tell, especially on headings and metrics. Use solid colors for text.
[See in /impeccable](/docs/impeccable#color-contrast)

Gray text on a colored background. Washed out and hard to read.

QualityCLI
Gray text on colored background

Gray text looks washed out on colored backgrounds. Use a darker shade of the background color instead, or white/near-white for contrast.
[See in /impeccable](/docs/impeccable#color-contrast)

The tasteful default
Warm cream surface, reached for by reflex.

AI slopCLI
Cream / beige palette

A warm cream or beige page background has become the default "tasteful" AI surface, reached for by reflex. Choose a background that comes from a deliberate palette, not the safe warm off-white.
[See in /impeccable](/docs/impeccable#color-contrast)

Layout & Space

8 rules

10M+
Active users
99.9% uptime200ms p50

AI slopLLM only
Hero metric layout

Big number, small label, three supporting stats, gradient accent. Used everywhere, trusted nowhere.
[See in /impeccable](/docs/impeccable#layout-space)

Feature
Short copy.

Feature
Short copy.

Feature
Short copy.

Feature
Short copy.

Feature
Short copy.

Feature
Short copy.

AI slopLLM only
Identical card grids

Same-sized cards with icon + heading + text repeated endlessly. The default AI homepage layout.
[See in /impeccable](/docs/impeccable#layout-space)

AI slopCLI
Monotonous spacing

The same spacing value used everywhere. No rhythm, no variation. Use tight groupings for related items and generous separations between sections.
[See in /impeccable](/docs/impeccable#layout-space)

Card inside card inside card.

AI slopCLI
Nested cards

Cards inside cards create visual noise and excessive depth. Flatten the hierarchy: use spacing, typography, and dividers instead of nesting containers.
[See in /impeccable](/docs/impeccable#layout-space)

01About
02Process
03Pricing

AI slopCLI
Numbered section markers (01 / 02 / 03)

Numbered display markers as section labels are the AI editorial scaffold one tier deeper than tracked eyebrow chips. Numbers earn their place only when the section actually is a sequence.
[See in /impeccable](/docs/impeccable#layout-space)

This one line of running text keeps going
well past the comfortable measure of about
seventy-five characters before it ever wraps,
so the eye loses its place on the way back.

QualityBrowser
Line length too long

Text lines wider than ~80 characters are hard to read. The eye loses its place tracking back to the start of the next line. Add a max-width (65ch to 75ch) to text containers.
[See in /impeccable](/docs/impeccable#layout-space)

A long line of text that refuses to wrap and spills past its box

QualityBrowser
Content overflowing its container

Content renders wider than its container, spilling out or forcing a horizontal scrollbar. Let text wrap, constrain widths, or give the region a deliberate scroll affordance.
[See in /impeccable](/docs/impeccable#layout-space)

Menu
Dropdown clipped by the box

QualityBrowser
Positioned child clipped by overflow container

A clipping container (overflow hidden or clip) wrapping an absolutely-positioned child cuts off tooltips, menus, and popovers that need to escape. Let the overflow be visible, or move the positioned layer out of the clip.
[See in /impeccable](/docs/impeccable#layout-space)

Motion

3 rules

Confirm action
A dialog that springs in with overshoot.

AI slopCLI
Bounce or elastic easing

Bounce and elastic easing on interface elements (a dialog that springs in, a card that overshoots) feels dated and tacky. Reserve spring physics for things that are actually physical; ease interface motion out smoothly (ease-out-quart/quint/expo).
[See in /impeccable](/docs/impeccable#motion)

Animating width/height causes layout jank.

QualityCLI
Layout property animation

Animating width, height, padding, or margin causes layout thrash and janky performance. Use transform and opacity instead, or grid-template-rows for height animations.
[See in /impeccable](/docs/impeccable#motion)

Image scales up on hover.

AI slopCLIopt-in
Image hover transform

Scaling or rotating an image on hover is a recurring generated-UI signature. Let imagery sit still, or use a subtler, purposeful interaction.
[See in /impeccable](/docs/impeccable#motion)

Copy

4 rules

It works — really well — for teams — of any size — anywhere.

AI slopCLI
Em-dash overuse

More than a couple of em-dashes in body copy is an AI cadence tell. Use commas, colons, periods, or parentheses instead.
[See in /impeccable](/docs/impeccable#copy)

Supercharge your workflow
World-class, enterprise-grade, next-generation.

AI slopCLI
Marketing buzzword

Generic SaaS phrases (streamline, empower, supercharge, world-class, enterprise-grade) are instant AI tells. Pick a specific verb and noun that says what the product literally does.
[See in /impeccable](/docs/impeccable#copy)

Not a feature.
A platform.

AI slopCLI
Aphoristic-cadence copy

Sections landing on a short rebuttal or a manufactured-contrast aphorism read as AI cadence, not voice. Once is fine; the repeated pattern is the tell.
[See in /impeccable](/docs/impeccable#copy)

We killed the growth theater.
Dismissing things as performative.

AI slopCLIopt-in
Theater framing copy

Dismissing something as "theater" is a recurring generated-copy tic. Say plainly what the thing does or does not do.
[See in /impeccable](/docs/impeccable#copy)

Imagery

1 rule

Empty or missing src ships broken.

QualityCLI
Broken or placeholder image

<img> tags with empty src, missing src, or placeholder values ship as broken-image boxes. Use real images, generated assets, or remove the tag.
[See in /impeccable](/docs/impeccable#imagery)

General quality

8 rules

Buy now2px vertical padding.

QualityBrowser
Cramped padding

Text is too close to the edge of its container. Add at least 8px (ideally 12-16px) of padding inside bordered or colored containers.

Body text running flush against the very edge of the viewport with no container padding to hold it in.

QualityBrowser
Body text touching viewport edge

Body paragraphs render flush against the left or right viewport edge with no container padding. Wrap content in a container with at least 16px of horizontal padding, or apply max-width with mx-auto.

Justified text on screens creates rivers of whitespace because browsers can't hyphenate well. Leave this for print.

QualityCLI
Justified text

Justified text without hyphenation creates uneven word spacing ("rivers of white"). Use text-align: left for body text, or enable hyphens: auto if you must justify.

Light gray text on a white background. 1.6:1 contrast, fails WCAG.

QualityCLI
Low contrast text

Text does not meet WCAG AA contrast requirements (4.5:1 for body, 3:1 for large text). Increase the contrast between text and background.

Page title (h1)

Subsection (h3), skipped h2

QualityCLI
Skipped heading level

Heading levels should not skip (e.g. h1 then h3 with no h2). Screen readers use heading hierarchy for navigation. Skipping levels breaks the document outline.

Tight leading makes multi-line body text feel crammed and hard for the eye to track between lines.

QualityCLI
Tight line height

Line height below 1.3x the font size makes multi-line text hard to read. Use 1.5 to 1.7 for body text so lines have room to breathe.

Regular body text
And then fine print at 9 pixels that no one will ever read.

QualityCLI
Tiny body text

Body text below 12px is hard to read, especially on high-DPI screens. Use at least 14px for body content, 16px is ideal.

Wide tracking on body text slows reading by breaking up natural character groupings.

QualityCLI
Wide letter spacing on body text

Letter spacing above 0.05em on body text disrupts natural character groupings and slows reading. Reserve wide tracking for short uppercase labels only.

Run it yourself

Inside /impeccable critique

[/impeccable critique](/docs/critique)

The design review command opens the overlay automatically during its browser assessment pass. Deterministic findings highlighted in place while the LLM runs its separate heuristic review.

Standalone CLI

[`npx impeccable detect`](/docs/detector)

Runs the deterministic detector from the terminal on files, directories, stdin, or rendered URLs. Use it for CI and local checks without opening an AI harness.

Easiest

Chrome extension

One-click activation on any tab. [Install from Chrome Web Store →](https://chromewebstore.google.com/detail/impeccable/bdkgmiklpdmaojlpflclinlofgjfpabf)

[Impeccable](/)[Changelog](/changelog)[FAQ](/faq)[Privacy](/privacy)[GitHub](https://github.com/pbakaus/impeccable)
Created by [Paul Bakaus](https://x.com/pbakaus)[](https://x.com/pbakaus)[](https://linkedin.com/in/paulbakaus)