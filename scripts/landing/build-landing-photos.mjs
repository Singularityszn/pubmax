#!/usr/bin/env node
// Curate the landing photographs of London.
//
// Captain 6 Sep 2026: "I want the landing pages to show the pictures of
// London." This script is the ONE way a photograph joins that set, and it is
// run BY HAND rather than by a build: a picture of a place is a curation
// decision, and a job that re-fetched one could silently swap the photograph
// under a caption that names its author.
//
// WHY WIKIMEDIA COMMONS, AND WHY NOT THE PHOTOS WE ALREADY HOLD.
// The pint dataset carries an `image_url` for 1,928 of its rows, and every
// lane of that supply is refused here:
//   - images.app.goo.gl / search.app.goo.gl (891 rows) are already blocked in
//     lib/venueImages.ts: they are share redirects, not images.
//   - lh3/lh5.googleusercontent.com and gstatic (418 rows) are Google Places
//     photographs.
//     The Google Maps Platform terms require the attribution Places returns
//     with the photo and forbid caching or re-hosting it, so re-encoding one
//     into this repository and printing our own credit under it is exactly
//     what they refuse. Refused on licence, not on quality.
//   - the chain CDNs (Greene King, JD Wetherspoon, ~430 rows) are the
//     operator's own marketing photograph. They stay where they already are,
//     hotlinked through /api/image-proxy on the venue sheet, and are not
//     copied here: nobody granted us a licence to re-host and re-encode them,
//     and a landing is a page we publish rather than a pub's own page.
// So a landing photograph is an openly licensed file (CC BY, CC BY-SA, CC0 or
// public domain) with a named author, re-encoded and committed, and every one
// of them is credited on the page it appears on.
//
// Usage: node scripts/landing/build-landing-photos.mjs [--only <id>]
// Writes public/landing/london/<id>-{640,1280}.{avif,webp}, rewrites
// public/landing/london/ATTRIBUTION.md, and prints the manifest entries to
// paste into lib/landingImagery.ts.

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import sharp from "sharp";

const UA =
  "PubmaxxLandingImagery/1.0 (https://pubmaxxing.com; contact via https://pubmaxxing.com/about)";
const API = "https://commons.wikimedia.org/w/api.php";
const OUT_DIR = path.join(process.cwd(), "public", "landing", "london");
const WIDTHS = [640, 1280];
const ASPECT = 16 / 9;

// The set. `id` is the file stem and the manifest key; `place` is what the
// photograph SHOWS, printed under it, so a fallback can never read as a claim
// about the pub the page is about.
const PHOTOS = [
  {
    id: "the-black-friar",
    file: "The Black Friar Pub, London (8484501967).jpg",
    place: "The Black Friar, Blackfriars",
    alt: "Inside The Black Friar, the Art Nouveau pub at Blackfriars in the City of London",
  },
  {
    id: "city-of-london",
    file: "City of London, seen from Tower Bridge.jpg",
    place: "The City of London",
    alt: "The City of London skyline seen from Tower Bridge, with the Tower of London on the north bank",
  },
  {
    id: "piccadilly-circus",
    file: "Piccadilly Circus at night, London, 2015.jpg",
    place: "Piccadilly Circus",
    alt: "The lit signs at Piccadilly Circus in London's West End at night",
  },
  {
    id: "camden-lock",
    file: "London , Camden - Camden Lock Place - geograph.org.uk - 2047254.jpg",
    place: "Camden Lock",
    alt: "Market stalls and the Camden Lock sign on Camden Lock Place in north London",
  },
  {
    id: "borough-market",
    file: "Borough Market (4701274756).jpg",
    place: "Borough Market, Southwark",
    alt: "Shoppers under the iron roof of Borough Market in Southwark, south London",
  },
  {
    id: "brick-lane",
    file: "Brick Lane, Shoreditch - geograph.org.uk - 4341044.jpg",
    place: "Brick Lane, Shoreditch",
    alt: "The corner of Brick Lane in Shoreditch, east London, with people on the pavement",
  },
  {
    id: "greenwich-cutty-sark",
    file: "Cutty Sark public house, Greenwich - geograph.org.uk - 2021038.jpg",
    place: "The Cutty Sark, Greenwich",
    alt: "The Cutty Sark public house on the riverside at Greenwich in south-east London",
  },
  {
    id: "brixton",
    file: "At Brixton, London 2025 002.jpg",
    place: "Brixton",
    alt: "Market stalls under the railway bridge on Brixton Station Road in south London",
  },
  {
    id: "angel-islington",
    file: "Old Red Lion, Angel, London. (2011).jpg",
    place: "The Old Red Lion, Angel",
    alt: "The red frontage of the Old Red Lion pub at Angel in Islington, north London",
  },
];

