# Homepage share preview, 30 October 2026

The live homepage still named an image with the old dark background and coral headline.
The image renderer used its own fixed palette, separate from the website theme.

The homepage preview now uses the current light page colours from `app/globals.css`.
The background is `#f8f2ec`, the headline is `#17171a`, and coral stays on small brand details.
The homepage metadata names `/api/home-card?v=paper-20261030` for Open Graph and X.
The new URL gives crawlers a separate image cache entry after deployment.
The existing counts, copy, fonts, and card dimensions stay the same.

| Live before | Local after |
| --- | --- |
| ![Old dark homepage preview](before.png) | ![Current paper homepage preview](after.png) |

## Evidence

The before image came from `https://pubmaxxing.com/api/home-card` on 30 October 2026.
A homepage request with `User-Agent: Twitterbot/1.0` named that image in both preview fields.
Its first pixel was `[6, 6, 7]`.
The expected paper colour was `[248, 242, 236]`, so the colour check failed.

The after image came from the real `renderHomeOgCard()` renderer, using the committed dataset and bundled fonts.
A separate call to the route's `GET` handler returned status 200 and `image/png`.
Its dimensions were 1200 by 630 pixels.
Its first pixel was `[248, 242, 236]`, so the same colour check passed.
The response retained its existing cache header.

The homepage and crawler tests passed: 30 tests in two files.
The related preview and homepage tests also passed: 347 tests in 24 files.
The repository type check and lint checks for changed files also passed.
The first type check used an incomplete shared dependency directory and failed on missing packages.
An isolated installation from the committed lockfile resolved those errors.

The independent no-mistakes source review inspected all eight changed files and reported no findings.
Its source revision was `30dfab87a58196d74d4e4dfab64558f55f163d77`.
The publication run stopped before push because opening a pull request starts automated builds.
The owner requires explicit approval for builds.
The complete publication gate did not finish.

## Coverage limits

This record checks the generated image and the route handler directly.
It does not prove a production deployment or an X preview refresh.
No build, deployment, merge, or X post was performed.
X controls the cached preview on existing posts.
