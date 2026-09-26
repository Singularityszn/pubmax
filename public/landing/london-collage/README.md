# Founder London collage

Photographs the captain took of London, shown below the landing hero. The one
photo list is `LONDON_COLLAGE_PHOTOS` in `lib/landingLondonCollage.ts`: the
landing renders it and `scripts/landing/build-london-collage.mjs` encodes it.
Originals never enter the repo; the encoder strips all metadata.

## Add a photograph

1. Put the original JPEG in the encoder's default source folder, or in any
   folder you pass with `--source-dir <dir>`.
2. Add a row to `LONDON_COLLAGE_PHOTOS` with its `id`, `source` file name,
   `caption`, `alt` and `layout`. Give `width`, `height` and `blurDataUrl`
   placeholder values for now.
3. Re-run the encoder from the repo root:

   ```sh
   node scripts/landing/build-london-collage.mjs
   ```

4. Paste the printed `width`, `height` and `blurDataUrl` for each photo into its
   row, then run `npx vitest run __tests__/landingLondonCollage.test.ts` to
   check the files and dimensions.
