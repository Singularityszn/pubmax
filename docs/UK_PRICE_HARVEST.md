# The UK price harvest

How a real, dated, attributed drink price gets from a pub's own website into
`public/data/uk_prices/`. Three lanes read pages, one builder bundles what they
found beside everything else this tree holds.

```
npm run harvest:uk-prices            # document lane: read what a page SERVES
npm run harvest:uk-prices-rendered   # rendered lane: read what a page SHOWS
npm run harvest:uk-prices-ocr        # scan lane:     read what a pub PHOTOGRAPHED
npm run build:uk-price-bundle        # bundle every lane into one dataset
npm run validate-data                # refuse a row nobody could check
```

`npm run tavily:nightly` is a separate pass. It queues Listed evidence for a curator and does not write this bundle. The command and the two ways to schedule it are in [`docs/TAVILY_NIGHTLY_PASS.md`](./TAVILY_NIGHTLY_PASS.md).

## The boundary, before anything else

`lib/harvest/sourcePolicy.ts` decides what may be read, and nothing takes a host
from a caller. A pub's own site is first-party by definition and needs no table
row; a chain estate needs one, and a host the table refuses on permission is
refused wherever it turns up, including under one of its own pubs' brand
domains (`REFUSED_ESTATE_HOSTS`).

Permission is then asked AGAIN, live, per host, every run, through
`lib/harvest/robots.ts`. An unreadable `robots.txt` is a REFUSAL, not a
missing one: a challenge page or a 403 means no permission can be read, and a
page we cannot ask about is a page we do not take. A genuine 404 publishes no
restriction and is honoured.

Four findings live under that one word, and they are separated because only two
of them are about permission.

* **A rules file with no rules is still a rules file.** What decides is whether
  the body PARSES as `robots.txt`, not whether it holds a `User-agent` line. An
  empty file, one that names only its Sitemap, and one that is comments to the
  last line each publish no restriction, which is the permission a 404 gives.
