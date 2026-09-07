# Pubs card image budget

Issue #1616, measured 7 September 2026. Scope: the first five photographs on `/pubs`.
Base: `6a759e0ac191d99f10c5e658bc8f2c3a6d3dd419`.
Production deployment: `dpl_88fiZ7i4Cgdfrmu5u1wjnRYCnzYq`.

## Result

The fixed card preset serves 74,770 bytes, below the 80,000-byte acceptance ceiling.
This saves 70% against the measured Retina desktop and phone responses.
The preset uses 384 pixels, WebP quality 45, and no crop.
Other image surfaces keep their current derivatives. Community URLs remain unchanged.
The proxy retains its host allowlist, redirect checks, byte cap, rate limit, and original-byte fallback.

| Photograph | Before, bytes | After, bytes | Decoded output |
| --- | ---: | ---: | --- |
| The Blackfriar | 63,522 | 20,300 | 384x257 |
| The Clarence | 50,202 | 13,610 | 384x247 |
| The Coal Hole | 54,514 | 16,266 | 384x256 |
| The Dog & Duck | 23,104 | 7,118 | 384x150 |
| The Elephant & Castle (Kensington) | 58,160 | 17,476 | 384x256 |
| Total | 249,502 | 74,770 | |

## Measurement boundary

Production Chromium selected all five `w=640` URLs at desktop 1440x900, DPR 2, and phone 390x844, DPR 3.
Desktop DPR 1 selected `w=384`, totalling 100,528 bytes.
All selected responses returned HTTP 200 and decoded as photographs. Production reported no page errors.
Response bodies, rather than `naturalWidth`, establish the byte counts and decoded pixel dimensions.

After measurements used controlled browser replay, without a full Next build or client hydration.
The replay used production HTML and CSS, actual patched `VenueImage` server rendering, and the actual proxy `GET` handler.
Only upstream image fetches used retained original production bodies. The committed host allowlist remained active.
Both profiles selected five `variant=card` responses, each without `srcset`, totalling 74,770 bytes.
Desktop boxes remained 262.5x168. Phone boxes remained 344x168.

Side-by-side browser screenshots preserve composition, visible signs, labels, and card geometry.
Fine brickwork and foliage become softer. The decorative backgrounds remain suitable under the existing wash and glyphs.
These results apply to the measured five source images. Changed upstream photos require another budget check.
A transform failure still serves original bytes and can exceed the budget.

## Candidate selection

| Width and crop | WebP quality | Five images, bytes |
| --- | ---: | ---: |
| 384, uncropped | 72 | 100,528 |
| 384, uncropped | 60 | 88,532 |
| 384, uncropped | 50 | 79,254 |
| 384, uncropped | 45 | 74,770 |
| 384x216, cropped | 50 | 73,602 |
| 320x200, cropped | 60 | 64,588 |
| 480x270, cropped | 50 | 109,220 |

Quality 50 left only 746 bytes of margin. Quality 45 adds margin without changing composition.
A fixed preset avoids inaccurate responsive width descriptors and arbitrary transform parameters.

## Checks and evidence

Five focused suites passed: 55 tests. Focused ESLint passed with no warnings.
The suites cover real Next Image markup, gallery selection, community URLs, compression, dimensions, fallback, and host policy.
Existing installed dependencies were reused: Next 16.3.4, Sharp 0.35.4, libwebp 1.6.0, Vitest 4.1.11.
No package or lockfile changes were made. Full verify, Next build, and hydration validation remain with the parent.

Command:

```sh
node node_modules/vitest/vitest.mjs run __tests__/imageProxy.test.ts __tests__/venueImages.test.ts __tests__/venueImageCard.test.tsx __tests__/venueImageHosts.test.ts __tests__/pubsGallery.test.ts --maxWorkers=1
```

Portable review evidence:

- [Phone comparison](pubs-image-budget/phone-browser-comparison.png): unchanged before/after browser screenshots.
- [Browser measurements](pubs-image-budget/browser-patch.json): selected URLs, HTTP statuses, bytes, boxes, and decoded dimensions.

The copied files contain public venue images and measurements. No private account data required redaction.

Additional local evidence directory: `/Users/karanmanoharan/Documents/projects/pubmaxx-pubs-images-evidence`.

- `production.json`, `production-retina.json`: actual selected production URLs, response headers, bytes, and viewport dimensions.
- `candidates.json`: candidate transforms and original image metadata.
- `desktop-browser-comparison.png`: paired desktop browser screenshots.
- `candidate-contact-sheet.png`: uncropped and cropped alternatives at card size.
- `measure-production.cjs`, `measure-retina.cjs`, `compare.cjs`, `browser-patch.cjs`: reproduction scripts.
- `focused-tests.log`, `focused-lint.log`: focused check output.
