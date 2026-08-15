# CheapestPint attachment audit

**Audit date:** 14 August 2026  
**Method:** Local, read-only inspection. No network request or website crawl was run.  
**Scope:** Five supplied files in `/Users/karanmanoharan/Downloads/`.

## Executive finding

All five supplied files are intact and internally consistent as a delivery set. The ZIP and Git bundle contain the same 42 tracked files. The standalone DOCX and PDF are byte-identical to the copies inside both archives.

The delivery does not contain a complete CheapestPint capture. It contains a generated research workspace, a reconstructed conversation, summaries, scripts, and 25 derived Pint Price rows. Its `evidence/raw/` directory is empty. It contains no HAR, HTML response, JavaScript bundle, API response, screenshot, robots capture, terms capture, sitemap, user record, user comment, contributor identity, or native mobile application artifact.

Most important correction: the `1,175` figure in the attachments is labelled **price observations**, not users. The same derived snapshot reports `706` pubs. Nothing in the attachments establishes that CheapestPint has 1,000 users.

## Evidence labels

- **VERIFIED FILE FACT** - proved directly from supplied file bytes or archive structure.
- **EMBEDDED CLAIM** - stated in supplied research, but its cited web source is not preserved in the delivery.
- **INFERENCE** - conclusion from supplied material.
- **ABSENT** - requested evidence is not present in supplied material.

## Attachment integrity

The supplied checksum file, `pubmaxxing-cheapestpint-deliverables.sha256`, validates all four deliverables that it names.

| Attachment | Bytes | SHA-256 | Result |
|---|---:|---|---|
| `pubmaxxing_cheapestpint_conversation_dossier.pdf` | 486,984 | `00bf8580da6cfa4a6480408eef96bc0cc74b1374ae7f6db79d9cc63405d935b0` | Pass |
| `pubmaxxing_cheapestpint_conversation_dossier.docx` | 66,249 | `47f48abdf12eb15f607d8ecceee2f0081ad2d8bb2b907414645d9dba7dcdbd33` | Pass |
| `pubmaxxing-cheapestpint-research.zip` | 356,217 | `410803cb8bedbe0783caa9616cf78ad4b3d3b4bb7db85bf0631de58fff97dba2` | Pass |
| `pubmaxxing-cheapestpint-research.bundle` | 347,742 | `e6a8b9958cbe77ac1e832d52ddb3521d99e811df82909f5c4c2ff28951519e4c` | Pass |

The ZIP has 55 entries: 42 files and 13 directories. It has no path-traversal entries or symbolic links. Its 42 files match the Git bundle checkout by relative path and SHA-256.

## DOCX and PDF

**VERIFIED FILE FACT:** The PDF is a searchable, unencrypted, 28-page A4 document. It has no embedded JavaScript. PDF metadata says LibreOffice 25.2.3.2 produced it on 13 August 2026. The first and last pages rendered correctly in visual inspection.

**VERIFIED FILE FACT:** Full-text extraction from DOCX and PDF produced the same substantive dossier. Normalised word comparison matched 6,487 of 6,622 DOCX tokens. Remaining differences are consistent with table extraction order, PDF page headers, footers, line wrapping, and split hyperlinks. No contrary conclusion or separate evidence set was found in either format.

The dossier contains:

- current claim assessment;
- working chronology;
- technical and product summary;
- reconstructed user-visible conversation;
- Git workspace instructions;
- source registry and legal framing.

The standalone documents are exact copies of `docs/pubmaxxing_cheapestpint_conversation_dossier.docx` and `.pdf` inside the archives. They are duplicate representations, not independent corroboration.

## ZIP and Git bundle

**VERIFIED FILE FACT:** `git bundle verify` reports a complete SHA-1 Git history. The bundle has:

- branch `main` at `58a0c7e37e2357a4db999edfd0261522e1cdf70d`;
- annotated tag `v0.1-evidence-dossier` at tag object `758918633927cd45c34bec06eb5ca47522699578`;
- three commits created between `2026-08-13T11:01:18Z` and `2026-08-13T11:09:18Z`;
- author and committer `OpenAI Research Assistant <noreply@openai.com>` for all three commits.

Commit sequence:

1. `1093086` - initial research workspace;
2. `87c0562` - DOCX and PDF dossier;
3. `58a0c7e` - private GitHub publishing instructions.

This history proves when this generated research package was assembled. It does not prove when CheapestPint or PUBMAXX was created, deployed, or first shown to either party.

