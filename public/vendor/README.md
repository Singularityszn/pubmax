# public/vendor

Third-party browser assets we serve from our own origin.

`vendor` is one of `STATIC_ASSET_PREFIXES` (`lib/staticAssetPrefixes.mjs`), so the
proxy never runs in front of these bytes and the CDN answers them directly.

## maplibre/

`maplibre/` is GENERATED and gitignored. `npm run prepare:maplibre-worker`
(`scripts/copy_maplibre_worker.mjs`) copies `maplibre-gl-worker.mjs` and
`maplibre-gl-shared.mjs` out of `node_modules/maplibre-gl/dist`. `predev` and
`prebuild` both run it, so an ordinary `npm run dev` or `npm run build` fills it in.

This README is TRACKED on purpose. Without it the directory exists only after a
build has run, and `__tests__/staticAssetPrefixes.test.ts` fails on a clean clone
that has only run `npm test`. The fence asks a real question, so the answer is to
make the directory real rather than to soften the question.