function clean(html) {
  return String(html ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function imageInfo(titles) {
  const url = `${API}?${new URLSearchParams({
    format: "json",
    formatversion: "2",
    action: "query",
    titles: titles.map((t) => `File:${t}`).join("|"),
    prop: "imageinfo",
    iiprop: "url|size|extmetadata|mime",
    iiurlwidth: "2000",
  })}`;
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Commons imageinfo ${res.status}`);
  const body = await res.json();
  const out = new Map();
  for (const page of body.query?.pages ?? []) {
    const info = page.imageinfo?.[0];
    if (!info) continue;
    out.set(page.title.replace(/^File:/, ""), info);
  }
  return out;
}

// Only these licences may reach a landing. Anything else is refused rather
// than downgraded to "credit and hope".
const ALLOWED_LICENCE = /^(CC BY(-SA)? [0-9.]+|CC0|Public domain|PDM)/i;

async function main() {
  const only = process.argv.includes("--only")
    ? process.argv[process.argv.indexOf("--only") + 1]
    : null;
  const wanted = only ? PHOTOS.filter((p) => p.id === only) : PHOTOS;
  if (wanted.length === 0) throw new Error(`No photo with id ${only}`);

  await mkdir(OUT_DIR, { recursive: true });
  const info = await imageInfo(wanted.map((p) => p.file));
  const manifest = [];

  for (const photo of wanted) {
    const found = info.get(photo.file);
    if (!found) throw new Error(`Commons has no file named ${photo.file}`);
    const meta = found.extmetadata ?? {};
    const licence = clean(meta.LicenseShortName?.value);
    if (!ALLOWED_LICENCE.test(licence)) {
      throw new Error(`${photo.id}: licence "${licence}" is not one a landing may print`);
    }
    const author = clean(meta.Artist?.value) || "Unknown photographer";
    const licenceUrl = clean(meta.LicenseUrl?.value);
    const sourceUrl = found.descriptionurl;

    const source = found.thumburl ?? found.url;
    const bytes = Buffer.from(
      await (await fetch(source, { headers: { "User-Agent": UA } })).arrayBuffer(),
    );

    for (const width of WIDTHS) {
      const height = Math.round(width / ASPECT);
      const pipeline = sharp(bytes).resize(width, height, {
        fit: "cover",
        position: sharp.strategy.attention,
      });
      await pipeline
        .clone()
        .avif({ quality: 52, effort: 6 })
        .toFile(path.join(OUT_DIR, `${photo.id}-${width}.avif`));
      await pipeline
        .clone()
        .webp({ quality: 72 })
        .toFile(path.join(OUT_DIR, `${photo.id}-${width}.webp`));
    }

    // The placeholder is inline in the document, so it paints with the HTML
    // and the card never opens as a hole. 24px wide keeps it a few hundred
    // bytes; anything larger is a second image nobody asked for.
    const blur = await sharp(bytes)
      .resize(24, Math.round(24 / ASPECT), { fit: "cover", position: sharp.strategy.attention })
      .webp({ quality: 40 })
      .toBuffer();

    manifest.push({
      id: photo.id,
      place: photo.place,
      alt: photo.alt,
      width: WIDTHS[WIDTHS.length - 1],
      height: Math.round(WIDTHS[WIDTHS.length - 1] / ASPECT),
      blurDataUrl: `data:image/webp;base64,${blur.toString("base64")}`,
      credit: { author, licence, licenceUrl, sourceUrl },
    });
    console.error(`ok ${photo.id}: ${licence}, ${author} (blur ${blur.length}B)`);
  }

  const rows = manifest
    .map(
      (m) =>
        `| \`${m.id}\` | ${m.place} | ${m.credit.author} | ${m.credit.licence} | [Commons](${m.credit.sourceUrl}) |`,
    )
    .join("\n");
  await writeFile(
    path.join(OUT_DIR, "ATTRIBUTION.md"),
    `# Landing photographs of London

Every file here is an openly licensed photograph, re-encoded by
\`scripts/landing/build-landing-photos.mjs\` and committed. The same rows are
carried in code by \`lib/landingImagery.ts\`, which is what the page prints its
credit from; this file is the human record beside the bytes.

A file name carries its width, and these files are served with an immutable
cache header (\`__tests__/publicAssetCaching.test.ts\`). Replace a photograph
under a NEW id rather than overwriting one of these names.

Google Places photographs and the chains' own marketing images are deliberately
absent. The script header says why.

| id | Shows | Photographer | Licence | Source |
| --- | --- | --- | --- | --- |
${rows}
`,
    "utf8",
  );

  process.stdout.write(`${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exitCode = 1;
});