`evidence/manifests/release_artifact_manifest.csv` validates all 41 other files and intentionally omits itself. `evidence/manifests/initial_repository_manifest.csv` reflects the first commit, so its README hash no longer matches the final README and it does not list later dossier or publishing files. This is expected history, but the initial manifest is not a current-tree manifest.

## Existing data

### Pint Price rows

The only row-level competitor data is:

- ZIP or bundle: `data/cheapestpint_public_price_extract.csv`;
- equivalent JSON: `data/cheapestpint_research_data.json` under `prices`;
- equivalent workbook: `data/cheapestpint_competitive_teardown.xlsx`, sheet `Extracted Prices`.

The CSV and JSON match exactly for all 25 rows. All 25 row keys are unique.

| City | Rows |
|---|---:|
| London | 10 |
| Manchester | 6 |
| Glasgow | 4 |
| Liverpool | 3 |
| Bristol | 2 |
| **Total** | **25** |

Price range is £1.69 to £6.90. Each row has city, rank, Venue name, price, source type, source URL, and optional analyst note. Every `beer_or_brand` value is blank. Rows do not contain observation date, contributor, user identity, evidence, address, coordinates, verification state, or freshness state.

The workbook has eight sheets: `Dashboard`, `Extracted Prices`, `City Summary`, `Brand Summary`, `Architecture`, `Data Quality`, `Pubmaxxing Actions`, and `Extraction Log`. It is a formatted view of the same derived research, not an additional raw dataset.

### Derived aggregate claims

`data/cheapestpint_research_data.json` records these **EMBEDDED CLAIMS** for a 13 August 2026 snapshot:

- 1,175 price observations;
- 706 pubs;
- UK average £5.27 and median £5.55;
- reported range £1.65 to £12.00;
- 514 London observations;
- eight surfaced brand aggregates and 24 brand-route names.

These numbers cite public pages, but the pages or responses are not included. They are not independently reproducible from the 25 supplied rows.

### Recorded quality findings

The derived material flags:

- national and city average differences for London, Manchester, Liverpool, and Bristol;
- an Edinburgh hotel in a Glasgow ranking;
- ambiguous Venue names such as `Wetherspoons`, `Sandfield`, and `Wetherspoons mare st`;
- a possible duplicate `The Half Moon`;
- city pages with only two to six surfaced rows;
- a crawler zero state that conflicts with reported national totals;
- `1,000+ pubs` marketing copy that conflicts with a `706 pubs` national statistic;
- city rows that omit beer, date, evidence, and verification state.

These are useful investigation leads. They remain **EMBEDDED CLAIMS** until backed by preserved page captures.

## User, comment, and mobile evidence

- **ABSENT:** user count.
- **ABSENT:** user profiles, handles, account IDs, emails, or device identifiers.
- **ABSENT:** user comments or review text.
- **ABSENT:** contributor attribution for any Pint Price.
- **ABSENT:** complete 1,175-observation payload.
- **ABSENT:** iOS or Android binary, source project, App Store listing capture, TestFlight record, package identifier, or mobile framework evidence.
- **EMBEDDED CLAIM:** the homepage advertised iOS and Android beta access.

An advertised beta is not proof of a published native iOS application. The attachments state that mobile implementation is unknown.

## Scripts supplied

The archive contains working syntax-level scaffolding:

- `scripts/crawl_public.py` - same-origin anchor crawl with `robots.txt`, one request at a time, 1.5-second default delay, 250-page target cap, and stop on 403 or 429;
- `scripts/capture_sites.mjs` - Playwright homepage, HAR, DOM, storage, response, and stack-hint capture;
- `scripts/legacy_cheapestpint_browser_capture.mjs` - Playwright capture across eight named public routes and heuristic JSON price discovery;
- `scripts/extract_price_candidates.py` - heuristic price-object extraction from saved JSON;
- `scripts/compare_sites.py` - basic vocabulary, sequence, and five-word overlap screen;
- `scripts/wayback_inventory.py` - Internet Archive CDX inventory;
- `scripts/rdap_snapshot.py` - `.uk` and `.com` RDAP snapshots;
- `scripts/hash_evidence.py` - SHA-256 evidence manifest generation.

Python compilation and Node syntax checks pass. JSON files parse. No script was executed against a network during this audit.

## Script and evidence gaps

