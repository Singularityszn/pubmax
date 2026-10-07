# Components, map canvas and the design system

Rules whose subject is a rendered surface: the MapLibre canvas, the sheets and chrome, and the launch primitives.

Repo-wide laws and the index of every other area file are in the root [AGENTS.md](../AGENTS.md).

Long-form incident history, measured proof and review finding IDs live under [`docs/rules/`](../docs/rules/). Each line below names one invariant and links to its full rule. Write or change a rule in its detail file, and keep its title line here in step.

## Map canvas and pins

Full rules: [`docs/rules/components-map-canvas-and-pins.md`](../docs/rules/components-map-canvas-and-pins.md).

- [A camera move has an OWNER, and the map a reader is looking at loads first.](../docs/rules/components-map-canvas-and-pins.md#a-camera-move-has-an-owner-and-the-map-a-reader-is-looking-at-loads-first)
- [Nothing moves this camera but the reader, and there is ONE compass.](../docs/rules/components-map-canvas-and-pins.md#nothing-moves-this-camera-but-the-reader-and-there-is-one-compass)
- [Map density is a contract, not a styling choice.](../docs/rules/components-map-canvas-and-pins.md#map-density-is-a-contract-not-a-styling-choice)
- [A god component is decomposed IN PLACE, because the map's own tests read its SOURCE.](../docs/rules/components-map-canvas-and-pins.md#a-god-component-is-decomposed-in-place-because-the-map-s-own-tests-read-its-sour)
- [A pin's COLOUR may be a hint; a pin's FIGURE may not.](../docs/rules/components-map-canvas-and-pins.md#a-pin-s-colour-may-be-a-hint-a-pin-s-figure-may-not)
- [A pin's fill says the price; its EDGE is what makes it findable, and dark mode needs two tones for that.](../docs/rules/components-map-canvas-and-pins.md#a-pin-s-fill-says-the-price-its-edge-is-what-makes-it-findable-and-dark-mode-nee)
- [A CLUSTER IS A PAPER DISC WITH A BAND RING AND THE CHEAPEST PRICE, AND A PRICED PIN IS A PILL FROM STREET ZOOM.](../docs/rules/components-map-canvas-and-pins.md#a-cluster-is-a-paper-disc-with-a-band-ring-and-the-cheapest-price-and-a-priced-p)
- [The live Pint Index arrival must full-load the map.](../docs/rules/components-map-canvas-and-pins.md#the-live-pint-index-arrival-must-full-load-the-map)
- [A MAP THAT NEVER MOUNTS IS THE SHELL'S PROBLEM, AND NOTHING ON /map MAY WAIT FOR IT FOR EVER.](../docs/rules/components-map-canvas-and-pins.md#a-map-that-never-mounts-is-the-shell-s-problem-and-nothing-on-map-may-wait-for-i)

## Sheets, chrome and navigation

Full rules: [`docs/rules/components-sheets-chrome-and-navigation.md`](../docs/rules/components-sheets-chrome-and-navigation.md).

- [No surface is a dead end, and the way out is one pattern.](../docs/rules/components-sheets-chrome-and-navigation.md#no-surface-is-a-dead-end-and-the-way-out-is-one-pattern)
- [A MAP CONTROL BESIDE THE VENUE DRAWER IS AN EXEMPT SURFACE, NEVER A HOLE IN THE TRAP.](../docs/rules/components-sheets-chrome-and-navigation.md#a-map-control-beside-the-venue-drawer-is-an-exempt-surface-never-a-hole-in-the-t)
- [A LANDMARK STORY LIVES IN THE FRAME EACH WIDTH ALREADY OWNS, and the canvas only reports the tap.](../docs/rules/components-sheets-chrome-and-navigation.md#a-landmark-story-lives-in-the-frame-each-width-already-owns-and-the-canvas-only-)
- [A SHEET SAYS HOW MUCH OF ITSELF IS OFF SCREEN, ONCE, AND THE SHELL CANNOT BE SCROLLED.](../docs/rules/components-sheets-chrome-and-navigation.md#a-sheet-says-how-much-of-itself-is-off-screen-once-and-the-shell-cannot-be-scrol)
- [THE VENUE TYPES ARE ONE CONTROL AT EVERY WIDTH, AND THE COUNT RIDES THE CLOSED ONE.](../docs/rules/components-sheets-chrome-and-navigation.md#the-venue-types-are-one-control-at-every-width-and-the-count-rides-the-closed-on)
- [THE ARRIVAL ASK IS A STRIP, THE MAP UNDER IT IS LIVE, AND THE CHROME BEHIND IT IS EIGHT CONTROLS.](../docs/rules/components-sheets-chrome-and-navigation.md#the-arrival-ask-is-a-strip-the-map-under-it-is-live-and-the-chrome-behind-it-is-)
- [THE MAP ARRIVES WITH ONE SLIGHT TURN, AND THEN HOLDS STILL.](../docs/rules/components-sheets-chrome-and-navigation.md#the-map-arrives-with-one-slight-turn-and-then-holds-still)
- [Phone chrome is measured, not eyeballed, and a trust caption never ellipses.](../docs/rules/components-sheets-chrome-and-navigation.md#phone-chrome-is-measured-not-eyeballed-and-a-trust-caption-never-ellipses)

## Venue, plan and message surfaces

Full rules: [`docs/rules/components-venue-plan-and-message-surfaces.md`](../docs/rules/components-venue-plan-and-message-surfaces.md).

- [Arrival is the moment of togetherness, never an admin form.](../docs/rules/components-venue-plan-and-message-surfaces.md#arrival-is-the-moment-of-togetherness-never-an-admin-form)
- [THE OVERVIEW HAS ONE PRICE DOOR PER TRUST STATE, AND THE COMPOSER IS FOLDED BEHIND IT.](../docs/rules/components-venue-plan-and-message-surfaces.md#the-overview-has-one-price-door-per-trust-state-and-the-composer-is-folded-behin)
- [THE BILL IS ASKED FOR IN FRONT OF THE PRICE, NEVER INSIDE THE DISCLOSURE.](../docs/rules/components-venue-plan-and-message-surfaces.md#the-bill-is-asked-for-in-front-of-the-price-never-inside-the-disclosure)
- [`/plan` opens on one describe-first question, not the wizard.](../docs/rules/components-venue-plan-and-message-surfaces.md#plan-opens-on-one-describe-first-question-not-the-wizard)
- [A describe chip is a promise of a route, and the promise is made through the DESCRIBE-FIRST body.](../docs/rules/components-venue-plan-and-message-surfaces.md#a-describe-chip-is-a-promise-of-a-route-and-the-promise-is-made-through-the-desc)
- [A PLAN READ FOLLOWS THE CAPABILITY, AND THE INVITE TOKEN IS ONE LIVE VALUE.](../docs/rules/components-venue-plan-and-message-surfaces.md#a-plan-read-follows-the-capability-and-the-invite-token-is-one-live-value)
- [A message bubble's WIDTH is the row's business, and a message photo is the one owned image that is not public.](../docs/rules/components-venue-plan-and-message-surfaces.md#a-message-bubble-s-width-is-the-row-s-business-and-a-message-photo-is-the-one-ow)
- [A THREAD READS LIKE A CONVERSATION, AND ITS COMPOSER IS PINNED OVER THE FOOT OF THE PAGE.](../docs/rules/components-venue-plan-and-message-surfaces.md#a-thread-reads-like-a-conversation-and-its-composer-is-pinned-over-the-foot-of-t)

## Design system and launch primitives

Full rules: [`docs/rules/components-design-system-and-launch-primitives.md`](../docs/rules/components-design-system-and-launch-primitives.md).

- [Every Pub Pal is a rendered master, and the family is the Circuit Robin.](../docs/rules/components-design-system-and-launch-primitives.md#every-pub-pal-is-a-rendered-master-and-the-family-is-the-circuit-robin)
- [THE FRONT DOOR SHOWS LONDON, THEN ANSWERS IN ONE TAP.](../docs/rules/components-design-system-and-launch-primitives.md#the-front-door-shows-london-then-answers-in-one-tap)
- [A launch screen is built from the launch tokens and the four primitives, and template patterns are fenced.](../docs/rules/components-design-system-and-launch-primitives.md#a-launch-screen-is-built-from-the-launch-tokens-and-the-four-primitives-and-temp)
- [CORAL IS A FILL AND CORAL IS A WORD, AND THOSE ARE TWO TOKENS.](../docs/rules/components-design-system-and-launch-primitives.md#coral-is-a-fill-and-coral-is-a-word-and-those-are-two-tokens)
- [A TEXT BUTTON IS ONE ROW OF TOKENS, and the tablet bar is measured, not assumed.](../docs/rules/components-design-system-and-launch-primitives.md#a-text-button-is-one-row-of-tokens-and-the-tablet-bar-is-measured-not-assumed)
- [THE PRODUCT ANSWERS FIRST, AND THE CONSENT CARD ARRIVES AFTER THE ANSWER, DOCKED.](../docs/rules/components-design-system-and-launch-primitives.md#the-product-answers-first-and-the-consent-card-arrives-after-the-answer-docked)
- [A CHIP READS THE SAME ROW, AND A NUMBER SQUARE IS ONE FAMILY.](../docs/rules/components-design-system-and-launch-primitives.md#a-chip-reads-the-same-row-and-a-number-square-is-one-family)
- [NEXT/IMAGE DROPS A `srcSet` PROP, AND A PROXIED PHOTO IS RESIZED THROUGH ITS LOADER.](../docs/rules/components-design-system-and-launch-primitives.md#next-image-drops-a-srcset-prop-and-a-proxied-photo-is-resized-through-its-loader)
- [EVERY FIRST-RUN QUESTION GIVES ITS REASON, AND ONLY THE ONES THE JOURNEY USES.](../docs/rules/components-design-system-and-launch-primitives.md#every-first-run-question-gives-its-reason-and-only-the-ones-the-journey-uses)