* **An ordinary HTML page served on a 200 where a rules file should be is an
  absent rules file** (captain's ruling, 2026-09-05). A small site that routes
  every unknown path to its home page or its own 404 page has published no
  rules, which RFC 9309 section 2.3.1.3 reads as no restriction. The ledger row
  carries `robots: "html-page"` so each such admission is auditable.
* **A challenge page is a door, not a page,** and it stays refused at every
  status, a 200 included. `CHALLENGE_PAGE_SIGNATURES` in `lib/harvest/robots.ts`
  is the closed table (Cloudflare, Akamai, hCaptcha, Imperva, DataDome,
  PerimeterX, DDoS-Guard, and a meta refresh that points into a challenge).
  A 401, 403, 429 or 5xx is refused whatever its body says.
* **A network failure is not a refusal,** it is `robots-unreachable`, asked once
  more before it is believed. Reporting a host nobody was home at as a refusal
  says a pub turned us away when it has no site left.

The ledger records what each host SERVED at `/robots.txt` apart from what was
decided (`rules-file`, `absent`, `html-page`, `challenge-page`, `http-refused`,
`not-a-rules-file`, `unreachable`), and `harvest_report.json` counts them as
`robotsFiles`. A row written before that field existed counts as `unrecorded`.

`npm run harvest:uk-prices -- --recheck <outcome>` asks one finding again after
a rule changes, rather than throwing seven thousand answers away with `--reset`.

No lane bypasses anything. The rendered lane runs its browser with stealth
off, TLS shaping off and no challenge wait, identifying as PUBMAXX. A page
behind a challenge is counted as `blocked-by-challenge` and left alone.

## Lane one: the document

`scripts/harvest/uk-prices/run.mjs`. Candidate hosts are the `website` tags the
committed UK OSM pub snapshot already carries, grouped by host and crawled
biggest first. Per host it reads the home page, whatever the host's own
`robots.txt` names as a sitemap, and the links on the home page that look like a
drinks list, to a per-host page ceiling. Resumable: `data-harvest/uk_prices/hosts.json`
records what each host answered, so a rerun continues.

## Lane two: the browser

`scripts/harvest/uk-prices/render.mjs`, using wigolo (AGPL, local). It exists
because the document lane finds nothing on a menu assembled in the browser. That
is not a corner case: the served HTML of a Greene King per-pub menu carries
150 KB and no figure, which is how "Greene King publishes no web price" came to
be written into the source table on 2026-09-03. The same permitted URL read with
a browser on 2026-09-04 states 102 prices, so that verdict was withdrawn.

The lane reads the per-pub menu page of every chain the source table allows,
one page per pub, and the source row names the brand hosts that chain publishes
the same menu on.

## Lane three: the scan

`scripts/harvest/uk-prices/ocr.mjs`. A pub that photographed its drinks list
published a price as plainly as one that typed it, and the document lane cannot
read a photograph: a scan carries no text layer, so it yields nothing and is
counted `unreadable` rather than guessed at. The first national crawl found 16
such documents across 12 hosts, which is the narrowest, most attributable supply
gap it reported.

This lane is deliberately the narrowest of the three.

* **It cannot widen the crawl.** Its hosts are derived from the crawl's own
  ledger, taken off the evidence sentence that records how many of a host's PDFs
  carried no text. There is no `--url` flag.
* **It asks the text layer first, every time.** A document that has one is
  counted `has-text-layer` and left to the document lane. Without that rule a
  rerun would quietly re-read the whole estate through a model.
* **Its byte ceiling is not the document lane's.** That lane stops at 12 MB
  because a document far past it "is a brochure or a scan". A scan is this
  lane's whole subject and is large for the ordinary reason, and every menu this
  lane was built for sits above that ceiling. What bounds the cost is PAGES, not
  bytes, and those are capped.
* **The model is a reader, not an author.** It is asked to transcribe and
  nothing else, and what it returns goes through the same three calls the other
  lanes make. That is what stops an invented figure becoming a price: a number a
  model hallucinates still has to sit beside a drink word, inside that drink's
  band, on a document stating at least four such lines, on a page that names the
  pub.

### Running it

olmOCR (Ai2, Apache-2.0) is **not a dependency of this repository and must never
become one.** It is a pinned Python tool under `uv`, and the script shells out to
it, so `npm install` neither pulls it nor needs it.

```
uv tool install --python 3.12 'olmocr==0.4.27'
```

olmOCR also needs poppler's `pdftoppm` on the PATH and REFUSES TO START without
it, which is a hard check at startup rather than a missing fallback. On a Mac
whose Homebrew is declarative, nix is the way in:

```
nix profile install nixpkgs#poppler-utils
```

Its own default engine is vLLM on an NVIDIA GPU. `olmocr --server` points the
same pipeline at any OpenAI-compatible endpoint, so on Apple Silicon the model is
served locally against Metal:

```
brew install llama.cpp
llama-server -hf lmstudio-community/olmOCR-2-7B-1025-GGUF:Q8_0 \
  --host 127.0.0.1 --port 8099 -c 16384 -ngl 99 --jinja
```

Q8_0 rather than a smaller quantisation deliberately: this lane reads DIGITS, and
a price misread in the last decimal place is worse than no price at all. Nothing
here calls a paid API and no document leaves the machine.

`--dry-run` does the whole discovery and reports what it would read without
starting the model, which is the cheap way to check the hosts still publish.

### What it costs, measured on 2026-09-04

Measured on an Apple M5 Pro with 24 GB of memory, olmOCR-2-7B-1025 at Q8_0 served
by llama.cpp against Metal.

| | Measured |
| --- | ---: |
| One page, end to end | 88.7 s |
| Input tokens for that page | 1,602 |
| Output tokens for that page | 962 |
| Output rate | 10.9 tokens/s |
| Weights to download, once | 9.0 GB |
| Memory resident while serving | about 8 GB |
| Marginal cost per page | none, the model is local |

The supply this lane faces, measured the same day: 12 hosts, 43 documents
discovered, **14 of them scans with no text layer** and 29 carrying one, for
**28 pages**. At the rate above that is about **41 minutes of model time** for
the whole national backlog, one page at a time.

**The memory, not the time, is what makes this a scheduled job rather than a
background one.** Eight resident gigabytes is a third of this machine, so the
lane is run deliberately, on its own, and the server is stopped afterwards. It is
never left running beside other work.

## What counts as a price

`lib/harvest/ukPriceCrawl.ts` owns the deterministic reader shared by the lanes.
When a TypeSafe batch is refused, times out, fails or returns a malformed answer,
`lib/harvest/ukPriceJudgment.server.ts` uses the same section-aware decisions and
records the batch failure reason.

The shared `pageText` normaliser takes `UkPriceSourceFormat` from the transport.
Served HTML and chain-menu HTML use `html`: source whitespace is collapsed
before structural tags establish item boundaries. Context.dev Markdown,
browser-rendered Markdown, PDF text, and OCR text use `text`, the reader's
default. With item boundaries requested, LF and CRLF rows stay separate.
In mixed Markdown and HTML, the normaliser
collapses formatting whitespace within HTML elements and between adjacent
elements while preserving surrounding Markdown rows. Inline and table-cell
fragments therefore keep a wrapped drink name within its item.

The judged reader and its deterministic fallback use the same format and
boundary-preserving text. Candidate offsets identify figures in that text,
so failed batches recover the decision for the same item.

* **Verbatim.** A figure is kept only if it appears literally in the text of the
  page that was read.
* **The item's printed name takes priority.** An early zero-strength marker or
  cocktail name takes priority over ingredient words. Complete `0%`, `0.0%`
  and `0.00%` tokens qualify; `4.0%`, `10.0%` and `0.5%` do not.
  Explicit alcohol-free wording also qualifies. Otherwise, the reader uses the
  nearest recognised category word in the name, then the surrounding text.
  Juice names identify soft drinks, and matcha files as coffee. A soda, chai
  latte or tea latte with no recognised category is dropped instead of
  borrowing a neighbouring drink's category.
  Named cocktails such as "Negroni on tap" and "Espresso Martini on draught"
  keep their cocktail category. When the priced line has no early cocktail or
  zero-strength title, a conflicting cocktail or zero-strength title on a
  preceding unpriced line makes the reader drop the figure as
  `item-name-ambiguous`. It does not join a split title and description into an
  assumed drink name.
* **Wine context stays within its section and item.** In a `section`, `article`
  or `div.menubox`, paragraphs can use the preceding wine heading until another
  heading changes it. Paragraphs before the first heading get no section context.
  Paired glass prices retain the preceding wine name within the same item,
  including pairs separated by slashes or dashes. A measure alone never borrows
  a name across a structural item boundary; `250ml` alone does not establish wine.
  The reader emits explicit glass measures separately from the wine name. The
  [bundle reference](../public/data/uk_prices/README.md#what-a-row-is) owns the
  serving field and its publication contract.
* **Its own category's band.** £14 is a fair cocktail and an impossible pint.
* **No food word,** checked after the drink word, so a steak-and-a-pint meal
  deal is not the price of the pint.
* **No offer wording.** "2 for £9", "only £5.99" and "wines from £5.50" all
  state a number a drinker cannot walk in and pay for one named drink. The first
  run of this crawler wrote a Brewers Fayre happy hour onto 27 pubs as the price
  of a beer, which is why this rule exists.
* **The page has to be a list.** Four priced drink lines. One or two is a
  banner, and a banner is where the offers live.
* **An estate page must NAME the pub.** A host serving one pub is that pub's own
  site. A host serving an estate is not, and attributing its home page price to
  every pub on it turns one figure into hundreds of wrong ones.

Every rejection is counted under its own reason and printed. A skip is a
finding: "we crawled 7,000 sites and found 900 prices" is only honest beside the
reasons the other 6,100 gave.

`__tests__/ukPriceCrawl.test.ts` and `__tests__/ukPriceJudgmentFailure.test.ts`
cover item and heading boundaries, complete zero-strength tokens and paired
wine measures, including the failed-batch fallback. Synthetic menus establish
parser behaviour, not the original context or category of quarantined source
observations. The quarantine does not establish that other labels are correct.

## PDF menus

A pub that keeps its drinks list in a PDF has published a price as plainly as
one that keeps it in a table. The first crawl reached 839 PDFs across 400 hosts
and read none of them.

`lib/harvest/pdfText.ts` reads the text layer with `pdfjs-dist`, pinned and
harvest-only. It joins fragments within a row and preserves the extractor's
`hasEOL` row breaks before handing text to the shared price reader. It is a
leaf module because `run.mjs` ends in a `main()` call, so a reader living inside
it could not be tested without running a crawl.

It never renders and never guesses. A scanned menu carries no text layer, so it
yields nothing and is counted as `unreadable` rather than passed to an image
model that would invent a price. The run report counts PDFs three ways: seen,
read, and reached but unreadable.

The documents it counts `unreadable` are exactly what lane three reads, and the
model there is held to the same rule this one keeps: it transcribes, and the
price rules above still decide what a transcription is worth.

## What comes out

`data/uk_prices/harvest_report.json`, `data/uk_prices/rendered_report.json` and
`data/uk_prices/ocr_report.json` carry the counts, the first including the `pdfs`
tally of seen, read and unreadable. `data/uk_prices/site_harvest.jsonl` is the published copy of
the accepted rows, so the bundle rebuilds from the tree rather than from a
working directory nobody commits. `public/data/uk_prices/README.md` owns the
bundle itself.

Nothing here writes to a price surface. Publishing is the bundle builder, and it
is a separate, deliberate step.