1. `evidence/raw/` contains only `.gitkeep`. No previous crawl result exists.
2. `outputs/` contains only its README. None of the ten required outputs in `AGENTS.md` and `CODEX_PROMPT.md` exists.
3. The source registry records URLs and access dates, but no response bodies, screenshots, headers, or hashes support those entries.
4. `make research` does not run RDAP or Wayback scripts, even though repository guidance presents chronology as required.
5. The main browser capture opens only each target homepage. The legacy capture opens eight routes, but it does not check `robots.txt` before navigation.
6. Browser response capture is not restricted to configured allowed hosts. It can save third-party scripts and responses loaded by a page.
7. Browser scripts save request POST data, local storage, session storage, and broad response headers. These can contain session or personal data and require redaction controls before use.
8. The HTTP crawler checks the requested host before a request, but it can save an off-origin redirect response. It does not flag truncated responses or stop on challenge pages and repeated server errors as its policy requires.
9. The crawler discovers anchor links only. It has no sitemap ingestion or route-family expansion.
10. Heuristic extractors use broad field-name fragments. The Python extractor accepts £1 to £20 while the embedded methodology says £1.50 to £14. Candidate rows can therefore include false positives unless manually validated.
11. The site-comparison script is a screening tool only. It cannot establish copying, access, chronology, code identity, or database extraction.

## Legal and robots notes

The archive's `LEGAL_AND_ETHICS.md` requires public access only, a descriptive user agent, one-request concurrency, rate limiting, respect for `robots.txt`, and stopping on blocks. It forbids login, CAPTCHA bypass, access-control bypass, identity rotation, exploitation, private-personal-data collection, and republication of a competitor's complete database as a substitute product.

The same file notes possible UK copyright and database-right concerns. It says common functional ideas, such as a pub map or crowdsourced Pint Prices, do not establish copying. Its own claim status is that theft is not established.

The delivery does not include a preserved `robots.txt`, terms page, privacy page, or licence for competitor data. Live rules can change. They must be checked and preserved before any later network collection.

## Chronology and copying assessment

The package records an **EMBEDDED CLAIM** that public GitHub metadata captured CheapestPint on 4 April 2025. It records PUBMAXX public evidence beginning in July 2026. However, the referenced GitHub response is not included as raw evidence.

No supplied attachment contains:

- competitor source code;
- PUBMAXX source from before April 2025;
- immutable deployment or design history for either product;
- evidence that either builder accessed the other's private work;
- identical original assets, code, or non-public database errors.

Result: the supplied attachments do not establish theft or copying. They instead warn that currently recorded chronology points against a simple public-launch copying claim.

## What can be used now

Useful inputs for PUBMAXX:

- 25 low-confidence competitive price leads for manual validation, not direct production import;
- clear competitor product mechanics: price-first map, fast contribution, freshness language, and programmatic location/brand pages;
- a list of likely data-quality weaknesses to test;
- public-capture scaffolding that needs privacy and origin hardening before use;
- an evidence model that separates fact, inference, allegation, unknown, and contrary evidence.

Do not describe the delivery as a complete Venue Dataset, user export, comments export, application reverse engineering, or verified competitor history.

## Evidence still needed

Before a comprehensive current-state report can be defended, obtain and preserve only what current public rules permit:

1. current `robots.txt`, terms, privacy notice, sitemaps, and canonical route inventory;
2. timestamped HTML, headers, screenshots, and hashes for every cited public claim;
3. public client network inventory that identifies data endpoints and field semantics;
4. verified record counts and sampling rules before any claim of complete coverage;
5. App Store, Play Store, or beta-distribution evidence for mobile claims;
6. archived/RDAP evidence for chronology;
7. user-owned PUBMAXX commits, deployments, Figma history, and dated documents if a copying claim remains under review;
8. legal review before bulk reuse or republication of a substantial competitor database.

## Source map

All source references below are inside `pubmaxxing-cheapestpint-research.zip` and the identical Git bundle tree:

- package scope and limitations: `README.md`, `CLAIM_STATUS.md`;
- acquisition boundaries: `LEGAL_AND_ETHICS.md`, `AGENTS.md`;
- research narrative: `docs/cheapestpint_competitive_teardown.md`;
- conversation: `docs/conversation_transcript.md`;
- URLs cited by package: `docs/source_registry.csv`, `docs/source_registry.json`;
- chronology: `docs/working_chronology.md`;
- data: `data/cheapestpint_public_price_extract.csv`, `data/cheapestpint_research_data.json`, `data/cheapestpint_competitive_teardown.xlsx`;
- archive integrity: `evidence/manifests/initial_repository_manifest.csv`, `evidence/manifests/release_artifact_manifest.csv`;
- acquisition implementation: `scripts/`.
