// Build public/data/fsa_hygiene/london.json from the FSA's open FHRS API.
//
// Source: https://api.ratings.food.gov.uk (keyless; every request sends
// `x-api-version: 2`, the header lib/foodHygiene.ts already sends). Licence:
// Open Government Licence v3.0, attribution in the pack and on /credits. Every
// read goes through `fsaGetJson` (scripts/lib/fsaHygienePack.mjs): the host
// comes from the `fsa-fhrs-api` row in lib/harvest/sourceRegistry.ts, a redirect
// is refused, pages are the FSA's own 200-row ceiling, and a 429 or 5xx is
// retried a bounded number of times.
//
// What it does:
//   1. Reads the FHRSIDs public/data/osm_fhrs/london.json names.
//   2. Reads every London local authority's establishments, one authority at a
//      time and one second apart (--delay-ms; the FSA's best-practice note asks
//      for flow control with a configurable rate, because its throttling limits
//      change), then any named id still missing (a pub inside
//      the London box filed by a neighbouring authority) one id at a time.
//   3. Keeps only those FHRSIDs and writes the compact pack (rules in
//      scripts/lib/fsaHygienePack.mjs). A read that fails stops the run and
//      writes nothing, so a partial read never ships as a thin pack.
//
// Run: node scripts/build_fsa_hygiene_pack.mjs [--dry-run] [--max-single 600] [--delay-ms 1000]

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { buildFsaHygienePack, FSA_PAGE_SIZE, fsaGetJson, wantedFhrsIds } from "./lib/fsaHygienePack.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LINKS_PATH = path.join(ROOT, "public", "data", "osm_fhrs", "london.json");
const OUT_PATH = path.join(ROOT, "public", "data", "fsa_hygiene", "london.json");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  return index > -1 ? process.argv[index + 1] : fallback;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function getJson(pathAndQuery) {
  const body = await fsaGetJson(pathAndQuery, { sleep });
  if (body === null) throw new Error(`FSA 404 for ${pathAndQuery}`);
  return body;
}

async function main() {
  const maxSingle = Number(argValue("--max-single", "600"));
  const delayMs = Number(argValue("--delay-ms", "1000"));
  if (!Number.isFinite(delayMs) || delayMs < 1000) throw new Error("--delay-ms must be 1000 or more");
  const links = JSON.parse(await readFile(LINKS_PATH, "utf8"));
  const wanted = wantedFhrsIds(links);
  const retrievedAt = new Date().toISOString();

  const { authorities = [] } = await getJson("/Authorities");
  const london = authorities.filter((authority) => authority?.RegionName === "London");
  if (london.length < 30) throw new Error(`Expected the 33 London authorities, the FSA listed ${london.length}`);

  const establishments = [];
  for (const authority of london) {
    for (let page = 1; ; page += 1) {
      await sleep(delayMs);
      const body = await getJson(
        `/Establishments?localAuthorityId=${encodeURIComponent(authority.LocalAuthorityId)}&pageSize=${FSA_PAGE_SIZE}&pageNumber=${page}`,
      );
      establishments.push(...(body.establishments ?? []));
      if (page >= (body.meta?.totalPages ?? 1)) break;
    }
    console.log(`${authority.Name}: ${establishments.length} establishments read so far`);
  }

  const read = new Set(establishments.map((establishment) => establishment?.FHRSID));
  const missing = [...wanted].filter((id) => !read.has(id)).slice(0, maxSingle);
  for (const id of missing) {
    await sleep(delayMs);
    const body = await fsaGetJson(`/Establishments/${id}`, { sleep });
    // A withdrawn establishment answers 404: the FSA states nothing about it.
    if (body !== null) establishments.push(body);
  }

  const pack = buildFsaHygienePack({ wanted, establishments, retrievedAt });
  console.log(JSON.stringify(pack.counts));
  if (process.argv.includes("--dry-run")) return;
  await writeFile(OUT_PATH, `${JSON.stringify(pack, null, 1)}\n`);
  console.log(`Wrote ${path.relative(ROOT, OUT_PATH)} (${pack.counts.kept} ratings)`);
}

await main();
