# Pubs photo-card layout correction

Base: `00726545c388e331ea908478000f5d293d33c19e`.

## Retained browser evidence

[Phone before correction](phone-before.png) is the original a88 hydrated audit capture at 390 x 844, DPR 3.
The Blackfriar photo extends into its metadata row. The drink shelf covers the photo credit.
The first card has no photo, so a first-card-only assertion misses this defect.

The screenshot was copied without editing or rendering.
Its SHA-256 is `2d5f4eed5f6cb42a05cda716da050012bb439ba299f6fb71228a2711845e77e9`.

## Correction

The grid row, art, and photo share one height: 140px through 640px, and 168px above it.
Photo cards omit the central drink glyph and shelf. Their drink label and photo credit remain.
Cards without photos retain their existing small drink glyph, label, and content height.
Image URLs, transformation settings, provenance, and community uploads are unchanged.

## Validation

The real gallery render test failed before the correction because the photo glyph remained.
After the correction, both focused suites pass: 10 tests, one worker.
The fixture includes companion drinks and verifies the retained non-photo glyph, drink label, credit, and metadata.
Changed TypeScript files pass ESLint and a scoped typecheck with the repository's ambient declarations.

The existing browser spec now selects `.pubsCard:has(.pubsCardPhoto img)` at 390px and 1440px.
It requires a decoded image, checks image/art/body bounds, credit containment, and metadata visibility, and attaches a card screenshot.
These new browser cases have NOT run. No build, browser, simulator, or full gate ran for this candidate.

Root must run the cases against its next built candidate, then inspect both attached screenshots for credit readability.
Use `e2e/mobile-pubs-gallery.spec.ts --project=chromium --workers=1 --grep 'photo card bounds'` with root's approved server configuration.
This source correction is not actual after-proof, native proof, or a new image-byte measurement.
