# Pub Pal venue card opens the map sheet

Slice C proof: a Pal venue recommendation lands on `/map?sel=<id>` and opens the venue sheet (including reveal choreography from PR 1213).

## Capture

```bash
PAL_OPENVENUE_SHOTS_DIR=docs/proof/pal-openvenue npm run test:e2e -- e2e/pal-openvenue.spec.ts
```

Viewport: 390×844, dark theme, reduced motion (matches `e2e/pal-openvenue.spec.ts`).

## Expected

1. Ask on `/pal/chat` (for example: "Quiet-ish near Bank, not pricey").
2. Tap the venue card (`Show on map`).
3. Browser lands on `/map?sel=<venueId>` with the venue inspector mounted.

## Unmatched fallback

When the slim index has answered and the card's id is not listed, Pal opens `/map` without `?sel=` and the map-owned notice prints `That pub is not one we know.` (`role="status"`). Covered in `__tests__/palOpenVenue.test.ts` and `__tests__/palChatOpenVenue.test.ts`.
