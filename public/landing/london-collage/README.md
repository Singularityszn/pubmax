# Founder London collage

This collection contains the captain's London photographs. `LONDON_COLLAGE_PHOTOS`
in `lib/landingLondonCollage.ts` owns the collection, and
`scripts/landing/build-london-collage.mjs` encodes it.
The [homepage display contract](../../../docs/rules/components-design-system-and-launch-primitives.md#the-front-door-shows-london-then-answers-in-one-tap)
owns the selected photographs and their layout.
Originals never enter the repo. The encoder strips all metadata.

## Add a photograph

1. Put the original JPEG in the encoder's default source folder, or in any
   folder you pass with `--source-dir <dir>`.
2. Add a row to `LONDON_COLLAGE_PHOTOS` with its `id`, `source` file name,
   `caption`, `alt` and `layout`. Give `width`, `height` and `blurDataUrl`
   placeholder values for now. When a street scene shows legible number plates
   or other identifying detail, add optional `privacyBlurRects`: each entry is
   `[left, top, width, height]` as fractions of the oriented source (0–1). The
   encoder blurs those regions before it writes AVIF/WebP.
3. Re-run the encoder from the repo root:

   ```sh
   node scripts/landing/build-london-collage.mjs
   ```

4. Paste the printed `width`, `height` and `blurDataUrl` for each photo into its
   row, then run `npx vitest run __tests__/landingLondonCollage.test.ts` to
   check the files and dimensions.
